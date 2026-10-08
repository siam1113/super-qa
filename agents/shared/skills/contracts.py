"""Validated inputs shared by LangGraph, HTTP, CLI, and MCP callers."""
from __future__ import annotations

from typing import Dict, List, Literal, Optional
from uuid import UUID, uuid4
from datetime import datetime, timezone

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


class Contract(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


def requires_request_id(skill, inputs):
    from .registry import SKILLS
    definition = SKILLS.get(skill)
    return bool(definition and definition.requires_request_id(inputs))


class SkillRequest(Contract):
    request_id: UUID = Field(default_factory=uuid4)
    agent_type: Literal["qae", "aue"]
    skill: str = Field(min_length=1, max_length=80)
    inputs: dict
    allow_model: bool = Field(default=False, strict=True)

    @model_validator(mode="before")
    @classmethod
    def stable_execution_id(cls, value):
        if isinstance(value, dict) and requires_request_id(value.get("skill"), value.get("inputs") or {}) and not value.get("request_id"):
            raise ValueError("This workflow effect requires a caller-supplied request_id UUID for safe retries")
        return value


class Step(Contract):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=False)
    action: str = Field(min_length=1, max_length=2000)
    expected: str = Field(min_length=1, max_length=2000)


class Criterion(Contract):
    id: str = Field(min_length=1, max_length=100)
    text: str = Field(min_length=1, max_length=4000)
    steps: List[Step] = Field(default_factory=list, max_length=50)


class Requirement(Contract):
    id: str = Field(min_length=1, max_length=100)
    title: str = Field(min_length=1, max_length=500)
    criteria: List[Criterion] = Field(default_factory=list, max_length=50)
    impact: Optional[int] = Field(default=None, ge=1, le=5, strict=True)
    likelihood: Optional[int] = Field(default=None, ge=1, le=5, strict=True)
    evidence_ids: List[str] = Field(default_factory=list, max_length=30)


class ArtifactPin(Contract):
    request_id: UUID
    content_hash: str = Field(pattern=r"^[a-f0-9]{64}$")
    current_snapshot_hash: Optional[str] = Field(default=None, pattern=r"^[a-f0-9]{64}$",
        description="Required for supplied requirement snapshots; asserts the caller's current revision, not an independently verified upstream revision")


class RequirementsInput(Contract):
    requirements: List[Requirement] = Field(default_factory=list, max_length=100)
    requirement_review: Optional[ArtifactPin] = None

    @model_validator(mode="after")
    def unique_ids(self):
        if bool(self.requirements) == (self.requirement_review is not None):
            raise ValueError("Supply requirements or a pinned requirement_review artifact, exclusively")
        ids = [item.id for item in self.requirements]
        criteria = [criterion.id for item in self.requirements for criterion in item.criteria]
        if len(set(ids)) != len(ids) or len(set(criteria)) != len(criteria):
            raise ValueError("Requirement IDs and criterion IDs must each be unique")
        return self


class PlanInput(RequirementsInput):
    environments: List[str] = Field(default_factory=list, max_length=20)
    test_types: List[Literal["functional", "api", "integration", "accessibility", "security", "performance"]] = Field(default_factory=lambda: ["functional"], max_length=6)


class DesignInput(RequirementsInput):
    preconditions: List[str] = Field(default_factory=list, max_length=30)


class Case(Contract):
    id: str = Field(min_length=1, max_length=150)
    title: str = Field(min_length=1, max_length=500)
    revision: int = Field(default=1, ge=1, strict=True)
    requirement_ids: List[str] = Field(min_length=1, max_length=100)
    criterion_ids: List[str] = Field(default_factory=list, max_length=100)
    preconditions: List[str] = Field(default_factory=list, max_length=30)
    steps: List[Step] = Field(min_length=1, max_length=50)


class Execution(Contract):
    id: str = Field(min_length=1, max_length=100)
    case_id: str = Field(min_length=1, max_length=150)
    case_revision: int = Field(ge=1, strict=True)
    status: Literal["passed", "failed", "error", "blocked", "cancelled", "queued", "running"]
    environment: str = Field(min_length=1, max_length=100)
    target_revision: str = Field(min_length=1, max_length=100)
    evidence_ids: List[str] = Field(default_factory=list, max_length=30)
    error: str = Field(default="", max_length=4000)


class CoverageInput(RequirementsInput):
    cases: List[Case] = Field(default_factory=list, max_length=500)
    case_artifact: Optional[ArtifactPin] = None
    executions: List[Execution] = Field(default_factory=list, max_length=1000)

    @model_validator(mode="after")
    def artifact_cases(self):
        if self.case_artifact and (self.cases or not self.requirement_review):
            raise ValueError("A case_artifact requires requirement_review and no inline cases")
        return self


class MatrixInput(Contract):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=False)
    dimensions: Dict[str, List[str]]
    exclude: List[Dict[str, str]] = Field(default_factory=list, max_length=100)
    max_rows: int = Field(default=256, ge=1, le=1000, strict=True)

    @field_validator("dimensions")
    @classmethod
    def bounded_dimensions(cls, value):
        if not 1 <= len(value) <= 8 or any(not key.strip() or len(key) > 80 or not 1 <= len(values) <= 30 or len(values) != len(set(values)) or any(len(item) > 200 for item in values) for key, values in value.items()):
            raise ValueError("Supply 1–8 named dimensions, each with 1–30 unique values of at most 200 characters")
        return value

    @model_validator(mode="after")
    def valid_exclusions(self):
        for exclusion in self.exclude:
            if not exclusion or any(key not in self.dimensions or value not in self.dimensions[key] for key, value in exclusion.items()):
                raise ValueError("Exclusions must refer to existing dimension values")
        return self


class FrameworkInput(Contract):
    repository_id: str = Field(min_length=1, max_length=100, pattern=r"^[a-zA-Z0-9_-]+$")
    project_path: str = Field(default=".", min_length=1, max_length=300)


class BrowserStep(Contract):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=False)
    operation: Literal["goto", "fill", "click", "check", "assert_text", "assert_visible", "assert_count"]
    selector: Optional[str] = Field(default=None, min_length=1, max_length=300)
    value: Optional[str] = Field(default=None, max_length=2000)
    path: Optional[str] = Field(default=None, min_length=1, max_length=1000)
    count: Optional[int] = Field(default=None, ge=0, le=10000, strict=True)

    @model_validator(mode="after")
    def required_arguments(self):
        if self.operation == "goto":
            if not self.path or not self.path.startswith("/") or self.path.startswith("//") or "\\" in self.path or any(ord(c) < 32 for c in self.path):
                raise ValueError("Navigation requires an application-relative path")
        elif not self.selector:
            raise ValueError("This operation requires a selector")
        if self.operation in ("fill", "assert_text") and self.value is None:
            raise ValueError("This operation requires a value")
        if self.operation == "assert_count" and self.count is None:
            raise ValueError("assert_count requires count")
        return self


class AutomationInput(FrameworkInput):
    framework: Optional[Literal["playwright", "cypress"]] = None
    title: str = Field(min_length=1, max_length=300)
    test_file: str = Field(min_length=1, max_length=300)
    test_import: Optional[str] = Field(default=None, min_length=1, max_length=300)
    steps: List[BrowserStep] = Field(min_length=2, max_length=50)

    @model_validator(mode="after")
    def has_oracle(self):
        if self.steps[0].operation != "goto":
            raise ValueError("The first step must navigate to the application")
        if not any(step.operation.startswith("assert_") for step in self.steps):
            raise ValueError("At least one explicit assertion is required")
        return self


class ActionBinding(Contract):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=False)
    operation: Literal["click", "fill", "check"]
    value: Optional[str] = Field(default=None, max_length=1000)

    @model_validator(mode="after")
    def fill_value(self):
        if self.operation == "fill" and self.value is None:
            raise ValueError("fill requires a value")
        if self.operation != "fill" and self.value is not None:
            raise ValueError("Only fill accepts a value")
        return self


class ExecuteInput(Contract):
    proposal_run_id: UUID
    target_id: str = Field(min_length=1, max_length=100, pattern=r"^[a-zA-Z0-9_-]+$")
    actor: str = Field(min_length=1, max_length=200)
    preconditions_confirmed: Literal[True]
    bindings: List[ActionBinding] = Field(min_length=1, max_length=20)

    @field_validator("preconditions_confirmed", mode="before")
    @classmethod
    def explicit_confirmation(cls, value):
        if value is not True:
            raise ValueError("Preconditions must be explicitly confirmed with true")
        return value


class ExecutionStatusInput(Contract):
    execution_id: UUID


class ExploreAction(Contract):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=False)
    action: Literal["click", "fill", "check", "uncheck", "select", "hover", "wait"]
    selector: Optional[str] = Field(default=None, min_length=1, max_length=500)
    role: Optional[str] = Field(default=None, min_length=1, max_length=80)
    name: Optional[str] = Field(default=None, max_length=300)
    value: Optional[str] = Field(default=None, max_length=4000)

    @model_validator(mode="after")
    def arguments(self):
        if bool(self.selector) == bool(self.role) or (self.role is not None) != (self.name is not None):
            raise ValueError("Supply either a CSS selector or an exact accessible role and name")
        if self.selector and self.selector.startswith(("@", "-")):
            raise ValueError("Use a stable CSS selector or role/name; refs expire with the browser session")
        if (self.action in ("fill", "select")) != (self.value is not None):
            raise ValueError("Only fill/select require a value")
        return self


class ExploreInput(Contract):
    target_id: Optional[str] = Field(default=None, min_length=1, max_length=100, pattern=r"^[a-zA-Z0-9_-]+$")
    url: Optional[str] = Field(default=None, min_length=1, max_length=2000)
    mode: Literal["auto", "live", "static_bundle"] = "auto"
    start_path: Optional[str] = Field(default=None, min_length=1, max_length=1000)
    max_pages: int = Field(default=10, ge=1, le=25, strict=True)
    max_depth: int = Field(default=2, ge=0, le=4, strict=True)
    max_commands: int = Field(default=60, ge=5, le=240, strict=True)
    authenticate: bool = Field(default=False, strict=True)
    actions: List[ExploreAction] = Field(default_factory=list, max_length=20)
    # Free-text steering for live mode's agentic exploration loop (see exploration.py):
    # what feature/tab/flow to navigate toward and interact with. Unset means a broad,
    # human-like tour of the whole app rather than a targeted one. Not used by static_bundle.
    goal: Optional[str] = Field(default=None, max_length=1000)
    # Caps LLM-decided actions in the agentic loop, independent of max_pages/max_commands.
    max_actions: int = Field(default=20, ge=1, le=50, strict=True)
    # Wall-clock budget for the whole live session (see explore_live's asyncio.wait_for).
    # Named levels (quick/standard/deep/exhaustive) are a caller-side convenience that
    # picks this plus max_pages/max_actions/max_commands together — see qa.service.ts's
    # LEVEL_PRESETS — this field itself just takes whatever number it's given.
    time_budget_seconds: int = Field(default=240, ge=30, le=600, strict=True)
    # Purely textual: steers how thoroughly build_agentic_system_prompt tells the model to
    # dig into each area before moving on. Doesn't itself change any budget — the caller
    # (e.g. qa.service.ts's level presets) is expected to pass matching budget numbers above.
    level: Literal["quick", "standard", "deep", "exhaustive"] = "standard"

    @field_validator("goal")
    @classmethod
    def normalize_goal(cls, value):
        return value if value and value.strip() else None

    @field_validator("start_path")
    @classmethod
    def local_path(cls, value):
        if value is not None and (not value.startswith("/") or value.startswith("//") or "\\" in value or any(ord(c) < 32 for c in value)):
            raise ValueError("Use an application-relative path, optionally with query/fragment")
        return value

    @field_validator("url")
    @classmethod
    def adhoc_url(cls, value):
        if value is None:
            return value
        from urllib.parse import urlsplit
        parsed = urlsplit(value)
        if parsed.scheme not in ("http", "https") or not parsed.hostname or parsed.username or parsed.password:
            raise ValueError("url must be an HTTP(S) address without embedded credentials")
        return value

    @model_validator(mode="after")
    def exactly_one_target(self):
        if bool(self.target_id) == bool(self.url):
            raise ValueError("Supply exactly one of target_id (a configured workspace target, see list_workflow_resources) or url (ad-hoc exploration of any address the user gave)")
        if self.url is not None:
            if self.mode == "static_bundle":
                raise ValueError("Ad-hoc url exploration only supports live mode")
            if self.authenticate:
                raise ValueError("Ad-hoc url exploration has no configured auth profile; sign in with explicit fill/click actions instead")
        return self


class FailureInput(Contract):
    executions: List[Execution] = Field(min_length=1, max_length=1000)


class OperationTrace(Contract):
    name: str
    status: Literal["running", "completed", "failed", "interrupted"]


class ArtifactReference(Contract):
    artifact_id: UUID
    scope_id: str
    artifact_type: str
    schema_version: Literal[1] = 1
    content_hash: str = Field(pattern=r"^[a-f0-9]{64}$")
    producer: str
    producer_version: Literal[1] = 1
    created_at: str


class ExecutionJobReference(Contract):
    job_id: UUID
    provider: Literal["browser_harness", "autonomy"]
    state: Literal["queued", "running", "completed", "cancelled", "interrupted"]
    verdict: Optional[Literal["passed", "failed", "error", "blocked"]] = None
    source_status: str


class SkillResult(Contract):
    request_id: str
    agent_type: Literal["qae", "aue"]
    skill: str
    version: int = 1
    status: Literal["running", "completed", "blocked", "failed", "interrupted"]
    summary: str
    data: dict = Field(default_factory=dict)
    warnings: List[str] = Field(default_factory=list)
    model_calls: Optional[int] = 0
    trace: List[str] = Field(default_factory=list)
    tool_trace: List[OperationTrace] = Field(default_factory=list)
    created_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    artifact: Optional[ArtifactReference] = None
    publication: Literal["local", "pending", "published"] = "local"
    jobs: List[ExecutionJobReference] = Field(default_factory=list)


class SkillBlocked(Exception):
    """A missing prerequisite, never a successful QA result."""
