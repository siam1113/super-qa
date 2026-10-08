"""Durable workflow artifacts and idempotent invocation, independent of chat history."""
import asyncio
import hashlib
import json
import os
import sqlite3
import time
from functools import lru_cache
from contextlib import contextmanager
from pathlib import Path

from .capabilities import Capabilities
from .contracts import SkillRequest, SkillResult
from .graphs import create_skill_graph
from .registry import get_skill
from .scope import current_scope
from .operations import operation_scope
from .artifacts import publish_pending, seal_result
from ..narration import emit_status


class RequestConflict(ValueError):
    pass


class RunStore:
    def __init__(self, path, scope_identity="local"):
        self.scope_identity = scope_identity
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        with self.connect() as connection:
            connection.execute("CREATE TABLE IF NOT EXISTS skill_runs (id TEXT PRIMARY KEY, request_hash TEXT NOT NULL, result TEXT NOT NULL, expires REAL NOT NULL)")
            connection.execute("CREATE TABLE IF NOT EXISTS artifact_outbox (id TEXT PRIMARY KEY, scope TEXT NOT NULL, role TEXT NOT NULL, skill TEXT NOT NULL, payload TEXT NOT NULL, receipt TEXT, last_attempt REAL NOT NULL DEFAULT 0)")
            columns = {row[1] for row in connection.execute("PRAGMA table_info(artifact_outbox)")}
            if "last_attempt" not in columns:
                connection.execute("ALTER TABLE artifact_outbox ADD COLUMN last_attempt REAL NOT NULL DEFAULT 0")
            if "permanent_failure" not in columns:
                # A structural 400 (malformed envelope/scope) will never succeed no matter
                # how many times it's retried, unlike a 401/404/5xx which can resolve once
                # e.g. the project is created or a signing-key rollout finishes — see
                # publish_pending's distinction by status code.
                connection.execute("ALTER TABLE artifact_outbox ADD COLUMN permanent_failure TEXT")
        self.path.chmod(0o600)

    @contextmanager
    def connect(self):
        connection = sqlite3.connect(str(self.path), timeout=10)
        try:
            with connection:
                yield connection
        finally:
            connection.close()

    def start(self, request):
        encoded = json.dumps(request, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
        digest = hashlib.sha256(encoded.encode()).hexdigest()
        result = SkillResult(request_id=request["request_id"], agent_type=request["agent_type"], skill=request["skill"],
                             status="running", summary="Workflow is running").model_dump()
        with self.connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            existing = connection.execute("SELECT request_hash, result, expires FROM skill_runs WHERE id = ?", (request["request_id"],)).fetchone()
            if existing:
                if existing[0] != digest:
                    raise RequestConflict("request_id was already used with different inputs")
                return False, self.expired(connection, existing[1], existing[2])
            connection.execute("INSERT INTO skill_runs VALUES (?, ?, ?, ?)", (request["request_id"], digest, json.dumps(result), time.time() + 180))
        return True, result

    def expired(self, connection, encoded, expiry):
        result = json.loads(encoded)
        if result["status"] == "running" and expiry <= time.time():
            result.update(status="interrupted", model_calls=None, summary="Run lease expired. Inspect external execution status before submitting a new request.", warnings=["Model usage is unknown after an expired lease"])
            # Legacy rows have no trustworthy scope/provenance envelope. Retain
            # them locally; only newly created invocation records are published.
            payload = None
            if result.get("created_at"):
                result["artifact"], payload = seal_result(result, self.scope_identity)
                result["publication"] = "local" if self.scope_identity == "local" else "pending"
            changed = connection.execute("UPDATE skill_runs SET result = ?, expires = 0 WHERE id = ? AND result = ?", (json.dumps(result), result["request_id"], encoded)).rowcount
            if not changed:
                return json.loads(connection.execute("SELECT result FROM skill_runs WHERE id = ?", (result["request_id"],)).fetchone()[0])
            if payload and self.scope_identity != "local":
                self.enqueue_publication(connection, result, payload)
        return result

    def enqueue_publication(self, connection, result, payload):
        connection.execute("INSERT INTO artifact_outbox (id, scope, role, skill, payload) VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING",
            (result["request_id"], self.scope_identity, result["agent_type"], result["skill"], payload))

    def finish(self, result):
        result = SkillResult.model_validate(result).model_dump(mode="json")
        if len(json.dumps(result, ensure_ascii=False).encode()) > 1400000:
            result.update(status="failed", data={}, summary="Workflow output exceeded its artifact budget")
        result["artifact"], payload = seal_result(result, self.scope_identity)
        result["publication"] = "local" if self.scope_identity == "local" else "pending"
        with self.connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            previous = connection.execute("SELECT result FROM skill_runs WHERE id = ?", (result["request_id"],)).fetchone()
            if previous and json.loads(previous[0])["status"] != "running":
                return json.loads(previous[0])
            connection.execute("UPDATE skill_runs SET result = ?, expires = 0 WHERE id = ?", (json.dumps(result, ensure_ascii=False), result["request_id"]))
            if self.scope_identity != "local":
                self.enqueue_publication(connection, result, payload)
        return result

    def pending_publications(self, limit=10):
        with self.connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            rows = connection.execute("SELECT id, scope, role, skill, payload FROM artifact_outbox WHERE receipt IS NULL AND permanent_failure IS NULL ORDER BY last_attempt, rowid LIMIT ?", (limit,)).fetchall()
            connection.executemany("UPDATE artifact_outbox SET last_attempt = ? WHERE id = ?", [(time.time(), row[0]) for row in rows])
            return rows

    def publication_count(self):
        with self.connect() as connection:
            return connection.execute("SELECT count(*) FROM artifact_outbox WHERE receipt IS NULL AND permanent_failure IS NULL").fetchone()[0]

    def record_publication(self, request_id, receipt):
        with self.connect() as connection:
            connection.execute("UPDATE artifact_outbox SET receipt = ? WHERE id = ? AND receipt IS NULL", (json.dumps(receipt), request_id))

    def record_publication_failure(self, request_id, reason):
        """Stop retrying a row the backend has permanently rejected (e.g. a malformed
        scope/envelope) — unlike a 401/404/5xx, a 400 here can never succeed on retry."""
        with self.connect() as connection:
            connection.execute("UPDATE artifact_outbox SET permanent_failure = ? WHERE id = ? AND receipt IS NULL", (reason[:500], request_id))

    def get(self, request_id, role):
        with self.connect() as connection:
            row = connection.execute("SELECT result, expires FROM skill_runs WHERE id = ?", (str(request_id),)).fetchone()
            if row is None:
                return None
            result = self.expired(connection, *row)
            if result["agent_type"] != role:
                return None
            receipt = connection.execute("SELECT receipt FROM artifact_outbox WHERE id = ?", (str(request_id),)).fetchone()
            if receipt and receipt[0]:
                result["publication"] = "published"
            return result


class SkillRuntime:
    def __init__(self, store, capabilities=None):
        self.store = store
        self.capabilities = capabilities or Capabilities(store)
        self.graphs = {}

    def graph(self, name, role):
        skill = get_skill(name, role)
        if name not in self.graphs:
            self.graphs[name] = create_skill_graph(skill, self.capabilities)
        return self.graphs[name]

    async def run(self, request, graph=None):
        request = SkillRequest.model_validate(request).model_dump(mode="json")
        if len(json.dumps(request).encode()) > 256000:
            raise ValueError("Skill request exceeds the 256 KB input budget")
        skill = get_skill(request["skill"], request["agent_type"])
        if skill.requires_execution and not current_scope().can_execute:
            raise ValueError("This app assignment cannot start execution or external writes")
        graph = graph if graph is not None else self.graph(request["skill"], request["agent_type"])
        operation_names = [item.name for item in skill.operations]
        claimed, result = self.store.start(request)
        if not claimed:
            return result
        state = {"request": request}
        tool_trace = []
        result["tool_trace"] = tool_trace

        async def invoke():
            with operation_scope(operation_names, tool_trace):
                emit_status(f"Loading {skill.name.replace('_', ' ')} skill…", skill=skill.name)
                async for updates in graph.astream(state, config={"recursion_limit": 16}):
                    for node_name, update in updates.items():
                        state.update(update)
                        emit_status(node_name.replace('_', ' ').capitalize(), skill=skill.name, node=node_name)

        try:
            await asyncio.wait_for(invoke(), timeout=120)
            result.update(status=state.get("status", "failed"), data=state.get("data", {}),
                          summary=state.get("error") or "Workflow artifact produced; inspect its data for QA outcomes",
                          model_calls=state.get("model_calls", 0), trace=state.get("trace", []))
            if isinstance(result["data"].get("job"), dict):
                result["jobs"] = [result["data"]["job"]]
            if state.get("model_calls"):
                result["warnings"] = ["Model-authored content is an unverified proposal requiring review"]
        except asyncio.CancelledError:
            result.update(status="interrupted", model_calls=None, trace=state.get("trace", []), summary="Invocation interrupted; inspect external execution status before retrying",
                          warnings=["Model usage may be unknown for an interrupted call"])
            self.store.finish(result)
            raise
        except Exception as error:
            result.update(status="failed", summary="Workflow interrupted (" + type(error).__name__ + ")",
                          trace=state.get("trace", []), model_calls=None,
                          warnings=["Inspect external execution status before retrying; model usage may be unknown"])
        result = self.store.finish(result)
        # Publication has its own durable outbox; it never replays the workflow.
        try:
            await publish_pending(self.store, limit=1)
        except Exception:
            pass  # The durable result/outbox remains available for publication recovery.
        return self.store.get(request["request_id"], request["agent_type"]) or result


@lru_cache(maxsize=128)
def _scoped_runtime(path, identity):
    if identity != "local":
        original = Path(path)
        path = original.parent / (original.stem + "-" + hashlib.sha256(identity.encode()).hexdigest() + original.suffix)
    return SkillRuntime(RunStore(path, scope_identity=identity))


def workflow_db_path():
    return os.getenv("QA_WORKFLOW_DB") or str(Path(__file__).resolve().parents[2] / ".qa-workflows" / "runs.sqlite3")


def get_runtime():
    return _scoped_runtime(workflow_db_path(), current_scope().identity)
