"""Synthetic fixture plans. Namespaced leases belong to the execution worker."""
import hashlib
import json
import os
from pathlib import Path
from typing import Dict, List, Literal, Optional

from pydantic import ConfigDict, Field, model_validator

from .contracts import Contract, SkillBlocked
from .operations import operation
from .scope import require_resource


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, ensure_ascii=True, separators=(",", ":")).encode()).hexdigest()


class FixtureField(Contract):
    model_config = ConfigDict(extra='forbid', str_strip_whitespace=False)
    kind: Literal['constant', 'integer', 'choice', 'identifier']
    value: Optional[str] = Field(default=None, max_length=200)
    minimum: Optional[int] = Field(default=None, ge=-1000000, le=1000000, strict=True)
    maximum: Optional[int] = Field(default=None, ge=-1000000, le=1000000, strict=True)
    choices: List[str] = Field(default_factory=list, max_length=30)

    @model_validator(mode='after')
    def arguments(self):
        if self.kind == 'constant' and self.value is None:
            raise ValueError('Constant fields require a value')
        if self.kind == 'integer' and (self.minimum is None or self.maximum is None or self.minimum > self.maximum):
            raise ValueError('Integer fields require ordered bounds')
        if self.kind == 'choice' and (not self.choices or any(len(item) > 200 for item in self.choices)):
            raise ValueError('Choice fields require bounded values')
        return self


class DatasetProfile(Contract):
    environment: Literal['test', 'staging']
    origin: str
    lease_path: str
    records: int = Field(ge=1, le=100, strict=True)
    fields: Dict[str, FixtureField]

    @model_validator(mode='after')
    def protocol(self):
        import re
        from urllib.parse import urlsplit
        from shared.harness.live import safe_path
        origin = urlsplit(self.origin)
        if origin.scheme != 'https' or not origin.hostname or origin.username or origin.password or origin.path or origin.query or origin.fragment:
            raise ValueError('Dataset profile requires an HTTPS origin')
        if not safe_path(self.lease_path) or self.lease_path.count('{namespace}') != 1:
            raise ValueError('Dataset leases require a namespaced endpoint')
        if not 1 <= len(self.fields) <= 20 or any(not re.fullmatch(r'[A-Za-z][A-Za-z0-9_]{0,49}', name) for name in self.fields):
            raise ValueError('Supply 1–20 named fixture fields')
        return self


class PrepareDataInput(Contract):
    profile_id: str = Field(pattern=r'^[A-Za-z0-9_-]{1,100}$')
    seed: int = Field(ge=0, le=2147483647, strict=True)


class DatasetPlan(Contract):
    schema_version: Literal[1] = 1
    state: Literal['prepared'] = 'prepared'
    profile_id: str = Field(pattern=r'^[A-Za-z0-9_-]{1,100}$')
    profile_hash: str = Field(pattern=r'^[a-f0-9]{64}$')
    environment: Literal['test', 'staging']
    seed: int = Field(ge=0, le=2147483647, strict=True)
    records: List[dict] = Field(min_length=1, max_length=100)
    fixture_hash: str = Field(pattern=r'^[a-f0-9]{64}$')
    lease: None = None
    provisioning: Literal['on_job_claim'] = 'on_job_claim'
    execution_authorized: Literal[False] = False


def load_dataset_profile(path):
    file = Path(path)
    if not file.is_absolute() or not file.is_file():
        raise SkillBlocked('Dataset profile must be an operator-configured file')
    with file.open('rb') as source:
        raw = source.read(32001)
    if len(raw) > 32000:
        raise SkillBlocked('Dataset profile exceeds its budget')
    return DatasetProfile.model_validate_json(raw), hashlib.sha256(raw).hexdigest()


@operation('resolve_dataset_blueprint', 'Resolve an operator-configured synthetic data blueprint within the current app scope.')
def resolve_blueprint(profile_id):
    require_resource('dataset_profiles', profile_id)
    paths = json.loads(os.getenv('QA_DATASET_PROFILES', '{}'))
    path = paths.get(profile_id) if isinstance(paths, dict) else None
    if not isinstance(path, str):
        raise SkillBlocked('Dataset profile is not configured')
    return load_dataset_profile(path)


@operation('generate_fixture_values', 'Generate reproducible synthetic values using explicit blueprint bounds and a seed; no target mutation occurs.')
def generate_values(profile, profile_hash, seed):
    records = []
    for index in range(profile.records):
        record = {}
        for name, field in sorted(profile.fields.items()):
            token = digest(['qa-fixture-v1', profile_hash, seed, index, name])
            number = int(token, 16)
            if field.kind == 'constant':
                value = field.value
            elif field.kind == 'integer':
                value = field.minimum + number % (field.maximum - field.minimum + 1)
            elif field.kind == 'choice':
                value = field.choices[number % len(field.choices)]
            else:
                value = 'qa-' + str(index) + '-' + token[:20]
            record[name] = value
        records.append(record)
    if len(json.dumps(records).encode()) > 48000:
        raise SkillBlocked('Generated fixture exceeds the 48 KB budget')
    return records


def create_dataset_graph(skill, capabilities):
    from langgraph.graph import StateGraph, END
    from .graphs import SkillState, failure

    def prepare(state):
        try:
            value = PrepareDataInput.model_validate(state['request']['inputs'])
            profile, hashed = resolve_blueprint(value.profile_id)
            return {'payload': value.model_dump(), 'prepared': {'profile': profile.model_dump(), 'hash': hashed}, 'trace': ['resolve_blueprint'], 'model_calls': 0}
        except Exception as error:
            return {**failure(error), 'trace': ['resolve_blueprint'], 'model_calls': 0}

    def generate(state):
        try:
            value = PrepareDataInput.model_validate(state['payload'])
            profile = DatasetProfile.model_validate(state['prepared']['profile'])
            records = generate_values(profile, state['prepared']['hash'], value.seed)
            plan = DatasetPlan(profile_id=value.profile_id, profile_hash=state['prepared']['hash'], environment=profile.environment,
                seed=value.seed, records=records, fixture_hash=digest(records))
            return {'data': plan.model_dump(mode='json'), 'status': 'completed', 'trace': state['trace'] + ['generate_fixture', 'finalize']}
        except Exception as error:
            return {**failure(error), 'trace': state['trace'] + ['generate_fixture']}

    graph = StateGraph(SkillState)
    graph.add_node('resolve_blueprint', prepare)
    graph.add_node('generate_fixture', generate)
    graph.set_entry_point('resolve_blueprint')
    graph.add_conditional_edges('resolve_blueprint', lambda state: END if state.get('error') else 'generate_fixture', {END: END, 'generate_fixture': 'generate_fixture'})
    graph.add_edge('generate_fixture', END)
    return graph.compile()
