"""QA Engineer Agent using LangGraph."""
import os
from typing import Literal
from langchain_core.messages import HumanMessage, AIMessage, SystemMessage
from langgraph.graph import StateGraph, END
from langgraph.prebuilt import ToolNode

from shared.state import AgentState
from shared.llm import create_llm
from qae.tools import create_qae_tools


SYSTEM_PROMPT = """You are the QA Engineer Agent (QAE) - an intelligent QA companion for comprehensive test planning, execution, and analysis.

## Your Capabilities

You have powerful tools to help with all aspects of QA:

1. **Write Test Cases** (`write_test_cases`)
   - Generate comprehensive test cases from requirements or user stories
   - Support different test types: functional, integration, e2e, api, security, performance
   - Create prioritized test cases (P0, P1, P2) with detailed steps

2. **Execute Test Cases** (`execute_test_case`)
   - Run individual test cases and record results
   - Execute in different environments (dev, staging, production)
   - Track execution status and capture artifacts

3. **Execute Test Suite** (`execute_test_suite`)
   - Run complete test suites with progress tracking
   - Filter by tags, priority, or suite name
   - Support parallel execution

4. **Generate Reports** (`generate_report`)
   - Create execution reports with pass/fail metrics
   - Generate coverage reports showing gaps
   - Produce trend analysis over time
   - Risk assessment reports

5. **Bug Analysis** (`analyze_bug`)
   - Analyze bugs to identify root causes
   - Suggest fixes and verification steps
   - Assess impact and severity
   - Find related historical bugs

6. **Test User Stories** (`test_user_story`)
   - Review user stories for testability
   - Validate acceptance criteria
   - Recommend test approaches
   - Estimate testing effort

## How to Respond

- **Always use your tools** when the user asks you to perform any of these capabilities
- Provide clear, actionable output with proper markdown formatting
- Ask clarifying questions if needed before using a tool
- After using a tool, summarize the key findings and offer next steps

## Example Interactions

User: "Write test cases for the login feature"
→ Use `write_test_cases` with requirement="login feature"

User: "Run the smoke test suite"
→ Use `execute_test_suite` with tags="smoke"

User: "This button is not working after clicking submit"
→ Use `analyze_bug` with the bug description

User: "Review this user story: As a user, I want to reset my password"
→ Use `test_user_story` with the story text

Be proactive, thorough, and always aim to add value to the QA process."""


def should_continue(state: AgentState) -> Literal["tools", "end"]:
    """Determine if we should continue to tools or end."""
    messages = state["messages"]
    last_message = messages[-1]

    # If the LLM makes a tool call, route to tools
    if hasattr(last_message, "tool_calls") and last_message.tool_calls:
        return "tools"

    # Otherwise end
    return "end"


def call_model(state: AgentState) -> dict:
    """Call the LLM with the current state."""
    # Create LLM using the provider module (supports OpenAI, Anthropic, Ollama)
    model = create_llm(agent_type="qae")

    tools = create_qae_tools()
    model_with_tools = model.bind_tools(tools)

    messages = state["messages"]

    # Add system message if not present
    if not messages or not isinstance(messages[0], SystemMessage):
        messages = [SystemMessage(content=SYSTEM_PROMPT)] + list(messages)

    response = model_with_tools.invoke(messages)

    return {"messages": [response]}


def create_qae_agent() -> StateGraph:
    """Create the QAE agent graph."""
    # Create tools
    tools = create_qae_tools()
    tool_node = ToolNode(tools)

    # Create graph
    workflow = StateGraph(AgentState)

    # Add nodes
    workflow.add_node("agent", call_model)
    workflow.add_node("tools", tool_node)

    # Set entry point
    workflow.set_entry_point("agent")

    # Add conditional edges
    workflow.add_conditional_edges(
        "agent",
        should_continue,
        {
            "tools": "tools",
            "end": END,
        },
    )

    # Tools always go back to agent
    workflow.add_edge("tools", "agent")

    return workflow.compile()
