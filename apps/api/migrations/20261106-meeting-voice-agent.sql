BEGIN;

ALTER TABLE chat_meeting_voice ADD COLUMN IF NOT EXISTS "agentId" uuid;

-- Rows are short-lived (1h expiresAt, created fresh per call attempt) — pre-production, nothing to backfill.
DELETE FROM chat_meeting_voice WHERE "agentId" IS NULL;

ALTER TABLE chat_meeting_voice ALTER COLUMN "agentId" SET NOT NULL;

DO $$
DECLARE constraint_name text;
BEGIN
  FOR constraint_name IN
    SELECT constraint_row.conname
    FROM pg_constraint constraint_row
    JOIN pg_class table_row ON table_row.oid = constraint_row.conrelid
    JOIN pg_attribute column_row ON column_row.attrelid = table_row.oid AND column_row.attname = 'meetingId'
    WHERE table_row.relname = 'chat_meeting_voice' AND constraint_row.contype = 'u'
      AND constraint_row.conkey = ARRAY[column_row.attnum]::smallint[]
  LOOP
    EXECUTE format('ALTER TABLE chat_meeting_voice DROP CONSTRAINT %I', constraint_name);
  END LOOP;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS chat_meeting_voice_meeting_agent_unique ON chat_meeting_voice ("meetingId", "agentId");

COMMIT;
