"""Admission to approved API sequences; the durable worker owns HTTP execution."""
from typing import Optional
from pydantic import Field
from .contracts import Contract, SkillBlocked
from .operations import operation
from .scope import current_scope
from .suites import DatasetArtifactPin, binding_for, call_api, job_result


class TestApiInput(Contract):
    suite_profile_id: str = Field(pattern=r'^[A-Za-z0-9_-]{1,100}$')
    expected_target_revision: str = Field(min_length=1, max_length=200)
    dataset_artifact: Optional[DatasetArtifactPin] = None


@operation('enqueue_api_sequence', 'Resolve an approved API sequence and pinned app revision, then enqueue one durable job.', dependencies=('resolve_suite_profile',))
async def submit(value, request_id):
    if not current_scope().can_execute:
        raise SkillBlocked('This app assignment cannot start execution')
    binding = binding_for(value.suite_profile_id)
    descriptor = await call_api(binding, 'GET', '/suites/' + str(binding.suite_id))
    suite = descriptor.get('suite', {})
    profiles = descriptor.get('apiProfiles', [])
    if descriptor.get('projectId') != str(binding.project_id) or not suite.get('approvedBy') or len(suite.get('checks', [])) != 1 or suite['checks'][0].get('kind') != 'api_flow' or suite['checks'][0].get('profileHash') != binding.profile_hash or len(profiles) != 1 or profiles[0].get('targetRevision') != value.expected_target_revision:
        raise SkillBlocked('API suite approval, app binding or pinned target revision does not match')
    body = {'requestId': request_id, 'suiteId': str(binding.suite_id)}
    if value.dataset_artifact:
        body.update(datasetRequestId=str(value.dataset_artifact.request_id), datasetContentHash=value.dataset_artifact.content_hash)
    return job_result(await call_api(binding, 'POST', '/runs', body), value.suite_profile_id)


def create_api_graph(skill, capabilities):
    from langgraph.graph import END, StateGraph
    from .graphs import SkillState, failure

    async def admission(state):
        try:
            value = TestApiInput.model_validate(state['request']['inputs'])
            data = await capabilities.submit_api(value, state['request']['request_id'])
            return {'status': 'completed', 'data': data, 'model_calls': 0, 'trace': ['admit_api_sequence']}
        except Exception as error:
            return {**failure(error), 'model_calls': 0, 'trace': ['admit_api_sequence']}
    graph = StateGraph(SkillState)
    graph.add_node('admit_api_sequence', admission)
    graph.set_entry_point('admit_api_sequence')
    graph.add_edge('admit_api_sequence', END)
    return graph.compile()
