BEGIN;

CREATE TABLE IF NOT EXISTS chat_prompts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "projectId" uuid NOT NULL REFERENCES qa_projects(id) ON DELETE CASCADE,
  name varchar(60) NOT NULL CHECK (char_length(name) BETWEEN 1 AND 60),
  content text NOT NULL CHECK (char_length(content) BETWEEN 1 AND 4000),
  "createdBy" uuid,
  "updatedBy" uuid,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now(),
  UNIQUE ("projectId", name)
);

CREATE TABLE IF NOT EXISTS chat_agent_prompt_installs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "projectId" uuid NOT NULL REFERENCES qa_projects(id) ON DELETE CASCADE,
  "agentId" uuid NOT NULL REFERENCES chat_agents(id) ON DELETE CASCADE,
  scenario varchar(20) NOT NULL CHECK (scenario IN ('conversation', 'meeting')),
  "promptId" uuid NOT NULL REFERENCES chat_prompts(id) ON DELETE CASCADE,
  "updatedAt" timestamptz NOT NULL DEFAULT now(),
  UNIQUE ("projectId", "agentId", scenario)
);

CREATE INDEX IF NOT EXISTS chat_prompts_project ON chat_prompts ("projectId");
CREATE INDEX IF NOT EXISTS chat_agent_prompt_installs_prompt ON chat_agent_prompt_installs ("promptId");

COMMIT;
