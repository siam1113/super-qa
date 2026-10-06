BEGIN;

ALTER TABLE chat_agents DROP CONSTRAINT IF EXISTS chat_agents_supported_kind;
ALTER TABLE chat_agents ADD CONSTRAINT chat_agents_supported_kind CHECK (kind IS NULL OR kind IN ('qae', 'aue', 'superqa'));

ALTER TABLE chat_meeting_runs
  ADD COLUMN IF NOT EXISTS "requireRelevance" boolean NOT NULL DEFAULT false;

COMMIT;
