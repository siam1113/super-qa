"""Bounded automation repair: selector/fixture/setup patches validated in a disposable checkout.

A candidate patch is rejected before any job is submitted unless every originally
present assertion's expectation (its checked value, selector/locator calls excluded)
is still present and no skip/only marker was introduced. Validation itself happens
inside the existing durable repository worker's disposable checkout (git archive plus
a single confined `git apply`); this module never executes project code directly.
"""
import hashlib
import re
import subprocess
import tempfile
from pathlib import Path
from types import SimpleNamespace
from typing import Optional
from uuid import UUID

from pydantic import Field, model_validator

from .contracts import Contract, SkillBlocked
from .investigation import selected_evidence
from .operations import operation
from .repository import confined, project_root
from .scope import current_scope
from .suites import binding_for, call_api, job_result

ASSERTION_PATTERN = re.compile(r'\b(?:expect\s*\(|\.should\s*\(|assert[.(])')
DISABLE_PATTERN = re.compile(r'\b(?:test\.skip|it\.skip|describe\.skip|xit|xdescribe)\s*\(|\.skip\s*\(|\.only\s*\(')
SELECTOR_CALL = re.compile(r'(?:page\.|cy\.)?(?:locator|get|getBy\w+)\([^)]*\)')


def assertion_signature(line):
    """Collapse a locator/selector call so a selector-only edit does not change the signature."""
    return SELECTOR_CALL.sub('<selector>', line.strip())


class RepairPatch(Contract):
    model_config = {"extra": "forbid", "str_strip_whitespace": False}
    path: str = Field(pattern=r'^[A-Za-z0-9_./-]+\.(?:ts|js|tsx|jsx|mjs|cjs)$')
    diff: str = Field(min_length=1, max_length=20000)
    base_content_hash: str = Field(pattern=r'^[a-f0-9]{64}$')

    @model_validator(mode='after')
    def no_traversal(self):
        if self.path.startswith('/') or '..' in self.path.split('/'):
            raise ValueError('Repair path must be relative and cannot traverse parent directories')
        return self


class MaintainInput(Contract):
    suite_profile_id: str = Field(pattern=r'^[A-Za-z0-9_-]{1,100}$')
    source_execution_id: UUID
    check_id: str = Field(pattern=r'^[A-Za-z0-9_-]{1,100}$')
    test_id: str = Field(pattern=r'^[a-f0-9]{64}$')
    repair_patch: RepairPatch
    submit: bool = Field(default=False, strict=True)
    validation_execution_id: Optional[UUID] = None

    @model_validator(mode='after')
    def exclusive(self):
        if self.submit and self.validation_execution_id:
            raise ValueError('Choose one patch submission or one validation read, not both')
        if self.validation_execution_id == self.source_execution_id:
            raise ValueError('Validation requires a distinct job from the source failure')
        return self


@operation('resolve_repository_revision_source', 'Read the pinned original file content for a suite-bound repository revision; never executes repository code.', dependencies=('resolve_suite_profile',))
async def read_original(value):
    binding = binding_for(value.suite_profile_id)
    descriptor = await call_api(binding, 'GET', '/suites/' + str(binding.suite_id))
    suite = descriptor.get('suite', {})
    checks = suite.get('checks', [])
    profiles = descriptor.get('repositoryProfiles', [])
    if descriptor.get('projectId') != str(binding.project_id) or not suite.get('approvedBy') or len(checks) != 1 or checks[0].get('kind') != 'repository' or checks[0].get('profileHash') != binding.profile_hash or len(profiles) != 1:
        raise SkillBlocked('Automation maintenance requires an approved, pinned repository suite')
    metadata = profiles[0]
    allowed = metadata.get('allowedRepairPaths') or []
    if value.repair_patch.path not in allowed:
        raise SkillBlocked('Repair path is not approved for this repository profile')
    from shared.harness.repository import bounded_command
    root = project_root(metadata['repositoryId'])
    confined(root, value.repair_patch.path)
    code, raw = bounded_command(['git', '--no-pager', '-C', str(root), 'show', metadata['revision'] + ':' + value.repair_patch.path], limit=131072)
    if code:
        raise SkillBlocked('Pinned revision or repair path is unavailable in the configured repository')
    original = raw.decode('utf-8', errors='strict')
    if hashlib.sha256(original.encode()).hexdigest() != value.repair_patch.base_content_hash:
        raise SkillBlocked('Repair patch no longer matches the pinned file content')
    return {'repository_id': metadata['repositoryId'], 'revision': metadata['revision'], 'path': value.repair_patch.path, 'original': original}


@operation('prepare_patch_candidate', 'Apply one confined unified diff to the pinned original content in a throwaway directory to compute the candidate text; writes nothing to the configured repository.')
def apply_candidate(source, patch):
    with tempfile.TemporaryDirectory() as directory:
        root = Path(directory)
        target = root / patch.path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(source['original'])
        patch_file = root / 'candidate.patch'
        patch_file.write_text(patch.diff)
        result = subprocess.run(['git', 'apply', '--unsafe-paths', '--whitespace=nowarn', str(patch_file)],
                                 cwd=str(root), capture_output=True, timeout=10)
        if result.returncode:
            raise SkillBlocked('Repair patch did not apply cleanly to the pinned original content')
        patched = target.read_text()
    return {**source, 'patched': patched, 'diff_hash': hashlib.sha256(patch.diff.encode()).hexdigest()}


@operation('compare_assertion_manifest', 'Require every originally present assertion statement verbatim in the patched text and reject newly introduced skip/only markers; the only deterministic repair gate.')
def compare_manifest(candidate):
    original_lines = {assertion_signature(line) for line in candidate['original'].splitlines() if ASSERTION_PATTERN.search(line)}
    patched_lines = {assertion_signature(line) for line in candidate['patched'].splitlines() if ASSERTION_PATTERN.search(line)}
    removed = sorted(original_lines - patched_lines)
    added = sorted(patched_lines - original_lines)
    disabled_before = len(DISABLE_PATTERN.findall(candidate['original']))
    disabled_after = len(DISABLE_PATTERN.findall(candidate['patched']))
    weakened = bool(removed) or disabled_after > disabled_before or len(patched_lines) < len(original_lines)
    result = {'original_assertion_count': len(original_lines), 'patched_assertion_count': len(patched_lines),
               'removed_assertions': removed, 'added_assertions': added,
               'skip_or_only_markers_added': disabled_after > disabled_before, 'weakened': weakened}
    if weakened:
        raise SkillBlocked('Patch removes, skips, or otherwise weakens an existing assertion; not a supported repair')
    return result


@operation('validate_patch_candidate', 'Queue the reviewed patch against the pinned suite, or read back a previously queued validation job; never merges or approves a baseline.', dependencies=('resolve_suite_profile',))
async def validate(value, source, diff_hash, request_id=None):
    binding = binding_for(value.suite_profile_id)
    if value.submit:
        if not current_scope().can_execute:
            raise SkillBlocked('This app assignment cannot start a repair validation run')
        descriptor = await call_api(binding, 'GET', '/suites/' + str(binding.suite_id))
        suite = descriptor.get('suite', {})
        if not suite.get('approvedBy') or suite['checks'][0].get('profileHash') != binding.profile_hash:
            raise SkillBlocked('Source suite revision is no longer approved by this binding')
        body = {'requestId': request_id, 'suiteId': str(binding.suite_id),
                'repairPatch': {'path': value.repair_patch.path, 'diff': value.repair_patch.diff, 'baseContentHash': value.repair_patch.base_content_hash}}
        return {'queued': job_result(await call_api(binding, 'POST', '/runs', body), value.suite_profile_id)}
    if value.validation_execution_id:
        run = await call_api(binding, 'GET', '/runs/' + str(value.validation_execution_id))
        if run.get('projectId') != str(binding.project_id) or run.get('suiteId') != str(binding.suite_id):
            raise SkillBlocked('Validation job belongs to another suite binding')
        observation = next((item.get('observation', {}) for item in run.get('results') or [] if item.get('checkId') == value.check_id), {})
        if run.get('status') not in ('queued', 'running') and observation.get('repairPatchHash') != diff_hash:
            raise SkillBlocked('Validation job does not carry evidence for this exact reviewed patch')
        candidate = selected_evidence(run, SimpleNamespace(check_id=value.check_id, test_id=value.test_id))
        return {'candidate': candidate}
    return {}


def assemble(value, manifest, outcome, source=None):
    data = {'schema_version': 1, 'manifest': manifest, 'source': source, 'review_decision': 'requires_review', 'test_id': value.test_id}
    if 'queued' in outcome:
        data.update(state='pending', job=outcome['queued']['job'], execution=outcome['queued']['execution'], suite_profile_id=outcome['queued']['suite_profile_id'])
        data['summary'] = 'A validation job applying the reviewed repair was queued. Poll with validation_execution_id to compare before/after evidence.'
    elif 'candidate' in outcome:
        candidate = outcome['candidate']
        data['candidate'] = candidate
        if candidate['job_status'] in ('queued', 'running'):
            state = 'pending'
        elif source and candidate['profile_hash'] != source['profile_hash']:
            state = 'incomparable'
        else:
            result = candidate['result'] or {}
            tests = result.get('observation', {}).get('tests', [])
            target = next((test for test in tests if test.get('id') == value.test_id), None)
            after_status = target['attempts'][-1]['status'] if target and target.get('attempts') else None
            state = 'repair_validated' if after_status == 'passed' else 'not_resolved' if after_status else 'incomparable'
        data['state'] = state
        data['summary'] = {'repair_validated': 'The target test passed in a disposable checkout with the reviewed patch applied and every original assertion preserved.',
                           'not_resolved': 'The target test did not pass with the reviewed patch applied.',
                           'pending': 'The validation job is still queued or running; investigate again once it completes.',
                           'incomparable': 'Validation evidence is incomplete or does not match the source suite binding.'}[state]
    else:
        data.update(state='manifest_checked', summary='Assertion manifest preserved. Supply submit=true to queue validation, or validation_execution_id to read a queued job back.')
    data['limitations'] = ['A passing validation job is not an automatic merge, baseline approval or regression guarantee beyond the target test.',
                            'Assertion preservation collapses locator/selector calls and compares the remaining statement text; semantically equivalent rewrites that do not match this shape may be rejected and reviewed manually.',
                            'Only selector/fixture/setup-style single-file repairs are supported in this version.']
    return data


def create_maintenance_graph(skill, capabilities):
    from langgraph.graph import END, StateGraph
    from .graphs import SkillState, failure

    async def resolve_target(state):
        try:
            value = MaintainInput.model_validate(state['request']['inputs'])
            source_evidence = await capabilities.collect_failure(value, value.source_execution_id)
            if source_evidence['job_status'] in ('queued', 'running') or not source_evidence['result'] or source_evidence['result'].get('status') not in ('failed', 'error'):
                raise SkillBlocked('Choose a completed job check with recorded failure or error evidence')
            return {'prepared': {'source_evidence': source_evidence}, 'trace': ['resolve_failing_target'], 'model_calls': 0}
        except Exception as error:
            return {**failure(error), 'trace': ['resolve_failing_target'], 'model_calls': 0}

    async def check_manifest(state):
        if state.get('error'): return {}
        try:
            value = MaintainInput.model_validate(state['request']['inputs'])
            original = await capabilities.read_repair_source(value)
            candidate = apply_candidate(original, value.repair_patch)
            manifest = compare_manifest(candidate)
            prepared = dict(state['prepared'])
            prepared.update(candidate=candidate, manifest=manifest)
            return {'prepared': prepared, 'trace': state['trace'] + ['compare_assertion_manifest']}
        except Exception as error:
            return {**failure(error), 'trace': state['trace'] + ['compare_assertion_manifest']}

    async def run_validation(state):
        if state.get('error'): return {}
        try:
            value = MaintainInput.model_validate(state['request']['inputs'])
            outcome = await capabilities.validate_repair(value, state['prepared']['source_evidence'], state['prepared']['candidate']['diff_hash'], state['request']['request_id'])
            data = assemble(value, state['prepared']['manifest'], outcome, state['prepared']['source_evidence'])
            return {'status': 'completed', 'data': data, 'trace': state['trace'] + ['validate_patch_candidate']}
        except Exception as error:
            return {**failure(error), 'trace': state['trace'] + ['validate_patch_candidate']}
    graph = StateGraph(SkillState)
    graph.add_node('resolve_failing_target', resolve_target)
    graph.add_node('compare_assertion_manifest', check_manifest)
    graph.add_node('validate_patch_candidate', run_validation)
    graph.set_entry_point('resolve_failing_target')
    graph.add_edge('resolve_failing_target', 'compare_assertion_manifest')
    graph.add_edge('compare_assertion_manifest', 'validate_patch_candidate')
    graph.add_edge('validate_patch_candidate', END)
    return graph.compile()
