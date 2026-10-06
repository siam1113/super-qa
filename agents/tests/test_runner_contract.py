import unittest
from unittest.mock import AsyncMock, Mock, patch

from qae.harness.state import ExecutionState, ExecutionStatus, StepStatus
from shared.runner.models import RunStatus
from shared.runner.service import TestRunnerService


class RunnerContractTests(unittest.IsolatedAsyncioTestCase):
    async def test_missing_test_returns_error_without_simulation(self):
        runner = TestRunnerService()
        runner._find_test_file = Mock(return_value=None)
        runner._simulate_test_execution = AsyncMock()
        with patch("shared.runner.service.MCP_HARNESS_AVAILABLE", False):
            result = await runner._execute_single_test("missing", "local", "chromium")
        self.assertEqual(result.status, RunStatus.ERROR)
        runner._simulate_test_execution.assert_not_called()
        runner.executor.shutdown(wait=False)

    async def test_runner_passes_fetched_spec_and_maps_real_state_fields(self):
        runner = TestRunnerService()
        spec = {"id": "test", "steps": [{"tool": "expect_visible", "arguments": {"selector": "#login"}}]}
        state = ExecutionState.create("test", "Login", "local")
        state.add_step("Verify login", "assertion")
        state.complete_step(0, StepStatus.PASSED)
        state.complete(ExecutionStatus.PASSED)
        state.all_screenshots = ["evidence.png"]
        state.all_console_logs = [{"text": "ready"}]
        orchestrator = Mock()
        orchestrator.execute_test = AsyncMock(return_value=state)
        client = AsyncMock()
        client.get.return_value = Mock(status_code=200, json=Mock(return_value=spec))
        client.__aenter__.return_value = client
        with patch("shared.runner.service.get_orchestrator", return_value=orchestrator), patch("httpx.AsyncClient", return_value=client):
            result = await runner._execute_via_mcp("test", "local", "chromium")
        self.assertIsNotNone(result)
        orchestrator.execute_test.assert_awaited_once_with(test_spec=spec, environment="local", browser="chromium", trace_level="action")
        self.assertEqual(result.status, RunStatus.PASSED)
        self.assertEqual(result.screenshots, ["evidence.png"])
        self.assertEqual(result.console_log_count, 1)
        self.assertEqual(result.steps[0].trace_id, state.steps[0].step_id)
        runner.executor.shutdown(wait=False)

    async def test_backend_failure_does_not_dispatch_a_second_execution_engine(self):
        runner = TestRunnerService()
        runner._find_test_file = Mock()
        client = AsyncMock()
        client.get.side_effect = RuntimeError("backend unavailable")
        client.__aenter__.return_value = client
        with patch("shared.runner.service.MCP_HARNESS_AVAILABLE", True), patch("shared.runner.service.USE_MCP_EXECUTION", True), patch("httpx.AsyncClient", return_value=client):
            result = await runner._execute_single_test("test", "local", "chromium")
        self.assertEqual(result.status, RunStatus.ERROR)
        self.assertEqual(result.error_message, "backend unavailable")
        runner._find_test_file.assert_not_called()
        runner.executor.shutdown(wait=False)


if __name__ == "__main__":
    unittest.main()
