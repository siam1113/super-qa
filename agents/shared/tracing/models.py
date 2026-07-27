"""Tracing Models - Data models for execution traces."""
import uuid
from dataclasses import dataclass, field
from datetime import datetime
from typing import Optional, List, Dict, Any, Literal
from enum import Enum


class TraceLevel(str, Enum):
    """Level of trace detail."""
    ACTION = "action"  # Trace every browser action
    STEP = "step"      # Trace test step boundaries
    TEST = "test"      # Trace test level only
    SUITE = "suite"    # Trace suite level only


@dataclass
class TraceConfig:
    """Configuration for trace collection."""
    level: TraceLevel = TraceLevel.ACTION
    capture_screenshots: bool = True
    capture_console_logs: bool = True
    capture_network: bool = True
    max_console_logs: int = 100
    max_network_requests: int = 50
    include_base64_screenshots: bool = False
    storage_prefix: str = "traces"


@dataclass
class ConsoleLogEntry:
    """A console log entry."""
    level: str
    message: str
    timestamp: datetime = field(default_factory=datetime.now)
    source: Optional[str] = None
    line_number: Optional[int] = None
    args: List[str] = field(default_factory=list)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "level": self.level,
            "message": self.message,
            "timestamp": self.timestamp.isoformat(),
            "source": self.source,
            "lineNumber": self.line_number,
            "args": self.args,
        }


@dataclass
class NetworkRequestEntry:
    """A network request entry."""
    url: str
    method: str
    status: Optional[int] = None
    resource_type: Optional[str] = None
    timing_ms: Optional[int] = None
    timestamp: datetime = field(default_factory=datetime.now)
    failure_text: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        return {
            "url": self.url,
            "method": self.method,
            "status": self.status,
            "resourceType": self.resource_type,
            "timingMs": self.timing_ms,
            "timestamp": self.timestamp.isoformat(),
            "failureText": self.failure_text,
        }


@dataclass
class ActionTrace:
    """Trace for a single browser action."""
    trace_id: str = field(default_factory=lambda: f"act-{uuid.uuid4().hex[:8]}")
    action_type: str = ""
    selector: Optional[str] = None
    arguments: Dict[str, Any] = field(default_factory=dict)

    status: str = "pending"
    started_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None
    duration_ms: int = 0

    error_message: Optional[str] = None
    stack_trace: Optional[str] = None

    screenshot_before_key: Optional[str] = None
    screenshot_after_key: Optional[str] = None
    screenshot_before_data: Optional[str] = None  # Base64
    screenshot_after_data: Optional[str] = None   # Base64

    console_logs: List[ConsoleLogEntry] = field(default_factory=list)
    network_requests: List[NetworkRequestEntry] = field(default_factory=list)

    result: Optional[Dict[str, Any]] = None

    def start(self) -> None:
        """Mark action as started."""
        self.status = "running"
        self.started_at = datetime.now()

    def complete(self, status: str, result: Optional[Dict[str, Any]] = None) -> None:
        """Mark action as completed."""
        self.status = status
        self.completed_at = datetime.now()
        if self.started_at:
            self.duration_ms = int((self.completed_at - self.started_at).total_seconds() * 1000)
        self.result = result

    def to_dict(self) -> Dict[str, Any]:
        return {
            "traceId": self.trace_id,
            "actionType": self.action_type,
            "selector": self.selector,
            "arguments": self.arguments,
            "status": self.status,
            "startedAt": self.started_at.isoformat() if self.started_at else None,
            "completedAt": self.completed_at.isoformat() if self.completed_at else None,
            "durationMs": self.duration_ms,
            "errorMessage": self.error_message,
            "screenshotBeforeKey": self.screenshot_before_key,
            "screenshotAfterKey": self.screenshot_after_key,
            "consoleLogs": [log.to_dict() for log in self.console_logs],
            "networkRequests": [req.to_dict() for req in self.network_requests],
        }


@dataclass
class StepTrace:
    """Trace for a test step."""
    trace_id: str = field(default_factory=lambda: f"step-{uuid.uuid4().hex[:8]}")
    step_number: int = 0
    description: str = ""
    step_type: Literal["setup", "action", "assertion", "cleanup"] = "action"

    status: str = "pending"
    started_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None
    duration_ms: int = 0

    expected_result: Optional[str] = None
    actual_result: Optional[str] = None
    error_message: Optional[str] = None

    actions: List[ActionTrace] = field(default_factory=list)

    def start(self) -> None:
        """Mark step as started."""
        self.status = "running"
        self.started_at = datetime.now()

    def complete(self, status: str, actual_result: Optional[str] = None) -> None:
        """Mark step as completed."""
        self.status = status
        self.completed_at = datetime.now()
        if self.started_at:
            self.duration_ms = int((self.completed_at - self.started_at).total_seconds() * 1000)
        self.actual_result = actual_result

    def add_action(self, action: ActionTrace) -> None:
        """Add an action to this step."""
        self.actions.append(action)

    def get_screenshots(self) -> List[str]:
        """Get all screenshot keys from actions."""
        keys = []
        for action in self.actions:
            if action.screenshot_before_key:
                keys.append(action.screenshot_before_key)
            if action.screenshot_after_key:
                keys.append(action.screenshot_after_key)
        return keys

    def to_dict(self) -> Dict[str, Any]:
        return {
            "traceId": self.trace_id,
            "stepNumber": self.step_number,
            "description": self.description,
            "stepType": self.step_type,
            "status": self.status,
            "startedAt": self.started_at.isoformat() if self.started_at else None,
            "completedAt": self.completed_at.isoformat() if self.completed_at else None,
            "durationMs": self.duration_ms,
            "expectedResult": self.expected_result,
            "actualResult": self.actual_result,
            "errorMessage": self.error_message,
            "actions": [action.to_dict() for action in self.actions],
            "actionCount": len(self.actions),
            "screenshotCount": len(self.get_screenshots()),
        }


@dataclass
class TestTrace:
    """Complete trace for a test execution."""
    trace_id: str = field(default_factory=lambda: f"test-{uuid.uuid4().hex[:8]}")
    run_id: str = ""
    test_id: str = ""
    test_name: str = ""

    environment: str = ""
    browser: str = ""
    base_url: Optional[str] = None
    trace_level: TraceLevel = TraceLevel.ACTION

    status: str = "pending"
    started_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None
    duration_ms: int = 0

    error_message: Optional[str] = None
    stack_trace: Optional[str] = None

    steps: List[StepTrace] = field(default_factory=list)

    # Storage keys for artifacts
    trace_key: Optional[str] = None
    console_log_key: Optional[str] = None
    network_log_key: Optional[str] = None
    video_key: Optional[str] = None
    video_path: Optional[str] = None

    # Aggregated data
    all_screenshot_keys: List[str] = field(default_factory=list)
    all_console_logs: List[ConsoleLogEntry] = field(default_factory=list)
    all_network_requests: List[NetworkRequestEntry] = field(default_factory=list)

    metadata: Dict[str, Any] = field(default_factory=dict)

    def start(self) -> None:
        """Mark test as started."""
        self.status = "running"
        self.started_at = datetime.now()

    def complete(self, status: str, error: Optional[str] = None) -> None:
        """Mark test as completed."""
        self.status = status
        self.completed_at = datetime.now()
        if self.started_at:
            self.duration_ms = int((self.completed_at - self.started_at).total_seconds() * 1000)
        self.error_message = error

        # Aggregate data from steps
        self._aggregate_data()

    def _aggregate_data(self) -> None:
        """Aggregate data from all steps."""
        self.all_screenshot_keys = []
        for step in self.steps:
            self.all_screenshot_keys.extend(step.get_screenshots())
            for action in step.actions:
                self.all_console_logs.extend(action.console_logs)
                self.all_network_requests.extend(action.network_requests)

    def add_step(self, step: StepTrace) -> None:
        """Add a step to this test."""
        self.steps.append(step)

    def get_passed_steps(self) -> int:
        """Count passed steps."""
        return sum(1 for s in self.steps if s.status == "passed")

    def get_failed_steps(self) -> int:
        """Count failed steps."""
        return sum(1 for s in self.steps if s.status == "failed")

    def to_dict(self) -> Dict[str, Any]:
        return {
            "traceId": self.trace_id,
            "runId": self.run_id,
            "testId": self.test_id,
            "testName": self.test_name,
            "environment": self.environment,
            "browser": self.browser,
            "baseUrl": self.base_url,
            "traceLevel": self.trace_level.value,
            "status": self.status,
            "startedAt": self.started_at.isoformat() if self.started_at else None,
            "completedAt": self.completed_at.isoformat() if self.completed_at else None,
            "durationMs": self.duration_ms,
            "errorMessage": self.error_message,
            "stackTrace": self.stack_trace,
            "steps": [step.to_dict() for step in self.steps],
            "stepCount": len(self.steps),
            "passedSteps": self.get_passed_steps(),
            "failedSteps": self.get_failed_steps(),
            "traceKey": self.trace_key,
            "consoleLogKey": self.console_log_key,
            "networkLogKey": self.network_log_key,
            "videoKey": self.video_key,
            "videoPath": self.video_path,
            "screenshotCount": len(self.all_screenshot_keys),
            "consoleLogCount": len(self.all_console_logs),
            "networkRequestCount": len(self.all_network_requests),
            "metadata": self.metadata,
        }

    def to_json(self) -> str:
        """Convert to JSON string."""
        import json
        return json.dumps(self.to_dict(), indent=2, default=str)
