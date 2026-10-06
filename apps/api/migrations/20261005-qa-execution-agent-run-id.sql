BEGIN;

ALTER TABLE qa_executions ADD COLUMN IF NOT EXISTS "agentRunId" varchar;
CREATE UNIQUE INDEX IF NOT EXISTS qa_executions_agent_run_id_unique ON qa_executions ("agentRunId") WHERE "agentRunId" IS NOT NULL;

COMMIT;
