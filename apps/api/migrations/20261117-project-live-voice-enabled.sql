-- Per-project admin control for whether "Active participant" meetings are
-- allowed to use live GPT-Live voice, independent of the global
-- MEETING_LIVE_ENABLED env var / OPENAI_API_KEY configuration.
ALTER TABLE qa_projects
ADD COLUMN IF NOT EXISTS "liveVoiceEnabled" boolean NOT NULL DEFAULT true;
