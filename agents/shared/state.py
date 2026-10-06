"""LangGraph state definitions for agents."""
from typing import TypedDict, Annotated, Sequence, Literal, Optional, List
from langchain_core.messages import BaseMessage
import operator


class AgentState(TypedDict):
    """State for the agent graph."""

    # Messages in the conversation
    messages: Annotated[Sequence[BaseMessage], operator.add]

    # Current context from business knowledge
    context: dict

    # Retrieved long-term agent memories for this request
    memories: list

    # Selected meeting notes/transcript attached as reference context for this request
    meeting_context: Optional[str]

    # Tool results from the current turn
    tool_results: dict

    # Whether to continue processing
    should_continue: bool

    # Session ID for persistence
    session_id: str

    # Agent type (qae or aue)
    agent_type: Literal["qae", "aue", "superqa"]

    # Explicit workflow requests bypass conversational model routing.
    skill_request: dict
    skill_result: dict
    agent_iterations: int


class ChatRequest(TypedDict):
    """Request format for chat endpoint."""
    message: str
    session_id: Optional[str]


class ChatResponse(TypedDict):
    """Response format for chat endpoint."""
    session_id: str
    message_id: str
    response: str
    tool_calls: Optional[List[dict]]
