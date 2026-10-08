"""One capability catalog for expert agents, LangGraph, MCP, and HTTP discovery."""
from dataclasses import dataclass
from typing import Callable, Optional, Tuple, Type

from pydantic import BaseModel

from shared.mcp.agent_browser.client import BROWSER_TOOL_NAMES
from .operations import resolve_operations
from .datasets import PrepareDataInput, create_dataset_graph
from .maintenance import MaintainInput, create_maintenance_graph
from .regression import RegressionInput, create_regression_graph
from .release import ReleaseInput, create_release_graph
from .api_testing import TestApiInput, create_api_graph
from .investigation import InvestigateInput, create_investigation_graph
from .suites import SuiteInput, create_suite_graph
from .readiness import ReadinessInput, create_readiness_graph
from .requirements_review import ReviewRequirementsInput, create_requirement_review_graph

from .contracts import (AutomationInput, CoverageInput, DesignInput, ExecuteInput,
                        ExecutionStatusInput, ExploreInput, FailureInput, FrameworkInput,
                        MatrixInput, PlanInput)


@dataclass(frozen=True)
class Skill:
    name: str
    description: str
    roles: Tuple[str, ...]
    input_model: Type[BaseModel]
    prepare_node: str
    compute_node: str
    model_policy: str = "never"
    effect: str = "artifact"
    tools: Tuple[str, ...] = ()
    graph_factory: Optional[Callable] = None
    graph_nodes: Tuple[str, ...] = ()
    idempotency: str = "optional"

    def requires_request_id(self, inputs):
        return self.idempotency == "required" or (self.idempotency == "reproduction" and isinstance(inputs, dict) and bool(inputs.get("reproduce"))) or (self.idempotency == "browser_actions" and
            # goal drives the agentic loop's own autonomous clicks with no actions supplied —
            # it can mutate app state just like actions/authenticate, so it needs the same safe-retry guarantee.
            isinstance(inputs, dict) and bool(inputs.get("actions") or inputs.get("authenticate") or inputs.get("goal"))) or (self.idempotency == "repair_submission" and isinstance(inputs, dict) and bool(inputs.get("submit")))

    @property
    def requires_execution(self):
        return self.effect in ("execution_submission", "browser_exploration", "external_write", "repository_write")

    @property
    def operations(self):
        return resolve_operations(self.tools)

    def manifest(self):
        return {"name": self.name, "description": self.description, "roles": list(self.roles), "version": 1,
                "input_schema": self.input_model.model_json_schema(), "model_policy": self.model_policy,
                "effect": self.effect, "idempotency": self.idempotency, "tools": [item.name for item in self.operations], "nodes": list(self.graph_nodes) if self.graph_nodes else ["validate_input", self.prepare_node, self.compute_node, "finalize"] +
                (["draft_missing_steps"] if self.model_policy != "never" else [])}


SKILLS = {skill.name: skill for skill in (
    Skill("select_regression_tests", "Select whole approved repository suites from exact Git changes, pinned case mappings and mandatory smoke rules. Unknown impact broadens selection; budget overruns retain required scope. Produces a recommendation, not execution approval.",
          ("qae", "aue"), RegressionInput, "resolve_selection_inputs", "finalize_selection", effect="read",
          tools=("resolve_regression_policy", "resolve_artifact_inputs", "read_pinned_revision_changes", "resolve_mapped_suite_inventory", "select_impacted_suites"),
          graph_factory=create_regression_graph, graph_nodes=("resolve_selection_inputs", "collect_changes_and_inventory", "finalize_selection")),
    Skill("assess_release_readiness", "Evaluate configured release gates against fresh owned suite jobs at a candidate revision, plus pinned coverage and finding artifacts. Stale, pending, revision-mismatched or unexecuted mandatory gates yield an explicit incomplete recommendation; release authority remains a separate platform/user decision.",
          ("qae",), ReleaseInput, "resolve_release_inputs", "evaluate_exit_criteria", effect="read",
          tools=("resolve_release_policy", "resolve_suite_profile", "resolve_release_evidence", "resolve_release_evidence_artifacts", "evaluate_exit_criteria"),
          graph_factory=create_release_graph, graph_nodes=("resolve_release_inputs", "collect_evidence", "evaluate_exit_criteria")),
    Skill("test_api", "Submit an approved API sequence with explicit status, response and schema assertions at a pinned app revision. The worker owns HTTP calls, scoped fixtures and cleanup; submission is not a passing test result.",
          ("qae", "aue"), TestApiInput, "admit_api_sequence", "admit_api_sequence", effect="execution_submission", idempotency="required", tools=("enqueue_api_sequence",),
          graph_factory=create_api_graph, graph_nodes=("admit_api_sequence",)),
    Skill("investigate_defect", "Collect failure evidence from an owned API or repository job, optionally enqueue one reproduction, and compare matching revision/fixture contexts. Root cause remains unproven; no issue is published.",
          ("qae", "aue"), InvestigateInput, "collect_source", "assemble_finding", effect="read_with_optional_execution", idempotency="reproduction",
          tools=("collect_failure_evidence", "queue_reproduction_attempt", "compare_failure_evidence"), graph_factory=create_investigation_graph,
          graph_nodes=("collect_source", "resolve_comparison", "assemble_finding")),
    Skill("maintain_automation", "Validate a reviewed selector/fixture/setup repair for one failing repository test. Every originally present assertion's expectation must remain present and no skip/only marker may be introduced before a validation job is queued; the disposable checkout runs through the existing durable repository worker. Submission or a passing validation is not an automatic merge or baseline approval.",
          ("aue",), MaintainInput, "resolve_failing_target", "validate_patch_candidate", effect="read_with_optional_execution", idempotency="repair_submission",
          tools=("resolve_suite_profile", "collect_failure_evidence", "resolve_repository_revision_source", "prepare_patch_candidate", "compare_assertion_manifest", "validate_patch_candidate"),
          graph_factory=create_maintenance_graph, graph_nodes=("resolve_failing_target", "compare_assertion_manifest", "validate_patch_candidate")),
    Skill("prepare_test_data", "Prepare a reproducible synthetic fixture artifact from a configured blueprint and seed. The suite worker acquires a namespaced lease on job claim and performs cleanup; this skill does not provision live data.",
          ("qae", "aue"), PrepareDataInput, "resolve_blueprint", "generate_fixture", tools=("resolve_dataset_blueprint", "generate_fixture_values"),
          graph_factory=create_dataset_graph, graph_nodes=("resolve_blueprint", "generate_fixture")),
    Skill("run_automation_suite", "Submit an approved repository suite at an exact revision to the durable worker queue. Playwright/Cypress attempts and cleanup are retrieved through job lookup; submission is not a passing test result.",
          ("aue",), SuiteInput, "admit_suite", "admit_suite", effect="execution_submission", idempotency="required", tools=("submit_suite_job",),
          graph_factory=create_suite_graph, graph_nodes=("admit_suite",)),
    Skill("review_requirements", "Review a versioned requirement snapshot for structural gaps and unresolved source links. Optional one-call semantic review returns exact cited questions; no generated expectations or approval. Configured revisions are rechecked before completion and artifact handoff.",
          ("qae",), ReviewRequirementsInput, "resolve_revision", "check_structure", model_policy="explicit_semantic_review",
          tools=("resolve_requirement_revision", "validate_criteria_structure", "propose_requirement_findings", "validate_requirement_citations", "assemble_requirement_assessment"),
          graph_factory=create_requirement_review_graph, graph_nodes=("resolve_revision", "check_structure", "review_semantics", "finalize")),
    Skill("check_test_readiness", "Check configured environment prerequisites and produce an expiring readiness snapshot. HTTP probes, revision comparisons, credential presence, repository inspection, and worker health are reported separately; readiness is not a test verdict or execution authorization.",
          ("qae", "aue"), ReadinessInput, "resolve_profile", "inspect_prerequisites", effect="read",
          tools=("resolve_readiness_profile", "inspect_readiness_configuration", "probe_readiness_endpoint", "evaluate_readiness"),
          graph_factory=create_readiness_graph, graph_nodes=("resolve_profile", "inspect_prerequisites", "finalize")),
    Skill("plan_tests", "Build a draft test plan from explicit acceptance criteria and supplied impact/likelihood.", ("qae",), PlanInput, "inspect_scope", "prioritize_plan", tools=("resolve_artifact_inputs", "rank_requirement_risks", "find_planning_gaps", "assemble_plan_document")),
    Skill("design_test_cases", "Create reviewable cases from supplied criteria and steps. Optional one-call model drafting only when steps are missing.", ("qae",), DesignInput, "inspect_criteria", "assemble_cases", "missing_steps_only", tools=("resolve_artifact_inputs", "collect_missing_case_steps", "draft_acceptance_steps", "assemble_case_records")),
    Skill("analyze_coverage", "Calculate criterion coverage and traceability using explicit links and case revisions.", ("qae", "aue"), CoverageInput, "index_requirements", "calculate_coverage", tools=("resolve_artifact_inputs", "calculate_criterion_traceability",)),
    Skill("build_test_matrix", "Enumerate all requested dimension combinations and explicit exclusions within a fixed row budget.", ("qae", "aue"), MatrixInput, "inspect_dimensions", "enumerate_combinations", tools=("enumerate_dimension_combinations",)),
    Skill("inspect_framework", "Inspect a configured repository for Playwright/Cypress, configurations, scripts, and fixture imports without executing code.", ("aue",), FrameworkInput, "load_repository", "report_framework", tools=("read_framework_profile",)),
    Skill("generate_automation", "Compile explicit browser actions/assertions into a Playwright/Cypress test and new-file patch using the inspected project.", ("aue",), AutomationInput, "inspect_framework", "compile_test", tools=("read_framework_profile", "compile_test_source")),
    Skill("execute_browser_test", "Submit a reviewed harness proposal to the existing sandboxed browser worker; returns admission status, not an invented verdict.", ("qae", "aue"), ExecuteInput, "prepare_admission", "submit_execution", effect="execution_submission", idempotency="required", tools=("verify_execution_scope", "call_execution_api")),
    Skill("browser_execution_status", "Read the authoritative browser harness outcome and evidence metadata.", ("qae", "aue"), ExecutionStatusInput, "prepare_lookup", "read_execution", effect="read", tools=("call_execution_api", "verify_execution_scope")),
    Skill("explore_app", "Explore a live app through agent-browser MCP: snapshots, links, controls, optional login and explicit actions. Supply target_id for a workspace-configured app (see list_workflow_resources), or url to explore any other HTTP(S) address the user named directly, ad-hoc. Static bundles also supported for configured targets. Interactions/login require a stable request_id; observations are not test verdicts.", ("qae", "aue"), ExploreInput, "prepare_exploration", "explore_pages", effect="browser_exploration", idempotency="browser_actions", tools=(*BROWSER_TOOL_NAMES, "inspect_static_bundle")),
    Skill("analyze_failures", "Group observed failures and identify mixed outcomes for matching case/environment/revision; does not claim proven root causes.", ("qae", "aue"), FailureInput, "group_observations", "classify_failures", tools=("classify_execution_failures",)),
)}


def get_skill(name, role):
    skill = SKILLS.get(name)
    if skill is None:
        raise ValueError("Unknown QA skill: " + name)
    if role not in skill.roles:
        raise ValueError("Skill is unavailable for " + role + ": " + name)
    return skill


def catalog(role=None):
    return [skill.manifest() for skill in SKILLS.values() if role is None or role in skill.roles]
