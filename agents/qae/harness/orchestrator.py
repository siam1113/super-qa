"""Test Orchestrator - Main orchestration layer for MCP-based test execution.

Orchestrates test execution using:
- MCP-based browser automation
- Environment configuration from backend
- Business context (locators, rules, requirements)
- Video recording and tracing
"""
import os
import logging
import httpx
from dataclasses import dataclass, field
from typing import Optional, Dict, Any, List, Literal, Callable

from .state import ExecutionState, ExecutionStatus
from .interpreter import TestInterpreter
from .executor import TestExecutor, MCPClient, RetryPolicy

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

    @classmethod
    def from_env(cls) -> "OrchestratorConfig":
        """Create config from environment variables."""
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
    ) -> ExecutionState:
        """
        Execute a single test specification.

        Args:
            test_spec: Test specification dictionary
            environment: Target environment (dev, staging, production)
            browser: Browser to use
            trace_level: Level of tracing detail (overrides config)
            on_step_complete: Callback when a step completes

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

        try:
            # Setup browser with video recording
            await self._setup_browser(state, browser, business_context)

            # Navigate to base URL if provided
            if parsed.base_url:
                # Apply environment-specific base URL if available
                base_url = self._resolve_base_url(parsed.base_url, environment, business_context)
                await self._navigate_to_base_url(state, base_url, environment)

            # Create MCP client for this execution
            mcp_client = self._create_mcp_client(state.page_id)

            # Enhance interpreter with locators from context
            if business_context.locators:
                self.interpreter.set_locators(business_context.locators)

            # Create executor with retry policy
            retry_policy = RetryPolicy(
                max_retries=self.config.max_retries,
                retry_delay_ms=self.config.retry_delay_ms,
            )

            executor = TestExecutor(
                mcp_client=mcp_client,
                retry_policy=retry_policy,
                on_step_complete=on_step_complete,
            )

            # Execute all steps
            state = await executor.execute_all_steps(
                state=state,
                parsed_steps=parsed.steps,
                stop_on_failure=self.config.stop_on_failure,
            )

        except Exception as e:
            logger.error(f"Test execution failed: {e}")
            state.complete(ExecutionStatus.ERROR, str(e))
            state.stack_trace = self._get_stack_trace(e)

        finally:
            # Cleanup browser and save video
            await self._cleanup_browser(state)

        logger.info(f"Test completed: {state.status.value} in {state.duration_ms}ms")

        return state

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

    def _create_mcp_client(self, page_id: str) -> MCPClient:
        """Create an MCP client configured for this execution."""
        client = MCPClient(page_id)

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
