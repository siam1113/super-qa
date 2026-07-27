"""Trace Collector - Collects and manages trace data during execution."""
import logging
from datetime import datetime
from typing import Optional, Dict, Any, List

from .models import (
    TraceConfig,
    TraceLevel,
    ActionTrace,
    StepTrace,
    TestTrace,
    ConsoleLogEntry,
    NetworkRequestEntry,
)
from .storage import TraceStorageClient

logger = logging.getLogger(__name__)


class TraceCollector:
    """
    Collects execution trace data in real-time.

    Features:
    - Real-time trace collection at action/step/test levels
    - Automatic screenshot upload to storage
    - Console and network log aggregation
    - Configurable trace levels
    """

    def __init__(
        self,
        storage_client: Optional[TraceStorageClient] = None,
        config: Optional[TraceConfig] = None,
    ):
        self.storage = storage_client
        self.config = config or TraceConfig()
        self._current_trace: Optional[TestTrace] = None
        self._current_step: Optional[StepTrace] = None
        self._current_action: Optional[ActionTrace] = None

    @property
    def current_trace(self) -> Optional[TestTrace]:
        """Get the current test trace."""
        return self._current_trace

    async def start_test_trace(
        self,
        run_id: str,
        test_id: str,
        test_name: str,
        environment: str,
        browser: str,
        base_url: Optional[str] = None,
    ) -> TestTrace:
        """Start collecting trace for a test."""
        self._current_trace = TestTrace(
            run_id=run_id,
            test_id=test_id,
            test_name=test_name,
            environment=environment,
            browser=browser,
            base_url=base_url,
            trace_level=self.config.level,
        )
        self._current_trace.start()

        logger.info(f"Started trace for test {test_id}: {self._current_trace.trace_id}")
        return self._current_trace

    async def start_step(
        self,
        step_number: int,
        description: str,
        step_type: str = "action",
        expected_result: Optional[str] = None,
    ) -> StepTrace:
        """Start a new step in the trace."""
        if not self._current_trace:
            raise RuntimeError("No active test trace. Call start_test_trace first.")

        self._current_step = StepTrace(
            step_number=step_number,
            description=description,
            step_type=step_type,
            expected_result=expected_result,
        )
        self._current_step.start()
        self._current_trace.add_step(self._current_step)

        logger.debug(f"Started step {step_number}: {description}")
        return self._current_step

    async def end_step(
        self,
        status: str,
        actual_result: Optional[str] = None,
        error: Optional[str] = None,
    ) -> Optional[StepTrace]:
        """End the current step."""
        if not self._current_step:
            return None

        self._current_step.complete(status, actual_result)
        if error:
            self._current_step.error_message = error

        step = self._current_step
        self._current_step = None
        self._current_action = None

        logger.debug(f"Completed step {step.step_number}: {status}")
        return step

    async def record_action(
        self,
        action_type: str,
        selector: Optional[str] = None,
        arguments: Optional[Dict[str, Any]] = None,
    ) -> ActionTrace:
        """Start recording an action."""
        if not self._current_step:
            raise RuntimeError("No active step. Call start_step first.")

        self._current_action = ActionTrace(
            action_type=action_type,
            selector=selector,
            arguments=arguments or {},
        )
        self._current_action.start()

        logger.debug(f"Recording action: {action_type}")
        return self._current_action

    async def complete_action(
        self,
        result: Dict[str, Any],
    ) -> Optional[ActionTrace]:
        """Complete the current action with results."""
        if not self._current_action or not self._current_step:
            return None

        action = self._current_action

        # Extract status from result
        status = result.get("status", "success")
        if status in ["success", "passed"]:
            status = "success"
        elif status in ["failed", "error", "timeout"]:
            status = "failed"

        action.complete(status, result)

        # Handle error
        if result.get("errorMessage"):
            action.error_message = result["errorMessage"]

        # Handle screenshots
        if self.config.capture_screenshots:
            await self._handle_screenshots(action, result)

        # Handle console logs
        if self.config.capture_console_logs:
            self._handle_console_logs(action, result)

        # Handle network requests
        if self.config.capture_network:
            self._handle_network_requests(action, result)

        # Add action to current step
        self._current_step.add_action(action)
        self._current_action = None

        logger.debug(f"Completed action {action.action_type}: {status}")
        return action

    async def _handle_screenshots(
        self,
        action: ActionTrace,
        result: Dict[str, Any],
    ) -> None:
        """Handle screenshot storage from action result."""
        # Check for base64 screenshot data
        before_data = result.get("screenshotBefore")
        after_data = result.get("screenshotAfter")

        if before_data and self.storage:
            try:
                key = await self.storage.upload_screenshot(
                    base64_data=before_data,
                    test_id=self._current_trace.test_id if self._current_trace else "unknown",
                    action_id=action.trace_id,
                    screenshot_type="before",
                )
                action.screenshot_before_key = key
            except Exception as e:
                logger.warning(f"Failed to upload before screenshot: {e}")

        if after_data and self.storage:
            try:
                key = await self.storage.upload_screenshot(
                    base64_data=after_data,
                    test_id=self._current_trace.test_id if self._current_trace else "unknown",
                    action_id=action.trace_id,
                    screenshot_type="after",
                )
                action.screenshot_after_key = key
            except Exception as e:
                logger.warning(f"Failed to upload after screenshot: {e}")

        # Store base64 data if configured
        if self.config.include_base64_screenshots:
            action.screenshot_before_data = before_data
            action.screenshot_after_data = after_data

    def _handle_console_logs(
        self,
        action: ActionTrace,
        result: Dict[str, Any],
    ) -> None:
        """Handle console logs from action result."""
        logs = result.get("consoleLogs", [])
        for log in logs[:self.config.max_console_logs]:
            entry = ConsoleLogEntry(
                level=log.get("level", "log"),
                message=log.get("message", ""),
                source=log.get("source"),
                line_number=log.get("lineNumber"),
            )
            action.console_logs.append(entry)

    def _handle_network_requests(
        self,
        action: ActionTrace,
        result: Dict[str, Any],
    ) -> None:
        """Handle network requests from action result."""
        requests = result.get("networkRequests", [])
        for req in requests[:self.config.max_network_requests]:
            entry = NetworkRequestEntry(
                url=req.get("url", ""),
                method=req.get("method", "GET"),
                status=req.get("status"),
                resource_type=req.get("resourceType"),
                failure_text=req.get("failureText"),
            )
            action.network_requests.append(entry)

    async def finalize_trace(
        self,
        status: str,
        error: Optional[str] = None,
    ) -> Optional[TestTrace]:
        """Finalize and optionally upload the complete trace."""
        if not self._current_trace:
            return None

        trace = self._current_trace
        trace.complete(status, error)

        # Upload trace to storage if available
        if self.storage:
            try:
                trace.trace_key = await self.storage.upload_trace(trace)
                logger.info(f"Uploaded trace: {trace.trace_key}")
            except Exception as e:
                logger.warning(f"Failed to upload trace: {e}")

        self._current_trace = None
        self._current_step = None
        self._current_action = None

        logger.info(f"Finalized trace {trace.trace_id}: {status}")
        return trace

    def get_current_trace_json(self) -> Optional[str]:
        """Get the current trace as JSON."""
        if self._current_trace:
            return self._current_trace.to_json()
        return None


# Global collector instance
_trace_collector: Optional[TraceCollector] = None


def get_trace_collector(
    storage_client: Optional[TraceStorageClient] = None,
    config: Optional[TraceConfig] = None,
) -> TraceCollector:
    """Get or create the global trace collector."""
    global _trace_collector
    if _trace_collector is None:
        _trace_collector = TraceCollector(storage_client, config)
    return _trace_collector


async def reset_trace_collector() -> None:
    """Reset the global trace collector."""
    global _trace_collector
    _trace_collector = None
