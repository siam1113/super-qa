BEGIN;

ALTER TABLE chat_agents ADD COLUMN IF NOT EXISTS avatar varchar(20);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chat_agents_avatar_supported' AND conrelid = 'chat_agents'::regclass) THEN
    ALTER TABLE chat_agents ADD CONSTRAINT chat_agents_avatar_supported
      CHECK (avatar IS NULL OR avatar IN ('fox', 'panda', 'koala', 'frog', 'penguin', 'owl', 'tiger', 'octopus', 'whale', 'butterfly', 'turtle', 'unicorn'));
  END IF;
END $$;

COMMIT;
