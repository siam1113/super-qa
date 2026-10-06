"""Evidence-based investigation with an optional single durable reproduction job."""
import hashlib
import json
from typing import Optional
from uuid import UUID
from pydantic import Field, model_validator
from .contracts import Contract, SkillBlocked
from .operations import operation
from .scope import current_scope
from .suites import binding_for, call_api, job_result


class InvestigateInput(Contract):
    suite_profile_id: str = Field(pattern=r'^[A-Za-z0-9_-]{1,100}$')
    source_execution_id: UUID
    check_id: str = Field(pattern=r'^[A-Za-z0-9_-]{1,100}$')
    test_id: Optional[str] = Field(default=None, pattern=r'^[a-f0-9]{64}$')
    comparison_execution_id: Optional[UUID] = None
    reproduce: bool = Field(default=False, strict=True)

    @model_validator(mode='after')
    def exclusive(self):
        if self.comparison_execution_id == self.source_execution_id or self.reproduce and self.comparison_execution_id:
            raise ValueError('Choose a distinct comparison job or one reproduction submission')
        return self


def selected_evidence(run, value):
    checks = run.get('snapshot', {}).get('checks', [])
    check = next((item for item in checks if item.get('id') == value.check_id), None)
    if not check or check.get('kind') not in ('api_flow', 'repository'):
        raise SkillBlocked('Investigation currently requires an approved API flow or repository check')
    result = next((item for item in run.get('results') or [] if item.get('checkId') == value.check_id), None)
    if value.test_id and check['kind'] != 'repository':
        raise SkillBlocked('A test_id applies only to repository suites')
    if value.test_id and result:
        observation = dict(result.get('observation', {}))
        observation['tests'] = [item for item in observation.get('tests', []) if item.get('id') == value.test_id]
        if not observation['tests']:
            raise SkillBlocked('Selected repository test is absent from recorded evidence')
        result = {**result, 'observation': observation}
    observation = (result or {}).get('observation', {})
    plan = (run.get('dataset') or {}).get('plan', {})
    revision = observation.get('revisionBefore')
    target_revision = revision if revision and revision == observation.get('revisionAfter') else None
    result_index = next((index for index, item in enumerate(run.get('results') or []) if item.get('checkId') == value.check_id), None)
    # Only approved response selections are retained; request bodies, credentials and fixtures are omitted.
    return {'execution_id': run['id'], 'request_id': run['requestId'], 'suite_id': run['suiteId'],
            'job_status': run['status'], 'check_id': value.check_id, 'test_id': value.test_id,
            'kind': check['kind'], 'manifest_hash': run['snapshot']['manifestHash'],
            'profile_hash': check['profileHash'], 'target_revision': target_revision,
            'repository_revision': observation.get('revision'), 'fixture_hash': plan.get('fixture_hash'),
            'dataset_artifact': {key: run['dataset'][key] for key in ('requestId', 'contentHash')} if run.get('dataset') else None,
            'result': result, 'cleanup': run.get('cleanupReceipt'),
            'evidence': {'job_id': run['id'], 'pointer': '/results/' + str(result_index) if result_index is not None else None, 'artifact_hash': observation.get('artifactHash') or None}}


@operation('collect_failure_evidence', 'Read a scoped durable job and preserve selected check observations, revision context and evidence pointers.', dependencies=('resolve_suite_profile',))
async def collect(value, execution_id):
    binding = binding_for(value.suite_profile_id)
    run = await call_api(binding, 'GET', '/runs/' + str(execution_id))
    if run.get('projectId') != str(binding.project_id) or run.get('suiteId') != str(binding.suite_id):
        raise SkillBlocked('Execution belongs to another suite binding')
    return selected_evidence(run, value)


@operation('queue_reproduction_attempt', 'Queue at most one new job using the source approved suite and the same published fixture artifact.', dependencies=('resolve_suite_profile',))
async def reproduce(value, source, request_id):
    if not current_scope().can_execute:
        raise SkillBlocked('This app assignment cannot start a reproduction')
    if request_id == source['request_id']:
        raise SkillBlocked('Reproduction requires a new request UUID; it must not resolve to the source job')
    binding = binding_for(value.suite_profile_id)
    descriptor = await call_api(binding, 'GET', '/suites/' + str(binding.suite_id))
    suite = descriptor.get('suite', {})
    checks = suite.get('checks', [])
    if descriptor.get('projectId') != str(binding.project_id) or not suite.get('approvedBy') or suite.get('manifestHash') != source['manifest_hash'] or len(checks) != 1 or checks[0].get('profileHash') != source['profile_hash'] or source['profile_hash'] != binding.profile_hash:
        raise SkillBlocked('Source suite revision is no longer approved by this binding')
    body = {'requestId': request_id, 'suiteId': str(binding.suite_id)}
    if source['dataset_artifact']:
        body.update(datasetRequestId=source['dataset_artifact']['requestId'], datasetContentHash=source['dataset_artifact']['contentHash'])
    return job_result(await call_api(binding, 'POST', '/runs', body), value.suite_profile_id)


def failure_signature(source):
    result = source['result'] or {}
    if result.get('status') != 'failed': return None
    if source['kind'] == 'api_flow':
        failures = [{'step': step['id'], 'status': step.get('actualStatus'), 'assertions': sorted(item['id'] for item in step.get('assertions', []) if not item.get('passed'))} for step in result.get('steps', []) if step.get('status') == 'failed']
    else:
        failures = sorted((test['id'], test['attempts'][-1]['status']) for test in result.get('observation', {}).get('tests', []) if test.get('attempts') and test['attempts'][-1]['status'] in ('failed', 'timedOut'))
    if not failures: return None
    return hashlib.sha256(json.dumps(failures, sort_keys=True).encode()).hexdigest()


@operation('compare_failure_evidence', 'Compare immutable observations only when profile, target revision and fixture context match; keep root cause unproven.')
def assemble(source, comparison=None, queued=None):
    state = 'insufficient_evidence'
    blockers = []
    signature = failure_signature(source)
    if queued:
        state = 'pending'
    elif comparison:
        if comparison['job_status'] in ('queued', 'running'):
            state = 'pending'
        else:
            for key in ('suite_id', 'manifest_hash', 'profile_hash', 'fixture_hash', 'repository_revision', 'target_revision'):
                if source.get(key) != comparison.get(key): blockers.append(key + ' differs')
            if not source.get('target_revision') or not comparison.get('target_revision'):
                blockers.append('Observed app revision is unavailable; strict reproduction cannot be established')
            if blockers: state = 'incomparable'
            elif signature and signature == failure_signature(comparison): state = 'reproduced'
            elif signature and (comparison['result'] or {}).get('status') == 'passed': state = 'not_reproduced'
            elif (comparison['result'] or {}).get('status') == 'failed':
                state = 'different_failure'
            else: state = 'blocked'
    elif not signature:
        blockers.append('Recorded evidence does not establish the selected assertion failure')
    else:
        blockers.append('A separate completed reproduction attempt is required')
    data = {'schema_version': 1, 'state': state, 'source': source, 'comparison': comparison,
            'failure_fingerprint': signature, 'blockers': blockers, 'root_cause': 'unproven',
            'classification': 'assertion_mismatch' if signature else 'infrastructure_or_missing_evidence',
            'summary': {'reproduced': 'The same assertion failure was observed in a separate job with matching revision and fixture context.',
                        'not_reproduced': 'The comparison job passed with matching revision and fixture context. This does not establish a fix.',
                        'pending': 'A reproduction job is queued or running. Poll it, then investigate again with comparison_execution_id.',
                        'different_failure': 'The comparison job failed at different assertions; the original failure is not confirmed.',
                        'incomparable': 'Execution contexts differ or are incomplete; reproduction cannot be established.',
                        'blocked': 'The comparison job lacks complete assertion evidence.',
                        'insufficient_evidence': 'Source observations are recorded; reproduction and product root cause are not established.'}[state],
            'next_actions': ['Review the cited assertion observations and approved expectations.', 'Keep environment or cleanup errors separate from product defects.']}
    if queued: data.update(job=queued['job'], execution=queued['execution'], suite_profile_id=queued['suite_profile_id'])
    return data


def create_investigation_graph(skill, capabilities):
    from langgraph.graph import END, StateGraph
    from .graphs import SkillState, failure

    async def gather(state):
        try:
            value = InvestigateInput.model_validate(state['request']['inputs'])
            source = await capabilities.collect_failure(value, value.source_execution_id)
            if source['job_status'] in ('queued', 'running') or not source['result'] or source['result'].get('status') not in ('failed', 'error'):
                raise SkillBlocked('Choose a completed job check with recorded failure or error evidence')
            if value.test_id and not failure_signature(source):
                raise SkillBlocked('The selected repository test has no recorded terminal failure')
            return {'prepared': {'source': source}, 'trace': ['collect_source'], 'model_calls': 0}
        except Exception as error:
            return {**failure(error), 'trace': ['collect_source'], 'model_calls': 0}

    async def comparison(state):
        if state.get('error'): return {}
        try:
            value = InvestigateInput.model_validate(state['request']['inputs'])
            prepared = dict(state['prepared'])
            if value.reproduce:
                prepared['queued'] = await capabilities.reproduce_failure(value, prepared['source'], state['request']['request_id'])
            elif value.comparison_execution_id:
                prepared['comparison'] = await capabilities.collect_failure(value, value.comparison_execution_id)
            return {'prepared': prepared, 'trace': state['trace'] + ['resolve_comparison']}
        except Exception as error:
            return {**failure(error), 'trace': state['trace'] + ['resolve_comparison']}

    def finalize(state):
        if state.get('error'): return {}
        try:
            data = assemble(**state['prepared'])
            return {'status': 'completed', 'data': data, 'trace': state['trace'] + ['assemble_finding']}
        except Exception as error:
            return {**failure(error), 'trace': state['trace'] + ['assemble_finding']}
    graph = StateGraph(SkillState)
    graph.add_node('collect_source', gather)
    graph.add_node('resolve_comparison', comparison)
    graph.add_node('assemble_finding', finalize)
    graph.set_entry_point('collect_source')
    graph.add_edge('collect_source', 'resolve_comparison')
    graph.add_edge('resolve_comparison', 'assemble_finding')
    graph.add_edge('assemble_finding', END)
    return graph.compile()
