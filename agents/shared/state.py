"""LangGraph state definitions for agents."""
from typing import TypedDict, Annotated, Sequence, Literal
from langchain_core.messages import BaseMessage
import operator


class AgentState(TypedDict):
    """State for the agent graph."""

    # Messages in the conversation
    messages: Annotated[Sequence[BaseMessage], operator.add]

    # Current context from business knowledge
    context: dict

    # Tool results from the current turn
    tool_results: dict

    # Whether to continue processing
    should_continue: bool

    # Session ID for persistence
    session_id: str

    # Agent type (qae or aue)
    agent_type: Literal["qae", "aue"]


class ChatRequest(TypedDict):
    """Request format for chat endpoint."""
    message: str
    session_id: str | None


class ChatResponse(TypedDict):
    """Response format for chat endpoint."""
    session_id: str
    message_id: str
    response: str
    tool_calls: list[dict] | None
