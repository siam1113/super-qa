BEGIN;

ALTER TABLE chat_work
  ADD COLUMN IF NOT EXISTS "requireRelevance" boolean NOT NULL DEFAULT false;

COMMIT;
