"""Contract tests for deterministic QA artifacts, execution admission, and graph routing."""
import asyncio
import copy
import hashlib
import hmac
import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch
from uuid import uuid4

import httpx
from fastapi import FastAPI
from fastapi.testclient import TestClient

from shared.skills.agent import create_expert_graph
from shared.skills.capabilities import Capabilities
from shared.skills.contracts import SkillRequest
from shared.skills.http import router
from shared.skills.registry import catalog
from shared.skills.runtime import RequestConflict, RunStore, SkillRuntime
from shared.skills.tools import create_skill_tools
from shared.skills.scope import current_scope, workflow_scope
from shared.skills.contracts import SkillBlocked


def requirements(steps=True):
    criterion = {"id": "AC-1", "text": "The submitted item is displayed"}
    if steps:
        criterion["steps"] = [{"action": "Submit the supplied item", "expected": "The submitted item is displayed"}]
    return [{"id": "R-1", "title": "Create an item", "criteria": [criterion], "impact": 5, "likelihood": 3}]


class SkillTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.path = Path(self.directory.name)
        self.capabilities = Capabilities()
        self.capabilities.draft_steps = AsyncMock(side_effect=AssertionError("Unexpected model call"))
        self.capabilities.submit_execution = AsyncMock(return_value={"execution": {"id": "external", "status": "queued"}})
        self.runtime = SkillRuntime(RunStore(self.path / "runs.sqlite3"), self.capabilities)

    async def run_skill(self, name, inputs, role="qae", allow_model=False, request_id=None):
        return await self.runtime.run(SkillRequest(request_id=request_id or uuid4(), agent_type=role,
                                                   skill=name, inputs=inputs, allow_model=allow_model))

    async def test_explicit_cases_do_not_use_model_even_when_allowed(self):
        result = await self.run_skill("design_test_cases", {"requirements": requirements()}, allow_model=True)
        self.assertEqual(result["status"], "completed")
        self.assertEqual(result["model_calls"], 0)
        case = result["data"]["cases"][0]
        self.assertEqual(case["steps"], requirements()[0]["criteria"][0]["steps"])
        self.assertEqual(case["review_status"], "draft")
        self.capabilities.draft_steps.assert_not_called()

    async def test_missing_steps_block_without_permission(self):
        result = await self.run_skill("design_test_cases", {"requirements": requirements(False)})
        self.assertEqual(result["status"], "blocked")
        self.assertEqual(result["model_calls"], 0)
        self.capabilities.draft_steps.assert_not_called()

    async def test_changed_case_semantics_get_a_new_identity(self):
        inputs = {"requirements": requirements()}
        first = await self.run_skill("design_test_cases", inputs)
        same = await self.run_skill("design_test_cases", inputs)
        self.assertEqual(first["data"]["cases"][0]["id"], same["data"]["cases"][0]["id"])
        inputs["requirements"][0]["criteria"][0]["steps"][0]["expected"] = "An updated acceptance outcome"
        changed = await self.run_skill("design_test_cases", inputs)
        self.assertNotEqual(first["data"]["cases"][0]["id"], changed["data"]["cases"][0]["id"])

    async def test_one_model_call_produces_a_reviewable_draft(self):
        self.capabilities.draft_steps.side_effect = None
        self.capabilities.draft_steps.return_value = {"criteria": [{"id": "AC-1", "steps": [{"action": "Submit", "expected": "Item displayed"}]}]}
        result = await self.run_skill("design_test_cases", {"requirements": requirements(False)}, allow_model=True)
        self.assertEqual(result["status"], "completed")
        self.assertEqual(result["model_calls"], 1)
        self.assertEqual(result["data"]["cases"][0]["origin"], "model_proposal")
        self.assertFalse(result["data"]["execution_authorized"])

    async def test_model_cannot_invent_criteria_or_return_tools(self):
        self.capabilities.draft_steps.side_effect = None
        for response in ({"criteria": []}, {"criteria": [{"id": "invented", "steps": [{"action": "a", "expected": "b"}]}]}, {"tool_calls": ["execute"]}):
            self.capabilities.draft_steps.return_value = response
            result = await self.run_skill("design_test_cases", {"requirements": requirements(False)}, allow_model=True)
            self.assertEqual(result["status"], "blocked")
            self.assertEqual(result["data"], {})
            self.assertEqual(result["model_calls"], 1)

    async def test_missing_criteria_never_fall_back_to_model(self):
        result = await self.run_skill("design_test_cases", {"requirements": [{"id": "R", "title": "Login"}]}, allow_model=True)
        self.assertEqual(result["status"], "blocked")
        self.capabilities.draft_steps.assert_not_called()

    async def test_risk_requires_both_supplied_inputs(self):
        value = requirements() + [{"id": "unknown", "title": "Unknown risk"}]
        result = await self.run_skill("plan_tests", {"requirements": value})
        self.assertEqual([item["risk_score"] for item in result["data"]["scope"]], [15, None])
        self.assertTrue(result["data"]["gaps"])

    async def test_duplicate_ids_and_extra_fields_block(self):
        for value in ({"requirements": requirements() * 2}, {"requirements": requirements(), "execute": True}):
            result = await self.run_skill("plan_tests", value)
            self.assertEqual(result["status"], "blocked")

    async def test_full_matrix_exclusions_and_budget(self):
        value = {"dimensions": {"browser": ["chrome", "firefox"], "role": ["member", "admin"]}, "exclude": [{"role": "admin", "browser": "firefox"}]}
        result = await self.run_skill("build_test_matrix", value)
        self.assertEqual(result["data"]["row_count"], 3)
        self.assertEqual(result["data"]["excluded_count"], 1)
        result = await self.run_skill("build_test_matrix", {**value, "max_rows": 2})
        self.assertEqual(result["status"], "blocked")
        self.assertEqual(result["data"], {})

    async def test_blank_and_whitespace_test_data_are_preserved(self):
        from shared.skills.contracts import ActionBinding, BrowserStep, Step
        value = "  literal value  "
        self.assertEqual(ActionBinding(operation="fill", value=value).value, value)
        self.assertEqual(BrowserStep(operation="assert_text", selector="#value", value=value).value, value)
        self.assertEqual(Step(action="Read text", expected=value).expected, value)
        result = await self.run_skill("build_test_matrix", {"dimensions": {"input": ["", " ", "valid"]}})
        self.assertEqual(result["data"]["rows"], [{"input": ""}, {"input": " "}, {"input": "valid"}])

    async def test_coverage_uses_explicit_links_and_matching_revisions(self):
        case = {"id": "case", "title": "Case", "requirement_ids": ["R-1"], "steps": [{"action": "a", "expected": "b"}]}
        inputs = {"requirements": requirements(), "cases": [case]}
        result = await self.run_skill("analyze_coverage", inputs)
        self.assertEqual(result["data"]["design_coverage_percent"], 0)
        case["criterion_ids"] = ["AC-1"]
        inputs["executions"] = [{"id": "stale", "case_id": "case", "case_revision": 2, "status": "passed", "environment": "staging", "target_revision": "rev"}]
        result = await self.run_skill("analyze_coverage", inputs)
        self.assertEqual(result["data"]["design_coverage_percent"], 100)
        self.assertEqual(result["data"]["stale_execution_ids"], ["stale"])
        self.assertEqual(result["data"]["matrix"][0]["evidenced_pass_ids"], [])
        case["criterion_ids"] = ["unknown"]
        self.assertEqual((await self.run_skill("analyze_coverage", inputs))["status"], "blocked")

    async def test_no_criteria_means_unknown_coverage(self):
        result = await self.run_skill("analyze_coverage", {"requirements": [{"id": "r", "title": "Unknown"}]})
        self.assertIsNone(result["data"]["design_coverage_percent"])

    async def test_failure_groups_do_not_mix_target_revisions(self):
        base = {"case_id": "case", "case_revision": 1, "environment": "staging", "target_revision": "rev"}
        runs = [{**base, "id": "a", "status": "passed"}, {**base, "id": "b", "status": "failed", "error": "assertion failed", "target_revision": "different"}]
        result = await self.run_skill("analyze_failures", {"executions": runs})
        self.assertEqual(result["data"]["mixed_outcome_groups"], [])
        self.assertIsNone(result["data"]["failures"][0]["root_cause"])
        runs[1]["target_revision"] = "rev"
        self.assertEqual(len((await self.run_skill("analyze_failures", {"executions": runs}))["data"]["mixed_outcome_groups"]), 1)

    def execution_input(self):
        return {"proposal_run_id": str(uuid4()), "target_id": "fixture", "actor": "operator", "preconditions_confirmed": True,
                "bindings": [{"operation": "click"}]}

    async def test_duplicate_submission_is_persisted_once_and_conflicts_rejected(self):
        identity = uuid4()
        inputs = self.execution_input()
        first = await self.run_skill("execute_browser_test", inputs, request_id=identity)
        second = await self.run_skill("execute_browser_test", inputs, request_id=identity)
        self.assertEqual(first, second)
        self.assertEqual(first["data"]["execution"]["status"], "queued")
        self.capabilities.submit_execution.assert_awaited_once()
        with self.assertRaises(RequestConflict):
            await self.run_skill("execute_browser_test", {**inputs, "target_id": "different"}, request_id=identity)
        recreated = SkillRuntime(RunStore(self.path / "runs.sqlite3"), self.capabilities)
        self.assertEqual(recreated.store.get(identity, "qae"), first)
        self.assertIsNone(recreated.store.get(identity, "aue"))

    async def test_concurrent_invocation_does_not_repeat_effect(self):
        started, release = asyncio.Event(), asyncio.Event()
        async def submit(*args):
            started.set()
            await release.wait()
            return {"execution": {"status": "queued"}}
        self.capabilities.submit_execution.side_effect = submit
        identity = uuid4()
        inputs = self.execution_input()
        first = asyncio.create_task(self.run_skill("execute_browser_test", inputs, request_id=identity))
        await asyncio.wait_for(started.wait(), 5)
        duplicate = await self.run_skill("execute_browser_test", inputs, request_id=identity)
        self.assertEqual(duplicate["status"], "running")
        release.set()
        await first
        self.capabilities.submit_execution.assert_awaited_once()

    async def test_expired_invocation_is_not_replayed(self):
        request = SkillRequest(request_id=uuid4(), agent_type="qae", skill="execute_browser_test", inputs=self.execution_input()).model_dump(mode="json")
        self.runtime.store.start(request)
        with self.runtime.store.connect() as connection:
            connection.execute("UPDATE skill_runs SET expires=0")
        result = await self.runtime.run(request)
        self.assertEqual(result["status"], "interrupted")
        self.capabilities.submit_execution.assert_not_called()

    async def test_side_effect_preconditions_are_strict(self):
        for confirmation in (False, 1, "true"):
            result = await self.run_skill("execute_browser_test", {**self.execution_input(), "preconditions_confirmed": confirmation})
            self.assertEqual(result["status"], "blocked")
        self.capabilities.submit_execution.assert_not_called()

    async def test_read_only_app_cannot_dispatch_browser_work(self):
        with workflow_scope("app", can_execute=False):
            with self.assertRaises(ValueError):
                await self.run_skill("execute_browser_test", self.execution_input())
        self.capabilities.submit_execution.assert_not_called()

    async def test_unsigned_chat_and_other_apps_cannot_read_artifacts(self):
        from shared.skills.runtime import get_runtime
        request = SkillRequest(agent_type="qae", skill="plan_tests", inputs={"requirements": requirements()})
        with patch.dict(os.environ, {"QA_WORKFLOW_DB": str(self.path / "scoped.sqlite3")}):
            with workflow_scope("app-one"):
                one = get_runtime()
                result = await one.run(request)
            with workflow_scope("app-two"):
                two = get_runtime()
                self.assertIsNone(two.store.get(request.request_id, "qae"))
            self.assertNotEqual(one.store.path, two.store.path)
            with workflow_scope(None):
                with self.assertRaises(SkillBlocked):
                    get_runtime()

    async def test_app_repository_access_requires_explicit_binding(self):
        from shared.skills.repository import project_root
        repository = self.path / "repo"
        repository.mkdir()
        with patch.dict(os.environ, {"QA_REPOSITORIES": json.dumps({"repo": str(repository)}),
                                     "QA_WORKFLOW_RESOURCES": json.dumps({"app-one": {"repositories": ["repo"]}})}):
            with workflow_scope("app-one"):
                self.assertEqual(project_root("repo"), repository.resolve())
            with workflow_scope("app-two"):
                with self.assertRaises(SkillBlocked):
                    project_root("repo")

    async def test_parent_contains_subgraphs_and_explicit_input_skips_model(self):
        def forbidden_model():
            self.fail("Explicit request reached the conversational model")
        graph = create_expert_graph("qae", "", [], runtime=self.runtime, model_factory=forbidden_model)
        self.assertIn("skill_plan_tests", [name for name, _ in graph.get_subgraphs()])
        request = SkillRequest(agent_type="qae", skill="plan_tests", inputs={"requirements": requirements()}).model_dump(mode="json")
        result = await graph.ainvoke({"messages": [], "skill_request": request})
        self.assertEqual(result["skill_result"]["status"], "completed")
        self.assertEqual(result["agent_iterations"], 0)
        self.assertEqual(json.loads(result["messages"][-1].content)["model_calls"], 0)

    async def test_role_relevance_is_enforced(self):
        with self.assertRaises(ValueError):
            await self.run_skill("plan_tests", {"requirements": requirements()}, role="aue")
        self.assertNotIn("generate_automation", [tool.name for tool in create_skill_tools("qae", self.runtime)])

    async def test_superqa_delegates_to_expert_without_an_extra_reasoning_call(self):
        from superqa.tools import delegate_qa_skill
        with patch("shared.skills.agent.get_runtime", return_value=self.runtime):
            result = json.loads(await delegate_qa_skill.ainvoke({"agent_type": "qae", "skill_name": "plan_tests", "inputs": {"requirements": requirements()}}))
        self.assertEqual(result["agent_type"], "qae")
        self.assertEqual(result["status"], "completed")
        self.assertEqual(result["model_calls"], 0)

    async def test_reasoning_loop_stops_at_its_budget(self):
        from langchain_core.messages import AIMessage
        from langchain_core.tools import tool
        calls = []
        @tool
        def no_op() -> str:
            """Read a harmless fixture."""
            calls.append("tool")
            return "fixture"
        class Model:
            def bind_tools(self, tools):
                return self
            async def ainvoke(self, messages):
                calls.append("model")
                return AIMessage(content="", tool_calls=[{"id": str(uuid4()), "name": "no_op", "args": {}}])
            async def astream(self, messages):
                yield await self.ainvoke(messages)
        graph = create_expert_graph("qae", "", [no_op], runtime=self.runtime, model_factory=Model)
        result = await graph.ainvoke({"messages": []})
        self.assertEqual(calls.count("model"), 6)
        self.assertEqual(calls.count("tool"), 5)
        self.assertIn("reasoning budget", result["messages"][-1].content)

    async def test_agent_tool_uses_the_same_validated_runtime(self):
        tool = next(item for item in create_skill_tools("qae", self.runtime) if item.name == "run_skill")
        result = json.loads(await tool.ainvoke({"skill_name": "design_test_cases", "inputs": {"requirements": requirements()}}))
        self.assertEqual(result["status"], "completed")
        self.assertIsNotNone(self.runtime.store.get(result["request_id"], "qae"))

    async def test_provider_error_is_failed_without_invented_cases(self):
        self.capabilities.draft_steps.side_effect = RuntimeError("secret-provider-details")
        result = await self.run_skill("design_test_cases", {"requirements": requirements(False)}, allow_model=True)
        self.assertEqual(result["status"], "failed")
        self.assertEqual(result["data"], {})
        self.assertNotIn("secret-provider-details", json.dumps(result))

    async def test_framework_generation_is_scoped_and_produces_a_patch(self):
        repository = self.path / "repo"
        repository.mkdir()
        (repository / "package.json").write_text(json.dumps({"devDependencies": {"@playwright/test": "1.60.0"}}))
        value = {"repository_id": "app", "title": "Literal ' text", "test_file": "tests/new.spec.ts",
                 "steps": [{"operation": "goto", "path": "/"}, {"operation": "assert_text", "selector": "#result", "value": "hello\n'world"}]}
        with patch.dict(os.environ, {"QA_REPOSITORIES": json.dumps({"app": str(repository)})}):
            result = await self.run_skill("generate_automation", value, role="aue")
            self.assertEqual(result["status"], "completed")
            self.assertIn("toHaveText", result["data"]["source"])
            self.assertFalse(result["data"]["executed"])
            self.assertFalse((repository / "tests/new.spec.ts").exists())
            escaped = await self.run_skill("generate_automation", {**value, "test_file": "../escaped.spec.ts"}, role="aue")
            self.assertEqual(escaped["status"], "blocked")
            (repository / "outside").symlink_to(self.path, target_is_directory=True)
            escaped = await self.run_skill("inspect_framework", {"repository_id": "app", "project_path": "outside"}, role="aue")
            self.assertEqual(escaped["status"], "blocked")

    async def test_custom_fixtures_require_explicit_import(self):
        repository = self.path / "repo"
        repository.mkdir()
        (repository / "package.json").write_text('{"devDependencies":{"@playwright/test":"1"}}')
        (repository / "existing.spec.ts").write_text("import { test, expect } from './fixtures';")
        (repository / "fixtures.ts").write_text("export {test, expect} from '@playwright/test';")
        value = {"repository_id": "app", "title": "Fixture", "test_file": "new.spec.ts",
                 "steps": [{"operation": "goto", "path": "/"}, {"operation": "assert_visible", "selector": "#result"}]}
        with patch.dict(os.environ, {"QA_REPOSITORIES": json.dumps({"app": str(repository)})}):
            self.assertEqual((await self.run_skill("generate_automation", value, role="aue"))["status"], "blocked")
            result = await self.run_skill("generate_automation", {**value, "test_import": "./fixtures"}, role="aue")
            self.assertEqual(result["status"], "completed")
            self.assertIn('from "./fixtures"', result["data"]["source"])

    async def test_backend_admission_preserves_uuid_and_surfaces_failure(self):
        adapter = Capabilities()
        calls = []
        def handle(request):
            calls.append(request)
            return httpx.Response(409, json={"message": "review required"})
        async with httpx.AsyncClient(transport=httpx.MockTransport(handle)) as client:
            wrapper = AsyncMock()
            wrapper.__aenter__.return_value = client
            with patch.dict(os.environ, {"HARNESS_OPERATOR_KEY": "k" * 32}), patch("shared.skills.capabilities.httpx.AsyncClient", return_value=wrapper):
                with self.assertRaises(httpx.HTTPStatusError):
                    from shared.skills.contracts import ExecuteInput
                    await adapter.submit_execution(ExecuteInput.model_validate(self.execution_input()), "stable-uuid")
        self.assertEqual(json.loads(calls[0].content)["requestId"], "stable-uuid")


class HttpSkillTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.runtime = SkillRuntime(RunStore(Path(self.directory.name) / "runs.sqlite3"))
        app = FastAPI()
        app.include_router(router)
        self.client = TestClient(app)

    def test_authentication_catalog_run_and_reload(self):
        headers = {"x-qa-workflow-key": "k" * 32}
        with patch.dict(os.environ, {"QA_WORKFLOW_KEY": "k" * 32}), patch("shared.skills.http.get_runtime", return_value=self.runtime):
            self.assertEqual(self.client.get("/workflows/skills/qae").status_code, 401)
            self.assertEqual(self.client.get("/workflows/skills/qae", headers=headers).status_code, 200)
            request = SkillRequest(agent_type="qae", skill="build_test_matrix", inputs={"dimensions": {"browser": ["chrome"]}}).model_dump(mode="json")
            response = self.client.post("/workflows/runs", json=request, headers=headers)
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.json()["model_calls"], 0)
            self.assertEqual(self.client.get("/workflows/runs/qae/" + request["request_id"], headers=headers).json(), response.json())
            request["inputs"]["dimensions"]["browser"] = ["firefox"]
            self.assertEqual(self.client.post("/workflows/runs", json=request, headers=headers).status_code, 409)
            graph = self.client.get("/workflows/graphs/qae/plan_tests", headers=headers)
            self.assertIn("prioritize_plan", graph.json()["mermaid"])

    def test_run_route_threads_project_scope_and_can_execute(self):
        headers = {"x-qa-workflow-key": "k" * 32}
        observed = []

        class StubRuntime:
            async def run(self, request):
                observed.append(current_scope())
                return {"request_id": str(request.request_id), "status": "completed"}

        project_id = str(uuid4())
        body = SkillRequest(agent_type="qae", skill="build_test_matrix", inputs={"dimensions": {"browser": ["chrome"]}}).model_dump(mode="json")
        body["project_id"], body["can_execute"] = project_id, True
        with patch.dict(os.environ, {"QA_WORKFLOW_KEY": "k" * 32}), patch("shared.skills.http.get_runtime", return_value=StubRuntime()):
            response = self.client.post("/workflows/runs", json=body, headers=headers)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(observed[0].identity, project_id)
        self.assertTrue(observed[0].can_execute)

    def test_run_route_without_project_id_keeps_legacy_local_scope(self):
        headers = {"x-qa-workflow-key": "k" * 32}
        observed = []

        class StubRuntime:
            async def run(self, request):
                observed.append(current_scope())
                return {"request_id": str(request.request_id), "status": "completed"}

        body = SkillRequest(agent_type="qae", skill="build_test_matrix", inputs={"dimensions": {"browser": ["chrome"]}}).model_dump(mode="json")
        with patch.dict(os.environ, {"QA_WORKFLOW_KEY": "k" * 32, "QA_WORKFLOW_SCOPE": ""}), patch("shared.skills.http.get_runtime", return_value=StubRuntime()):
            response = self.client.post("/workflows/runs", json=body, headers=headers)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(observed[0].identity, "local")

    def test_workflow_endpoint_is_disabled_without_key(self):
        with patch.dict(os.environ, {"QA_WORKFLOW_KEY": ""}):
            self.assertEqual(self.client.get("/workflows/skills/qae").status_code, 503)

    def test_chat_scope_is_signed_and_cannot_be_switched_for_a_session(self):
        import main
        from sessions import SessionManager
        from langchain_core.messages import AIMessage
        sessions = SessionManager()
        sessions._memory_store, sessions._session_index = {}, {}
        observed = []
        async def invoke(state):
            observed.append(current_scope())
            return {"messages": [AIMessage(content="done")]}
        agent = AsyncMock()
        agent.ainvoke.side_effect = invoke
        client = TestClient(main.app)
        key = "s" * 32
        scope = {"projectId": str(uuid4()), "canExecute": False}
        body = {"message": "Hello", "sessionId": None, "memories": [], "workflowScope": scope}
        def signature(value):
            payload = {"agentType": "qae", "sessionId": value["sessionId"], "message": value["message"],
                       "memories": value["memories"], "workflowScope": value["workflowScope"]}
            return {"x-agent-memory-signature": hmac.new(key.encode(), json.dumps(payload, separators=(",", ":"), ensure_ascii=False).encode(), hashlib.sha256).hexdigest()}
        with patch.dict(os.environ, {"AGENT_MEMORY_SIGNING_KEY": key}), patch.object(main, "session_manager", sessions), patch.object(main, "get_agent", return_value=agent):
            self.assertEqual(client.post("/agents/qae/chat", json=body).status_code, 401)
            result = client.post("/agents/qae/chat", json=body, headers=signature(body))
            self.assertEqual(result.status_code, 200)
            self.assertEqual(observed[0].identity, scope["projectId"])
            self.assertFalse(observed[0].can_execute)
            body["sessionId"] = result.json()["sessionId"]
            body["workflowScope"] = {"projectId": str(uuid4()), "canExecute": True}
            self.assertEqual(client.post("/agents/qae/chat", json=body, headers=signature(body)).status_code, 403)


if __name__ == "__main__":
    unittest.main()
