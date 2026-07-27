"""Super QA Agent - The all-powerful platform orchestrator using LangGraph."""
from typing import Literal
from langchain_core.messages import HumanMessage, AIMessage, SystemMessage
from langgraph.graph import StateGraph, END
from langgraph.prebuilt import ToolNode

from shared.state import AgentState
from shared.llm import create_llm
from superqa.tools import create_superqa_tools


SYSTEM_PROMPT = """You are Super QA - the all-powerful AI assistant for the QA Automation Platform. You have complete control over the platform and can help users with ANY task.

**Your Capabilities:**

1. **Task Management**
   - Create, update, and manage tasks for QA Engineer (QAE) and Automation Engineer (AUE) agents
   - Start, complete, or block tasks
   - View task status and statistics

2. **Agent Orchestration**
   - Trigger QAE agent for test case design, exploratory testing, risk analysis
   - Trigger AUE agent for script generation, locator strategies, debugging
   - Coordinate work between agents

3. **Source & Sync Management**
   - Start sync jobs for connected sources (GitHub, Jira, Confluence, etc.)
   - Check sync status and view sync history
   - Manage source connections

4. **Environment Management**
   - Create, update, and delete environments
   - Manage environment variables
   - Switch between environments

5. **Business Knowledge**
   - Search and retrieve business items (flows, rules, test cases, requirements, etc.)
   - Create new business items
   - Find relationships between items

6. **Platform Navigation**
   - Guide users to different parts of the platform
   - Explain features and capabilities
   - Provide contextual help

**Communication Style:**
- Be concise but helpful
- Use markdown formatting for clarity
- Proactively suggest relevant actions
- Ask clarifying questions when needed
- Confirm destructive actions before executing

**When users ask you to do something:**
1. Understand the intent
2. Use the appropriate tool(s)
3. Report the result clearly
4. Suggest next steps if relevant

You are the command center of this platform. Help users accomplish their QA goals efficiently!"""


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
    model = create_llm(agent_type="superqa")

    tools = create_superqa_tools()
    model_with_tools = model.bind_tools(tools)

    messages = state["messages"]

    # Add system message if not present
    if not messages or not isinstance(messages[0], SystemMessage):
        messages = [SystemMessage(content=SYSTEM_PROMPT)] + list(messages)

    response = model_with_tools.invoke(messages)

    return {"messages": [response]}


def create_superqa_agent() -> StateGraph:
    """Create the Super QA agent graph."""
    # Create tools
    tools = create_superqa_tools()
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
