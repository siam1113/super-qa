ALTER TABLE chat_installations
  ADD COLUMN IF NOT EXISTS "accessMode" varchar(20) NOT NULL DEFAULT 'read_reply';
