import unittest
from types import SimpleNamespace

from qae.harness.executor import MCPClient, RetryPolicy, TestExecutor
from qae.harness.grounded_step import REPORT_STEP_RESULT
from qae.harness.interpreter import MCPToolCall, ParsedStep
from qae.harness.state import ExecutionState, ExecutionStatus


def _tool_call(name, args=None):
    return {"id": f"call-{name}", "name": name, "args": args or {}}


def _report(passed, actual_result="observed", reason=None):
    return _tool_call(REPORT_STEP_RESULT, {"passed": passed, "actual_result": actual_result, "reason": reason})


class FakeLLM:
    """Deterministic stand-in for TestExecutor's grounded-step model: one scripted
    list of turns per test step, each turn the single tool call the "model" makes
    in response to that step's latest observation."""

    def __init__(self, step_scripts):
        self._steps = [list(turns) for turns in step_scripts]
        self._current = None

    def bind_tools(self, tools):
        self._current = self._steps.pop(0)
        return self

    async def ainvoke(self, messages):
        turn = self._current.pop(0)
        return SimpleNamespace(tool_calls=turn, usage_metadata=None)


class ExecutionVerdictTests(unittest.IsolatedAsyncioTestCase):
    async def run_steps(self, steps, results, stop_on_failure=True, script=None):
        state = ExecutionState.create("test", "Verdict regression", "local")
        client = MCPClient("page")

        async def tool(**arguments):
            return results.pop(0)

        for step in steps:
            state.add_step(step.description, step.step_type, step.expected_result)
            for call in step.tool_calls:
                client.register_tool(call.tool_name, tool)
        executor = TestExecutor(client, RetryPolicy(max_retries=0), llm=FakeLLM(script or []))
        return await executor.execute_all_steps(state, steps, stop_on_failure)

    def assertion(self):
        return ParsedStep(1, "Verify account", "assertion", [MCPToolCall("expect_visible", {"selector": "#account"})])

    async def test_uninterpretable_step_cannot_pass(self):
        step = ParsedStep(1, "Do something unsupported", "action")
        script = [[[_report(False, reason="could not interpret the step")]]]
        result = await self.run_steps([step], [], script=script)
        self.assertNotEqual(result.status, ExecutionStatus.PASSED)

    async def test_empty_test_cannot_pass(self):
        result = await self.run_steps([], [])
        self.assertEqual(result.status, ExecutionStatus.ERROR)

    async def test_failure_is_preserved_when_continuing(self):
        script = [
            [[_tool_call("expect_visible", {"selector": "#account"})], [_report(False, reason="not visible")]],
            [[_tool_call("expect_visible", {"selector": "#account"})], [_report(True, actual_result="visible")]],
        ]
        result = await self.run_steps([self.assertion(), self.assertion()],
                                      [{"status": "failed"}, {"status": "success"}], False, script=script)
        self.assertEqual(result.status, ExecutionStatus.FAILED)

    async def test_timeout_cannot_pass(self):
        script = [[[_tool_call("expect_visible", {"selector": "#account"})], [_report(False, reason="timed out")]]]
        result = await self.run_steps([self.assertion()], [{"status": "timeout"}], script=script)
        self.assertNotEqual(result.status, ExecutionStatus.PASSED)

    async def test_missing_tool_status_cannot_pass(self):
        script = [[[_tool_call("expect_visible", {"selector": "#account"})], [_report(False, reason="unclear result")]]]
        result = await self.run_steps([self.assertion()], [{}], script=script)
        self.assertNotEqual(result.status, ExecutionStatus.PASSED)

    async def test_actions_without_an_oracle_cannot_pass(self):
        step = ParsedStep(1, "Click login", "action", [MCPToolCall("click", {"selector": "#login"})])
        script = [[[_tool_call("click", {"selector": "#login"})], [_report(True, actual_result="Clicked login")]]]
        result = await self.run_steps([step], [{"status": "success"}], script=script)
        self.assertEqual(result.status, ExecutionStatus.ERROR)

    async def test_executed_assertion_can_pass_without_inventing_an_observation(self):
        step = self.assertion()
        step.expected_result = "Customer has been charged exactly once"
        script = [[[_tool_call("expect_visible", {"selector": "#account"})],
                   [_report(True, actual_result="Account panel became visible")]]]
        result = await self.run_steps([step], [{"status": "success"}], script=script)
        self.assertEqual(result.status, ExecutionStatus.PASSED)
        self.assertNotEqual(result.steps[0].actual_result, step.expected_result)


if __name__ == "__main__":
    unittest.main()
