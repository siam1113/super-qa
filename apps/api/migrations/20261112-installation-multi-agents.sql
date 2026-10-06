BEGIN;

ALTER TABLE chat_installations
  ADD COLUMN IF NOT EXISTS "agentIds" jsonb NOT NULL DEFAULT '[]'::jsonb;

UPDATE chat_installations
SET "agentIds" = jsonb_build_array("agentId")
WHERE "agentId" IS NOT NULL AND "agentIds" = '[]'::jsonb;

ALTER TABLE chat_installations
  ALTER COLUMN "agentId" DROP NOT NULL;

COMMIT;
