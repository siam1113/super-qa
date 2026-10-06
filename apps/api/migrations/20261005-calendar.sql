CREATE TABLE IF NOT EXISTS chat_calendars (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), "projectId" uuid NOT NULL, "agentId" uuid NOT NULL,
  "conversationId" uuid NOT NULL, "memberId" uuid NOT NULL, "keyId" uuid NOT NULL,
  provider varchar NOT NULL, "accountId" varchar NOT NULL, email varchar NOT NULL, mode varchar NOT NULL,
  enabled boolean NOT NULL DEFAULT true, "autoJoin" boolean NOT NULL DEFAULT true, version integer NOT NULL DEFAULT 1,
  secret text, "syncedAt" timestamptz, "nextSyncAt" timestamptz NOT NULL, lease uuid, error varchar,
  "createdAt" timestamptz NOT NULL DEFAULT now(), UNIQUE ("projectId", "agentId"), UNIQUE(provider, "accountId")
);
CREATE TABLE IF NOT EXISTS chat_calendar_oauth (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), digest varchar UNIQUE NOT NULL, "projectId" uuid NOT NULL,
  "memberId" uuid NOT NULL, "keyId" uuid NOT NULL, "agentId" uuid NOT NULL, "conversationId" uuid NOT NULL,
  provider varchar NOT NULL, email varchar NOT NULL, mode varchar NOT NULL, verifier text NOT NULL, "calendarVersion" integer NOT NULL DEFAULT 0, "expiresAt" timestamptz NOT NULL
);
ALTER TABLE chat_calendar_oauth ADD COLUMN IF NOT EXISTS "calendarVersion" integer NOT NULL DEFAULT 0;
CREATE TABLE IF NOT EXISTS chat_calendar_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), "projectId" uuid NOT NULL, "calendarId" uuid NOT NULL,
  "externalId" varchar NOT NULL, title varchar NOT NULL, "startsAt" timestamptz NOT NULL, "endsAt" timestamptz NOT NULL,
  organizer varchar NOT NULL, attendees jsonb NOT NULL DEFAULT '[]', url varchar, provider varchar, status varchar NOT NULL,
  skipped boolean NOT NULL DEFAULT false, version integer NOT NULL DEFAULT 1, "meetingId" uuid, "dispatchedAt" timestamptz,
  error varchar, "seenAt" timestamptz NOT NULL, UNIQUE ("calendarId", "externalId")
);
CREATE INDEX IF NOT EXISTS chat_calendar_due ON chat_calendar_events (status, "startsAt");
ALTER TABLE chat_meetings ADD COLUMN IF NOT EXISTS title varchar NOT NULL DEFAULT 'Meeting';
ALTER TABLE chat_meetings ADD COLUMN IF NOT EXISTS "scheduledStart" timestamptz;
ALTER TABLE chat_meetings ADD COLUMN IF NOT EXISTS "scheduledEnd" timestamptz;
ALTER TABLE chat_meetings ADD COLUMN IF NOT EXISTS attendees jsonb NOT NULL DEFAULT '[]';
ALTER TABLE chat_meetings ADD COLUMN IF NOT EXISTS "calendarEventId" uuid;
CREATE UNIQUE INDEX IF NOT EXISTS chat_meeting_calendar_event ON chat_meetings ("calendarEventId");
