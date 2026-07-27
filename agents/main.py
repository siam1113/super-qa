"""FastAPI entrypoint for the QA Agents service."""
import os
import uuid
import logging
from contextlib import asynccontextmanager
from typing import Literal

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from dotenv import load_dotenv

from langchain_core.messages import HumanMessage, AIMessage, SystemMessage

from qae.agent import create_qae_agent, SYSTEM_PROMPT as QAE_PROMPT
from aue.agent import create_aue_agent, SYSTEM_PROMPT as AUE_PROMPT
from superqa.agent import create_superqa_agent, SYSTEM_PROMPT as SUPERQA_PROMPT
from shared.state import AgentState
from shared.llm import get_available_providers, LLMConfig, LLMProvider
from sessions import SessionManager
from runner.service import get_runner

# Load environment variables
load_dotenv()

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Initialize session manager
session_manager: SessionManager | None = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan handler."""
    global session_manager

    # Initialize Redis session manager
    redis_url = os.getenv("REDIS_URL", "redis://localhost:6379")
    session_manager = SessionManager(redis_url)
    await session_manager.connect()
    logger.info("Connected to Redis for session management")

    # Initialize test runner service
    runner = get_runner()
    await runner.start()
    logger.info("Test Runner Service started")

    yield

    # Cleanup
    await runner.stop()
    logger.info("Test Runner Service stopped")

    await session_manager.disconnect()
    logger.info("Disconnected from Redis")


app = FastAPI(
    title="QA Agents Service",
    description="LangGraph-powered QA and Automation agents",
    version="1.0.0",
    lifespan=lifespan,
)

# CORS configuration
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Create agent instances
qae_agent = create_qae_agent()
aue_agent = create_aue_agent()
superqa_agent = create_superqa_agent()


class ChatRequest(BaseModel):
    """Request body for chat endpoint."""
    message: str
    sessionId: str | None = None


class ChatResponse(BaseModel):
    """Response body for chat endpoint."""
    sessionId: str
    messageId: str
    response: str
    toolCalls: list[dict] | None = None


class SessionResponse(BaseModel):
    """Response body for session endpoints."""
    id: str
    agentType: str
    status: str
    createdAt: str
    messageCount: int = 0


class AgentConfigResponse(BaseModel):
    """Response body for agent config endpoint."""
    type: str
    name: str
    description: str
    tools: list[str]


# Agent configurations
AGENT_CONFIGS = {
    "qae": {
        "type": "qae",
        "name": "QA Engineer Agent",
        "description": "Performs manual QA tasks: test case design, exploratory testing, bug analysis",
        "tools": ["search_test_cases", "search_requirements", "analyze_risk", "generate_test_cases"],
        "system_prompt": QAE_PROMPT,
    },
    "aue": {
        "type": "aue",
        "name": "Automation Engineer Agent",
        "description": "Handles automation tasks: script generation, locator strategies, framework setup",
        "tools": ["search_locators", "search_page_objects", "generate_script", "analyze_failure"],
        "system_prompt": AUE_PROMPT,
    },
    "superqa": {
        "type": "superqa",
        "name": "Super QA",
        "description": "All-powerful platform assistant that can manage tasks, trigger agents, sync sources, and more",
        "tools": [
            "create_task", "list_tasks", "start_task", "complete_task", "block_task",
            "list_sources", "start_sync", "check_sync_status",
            "list_environments", "create_environment", "add_environment_variable",
            "search_knowledge", "get_platform_stats", "get_help",
        ],
        "system_prompt": SUPERQA_PROMPT,
    },
}


def get_agent(agent_type: str):
    """Get the appropriate agent based on type."""
    if agent_type == "qae":
        return qae_agent
    elif agent_type == "aue":
        return aue_agent
    elif agent_type == "superqa":
        return superqa_agent
    else:
        raise HTTPException(status_code=404, detail=f"Unknown agent type: {agent_type}")


def extract_tool_calls(message) -> list[dict] | None:
    """Extract tool calls from an AI message."""
    if hasattr(message, "tool_calls") and message.tool_calls:
        return [
            {
                "id": tc.get("id", str(uuid.uuid4())),
                "name": tc.get("name", "unknown"),
                "arguments": tc.get("args", {}),
                "status": "completed",
            }
            for tc in message.tool_calls
        ]
    return None


@app.get("/health")
async def health_check():
    """Health check endpoint."""
    return {"status": "healthy", "service": "qa-agents"}


@app.get("/agents/config")
async def get_all_configs():
    """Get all agent configurations."""
    return [
        AgentConfigResponse(
            type=config["type"],
            name=config["name"],
            description=config["description"],
            tools=config["tools"],
        )
        for config in AGENT_CONFIGS.values()
    ]


@app.get("/agents/{agent_type}/config")
async def get_agent_config(agent_type: Literal["qae", "aue", "superqa"]):
    """Get configuration for a specific agent."""
    if agent_type not in AGENT_CONFIGS:
        raise HTTPException(status_code=404, detail=f"Unknown agent type: {agent_type}")

    config = AGENT_CONFIGS[agent_type]
    return AgentConfigResponse(
        type=config["type"],
        name=config["name"],
        description=config["description"],
        tools=config["tools"],
    )


@app.post("/agents/{agent_type}/chat", response_model=ChatResponse)
async def chat_with_agent(agent_type: Literal["qae", "aue", "superqa"], request: ChatRequest):
    """Chat with an agent."""
    agent = get_agent(agent_type)

    # Get or create session
    session_id = request.sessionId
    if session_id:
        session_data = await session_manager.get_session(session_id)
        if not session_data:
            # Session not found, create new one
            session_id = await session_manager.create_session(agent_type)
            session_data = await session_manager.get_session(session_id)
    else:
        session_id = await session_manager.create_session(agent_type)
        session_data = await session_manager.get_session(session_id)

    # Build messages from history
    messages = []
    for msg in session_data.get("messages", []):
        if msg["role"] == "user":
            messages.append(HumanMessage(content=msg["content"]))
        elif msg["role"] == "assistant":
            messages.append(AIMessage(content=msg["content"]))
        elif msg["role"] == "system":
            messages.append(SystemMessage(content=msg["content"]))

    # Add new user message
    messages.append(HumanMessage(content=request.message))

    # Create initial state
    initial_state: AgentState = {
        "messages": messages,
        "context": session_data.get("context", {}),
        "tool_results": {},
        "should_continue": True,
        "session_id": session_id,
        "agent_type": agent_type,
    }

    try:
        # Run the agent
        result = await agent.ainvoke(initial_state)

        # Extract the final response
        final_messages = result.get("messages", [])
        last_message = final_messages[-1] if final_messages else None

        if last_message:
            response_content = last_message.content if hasattr(last_message, "content") else str(last_message)
            tool_calls = extract_tool_calls(last_message)
        else:
            response_content = "I apologize, but I couldn't generate a response."
            tool_calls = None

        # Save messages to session
        message_id = str(uuid.uuid4())
        await session_manager.add_message(session_id, {
            "id": str(uuid.uuid4()),
            "role": "user",
            "content": request.message,
        })
        await session_manager.add_message(session_id, {
            "id": message_id,
            "role": "assistant",
            "content": response_content,
            "toolCalls": tool_calls,
        })

        return ChatResponse(
            sessionId=session_id,
            messageId=message_id,
            response=response_content,
            toolCalls=tool_calls,
        )

    except Exception as e:
        logger.error(f"Error in agent execution: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/agents/{agent_type}/sessions")
async def get_agent_sessions(agent_type: Literal["qae", "aue", "superqa"]):
    """Get all sessions for an agent type."""
    sessions = await session_manager.get_sessions_by_type(agent_type)
    return [
        SessionResponse(
            id=s["id"],
            agentType=s["agentType"],
            status=s["status"],
            createdAt=s["createdAt"],
            messageCount=len(s.get("messages", [])),
        )
        for s in sessions
    ]


@app.post("/agents/{agent_type}/sessions")
async def create_session(agent_type: Literal["qae", "aue", "superqa"]):
    """Create a new session for an agent."""
    session_id = await session_manager.create_session(agent_type)
    session_data = await session_manager.get_session(session_id)

    return SessionResponse(
        id=session_id,
        agentType=agent_type,
        status="idle",
        createdAt=session_data["createdAt"],
        messageCount=0,
    )


@app.get("/sessions/{session_id}")
async def get_session(session_id: str):
    """Get a specific session by ID."""
    session_data = await session_manager.get_session(session_id)
    if not session_data:
        raise HTTPException(status_code=404, detail="Session not found")

    return {
        "id": session_data["id"],
        "agentType": session_data["agentType"],
        "status": session_data["status"],
        "messages": session_data.get("messages", []),
        "context": session_data.get("context", {}),
        "createdAt": session_data["createdAt"],
        "updatedAt": session_data.get("updatedAt", session_data["createdAt"]),
    }


@app.delete("/sessions/{session_id}")
async def delete_session(session_id: str):
    """Delete a session."""
    success = await session_manager.delete_session(session_id)
    if not success:
        raise HTTPException(status_code=404, detail="Session not found")
    return {"status": "deleted"}


# ============ LLM Provider Endpoints ============

class LLMConfigRequest(BaseModel):
    """Request body for LLM configuration."""
    provider: str
    model: str
    temperature: float = 0.7


@app.get("/llm/providers")
async def get_llm_providers():
    """Get available LLM providers and their status."""
    providers = get_available_providers()
    current_provider = os.getenv("LLM_PROVIDER", "openai")
    current_model = os.getenv("LLM_MODEL", "gpt-4")

    return {
        "current": {
            "provider": current_provider,
            "model": current_model,
        },
        "providers": providers,
    }


@app.get("/llm/models/{provider}")
async def get_provider_models(provider: str):
    """Get available models for a specific provider."""
    providers = get_available_providers()

    for p in providers:
        if p["id"] == provider:
            if not p["available"]:
                raise HTTPException(
                    status_code=503,
                    detail=f"Provider '{provider}' is not available: {p['reason']}"
                )
            return {"provider": provider, "models": p["models"]}

    raise HTTPException(status_code=404, detail=f"Unknown provider: {provider}")


@app.post("/llm/config")
async def set_llm_config(config: LLMConfigRequest):
    """Set the LLM configuration (runtime only - use env vars for persistence)."""
    # Validate provider
    try:
        provider = LLMProvider(config.provider.lower())
    except ValueError:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid provider: {config.provider}. Must be one of: openai, anthropic, ollama"
        )

    # Set environment variables (runtime only)
    os.environ["LLM_PROVIDER"] = provider.value
    os.environ["LLM_MODEL"] = config.model
    os.environ["LLM_TEMPERATURE"] = str(config.temperature)

    logger.info(f"LLM config updated: provider={provider.value}, model={config.model}")

    return {
        "status": "updated",
        "config": {
            "provider": provider.value,
            "model": config.model,
            "temperature": config.temperature,
        },
    }


if __name__ == "__main__":
    import uvicorn

    port = int(os.getenv("PORT", "8000"))
    uvicorn.run(app, host="0.0.0.0", port=port)
