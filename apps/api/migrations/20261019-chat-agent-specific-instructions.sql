BEGIN;

ALTER TABLE chat_conversations
  ADD COLUMN IF NOT EXISTS "agentInstructions" jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMIT;
