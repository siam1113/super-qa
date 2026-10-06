BEGIN;

ALTER TABLE chat_conversations
  ADD COLUMN IF NOT EXISTS "agentIds" jsonb NOT NULL DEFAULT '[]'::jsonb;

UPDATE chat_conversations
SET "agentIds" = jsonb_build_array("agentId")
WHERE "agentId" IS NOT NULL AND "agentIds" = '[]'::jsonb;

DO $$
DECLARE constraint_name text;
BEGIN
  FOR constraint_name IN
    SELECT constraint_row.conname
    FROM pg_constraint constraint_row
    JOIN pg_class table_row ON table_row.oid = constraint_row.conrelid
    JOIN pg_attribute column_row ON column_row.attrelid = table_row.oid
      AND column_row.attname = 'messageId'
    WHERE table_row.relname = 'chat_work'
      AND constraint_row.contype = 'u'
      AND constraint_row.conkey = ARRAY[column_row.attnum]::smallint[]
  LOOP
    EXECUTE format('ALTER TABLE chat_work DROP CONSTRAINT %I', constraint_name);
  END LOOP;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS chat_work_message_agent_unique
  ON chat_work ("messageId", "agentId");

COMMIT;
