"""Approved, bounded API sequences with explicit observations and dataset cleanup."""
import hashlib
import json
import math
import os
from pathlib import Path
import re
from typing import Dict, List, Literal, Optional
from urllib.parse import urlsplit
from uuid import UUID

from pydantic import ConfigDict, Field, model_validator

from shared.skills.contracts import Contract
from .autonomy import json_scalar
from .revisions import RevisionProbe, pointer_value, valid_pointer, decode, read_revision
from .live import Transport, safe_path
from .repository import RepositoryJournal, acquire_dataset, release_dataset, namespace_for


class ResponseShape(Contract):
    type: Literal['object', 'array', 'string', 'number', 'integer', 'boolean', 'null']
    properties: Dict[str, 'ResponseShape'] = Field(default_factory=dict)
    required: List[str] = Field(default_factory=list, max_length=30)
    additionalProperties: bool = Field(default=True, strict=True)
    items: Optional['ResponseShape'] = None
    minItems: int = Field(default=0, ge=0, le=1000)
    maxItems: int = Field(default=1000, ge=0, le=1000)
    minLength: int = Field(default=0, ge=0, le=2000)
    maxLength: int = Field(default=2000, ge=0, le=2000)

    @model_validator(mode='after')
    def bounded(self):
        if len(self.properties) > 30 or len(set(self.required)) != len(self.required) or not set(self.required) <= set(self.properties) or self.minItems > self.maxItems or self.minLength > self.maxLength:
            raise ValueError('Invalid bounded response schema')
        return self


ResponseShape.model_rebuild()


def bounded_json(value):
    def inspect(item, depth=0):
        if depth > 12: raise ValueError('JSON nesting exceeds evidence budget')
        if type(item) in (int, float) and (abs(item) > 9007199254740991 or not math.isfinite(item)):
            raise ValueError('JSON number exceeds interoperable range')
        if isinstance(item, dict):
            for child in item.values(): inspect(child, depth + 1)
        elif isinstance(item, list):
            for child in item: inspect(child, depth + 1)
    inspect(value)
    if len(json.dumps(value, ensure_ascii=True, allow_nan=False).encode()) > 2048:
        raise ValueError('Selected response value exceeds evidence budget')
    return value


class Assertion(Contract):
    model_config = ConfigDict(extra='forbid', str_strip_whitespace=False)
    id: str = Field(pattern=r'^[A-Za-z0-9_-]{1,60}$')
    pointer: str = ''
    expected: object = None
    response_schema: Optional[ResponseShape] = Field(default=None, alias='schema')

    @model_validator(mode='after')
    def oracle(self):
        if not valid_pointer(self.pointer) or ('expected' in self.model_fields_set) == (self.response_schema is not None):
            raise ValueError('Each assertion needs a pointer and exactly one expected value or bounded schema')
        if self.response_schema is None:
            bounded_json(self.expected)
        else:
            def check_depth(shape, depth=0):
                if depth > 6: raise ValueError('Response schema nesting exceeds budget')
                for child in shape.properties.values(): check_depth(child, depth + 1)
                if shape.items: check_depth(shape.items, depth + 1)
            check_depth(self.response_schema)
        return self


class ApiStep(Contract):
    model_config = ConfigDict(extra='forbid', str_strip_whitespace=False)
    id: str = Field(pattern=r'^[A-Za-z0-9_-]{1,60}$')
    method: Literal['GET', 'POST', 'PUT', 'PATCH', 'DELETE']
    path: str = Field(max_length=1000)
    auth: Literal['configured', 'anonymous'] = 'configured'
    body: Optional[dict] = None
    expectedStatus: int = Field(ge=200, le=599, strict=True)
    assertions: List[Assertion] = Field(default_factory=list, max_length=4)
    captures: Dict[str, str] = Field(default_factory=dict)

    @model_validator(mode='after')
    def structure(self):
        substituted = re.sub(r'\{[A-Za-z][A-Za-z0-9_]{0,49}\}', 'value', self.path)
        if not safe_path(substituted) or self.method == 'GET' and self.body is not None or 300 <= self.expectedStatus < 400:
            raise ValueError('Invalid scoped API request')
        if len({item.id for item in self.assertions}) != len(self.assertions) or len(self.captures) > 4 or any(not re.fullmatch(r'[A-Za-z][A-Za-z0-9_]{0,49}', key) or key == 'namespace' or not valid_pointer(pointer) for key, pointer in self.captures.items()):
            raise ValueError('Invalid assertion or capture identity')
        if len(json.dumps(self.body, allow_nan=False).encode()) > 16000:
            raise ValueError('Request body exceeds its budget')
        return self


class ApiProfile(Contract):
    projectId: UUID
    environment: Literal['test', 'staging']
    origin: str
    targetRevision: str = Field(min_length=1, max_length=200)
    revisionProbe: RevisionProbe
    datasetProfileHash: Optional[str] = Field(default=None, pattern=r'^[a-f0-9]{64}$')
    datasetOrigin: Optional[str] = None
    steps: List[ApiStep] = Field(min_length=1, max_length=6)

    @model_validator(mode='after')
    def scope(self):
        parsed = urlsplit(self.origin)
        if parsed.scheme != 'https' or not parsed.hostname or parsed.username or parsed.password or parsed.path or parsed.query or parsed.fragment:
            raise ValueError('Configured HTTPS origin required')
        if bool(self.datasetProfileHash) != bool(self.datasetOrigin) or self.datasetOrigin not in (None, self.origin):
            raise ValueError('Dataset must belong to the same approved origin')
        if len({step.id for step in self.steps}) != len(self.steps):
            raise ValueError('Step IDs must be unique')
        available = {'namespace'} if self.datasetProfileHash else set()
        for step in self.steps:
            refs = set(re.findall(r'\{([A-Za-z][A-Za-z0-9_]{0,49})\}', step.path))
            if not refs <= available or step.method != 'GET' and (not self.datasetProfileHash or step.path.count('{namespace}') != 1 or '{namespace}' not in step.path.split('/')):
                raise ValueError('Mutations require a dataset namespace; paths may use only earlier captures')
            def inspect(value, depth=0):
                if depth > 6:
                    raise ValueError('Request body nesting budget exceeded')
                if isinstance(value, dict):
                    if '$capture' in value:
                        if set(value) != {'$capture'} or not isinstance(value['$capture'], str) or value['$capture'] not in available:
                            raise ValueError('Unknown request capture')
                    elif '$fixture' in value:
                        if set(value) != {'$fixture'} or not self.datasetProfileHash or not valid_pointer(value['$fixture']):
                            raise ValueError('Invalid fixture reference')
                    else:
                        for child in value.values(): inspect(child, depth + 1)
                elif isinstance(value, list):
                    for child in value: inspect(child, depth + 1)
            inspect(step.body)
            if available & set(step.captures):
                raise ValueError('Captures cannot overwrite prior values')
            available |= set(step.captures)
        if len(json.dumps(self.model_dump(mode='json', exclude_unset=True, by_alias=True)).encode()) > 24000:
            raise ValueError('API profile exceeds its budget')
        return self


def load_profile(profile_hash):
    path = Path(json.loads(os.getenv('AUTONOMY_API_PROFILE_PATHS', '{}'))[profile_hash])
    if not path.is_absolute() or not path.is_file():
        raise ValueError('Configured API profile file required')
    with path.open('rb') as source:
        raw = source.read(24001)
    if len(raw) > 24000 or hashlib.sha256(raw).hexdigest() != profile_hash:
        raise ValueError('API profile hash mismatch')
    return ApiProfile.model_validate_json(raw)


def public_profile(profile):
    return {'projectId': str(profile.projectId), 'environment': profile.environment, 'origin': profile.origin,
            'targetRevision': profile.targetRevision, 'datasetProfileHash': profile.datasetProfileHash,
            'datasetOrigin': profile.datasetOrigin, 'steps': [{'id': step.id, 'expectedStatus': step.expectedStatus,
            'assertions': [item.model_dump(mode='json', exclude_unset=True, by_alias=True) for item in step.assertions]} for step in profile.steps]}


def shape_matches(value, shape, depth=0):
    if depth > 6: return False
    kind = shape.type
    if kind in ('number', 'integer'):
        matches = type(value) in (int, float) and abs(value) <= 9007199254740991 and math.isfinite(value) and (kind == 'number' or value == int(value))
    else:
        matches = {'object': isinstance(value, dict), 'array': isinstance(value, list), 'string': isinstance(value, str), 'boolean': type(value) is bool, 'null': value is None}[kind]
    if not matches: return False
    if kind == 'object':
        return set(shape.required) <= set(value) and (shape.additionalProperties or set(value) <= set(shape.properties)) and all(key not in value or shape_matches(value[key], child, depth + 1) for key, child in shape.properties.items())
    if kind == 'array':
        return shape.minItems <= len(value) <= shape.maxItems and (shape.items is None or all(shape_matches(item, shape.items, depth + 1) for item in value))
    if kind == 'string': return shape.minLength <= len(value) <= shape.maxLength
    return True


def json_equal(left, right):
    if type(left) in (int, float) and type(right) in (int, float): return left == right
    if type(left) is not type(right): return False
    if isinstance(left, dict): return left.keys() == right.keys() and all(json_equal(left[key], right[key]) for key in left)
    if isinstance(left, list): return len(left) == len(right) and all(json_equal(a, b) for a, b in zip(left, right))
    return left == right


def assertion_matches(assertion, actual):
    if not actual['present']: return False
    if assertion.response_schema:
        return shape_matches(actual['actual'], assertion.response_schema)
    # JSON equality distinguishes booleans from numbers, independent of key order.
    return json_equal(actual['actual'], assertion.expected)


def revision(profile, transport):
    return read_revision(profile.revisionProbe, transport)


def resolve_body(value, captures, fixture):
    if isinstance(value, dict):
        if '$capture' in value: return captures[value['$capture']]
        if '$fixture' in value: return pointer_value(fixture, value['$fixture'])
        return {key: resolve_body(child, captures, fixture) for key, child in value.items()}
    if isinstance(value, list): return [resolve_body(child, captures, fixture) for child in value]
    return value


def execute(check, job, active, api):
    result = {'checkId': check['id'], 'profileHash': check['profileHash'], 'error': 'policy_error',
        'revisionBefore': '', 'revisionAfter': '', 'datasetCleanup': 'not_started', 'artifactHash': '', 'steps': []}
    journal = profile = None
    registered = False
    try:
        profile = load_profile(check['profileHash'])
        if str(profile.projectId) != job['projectId'] or bool(profile.datasetProfileHash) != bool(job.get('dataset')) or not active(): return result
        journal = RepositoryJournal(os.environ['AUTONOMY_API_STATE'])
        if journal.unfinished() or journal.pending(): return result
        journal.register(job, check['profileHash'], kind='api_flow')
        registered = True
        result['datasetCleanup'] = 'pending' if job.get('dataset') else 'not_started'
        result['error'] = 'execution_error'
        api.request('POST', '/runs/' + job['id'] + '/cleanup', {'token': job['token'], 'container': 'not_started', 'dataset': result['datasetCleanup']})
        transport = Transport(profile.origin)
        result['revisionBefore'] = revision(profile, transport)
        if result['revisionBefore'] != profile.targetRevision: raise ValueError('Target revision mismatch')
        captures = {}
        if job.get('dataset'):
            if not active(): raise InterruptedError()
            captures['namespace'] = acquire_dataset(profile, job['dataset']['plan'], job['id'], journal)
        fixture = job['dataset']['plan']['records'] if job.get('dataset') else []
        proceed = True
        result['error'] = ''
        for step in profile.steps:
            observed = {'id': step.id, 'status': 0, 'error': 'not_run', 'assertions': []}
            result['steps'].append(observed)
            if not proceed: continue
            if not active(): raise InterruptedError()
            try:
                def substitute(match):
                    value = captures[match.group(1)]
                    if not isinstance(value, str) or not re.fullmatch(r'[A-Za-z0-9_-]{1,100}', value): raise ValueError('Unsafe captured path segment')
                    return value
                path = re.sub(r'\{([A-Za-z][A-Za-z0-9_]{0,49})\}', substitute, step.path)
                body = resolve_body(step.body, captures, fixture)
                payload = b'' if body is None else json.dumps(body, allow_nan=False).encode()
                response = Transport(profile.origin, credential_mode=step.auth).request(step.method, path, payload, {'content-type': 'application/json'})
                observed['status'] = response['status']
                document = decode(response) if step.assertions or step.captures else None
                observed['error'] = ''
                for assertion in step.assertions:
                    actual = {'id': assertion.id, 'present': False, 'actual': None}
                    try:
                        actual.update(present=True, actual=bounded_json(pointer_value(document, assertion.pointer)))
                    except (KeyError, IndexError, TypeError):
                        pass
                    observed['assertions'].append(actual)
                proceed = observed['status'] == step.expectedStatus and all(assertion_matches(assertion, actual) for assertion, actual in zip(step.assertions, observed['assertions']))
                if proceed:
                    for name, pointer in step.captures.items(): captures[name] = json_scalar(document, pointer)
            except Exception:
                observed['error'] = 'response_or_transport_error'
                proceed = False
        if not active(): raise InterruptedError()
        result['revisionAfter'] = revision(profile, transport)
    except InterruptedError:
        result['error'] = 'cancelled'
    except Exception:
        if not result['error']: result['error'] = 'execution_error'
    finally:
        if registered:
            if job.get('dataset'):
                result['datasetCleanup'] = 'clean' if release_dataset(profile, job['id'], journal) else 'pending'
            if result['datasetCleanup'] == 'pending': result['error'] = 'cleanup_error'
            raw = json.dumps({key: value for key, value in result.items() if key != 'artifactHash'}, sort_keys=True, allow_nan=False).encode()
            result['artifactHash'] = hashlib.sha256(raw).hexdigest()
            path = journal.directory / (result['artifactHash'] + '.json')
            if not path.exists():
                with path.open('xb') as output:
                    path.chmod(0o600); output.write(raw); output.flush(); os.fsync(output.fileno())
            journal.receipt(job['id'], 'not_started', result['datasetCleanup'])
            journal.save_completion(job, result, field='apiFlowObservations')
            try:
                api.request('POST', '/runs/' + job['id'] + '/cleanup', {'token': job['token'], 'container': 'not_started', 'dataset': result['datasetCleanup']})
                journal.receipt(job['id'], 'not_started', result['datasetCleanup'], True)
            except Exception: pass
        if journal: journal.close()
    return result


def recover(api):
    if not os.getenv('AUTONOMY_API_STATE'): return True
    from .repository import recover as recover_journal
    return recover_journal(api, directory=os.environ['AUTONOMY_API_STATE'])


def main():
    import argparse
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('path', type=Path)
    args = parser.parse_args()
    with args.path.open('rb') as source: raw = source.read(24001)
    if len(raw) > 24000: raise ValueError('Profile exceeds budget')
    print(json.dumps({hashlib.sha256(raw).hexdigest(): public_profile(ApiProfile.model_validate_json(raw))}, indent=2))


if __name__ == '__main__':
    main()
