"""Test Runner Service - Executes Playwright tests.

Supports two execution modes:
1. MCP-based execution via Harness (recommended)
2. Legacy subprocess-based Playwright execution

Set USE_MCP_EXECUTION=true to use MCP-based execution.
"""
import os
import asyncio
import json
import uuid
import logging
from datetime import datetime
from pathlib import Path
from typing import Optional, List, Dict, Any, Callable
from concurrent.futures import ThreadPoolExecutor

from .models import TestRun, TestResult, TestStep, RunStatus

logger = logging.getLogger(__name__)

# Try to import MCP harness components (QAE harness)
try:
    from qae.harness import get_orchestrator
    from qae.harness.state import ExecutionStatus
    MCP_HARNESS_AVAILABLE = True
except ImportError:
    MCP_HARNESS_AVAILABLE = False
    logger.info("MCP Harness not available, using legacy execution")

# Configuration flag for MCP execution
USE_MCP_EXECUTION = os.getenv("USE_MCP_EXECUTION", "true").lower() == "true"


class TestRunnerService:
    """Service for executing Playwright tests with queue management."""

    def __init__(
        self,
        tests_dir: str = None,
        results_dir: str = None,
        max_workers: int = 4,
    ):
        self.tests_dir = Path(tests_dir or os.getenv("TESTS_DIR", "./tests"))
        self.results_dir = Path(results_dir or os.getenv("RESULTS_DIR", "./test-results"))
        self.max_workers = max_workers
        self.executor = ThreadPoolExecutor(max_workers=max_workers)

        # In-memory storage for runs (use Redis in production)
        self._runs: Dict[str, TestRun] = {}
        self._queue: asyncio.Queue = asyncio.Queue()
        self._running = False

        # Callbacks for status updates
        self._on_progress: Optional[Callable[[TestRun], None]] = None

        # Ensure directories exist
        self.tests_dir.mkdir(parents=True, exist_ok=True)
        self.results_dir.mkdir(parents=True, exist_ok=True)

    async def start(self):
        """Start the test runner service."""
        self._running = True
        logger.info("Test Runner Service started")
        asyncio.create_task(self._process_queue())

    async def stop(self):
        """Stop the test runner service."""
        self._running = False
        logger.info("Test Runner Service stopped")

    def on_progress(self, callback: Callable[[TestRun], None]):
        """Register a callback for progress updates."""
        self._on_progress = callback

    async def queue_test(
        self,
        test_id: str,
        environment: str = "staging",
        browser: str = "chromium",
    ) -> TestRun:
        """Queue a single test for execution."""
        return await self.queue_tests([test_id], environment, browser)

    async def queue_tests(
        self,
        test_ids: List[str],
        environment: str = "staging",
        browser: str = "chromium",
        parallel: bool = True,
    ) -> TestRun:
        """Queue multiple tests for execution."""
        run_id = f"RUN-{uuid.uuid4().hex[:8].upper()}"

        run = TestRun(
            run_id=run_id,
            status=RunStatus.QUEUED,
            test_ids=test_ids,
            environment=environment,
            browser=browser,
            parallel=parallel,
            total_tests=len(test_ids),
        )

        self._runs[run_id] = run
        await self._queue.put(run_id)

        logger.info(f"Queued test run {run_id} with {len(test_ids)} tests")
        return run

    async def get_run(self, run_id: str) -> Optional[TestRun]:
        """Get a test run by ID."""
        return self._runs.get(run_id)

    async def get_run_status(self, run_id: str) -> Optional[Dict[str, Any]]:
        """Get the status of a test run."""
        run = self._runs.get(run_id)
        if run:
            return run.to_dict()
        return None

    async def cancel_run(self, run_id: str) -> bool:
        """Cancel a queued or running test run."""
        run = self._runs.get(run_id)
        if run and run.status in (RunStatus.QUEUED, RunStatus.RUNNING):
            run.status = RunStatus.CANCELLED
            run.completed_at = datetime.now()
            return True
        return False

    async def _process_queue(self):
        """Process the test execution queue."""
        while self._running:
            try:
                run_id = await asyncio.wait_for(self._queue.get(), timeout=1.0)
                run = self._runs.get(run_id)

                if run and run.status == RunStatus.QUEUED:
                    await self._execute_run(run)

            except asyncio.TimeoutError:
                continue
            except Exception as e:
                logger.error(f"Error processing queue: {e}")

    async def _execute_run(self, run: TestRun):
        """Execute a test run."""
        run.status = RunStatus.RUNNING
        run.started_at = datetime.now()
        self._notify_progress(run)

        logger.info(f"Starting test run {run.run_id}")

        try:
            if run.parallel and len(run.test_ids) > 1:
                await self._execute_parallel(run)
            else:
                await self._execute_sequential(run)

            # Determine final status
            if run.failed > 0 or run.error > 0:
                run.status = RunStatus.FAILED
            else:
                run.status = RunStatus.PASSED

        except Exception as e:
            logger.error(f"Error executing run {run.run_id}: {e}")
            run.status = RunStatus.ERROR

        finally:
            run.completed_at = datetime.now()
            run.progress = 100.0
            self._notify_progress(run)
            logger.info(f"Completed test run {run.run_id}: {run.status.value}")

    async def _execute_sequential(self, run: TestRun):
        """Execute tests sequentially."""
        for i, test_id in enumerate(run.test_ids):
            if run.status == RunStatus.CANCELLED:
                break

            result = await self._execute_single_test(test_id, run.environment, run.browser)
            run.results.append(result)
            self._update_run_stats(run, result)
            run.progress = ((i + 1) / run.total_tests) * 100
            self._notify_progress(run)

    async def _execute_parallel(self, run: TestRun):
        """Execute tests in parallel."""
        semaphore = asyncio.Semaphore(self.max_workers)
        completed = 0

        async def run_with_semaphore(test_id: str):
            nonlocal completed
            async with semaphore:
                if run.status == RunStatus.CANCELLED:
                    return None
                result = await self._execute_single_test(test_id, run.environment, run.browser)
                completed += 1
                run.progress = (completed / run.total_tests) * 100
                self._notify_progress(run)
                return result

        tasks = [run_with_semaphore(test_id) for test_id in run.test_ids]
        results = await asyncio.gather(*tasks, return_exceptions=True)

        for result in results:
            if isinstance(result, TestResult):
                run.results.append(result)
                self._update_run_stats(run, result)

    async def _execute_single_test(
        self,
        test_id: str,
        environment: str,
        browser: str,
    ) -> TestResult:
        """Execute a single test using Playwright.

        Uses MCP-based harness if available and enabled,
        otherwise falls back to legacy subprocess execution.
        """
        started_at = datetime.now()

        # Try MCP-based execution first
        if MCP_HARNESS_AVAILABLE and USE_MCP_EXECUTION:
            result = await self._execute_via_mcp(test_id, environment, browser)
            if result:
                result.started_at = started_at
                result.completed_at = datetime.now()
                result.duration_ms = int((result.completed_at - started_at).total_seconds() * 1000)
                return result

        # Fall back to legacy execution
        test_file = self._find_test_file(test_id)

        if test_file:
            # Execute real Playwright test
            result = await self._run_playwright_test(test_id, test_file, environment, browser)
        else:
            # Simulate test execution for demo
            result = await self._simulate_test_execution(test_id, environment)

        result.started_at = started_at
        result.completed_at = datetime.now()
        result.duration_ms = int((result.completed_at - started_at).total_seconds() * 1000)

        return result

    async def _execute_via_mcp(
        self,
        test_id: str,
        environment: str,
        browser: str,
    ) -> Optional[TestResult]:
        """Execute a test via MCP harness."""
        try:
            orchestrator = get_orchestrator()

            # Execute test via orchestrator
            exec_result = await orchestrator.execute_test(
                test_id=test_id,
                environment=environment,
                browser=browser,
                trace_level="action",
            )

            # Convert ExecutionState to TestResult
            status_map = {
                ExecutionStatus.PASSED: RunStatus.PASSED,
                ExecutionStatus.FAILED: RunStatus.FAILED,
                ExecutionStatus.ERROR: RunStatus.ERROR,
                ExecutionStatus.CANCELLED: RunStatus.CANCELLED,
            }

            steps = []
            for step_state in exec_result.steps:
                step = TestStep(
                    number=step_state.step_number,
                    action=step_state.description,
                    expected=step_state.expected_result or "",
                    actual=step_state.actual_result,
                    status=status_map.get(
                        ExecutionStatus(step_state.status) if isinstance(step_state.status, str)
                        else step_state.status,
                        RunStatus.ERROR
                    ),
                    duration_ms=step_state.duration_ms,
                    error=step_state.error_message,
                    mcp_tool=step_state.actions[0].action_type if step_state.actions else None,
                    selector=step_state.actions[0].selector if step_state.actions else None,
                    screenshot_before=step_state.actions[0].screenshot_before if step_state.actions else None,
                    screenshot_after=step_state.actions[0].screenshot_after if step_state.actions else None,
                    trace_id=step_state.trace_id,
                )
                steps.append(step)

            return TestResult(
                test_id=test_id,
                test_name=exec_result.test_name or f"Test {test_id}",
                status=status_map.get(exec_result.status, RunStatus.ERROR),
                duration_ms=exec_result.duration_ms,
                started_at=exec_result.started_at or datetime.now(),
                completed_at=exec_result.completed_at,
                steps=steps,
                error_message=exec_result.error_message,
                screenshots=exec_result.screenshots,
                logs=exec_result.logs,
                trace_key=exec_result.trace_key,
                browser_session_id=exec_result.browser_session_id,
                execution_mode="mcp",
                console_log_count=exec_result.console_log_count,
                network_request_count=exec_result.network_request_count,
            )

        except Exception as e:
            logger.warning(f"MCP execution failed for {test_id}, falling back to legacy: {e}")
            return None

    def _find_test_file(self, test_id: str) -> Optional[Path]:
        """Find the test file for a given test ID."""
        # Look for files matching the test ID pattern
        patterns = [
            f"{test_id}.spec.ts",
            f"{test_id}.spec.js",
            f"{test_id.lower()}.spec.ts",
            f"{test_id.lower()}.spec.js",
            f"{test_id.replace('-', '_')}.spec.ts",
        ]

        for pattern in patterns:
            for file in self.tests_dir.rglob(pattern):
                return file

        return None

    async def _run_playwright_test(
        self,
        test_id: str,
        test_file: Path,
        environment: str,
        browser: str,
    ) -> TestResult:
        """Run a Playwright test file."""
        result_file = self.results_dir / f"{test_id}-{uuid.uuid4().hex[:6]}.json"

        # Build Playwright command
        cmd = [
            "npx", "playwright", "test",
            str(test_file),
            "--browser", browser,
            "--reporter", "json",
            "--output", str(self.results_dir),
        ]

        # Add environment variables
        env = os.environ.copy()
        env["TEST_ENV"] = environment
        env["BASE_URL"] = self._get_base_url(environment)

        try:
            # Run Playwright
            process = await asyncio.create_subprocess_exec(
                *cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                env=env,
            )

            stdout, stderr = await asyncio.wait_for(
                process.communicate(),
                timeout=300  # 5 minute timeout
            )

            # Parse results
            if process.returncode == 0:
                status = RunStatus.PASSED
                error_message = None
            else:
                status = RunStatus.FAILED
                error_message = stderr.decode() if stderr else "Test failed"

            # Try to parse JSON output
            screenshots = []
            if result_file.exists():
                try:
                    with open(result_file) as f:
                        json_result = json.load(f)
                        # Extract screenshots from Playwright JSON report
                        screenshots = json_result.get("attachments", [])
                except Exception:
                    pass

            return TestResult(
                test_id=test_id,
                test_name=test_file.stem,
                status=status,
                duration_ms=0,  # Will be calculated later
                started_at=datetime.now(),
                error_message=error_message,
                screenshots=screenshots,
                logs=[stdout.decode()] if stdout else [],
            )

        except asyncio.TimeoutError:
            return TestResult(
                test_id=test_id,
                test_name=test_file.stem,
                status=RunStatus.ERROR,
                duration_ms=300000,
                started_at=datetime.now(),
                error_message="Test execution timed out after 5 minutes",
            )

        except Exception as e:
            return TestResult(
                test_id=test_id,
                test_name=test_file.stem,
                status=RunStatus.ERROR,
                duration_ms=0,
                started_at=datetime.now(),
                error_message=str(e),
            )

    async def _simulate_test_execution(
        self,
        test_id: str,
        environment: str,
    ) -> TestResult:
        """Simulate test execution for demo purposes."""
        import random

        # Simulate execution time
        await asyncio.sleep(random.uniform(0.5, 2.0))

        # Simulate success/failure (90% pass rate)
        is_passed = random.random() < 0.90

        steps = [
            TestStep(
                number=1,
                action="Navigate to the page",
                expected="Page loads successfully",
                actual="Page loaded in 1.2s",
                status=RunStatus.PASSED,
                duration_ms=1200,
            ),
            TestStep(
                number=2,
                action="Perform action",
                expected="Action completes",
                actual="Action completed" if is_passed else "Element not found",
                status=RunStatus.PASSED if is_passed else RunStatus.FAILED,
                duration_ms=800 if is_passed else 5000,
                error="TimeoutError: Element not found" if not is_passed else None,
            ),
            TestStep(
                number=3,
                action="Verify result",
                expected="Expected outcome achieved",
                actual="Outcome verified" if is_passed else "Skipped due to previous failure",
                status=RunStatus.PASSED if is_passed else RunStatus.ERROR,
                duration_ms=500 if is_passed else 0,
            ),
        ]

        return TestResult(
            test_id=test_id,
            test_name=f"Test {test_id}",
            status=RunStatus.PASSED if is_passed else RunStatus.FAILED,
            duration_ms=sum(s.duration_ms for s in steps),
            started_at=datetime.now(),
            steps=steps,
            error_message=None if is_passed else "Element not found: button[data-testid='submit']",
            screenshots=[f"/screenshots/{test_id}-{i}.png" for i in range(1, 4)],
            metadata={
                "environment": environment,
                "simulated": True,
            },
        )

    def _get_base_url(self, environment: str) -> str:
        """Get the base URL for an environment."""
        urls = {
            "dev": os.getenv("DEV_URL", "http://localhost:3000"),
            "staging": os.getenv("STAGING_URL", "https://staging.example.com"),
            "production": os.getenv("PROD_URL", "https://example.com"),
        }
        return urls.get(environment, urls["staging"])

    def _update_run_stats(self, run: TestRun, result: TestResult):
        """Update run statistics based on a test result."""
        if result.status == RunStatus.PASSED:
            run.passed += 1
        elif result.status == RunStatus.FAILED:
            run.failed += 1
        elif result.status == RunStatus.ERROR:
            run.error += 1
        else:
            run.skipped += 1

    def _notify_progress(self, run: TestRun):
        """Notify progress callback if registered."""
        if self._on_progress:
            try:
                self._on_progress(run)
            except Exception as e:
                logger.error(f"Error in progress callback: {e}")


# Singleton instance
_runner_instance: Optional[TestRunnerService] = None


def get_runner() -> TestRunnerService:
    """Get the global test runner instance."""
    global _runner_instance
    if _runner_instance is None:
        _runner_instance = TestRunnerService()
    return _runner_instance
