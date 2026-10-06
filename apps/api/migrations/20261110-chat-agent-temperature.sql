BEGIN;

ALTER TABLE chat_agents ADD COLUMN IF NOT EXISTS "temperature" real
  CHECK ("temperature" IS NULL OR ("temperature" >= 0 AND "temperature" <= 1));

COMMIT;
