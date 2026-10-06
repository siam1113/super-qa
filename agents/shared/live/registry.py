"""In-memory registry of live (in-progress) QAE browser executions.

Lets a websocket viewer attach to a running Playwright-driven test execution
and watch it as it happens: CDP screencast frames, step/action progress,
console logs and network requests. Everything here is process-local; a run
is only "live" while the agents service process that started it is up.
"""
import asyncio
import logging
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Dict, List, Optional, Set

logger = logging.getLogger(__name__)

EVICT_GRACE_SECONDS = 60
SUBSCRIBER_QUEUE_SIZE = 200


@dataclass
class LiveSession:
    """Live state for a single execution, fanned out to any attached viewers."""
    run_id: str
    test_id: str
    test_name: str
    status: str = "running"
    started_at: datetime = field(default_factory=datetime.now)
    completed_at: Optional[datetime] = None
    steps: List[Dict[str, Any]] = field(default_factory=list)
    console_logs: List[Dict[str, Any]] = field(default_factory=list)
    network_requests: List[Dict[str, Any]] = field(default_factory=list)
    latest_frame: Optional[str] = None
    subscribers: Set[asyncio.Queue] = field(default_factory=set)

    def summary(self) -> Dict[str, Any]:
        return {
            "runId": self.run_id,
            "testId": self.test_id,
            "testName": self.test_name,
            "status": self.status,
            "startedAt": self.started_at.isoformat(),
        }

    def backlog(self) -> Dict[str, Any]:
        return {
            "type": "backlog",
            "runId": self.run_id,
            "testId": self.test_id,
            "testName": self.test_name,
            "status": self.status,
            "steps": self.steps,
            "consoleLogs": self.console_logs[-200:],
            "networkRequests": self.network_requests[-200:],
            "latestFrame": self.latest_frame,
        }


class LiveExecutionRegistry:
    """Process-wide registry of live executions. Use get_live_registry()."""

    def __init__(self) -> None:
        self._sessions: Dict[str, LiveSession] = {}

    def create(self, run_id: str, test_id: str, test_name: str) -> LiveSession:
        """Idempotent: a caller (e.g. the HTTP endpoint that hands back the runId)
        may register the session before the execution itself gets around to it, so
        a viewer connecting right after receiving the runId never races the run's
        own async setup. Returning the existing session instead of replacing it
        preserves any subscribers that attached in between."""
        existing = self._sessions.get(run_id)
        if existing:
            return existing
        session = LiveSession(run_id=run_id, test_id=test_id, test_name=test_name)
        self._sessions[run_id] = session
        logger.info(f"Live session created: {run_id} ({test_name})")
        return session

    def get(self, run_id: str) -> Optional[LiveSession]:
        return self._sessions.get(run_id)

    def list_active(self) -> List[Dict[str, Any]]:
        return [session.summary() for session in self._sessions.values() if session.status == "running"]

    def publish(self, run_id: str, event: Dict[str, Any]) -> None:
        session = self._sessions.get(run_id)
        if not session:
            return

        event_type = event.get("type")
        if event_type == "step":
            session.steps = event.get("steps", session.steps)
        elif event_type == "console":
            session.console_logs.append(event["log"])
        elif event_type == "network":
            session.network_requests.append(event["request"])
        elif event_type == "frame":
            session.latest_frame = event["dataUrl"]

        for queue in list(session.subscribers):
            try:
                queue.put_nowait(event)
            except asyncio.QueueFull:
                if event_type != "frame":
                    logger.warning(f"Dropping event for slow live viewer on {run_id}: {event_type}")

    def complete(self, run_id: str, status: str) -> None:
        session = self._sessions.get(run_id)
        if not session:
            return
        session.status = status
        session.completed_at = datetime.now()
        self.publish(run_id, {"type": "status", "runId": run_id, "status": status})
        asyncio.create_task(self._evict_after(run_id, EVICT_GRACE_SECONDS))

    async def _evict_after(self, run_id: str, seconds: int) -> None:
        await asyncio.sleep(seconds)
        self._sessions.pop(run_id, None)

    def subscribe(self, run_id: str) -> Optional[asyncio.Queue]:
        session = self._sessions.get(run_id)
        if not session:
            return None
        queue: asyncio.Queue = asyncio.Queue(maxsize=SUBSCRIBER_QUEUE_SIZE)
        session.subscribers.add(queue)
        return queue

    def unsubscribe(self, run_id: str, queue: asyncio.Queue) -> None:
        session = self._sessions.get(run_id)
        if session:
            session.subscribers.discard(queue)


_registry: Optional[LiveExecutionRegistry] = None


def get_live_registry() -> LiveExecutionRegistry:
    global _registry
    if _registry is None:
        _registry = LiveExecutionRegistry()
    return _registry
