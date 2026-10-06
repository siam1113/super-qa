"""Test Executor - Executes MCP tool calls sequentially or in parallel."""
import asyncio
import json
import logging
import os
import uuid
from dataclasses import dataclass
from datetime import datetime
from typing import Optional, Dict, Any, List, Callable, Awaitable

from langchain_core.messages import SystemMessage, HumanMessage, ToolMessage

from .state import ExecutionState, ExecutionStatus, StepState, StepStatus, ActionRecord
from .interpreter import MCPToolCall, ParsedStep
from .grounded_step import ASSERTION_TOOL_NAMES, REPORT_STEP_RESULT, ReportStepResultArgs, build_step_tools, build_system_prompt
from shared.llm import create_llm
from shared.mcp.playwright.context import get_browser_manager

logger = logging.getLogger(__name__)


def _summarize_action_result(action: ActionRecord) -> str:
    """Compact JSON summary of a tool call's result, fed back to the model as its
    observation. Drops screenshot payloads (base64, not useful to a text model) and
    caps length so a verbose get_page_content/accessibility_snapshot can't blow up
    the step's context."""
    payload = dict(action.result or {})
    for key in ("screenshotBefore", "screenshotAfter", "screenshot"):
        payload.pop(key, None)
    text = json.dumps(payload, default=str)
    if len(text) > 4000:
        text = text[:4000] + "...(truncated)"
    return text


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

    def __init__(self, page_id: str, context_id: Optional[str] = None):
        self.page_id = page_id
        # Lets TestExecutor auto-follow a new tab/popup the app opens mid-step —
        # see TestExecutor._follow_new_tab_and_dialogs. Optional only so existing
        # callers/tests that don't care about popups keep working unchanged.
        self.context_id = context_id
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
        llm: Optional[Any] = None,
        max_step_iterations: Optional[int] = None,
        locator_hints: Optional[List[Dict[str, Any]]] = None,
        step_timeout_seconds: Optional[float] = None,
        step_retry_count: Optional[int] = None,
        max_tokens_per_test: Optional[int] = None,
    ):
        self.mcp = mcp_client
        self.retry_policy = retry_policy or RetryPolicy()
        self.on_step_start = on_step_start
        self.on_step_complete = on_step_complete
        self.on_action_complete = on_action_complete
        self.llm = llm or create_llm(agent_type="qae")
        self.max_step_iterations = max_step_iterations or int(os.getenv("GROUNDED_STEP_MAX_ITERATIONS", "8"))
        self.locator_hints = locator_hints or []
        # Wall-clock cap on one step's grounded loop — on top of max_step_iterations,
        # since a slow LLM/app can otherwise stretch a step indefinitely even while
        # staying under the iteration count.
        self.step_timeout_seconds = (
            step_timeout_seconds
            if step_timeout_seconds is not None
            else float(os.getenv("GROUNDED_STEP_TIMEOUT_SECONDS", "300"))
        )
        # Extra whole-step re-attempts (distinct from the in-step tool-call retries
        # in RetryPolicy) if a step still ends FAILED/ERROR. Defaults to 0 — off —
        # since re-running a step risks re-applying mutating actions (a second
        # click/submit) that already partially succeeded; opt in deliberately.
        self.step_retry_count = (
            step_retry_count if step_retry_count is not None else int(os.getenv("STEP_RETRY_COUNT", "0"))
        )
        max_tokens_env = os.getenv("QAE_MAX_TOKENS_PER_TEST", "")
        self.max_tokens_per_test = (
            max_tokens_per_test if max_tokens_per_test is not None
            else (int(max_tokens_env) if max_tokens_env.strip() else None)
        )
        # Retry/backoff for the LLM call itself — a transient rate-limit or network
        # blip from the model provider otherwise propagates straight up and fails
        # the step immediately, the same class of bug as an unretried browser-tool
        # timeout, just one layer up the stack.
        self.llm_retry_attempts = int(os.getenv("QAE_LLM_RETRY_ATTEMPTS", "3"))
        self.llm_retry_delay_ms = int(os.getenv("QAE_LLM_RETRY_DELAY_MS", "1000"))

    async def execute_step(
        self,
        state: ExecutionState,
        step_index: int,
        parsed_step: ParsedStep,
    ) -> StepState:
        """
        Execute a single test step by grounding its (deliberately vague) description
        against the live page: a bounded tool-calling loop decides what to do, acts
        via the real browser tools, and must verify the expected result with a real
        assertion tool before the step can be reported passed.

        Args:
            state: Current execution state
            step_index: Index of the step in the state
            parsed_step: Parsed step (description/expected-result metadata)

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

        attempt = 0
        while True:
            try:
                await asyncio.wait_for(
                    self._execute_grounded_step(state, step_index, step),
                    timeout=self.step_timeout_seconds,
                )
            except asyncio.TimeoutError:
                logger.error(f"Step {step.step_number} exceeded its {self.step_timeout_seconds}s wall-clock budget")
                state.complete_step(
                    step_index,
                    StepStatus.ERROR,
                    error=f"Step exceeded its {self.step_timeout_seconds:.0f}s wall-clock budget",
                )
            except Exception as e:
                logger.error(f"Step {step.step_number} failed with exception: {e}")
                state.complete_step(
                    step_index,
                    StepStatus.ERROR,
                    error=str(e),
                )

            if step.status not in (StepStatus.FAILED, StepStatus.ERROR) or attempt >= self.step_retry_count:
                break

            attempt += 1
            logger.warning(
                f"Step {step.step_number} ended {step.status.value}; retrying whole step "
                f"(attempt {attempt + 1}/{self.step_retry_count + 1})"
            )
            await asyncio.sleep(2)
            step.status = StepStatus.RUNNING

        if self.on_step_complete:
            self.on_step_complete(step)

        return step

    async def _execute_grounded_step(
        self,
        state: ExecutionState,
        step_index: int,
        step: StepState,
    ) -> None:
        """Bounded tool-calling loop that grounds one vague step against the live page."""
        tools = build_step_tools(self.mcp)
        model = self.llm.bind_tools(tools)
        system = build_system_prompt(
            test_name=state.test_name,
            step_number=step.step_number,
            total_steps=len(state.steps),
            description=step.description,
            expected_result=step.expected_result,
            locator_hints=self.locator_hints,
            max_iterations=self.max_step_iterations,
        )
        messages: List[Any] = [SystemMessage(content=system), HumanMessage(content=f"Execute step {step.step_number} now.")]
        verified = False

        for _ in range(self.max_step_iterations):
            response = await self._invoke_model_with_retry(model, messages)
            messages.append(response)

            usage_metadata = getattr(response, "usage_metadata", None) or {}
            tokens_used = {
                "input": usage_metadata.get("input_tokens"),
                "output": usage_metadata.get("output_tokens"),
                "total": usage_metadata.get("total_tokens"),
            } if usage_metadata else None

            if not response.tool_calls:
                messages.append(HumanMessage(
                    content=f"Call a tool to act or verify, or {REPORT_STEP_RESULT} to finish this step."
                ))
                continue

            for call in response.tool_calls:
                call_id = call.get("id") or f"call-{uuid.uuid4().hex[:8]}"
                call_name = call.get("name", "")
                call_args = call.get("args") or {}

                if call_name == REPORT_STEP_RESULT:
                    report = ReportStepResultArgs(**call_args)
                    if report.passed and verified:
                        status, error = StepStatus.PASSED, None
                    elif report.passed and not verified:
                        status, error = StepStatus.ERROR, (
                            "report_step_result claimed passed without a successful assertion "
                            "tool call against the live page"
                        )
                    else:
                        status, error = StepStatus.FAILED, report.reason or "Expected result was not met"
                    state.complete_step(step_index, status, actual_result=report.actual_result, error=error)
                    messages.append(ToolMessage(content="recorded", tool_call_id=call_id))
                    return

                action = await self._execute_tool_call(
                    state, step_index, MCPToolCall(tool_name=call_name, arguments=dict(call_args)),
                    tokens_used=tokens_used,
                )
                if action.action_type in ASSERTION_TOOL_NAMES and action.status == "success":
                    verified = True
                messages.append(ToolMessage(content=_summarize_action_result(action), tool_call_id=call_id))

        state.complete_step(
            step_index,
            StepStatus.ERROR,
            error=f"Could not verify the expected result within {self.max_step_iterations} tool calls",
        )

    async def _invoke_model_with_retry(self, model: Any, messages: List[Any]) -> Any:
        """Call the LLM with retry/backoff for transient provider errors (rate
        limits, timeouts, connection errors) — the browser-tool retry policy
        already protects against transient failures below the model; this is the
        same protection for the model call itself."""
        last_error: Optional[Exception] = None

        for attempt in range(self.llm_retry_attempts + 1):
            try:
                return await model.ainvoke(messages)
            except Exception as e:
                last_error = e
                if attempt >= self.llm_retry_attempts or not self._is_retryable_llm_error(e):
                    raise
                delay_seconds = (self.llm_retry_delay_ms * (2 ** attempt)) / 1000
                logger.warning(
                    f"LLM call failed (attempt {attempt + 1}/{self.llm_retry_attempts + 1}), "
                    f"retrying in {delay_seconds:.1f}s: {e}"
                )
                await asyncio.sleep(delay_seconds)

        raise last_error  # pragma: no cover - loop always returns or raises above

    @staticmethod
    def _is_retryable_llm_error(error: Exception) -> bool:
        """Provider-agnostic heuristic for "worth retrying": rate limits and server
        errors (HTTP 429/5xx, surfaced as .status_code by the openai/anthropic SDKs
        alike) and network-level failures (timeouts, connection errors) that carry
        no status code at all. Deliberately does not retry 4xx errors like a bad
        API key (401) or malformed request (400) — those won't fix themselves."""
        status_code = getattr(error, "status_code", None)
        if status_code is not None:
            return status_code == 429 or status_code >= 500

        error_name = type(error).__name__.lower()
        return any(keyword in error_name for keyword in ("timeout", "connect", "ratelimit"))

    def _follow_new_tab_and_dialogs(self, page_id_before_call: str, result: Dict[str, Any]) -> None:
        """After a tool call, surface anything that happened off to the side of the
        action itself so it's visible in the trace/LLM feedback instead of silently
        vanishing, and keep the client pointed at whatever tab is now "active":

        - JS dialogs (alert/confirm/prompt) raised during the call were already
          auto-accepted by BrowserManager; attach what fired to the result.
        - If the call opened a new tab/popup (target="_blank", window.open, an
          OAuth popup), switch self.mcp.page_id to it so subsequent tool calls in
          this step act on it, the way a human tester would follow the new tab.
        """
        manager = get_browser_manager()

        dialogs = manager.get_dialogs(page_id_before_call, clear=True)
        if dialogs:
            result["dialogsHandled"] = [
                {"type": d.dialog_type, "message": d.message, "accepted": d.accepted}
                for d in dialogs
            ]

        if not self.mcp.context_id:
            return
        latest_page_id = manager.get_latest_page_id(self.mcp.context_id)
        if not latest_page_id or latest_page_id == self.mcp.page_id:
            return

        new_page = manager.get_page(latest_page_id)
        self.mcp.page_id = latest_page_id
        result["newTabOpened"] = {"pageId": latest_page_id, "url": new_page.url if new_page else None}
        logger.info(f"New tab/popup opened — now targeting page {latest_page_id}")

    async def _execute_tool_call(
        self,
        state: ExecutionState,
        step_index: int,
        tool_call: MCPToolCall,
        tokens_used: Optional[Dict[str, Optional[int]]] = None,
    ) -> ActionRecord:
        """Execute a single MCP tool call with retry logic."""
        action = state.add_action_to_step(
            step_index,
            tool_call.tool_name,
            selector=tool_call.arguments.get("selector"),
            arguments=tool_call.arguments,
            tokens_used=tokens_used,
        )

        if not action:
            raise ValueError("Failed to add action to step")

        last_error = None
        retries = 0

        while retries <= self.retry_policy.max_retries:
            try:
                logger.debug(f"Executing {tool_call.tool_name} (attempt {retries + 1})")

                page_id_before_call = self.mcp.page_id
                result = await self.mcp.call_tool(
                    tool_call.tool_name,
                    tool_call.arguments,
                )
                self._follow_new_tab_and_dialogs(page_id_before_call, result)

                # Check if the result indicates failure
                status = result.get("status")
                if status not in {"success", "failed", "error", "timeout"}:
                    raise ValueError("Tool returned no recognized execution status")
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
            # Steps are grounded live (see TestExecutor._execute_grounded_step), so there's
            # no pre-computed tool_calls/assertion to check ahead of time anymore — the
            # equivalent guarantee (a real assertion backs every "passed") is enforced
            # per-step, at execution time, inside the grounded loop itself.
            if not parsed_steps:
                raise ValueError("Test has no executable steps")
            if len(parsed_steps) != len(state.steps):
                raise ValueError("Execution state does not match the test plan")
            for i, parsed_step in enumerate(parsed_steps):
                step = await self.execute_step(state, i, parsed_step)

                if self.max_tokens_per_test is not None and state.total_tokens_used > self.max_tokens_per_test:
                    logger.warning(
                        f"Stopping execution at step {i + 1}: token budget exceeded "
                        f"({state.total_tokens_used} > {self.max_tokens_per_test})"
                    )
                    for j in range(i + 1, len(parsed_steps)):
                        if j < len(state.steps):
                            state.steps[j].status = StepStatus.SKIPPED
                    state.complete(
                        ExecutionStatus.ERROR,
                        f"Token budget exceeded ({state.total_tokens_used} > {self.max_tokens_per_test})",
                    )
                    break

                if stop_on_failure and step.status in [StepStatus.FAILED, StepStatus.ERROR]:
                    logger.warning(f"Stopping execution at step {i + 1} due to failure")
                    # Mark remaining steps as skipped
                    for j in range(i + 1, len(parsed_steps)):
                        if j < len(state.steps):
                            state.steps[j].status = StepStatus.SKIPPED

                    status = ExecutionStatus.ERROR if step.status == StepStatus.ERROR else ExecutionStatus.FAILED
                    state.complete(status, step.error_message)
                    break
            else:
                # All steps completed
                failed_steps = [step for step in state.steps if step.status != StepStatus.PASSED]
                if failed_steps:
                    status = ExecutionStatus.ERROR if any(step.status == StepStatus.ERROR for step in failed_steps) else ExecutionStatus.FAILED
                    state.complete(status, failed_steps[0].error_message)
                else:
                    state.complete(ExecutionStatus.PASSED)

        except Exception as e:
            logger.error(f"Execution failed with exception: {e}")
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
