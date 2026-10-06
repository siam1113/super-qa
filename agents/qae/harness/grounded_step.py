"""Tools and prompting for live-grounded step execution.

Manual test-case steps are vague and high-level by design (e.g. "select Estimator
or Snap & Estimate"). This module builds what TestExecutor's per-step agentic loop
needs to ground a step like that against the actual live page: a curated set of
LangChain tools wrapping the already-registered MCP Playwright tools, plus the
terminal "I'm done with this step" tool and its system prompt. No execution logic
lives here — TestExecutor still owns calling and recording every tool call, so
retry policy and action-recording/live-streaming aren't duplicated.
"""
import inspect
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field, create_model
from langchain_core.tools import StructuredTool

# Tools exposed to the grounded step loop. Deliberately excludes browser/context/page
# lifecycle tools (orchestrator owns those) and get_console_logs/get_network_requests
# (already captured globally by the orchestrator; not useful for deciding what to do
# on one step).
STEP_TOOL_NAMES = {
    "goto", "go_back", "go_forward", "reload", "get_current_url", "get_title",
    "click", "fill", "clear", "select_option", "check", "uncheck", "hover", "focus", "press", "type_text",
    "screenshot", "get_page_content", "evaluate", "accessibility_snapshot",
    "expect_visible", "expect_hidden", "expect_text", "expect_value", "expect_url", "expect_title",
    "expect_element_count", "expect_checked", "expect_enabled", "expect_attribute", "expect_download",
    "wait_for_selector", "wait_for_navigation", "wait_for_load_state", "wait_for_timeout", "wait_for_url",
}

# A step may only be reported passed if at least one of these succeeded against the
# live page during the step — enforced by TestExecutor, not just prompted for.
ASSERTION_TOOL_NAMES = {
    "expect_visible", "expect_hidden", "expect_text", "expect_value", "expect_url", "expect_title",
    "expect_element_count", "expect_checked", "expect_enabled", "expect_attribute", "expect_download",
}

REPORT_STEP_RESULT = "report_step_result"


class ReportStepResultArgs(BaseModel):
    """Terminal tool: call exactly once, as the last action for a step."""
    passed: bool = Field(description="Whether the expected result was verified against the live page")
    actual_result: str = Field(description="What was actually observed on the page, in your own words")
    reason: Optional[str] = Field(default=None, description="Why it passed or failed, especially on failure")


def _noop_report_step_result(**_: Any) -> None:
    # Never actually invoked: TestExecutor intercepts this tool call by name before
    # dispatching it, since it ends the loop rather than touching the browser.
    return None


def _wrap_mcp_tool(name: str, func: Any, mcp_client: Any) -> StructuredTool:
    """Expose a registered MCP tool function as a LangChain tool bound to this
    execution's page.

    Reads mcp_client.page_id fresh on every call (rather than snapshotting it once
    at build time) so that if TestExecutor switches the client onto a newly opened
    tab/popup mid-step, already-built tools immediately start targeting it instead
    of continuing to act on a stale page.

    Builds the args schema from the function's own signature (minus page_id, which
    is supplied here rather than asked of the model) rather than hand-maintaining a
    second schema per tool.
    """
    signature = inspect.signature(func)
    fields: Dict[str, Any] = {}
    for param_name, param in signature.parameters.items():
        if param_name == "page_id":
            continue
        annotation = param.annotation if param.annotation is not inspect.Parameter.empty else Any
        default = ... if param.default is inspect.Parameter.empty else param.default
        fields[param_name] = (annotation, default)
    args_model = create_model(f"{name}_args", **fields)

    async def run(**kwargs: Any) -> Dict[str, Any]:
        return await func(page_id=mcp_client.page_id, **kwargs)

    description = (func.__doc__ or name).strip().split("\n\n")[0].strip()
    return StructuredTool.from_function(coroutine=run, name=name, description=description, args_schema=args_model)


def build_step_tools(mcp_client: Any) -> List[StructuredTool]:
    """All tools available to the grounded step loop: the curated MCP subset, bound
    to this execution's page, plus the terminal report_step_result tool."""
    tools = [
        _wrap_mcp_tool(name, func, mcp_client)
        for name, func in mcp_client._tool_registry.items()
        if name in STEP_TOOL_NAMES
    ]
    tools.append(StructuredTool.from_function(
        func=_noop_report_step_result,
        name=REPORT_STEP_RESULT,
        description="Call exactly once, as your final action for this step, once you have either "
                     "verified the expected result with a real assertion tool or concluded it cannot "
                     "be verified. Never call this before acting on the step's instruction.",
        args_schema=ReportStepResultArgs,
    ))
    return tools


def build_system_prompt(
    *,
    test_name: str,
    step_number: int,
    total_steps: int,
    description: str,
    expected_result: Optional[str],
    locator_hints: List[Dict[str, Any]],
    max_iterations: int,
) -> str:
    hints_text = ""
    if locator_hints:
        lines = []
        for hint in locator_hints[:20]:
            name = hint.get("name")
            selector = (hint.get("content") or {}).get("selector")
            if name and selector:
                lines.append(f"- {name}: {selector}")
        if lines:
            hints_text = "\n\nKnown element hints (use if relevant, but verify against the live page — they may be stale):\n" + "\n".join(lines)

    return f"""You are driving a real, live browser to execute one manual QA test step. The step is \
intentionally vague and high-level — you must figure out the concrete action by looking at the \
actual page, the way a human tester would.

Test: {test_name}
Step {step_number} of {total_steps}: "{description}"
Expected result: "{expected_result or 'Not specified — use judgement based on the step text.'}"{hints_text}

Rules:
1. Inspect the live page first with accessibility_snapshot (use screenshot too if the tree alone is \
ambiguous) before acting — never guess a selector blindly.
2. Perform the action described using the real browser tools (click, fill, select_option, etc.). If \
an action fails, read the error and try a different selector or approach — don't repeat the same \
failing call.
3. You MUST verify the expected result by calling a real assertion tool (expect_visible, expect_text, \
expect_url, expect_title, expect_element_count, expect_checked, expect_enabled, expect_attribute, or \
expect_download) against the live page. A step can only be reported passed if one of these actually succeeds — never \
report passed from appearance or judgement alone.
4. If, after exploring, the expected result genuinely cannot be verified, call {REPORT_STEP_RESULT} \
with passed=false and explain what you actually observed instead.
5. Call {REPORT_STEP_RESULT} exactly once, as your final action, once you have either verified the \
result or concluded it cannot be verified. You have at most {max_iterations} tool calls total for \
this step — don't waste them repeating the same failed action.
6. JS dialogs (alert/confirm/prompt) are auto-accepted for you — if an action's result includes \
"dialogsHandled", that's what fired and was accepted, not something you need to act on separately. If \
an action opens a new tab/popup, the result includes "newTabOpened" and you're automatically now acting \
on that tab for subsequent tool calls."""
