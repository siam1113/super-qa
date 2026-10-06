CREATE TABLE IF NOT EXISTS chat_meeting_voice (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "meetingId" uuid NOT NULL UNIQUE,
  "projectId" uuid NOT NULL,
  "peerSession" uuid,
  capability varchar,
  "providerId" varchar,
  status varchar NOT NULL DEFAULT 'pending',
  stopped boolean NOT NULL DEFAULT false,
  finalized boolean NOT NULL DEFAULT false,
  seconds double precision NOT NULL DEFAULT 0,
  "policyVersion" integer NOT NULL DEFAULT 1,
  "controlAt" timestamptz NOT NULL DEFAULT now(),
  error varchar,
  "seenAt" timestamptz NOT NULL,
  "expiresAt" timestamptz NOT NULL,
  "createdAt" timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE chat_meetings ADD COLUMN IF NOT EXISTS "liveVoice" boolean NOT NULL DEFAULT false;
