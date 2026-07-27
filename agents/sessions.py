"""Redis-based session management for agents."""
import json
import uuid
import logging
from datetime import datetime, timezone
from typing import Literal

import redis.asyncio as redis

logger = logging.getLogger(__name__)

AgentType = Literal["qae", "aue"]


class SessionManager:
    """Manages agent sessions using Redis."""

    def __init__(self, redis_url: str = "redis://localhost:6379"):
        self.redis_url = redis_url
        self.client: redis.Redis | None = None
        self.session_prefix = "agent:session:"
        self.session_index_prefix = "agent:sessions:"
        self.session_ttl = 60 * 60 * 24 * 7  # 7 days

    async def connect(self) -> None:
        """Connect to Redis."""
        try:
            self.client = redis.from_url(self.redis_url, decode_responses=True)
            await self.client.ping()
            logger.info("Connected to Redis")
        except Exception as e:
            logger.warning(f"Failed to connect to Redis: {e}. Using in-memory fallback.")
            self.client = None
            self._memory_store: dict[str, dict] = {}
            self._session_index: dict[str, list[str]] = {"qae": [], "aue": []}

    async def disconnect(self) -> None:
        """Disconnect from Redis."""
        if self.client:
            await self.client.close()
            logger.info("Disconnected from Redis")

    def _get_session_key(self, session_id: str) -> str:
        """Get Redis key for a session."""
        return f"{self.session_prefix}{session_id}"

    def _get_index_key(self, agent_type: AgentType) -> str:
        """Get Redis key for agent type index."""
        return f"{self.session_index_prefix}{agent_type}"

    async def create_session(self, agent_type: AgentType) -> str:
        """Create a new session."""
        session_id = str(uuid.uuid4())
        now = datetime.now(timezone.utc).isoformat()

        session_data = {
            "id": session_id,
            "agentType": agent_type,
            "status": "idle",
            "messages": [],
            "context": {},
            "createdAt": now,
            "updatedAt": now,
        }

        if self.client:
            key = self._get_session_key(session_id)
            await self.client.set(key, json.dumps(session_data), ex=self.session_ttl)
            # Add to agent type index
            index_key = self._get_index_key(agent_type)
            await self.client.sadd(index_key, session_id)
        else:
            self._memory_store[session_id] = session_data
            if agent_type not in self._session_index:
                self._session_index[agent_type] = []
            self._session_index[agent_type].append(session_id)

        logger.info(f"Created session {session_id} for agent {agent_type}")
        return session_id

    async def get_session(self, session_id: str) -> dict | None:
        """Get session data by ID."""
        if self.client:
            key = self._get_session_key(session_id)
            data = await self.client.get(key)
            if data:
                return json.loads(data)
            return None
        else:
            return self._memory_store.get(session_id)

    async def update_session(self, session_id: str, updates: dict) -> bool:
        """Update session data."""
        session_data = await self.get_session(session_id)
        if not session_data:
            return False

        session_data.update(updates)
        session_data["updatedAt"] = datetime.now(timezone.utc).isoformat()

        if self.client:
            key = self._get_session_key(session_id)
            await self.client.set(key, json.dumps(session_data), ex=self.session_ttl)
        else:
            self._memory_store[session_id] = session_data

        return True

    async def add_message(self, session_id: str, message: dict) -> bool:
        """Add a message to session history."""
        session_data = await self.get_session(session_id)
        if not session_data:
            return False

        if "messages" not in session_data:
            session_data["messages"] = []

        # Add timestamp if not present
        if "timestamp" not in message:
            message["timestamp"] = datetime.now(timezone.utc).isoformat()

        session_data["messages"].append(message)
        session_data["updatedAt"] = datetime.now(timezone.utc).isoformat()

        if self.client:
            key = self._get_session_key(session_id)
            await self.client.set(key, json.dumps(session_data), ex=self.session_ttl)
        else:
            self._memory_store[session_id] = session_data

        return True

    async def set_status(self, session_id: str, status: str) -> bool:
        """Update session status."""
        return await self.update_session(session_id, {"status": status})

    async def set_context(self, session_id: str, context: dict) -> bool:
        """Update session context."""
        return await self.update_session(session_id, {"context": context})

    async def delete_session(self, session_id: str) -> bool:
        """Delete a session."""
        session_data = await self.get_session(session_id)
        if not session_data:
            return False

        agent_type = session_data.get("agentType")

        if self.client:
            key = self._get_session_key(session_id)
            await self.client.delete(key)
            if agent_type:
                index_key = self._get_index_key(agent_type)
                await self.client.srem(index_key, session_id)
        else:
            if session_id in self._memory_store:
                del self._memory_store[session_id]
            if agent_type and agent_type in self._session_index:
                self._session_index[agent_type] = [
                    s for s in self._session_index[agent_type] if s != session_id
                ]

        logger.info(f"Deleted session {session_id}")
        return True

    async def get_sessions_by_type(self, agent_type: AgentType) -> list[dict]:
        """Get all sessions for an agent type."""
        sessions = []

        if self.client:
            index_key = self._get_index_key(agent_type)
            session_ids = await self.client.smembers(index_key)

            for session_id in session_ids:
                session_data = await self.get_session(session_id)
                if session_data:
                    sessions.append(session_data)
        else:
            session_ids = self._session_index.get(agent_type, [])
            for session_id in session_ids:
                if session_id in self._memory_store:
                    sessions.append(self._memory_store[session_id])

        # Sort by updatedAt descending
        sessions.sort(key=lambda x: x.get("updatedAt", ""), reverse=True)
        return sessions

    async def cleanup_old_sessions(self, max_age_days: int = 7) -> int:
        """Clean up sessions older than max_age_days."""
        if not self.client:
            # For in-memory store, sessions don't persist anyway
            return 0

        deleted = 0
        cutoff = datetime.now(timezone.utc).timestamp() - (max_age_days * 24 * 60 * 60)

        for agent_type in ["qae", "aue"]:
            index_key = self._get_index_key(agent_type)
            session_ids = await self.client.smembers(index_key)

            for session_id in session_ids:
                session_data = await self.get_session(session_id)
                if session_data:
                    created_at = session_data.get("createdAt", "")
                    try:
                        created_ts = datetime.fromisoformat(created_at.replace("Z", "+00:00")).timestamp()
                        if created_ts < cutoff:
                            await self.delete_session(session_id)
                            deleted += 1
                    except (ValueError, TypeError):
                        continue

        logger.info(f"Cleaned up {deleted} old sessions")
        return deleted
