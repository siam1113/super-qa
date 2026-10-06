"""Pure QA calculations. These functions never invoke a model or infer coverage links."""
import hashlib
import itertools
import json
import math
from collections import defaultdict

from .contracts import Case, SkillBlocked
from .operations import operation


@operation("rank_requirement_risks", "Rank requirements using supplied impact and likelihood; keep missing scores unknown.")
def rank_requirement_risks(requirements):
    ranked = sorted(requirements, key=lambda item: (
        -(item.impact * item.likelihood) if item.impact is not None and item.likelihood is not None else 1,
        item.id,
    ))
    return [{"requirement_id": item.id, "title": item.title,
             "risk_score": item.impact * item.likelihood if item.impact is not None and item.likelihood is not None else None,
             "criterion_ids": [criterion.id for criterion in item.criteria], "evidence_ids": item.evidence_ids}
            for item in ranked]


@operation("find_planning_gaps", "Identify missing acceptance criteria, risk inputs, and environments.")
def find_planning_gaps(scope, environments):
    gaps = []
    for item in scope:
        if not item["criterion_ids"]:
            gaps.append({"requirement_id": item["requirement_id"], "missing": "acceptance_criteria"})
        if item["risk_score"] is None:
            gaps.append({"requirement_id": item["requirement_id"], "missing": "impact_and_likelihood"})
    if not environments:
        gaps.append({"missing": "environments"})
    return gaps


@operation("assemble_plan_document", "Assemble a draft plan from ranked scope and known planning gaps.")
def assemble_plan_document(value, scope, gaps):
    return {"review_status": "draft", "scope": scope, "environments": value.environments,
            "test_types": value.test_types, "gaps": gaps,
            "entry_criteria": ["Resolve missing acceptance criteria", "Confirm environment and test data", "Review test cases before execution"],
            "exit_criteria": ["Record an outcome and evidence for each selected case", "Report all failed, blocked, and unexecuted cases", "Review remaining coverage gaps"],
            "risk_method": "Supplied impact × supplied likelihood, each 1–5; missing inputs remain unknown"}


def plan_tests(value):
    scope = rank_requirement_risks(value.requirements)
    return assemble_plan_document(value, scope, find_planning_gaps(scope, value.environments))


@operation("collect_missing_case_steps", "Find acceptance criteria that need executable steps before case assembly.")
def collect_missing_case_steps(value):
    if any(not requirement.criteria for requirement in value.requirements):
        raise SkillBlocked("Supply acceptance criteria for every requirement before designing cases")
    return [{"id": criterion.id, "text": criterion.text, "requirement": requirement.title,
             "preconditions": value.preconditions}
            for requirement in value.requirements for criterion in requirement.criteria if not criterion.steps]


@operation("assemble_case_records", "Build traceable draft case records from supplied steps or validated drafts.")
def design_cases(value, generated=None, requirement_snapshot_hash=None):
    """Copy supplied executable criteria; optionally consume validated model drafts."""
    supplied = generated or {}
    expected = {criterion.id for requirement in value.requirements for criterion in requirement.criteria if not criterion.steps}
    if set(supplied) != expected:
        raise SkillBlocked("Each criterion without explicit steps needs a validated draft; no criteria may be invented or omitted")
    cases = []
    for requirement in value.requirements:
        if not requirement.criteria:
            raise SkillBlocked("Acceptance criteria are missing for requirement " + requirement.id)
        for criterion in requirement.criteria:
            steps = [step.model_dump() for step in criterion.steps] if criterion.steps else supplied[criterion.id]
            identity_data = {"requirement": requirement.id, "title": requirement.title, "criterion": criterion.id,
                             "text": criterion.text, "steps": steps, "preconditions": value.preconditions,
                             "evidence_ids": requirement.evidence_ids}
            if requirement_snapshot_hash:
                identity_data["requirement_snapshot_hash"] = requirement_snapshot_hash
            identity = hashlib.sha256(json.dumps(identity_data, sort_keys=True, ensure_ascii=False).encode()).hexdigest()[:24]
            case = Case(id="TC-" + identity, title=(requirement.title + " — " + criterion.text)[:500],
                        requirement_ids=[requirement.id], criterion_ids=[criterion.id],
                        preconditions=value.preconditions,
                        steps=steps)
            cases.append({**case.model_dump(), "review_status": "draft", "evidence_ids": requirement.evidence_ids,
                          "origin": "supplied_steps" if criterion.steps else "model_proposal"})
    return {"cases": cases, "coverage_basis": "One draft per supplied acceptance criterion; not exhaustive testing",
            "execution_authorized": False}


@operation("calculate_criterion_traceability", "Calculate coverage using explicit criterion links, case revisions, and execution evidence.")
def analyze_coverage(value):
    requirements = {item.id: item for item in value.requirements}
    owners = {criterion.id: item.id for item in value.requirements for criterion in item.criteria}
    cases = {item.id: item for item in value.cases}
    if len(cases) != len(value.cases):
        raise ValueError("Duplicate case IDs")
    if len({item.id for item in value.executions}) != len(value.executions):
        raise ValueError("Duplicate execution IDs")
    linked = defaultdict(list)
    for case in value.cases:
        if not set(case.requirement_ids) <= set(requirements) or any(owners.get(key) not in case.requirement_ids for key in case.criterion_ids):
            raise ValueError("Case references an unknown requirement or mismatched criterion")
        for key in set(case.criterion_ids):
            linked[key].append(case.id)
    stale = []
    observations = defaultdict(list)
    for execution in value.executions:
        case = cases.get(execution.case_id)
        if case is None:
            raise ValueError("Execution references an unknown case")
        if execution.case_revision != case.revision:
            stale.append(execution.id)
        else:
            observations[case.id].append(execution)
    rows = []
    for requirement in value.requirements:
        for criterion in requirement.criteria:
            relevant = [run for identity in linked[criterion.id] for run in observations[identity]]
            rows.append({"requirement_id": requirement.id, "criterion_id": criterion.id,
                         "case_ids": sorted(linked[criterion.id]), "designed": bool(linked[criterion.id]),
                         "execution_ids": [run.id for run in relevant],
                         "observed_statuses": sorted(set(run.status for run in relevant)),
                         "evidenced_pass_ids": [run.id for run in relevant if run.status == "passed" and run.evidence_ids],
                         "evidence_missing_ids": [run.id for run in relevant if run.status in ("passed", "failed") and not run.evidence_ids]})
    covered = sum(row["designed"] for row in rows)
    return {"matrix": rows, "criteria_total": len(rows), "criteria_with_cases": covered,
            "design_coverage_percent": round(covered * 100 / len(rows), 2) if rows else None,
            "uncovered_criterion_ids": [row["criterion_id"] for row in rows if not row["designed"]],
            "requirements_without_criteria": [item.id for item in value.requirements if not item.criteria],
            "stale_execution_ids": stale,
            "basis": "Explicit criterion links and matching case revisions. Supplied execution records are not independently verified; historical statuses are not a current release verdict."}


@operation("enumerate_dimension_combinations", "Enumerate dimension combinations with explicit exclusions and a bounded row count.")
def build_matrix(value):
    keys = sorted(value.dimensions)
    combinations = math.prod(len(value.dimensions[key]) for key in keys)
    if combinations > 100000:
        raise SkillBlocked("Cartesian matrix exceeds 100,000 candidate combinations; narrow the dimensions")
    rows = []
    excluded = 0
    for combination in itertools.product(*(value.dimensions[key] for key in keys)):
        row = dict(zip(keys, combination))
        if any(all(row[key] == item for key, item in exclusion.items()) for exclusion in value.exclude):
            excluded += 1
            continue
        rows.append(row)
        if len(rows) > value.max_rows:
            raise SkillBlocked("Matrix exceeds max_rows; narrow scope or increase the explicit row budget (maximum 1000)")
    return {"strategy": "full_cartesian", "rows": rows, "row_count": len(rows), "excluded_count": excluded,
            "candidate_count": combinations, "complete": True}


@operation("classify_execution_failures", "Group execution observations and classify failure messages using deterministic rules.")
def analyze_failures(value):
    if len({run.id for run in value.executions}) != len(value.executions):
        raise ValueError("Duplicate execution IDs")
    groups = defaultdict(list)
    failures = []
    for run in value.executions:
        groups[(run.case_id, run.case_revision, run.environment, run.target_revision)].append(run)
        if run.status not in ("failed", "error", "blocked"):
            continue
        message = run.error.lower()
        category = "unclassified"
        if "timeout" in message:
            category = "timeout"
        elif "assert" in message or "expected" in message:
            category = "assertion"
        elif "selector" in message or "locator" in message:
            category = "locator"
        elif any(word in message for word in ("network", "connection", "infrastructure")):
            category = "infrastructure"
        failures.append({"execution_id": run.id, "status": run.status, "category": category,
                         "error": run.error, "evidence_ids": run.evidence_ids, "root_cause": None})
    inconsistent = []
    for (case, revision, environment, target), runs in sorted(groups.items()):
        if {"passed", "failed"} <= {run.status for run in runs}:
            inconsistent.append({"case_id": case, "case_revision": revision, "environment": environment,
                                 "target_revision": target, "execution_ids": [run.id for run in runs]})
    return {"failures": failures, "mixed_outcome_groups": inconsistent,
            "basis": "Categories are deterministic triage hints, not proven causes. Mixed outcomes identify flakiness candidates; test data and runtime conditions may differ."}
