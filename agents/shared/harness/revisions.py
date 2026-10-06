"""Bounded revision evidence shared by API and repository workers."""
import base64
import json
import re
from pydantic import model_validator
from shared.skills.contracts import Contract
from .live import safe_path


def valid_pointer(value):
    return isinstance(value, str) and len(value) <= 300 and (value == '' or bool(re.fullmatch(r'/(?:[^~]|~[01])*', value)))


def pointer_value(document, pointer):
    value = document
    if pointer:
        for part in pointer[1:].split('/'):
            part = part.replace('~1', '/').replace('~0', '~')
            if isinstance(value, list) and re.fullmatch(r'0|[1-9][0-9]*', part):
                value = value[int(part)]
            elif isinstance(value, dict):
                value = value[part]
            else:
                raise KeyError('Pointer unavailable')
    return value


class RevisionProbe(Contract):
    path: str
    pointer: str

    @model_validator(mode='after')
    def valid(self):
        if not safe_path(self.path) or '{' in self.path or not valid_pointer(self.pointer):
            raise ValueError('Invalid revision probe')
        return self


def decode(response):
    raw = base64.b64decode(response['body'], validate=True)
    if len(raw) > 65536:
        raise ValueError('JSON response exceeds its budget')
    return json.loads(raw, parse_constant=lambda _: (_ for _ in ()).throw(ValueError('Non-JSON scalar')))


def read_revision(probe, transport):
    response = transport.request('GET', probe.path)
    actual = pointer_value(decode(response), probe.pointer)
    if response['status'] != 200 or not isinstance(actual, str) or not 1 <= len(actual) <= 200:
        raise ValueError('Target revision unavailable')
    return actual
