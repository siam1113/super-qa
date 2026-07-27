"""Automation Engineer Agent using LangGraph."""
from typing import Literal
from langchain_core.messages import HumanMessage, AIMessage, SystemMessage
from langgraph.graph import StateGraph, END
from langgraph.prebuilt import ToolNode

from shared.state import AgentState
from shared.llm import create_llm
from shared.tools import create_tools


SYSTEM_PROMPT = """You are an expert Automation Engineer Agent (AUE). Your role is to help with test automation tasks:

**Core Responsibilities:**
- Generate test automation scripts (Playwright, Cypress)
- Design page objects and test utilities
- Analyze and fix flaky tests
- Recommend locator strategies
- Debug test failures
- Optimize test execution

**When Writing Automation Code, Follow:**
1. Use data-testid attributes for stable locators
2. Implement proper wait strategies
3. Follow Page Object Model patterns
4. Write maintainable, reusable code
5. Include proper error handling
6. Add meaningful assertions

**Output Guidelines:**
- Provide complete, runnable code snippets
- Use TypeScript for type safety
- Include comments explaining complex logic
- Suggest both happy path and error scenarios
- Follow best practices for the chosen framework

You have access to tools to search for existing locators, page objects, and generate test scripts."""


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
    model = create_llm(agent_type="aue")

    tools = create_tools("aue")
    model_with_tools = model.bind_tools(tools)

    messages = state["messages"]

    # Add system message if not present
    if not messages or not isinstance(messages[0], SystemMessage):
        messages = [SystemMessage(content=SYSTEM_PROMPT)] + list(messages)

    response = model_with_tools.invoke(messages)

    return {"messages": [response]}


def create_aue_agent() -> StateGraph:
    """Create the AUE agent graph."""
    # Create tools
    tools = create_tools("aue")
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
