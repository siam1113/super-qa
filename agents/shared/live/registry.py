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
from uuid import uuid4

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
    pending_question: Optional[Dict[str, Any]] = None
    pending_answer: Optional["asyncio.Future[str]"] = field(default=None, repr=False)

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
            "pendingQuestion": self.pending_question,
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
        elif event_type == "question":
            session.pending_question = {"questionId": event["questionId"], "prompt": event["prompt"]}
        elif event_type == "question_resolved":
            session.pending_question = None

        for queue in list(session.subscribers):
            try:
                queue.put_nowait(event)
            except asyncio.QueueFull:
                if event_type != "frame":
                    logger.warning(f"Dropping event for slow live viewer on {run_id}: {event_type}")

    async def ask(self, run_id: str, prompt: str, timeout: float = 30) -> Optional[str]:
        """Pause and ask a live viewer for guidance (e.g. the crawl hit something it
        can't resolve on its own). Returns the viewer's answer, or None if no one
        answers within `timeout` seconds — callers must have a sensible default for
        that case, since a live viewer is never guaranteed to be watching."""
        session = self._sessions.get(run_id)
        if not session:
            return None
        question_id = uuid4().hex
        future: "asyncio.Future[str]" = asyncio.get_event_loop().create_future()
        session.pending_answer = future
        self.publish(run_id, {"type": "question", "questionId": question_id, "prompt": prompt})
        try:
            return await asyncio.wait_for(future, timeout=timeout)
        except asyncio.TimeoutError:
            return None
        finally:
            session.pending_answer = None
            self.publish(run_id, {"type": "question_resolved", "questionId": question_id})

    def answer(self, run_id: str, question_id: str, text: str) -> bool:
        session = self._sessions.get(run_id)
        if not session or not session.pending_question or session.pending_question.get("questionId") != question_id:
            return False
        if session.pending_answer and not session.pending_answer.done():
            session.pending_answer.set_result(text)
            return True
        return False

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
