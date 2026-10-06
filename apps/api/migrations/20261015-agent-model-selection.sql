BEGIN;
ALTER TABLE chat_agents ADD COLUMN IF NOT EXISTS "modelSelection" jsonb;
COMMIT;
