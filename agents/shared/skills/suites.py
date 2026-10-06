"""Scoped admission to the existing durable autonomy queue."""
import json
import os
from typing import Literal, Optional
from urllib.parse import urlsplit
from uuid import UUID

import httpx
from pydantic import Field

from .contracts import Contract, ExecutionJobReference, SkillBlocked
from .operations import operation
from .scope import current_scope, require_resource


class SuiteBinding(Contract):
    project_id: UUID
    suite_id: UUID
    profile_hash: str = Field(pattern=r'^[a-f0-9]{64}$')
    project_key_env: str = Field(pattern=r'^[A-Z][A-Z0-9_]{0,99}$')


class DatasetArtifactPin(Contract):
    request_id: UUID
    content_hash: str = Field(pattern=r'^[a-f0-9]{64}$')


class SuiteInput(Contract):
    suite_profile_id: str = Field(pattern=r'^[A-Za-z0-9_-]{1,100}$')
    expected_repository_revision: str = Field(pattern=r'^[a-f0-9]{40}$')
    dataset_artifact: Optional[DatasetArtifactPin] = None
    expected_target_revision: Optional[str] = Field(default=None, min_length=1, max_length=200)


class JobInput(Contract):
    execution_id: UUID
    provider: Literal['browser_harness', 'autonomy'] = 'browser_harness'
    suite_profile_id: Optional[str] = Field(default=None, pattern=r'^[A-Za-z0-9_-]{1,100}$')


@operation('resolve_suite_profile', 'Resolve an approved suite binding and its project credential reference within the current app scope.')
def binding_for(profile_id):
    if not profile_id:
        raise SkillBlocked('Autonomy job lookup requires suite_profile_id')
    require_resource('automation_suites', profile_id)
    bindings = json.loads(os.getenv('QA_AUTOMATION_SUITES', '{}'))
    if not isinstance(bindings, dict) or profile_id not in bindings:
        raise SkillBlocked('Automation suite binding is not configured')
    binding = SuiteBinding.model_validate(bindings[profile_id])
    if current_scope().identity not in ('local', str(binding.project_id)):
        raise SkillBlocked('Suite binding belongs to another app')
    return binding


async def call_api(binding, method, path, body=None):
    key = os.getenv(binding.project_key_env, '')
    if not key.startswith('sq_') or len(key) != 67:
        raise SkillBlocked('Suite project credential is unavailable')
    base = os.getenv('BACKEND_API_URL', 'http://localhost:4000/api').rstrip('/')
    parsed = urlsplit(base)
    if parsed.scheme != 'https' and not (parsed.scheme == 'http' and parsed.hostname in ('localhost', '127.0.0.1', '::1')):
        raise SkillBlocked('Suite credentials require HTTPS except on loopback')
    async with httpx.AsyncClient(timeout=15, follow_redirects=False, trust_env=False) as client:
        response = await client.request(method, base + '/autonomy' + path, json=body, headers={'Authorization': 'Bearer ' + key})
        if response.status_code >= 400:
            raise SkillBlocked('Suite control plane rejected the request (HTTP ' + str(response.status_code) + '); check approval, publication, quota and worker credentials')
        return response.json()


def job_result(run, profile_id):
    status = run.get('status')
    if status not in ('queued', 'running', 'cancelled', 'interrupted', 'passed', 'failed', 'error'):
        raise SkillBlocked('Suite control plane returned an unsupported job state')
    job = ExecutionJobReference(job_id=run['id'], provider='autonomy',
        state=status if status in ('queued', 'running', 'cancelled', 'interrupted') else 'completed',
        verdict=status if status in ('passed', 'failed', 'error') else None, source_status=status)
    # Per-attempt observations are in the durable job; never synthesize a verdict.
    return {'job': job.model_dump(mode='json'), 'suite_profile_id': profile_id,
            'execution': {key: run.get(key) for key in ('id', 'suiteId', 'status', 'deadline', 'results', 'cleanupReceipt')},
            'verdict_origin': 'autonomy_control_plane', 'note': 'Poll get_execution_job with provider=autonomy and this suite_profile_id. Invocation completion is not test success.'}


@operation('submit_suite_job', 'Validate an approved repository suite and enqueue its durable job with an unchanged request UUID.', dependencies=('resolve_suite_profile',))
async def submit(value, request_id):
    if not current_scope().can_execute:
        raise SkillBlocked('This app assignment cannot start execution')
    binding = binding_for(value.suite_profile_id)
    descriptor = await call_api(binding, 'GET', '/suites/' + str(binding.suite_id))
    suite = descriptor.get('suite', {})
    profiles = descriptor.get('repositoryProfiles', [])
    if descriptor.get('projectId') != str(binding.project_id) or not suite.get('approvedBy') or len(suite.get('checks', [])) != 1 or suite['checks'][0].get('kind') != 'repository' or suite['checks'][0].get('profileHash') != binding.profile_hash or len(profiles) != 1 or profiles[0].get('revision') != value.expected_repository_revision:
        raise SkillBlocked('Suite approval, project binding or pinned repository revision does not match')
    if profiles[0].get('targetRevision') != value.expected_target_revision:
        raise SkillBlocked('Supply the exact target revision for an instrumented suite; legacy suites cannot verify a target revision')
    body = {'requestId': request_id, 'suiteId': str(binding.suite_id)}
    if value.dataset_artifact:
        body.update(datasetRequestId=str(value.dataset_artifact.request_id), datasetContentHash=value.dataset_artifact.content_hash)
    run = await call_api(binding, 'POST', '/runs', body)
    return job_result(run, value.suite_profile_id)


@operation('read_suite_job', 'Read current execution attempts and cleanup state from an owned durable suite job.', dependencies=('resolve_suite_profile',))
async def status(value):
    binding = binding_for(value.suite_profile_id)
    run = await call_api(binding, 'GET', '/runs/' + str(value.execution_id))
    if run.get('projectId') != str(binding.project_id) or run.get('suiteId') != str(binding.suite_id):
        raise SkillBlocked('Execution belongs to another suite binding')
    return job_result(run, value.suite_profile_id)


@operation('cancel_suite_job', 'Cancel an owned durable suite job; worker cleanup remains visible separately.', dependencies=('read_suite_job',))
async def cancel(value):
    if not current_scope().can_execute:
        raise SkillBlocked('This app assignment cannot cancel execution')
    await status(value)
    binding = binding_for(value.suite_profile_id)
    run = await call_api(binding, 'POST', '/runs/' + str(value.execution_id) + '/cancel', {})
    return job_result(run, value.suite_profile_id)


def create_suite_graph(skill, capabilities):
    from langgraph.graph import END, StateGraph
    from .graphs import SkillState, failure

    async def admission(state):
        try:
            value = SuiteInput.model_validate(state['request']['inputs'])
            data = await capabilities.submit_suite(value, state['request']['request_id'])
            return {'status': 'completed', 'data': data, 'model_calls': 0, 'trace': ['validate_input', 'resolve_approved_suite', 'submit_job', 'finalize']}
        except Exception as error:
            return {**failure(error), 'model_calls': 0, 'trace': ['validate_input', 'submit_job']}
    graph = StateGraph(SkillState)
    graph.add_node('admit_suite', admission)
    graph.set_entry_point('admit_suite')
    graph.add_edge('admit_suite', END)
    return graph.compile()
