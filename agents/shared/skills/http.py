"""Internal workflow API. Use a separate deployment key, never an unguarded run route."""
import hmac
import os
from typing import Literal, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import Field

from .contracts import ExecutionStatusInput, SkillRequest
from .suites import JobInput
from .registry import catalog, get_skill
from .runtime import RequestConflict, get_runtime
from .scope import available_resources, workflow_scope


def authorize(x_qa_workflow_key: str = Header(default="")):
    expected = os.getenv("QA_WORKFLOW_KEY", "")
    if len(expected) < 32:
        raise HTTPException(status_code=503, detail="QA workflow access is not configured")
    if not hmac.compare_digest(x_qa_workflow_key.encode(), expected.encode()):
        raise HTTPException(status_code=401, detail="Invalid workflow credential")


router = APIRouter(prefix="/workflows", dependencies=[Depends(authorize)])


@router.get("/skills/{agent_type}")
async def skills(agent_type: Literal["qae", "aue"]):
    return catalog(agent_type)


class WorkflowRunRequest(SkillRequest):
    # Scope carried by trusted server-to-server callers (e.g. Outpost) so a
    # headless run resolves the calling project's resources instead of the
    # single global QA_WORKFLOW_SCOPE fallback. Absent for legacy callers.
    project_id: Optional[str] = None
    can_execute: bool = Field(default=False, strict=True)


@router.post("/runs")
async def run(request: WorkflowRunRequest):
    try:
        # Explicit input bypasses the conversational model loop.
        if request.project_id:
            with workflow_scope(request.project_id, request.can_execute):
                return await get_runtime().run(request)
        return await get_runtime().run(request)
    except RequestConflict as error:
        raise HTTPException(status_code=409, detail=str(error)) from error
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error


@router.get("/resources/{agent_type}")
async def resources(agent_type: Literal["qae", "aue"]):
    return available_resources(agent_type)


@router.get("/runs/{agent_type}/{request_id}")
async def status(agent_type: Literal["qae", "aue"], request_id: UUID):
    result = get_runtime().store.get(request_id, agent_type)
    if result is None:
        raise HTTPException(status_code=404, detail="Workflow run not found")
    return result


@router.get("/graphs/{agent_type}/{skill_name}")
async def graph(agent_type: Literal["qae", "aue"], skill_name: str):
    try:
        get_skill(skill_name, agent_type)
        return {"mermaid": get_runtime().graph(skill_name, agent_type).get_graph().draw_mermaid()}
    except ValueError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error


@router.get("/jobs/{agent_type}/{execution_id}")
async def execution_job(agent_type: Literal["qae", "aue"], execution_id: UUID, provider: Literal["browser_harness", "autonomy"] = "browser_harness", suite_profile_id: str = None):
    return await get_runtime().capabilities.lookup_job(JobInput(execution_id=execution_id, provider=provider, suite_profile_id=suite_profile_id))


@router.post("/jobs/{agent_type}/{execution_id}/cancel")
async def cancel_job(agent_type: Literal["qae", "aue"], execution_id: UUID, provider: Literal["browser_harness", "autonomy"] = "browser_harness", suite_profile_id: str = None):
    return await get_runtime().capabilities.lookup_job(JobInput(execution_id=execution_id, provider=provider, suite_profile_id=suite_profile_id), cancel=True)
