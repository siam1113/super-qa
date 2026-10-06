ALTER TABLE chat_meeting_voice
  ADD COLUMN IF NOT EXISTS "attemptSeconds" double precision NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS attempts integer NOT NULL DEFAULT 1;
