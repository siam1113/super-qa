"""Test Executor - Executes MCP tool calls sequentially or in parallel."""
import asyncio
import logging
from dataclasses import dataclass
from datetime import datetime
from typing import Optional, Dict, Any, List, Callable, Awaitable

from .state import ExecutionState, StepState, StepStatus, ActionRecord
from .interpreter import MCPToolCall, ParsedStep

logger = logging.getLogger(__name__)


@dataclass
class RetryPolicy:
    """Configuration for retry behavior."""
    max_retries: int = 3
    retry_delay_ms: int = 1000
    exponential_backoff: bool = True
    retry_on_timeout: bool = True
    retry_on_element_not_found: bool = True
    retryable_errors: List[str] = None

    def __post_init__(self):
        if self.retryable_errors is None:
            self.retryable_errors = [
                "timeout",
                "element not found",
                "not visible",
                "not attached",
                "detached",
            ]


class MCPClient:
    """Client interface for calling MCP tools."""

    def __init__(self, page_id: str):
        self.page_id = page_id
        self._tool_registry: Dict[str, Callable[..., Awaitable[Dict[str, Any]]]] = {}

    def register_tool(self, name: str, func: Callable[..., Awaitable[Dict[str, Any]]]) -> None:
        """Register an MCP tool function."""
        self._tool_registry[name] = func

    async def call_tool(self, tool_name: str, arguments: Dict[str, Any]) -> Dict[str, Any]:
        """Call an MCP tool and return the result."""
        if tool_name not in self._tool_registry:
            raise ValueError(f"Unknown tool: {tool_name}")

        # Add page_id to arguments if not present
        if "page_id" not in arguments:
            arguments["page_id"] = self.page_id

        func = self._tool_registry[tool_name]
        return await func(**arguments)


class TestExecutor:
    """
    Executes test steps via MCP tool calls.

    Supports:
    - Sequential step execution
    - Retry policies for flaky actions
    - Before/after screenshots at configurable levels
    - Progress callbacks
    """

    def __init__(
        self,
        mcp_client: MCPClient,
        retry_policy: Optional[RetryPolicy] = None,
        on_step_start: Optional[Callable[[StepState], None]] = None,
        on_step_complete: Optional[Callable[[StepState], None]] = None,
        on_action_complete: Optional[Callable[[ActionRecord], None]] = None,
    ):
        self.mcp = mcp_client
        self.retry_policy = retry_policy or RetryPolicy()
        self.on_step_start = on_step_start
        self.on_step_complete = on_step_complete
        self.on_action_complete = on_action_complete

    async def execute_step(
        self,
        state: ExecutionState,
        step_index: int,
        parsed_step: ParsedStep,
    ) -> StepState:
        """
        Execute a single test step.

        Args:
            state: Current execution state
            step_index: Index of the step in the state
            parsed_step: Parsed step with tool calls

        Returns:
            Updated StepState after execution
        """
        # Start the step
        step = state.start_step(step_index)
        if not step:
            raise ValueError(f"Invalid step index: {step_index}")

        if self.on_step_start:
            self.on_step_start(step)

        logger.info(f"Executing step {step.step_number}: {step.description}")

        try:
            # Execute each tool call in the step
            for tool_call in parsed_step.tool_calls:
                action = await self._execute_tool_call(state, step_index, tool_call)

                if action.status in ["failed", "error"]:
                    # Step failed - stop executing remaining tool calls
                    state.complete_step(
                        step_index,
                        StepStatus.FAILED,
                        error=action.error_message,
                    )
                    break
            else:
                # All tool calls succeeded
                state.complete_step(
                    step_index,
                    StepStatus.PASSED,
                    actual_result=parsed_step.expected_result or "Step completed successfully",
                )

        except Exception as e:
            logger.error(f"Step {step.step_number} failed with exception: {e}")
            state.complete_step(
                step_index,
                StepStatus.ERROR,
                error=str(e),
            )

        if self.on_step_complete:
            self.on_step_complete(step)

        return step

    async def _execute_tool_call(
        self,
        state: ExecutionState,
        step_index: int,
        tool_call: MCPToolCall,
    ) -> ActionRecord:
        """Execute a single MCP tool call with retry logic."""
        action = state.add_action_to_step(
            step_index,
            tool_call.tool_name,
            selector=tool_call.arguments.get("selector"),
            arguments=tool_call.arguments,
        )

        if not action:
            raise ValueError("Failed to add action to step")

        last_error = None
        retries = 0

        while retries <= self.retry_policy.max_retries:
            try:
                logger.debug(f"Executing {tool_call.tool_name} (attempt {retries + 1})")

                result = await self.mcp.call_tool(
                    tool_call.tool_name,
                    tool_call.arguments,
                )

                # Check if the result indicates failure
                status = result.get("status", "success")
                if status in ["failed", "error", "timeout"]:
                    error_msg = result.get("errorMessage", "Unknown error")

                    # Check if we should retry
                    if self._should_retry(error_msg, retries):
                        retries += 1
                        delay = self._calculate_delay(retries)
                        logger.warning(f"Tool call failed, retrying in {delay}ms: {error_msg}")
                        await asyncio.sleep(delay / 1000)
                        continue

                # Update action with result
                action_index = len(state.steps[step_index].actions) - 1
                state.complete_action(step_index, action_index, result)

                if self.on_action_complete:
                    self.on_action_complete(action)

                return action

            except Exception as e:
                last_error = str(e)

                if self._should_retry(last_error, retries):
                    retries += 1
                    delay = self._calculate_delay(retries)
                    logger.warning(f"Tool call failed, retrying in {delay}ms: {last_error}")
                    await asyncio.sleep(delay / 1000)
                else:
                    break

        # All retries exhausted
        action.status = "error"
        action.error_message = last_error or "Max retries exceeded"
        action.completed_at = datetime.now()

        if self.on_action_complete:
            self.on_action_complete(action)

        return action

    def _should_retry(self, error_message: str, current_retries: int) -> bool:
        """Determine if an error should trigger a retry."""
        if current_retries >= self.retry_policy.max_retries:
            return False

        error_lower = error_message.lower()

        # Check against retryable error patterns
        for pattern in self.retry_policy.retryable_errors:
            if pattern.lower() in error_lower:
                return True

        return False

    def _calculate_delay(self, retry_count: int) -> int:
        """Calculate delay before next retry."""
        if self.retry_policy.exponential_backoff:
            return self.retry_policy.retry_delay_ms * (2 ** (retry_count - 1))
        return self.retry_policy.retry_delay_ms

    async def execute_all_steps(
        self,
        state: ExecutionState,
        parsed_steps: List[ParsedStep],
        stop_on_failure: bool = True,
    ) -> ExecutionState:
        """
        Execute all steps in a test.

        Args:
            state: Execution state to update
            parsed_steps: List of parsed steps to execute
            stop_on_failure: Stop execution if a step fails

        Returns:
            Updated execution state
        """
        state.start()

        try:
            for i, parsed_step in enumerate(parsed_steps):
                step = await self.execute_step(state, i, parsed_step)

                if stop_on_failure and step.status in [StepStatus.FAILED, StepStatus.ERROR]:
                    logger.warning(f"Stopping execution at step {i + 1} due to failure")
                    # Mark remaining steps as skipped
                    for j in range(i + 1, len(parsed_steps)):
                        if j < len(state.steps):
                            state.steps[j].status = StepStatus.SKIPPED

                    from .state import ExecutionStatus
                    state.complete(ExecutionStatus.FAILED, step.error_message)
                    break
            else:
                # All steps completed
                from .state import ExecutionStatus
                state.complete(ExecutionStatus.PASSED)

        except Exception as e:
            logger.error(f"Execution failed with exception: {e}")
            from .state import ExecutionStatus
            state.complete(ExecutionStatus.ERROR, str(e))

        return state


class ParallelExecutor:
    """
    Executes multiple tests in parallel.

    Manages browser sessions and coordinates parallel execution
    with configurable concurrency limits.
    """

    def __init__(
        self,
        max_workers: int = 4,
        retry_policy: Optional[RetryPolicy] = None,
    ):
        self.max_workers = max_workers
        self.retry_policy = retry_policy or RetryPolicy()
        self._semaphore = asyncio.Semaphore(max_workers)

    async def execute_tests(
        self,
        test_specs: List[Dict[str, Any]],
        environment: str,
        browser: str,
        on_test_complete: Optional[Callable[[ExecutionState], None]] = None,
    ) -> List[ExecutionState]:
        """
        Execute multiple tests in parallel.

        Args:
            test_specs: List of test specifications
            environment: Target environment
            browser: Browser to use
            on_test_complete: Callback when a test completes

        Returns:
            List of execution states for all tests
        """
        tasks = [
            self._execute_with_semaphore(
                test_spec,
                environment,
                browser,
                on_test_complete,
            )
            for test_spec in test_specs
        ]

        results = await asyncio.gather(*tasks, return_exceptions=True)

        # Convert exceptions to error states
        final_results = []
        for i, result in enumerate(results):
            if isinstance(result, Exception):
                error_state = ExecutionState.create(
                    test_id=test_specs[i].get("id", f"test-{i}"),
                    test_name=test_specs[i].get("name", "Unknown"),
                    environment=environment,
                    browser=browser,
                )
                from .state import ExecutionStatus
                error_state.complete(ExecutionStatus.ERROR, str(result))
                final_results.append(error_state)
            else:
                final_results.append(result)

        return final_results

    async def _execute_with_semaphore(
        self,
        test_spec: Dict[str, Any],
        environment: str,
        browser: str,
        on_test_complete: Optional[Callable[[ExecutionState], None]],
    ) -> ExecutionState:
        """Execute a single test with semaphore control."""
        async with self._semaphore:
            # Import here to avoid circular dependency
            from .orchestrator import TestOrchestrator, get_orchestrator

            orchestrator = get_orchestrator()
            result = await orchestrator.execute_test(
                test_spec=test_spec,
                environment=environment,
                browser=browser,
            )

            if on_test_complete:
                on_test_complete(result)

            return result
