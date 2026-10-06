"""Deterministic release-gate evaluation over fresh owned suite jobs, coverage and findings."""
import hashlib
import json
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import List, Literal, Optional
from uuid import UUID

from pydantic import Field, model_validator

from .contracts import ArtifactPin, Contract, SkillBlocked
from .operations import operation
from .scope import require_resource
from .suites import binding_for, call_api


class CoveragePin(ArtifactPin):
    producer: Literal['qae.analyze_coverage', 'aue.analyze_coverage']


class FindingPin(ArtifactPin):
    producer: Literal['qae.investigate_defect', 'aue.investigate_defect']


class ReleaseSuiteGate(Contract):
    suite_profile_id: str = Field(pattern=r'^[A-Za-z0-9_-]{1,100}$')
    execution_id: UUID


class ReleaseInput(Contract):
    profile_id: str = Field(pattern=r'^[A-Za-z0-9_-]{1,100}$')
    candidate_revision: str = Field(min_length=1, max_length=200)
    suite_gates: List[ReleaseSuiteGate] = Field(default_factory=list, max_length=20)
    coverage_artifact: Optional[CoveragePin] = None
    finding_artifacts: List[FindingPin] = Field(default_factory=list, max_length=50)

    @model_validator(mode='after')
    def unique(self):
        if len({gate.suite_profile_id for gate in self.suite_gates}) != len(self.suite_gates):
            raise ValueError('Duplicate suite gate profile IDs')
        if len({str(pin.request_id) for pin in self.finding_artifacts}) != len(self.finding_artifacts):
            raise ValueError('Duplicate finding artifact pins')
        return self


class RequiredSuiteGate(Contract):
    suite_profile_id: str = Field(pattern=r'^[A-Za-z0-9_-]{1,100}$')
    mandatory: bool = Field(default=True, strict=True)


class ReleasePolicy(Contract):
    repository_id: Optional[str] = Field(default=None, pattern=r'^[A-Za-z0-9_-]{1,100}$')
    required_suites: List[RequiredSuiteGate] = Field(min_length=1, max_length=20)
    min_design_coverage_percent: Optional[float] = Field(default=None, ge=0, le=100)
    max_open_findings: int = Field(default=0, ge=0, le=1000, strict=True)
    evidence_ttl_seconds: int = Field(default=3600, ge=60, le=604800, strict=True)

    @model_validator(mode='after')
    def unique_suites(self):
        if len({item.suite_profile_id for item in self.required_suites}) != len(self.required_suites):
            raise ValueError('Duplicate required suite profile IDs')
        return self


@operation('resolve_release_policy', 'Read an app-scoped release-gate policy and retain its content hash; no evidence or approval is generated.')
def resolve_policy(profile_id):
    require_resource('release_policies', profile_id)
    paths = json.loads(os.getenv('QA_RELEASE_POLICIES', '{}'))
    if not isinstance(paths, dict) or not isinstance(paths.get(profile_id), str):
        raise SkillBlocked('Release policy is not configured')
    path = Path(paths[profile_id])
    if not path.is_absolute() or not path.is_file():
        raise SkillBlocked('Release policy requires an absolute file path')
    with path.open('rb') as source:
        raw = source.read(32001)
    if len(raw) > 32000:
        raise SkillBlocked('Release policy exceeds its 32 KB budget')
    policy = ReleasePolicy.model_validate_json(raw)
    if policy.repository_id:
        require_resource('repositories', policy.repository_id)
    return policy, hashlib.sha256(raw).hexdigest()


@operation('resolve_release_evidence', 'Read fresh, owned suite jobs for each configured required gate and classify staleness, pending, revision mismatch and terminal status.', dependencies=('resolve_suite_profile',))
async def resolve_evidence(policy, value):
    supplied = {gate.suite_profile_id: gate for gate in value.suite_gates}
    now = datetime.now(timezone.utc)
    gates = []
    for required in policy.required_suites:
        entry = supplied.get(required.suite_profile_id)
        if entry is None:
            gates.append({'suite_profile_id': required.suite_profile_id, 'mandatory': required.mandatory,
                          'gate_status': 'unexecuted', 'execution_id': None, 'repository_revision': None,
                          'target_revision': None, 'age_seconds': None, 'test_statuses': []})
            continue
        binding = binding_for(required.suite_profile_id)
        run = await call_api(binding, 'GET', '/runs/' + str(entry.execution_id))
        if run.get('projectId') != str(binding.project_id) or run.get('suiteId') != str(binding.suite_id):
            raise SkillBlocked('Execution belongs to another suite binding')
        descriptor = await call_api(binding, 'GET', '/suites/' + str(binding.suite_id))
        suite = descriptor.get('suite', {})
        checks = suite.get('checks', [])
        profiles = descriptor.get('repositoryProfiles', [])
        if descriptor.get('projectId') != str(binding.project_id) or not suite.get('approvedBy') or len(checks) != 1 or checks[0].get('kind') != 'repository' or checks[0].get('profileHash') != binding.profile_hash or len(profiles) != 1:
            raise SkillBlocked('Release gate requires an approved, pinned repository suite')
        metadata = profiles[0]
        revision_target = metadata.get('targetRevision') or metadata.get('revision')
        matches_revision = revision_target == value.candidate_revision
        age_seconds = None
        try:
            created = datetime.fromisoformat(str(run.get('createdAt')).replace('Z', '+00:00'))
            age_seconds = (now - created).total_seconds()
        except (TypeError, ValueError):
            pass
        stale = age_seconds is None or age_seconds > policy.evidence_ttl_seconds
        status = run.get('status')
        if status in ('queued', 'running'):
            gate_state = 'pending'
        elif not matches_revision:
            gate_state = 'revision_mismatch'
        elif stale:
            gate_state = 'stale'
        elif status == 'passed':
            gate_state = 'passed'
        elif status in ('failed', 'error', 'cancelled', 'interrupted'):
            gate_state = status
        else:
            gate_state = 'unknown'
        tests = [test for result in (run.get('results') or []) for test in result.get('observation', {}).get('tests', [])]
        gates.append({'suite_profile_id': required.suite_profile_id, 'mandatory': required.mandatory, 'gate_status': gate_state,
                      'execution_id': str(entry.execution_id), 'repository_revision': metadata.get('revision'),
                      'target_revision': metadata.get('targetRevision'), 'age_seconds': age_seconds,
                      'test_statuses': sorted({test['attempts'][-1]['status'] for test in tests if test.get('attempts')})})
    return gates


@operation('resolve_release_evidence_artifacts', 'Read pinned coverage and finding artifacts by exact content hash; incomplete or non-terminal artifacts are not evidence.', dependencies=('read_pinned_workflow_artifact',))
async def resolve_artifacts(value, store=None):
    from .handoff import read_artifact
    coverage = None
    if value.coverage_artifact:
        result, reference = await read_artifact(value.coverage_artifact, value.coverage_artifact.producer, store)
        coverage = {'reference': reference, 'data': result['data']}
    findings = []
    for pin in value.finding_artifacts:
        result, reference = await read_artifact(pin, pin.producer, store)
        findings.append({'reference': reference, 'state': result['data'].get('state')})
    return coverage, findings


@operation('evaluate_exit_criteria', 'Combine fresh gate evidence, pinned coverage and finding artifacts into explicit unmet gates and a recommendation; never authorizes a release.')
def evaluate(value, policy, policy_hash, gates, coverage, findings):
    unmet = []
    for gate in gates:
        if gate['mandatory'] and gate['gate_status'] != 'passed':
            unmet.append({'kind': 'suite', 'suite_profile_id': gate['suite_profile_id'], 'reason': gate['gate_status']})
    coverage_summary = None
    if policy.min_design_coverage_percent is not None:
        if coverage is None:
            unmet.append({'kind': 'coverage', 'reason': 'missing_pinned_coverage_artifact'})
        else:
            percent = coverage['data'].get('design_coverage_percent')
            coverage_summary = {'design_coverage_percent': percent,
                                'uncovered_criterion_ids': coverage['data'].get('uncovered_criterion_ids', []),
                                'stale_execution_ids': coverage['data'].get('stale_execution_ids', [])}
            if percent is None or percent < policy.min_design_coverage_percent:
                unmet.append({'kind': 'coverage', 'reason': 'below_threshold', 'observed_percent': percent, 'required_percent': policy.min_design_coverage_percent})
    open_findings = [item for item in findings if item['state'] != 'not_reproduced']
    if len(open_findings) > policy.max_open_findings:
        unmet.append({'kind': 'findings', 'reason': 'open_finding_count', 'observed': len(open_findings), 'allowed': policy.max_open_findings})
    incomplete_gates = [gate['suite_profile_id'] for gate in gates if gate['mandatory'] and gate['gate_status'] in ('pending', 'unexecuted', 'stale', 'revision_mismatch', 'unknown')]
    incomplete = bool(incomplete_gates) or (policy.min_design_coverage_percent is not None and coverage is None)
    recommendation = 'incomplete_evidence' if incomplete else ('not_ready' if unmet else 'ready')
    return {'schema_version': 1, 'recommendation': recommendation, 'profile_id': value.profile_id, 'policy_hash': policy_hash,
            'candidate_revision': value.candidate_revision, 'gates': gates, 'unmet_gates': unmet, 'incomplete_gates': incomplete_gates,
            'coverage': coverage_summary, 'findings': [{'request_id': item['reference']['artifact_id'], 'state': item['state']} for item in findings],
            'open_finding_count': len(open_findings), 'max_open_findings': policy.max_open_findings,
            'release_authorized': False,
            'summary': {'ready': 'All mandatory gates passed at the candidate revision within configured policy limits.',
                        'not_ready': 'One or more configured gates are unmet at the candidate revision.',
                        'incomplete_evidence': 'Mandatory evidence is missing, pending, stale or revision-mismatched; no ready/not_ready recommendation is produced.'}[recommendation],
            'basis': 'Fresh, owned suite jobs and pinned coverage/finding artifacts read at this instant; evidence older than the configured TTL is treated as stale.',
            'limitations': ['A recommendation is not a release authorization; a platform/user decision remains separate.',
                             'Coverage reflects designed cases per criterion, not executed or evidenced coverage.',
                             'Finding state reflects the pinned investigation outcome at read time, not an independently re-verified fix.',
                             'Failed, skipped, blocked, cancelled and unexecuted scope remains visible in gates and is never silently excluded.']}


def create_release_graph(skill, capabilities):
    from langgraph.graph import END, StateGraph
    from .graphs import SkillState, failure

    def resolve(state):
        try:
            value = ReleaseInput.model_validate(state['request']['inputs'])
            policy, policy_hash = resolve_policy(value.profile_id)
            return {'prepared': {'policy': policy.model_dump(mode='json'), 'policy_hash': policy_hash},
                    'trace': ['resolve_release_inputs'], 'model_calls': 0}
        except Exception as error:
            return {**failure(error), 'trace': ['resolve_release_inputs'], 'model_calls': 0}

    async def collect(state):
        if state.get('error'): return {}
        try:
            value = ReleaseInput.model_validate(state['request']['inputs'])
            policy = ReleasePolicy.model_validate(state['prepared']['policy'])
            prepared = dict(state['prepared'])
            prepared['gates'] = await capabilities.resolve_release_evidence(policy, value)
            prepared['coverage'], prepared['findings'] = await capabilities.resolve_release_artifacts(value)
            return {'prepared': prepared, 'trace': state['trace'] + ['collect_evidence']}
        except Exception as error:
            return {**failure(error), 'trace': state['trace'] + ['collect_evidence']}

    def finalize(state):
        if state.get('error'): return {}
        try:
            value = ReleaseInput.model_validate(state['request']['inputs'])
            policy, policy_hash = resolve_policy(value.profile_id)
            if policy_hash != state['prepared']['policy_hash']:
                raise SkillBlocked('Release policy changed during assessment')
            data = evaluate(value, policy, policy_hash, state['prepared']['gates'], state['prepared']['coverage'], state['prepared']['findings'])
            return {'status': 'completed', 'data': data, 'trace': state['trace'] + ['evaluate_exit_criteria']}
        except Exception as error:
            return {**failure(error), 'trace': state['trace'] + ['evaluate_exit_criteria']}
    graph = StateGraph(SkillState)
    graph.add_node('resolve_release_inputs', resolve)
    graph.add_node('collect_evidence', collect)
    graph.add_node('evaluate_exit_criteria', finalize)
    graph.set_entry_point('resolve_release_inputs')
    graph.add_edge('resolve_release_inputs', 'collect_evidence')
    graph.add_edge('collect_evidence', 'evaluate_exit_criteria')
    graph.add_edge('evaluate_exit_criteria', END)
    return graph.compile()
