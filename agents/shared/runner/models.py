"""Data models for Test Runner Service."""
from enum import Enum
from dataclasses import dataclass, field
from datetime import datetime
from typing import Optional, List, Dict, Any


class RunStatus(str, Enum):
    """Status of a test run."""
    QUEUED = "queued"
    RUNNING = "running"
    PASSED = "passed"
    FAILED = "failed"
    ERROR = "error"
    CANCELLED = "cancelled"


@dataclass
class TestStep:
    """A single step in a test execution."""
    number: int
    action: str
    expected: str
    actual: Optional[str] = None
    status: RunStatus = RunStatus.QUEUED
    duration_ms: int = 0
    screenshot: Optional[str] = None
    error: Optional[str] = None
    # MCP-based execution fields
    mcp_tool: Optional[str] = None
    selector: Optional[str] = None
    screenshot_before: Optional[str] = None
    screenshot_after: Optional[str] = None
    console_logs: List[str] = field(default_factory=list)
    network_requests: List[str] = field(default_factory=list)
    trace_id: Optional[str] = None


@dataclass
class TestResult:
    """Result of a single test case execution."""
    test_id: str
    test_name: str
    status: RunStatus
    duration_ms: int
    started_at: datetime
    completed_at: Optional[datetime] = None
    steps: List[TestStep] = field(default_factory=list)
    error_message: Optional[str] = None
    stack_trace: Optional[str] = None
    screenshots: List[str] = field(default_factory=list)
    video: Optional[str] = None
    logs: List[str] = field(default_factory=list)
    metadata: Dict[str, Any] = field(default_factory=dict)
    # MCP-based execution fields
    trace_key: Optional[str] = None
    browser_session_id: Optional[str] = None
    execution_mode: str = "mcp"  # "mcp" or "legacy"
    console_log_count: int = 0
    network_request_count: int = 0


@dataclass
class TestRun:
    """A test execution run (single test or suite)."""
    run_id: str
    status: RunStatus
    test_ids: List[str]
    environment: str
    browser: str = "chromium"
    parallel: bool = True
    max_workers: int = 4
    created_at: datetime = field(default_factory=datetime.now)
    started_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None
    results: List[TestResult] = field(default_factory=list)
    total_tests: int = 0
    passed: int = 0
    failed: int = 0
    error: int = 0
    skipped: int = 0
    progress: float = 0.0

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary for JSON serialization."""
        return {
            "runId": self.run_id,
            "status": self.status.value,
            "testIds": self.test_ids,
            "environment": self.environment,
            "browser": self.browser,
            "parallel": self.parallel,
            "createdAt": self.created_at.isoformat(),
            "startedAt": self.started_at.isoformat() if self.started_at else None,
            "completedAt": self.completed_at.isoformat() if self.completed_at else None,
            "totalTests": self.total_tests,
            "passed": self.passed,
            "failed": self.failed,
            "error": self.error,
            "skipped": self.skipped,
            "progress": self.progress,
            "results": [
                {
                    "testId": r.test_id,
                    "testName": r.test_name,
                    "status": r.status.value,
                    "durationMs": r.duration_ms,
                    "errorMessage": r.error_message,
                    "screenshots": r.screenshots,
                }
                for r in self.results
            ],
        }
