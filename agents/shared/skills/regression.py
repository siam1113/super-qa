"""Conservative regression selection over pinned cases, Git changes and approved suites."""
import asyncio
import hashlib
import json
import os
from pathlib import Path
from typing import List
from pydantic import Field, field_validator, model_validator
from .contracts import ArtifactPin, Contract, CoverageInput, SkillBlocked
from .operations import operation
from .repository import project_root
from .scope import require_resource
from .suites import binding_for, call_api


class RegressionInput(Contract):
    profile_id: str = Field(pattern=r'^[A-Za-z0-9_-]{1,100}$')
    base_revision: str = Field(pattern=r'^[a-f0-9]{40}$')
    head_revision: str = Field(pattern=r'^[a-f0-9]{40}$')
    expected_target_revision: str = Field(min_length=1, max_length=200)
    requirement_review: ArtifactPin
    case_artifact: ArtifactPin
    max_tests: int = Field(default=1000, ge=1, le=1000, strict=True)


class TestImpact(Contract):
    test_id: str = Field(pattern=r'^[a-f0-9]{64}$')
    paths: List[str] = Field(default_factory=list, max_length=50)
    mandatory: bool = Field(default=False, strict=True)
    priority: int = Field(default=3, ge=1, le=5, strict=True)

    @field_validator('paths')
    @classmethod
    def safe_paths(cls, values):
        if len(set(values)) != len(values) or any(not value or len(value) > 300 or value.startswith('/') or '\\' in value or any(ord(char) < 32 for char in value) or any(part in ('..', '.') for part in value.split('/')) for value in values):
            raise ValueError('Impact paths must be distinct repository-relative files or directory prefixes ending in /')
        return values


class SuiteImpact(Contract):
    suite_profile_id: str = Field(pattern=r'^[A-Za-z0-9_-]{1,100}$')
    tests: List[TestImpact] = Field(min_length=1, max_length=100)

    @model_validator(mode='after')
    def unique_tests(self):
        if len({item.test_id for item in self.tests}) != len(self.tests):
            raise ValueError('Duplicate mapped test identity')
        return self


class RegressionProfile(Contract):
    repository_id: str = Field(pattern=r'^[A-Za-z0-9_-]{1,100}$')
    suites: List[SuiteImpact] = Field(min_length=1, max_length=10)

    @model_validator(mode='after')
    def unique_suites(self):
        if len({item.suite_profile_id for item in self.suites}) != len(self.suites) or not any(item.mandatory for suite in self.suites for item in suite.tests):
            raise ValueError('Distinct suites and at least one mandatory smoke test are required')
        return self


@operation('resolve_regression_policy', 'Read an app-scoped impact policy and retain its content hash; no source code or expectations are generated.')
def resolve_policy(profile_id):
    require_resource('regression_profiles', profile_id)
    paths = json.loads(os.getenv('QA_REGRESSION_PROFILES', '{}'))
    if not isinstance(paths, dict) or not isinstance(paths.get(profile_id), str):
        raise SkillBlocked('Regression profile is not configured')
    path = Path(paths[profile_id])
    if not path.is_absolute() or not path.is_file():
        raise SkillBlocked('Regression policy requires an absolute file path')
    with path.open('rb') as source: raw = source.read(128001)
    if len(raw) > 128000:
        raise SkillBlocked('Regression policy exceeds its 128 KB budget')
    profile = RegressionProfile.model_validate_json(raw)
    require_resource('repositories', profile.repository_id)
    return profile, hashlib.sha256(raw).hexdigest()


@operation('read_pinned_revision_changes', 'Read changed file paths between two exact commits in a configured repository without running project code.')
async def read_changes(repository_id, base, head):
    from shared.harness.repository import bounded_command
    root = project_root(repository_id)
    def collect():
        command = ['git', '--no-pager', '-C', str(root), '-c', 'core.fsmonitor=false']
        for revision in (base, head):
            code, actual = bounded_command(command + ['rev-parse', '--verify', revision + '^{commit}'])
            if code or actual.decode().strip() != revision:
                raise SkillBlocked('Pinned base/head commit is unavailable in the configured repository')
        code, raw = bounded_command(command + ['diff', '--no-ext-diff', '--no-textconv', '--no-renames', '--name-only', '-z', base, head, '--'], limit=256000)
        if code: raise SkillBlocked('Could not read the pinned revision diff')
        paths = sorted(set(item.decode('utf-8', errors='strict') for item in raw.split(b'\0') if item))
        if len(paths) > 2000: raise SkillBlocked('Diff exceeds 2,000 paths; narrow the release scope')
        return {'base_revision': base, 'head_revision': head, 'paths': paths, 'diff_hash': hashlib.sha256(raw).hexdigest(), 'basis': 'exact_commit_trees; working-directory changes excluded'}
    return await asyncio.to_thread(collect)


@operation('resolve_mapped_suite_inventory', 'Validate approved suite inventories against the pinned case artifact, case revisions and target app revision.', dependencies=('resolve_suite_profile',))
async def resolve_inventory(profile, value, resolved):
    cases = {item['id']: item for item in resolved['inputs']['cases']}
    if len(cases) != len(resolved['inputs']['cases']):
        raise SkillBlocked('Case artifact contains duplicate identities')
    requirements = {item['id']: item for item in resolved['inputs']['requirements']}
    snapshot_hash = resolved['provenance']['snapshot_hash']
    inventories = []
    suite_ids = set()
    for policy in profile.suites:
        binding = binding_for(policy.suite_profile_id)
        descriptor = await call_api(binding, 'GET', '/suites/' + str(binding.suite_id))
        suite = descriptor.get('suite', {})
        profiles = descriptor.get('repositoryProfiles', [])
        checks = suite.get('checks', [])
        if str(binding.suite_id) in suite_ids:
            raise SkillBlocked('Two regression bindings resolve to the same suite')
        suite_ids.add(str(binding.suite_id))
        if descriptor.get('projectId') != str(binding.project_id) or not suite.get('approvedBy') or len(checks) != 1 or checks[0].get('kind') != 'repository' or checks[0].get('profileHash') != binding.profile_hash or len(profiles) != 1:
            raise SkillBlocked('Regression requires approved, pinned repository suites')
        metadata = profiles[0]
        pin = metadata.get('caseArtifact') or {}
        if metadata.get('repositoryId') != profile.repository_id or metadata.get('revision') != value.head_revision or metadata.get('targetRevision') != value.expected_target_revision:
            raise SkillBlocked('Suite repository or target revision does not match the candidate')
        if pin.get('requestId') != str(value.case_artifact.request_id) or pin.get('contentHash') != value.case_artifact.content_hash or pin.get('snapshotHash') != snapshot_hash:
            raise SkillBlocked('Suite is not mapped to the pinned case/requirement artifacts')
        expected = metadata.get('expectedTests', [])
        declared = {test.test_id: test for test in policy.tests}
        if not expected or not set(declared) <= set(expected):
            raise SkillBlocked('Impact policy references tests outside the approved inventory')
        links = metadata.get('caseLinks', [])
        for link in links:
            case = cases.get(link['caseId'])
            if not case or case['revision'] != link['caseRevision'] or link['testId'] not in expected:
                raise SkillBlocked('Case mapping is missing or has changed revision')
            if not case['requirement_ids'] or any(identity not in requirements for identity in case['requirement_ids']):
                raise SkillBlocked('Mapped case has missing requirement links')
            criterion_ids = {criterion['id'] for identity in case['requirement_ids'] for criterion in requirements[identity]['criteria']}
            if not case['criterion_ids'] or not set(case['criterion_ids']) <= criterion_ids:
                raise SkillBlocked('Mapped case has missing or unrelated criterion links')
        tests = []
        for test_id in expected:
            impact = declared.get(test_id)
            case_ids = [link['caseId'] for link in links if link['testId'] == test_id]
            tests.append({'test_id': test_id, 'case_ids': case_ids, 'case_revisions': {identity: cases[identity]['revision'] for identity in case_ids},
                          'requirement_ids': sorted({identity for case_id in case_ids for identity in cases[case_id]['requirement_ids']}),
                          'paths': impact.paths if impact else [], 'mandatory': impact.mandatory if impact else False,
                          'priority': impact.priority if impact else 5, 'mapping_complete': bool(impact and impact.paths and case_ids)})
        inventories.append({'suite_profile_id': policy.suite_profile_id, 'suite_id': str(binding.suite_id), 'profile_hash': binding.profile_hash,
                            'manifest_hash': suite['manifestHash'], 'repository_revision': metadata['revision'], 'target_revision': metadata['targetRevision'],
                            'dataset_required': bool(metadata.get('datasetProfileHash')), 'dataset_profile_hash': metadata.get('datasetProfileHash'), 'tests': tests})
    return inventories


def affected(path, rules):
    return any(path.startswith(rule) if rule.endswith('/') else path == rule for rule in rules)


@operation('select_impacted_suites', 'Preserve mandatory and impacted tests, broaden on unknown impact, and report whole-suite costs and omitted scope.')
def select(profile_hash, changes, inventories, value, provenance, cases):
    paths = changes['paths']
    tests = [test for suite in inventories for test in suite['tests']]
    unmapped = [path for path in paths if not any(affected(path, test['paths']) for test in tests)]
    gaps = [{'suite_profile_id': suite['suite_profile_id'], 'test_id': test['test_id']} for suite in inventories for test in suite['tests'] if not test['mapping_complete']]
    mapped_cases = {identity for test in tests for identity in test['case_ids']}
    unmapped_cases = sorted(item['id'] for item in cases if item['id'] not in mapped_cases)
    fallback = bool(unmapped or gaps or unmapped_cases)
    selected, omitted = [], []
    for suite in inventories:
        candidates = []
        for test in suite['tests']:
            matched = [path for path in paths if affected(path, test['paths'])]
            reasons = (['mandatory_smoke'] if test['mandatory'] else []) + (['changed_path_mapping'] if matched else []) + (['conservative_full_scope'] if fallback else [])
            candidates.append({**test, 'matched_paths': matched, 'reasons': reasons})
        include_suite = any(test['reasons'] for test in candidates)
        destination = selected if include_suite else omitted
        for test in candidates:
            if include_suite and not test['reasons']: test['reasons'] = ['included_with_approved_suite']
            if not include_suite: test['reasons'] = ['no_changed_path_or_mandatory_rule; impact mapping is operator-declared']
        destination.append({**suite, 'tests': sorted(candidates, key=lambda test: (not test['mandatory'], -test['priority'], test['test_id']))})
    selected.sort(key=lambda suite: (not any(test['mandatory'] for test in suite['tests']), -max(test['priority'] for test in suite['tests']), suite['suite_profile_id']))
    count = sum(len(suite['tests']) for suite in selected)
    return {'schema_version': 1, 'state': 'budget_exceeded' if count > value.max_tests else 'selected',
            'selection_unit': 'approved_suite', 'profile_hash': profile_hash, 'changes': changes, 'input_provenance': provenance,
            'selected_suites': selected, 'omitted_suites': omitted, 'selected_test_count': count, 'inventory_test_count': len(tests),
            'max_tests': value.max_tests, 'budget_exceeded': count > value.max_tests, 'conservative_fallback': fallback,
            'unmapped_paths': unmapped, 'mapping_gaps': gaps, 'unmapped_case_ids': unmapped_cases, 'execution_authorized': False,
            'summary': 'Budget exceeded; mandatory and affected scope is retained for review.' if count > value.max_tests else 'Approved suites selected from pinned changes and explicit impact mappings.',
            'limitations': ['Selection does not execute or authorize a suite.', 'Declared impact and case links do not prove complete behavioral coverage.', 'Counts include each suite invocation, including tests shared by multiple suites.', 'Case design artifacts remain drafts; suite approval does not approve their semantics.']}


def create_regression_graph(skill, capabilities):
    from langgraph.graph import END, StateGraph
    from .graphs import SkillState, failure

    async def resolve(state):
        try:
            value = RegressionInput.model_validate(state['request']['inputs'])
            profile, digest = resolve_policy(value.profile_id)
            artifacts = await capabilities.resolve_workflow_inputs(CoverageInput(requirement_review=value.requirement_review, case_artifact=value.case_artifact))
            return {'prepared': {'profile': profile.model_dump(mode='json'), 'profile_hash': digest, 'artifacts': artifacts}, 'trace': ['resolve_selection_inputs'], 'model_calls': 0}
        except Exception as error:
            return {**failure(error), 'trace': ['resolve_selection_inputs'], 'model_calls': 0}

    async def collect(state):
        if state.get('error'): return {}
        try:
            value = RegressionInput.model_validate(state['request']['inputs'])
            prepared = dict(state['prepared'])
            profile = RegressionProfile.model_validate(prepared['profile'])
            prepared['changes'] = await capabilities.read_regression_changes(profile.repository_id, value.base_revision, value.head_revision)
            prepared['inventories'] = await capabilities.resolve_regression_inventory(profile, value, prepared['artifacts'])
            return {'prepared': prepared, 'trace': state['trace'] + ['collect_changes_and_inventory']}
        except Exception as error:
            return {**failure(error), 'trace': state['trace'] + ['collect_changes_and_inventory']}

    async def finalize(state):
        if state.get('error'): return {}
        try:
            value = RegressionInput.model_validate(state['request']['inputs'])
            prepared = state['prepared']
            profile, digest = resolve_policy(value.profile_id)
            if digest != prepared['profile_hash']: raise SkillBlocked('Regression policy changed during selection')
            current = await capabilities.resolve_workflow_inputs(CoverageInput(requirement_review=value.requirement_review, case_artifact=value.case_artifact))
            inventories = await capabilities.resolve_regression_inventory(profile, value, current)
            if inventories != prepared['inventories']: raise SkillBlocked('Suite inventory changed during selection')
            data = select(digest, prepared['changes'], inventories, value, current['provenance'], current['inputs']['cases'])
            return {'status': 'completed', 'data': data, 'trace': state['trace'] + ['finalize_selection']}
        except Exception as error:
            return {**failure(error), 'trace': state['trace'] + ['finalize_selection']}
    graph = StateGraph(SkillState)
    graph.add_node('resolve_selection_inputs', resolve)
    graph.add_node('collect_changes_and_inventory', collect)
    graph.add_node('finalize_selection', finalize)
    graph.set_entry_point('resolve_selection_inputs')
    graph.add_edge('resolve_selection_inputs', 'collect_changes_and_inventory')
    graph.add_edge('collect_changes_and_inventory', 'finalize_selection')
    graph.add_edge('finalize_selection', END)
    return graph.compile()
