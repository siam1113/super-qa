"""Regression test for the "Connecting to browser view... / Waiting for
steps..." hang.

POST /executions/run used to return a runId the instant the background task
was scheduled, before the orchestrator had done any of the async backend
round-trips (environment config, business context) it does prior to calling
live.create(). A frontend that opens the live websocket the moment it gets
that runId could therefore race the orchestrator and arrive before the live
session existed. /executions/{run_id}/live has no wait/retry for that case -
it answers "not_found" and closes immediately. The browser's own reconnect
loop is bounded (5 attempts, capped backoff), so under real backend latency
the viewer could exhaust its retries before the session was ever created and
be left permanently stuck with no steps and no frame.

Fix: run_execution now registers the live session itself, synchronously,
before the HTTP response goes out - closing the race window at its source
instead of making the websocket side guess how long to wait.
"""
import asyncio
import unittest
from unittest.mock import AsyncMock, patch

import main
from shared.live import get_live_registry


class FakeWebSocket:
    def __init__(self):
        self.accepted = False
        self.sent = []
        self.closed = False

    async def accept(self):
        self.accepted = True

    async def send_json(self, payload):
        self.sent.append(payload)

    async def close(self):
        self.closed = True


class FakeOrchestrator:
    """Stands in for TestOrchestrator.execute_test: awaits something slow
    (representing the real _fetch_environment_config / _fetch_business_context
    HTTP round-trips) before registering the run as live."""

    def __init__(self, delay: float):
        self.delay = delay

    async def execute_test(self, test_spec, environment, browser, run_id=None):
        await asyncio.sleep(self.delay)
        live = get_live_registry()
        live.create(run_id, test_spec.get("id", "test"), test_spec.get("name", "Test"))
        live.complete(run_id, "passed")


class FakeResponse:
    def __init__(self, status_code=200, payload=None):
        self.status_code = status_code
        self._payload = payload or {}

    def raise_for_status(self):
        pass

    def json(self):
        return self._payload


class FakeAsyncClient:
    def __init__(self, *args, **kwargs):
        pass

    async def __aenter__(self):
        return self

    async def __aexit__(self, *args):
        return False

    async def get(self, *args, **kwargs):
        return FakeResponse(200, {"id": "test-1", "name": "Agent race test", "steps": [{"action": "a", "expected": "b"}]})


class LiveExecutionRaceTests(unittest.TestCase):
    def setUp(self):
        get_live_registry()._sessions.clear()

    def test_websocket_connecting_immediately_after_runid_still_gets_backlog(self):
        """This is the race as the frontend actually hits it: runId comes back,
        the viewer opens its websocket right away - before the orchestrator has
        had any chance to reach its own live.create() call (it's still doing
        the environment/business-context round-trips simulated by the 0.2s
        delay below). The viewer must not be told "not_found" for this."""
        orchestrator = FakeOrchestrator(delay=0.2)

        async def scenario():
            with patch("main.httpx.AsyncClient", FakeAsyncClient), \
                 patch("main.get_orchestrator", return_value=orchestrator):
                response = await main.run_execution(main.RunExecutionRequest(testId="test-1"))
                run_id = response["runId"]

                # Frontend connects immediately on receiving the runId, same as
                # ExecutionWizardModal -> onRunStarted -> LiveExecutionViewer does.
                ws = FakeWebSocket()
                with self.assertRaises(asyncio.TimeoutError):
                    await asyncio.wait_for(main.stream_execution(ws, run_id), timeout=0.05)

                # Stay on the same loop long enough for the background task to
                # finish, so setUp's registry isn't left with a dangling session.
                await asyncio.sleep(orchestrator.delay)
                return ws, run_id

        ws, run_id = asyncio.run(scenario())

        self.assertTrue(ws.accepted)
        self.assertFalse(ws.closed)
        self.assertEqual(ws.sent[0]["type"], "backlog")
        self.assertEqual(ws.sent[0]["runId"], run_id)

    def test_websocket_connecting_after_live_create_gets_backlog(self):
        """Sanity check: the same flow succeeds if the viewer happens to connect
        after live.create() has run, confirming the failure above is purely a
        matter of timing, not a broken registry."""
        orchestrator = FakeOrchestrator(delay=0.05)

        async def scenario():
            with patch("main.httpx.AsyncClient", FakeAsyncClient), \
                 patch("main.get_orchestrator", return_value=orchestrator):
                response = await main.run_execution(main.RunExecutionRequest(testId="test-1"))
                run_id = response["runId"]
                await asyncio.sleep(orchestrator.delay + 0.05)

                ws = FakeWebSocket()
                # The real handler then blocks on queue.get() until the run
                # produces another event or the client disconnects; cap the
                # wait since we only care that backlog was sent.
                with self.assertRaises(asyncio.TimeoutError):
                    await asyncio.wait_for(main.stream_execution(ws, run_id), timeout=0.1)
                return ws

        ws = asyncio.run(scenario())

        self.assertEqual(ws.sent[0]["type"], "backlog")


if __name__ == "__main__":
    unittest.main()
