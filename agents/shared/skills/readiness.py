"""Readiness snapshots from configured resources and bounded real probes."""
import asyncio
import importlib.util
import json
import os
import shutil
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import List, Literal, Optional
from urllib.parse import urlsplit

from pydantic import Field, field_validator, model_validator

from .contracts import Contract, FrameworkInput, SkillBlocked
from .operations import operation
from .repository import inspect_framework
from .scope import current_scope, require_resource


class HttpProbe(Contract):
    url: str = Field(min_length=1, max_length=2000)
    expected_status: int = Field(default=200, ge=100, le=599)
    bearer_env: Optional[str] = Field(default=None, pattern=r"^[A-Z][A-Z0-9_]{0,99}$")
    allowed_cidrs: List[str] = Field(default_factory=list, max_length=20)
    revision_pointer: Optional[str] = Field(default=None, max_length=500)
    ready_pointer: Optional[str] = Field(default=None, max_length=500)

    @field_validator("allowed_cidrs")
    @classmethod
    def valid_networks(cls, values):
        import ipaddress
        return [str(ipaddress.ip_network(value)) for value in values]

    @field_validator("url")
    @classmethod
    def safe_url(cls, value):
        parsed = urlsplit(value)
        if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password or parsed.query or parsed.fragment or any(c in value for c in "\\\r\n\t "):
            raise ValueError("Readiness probes require a configured HTTPS URL without credentials, query, or fragment")
        _ = parsed.port
        return value

    @field_validator("revision_pointer", "ready_pointer")
    @classmethod
    def json_pointer(cls, value):
        if value is not None and value != "" and not value.startswith("/"):
            raise ValueError("Use an RFC 6901 JSON pointer")
        return value


class ReadinessProfile(Contract):
    environment: str = Field(min_length=1, max_length=100)
    target_id: Optional[str] = Field(default=None, min_length=1, max_length=100)
    repository_id: Optional[str] = Field(default=None, min_length=1, max_length=100)
    project_path: str = Field(default=".", max_length=300)
    framework: Optional[Literal["playwright", "cypress"]] = None
    target_probe: Optional[HttpProbe] = None
    worker_probe: Optional[HttpProbe] = None
    required_credentials: List[str] = Field(default_factory=list, max_length=20)
    required_checks: List[Literal["target_http", "target_revision", "repository", "credentials", "browser_adapter", "execution_worker"]] = Field(min_length=1, max_length=6)
    ttl_seconds: int = Field(default=60, ge=5, le=300)

    @field_validator("required_credentials")
    @classmethod
    def credential_names(cls, values):
        import re
        if any(not re.fullmatch(r"[A-Z][A-Z0-9_]{0,99}", item) for item in values):
            raise ValueError("Credentials must be environment references")
        return values

    @model_validator(mode="after")
    def distinct_checks(self):
        if len(set(self.required_checks)) != len(self.required_checks):
            raise ValueError("Readiness checks must be unique")
        return self


class ReadinessInput(Contract):
    profile_id: str = Field(min_length=1, max_length=100, pattern=r"^[a-zA-Z0-9_-]+$")
    expected_target_revision: Optional[str] = Field(default=None, min_length=1, max_length=200)
    mode: Literal["live", "configuration"] = "live"


class ReadinessCheck(Contract):
    name: str
    status: Literal["passed", "blocked", "error", "unknown"]
    message: str
    observations: dict = Field(default_factory=dict)


class ReadinessReport(Contract):
    profile_id: str
    environment: str
    mode: Literal["live", "configuration"]
    readiness: Literal["ready", "blocked"]
    checked_at: str
    expires_at: str
    checks: List[ReadinessCheck]
    blockers: List[str]
    test_verdict: None = None
    can_start_execution: bool
    basis: str


@operation("resolve_readiness_profile", "Resolve a readiness profile and its resources within the current app scope.")
def resolve_profile(value):
    require_resource("readiness_profiles", value.profile_id)
    profiles = json.loads(os.getenv("QA_READINESS_PROFILES", "{}"))
    if not isinstance(profiles, dict) or value.profile_id not in profiles:
        raise SkillBlocked("Readiness profile is not configured")
    profile = ReadinessProfile.model_validate(profiles[value.profile_id])
    if profile.target_id:
        require_resource("browser_targets", profile.target_id)
    if profile.repository_id:
        require_resource("repositories", profile.repository_id)
    return profile


def check(name, status, message, **observations):
    return {"name": name, "status": status, "message": message, "observations": observations}


@operation("inspect_readiness_configuration", "Check required credential presence, repository framework, and browser adapter installation without executing project code.",
           dependencies=("read_framework_profile",))
def inspect_configuration(profile):
    result = []
    required = set(profile.required_checks)
    if "credentials" in required:
        references = set(profile.required_credentials)
        references.update(p.bearer_env for p in (profile.target_probe, profile.worker_probe) if p and p.bearer_env)
        missing = sum(not os.getenv(name) for name in references)
        result.append(check("credentials", "blocked" if missing else "passed", "Credential references are missing" if missing else "Configured credential references are present; login validity is not established", required_count=len(references), missing_count=missing))
    if "repository" in required:
        if not profile.repository_id:
            result.append(check("repository", "blocked", "Configure a repository for this profile"))
        else:
            try:
                found = inspect_framework(FrameworkInput(repository_id=profile.repository_id, project_path=profile.project_path))
                matches = profile.framework in found["frameworks"] if profile.framework else bool(found["frameworks"])
                result.append(check("repository", "passed" if matches else "blocked", "Repository inspection completed; dependencies have not been installed or executed", frameworks=found["frameworks"], scan_truncated=found["scan_truncated"]))
            except Exception:
                result.append(check("repository", "blocked", "Configured repository could not be inspected"))
    if "browser_adapter" in required:
        bundled = Path(__file__).resolve().parents[2] / "browser-mcp" / "node_modules" / ".bin" / "agent-browser"
        configured = os.getenv("QA_AGENT_BROWSER_BIN") or (str(bundled) if bundled.is_file() else "agent-browser")
        executable = shutil.which(configured)
        mcp = importlib.util.find_spec("mcp") is not None
        result.append(check("browser_adapter", "passed" if executable and mcp else "blocked", "Browser adapter installation checked; browser launch and authenticated access are not established", executable_available=bool(executable), mcp_available=mcp))
    return result


@operation("probe_readiness_endpoint", "Make one bounded HTTPS GET to an operator-configured health endpoint; redirects and unapproved private addresses are rejected.")
async def probe_endpoint(probe):
    # The subprocess bounds DNS, connection and body reads together. Input contains
    # credential references only; the helper never outputs credential values/body.
    process = await asyncio.create_subprocess_exec(sys.executable, "-m", "shared.skills.readiness_probe",
        stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.DEVNULL,
        env={**os.environ, "PYTHONPATH": str(Path(__file__).resolve().parents[2])})
    try:
        output, _ = await asyncio.wait_for(process.communicate(json.dumps(probe.model_dump(mode="json")).encode()), timeout=15)
        if process.returncode or len(output) > 4096:
            return {"status": "error", "reason": "probe_unavailable"}
        return json.loads(output)
    except asyncio.TimeoutError:
        return {"status": "error", "reason": "timeout"}
    finally:
        if process.returncode is None:
            process.kill()
            await process.wait()


@operation("evaluate_readiness", "Combine required checks into an expiring readiness snapshot; skipped or unknown checks cannot satisfy readiness.")
def evaluate(value, profile, checks):
    observed = {item["name"]: item for item in checks}
    complete = [observed.get(name, check(name, "unknown", "No observation was produced")) for name in profile.required_checks]
    blocked = [item["name"] for item in complete if item["status"] != "passed"]
    now = datetime.now(timezone.utc)
    return ReadinessReport.model_validate({"profile_id": value.profile_id, "environment": profile.environment,
            "mode": value.mode, "readiness": "ready" if not blocked else "blocked",
            "checked_at": now.isoformat(), "expires_at": (now + timedelta(seconds=profile.ttl_seconds)).isoformat(),
            "checks": complete, "blockers": blocked, "test_verdict": None,
            "can_start_execution": current_scope().can_execute,
            "basis": "Only the configured required checks at this instant. Admission must recheck prerequisites; this snapshot does not authorize execution or establish test success."}).model_dump(mode="json")


def create_readiness_graph(skill, capabilities):
    from langgraph.graph import END, StateGraph
    from .graphs import SkillState, failure

    def prepare(state):
        try:
            value = ReadinessInput.model_validate(state["request"]["inputs"])
            profile = resolve_profile(value)
            return {"payload": value.model_dump(mode="json"), "prepared": profile.model_dump(mode="json"),
                    "trace": ["validate_input", "resolve_profile"], "model_calls": 0}
        except Exception as error:
            return {**failure(error), "trace": ["validate_input", "resolve_profile"], "model_calls": 0}

    async def inspect(state):
        try:
            value = ReadinessInput.model_validate(state["payload"])
            profile = ReadinessProfile.model_validate(state["prepared"])
            checks = inspect_configuration(profile)
            required = set(profile.required_checks)
            if required & {"target_http", "target_revision"}:
                observation = await capabilities.probe_readiness_endpoint(profile.target_probe) if value.mode == "live" and profile.target_probe else None
                if "target_http" in required:
                    checks.append(check("target_http", observation["status"] if observation else "unknown", "Configured target probe completed" if observation else "Live target probe is not configured or was not requested", **{key: value for key, value in (observation or {}).items() if key != "status"}))
                if "target_revision" in required:
                    actual = observation.get("revision") if observation else None
                    matches = observation is not None and observation["status"] == "passed" and value.expected_target_revision is not None and actual == value.expected_target_revision
                    checks.append(check("target_revision", "passed" if matches else "blocked", "Target revision matches" if matches else "A matching observed and expected target revision is required", expected=value.expected_target_revision, actual=actual))
            if "execution_worker" in required:
                observation = await capabilities.probe_readiness_endpoint(profile.worker_probe) if value.mode == "live" and profile.worker_probe and profile.worker_probe.ready_pointer is not None else None
                checks.append(check("execution_worker", observation["status"] if observation else "unknown", "Worker readiness endpoint checked" if observation else "Configure a worker health endpoint with a boolean readiness pointer and use live mode", **{key: value for key, value in (observation or {}).items() if key != "status"}))
            return {"data": evaluate(value, profile, checks), "status": "completed", "trace": state["trace"] + ["inspect_prerequisites", "evaluate_readiness"]}
        except Exception as error:
            return {**failure(error), "trace": state["trace"] + ["inspect_prerequisites"]}

    def finalize(state):
        return {"trace": state["trace"] + ["finalize"], "data": state.get("data", {})}

    graph = StateGraph(SkillState)
    graph.add_node("resolve_profile", prepare)
    graph.add_node("inspect_prerequisites", inspect)
    graph.add_node("finalize", finalize)
    graph.set_entry_point("resolve_profile")
    graph.add_conditional_edges("resolve_profile", lambda state: "finalize" if state.get("error") else "inspect_prerequisites")
    graph.add_edge("inspect_prerequisites", "finalize")
    graph.add_edge("finalize", END)
    return graph.compile()
