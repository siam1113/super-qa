import unittest

from qae.harness.executor import MCPClient, RetryPolicy, TestExecutor
from qae.harness.interpreter import MCPToolCall, ParsedStep
from qae.harness.state import ExecutionState, ExecutionStatus


class ExecutionVerdictTests(unittest.IsolatedAsyncioTestCase):
    async def run_steps(self, steps, results, stop_on_failure=True):
        state = ExecutionState.create("test", "Verdict regression", "local")
        client = MCPClient("page")

        async def tool(**arguments):
            return results.pop(0)

        for step in steps:
            state.add_step(step.description, step.step_type, step.expected_result)
            for call in step.tool_calls:
                client.register_tool(call.tool_name, tool)
        executor = TestExecutor(client, RetryPolicy(max_retries=0))
        return await executor.execute_all_steps(state, steps, stop_on_failure)

    def assertion(self):
        return ParsedStep(1, "Verify account", "assertion", [MCPToolCall("expect_visible", {"selector": "#account"})])

    async def test_uninterpretable_step_cannot_pass(self):
        result = await self.run_steps([ParsedStep(1, "Do something unsupported", "action")], [])
        self.assertNotEqual(result.status, ExecutionStatus.PASSED)

    async def test_empty_test_cannot_pass(self):
        result = await self.run_steps([], [])
        self.assertEqual(result.status, ExecutionStatus.ERROR)

    async def test_failure_is_preserved_when_continuing(self):
        result = await self.run_steps([self.assertion(), self.assertion()],
                                      [{"status": "failed"}, {"status": "success"}], False)
        self.assertEqual(result.status, ExecutionStatus.FAILED)

    async def test_timeout_cannot_pass(self):
        result = await self.run_steps([self.assertion()], [{"status": "timeout"}])
        self.assertNotEqual(result.status, ExecutionStatus.PASSED)

    async def test_missing_tool_status_cannot_pass(self):
        result = await self.run_steps([self.assertion()], [{}])
        self.assertNotEqual(result.status, ExecutionStatus.PASSED)

    async def test_actions_without_an_oracle_cannot_pass(self):
        step = ParsedStep(1, "Click login", "action", [MCPToolCall("click", {"selector": "#login"})])
        result = await self.run_steps([step], [{"status": "success"}])
        self.assertEqual(result.status, ExecutionStatus.ERROR)

    async def test_executed_assertion_can_pass_without_inventing_an_observation(self):
        step = self.assertion()
        step.expected_result = "Customer has been charged exactly once"
        result = await self.run_steps([step], [{"status": "success"}])
        self.assertEqual(result.status, ExecutionStatus.PASSED)
        self.assertNotEqual(result.steps[0].actual_result, step.expected_result)


if __name__ == "__main__":
    unittest.main()
