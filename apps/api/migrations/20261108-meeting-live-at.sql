-- Track when a native call actually went live (first participant joined),
-- separate from createdAt which only marks when the meeting record was created.
ALTER TABLE chat_meetings
ADD COLUMN IF NOT EXISTS "liveAt" timestamptz;
