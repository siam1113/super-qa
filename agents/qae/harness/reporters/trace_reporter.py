"""Trace Reporter - Generates full JSON trace reports."""
import json
from datetime import datetime
from typing import Dict, Any, Optional

from ..state import ExecutionState


class TraceReporter:
    """
    Generates comprehensive JSON trace reports from execution state.

    The trace format is designed to be:
    - Machine-readable for processing and analysis
    - Complete with all execution details
    - Compatible with trace viewers and debugging tools
    """

    def __init__(self, include_base64_screenshots: bool = False):
        """
        Initialize the trace reporter.

        Args:
            include_base64_screenshots: Include base64 screenshot data in JSON
                                        (can make files very large)
        """
        self.include_base64_screenshots = include_base64_screenshots

    def generate_trace(self, state: ExecutionState) -> Dict[str, Any]:
        """Generate a complete trace dictionary."""
        trace = {
            "traceVersion": "1.0",
            "generatedAt": datetime.now().isoformat(),
            "execution": self._build_execution_section(state),
            "steps": [self._build_step_trace(step) for step in state.steps],
            "artifacts": self._build_artifacts_section(state),
            "metrics": self._build_metrics_section(state),
        }

        return trace

    def generate_json(self, state: ExecutionState, indent: int = 2) -> str:
        """Generate trace as JSON string."""
        trace = self.generate_trace(state)
        return json.dumps(trace, indent=indent, default=str)

    def _build_execution_section(self, state: ExecutionState) -> Dict[str, Any]:
        """Build the execution metadata section."""
        return {
            "runId": state.run_id,
            "testId": state.test_id,
            "testName": state.test_name,
            "environment": state.environment,
            "browser": state.browser,
            "traceLevel": state.trace_level,
            "status": state.status.value,
            "startedAt": state.started_at.isoformat() if state.started_at else None,
            "completedAt": state.completed_at.isoformat() if state.completed_at else None,
            "durationMs": state.duration_ms,
            "browserSession": {
                "sessionId": state.session_id,
                "contextId": state.context_id,
                "pageId": state.page_id,
            },
            "error": {
                "message": state.error_message,
                "stackTrace": state.stack_trace,
            } if state.error_message else None,
            "variables": state.variables,
            "metadata": state.metadata,
        }

    def _build_step_trace(self, step) -> Dict[str, Any]:
        """Build trace for a single step."""
        return {
            "stepId": step.step_id,
            "stepNumber": step.step_number,
            "description": step.description,
            "stepType": step.step_type,
            "status": step.status.value,
            "startedAt": step.started_at.isoformat() if step.started_at else None,
            "completedAt": step.completed_at.isoformat() if step.completed_at else None,
            "durationMs": step.duration_ms,
            "expectedResult": step.expected_result,
            "actualResult": step.actual_result,
            "errorMessage": step.error_message,
            "actions": [self._build_action_trace(action) for action in step.actions],
        }

    def _build_action_trace(self, action) -> Dict[str, Any]:
        """Build trace for a single action."""
        trace = {
            "actionId": action.action_id,
            "actionType": action.action_type,
            "selector": action.selector,
            "arguments": action.arguments,
            "status": action.status,
            "startedAt": action.started_at.isoformat() if action.started_at else None,
            "completedAt": action.completed_at.isoformat() if action.completed_at else None,
            "durationMs": action.duration_ms,
            "errorMessage": action.error_message,
            "screenshots": {
                "before": action.screenshot_before,
                "after": action.screenshot_after,
            },
            "consoleLogs": action.console_logs,
            "networkRequests": action.network_requests[:10],  # Limit to 10
        }

        # Optionally include base64 screenshot data
        if self.include_base64_screenshots and action.result:
            if "screenshotBefore" in action.result:
                trace["screenshotBeforeData"] = action.result["screenshotBefore"]
            if "screenshotAfter" in action.result:
                trace["screenshotAfterData"] = action.result["screenshotAfter"]

        return trace

    def _build_artifacts_section(self, state: ExecutionState) -> Dict[str, Any]:
        """Build the artifacts section."""
        return {
            "traceKey": state.trace_key,
            "screenshots": {
                "count": len(state.all_screenshots),
                "keys": state.all_screenshots[:20],  # Limit to 20
            },
            "consoleLogs": {
                "count": len(state.all_console_logs),
                "errorCount": sum(1 for log in state.all_console_logs if log.get("level") == "error"),
                "warnCount": sum(1 for log in state.all_console_logs if log.get("level") == "warn"),
                "entries": state.all_console_logs[:50],  # Limit to 50
            },
            "networkRequests": {
                "count": len(state.all_network_requests),
                "failedCount": sum(1 for req in state.all_network_requests if req.get("status", 200) >= 400),
                "entries": state.all_network_requests[:30],  # Limit to 30
            },
        }

    def _build_metrics_section(self, state: ExecutionState) -> Dict[str, Any]:
        """Build the metrics section."""
        total_steps = len(state.steps)
        passed_steps = state.get_passed_steps()
        failed_steps = state.get_failed_steps()

        total_actions = sum(len(step.actions) for step in state.steps)
        passed_actions = sum(
            1 for step in state.steps
            for action in step.actions
            if action.status == "success"
        )

        # Calculate timing metrics
        step_durations = [step.duration_ms for step in state.steps if step.duration_ms > 0]
        action_durations = [
            action.duration_ms
            for step in state.steps
            for action in step.actions
            if action.duration_ms > 0
        ]

        return {
            "summary": {
                "totalSteps": total_steps,
                "passedSteps": passed_steps,
                "failedSteps": failed_steps,
                "skippedSteps": total_steps - passed_steps - failed_steps,
                "passRate": (passed_steps / total_steps * 100) if total_steps > 0 else 0,
            },
            "actions": {
                "total": total_actions,
                "passed": passed_actions,
                "failed": total_actions - passed_actions,
            },
            "timing": {
                "totalDurationMs": state.duration_ms,
                "avgStepDurationMs": sum(step_durations) / len(step_durations) if step_durations else 0,
                "avgActionDurationMs": sum(action_durations) / len(action_durations) if action_durations else 0,
                "maxStepDurationMs": max(step_durations) if step_durations else 0,
                "minStepDurationMs": min(step_durations) if step_durations else 0,
            },
            "artifacts": {
                "screenshotCount": len(state.all_screenshots),
                "consoleLogCount": len(state.all_console_logs),
                "networkRequestCount": len(state.all_network_requests),
            },
        }


def format_trace_report(state: ExecutionState, as_json: bool = True) -> str:
    """Convenience function to generate a trace report."""
    reporter = TraceReporter()
    if as_json:
        return reporter.generate_json(state)
    else:
        return json.dumps(reporter.generate_trace(state), indent=2, default=str)
