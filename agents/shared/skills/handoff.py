"""Read pinned artifacts in trusted scope and recheck requirement revisions on use."""
import hashlib
import hmac
import json
import os
import time

import httpx

from .artifacts import seal_result
from .contracts import Case, SkillBlocked, SkillResult
from .operations import operation
from .requirements_review import RequirementReviewReport, ReviewRequirementsInput, content_hash, resolve_snapshot
from .scope import current_scope


@operation("read_pinned_workflow_artifact", "Read an immutable, hash-pinned artifact in the current app; verify producer, version and terminal workflow state.")
async def read_artifact(pin, producer, store=None):
    scope = current_scope().identity
    role, skill = producer.split(".", 1)
    if store is None:
        from .runtime import get_runtime
        store = get_runtime().store
    if store.scope_identity != scope:
        raise SkillBlocked("Artifact store belongs to another app scope")
    result = store.get(str(pin.request_id), role)
    if result is None and scope != "local":
        key = os.getenv("AGENT_MEMORY_SIGNING_KEY", "")
        if len(key) < 32:
            raise SkillBlocked("Shared artifact retrieval is not configured")
        timestamp = str(int(time.time() * 1000))
        signed = "qa-workflow-read-v1\n" + "\n".join((timestamp, scope, str(pin.request_id)))
        signature = hmac.new(key.encode(), signed.encode(), hashlib.sha256).hexdigest()
        base = os.getenv("BACKEND_API_URL", "http://localhost:4000/api").rstrip("/")
        async with httpx.AsyncClient(timeout=10, follow_redirects=False) as client:
            async with client.stream("GET", base + "/workflow-artifacts/" + scope + "/" + str(pin.request_id),
                    headers={"x-workflow-timestamp": timestamp, "x-workflow-signature": signature}) as response:
                if response.status_code != 200:
                    raise SkillBlocked("Pinned artifact is unavailable in this app's shared store")
                body = bytearray()
                async for chunk in response.aiter_bytes():
                    body.extend(chunk)
                    if len(body) > 3000000:
                        raise SkillBlocked("Shared artifact exceeds its retrieval budget")
        envelope = json.loads(body)
        payload = envelope.get("resultJson")
        if not isinstance(payload, str) or envelope.get("requestId") != str(pin.request_id) or hashlib.sha256(payload.encode()).hexdigest() != pin.content_hash or envelope.get("contentHash") != pin.content_hash:
            raise SkillBlocked("Shared artifact did not match the pinned content hash")
        result = json.loads(payload)
    if result is None:
        raise SkillBlocked("Pinned workflow artifact was not found")
    result = SkillResult.model_validate(result).model_dump(mode="json")
    if result["request_id"] != str(pin.request_id) or result["agent_type"] != role or result["skill"] != skill or result["version"] != 1 or result["status"] != "completed":
        raise SkillBlocked("Artifact has an unsupported producer/version or is not a completed workflow")
    reference, _ = seal_result(result, scope)
    if reference["content_hash"] != pin.content_hash:
        raise SkillBlocked("Artifact content no longer matches its pinned hash")
    return result, reference


@operation("resolve_artifact_inputs", "Resolve requirement/case handoffs, reject changed requirement revisions, and retain draft provenance without granting execution approval.",
           dependencies=("read_pinned_workflow_artifact", "resolve_requirement_revision"))
async def resolve_inputs(value, store=None):
    payload = value.model_dump(mode="json")
    pin = getattr(value, "requirement_review", None)
    if pin is None:
        return {"inputs": payload, "provenance": None}
    result, reference = await read_artifact(pin, "qae.review_requirements", store)
    report = RequirementReviewReport.model_validate(result["data"])
    if content_hash(report.snapshot.model_dump(mode="json")) != report.snapshot_hash:
        raise SkillBlocked("Requirement review snapshot has inconsistent revision metadata")
    if report.review_state in ("stale", "incomplete") or report.freshness == "changed_during_review":
        raise SkillBlocked("Requirement review is stale or incomplete; review the current snapshot")
    if pin.current_snapshot_hash and pin.current_snapshot_hash != report.snapshot_hash:
        raise SkillBlocked("Current requirement snapshot does not match this review")
    if report.profile_id:
        resolve_snapshot(ReviewRequirementsInput(profile_id=report.profile_id, expected_snapshot_hash=report.snapshot_hash))
    elif pin.current_snapshot_hash is None:
        raise SkillBlocked("Supplied snapshots require current_snapshot_hash on handoff; current upstream revision cannot be inferred")
    payload["requirements"] = [item.model_dump(mode="json") for item in report.snapshot.requirements]
    payload["requirement_review"] = None
    provenance = {"requirement_review": reference, "snapshot_hash": report.snapshot_hash, "profile_id": report.profile_id,
                  "freshness_basis": "configured_snapshot_rechecked" if report.profile_id else "caller_asserted_snapshot_hash",
                  "review_state": report.review_state, "unresolved_finding_count": report.finding_count,
                  "execution_authorized": False}
    case_pin = getattr(value, "case_artifact", None)
    if case_pin:
        case_result, case_reference = await read_artifact(case_pin, "qae.design_test_cases", store)
        case_provenance = case_result["data"].get("input_provenance")
        if not isinstance(case_provenance, dict) or case_provenance.get("snapshot_hash") != report.snapshot_hash:
            raise SkillBlocked("Case artifact has missing or different requirement revision provenance")
        if case_pin.current_snapshot_hash and case_pin.current_snapshot_hash != report.snapshot_hash:
            raise SkillBlocked("Case artifact pin names a different requirement snapshot")
        cases = case_result["data"].get("cases")
        if not isinstance(cases, list) or not 1 <= len(cases) <= 500:
            raise SkillBlocked("Case artifact has no bounded case list")
        payload["cases"] = [Case.model_validate({key: item[key] for key in Case.model_fields if key in item}).model_dump(mode="json") for item in cases]
        payload["case_artifact"] = None
        provenance["case_artifact"] = case_reference
        provenance["case_review_status"] = "draft"
    return {"inputs": payload, "provenance": provenance}
