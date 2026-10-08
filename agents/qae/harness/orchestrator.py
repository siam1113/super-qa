"""Test Orchestrator - Main orchestration layer for MCP-based test execution.

Orchestrates test execution using:
- MCP-based browser automation
- Environment configuration from backend
- Business context (locators, rules, requirements)
- Video recording and tracing
"""
import asyncio
import os
import logging
import httpx
from dataclasses import dataclass, field
from datetime import datetime
from typing import Optional, Dict, Any, List, Literal, Callable

from .state import ExecutionState, ExecutionStatus, StepStatus
from .interpreter import TestInterpreter
from .executor import TestExecutor, MCPClient, RetryPolicy
from langgraph.config import get_stream_writer

from shared.live import get_live_registry
from shared.live.screencast import ScreencastStreamer
from shared.mcp.playwright.context import get_browser_manager
from shared.narration import emit_status

logger = logging.getLogger(__name__)

BACKEND_URL = os.getenv("BACKEND_API_URL", "http://localhost:4000/api")


@dataclass
class ExecutionContext:
    """Context data for test execution from backend."""
    environment: Dict[str, Any] = field(default_factory=dict)
    variables: Dict[str, str] = field(default_factory=dict)
    locators: List[Dict[str, Any]] = field(default_factory=list)
    business_rules: List[Dict[str, Any]] = field(default_factory=list)
    requirements: List[Dict[str, Any]] = field(default_factory=list)
    page_objects: List[Dict[str, Any]] = field(default_factory=list)
    test_data: List[Dict[str, Any]] = field(default_factory=list)


@dataclass
class OrchestratorConfig:
    """Configuration for the test orchestrator."""
    default_timeout: int = 30000
    capture_screenshots: bool = True
    capture_video: bool = True
    video_dir: str = "/tmp/qa-videos"
    trace_level: Literal["action", "step", "test"] = "action"
    stop_on_failure: bool = True
    max_retries: int = 3
    retry_delay_ms: int = 1000
    headless: bool = True
    slow_mo: int = 0
    storage_backend_url: str = "http://localhost:4000/api"
    use_context: bool = True  # Fetch context from backend
    # Wall-clock cap on an entire test run, on top of the per-step timeout inside
    # TestExecutor — bounds a run where every step individually stays within its
    # own budget but the test as a whole still runs away (e.g. a long suite with
    # no single slow step).
    test_timeout_seconds: float = 1800.0
    step_timeout_seconds: float = 300.0
    step_retry_count: int = 0
    max_tokens_per_test: Optional[int] = None

    @classmethod
    def from_env(cls) -> "OrchestratorConfig":
        """Create config from environment variables."""
        max_tokens_env = os.getenv("QAE_MAX_TOKENS_PER_TEST", "")
        return cls(
            default_timeout=int(os.getenv("PLAYWRIGHT_DEFAULT_TIMEOUT", "30000")),
            capture_screenshots=os.getenv("TRACE_SCREENSHOTS", "true").lower() == "true",
            capture_video=os.getenv("TRACE_VIDEO", "true").lower() == "true",
            video_dir=os.getenv("VIDEO_DIR", "/tmp/qa-videos"),
            trace_level=os.getenv("TRACE_LEVEL", "action"),
            stop_on_failure=os.getenv("STOP_ON_FAILURE", "true").lower() == "true",
            max_retries=int(os.getenv("TEST_RETRY_COUNT", "3")),
            retry_delay_ms=int(os.getenv("TEST_RETRY_DELAY_MS", "1000")),
            headless=os.getenv("PLAYWRIGHT_HEADLESS", "true").lower() == "true",
            slow_mo=int(os.getenv("PLAYWRIGHT_SLOW_MO", "0")),
            storage_backend_url=os.getenv("BACKEND_API_URL", "http://localhost:4000/api"),
            use_context=os.getenv("USE_BACKEND_CONTEXT", "true").lower() == "true",
            test_timeout_seconds=float(os.getenv("TEST_EXECUTION_TIMEOUT_SECONDS", "1800")),
            step_timeout_seconds=float(os.getenv("GROUNDED_STEP_TIMEOUT_SECONDS", "300")),
            step_retry_count=int(os.getenv("STEP_RETRY_COUNT", "0")),
            max_tokens_per_test=int(max_tokens_env) if max_tokens_env.strip() else None,
        )


class TestOrchestrator:
    """
    Main orchestration layer for test execution via MCP.

    Responsibilities:
    - Interpret test case definitions
    - Manage browser lifecycle via MCP
    - Execute tests step-by-step with full tracing
    - Handle errors and retries
    - Coordinate artifact storage
    """

    def __init__(self, config: Optional[OrchestratorConfig] = None):
        self.config = config or OrchestratorConfig.from_env()
        self.interpreter = TestInterpreter()
        self._mcp_tools: Dict[str, Callable] = {}
        self._initialized = False

    async def _fetch_environment_config(self, environment: str) -> Dict[str, Any]:
        """Fetch environment configuration from backend."""
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                response = await client.get(f"{BACKEND_URL}/environments")
                if response.status_code == 200:
                    envs = response.json()
                    for env in envs:
                        if env.get("name", "").lower() == environment.lower():
                            return env
                        if env.get("isDefault") and environment == "staging":
                            return env
        except Exception as e:
            logger.warning(f"Failed to fetch environment config: {e}")
        return {"name": environment, "variables": []}

    async def _fetch_business_context(self, test_id: str) -> ExecutionContext:
        """Fetch business context related to a test case."""
        context = ExecutionContext()

        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                # Get test case details first
                test_response = await client.get(f"{BACKEND_URL}/qa/test-cases/{test_id}")
                if test_response.status_code == 200:
                    test_data = test_response.json()
                    context.test_data = [test_data]

                # Get business items (locators, rules, requirements, page objects)
                items_response = await client.get(
                    f"{BACKEND_URL}/business/items",
                    params={"types": "locator,rule,requirement,dom,action,data_setup"}
                )
                if items_response.status_code == 200:
                    items = items_response.json()
                    for item in items:
                        item_type = item.get("type", "")
                        if item_type == "locator":
                            context.locators.append(item)
                        elif item_type == "rule":
                            context.business_rules.append(item)
                        elif item_type == "requirement":
                            context.requirements.append(item)
                        elif item_type == "dom":
                            context.page_objects.append(item)

        except Exception as e:
            logger.warning(f"Failed to fetch business context: {e}")

        return context

    async def initialize(self) -> None:
        """Initialize the orchestrator and load MCP tools."""
        if self._initialized:
            return

        # Import MCP tools from shared module
        from shared.mcp.playwright.tools import (
            browser_launch,
            browser_close,
            context_create,
            context_close,
            page_create,
            page_close,
            goto,
            go_back,
            go_forward,
            reload,
            click,
            fill,
            clear,
            select_option,
            check,
            uncheck,
            hover,
            focus,
            press,
            type_text,
            accessibility_snapshot,
            screenshot,
            get_console_logs,
            get_network_requests,
            get_page_content,
            evaluate,
            expect_visible,
            expect_hidden,
            expect_text,
            expect_value,
            expect_url,
            expect_title,
            expect_element_count,
            expect_checked,
            expect_enabled,
            expect_attribute,
            expect_download,
            wait_for_selector,
            wait_for_navigation,
            wait_for_load_state,
            wait_for_timeout,
            wait_for_url,
        )

        # Register all MCP tools
        self._mcp_tools = {
            "browser_launch": browser_launch,
            "browser_close": browser_close,
            "context_create": context_create,
            "context_close": context_close,
            "page_create": page_create,
            "page_close": page_close,
            "goto": goto,
            "go_back": go_back,
            "go_forward": go_forward,
            "reload": reload,
            "click": click,
            "fill": fill,
            "clear": clear,
            "select_option": select_option,
            "check": check,
            "uncheck": uncheck,
            "hover": hover,
            "focus": focus,
            "press": press,
            "type_text": type_text,
            "accessibility_snapshot": accessibility_snapshot,
            "screenshot": screenshot,
            "get_console_logs": get_console_logs,
            "get_network_requests": get_network_requests,
            "get_page_content": get_page_content,
            "evaluate": evaluate,
            "expect_visible": expect_visible,
            "expect_hidden": expect_hidden,
            "expect_text": expect_text,
            "expect_value": expect_value,
            "expect_url": expect_url,
            "expect_title": expect_title,
            "expect_element_count": expect_element_count,
            "expect_checked": expect_checked,
            "expect_enabled": expect_enabled,
            "expect_attribute": expect_attribute,
            "expect_download": expect_download,
            "wait_for_selector": wait_for_selector,
            "wait_for_navigation": wait_for_navigation,
            "wait_for_load_state": wait_for_load_state,
            "wait_for_timeout": wait_for_timeout,
            "wait_for_url": wait_for_url,
        }

        self._initialized = True
        logger.info("TestOrchestrator initialized with MCP tools")

    async def execute_test(
        self,
        test_spec: Dict[str, Any],
        environment: str,
        browser: Literal["chromium", "firefox", "webkit"] = "chromium",
        trace_level: Optional[Literal["action", "step", "test"]] = None,
        on_step_complete: Optional[Callable] = None,
        run_id: Optional[str] = None,
    ) -> ExecutionState:
        """
        Execute a single test specification.

        Args:
            test_spec: Test specification dictionary
            environment: Target environment (dev, staging, production)
            browser: Browser to use
            trace_level: Level of tracing detail (overrides config)
            on_step_complete: Callback when a step completes

        The target environment's maxRetries/retryDelayMs (set in the Environments UI),
        if present, override this orchestrator's config-wide retry defaults.

        Returns:
            ExecutionState with full execution trace
        """
        await self.initialize()

        # Parse the test specification
        parsed = self.interpreter.interpret_test(test_spec)

        # Fetch context from backend if enabled
        env_config = {}
        business_context = ExecutionContext()

        if self.config.use_context:
            env_config = await self._fetch_environment_config(environment)
            business_context = await self._fetch_business_context(parsed.test_id)

            # Extract environment variables
            if env_config.get("variables"):
                for var in env_config["variables"]:
                    if not var.get("isSecret"):  # Don't expose secrets
                        business_context.variables[var["key"]] = var["value"]

            logger.info(f"Loaded context: {len(business_context.locators)} locators, "
                       f"{len(business_context.business_rules)} rules")

        # Create execution state
        state = ExecutionState.create(
            test_id=parsed.test_id,
            test_name=parsed.test_name,
            environment=environment,
            browser=browser,
            trace_level=trace_level or self.config.trace_level,
            run_id=run_id,
        )

        # Store context in state metadata
        state.metadata = {
            "environmentConfig": env_config,
            "locatorCount": len(business_context.locators),
            "ruleCount": len(business_context.business_rules),
            "requirementCount": len(business_context.requirements),
        }

        # Add steps to state
        for parsed_step in parsed.steps:
            state.add_step(
                description=parsed_step.description,
                step_type=parsed_step.step_type,
                expected_result=parsed_step.expected_result,
            )

        logger.info(f"Starting test execution: {parsed.test_name} ({parsed.test_id})")

        live = get_live_registry()
        live.create(state.run_id, state.test_id, state.test_name)
        live.publish(state.run_id, {"type": "step", "steps": [s.to_dict() for s in state.steps]})
        try:
            # No-ops when execute_test wasn't invoked from inside a LangGraph run (e.g.
            # the "Run with agent" button). Lets a chat tool call surface a watchable
            # run ID the moment the browser starts, long before the tool call returns.
            get_stream_writer()({"type": "live_run_started", "runId": state.run_id, "testId": state.test_id, "testName": state.test_name})
        except Exception:
            pass
        emit_status(f"Running app — {parsed.test_name}…")
        streamer: Optional[ScreencastStreamer] = None

        try:
            # Setup browser with video recording
            await self._setup_browser(state, browser, business_context)
            streamer = await self._start_live_stream(state, live)

            # Navigate to a start URL before any step runs. The test case's own baseUrl
            # (if set) takes precedence; otherwise fall back to the environment's
            # configured baseUrl. Without one of these, the browser stays on a blank
            # page and every step fails since there's nothing to ground against.
            base_url = parsed.base_url or env_config.get("baseUrl")
            if base_url:
                base_url = self._resolve_base_url(base_url, environment, business_context)
                await self._navigate_to_base_url(state, base_url, environment)
            else:
                logger.warning(
                    f"No baseUrl set on test case '{parsed.test_name}' or environment "
                    f"'{environment}' — browser will start on a blank page."
                )

            # Create MCP client for this execution
            mcp_client = self._create_mcp_client(state.page_id, state.context_id)

            # Enhance interpreter with locators from context
            if business_context.locators:
                self.interpreter.set_locators(business_context.locators)

            # Create executor with retry policy, preferring this environment's override
            # (set in the Environments UI) over the runtime-wide default.
            env_max_retries = env_config.get("maxRetries")
            env_retry_delay_ms = env_config.get("retryDelayMs")
            retry_policy = RetryPolicy(
                max_retries=env_max_retries if isinstance(env_max_retries, int) else self.config.max_retries,
                retry_delay_ms=env_retry_delay_ms if isinstance(env_retry_delay_ms, int) else self.config.retry_delay_ms,
            )

            def publish_steps(_step_state) -> None:
                live.publish(state.run_id, {"type": "step", "steps": [s.to_dict() for s in state.steps]})

            def publish_agent_event(event: dict) -> None:
                live.publish(state.run_id, {"type": "agent", **event})

            def handle_step_complete(step_state) -> None:
                publish_steps(step_state)
                emit_status(f"Step {state.current_step}/{len(state.steps)}: {step_state.description} — {step_state.status.value}")
                if on_step_complete:
                    on_step_complete(step_state)

            executor = TestExecutor(
                mcp_client=mcp_client,
                retry_policy=retry_policy,
                on_step_start=publish_steps,
                on_step_complete=handle_step_complete,
                on_action_complete=publish_steps,
                on_action_start=publish_steps,
                on_agent_event=publish_agent_event,
                locator_hints=business_context.locators,
                step_timeout_seconds=self.config.step_timeout_seconds,
                step_retry_count=self.config.step_retry_count,
                max_tokens_per_test=self.config.max_tokens_per_test,
            )

            # Execute all steps, bounded by an overall test wall-clock budget on top
            # of each step's own budget — a run where every individual step stays
            # within its limit can still run away in aggregate (e.g. a long suite).
            state = await asyncio.wait_for(
                executor.execute_all_steps(
                    state=state,
                    parsed_steps=parsed.steps,
                    stop_on_failure=self.config.stop_on_failure,
                ),
                timeout=self.config.test_timeout_seconds,
            )

        except asyncio.TimeoutError:
            logger.error(f"Test execution exceeded its {self.config.test_timeout_seconds}s wall-clock budget: {state.run_id}")
            current_index = state.current_step - 1
            if 0 <= current_index < len(state.steps) and state.steps[current_index].status == StepStatus.RUNNING:
                state.complete_step(current_index, StepStatus.ERROR, error="Test exceeded its wall-clock budget")
            for step in state.steps:
                if step.status == StepStatus.PENDING:
                    step.status = StepStatus.SKIPPED
            state.complete(
                ExecutionStatus.ERROR,
                f"Test exceeded its {self.config.test_timeout_seconds:.0f}s wall-clock budget",
            )

        except asyncio.CancelledError:
            logger.info(f"Execution cancelled: {state.run_id}")
            current_index = state.current_step - 1
            if 0 <= current_index < len(state.steps) and state.steps[current_index].status == StepStatus.RUNNING:
                state.complete_step(current_index, StepStatus.ERROR, error="Cancelled by user")
            for step in state.steps:
                if step.status == StepStatus.PENDING:
                    step.status = StepStatus.SKIPPED
            state.complete(ExecutionStatus.CANCELLED, "Cancelled by user")
            # Swallowed deliberately: cleanup below (browser close, result report) must
            # still run, and the run's own "cancelled" status is already recorded —
            # there's no caller that needs this task to also look cancelled().

        except Exception as e:
            logger.error(f"Test execution failed: {e}")
            state.complete(ExecutionStatus.ERROR, str(e))
            state.stack_trace = self._get_stack_trace(e)

        finally:
            if streamer is not None:
                await streamer.stop()
            # Cleanup browser and save video
            await self._cleanup_browser(state)
            live.complete(state.run_id, state.status.value)
            await self._report_agent_result(state)

        logger.info(f"Test completed: {state.status.value} in {state.duration_ms}ms")

        return state

    async def _report_agent_result(self, state: ExecutionState) -> None:
        """Best-effort notify the backend of a finished agent-driven run (no-op if unknown)."""
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                await client.post(f"{BACKEND_URL}/qa/executions/agent-result", json={
                    "agentRunId": state.run_id,
                    "status": state.status.value,
                    "result": {
                        "steps": [s.to_dict() for s in state.steps],
                        "durationMs": state.duration_ms,
                        "consoleLogCount": len(state.all_console_logs),
                        "networkRequestCount": len(state.all_network_requests),
                        "consoleLogs": state.all_console_logs[-200:],
                        "networkRequests": state.all_network_requests[-200:],
                        "dialogs": state.all_dialogs,
                        "downloads": state.all_downloads,
                        "totalTokensUsed": state.total_tokens_used,
                        "errorMessage": state.error_message,
                        "videoKey": state.video_key,
                    },
                })
        except Exception as e:
            logger.warning(f"Failed to report agent execution result for {state.run_id}: {e}")

    async def _start_live_stream(self, state: ExecutionState, live) -> Optional[ScreencastStreamer]:
        """Attach a CDP screencast plus console/network tailing to the run's page."""
        page = get_browser_manager().get_page(state.page_id)
        if page is None:
            return None

        streamer = ScreencastStreamer(
            page,
            lambda data_url: live.publish(state.run_id, {"type": "frame", "dataUrl": data_url}),
        )
        try:
            await streamer.start()
        except Exception as e:
            logger.warning(f"Live screencast unavailable for {state.run_id}: {e}")
            streamer = None

        pending_requests: Dict[str, Dict[str, Any]] = {}

        def handle_console(message) -> None:
            live.publish(state.run_id, {"type": "console", "log": {
                "level": message.type,
                "message": message.text,
                "timestamp": datetime.now().isoformat(),
            }})

        def handle_request(request) -> None:
            entry = {
                "url": request.url,
                "method": request.method,
                "resourceType": request.resource_type,
                "status": None,
                "timestamp": datetime.now().isoformat(),
            }
            pending_requests[request.url] = entry
            live.publish(state.run_id, {"type": "network", "request": entry})

        def handle_response(response) -> None:
            entry = dict(pending_requests.pop(response.url, {
                "url": response.url,
                "method": response.request.method,
                "resourceType": response.request.resource_type,
                "timestamp": datetime.now().isoformat(),
            }))
            entry["status"] = response.status
            live.publish(state.run_id, {"type": "network", "request": entry})

        page.on("console", handle_console)
        page.on("request", handle_request)
        page.on("response", handle_response)

        return streamer

    def _resolve_base_url(
        self,
        base_url: str,
        environment: str,
        context: ExecutionContext,
    ) -> str:
        """Resolve base URL using environment variables."""
        url = base_url.replace("{environment}", environment)

        # Replace any {VAR_NAME} placeholders with environment variables
        for key, value in context.variables.items():
            url = url.replace(f"{{{key}}}", value)

        return url

    async def execute_suite(
        self,
        test_specs: List[Dict[str, Any]],
        environment: str,
        browser: Literal["chromium", "firefox", "webkit"] = "chromium",
        parallel: bool = False,
        max_workers: int = 4,
        on_test_complete: Optional[Callable[[ExecutionState], None]] = None,
    ) -> List[ExecutionState]:
        """
        Execute multiple tests.

        Args:
            test_specs: List of test specifications
            environment: Target environment
            browser: Browser to use
            parallel: Execute tests in parallel
            max_workers: Maximum parallel workers
            on_test_complete: Callback when a test completes

        Returns:
            List of ExecutionState for all tests
        """
        await self.initialize()

        if parallel:
            from .executor import ParallelExecutor
            parallel_executor = ParallelExecutor(
                max_workers=max_workers,
                retry_policy=RetryPolicy(
                    max_retries=self.config.max_retries,
                    retry_delay_ms=self.config.retry_delay_ms,
                ),
            )
            return await parallel_executor.execute_tests(
                test_specs=test_specs,
                environment=environment,
                browser=browser,
                on_test_complete=on_test_complete,
            )
        else:
            # Sequential execution
            results = []
            for test_spec in test_specs:
                state = await self.execute_test(
                    test_spec=test_spec,
                    environment=environment,
                    browser=browser,
                )
                results.append(state)
                if on_test_complete:
                    on_test_complete(state)

            return results

    async def _setup_browser(
        self,
        state: ExecutionState,
        browser: str,
        context: Optional[ExecutionContext] = None,
    ) -> None:
        """Set up browser session, context, and page with video recording."""
        browser_launch = self._mcp_tools["browser_launch"]
        context_create = self._mcp_tools["context_create"]
        page_create = self._mcp_tools["page_create"]

        # Launch browser
        session_result = await browser_launch(
            browser_type=browser,
            headless=self.config.headless,
            slow_mo=self.config.slow_mo,
        )
        state.session_id = session_result.get("sessionId")
        logger.debug(f"Browser launched: {state.session_id}")

        # Create context with video recording if enabled
        context_result = await context_create(
            session_id=state.session_id,
            record_video=self.config.capture_video,
            video_dir=self.config.video_dir,
        )
        state.context_id = context_result.get("contextId")
        state.video_enabled = self.config.capture_video
        logger.debug(f"Context created: {state.context_id} (video: {self.config.capture_video})")

        # Create page
        page_result = await page_create(context_id=state.context_id)
        state.page_id = page_result.get("pageId")
        logger.debug(f"Page created: {state.page_id}")

    async def _navigate_to_base_url(
        self,
        state: ExecutionState,
        base_url: str,
        environment: str,
    ) -> None:
        """Navigate to the base URL for the test."""
        # Replace environment placeholder in URL
        url = base_url.replace("{environment}", environment)

        goto = self._mcp_tools["goto"]
        await goto(
            page_id=state.page_id,
            url=url,
            wait_until="load",
            capture_before=False,
            capture_after=self.config.capture_screenshots,
        )
        logger.debug(f"Navigated to base URL: {url}")

    async def _cleanup_browser(self, state: ExecutionState) -> None:
        """Clean up browser resources and save video."""
        try:
            manager = get_browser_manager()

            # Capture history from every page in this run — the original tab plus
            # any popups/new tabs auto-tracked mid-test (see TestExecutor's
            # new-tab-follow logic) — before any of them close, so the completed-
            # execution detail view has more than the last-5-per-action window each
            # action result carries.
            page_ids = manager.get_page_ids_for_context(state.context_id) if state.context_id else []
            if not page_ids and state.page_id:
                page_ids = [state.page_id]

            for page_id in page_ids:
                state.all_console_logs.extend(
                    {"level": log.level, "message": log.message, "timestamp": log.timestamp.isoformat()}
                    for log in manager.get_console_logs(page_id)
                )
                state.all_network_requests.extend(
                    {"url": req.url, "method": req.method, "resourceType": req.resource_type,
                     "status": req.status, "timestamp": req.timestamp.isoformat(),
                     "requestHeaders": req.request_headers, "responseHeaders": req.response_headers,
                     "requestBody": req.request_body, "responseBody": req.response_body,
                     "failureText": req.failure_text}
                    for req in manager.get_network_requests(page_id)
                )
                state.all_dialogs.extend(
                    {"type": d.dialog_type, "message": d.message, "accepted": d.accepted,
                     "timestamp": d.timestamp.isoformat()}
                    for d in manager.get_dialogs(page_id)
                )
                state.all_downloads.extend(
                    {"url": d.url, "suggestedFilename": d.suggested_filename, "timestamp": d.timestamp.isoformat()}
                    for d in manager.get_downloads(page_id)
                )

            # Close any extra tabs/popups opened mid-test first, so they don't leak
            # past this run — only the primary page's video/close result is tracked
            # on the execution state.
            if state.context_id and state.page_id:
                await manager.close_extra_pages(state.context_id, keep_page_id=state.page_id)

            # Close page first to finalize video
            if state.page_id:
                page_close = self._mcp_tools["page_close"]
                close_result = await page_close(page_id=state.page_id)

                # Get video path from close result
                video_path = close_result.get("videoPath")
                if video_path:
                    state.video_path = video_path
                    logger.info(f"Video saved: {video_path}")

                    # Upload video to storage if storage client available
                    try:
                        from shared.tracing import TraceStorageClient
                        storage = TraceStorageClient(backend_url=self.config.storage_backend_url)
                        state.video_key = await storage.upload_video(
                            video_path=video_path,
                            test_id=state.test_id,
                            run_id=state.run_id,
                        )
                        logger.info(f"Video uploaded: {state.video_key}")
                    except Exception as ve:
                        logger.warning(f"Failed to upload video: {ve}")

            # Close browser session
            if state.session_id:
                browser_close = self._mcp_tools["browser_close"]
                await browser_close(session_id=state.session_id)
                logger.debug(f"Browser closed: {state.session_id}")

        except Exception as e:
            logger.warning(f"Failed to cleanup browser: {e}")

    def _create_mcp_client(self, page_id: str, context_id: Optional[str] = None) -> MCPClient:
        """Create an MCP client configured for this execution."""
        client = MCPClient(page_id, context_id=context_id)

        # Register all MCP tools with the client
        for name, func in self._mcp_tools.items():
            client.register_tool(name, func)

        return client

    def _get_stack_trace(self, exception: Exception) -> str:
        """Get stack trace from an exception."""
        import traceback
        return "".join(traceback.format_exception(type(exception), exception, exception.__traceback__))


# Global orchestrator instance
_orchestrator: Optional[TestOrchestrator] = None


def get_orchestrator(config: Optional[OrchestratorConfig] = None) -> TestOrchestrator:
    """Get or create the global orchestrator instance."""
    global _orchestrator
    if _orchestrator is None:
        _orchestrator = TestOrchestrator(config)
    return _orchestrator


async def reset_orchestrator() -> None:
    """Reset the global orchestrator instance."""
    global _orchestrator
    _orchestrator = None
