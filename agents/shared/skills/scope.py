"""Trusted invocation scope, inherited by async tool calls and never set by model arguments."""
import json
import os
from contextlib import contextmanager
from contextvars import ContextVar
from dataclasses import dataclass

from .contracts import SkillBlocked


@dataclass(frozen=True)
class Scope:
    identity: str
    can_execute: bool = True


_scope = ContextVar("qa_workflow_scope", default=Scope(""))


def current_scope():
    scope = _scope.get()
    if scope is None:
        raise SkillBlocked("Workflow tools require signed app scope or a trusted CLI/MCP/HTTP invocation")
    return scope if scope.identity else Scope(os.getenv("QA_WORKFLOW_SCOPE") or "local")


@contextmanager
def workflow_scope(identity, can_execute=True):
    token = _scope.set(Scope(identity, can_execute) if identity else None)
    try:
        yield
    finally:
        _scope.reset(token)


def resources():
    scope = current_scope()
    configured = json.loads(os.getenv("QA_WORKFLOW_RESOURCES", "{}"))
    result = configured.get(scope.identity, {}) if isinstance(configured, dict) else {}
    if not isinstance(result, dict):
        raise SkillBlocked("App workflow resource configuration is invalid")
    return result


def require_resource(kind, identity):
    if current_scope().identity == "local":
        return
    allowed = resources().get(kind, [])
    if not isinstance(allowed, list) or identity not in allowed:
        raise SkillBlocked("This resource is not configured for the current app")


def available_resources(role):
    scope = current_scope()
    allowed = resources() if scope.identity != "local" else None
    result = {}
    for kind, variable in (("repositories", "QA_REPOSITORIES"), ("browser_targets", "HARNESS_BROWSER_TARGETS"), ("readiness_profiles", "QA_READINESS_PROFILES"), ("requirement_profiles", "QA_REQUIREMENT_PROFILES"), ("dataset_profiles", "QA_DATASET_PROFILES"), ("automation_suites", "QA_AUTOMATION_SUITES"), ("regression_profiles", "QA_REGRESSION_PROFILES"), ("release_policies", "QA_RELEASE_POLICIES")):
        if kind == "repositories" and role != "aue":
            continue
        configured = json.loads(os.getenv(variable, "{}"))
        identities = set(configured) if isinstance(configured, dict) else set()
        if kind == "browser_targets":
            live = json.loads(os.getenv("QA_BROWSER_TARGETS", "{}"))
            if isinstance(live, dict):
                identities |= set(live)
        if allowed is not None:
            identities &= set(allowed.get(kind, []))
        result[kind] = sorted(identities)
    return {**result, "can_start_browser_work": scope.can_execute}
