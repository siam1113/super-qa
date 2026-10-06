"""Type definitions for Playwright MCP Server."""
from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum
from typing import Optional, List, Dict, Any, Literal


class ActionStatus(str, Enum):
    """Status of a browser action."""
    SUCCESS = "success"
    FAILED = "failed"
    TIMEOUT = "timeout"
    ERROR = "error"


class TraceLevel(str, Enum):
    """Level of trace detail to capture."""
    ACTION = "action"
    STEP = "step"
    TEST = "test"
    SUITE = "suite"


@dataclass
class BrowserSession:
    """Represents an active browser session."""
    session_id: str
    browser_type: Literal["chromium", "firefox", "webkit"]
    headless: bool
    created_at: datetime = field(default_factory=datetime.now)
    viewport_width: int = 1280
    viewport_height: int = 720


@dataclass
class VideoConfig:
    """Configuration for video recording."""
    enabled: bool = True
    dir: str = "/tmp/videos"
    size: Optional[Dict[str, int]] = None  # {"width": 1280, "height": 720}


@dataclass
class ContextInfo:
    """Information about a browser context."""
    context_id: str
    session_id: str
    storage_state: Optional[str] = None
    locale: str = "en-US"
    timezone: str = "America/New_York"
    video_enabled: bool = False
    video_dir: Optional[str] = None
    created_at: datetime = field(default_factory=datetime.now)


@dataclass
class PageInfo:
    """Information about a browser page/tab."""
    page_id: str
    context_id: str
    url: str = ""
    title: str = ""
    created_at: datetime = field(default_factory=datetime.now)


@dataclass
class ConsoleLog:
    """A console log entry from the browser."""
    level: Literal["log", "warn", "error", "info", "debug"]
    message: str
    timestamp: datetime = field(default_factory=datetime.now)
    source: Optional[str] = None
    line_number: Optional[int] = None
    args: List[str] = field(default_factory=list)


@dataclass
class DialogRecord:
    """A JS dialog (alert/confirm/prompt) raised by the page and how it was handled."""
    dialog_type: Literal["alert", "confirm", "prompt", "beforeunload"]
    message: str
    default_value: Optional[str] = None
    accepted: bool = False
    timestamp: datetime = field(default_factory=datetime.now)


@dataclass
class DownloadRecord:
    """A file download triggered by the page."""
    url: str
    suggested_filename: str
    timestamp: datetime = field(default_factory=datetime.now)


@dataclass
class NetworkRequest:
    """A network request captured from the browser."""
    url: str
    method: str
    status: Optional[int] = None
    request_headers: Dict[str, str] = field(default_factory=dict)
    response_headers: Optional[Dict[str, str]] = None
    request_body: Optional[str] = None
    response_body: Optional[str] = None
    timing: Dict[str, float] = field(default_factory=dict)
    timestamp: datetime = field(default_factory=datetime.now)
    resource_type: Optional[str] = None
    failure_text: Optional[str] = None


@dataclass
class ScreenshotResult:
    """Result of a screenshot capture."""
    screenshot_key: str  # S3 storage key
    base64_data: Optional[str] = None  # Base64 encoded image
    width: int = 0
    height: int = 0
    format: Literal["png", "jpeg"] = "png"
    timestamp: datetime = field(default_factory=datetime.now)
    full_page: bool = False
    selector: Optional[str] = None


@dataclass
class ActionResult:
    """Result of a browser action with tracing."""
    status: ActionStatus
    action_type: str
    selector: Optional[str] = None
    duration_ms: int = 0
    screenshot_before: Optional[str] = None  # S3 key
    screenshot_after: Optional[str] = None   # S3 key
    error_message: Optional[str] = None
    stack_trace: Optional[str] = None
    timestamp: datetime = field(default_factory=datetime.now)
    console_logs: List[ConsoleLog] = field(default_factory=list)
    network_requests: List[NetworkRequest] = field(default_factory=list)
    metadata: Dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary for JSON serialization."""
        return {
            "status": self.status.value,
            "actionType": self.action_type,
            "selector": self.selector,
            "durationMs": self.duration_ms,
            "screenshotBefore": self.screenshot_before,
            "screenshotAfter": self.screenshot_after,
            "errorMessage": self.error_message,
            "stackTrace": self.stack_trace,
            "timestamp": self.timestamp.isoformat(),
            "consoleLogs": [
                {
                    "level": log.level,
                    "message": log.message,
                    "timestamp": log.timestamp.isoformat(),
                    "source": log.source,
                    "lineNumber": log.line_number,
                }
                for log in self.console_logs
            ],
            "networkRequests": [
                {
                    "url": req.url,
                    "method": req.method,
                    "status": req.status,
                    "timestamp": req.timestamp.isoformat(),
                }
                for req in self.network_requests
            ],
            "metadata": self.metadata,
        }


@dataclass
class NavigationResult(ActionResult):
    """Result of a navigation action."""
    url: str = ""
    response_status: Optional[int] = None
    response_headers: Dict[str, str] = field(default_factory=dict)


@dataclass
class AssertionResult:
    """Result of an assertion/expectation."""
    passed: bool
    assertion_type: str
    selector: Optional[str] = None
    expected: Optional[str] = None
    actual: Optional[str] = None
    screenshot: Optional[str] = None  # S3 key
    error_message: Optional[str] = None
    duration_ms: int = 0
    timestamp: datetime = field(default_factory=datetime.now)

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary for JSON serialization."""
        return {
            "passed": self.passed,
            "assertionType": self.assertion_type,
            "selector": self.selector,
            "expected": self.expected,
            "actual": self.actual,
            "screenshot": self.screenshot,
            "errorMessage": self.error_message,
            "durationMs": self.duration_ms,
            "timestamp": self.timestamp.isoformat(),
        }


@dataclass
class WaitResult:
    """Result of a wait operation."""
    success: bool
    wait_type: str
    selector: Optional[str] = None
    duration_ms: int = 0
    error_message: Optional[str] = None
    timestamp: datetime = field(default_factory=datetime.now)


@dataclass
class ElementInfo:
    """Information about a DOM element."""
    selector: str
    tag_name: str
    text_content: Optional[str] = None
    inner_html: Optional[str] = None
    attributes: Dict[str, str] = field(default_factory=dict)
    bounding_box: Optional[Dict[str, float]] = None
    is_visible: bool = True
    is_enabled: bool = True
    is_checked: Optional[bool] = None


@dataclass
class VideoResult:
    """Result of video recording."""
    video_key: str  # S3 storage key
    video_path: Optional[str] = None  # Local file path
    duration_ms: int = 0
    size_bytes: int = 0
    format: str = "webm"
    timestamp: datetime = field(default_factory=datetime.now)


@dataclass
class PlaywrightConfig:
    """Configuration for the Playwright MCP server."""
    headless: bool = True
    slow_mo: int = 0
    default_timeout: int = 30000
    viewport_width: int = 1280
    viewport_height: int = 720
    capture_screenshots: bool = True
    capture_console_logs: bool = True
    capture_network: bool = True
    capture_video: bool = True
    video_dir: str = "/tmp/qa-videos"
    video_size: Optional[Dict[str, int]] = None
    trace_level: TraceLevel = TraceLevel.ACTION
    storage_backend_url: str = "http://localhost:4000/api"
    screenshots_prefix: str = "screenshots"
    traces_prefix: str = "traces"
    videos_prefix: str = "videos"
