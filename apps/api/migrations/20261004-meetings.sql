CREATE TABLE IF NOT EXISTS chat_meetings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), "projectId" uuid NOT NULL, "conversationId" uuid NOT NULL,
  "createdBy" uuid NOT NULL, "keyId" uuid NOT NULL, "requestId" uuid NOT NULL, "agentId" uuid NOT NULL,
  mode varchar NOT NULL, provider varchar NOT NULL, url text, status varchar NOT NULL DEFAULT 'live',
  "botId" varchar, error varchar, version integer NOT NULL DEFAULT 1, stopped boolean NOT NULL DEFAULT false,
  "syncedAt" timestamptz, "createdAt" timestamptz NOT NULL DEFAULT now(), UNIQUE ("projectId", "requestId")
);
CREATE TABLE IF NOT EXISTS chat_meeting_peers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), "meetingId" uuid NOT NULL, "memberId" uuid NOT NULL,
  name varchar NOT NULL, "sessionId" uuid NOT NULL, "seenAt" timestamptz NOT NULL, "consentAt" timestamptz NOT NULL,
  UNIQUE ("meetingId", "memberId")
);
CREATE TABLE IF NOT EXISTS chat_meeting_signals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), sequence serial NOT NULL, "meetingId" uuid NOT NULL,
  "requestId" uuid NOT NULL, sender uuid NOT NULL, recipient uuid NOT NULL, payload jsonb NOT NULL,
  "createdAt" timestamptz NOT NULL DEFAULT now(), UNIQUE ("meetingId", "requestId")
);
CREATE TABLE IF NOT EXISTS chat_meeting_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), sequence serial NOT NULL, "meetingId" uuid NOT NULL,
  "eventId" varchar NOT NULL, speaker varchar NOT NULL, source varchar NOT NULL, text text NOT NULL,
  "createdAt" timestamptz NOT NULL DEFAULT now(), UNIQUE ("meetingId", "eventId")
);
CREATE TABLE IF NOT EXISTS chat_meeting_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), "meetingId" uuid NOT NULL, "projectId" uuid NOT NULL,
  "requestId" varchar NOT NULL, "memberId" uuid NOT NULL, "keyId" uuid NOT NULL, kind varchar NOT NULL,
  prompt text NOT NULL DEFAULT '', status varchar NOT NULL DEFAULT 'queued', version integer NOT NULL,
  "policyVersion" integer NOT NULL, "throughSequence" integer NOT NULL, "evidenceIds" jsonb NOT NULL DEFAULT '[]',
  result jsonb, usage jsonb, error varchar, delivery varchar, "publishedMessageId" uuid, "voiceAt" timestamptz, "startedAt" timestamptz,
  "createdAt" timestamptz NOT NULL DEFAULT now(), UNIQUE ("meetingId", "requestId")
);
ALTER TABLE chat_meeting_runs ADD COLUMN IF NOT EXISTS "voiceAt" timestamptz;
