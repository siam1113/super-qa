"""Versioned requirement snapshots, deterministic review and cited model proposals."""
import asyncio
import hashlib
import json
import os
import re
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import List, Literal, Optional

from pydantic import Field, model_validator

from .contracts import Contract, Requirement, RequirementsInput, SkillBlocked
from .operations import operation
from .scope import require_resource


def content_hash(value):
    return hashlib.sha256(json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False).encode()).hexdigest()


class RequirementSource(Contract):
    id: str = Field(min_length=1, max_length=100)
    revision: str = Field(min_length=1, max_length=200)
    text: str = Field(min_length=1, max_length=32000)


class RequirementSnapshot(Contract):
    schema_version: Literal[1] = 1
    requirements: List[Requirement] = Field(min_length=1, max_length=100)
    sources: List[RequirementSource] = Field(default_factory=list, max_length=100)

    @model_validator(mode="after")
    def bounded_unique_snapshot(self):
        RequirementsInput(requirements=self.requirements)
        if len({source.id for source in self.sources}) != len(self.sources):
            raise ValueError("Source IDs must be unique")
        if len(json.dumps(self.model_dump(mode="json"), ensure_ascii=False).encode()) > 128000:
            raise ValueError("Requirement snapshot exceeds the 128 KB review budget")
        return self


class ReviewRequirementsInput(Contract):
    profile_id: Optional[str] = Field(default=None, pattern=r"^[a-zA-Z0-9_-]{1,100}$")
    snapshot: Optional[RequirementSnapshot] = None
    expected_snapshot_hash: Optional[str] = Field(default=None, pattern=r"^[a-f0-9]{64}$")
    mode: Literal["structural", "semantic"] = "structural"

    @model_validator(mode="after")
    def one_source(self):
        if (self.profile_id is None) == (self.snapshot is None):
            raise ValueError("Supply exactly one of profile_id or snapshot")
        return self


class ReviewCitation(Contract):
    field: str = Field(min_length=1, max_length=300)
    quote: str = Field(min_length=1, max_length=4000)
    field_hash: str = Field(pattern=r"^[a-f0-9]{64}$")


class ProposedFinding(Contract):
    kind: Literal["ambiguity", "possible_contradiction", "missing_expectation"]
    question: str = Field(min_length=1, max_length=1000)
    citations: List[ReviewCitation] = Field(min_length=1, max_length=4)


class SemanticReview(Contract):
    findings: List[ProposedFinding] = Field(max_length=20)


class ReviewFinding(Contract):
    id: str
    kind: str
    origin: Literal["deterministic_check", "model_proposal"]
    severity: Literal["gap", "question"]
    message: str
    question: str
    citations: List[ReviewCitation]
    requirement_ids: List[str] = Field(default_factory=list)
    criterion_ids: List[str] = Field(default_factory=list)


class RequirementReviewReport(Contract):
    schema_version: Literal[1] = 1
    snapshot: RequirementSnapshot
    snapshot_hash: str
    requirement_hashes: dict
    source_revisions: dict
    profile_id: Optional[str]
    provenance: Literal["configured_snapshot", "supplied_snapshot"]
    checked_at: str
    freshness: Literal["matches_configured_snapshot", "changed_during_review", "supplied_snapshot_only"]
    review_state: Literal["needs_clarification", "no_structural_gaps", "incomplete", "stale"]
    semantic_status: Literal["not_requested", "completed", "blocked", "failed"]
    findings: List[ReviewFinding]
    finding_count: int
    findings_truncated: bool
    execution_authorized: Literal[False] = False
    test_verdict: None = None
    basis: str


@operation("resolve_requirement_revision", "Read a bounded configured requirement snapshot within app scope or hash an explicitly supplied snapshot.")
def resolve_snapshot(value):
    if value.profile_id:
        require_resource("requirement_profiles", value.profile_id)
        configured = json.loads(os.getenv("QA_REQUIREMENT_PROFILES", "{}"))
        path = configured.get(value.profile_id) if isinstance(configured, dict) else None
        if not isinstance(path, str) or not Path(path).is_absolute():
            raise SkillBlocked("Configure this requirement profile with an absolute JSON snapshot path")
        try:
            if not Path(path).is_file():
                raise SkillBlocked("Configured requirement snapshot is not a regular file")
            with Path(path).open("rb") as source:
                raw = source.read(256001)
            if len(raw) > 256000:
                raise SkillBlocked("Configured requirement snapshot exceeds its file budget")
            snapshot = RequirementSnapshot.model_validate_json(raw)
        except (OSError, ValueError) as error:
            raise SkillBlocked("Configured requirement snapshot is unavailable or invalid") from error
    else:
        snapshot = value.snapshot
    data = snapshot.model_dump(mode="json")
    digest = content_hash(data)
    if value.expected_snapshot_hash and digest != value.expected_snapshot_hash:
        raise SkillBlocked("Requirement revision changed; refresh the snapshot and review it again")
    return {"snapshot": data, "snapshot_hash": digest, "profile_id": value.profile_id,
            "provenance": "configured_snapshot" if value.profile_id else "supplied_snapshot"}


def indexed_fields(snapshot):
    fields = {}
    def add(path, text, requirement_id=None, criterion_id=None):
        fields[path] = {"text": text, "field_hash": content_hash(text),
                        "requirement_id": requirement_id, "criterion_id": criterion_id}
    for index, requirement in enumerate(snapshot.requirements):
        prefix = f"/requirements/{index}"
        add(prefix + "/title", requirement.title, requirement.id)
        for offset, criterion in enumerate(requirement.criteria):
            path = prefix + f"/criteria/{offset}"
            add(path + "/text", criterion.text, requirement.id, criterion.id)
            for step_index, step in enumerate(criterion.steps):
                add(path + f"/steps/{step_index}/action", step.action, requirement.id, criterion.id)
                add(path + f"/steps/{step_index}/expected", step.expected, requirement.id, criterion.id)
    for index, source in enumerate(snapshot.sources):
        add(f"/sources/{index}/text", source.text)
    return fields


def citation(fields, path):
    return {"field": path, "quote": fields[path]["text"][:4000], "field_hash": fields[path]["field_hash"]}


def finding(kind, message, question, citations, requirements=(), criteria=(), origin="deterministic_check", severity="gap"):
    value = {"kind": kind, "origin": origin, "severity": severity, "message": message,
             "question": question, "citations": citations, "requirement_ids": list(requirements), "criterion_ids": list(criteria)}
    return ReviewFinding(id="RF-" + content_hash(value)[:24], **value).model_dump(mode="json")


@operation("validate_criteria_structure", "Report missing criteria, source links, executable steps, duplicate criteria and explicit placeholder language without inferring product behavior.")
def inspect_structure(snapshot):
    fields = indexed_fields(snapshot)
    findings = []
    total = 0
    def append(item):
        nonlocal total
        total += 1
        if len(findings) < 200:
            findings.append(item)
    sources = {source.id for source in snapshot.sources}
    texts = defaultdict(list)
    for index, requirement in enumerate(snapshot.requirements):
        path = f"/requirements/{index}/title"
        cite = [citation(fields, path)]
        if not requirement.criteria:
            append(finding("missing_criteria", "No acceptance criteria were supplied.", "What observable outcomes define acceptance?", cite, [requirement.id]))
        if not requirement.evidence_ids or set(requirement.evidence_ids) - sources:
            append(finding("missing_source_link", "Source links are absent or unresolved in this snapshot.", "Which versioned source supports this requirement?", cite, [requirement.id]))
        for offset, criterion in enumerate(requirement.criteria):
            path = f"/requirements/{index}/criteria/{offset}/text"
            cite = [citation(fields, path)]
            texts[" ".join(criterion.text.casefold().split())].append((requirement.id, criterion.id, cite[0]))
            if not criterion.steps:
                append(finding("missing_procedure", "No explicit action/expected-result steps were supplied; the criterion may still describe an expectation.", "What actions and observations will demonstrate this criterion?", cite, [requirement.id], [criterion.id]))
            for step_index, step in enumerate(criterion.steps):
                if not step.action.strip() or not step.expected.strip():
                    append(finding("blank_step", "An action or expected result contains only whitespace.", "What action and observable expected result are required?", cite, [requirement.id], [criterion.id]))
                if re.fullmatch(r"\s*(?:TBD|TODO|TBC|N/?A|\?+)\s*[.!]?\s*", step.expected, re.IGNORECASE):
                    expected_path = f"/requirements/{index}/criteria/{offset}/steps/{step_index}/expected"
                    append(finding("placeholder_expectation", "An expected result is only a placeholder.", "What observable result should this action produce?", [citation(fields, expected_path)], [requirement.id], [criterion.id]))
            if re.search(r"\b(TBD|TODO|TBC|etc|appropriate|user.friendly|quickly)\b", criterion.text, re.IGNORECASE):
                append(finding("language_hint", "A placeholder or context-dependent expression was found; this is a lexical hint, not a proven ambiguity.", "Does this expression need an explicit measurable expectation?", cite, [requirement.id], [criterion.id], severity="question"))
    for entries in texts.values():
        if len(entries) > 1:
            append(finding("duplicate_criterion_text", "Multiple criteria contain the same normalized text.", "Are these separate acceptance obligations or duplicate entries?", [entry[2] for entry in entries[:4]], [entry[0] for entry in entries], [entry[1] for entry in entries], severity="question"))
    return {"findings": findings, "finding_count": total, "findings_truncated": total > len(findings)}


@operation("validate_requirement_citations", "Reject unknown fields, mismatched hashes, non-exact quotes and ungrounded contradiction proposals.")
def validate_proposals(raw, snapshot):
    proposals = SemanticReview.model_validate(raw)
    fields = indexed_fields(snapshot)
    findings = []
    for item in proposals.findings:
        linked = []
        for cite in item.citations:
            field = fields.get(cite.field)
            if not field or cite.field_hash != field["field_hash"] or not cite.quote.strip() or cite.quote not in field["text"]:
                raise SkillBlocked("Semantic review returned an unverifiable citation; no model findings were accepted")
            linked.append(field)
        if item.kind == "possible_contradiction" and len({cite.field for cite in item.citations}) < 2:
            raise SkillBlocked("A possible contradiction must cite at least two distinct fields")
        findings.append(finding(item.kind, "Unverified semantic review proposal; cited text is verified, its interpretation is not.", item.question,
            [cite.model_dump() for cite in item.citations], sorted({field["requirement_id"] for field in linked if field["requirement_id"]}),
            sorted({field["criterion_id"] for field in linked if field["criterion_id"]}), origin="model_proposal", severity="question"))
    return list({item["id"]: item for item in findings}.values())


@operation("assemble_requirement_assessment", "Produce an immutable snapshot assessment with separate structural gaps, semantic proposals and revision freshness.")
def assemble_report(prepared, structural, proposed, semantic_status, fresh):
    snapshot = RequirementSnapshot.model_validate(prepared["snapshot"])
    count = structural["finding_count"] + len(proposed)
    review_state = "stale" if not fresh else "incomplete" if semantic_status in ("failed", "blocked") else "needs_clarification" if count else "no_structural_gaps"
    return RequirementReviewReport(**prepared,
        requirement_hashes={item.id: content_hash(item.model_dump(mode="json")) for item in snapshot.requirements},
        source_revisions={source.id: {"revision": source.revision, "content_hash": content_hash(source.text)} for source in snapshot.sources},
        checked_at=datetime.now(timezone.utc).isoformat(),
        freshness=("matches_configured_snapshot" if fresh else "changed_during_review") if prepared["profile_id"] else "supplied_snapshot_only",
        review_state=review_state, semantic_status=semantic_status,
        findings=structural["findings"] + proposed, finding_count=count, findings_truncated=structural["findings_truncated"],
        basis="Review of the recorded snapshot only. Source labels and links are supplied provenance, not proof that an upstream system is current. No structural gaps does not establish semantic completeness or approval. Configured snapshots are rechecked on artifact handoff; inline snapshots require an explicit current hash. No product expectations are generated.").model_dump(mode="json")


def create_requirement_review_graph(skill, capabilities):
    from langgraph.graph import END, StateGraph
    from .graphs import SkillState, failure

    def resolve(state):
        try:
            value = ReviewRequirementsInput.model_validate(state["request"]["inputs"])
            return {"payload": value.model_dump(mode="json"), "prepared": resolve_snapshot(value), "error": "", "model_calls": 0,
                    "trace": ["resolve_revision"]}
        except Exception as error:
            return {**failure(error), "model_calls": 0, "trace": ["resolve_revision"]}

    def inspect(state):
        snapshot = RequirementSnapshot.model_validate(state["prepared"]["snapshot"])
        return {"draft": {"structural": inspect_structure(snapshot), "proposed": [], "semantic_status": "not_requested"},
                "trace": state["trace"] + ["check_structure"]}

    async def reason(state):
        draft = dict(state["draft"])
        calls = 0
        error_text = ""
        try:
            if not state["request"]["allow_model"]:
                draft["semantic_status"] = "blocked"
                raise SkillBlocked("Semantic review requires explicit allow_model=true; structural observations are retained")
            snapshot = RequirementSnapshot.model_validate(state["prepared"]["snapshot"])
            fields = indexed_fields(snapshot)
            if len(json.dumps(fields, ensure_ascii=False).encode()) > 96000:
                draft["semantic_status"] = "blocked"
                raise SkillBlocked("Semantic review exceeds the 96 KB field budget; split the snapshot")
            calls = 1
            raw = await asyncio.wait_for(capabilities.propose_requirement_findings(fields, state["request"]["agent_type"]), timeout=45)
            draft["proposed"] = validate_proposals(raw, snapshot)
            draft["semantic_status"] = "completed"
        except Exception as error:
            if draft["semantic_status"] != "blocked":
                draft["semantic_status"] = "failed"
            error_text = failure(error)["error"]
        return {"draft": draft, "model_calls": calls, "error": error_text, "trace": state["trace"] + ["review_semantics"]}

    def finalize(state):
        if not state.get("draft"):
            return {"trace": state["trace"] + ["finalize"]}
        fresh = True
        if state["prepared"]["profile_id"]:
            try:
                resolve_snapshot(ReviewRequirementsInput(profile_id=state["prepared"]["profile_id"], expected_snapshot_hash=state["prepared"]["snapshot_hash"]))
            except Exception:
                fresh = False
        data = assemble_report(state["prepared"], **state["draft"], fresh=fresh)
        return {"data": data, "status": "blocked" if state.get("error") or not fresh else "completed",
                "error": state.get("error") or ("Requirements changed or became unavailable during review" if not fresh else ""),
                "trace": state["trace"] + ["finalize"]}

    graph = StateGraph(SkillState)
    graph.add_node("resolve_revision", resolve)
    graph.add_node("check_structure", inspect)
    graph.add_node("review_semantics", reason)
    graph.add_node("finalize", finalize)
    graph.set_entry_point("resolve_revision")
    graph.add_conditional_edges("resolve_revision", lambda state: "finalize" if state.get("error") else "check_structure", {"finalize": "finalize", "check_structure": "check_structure"})
    graph.add_conditional_edges("check_structure", lambda state: "review_semantics" if state["payload"]["mode"] == "semantic" else "finalize", {"review_semantics": "review_semantics", "finalize": "finalize"})
    graph.add_edge("review_semantics", "finalize")
    graph.add_edge("finalize", END)
    return graph.compile()
