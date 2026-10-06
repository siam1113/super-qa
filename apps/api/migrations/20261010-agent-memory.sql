BEGIN;

CREATE TABLE IF NOT EXISTS chat_agent_memories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "projectId" uuid NOT NULL REFERENCES qa_projects(id) ON DELETE CASCADE,
  "agentId" uuid NOT NULL REFERENCES chat_agents(id) ON DELETE CASCADE,
  category varchar(20) NOT NULL CHECK (category IN ('preference', 'decision', 'workflow', 'constraint')),
  content text NOT NULL CHECK (char_length(content) BETWEEN 1 AND 2000),
  "contentHash" varchar(64) NOT NULL,
  status varchar(10) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  importance smallint NOT NULL DEFAULT 3 CHECK (importance BETWEEN 1 AND 5),
  "createdBy" uuid NOT NULL,
  "updatedBy" uuid NOT NULL,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  "expiresAt" timestamptz,
  "lastUsedAt" timestamptz,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS chat_agent_memory_revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "projectId" uuid NOT NULL REFERENCES qa_projects(id) ON DELETE CASCADE,
  "memoryId" uuid NOT NULL REFERENCES chat_agent_memories(id) ON DELETE CASCADE,
  version integer NOT NULL CHECK (version > 0),
  change varchar(12) NOT NULL CHECK (change IN ('created', 'updated', 'archived', 'restored')),
  category varchar(20) NOT NULL CHECK (category IN ('preference', 'decision', 'workflow', 'constraint')),
  content text NOT NULL CHECK (char_length(content) BETWEEN 1 AND 2000),
  importance smallint NOT NULL CHECK (importance BETWEEN 1 AND 5),
  "actorId" uuid NOT NULL,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  UNIQUE ("projectId", "memoryId", version)
);

CREATE INDEX IF NOT EXISTS chat_agent_memories_scope ON chat_agent_memories ("projectId", "agentId", status, importance DESC, "updatedAt" DESC);
CREATE UNIQUE INDEX IF NOT EXISTS chat_agent_memories_active_content ON chat_agent_memories ("projectId", "agentId", "contentHash") WHERE status = 'active';
CREATE INDEX IF NOT EXISTS chat_agent_memories_expiry ON chat_agent_memories ("expiresAt") WHERE status = 'active' AND "expiresAt" IS NOT NULL;
CREATE INDEX IF NOT EXISTS chat_agent_memories_search ON chat_agent_memories USING GIN (to_tsvector('simple', content)) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS chat_agent_memory_revisions_history ON chat_agent_memory_revisions ("projectId", "memoryId", version DESC);

COMMIT;
