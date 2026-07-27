"""Step Reporter - Generates step-based markdown reports."""
from datetime import datetime
from typing import Optional, List

from ..state import ExecutionState, StepState, StepStatus, ActionRecord


class StepReporter:
    """
    Generates step-based markdown reports from execution state.

    Features:
    - Step-by-step breakdown with status icons
    - Before/after screenshot references
    - Console log summaries
    - Timing information
    - Error details with stack traces
    """

    def __init__(self, include_screenshots: bool = True, include_logs: bool = True):
        self.include_screenshots = include_screenshots
        self.include_logs = include_logs

    def generate_report(self, state: ExecutionState) -> str:
        """Generate a complete step-based report."""
        lines = []

        # Header
        lines.append(self._generate_header(state))
        lines.append("")

        # Summary stats
        lines.append(self._generate_summary(state))
        lines.append("")

        # Steps
        lines.append("---")
        lines.append("")

        for step in state.steps:
            lines.append(self._generate_step_section(step, state))
            lines.append("")

        # Footer with artifacts
        lines.append("---")
        lines.append("")
        lines.append(self._generate_artifacts_section(state))

        return "\n".join(lines)

    def _generate_header(self, state: ExecutionState) -> str:
        """Generate report header."""
        status_icon = self._get_status_icon(state.status.value)
        duration_str = self._format_duration(state.duration_ms)

        return f"""## Test Execution Report: {state.test_id}

**Test:** {state.test_name}
**Run ID:** `{state.run_id}`
**Environment:** {state.environment.upper()}
**Browser:** {state.browser.title()}
**Status:** {status_icon} {state.status.value.upper()}
**Duration:** {duration_str}
**Executed:** {state.started_at.strftime('%Y-%m-%d %H:%M:%S') if state.started_at else 'N/A'}"""

    def _generate_summary(self, state: ExecutionState) -> str:
        """Generate summary statistics."""
        total = len(state.steps)
        passed = state.get_passed_steps()
        failed = state.get_failed_steps()
        skipped = sum(1 for s in state.steps if s.status == StepStatus.SKIPPED)

        pass_rate = (passed / total * 100) if total > 0 else 0

        return f"""### Summary

| Metric | Value |
|--------|-------|
| Total Steps | {total} |
| Passed | {passed} |
| Failed | {failed} |
| Skipped | {skipped} |
| Pass Rate | {pass_rate:.1f}% |
| Screenshots | {len(state.all_screenshots)} |
| Console Logs | {len(state.all_console_logs)} |
| Network Requests | {len(state.all_network_requests)} |"""

    def _generate_step_section(self, step: StepState, state: ExecutionState) -> str:
        """Generate section for a single step."""
        status_icon = self._get_status_icon(step.status.value)
        duration_str = self._format_duration(step.duration_ms)

        lines = [
            f"### Step {step.step_number}: {step.description}",
            "",
            f"**Status:** {status_icon} {step.status.value.upper()} | **Duration:** {duration_str}",
            "",
        ]

        # Actions within the step
        if step.actions:
            lines.append("**Actions:**")
            for action in step.actions:
                action_icon = self._get_status_icon(action.status)
                lines.append(f"- `{action.action_type}` {action.selector or ''} {action_icon}")

                # Include screenshots if available
                if self.include_screenshots and (action.screenshot_before or action.screenshot_after):
                    lines.append("")
                    lines.append("| Before | After |")
                    lines.append("|--------|-------|")
                    before = f"![before]({action.screenshot_before})" if action.screenshot_before else "-"
                    after = f"![after]({action.screenshot_after})" if action.screenshot_after else "-"
                    lines.append(f"| {before} | {after} |")
                    lines.append("")

            lines.append("")

        # Console logs for this step
        if self.include_logs:
            step_logs = self._get_step_logs(step)
            if step_logs:
                lines.append("**Console:**")
                lines.append("```")
                for log in step_logs[:5]:  # Limit to 5 logs
                    level = log.get("level", "log").upper()
                    message = log.get("message", "")[:100]
                    lines.append(f"[{level}] {message}")
                lines.append("```")
                lines.append("")

        # Error details
        if step.error_message:
            lines.append("**Error:**")
            lines.append(f"```")
            lines.append(step.error_message)
            lines.append("```")
            lines.append("")

        # Expected vs Actual
        if step.expected_result or step.actual_result:
            lines.append(f"**Expected:** {step.expected_result or 'N/A'}")
            lines.append(f"**Actual:** {step.actual_result or 'N/A'}")
            lines.append("")

        return "\n".join(lines)

    def _generate_artifacts_section(self, state: ExecutionState) -> str:
        """Generate artifacts section."""
        lines = ["### Artifacts", ""]

        if state.trace_key:
            lines.append(f"- [Full Trace JSON]({state.trace_key})")

        lines.append(f"- Screenshots: {len(state.all_screenshots)} captured")
        lines.append(f"- Console Logs: {len(state.all_console_logs)} entries")
        lines.append(f"- Network Requests: {len(state.all_network_requests)} captured")

        if state.error_message:
            lines.append("")
            lines.append("### Error Details")
            lines.append("```")
            lines.append(state.error_message)
            if state.stack_trace:
                lines.append("")
                lines.append(state.stack_trace[:500])
            lines.append("```")

        return "\n".join(lines)

    def _get_step_logs(self, step: StepState) -> List[dict]:
        """Get console logs from step actions."""
        logs = []
        for action in step.actions:
            logs.extend(action.console_logs)
        return logs

    def _get_status_icon(self, status: str) -> str:
        """Get icon for status."""
        icons = {
            "passed": "✅",
            "success": "✅",
            "failed": "❌",
            "error": "⚠️",
            "skipped": "⏭️",
            "pending": "⏳",
            "running": "🔄",
            "cancelled": "🚫",
            "timeout": "⏰",
        }
        return icons.get(status.lower(), "❓")

    def _format_duration(self, ms: int) -> str:
        """Format duration in milliseconds to human readable."""
        if ms < 1000:
            return f"{ms}ms"
        elif ms < 60000:
            return f"{ms / 1000:.1f}s"
        else:
            minutes = ms // 60000
            seconds = (ms % 60000) / 1000
            return f"{minutes}m {seconds:.0f}s"


def format_step_report(state: ExecutionState) -> str:
    """Convenience function to generate a step report."""
    reporter = StepReporter()
    return reporter.generate_report(state)
