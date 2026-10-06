BEGIN;

CREATE TABLE IF NOT EXISTS chat_meeting_activity (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sequence serial NOT NULL,
  "meetingId" uuid NOT NULL,
  "projectId" uuid NOT NULL,
  kind varchar NOT NULL,
  "authorId" uuid,
  "authorKind" varchar,
  "authorName" varchar,
  text text,
  "replyToId" uuid,
  "requestId" uuid,
  "createdAt" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS chat_meeting_activity_meeting_sequence ON chat_meeting_activity ("meetingId", sequence);
CREATE UNIQUE INDEX IF NOT EXISTS chat_meeting_activity_request_unique ON chat_meeting_activity ("meetingId", "requestId") WHERE "requestId" IS NOT NULL;

DROP TRIGGER IF EXISTS meeting_activity_insert_notify ON chat_meeting_activity;
CREATE TRIGGER meeting_activity_insert_notify AFTER INSERT ON chat_meeting_activity
  FOR EACH ROW EXECUTE FUNCTION notify_calendar_work_available();

COMMIT;
