BEGIN;

ALTER TABLE chat_meeting_voice
  ADD COLUMN IF NOT EXISTS "openAIVoice" varchar NOT NULL DEFAULT 'marin';

COMMIT;
