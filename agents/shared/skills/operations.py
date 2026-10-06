"""Executable workflow operations and their declared composition.

These are internal tool bindings, not unrestricted model-callable endpoints.
Metadata is registered beside executable code; workflow scopes enforce the same
dependency list exposed by discovery. Traces never include arguments or results.
"""
import asyncio
import inspect
from contextlib import contextmanager
from contextvars import ContextVar
from dataclasses import dataclass
from functools import wraps
from typing import Callable, Tuple


@dataclass(frozen=True)
class Operation:
    name: str
    description: str
    invoke: Callable
    dependencies: Tuple[str, ...]


_operations = {}
_scope = ContextVar("qa_operation_scope", default=None)


@contextmanager
def operation_scope(names, trace):
    token = _scope.set((frozenset(names), trace))
    try:
        yield
    finally:
        _scope.reset(token)


@contextmanager
def record(name):
    scope = _scope.get()
    if scope is None:
        yield
        return
    allowed, trace = scope
    if name not in allowed:
        raise RuntimeError("Workflow used an undeclared operation: " + name)
    entry = {"name": name, "status": "running"}
    trace.append(entry)
    try:
        yield
    except asyncio.CancelledError:
        entry["status"] = "interrupted"
        raise
    except Exception:
        entry["status"] = "failed"
        raise
    else:
        entry["status"] = "completed"


def operation(name, description, dependencies=()):
    def register(fn):
        if name in _operations:
            raise ValueError("Duplicate operation: " + name)
        if inspect.iscoroutinefunction(fn):
            @wraps(fn)
            async def bound(*args, **kwargs):
                with record(name):
                    return await fn(*args, **kwargs)
        else:
            @wraps(fn)
            def bound(*args, **kwargs):
                with record(name):
                    return fn(*args, **kwargs)
        _operations[name] = Operation(name, description, bound, tuple(dependencies))
        return bound
    return register


def resolve_operations(names):
    # Import bindings lazily: registration must not depend on the skill registry.
    from . import analysis, api_testing, investigation, maintenance, regression, release, capabilities, datasets, handoff, readiness, repository, suites  # noqa: F401
    from shared.mcp.agent_browser import client  # noqa: F401
    found = {}

    def visit(name, ancestors):
        if name in ancestors:
            raise ValueError("Cyclic operation dependency: " + name)
        if name in found:
            return
        item = _operations[name]  # Missing executable bindings fail discovery.
        for dependency in item.dependencies:
            visit(dependency, ancestors | {name})
        found[name] = item

    for name in names:
        visit(name, set())
    return list(found.values())
