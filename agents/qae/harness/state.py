"""Execution state management for the Agent Harness."""
import json
import uuid
from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum
from typing import Optional, List, Dict, Any, Literal


class ExecutionStatus(str, Enum):
    """Status of test execution."""
    PENDING = "pending"
    RUNNING = "running"
    PASSED = "passed"
    FAILED = "failed"
    ERROR = "error"
    SKIPPED = "skipped"
    CANCELLED = "cancelled"


class StepStatus(str, Enum):
    """Status of an individual step."""
    PENDING = "pending"
    RUNNING = "running"
    PASSED = "passed"
    FAILED = "failed"
    ERROR = "error"
    SKIPPED = "skipped"


_OUTPUT_PAYLOAD_KEYS_TO_STRIP = ("screenshotBefore", "screenshotAfter", "screenshot")
_OUTPUT_PREVIEW_MAX_CHARS = 2000


def _safe_output(result: Optional[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    """The raw tool result, minus screenshot payloads (base64, not useful as 'output'
    text) and capped in size so a verbose get_page_content/accessibility_snapshot
    doesn't blow up the trace. Mirrors executor._summarize_action_result's trimming."""
    if not result:
        return result
    payload = {key: value for key, value in result.items() if key not in _OUTPUT_PAYLOAD_KEYS_TO_STRIP}
    text = json.dumps(payload, default=str)
    if len(text) <= _OUTPUT_PREVIEW_MAX_CHARS:
        return payload
    return {"truncated": True, "preview": text[:_OUTPUT_PREVIEW_MAX_CHARS] + "...(truncated)"}


@dataclass
class ActionRecord:
    """Record of a single MCP action within a step."""
    action_id: str
    action_type: str
    selector: Optional[str] = None
    arguments: Dict[str, Any] = field(default_factory=dict)
    status: str = "pending"
    duration_ms: int = 0
    screenshot_before: Optional[str] = None  # S3 key
    screenshot_after: Optional[str] = None   # S3 key
    error_message: Optional[str] = None
    console_logs: List[Dict[str, Any]] = field(default_factory=list)
    network_requests: List[Dict[str, Any]] = field(default_factory=list)
    started_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None
    result: Optional[Dict[str, Any]] = None
    # Token usage of the LLM call that decided on this action. Several actions can
    # share the same usage when one model response requests multiple tool calls.
    tokens_used: Optional[Dict[str, Optional[int]]] = None

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary for serialization."""
        return {
            "actionId": self.action_id,
            "actionType": self.action_type,
            "selector": self.selector,
            "arguments": self.arguments,
            "input": self.arguments,
            "output": _safe_output(self.result),
            "tokensUsed": self.tokens_used,
            "status": self.status,
            "durationMs": self.duration_ms,
            "screenshotBefore": self.screenshot_before,
            "screenshotAfter": self.screenshot_after,
            "errorMessage": self.error_message,
            "consoleLogs": self.console_logs,
            "networkRequests": self.network_requests,
            "startedAt": self.started_at.isoformat() if self.started_at else None,
            "completedAt": self.completed_at.isoformat() if self.completed_at else None,
        }


@dataclass
class StepState:
    """State for an individual test step."""
    step_id: str
    step_number: int
    description: str
    step_type: Literal["setup", "action", "assertion", "cleanup"] = "action"
    status: StepStatus = StepStatus.PENDING
    expected_result: Optional[str] = None
    actual_result: Optional[str] = None
    actions: List[ActionRecord] = field(default_factory=list)
    duration_ms: int = 0
    error_message: Optional[str] = None
    started_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary for serialization."""
        return {
            "stepId": self.step_id,
            "stepNumber": self.step_number,
            "description": self.description,
            "stepType": self.step_type,
            "status": self.status.value,
            "expectedResult": self.expected_result,
            "actualResult": self.actual_result,
            "actions": [a.to_dict() for a in self.actions],
            "durationMs": self.duration_ms,
            "errorMessage": self.error_message,
            "startedAt": self.started_at.isoformat() if self.started_at else None,
            "completedAt": self.completed_at.isoformat() if self.completed_at else None,
        }


@dataclass
class ExecutionState:
    """Complete state for a test execution."""
    run_id: str
    test_id: str
    test_name: str
    environment: str
    browser: str
    trace_level: Literal["action", "step", "test"] = "action"

    # Browser state
    session_id: Optional[str] = None
    context_id: Optional[str] = None
    page_id: Optional[str] = None

    # Execution state
    status: ExecutionStatus = ExecutionStatus.PENDING
    current_step: int = 0
    total_steps: int = 0
    steps: List[StepState] = field(default_factory=list)

    # Timing
    started_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None
    duration_ms: int = 0

    # Error tracking
    error_message: Optional[str] = None
    stack_trace: Optional[str] = None

    # Variables for data passing between steps
    variables: Dict[str, Any] = field(default_factory=dict)

    # Aggregated artifacts
    all_screenshots: List[str] = field(default_factory=list)  # S3 keys
    all_console_logs: List[Dict[str, Any]] = field(default_factory=list)
    all_network_requests: List[Dict[str, Any]] = field(default_factory=list)
    all_dialogs: List[Dict[str, Any]] = field(default_factory=list)
    all_downloads: List[Dict[str, Any]] = field(default_factory=list)

    # Trace references
    trace_key: Optional[str] = None  # S3 key for full trace JSON

    # Video recording
    video_enabled: bool = False
    video_path: Optional[str] = None  # Local path
    video_key: Optional[str] = None   # S3 key

    # Metadata
    metadata: Dict[str, Any] = field(default_factory=dict)

    # Running total of LLM tokens spent across every action in this run, used to
    # enforce a per-test cost budget (see TestExecutor.max_tokens_per_test).
    total_tokens_used: int = 0

    @classmethod
    def create(
        cls,
        test_id: str,
        test_name: str,
        environment: str,
        browser: str = "chromium",
        trace_level: str = "action",
        run_id: Optional[str] = None,
    ) -> "ExecutionState":
        """Create a new execution state."""
        return cls(
            run_id=run_id or f"RUN-{uuid.uuid4().hex[:8].upper()}",
            test_id=test_id,
            test_name=test_name,
            environment=environment,
            browser=browser,
            trace_level=trace_level,
        )

    def start(self) -> None:
        """Mark execution as started."""
        self.status = ExecutionStatus.RUNNING
        self.started_at = datetime.now()

    def complete(self, status: ExecutionStatus, error: Optional[str] = None) -> None:
        """Mark execution as completed."""
        self.status = status
        self.completed_at = datetime.now()
        if self.started_at:
            self.duration_ms = int((self.completed_at - self.started_at).total_seconds() * 1000)
        if error:
            self.error_message = error

    def add_step(
        self,
        description: str,
        step_type: str = "action",
        expected_result: Optional[str] = None,
    ) -> StepState:
        """Add a new step to the execution."""
        step_number = len(self.steps) + 1
        step = StepState(
            step_id=f"step-{uuid.uuid4().hex[:8]}",
            step_number=step_number,
            description=description,
            step_type=step_type,
            expected_result=expected_result,
        )
        self.steps.append(step)
        self.total_steps = len(self.steps)
        return step

    def start_step(self, step_index: int) -> Optional[StepState]:
        """Start executing a step."""
        if 0 <= step_index < len(self.steps):
            step = self.steps[step_index]
            step.status = StepStatus.RUNNING
            step.started_at = datetime.now()
            self.current_step = step_index + 1
            return step
        return None

    def complete_step(
        self,
        step_index: int,
        status: StepStatus,
        actual_result: Optional[str] = None,
        error: Optional[str] = None,
    ) -> Optional[StepState]:
        """Complete a step."""
        if 0 <= step_index < len(self.steps):
            step = self.steps[step_index]
            step.status = status
            step.completed_at = datetime.now()
            if step.started_at:
                step.duration_ms = int((step.completed_at - step.started_at).total_seconds() * 1000)
            step.actual_result = actual_result
            step.error_message = error
            return step
        return None

    def add_action_to_step(
        self,
        step_index: int,
        action_type: str,
        selector: Optional[str] = None,
        arguments: Optional[Dict[str, Any]] = None,
        tokens_used: Optional[Dict[str, Optional[int]]] = None,
    ) -> Optional[ActionRecord]:
        """Add an action to a step."""
        if 0 <= step_index < len(self.steps):
            step = self.steps[step_index]
            action = ActionRecord(
                action_id=f"action-{uuid.uuid4().hex[:8]}",
                action_type=action_type,
                selector=selector,
                arguments=arguments or {},
                tokens_used=tokens_used,
                started_at=datetime.now(),
            )
            step.actions.append(action)
            return action
        return None

    def complete_action(
        self,
        step_index: int,
        action_index: int,
        result: Dict[str, Any],
    ) -> Optional[ActionRecord]:
        """Complete an action with results."""
        if 0 <= step_index < len(self.steps):
            step = self.steps[step_index]
            if 0 <= action_index < len(step.actions):
                action = step.actions[action_index]
                action.status = result.get("status", "success")
                action.completed_at = datetime.now()
                if action.started_at:
                    action.duration_ms = int((action.completed_at - action.started_at).total_seconds() * 1000)
                action.screenshot_before = result.get("screenshotBefore")
                action.screenshot_after = result.get("screenshotAfter")
                action.error_message = result.get("errorMessage")
                action.console_logs = result.get("consoleLogs", [])
                action.network_requests = result.get("networkRequests", [])
                action.result = result

                if action.tokens_used:
                    self.total_tokens_used += action.tokens_used.get("total") or 0

                # Aggregate screenshots
                if action.screenshot_before:
                    self.all_screenshots.append(action.screenshot_before)
                if action.screenshot_after:
                    self.all_screenshots.append(action.screenshot_after)

                # Aggregate logs
                self.all_console_logs.extend(action.console_logs)
                self.all_network_requests.extend(action.network_requests)

                return action
        return None

    def set_variable(self, name: str, value: Any) -> None:
        """Set a variable for use in subsequent steps."""
        self.variables[name] = value

    def get_variable(self, name: str, default: Any = None) -> Any:
        """Get a variable value."""
        return self.variables.get(name, default)

    def get_passed_steps(self) -> int:
        """Count passed steps."""
        return sum(1 for s in self.steps if s.status == StepStatus.PASSED)

    def get_failed_steps(self) -> int:
        """Count failed steps."""
        return sum(1 for s in self.steps if s.status == StepStatus.FAILED)

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary for serialization."""
        return {
            "runId": self.run_id,
            "testId": self.test_id,
            "testName": self.test_name,
            "environment": self.environment,
            "browser": self.browser,
            "traceLevel": self.trace_level,
            "sessionId": self.session_id,
            "contextId": self.context_id,
            "pageId": self.page_id,
            "status": self.status.value,
            "currentStep": self.current_step,
            "totalSteps": self.total_steps,
            "steps": [s.to_dict() for s in self.steps],
            "startedAt": self.started_at.isoformat() if self.started_at else None,
            "completedAt": self.completed_at.isoformat() if self.completed_at else None,
            "durationMs": self.duration_ms,
            "errorMessage": self.error_message,
            "stackTrace": self.stack_trace,
            "variables": self.variables,
            "screenshotCount": len(self.all_screenshots),
            "consoleLogCount": len(self.all_console_logs),
            "networkRequestCount": len(self.all_network_requests),
            "dialogCount": len(self.all_dialogs),
            "downloadCount": len(self.all_downloads),
            "traceKey": self.trace_key,
            "videoEnabled": self.video_enabled,
            "videoPath": self.video_path,
            "videoKey": self.video_key,
            "metadata": self.metadata,
            "totalTokensUsed": self.total_tokens_used,
            "passedSteps": self.get_passed_steps(),
            "failedSteps": self.get_failed_steps(),
        }

    def to_json(self) -> str:
        """Convert to JSON string."""
        import json
        return json.dumps(self.to_dict(), indent=2, default=str)
