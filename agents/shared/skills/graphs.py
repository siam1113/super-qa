"""Actual skill subgraphs with deterministic routing and a single optional reasoning node."""
import asyncio
from typing import TypedDict

from langgraph.graph import END, StateGraph
from pydantic import ValidationError

from . import analysis
from .contracts import SkillBlocked, Step
from .repository import generate_automation, inspect_framework


class SkillState(TypedDict, total=False):
    request: dict
    payload: dict
    prepared: dict
    draft: dict
    needs_model: bool
    data: dict
    error: str
    status: str
    trace: list
    model_calls: int
    input_provenance: dict


def failure(error):
    if isinstance(error, SkillBlocked):
        return {"error": str(error), "status": "blocked"}
    if isinstance(error, ValidationError):
        details = "; ".join(".".join(map(str, item["loc"])) + ": " + item["msg"] for item in error.errors(include_input=False)[:5])
        return {"error": "Invalid skill input: " + details, "status": "blocked"}
    if isinstance(error, ValueError):
        return {"error": str(error)[:500], "status": "blocked"}
    return {"error": "Capability failed (" + type(error).__name__ + "); no successful result is claimed", "status": "failed"}


def create_skill_graph(skill, capabilities):
    if skill.graph_factory is not None:
        return skill.graph_factory(skill, capabilities)

    async def validate(state):
        result = {"trace": ["validate_input"], "model_calls": 0, "error": "", "draft": {}}
        try:
            value = skill.input_model.model_validate(state["request"]["inputs"])
            if getattr(value, "requirement_review", None) is not None:
                resolved = await capabilities.resolve_workflow_inputs(value)
                value = skill.input_model.model_validate(resolved["inputs"])
                result["input_provenance"] = resolved["provenance"]
            result["payload"] = value.model_dump(mode="json")
        except Exception as error:
            result.update(failure(error))
        return result

    def prepare(state):
        result = {"trace": state["trace"] + [skill.prepare_node], "prepared": {}, "needs_model": False}
        try:
            value = skill.input_model.model_validate(state["payload"])
            if skill.name in ("inspect_framework", "generate_automation"):
                result["prepared"] = inspect_framework(value)
            if skill.name == "design_test_cases":
                criteria = analysis.collect_missing_case_steps(value)
                result["prepared"] = {"criteria": criteria}
                result["needs_model"] = bool(criteria)
                if criteria and not state["request"]["allow_model"]:
                    raise SkillBlocked("Some criteria have no explicit steps. Supply steps or explicitly allow one model call for a reviewable draft")
                if len(criteria) > 20:
                    raise SkillBlocked("Model drafting is limited to 20 criteria per run; split this task")
        except Exception as error:
            result.update(failure(error))
        return result

    async def reason(state):
        result = {"trace": state["trace"] + ["draft_missing_steps"], "model_calls": 1}
        try:
            draft = await asyncio.wait_for(capabilities.draft_steps(state["prepared"]["criteria"], state["request"]["agent_type"]), timeout=45)
            if not isinstance(draft, dict) or set(draft) != {"criteria"} or not isinstance(draft["criteria"], list):
                raise ValueError("Model draft must contain only a criteria list")
            steps = {}
            for criterion in draft["criteria"]:
                if not isinstance(criterion, dict) or set(criterion) != {"id", "steps"} or not isinstance(criterion["id"], str) or criterion["id"] in steps or not isinstance(criterion["steps"], list) or not 1 <= len(criterion["steps"]) <= 50:
                    raise ValueError("Malformed or duplicate drafted criterion")
                steps[criterion["id"]] = [Step.model_validate(step).model_dump() for step in criterion["steps"]]
            expected = {item["id"] for item in state["prepared"]["criteria"]}
            if set(steps) != expected:
                raise ValueError("Model invented or omitted criterion IDs")
            result["draft"] = steps
        except Exception as error:
            result.update(failure(error))
        return result

    async def compute(state):
        result = {"trace": state["trace"] + [skill.compute_node]}
        try:
            value = skill.input_model.model_validate(state["payload"])
            pure = {"plan_tests": analysis.plan_tests, "analyze_coverage": analysis.analyze_coverage,
                    "build_test_matrix": analysis.build_matrix, "analyze_failures": analysis.analyze_failures}
            if skill.name in pure:
                data = pure[skill.name](value)
            elif skill.name == "design_test_cases":
                data = analysis.design_cases(value, state["draft"], (state.get("input_provenance") or {}).get("snapshot_hash"))
            elif skill.name == "inspect_framework":
                data = state["prepared"]
            elif skill.name == "generate_automation":
                data = generate_automation(value, state["prepared"])
            elif skill.name == "execute_browser_test":
                data = await capabilities.submit_execution(value, state["request"]["request_id"])
            elif skill.name == "browser_execution_status":
                data = await capabilities.execution_status(value)
            elif skill.name == "explore_app":
                data = await capabilities.explore(value)
            else:
                raise ValueError("No implementation for skill")
            if state.get("input_provenance"):
                # Recheck after optional reasoning. The report records the exact
                # snapshot used even if a later upstream change occurs.
                original = skill.input_model.model_validate(state["request"]["inputs"])
                await capabilities.resolve_workflow_inputs(original)
                data["input_provenance"] = state["input_provenance"]
            result.update(data=data, status="completed")
        except Exception as error:
            result.update(failure(error))
        return result

    def finalize(state):
        return {"trace": state["trace"] + ["finalize"], "data": state.get("data", {})}

    graph = StateGraph(SkillState)
    graph.add_node("validate_input", validate)
    graph.add_node(skill.prepare_node, prepare)
    graph.add_node(skill.compute_node, compute)
    graph.add_node("finalize", finalize)
    graph.set_entry_point("validate_input")
    graph.add_conditional_edges("validate_input", lambda state: "finalize" if state.get("error") else skill.prepare_node,
                                {"finalize": "finalize", skill.prepare_node: skill.prepare_node})
    paths = {"finalize": "finalize", skill.compute_node: skill.compute_node}
    if skill.model_policy != "never":
        graph.add_node("draft_missing_steps", reason)
        paths["draft_missing_steps"] = "draft_missing_steps"
        graph.add_conditional_edges("draft_missing_steps", lambda state: "finalize" if state.get("error") else skill.compute_node,
                                    {"finalize": "finalize", skill.compute_node: skill.compute_node})
    graph.add_conditional_edges(skill.prepare_node,
                                lambda state: "finalize" if state.get("error") else "draft_missing_steps" if state.get("needs_model") else skill.compute_node,
                                paths)
    graph.add_edge(skill.compute_node, "finalize")
    graph.add_edge("finalize", END)
    return graph.compile()
