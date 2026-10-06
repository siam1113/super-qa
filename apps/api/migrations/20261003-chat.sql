BEGIN;
CREATE TABLE IF NOT EXISTS chat_agents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), "projectId" uuid NOT NULL,
  name varchar NOT NULL, email varchar NOT NULL, aliases jsonb NOT NULL DEFAULT '[]',
  instructions text NOT NULL DEFAULT '', enabled boolean NOT NULL DEFAULT true,
  "createdAt" timestamp NOT NULL DEFAULT now(), UNIQUE ("projectId", email)
);
CREATE TABLE IF NOT EXISTS chat_conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), "projectId" uuid NOT NULL,
  kind varchar NOT NULL, title varchar NOT NULL, "createdBy" uuid NOT NULL,
  "memberIds" jsonb NOT NULL, "agentId" uuid, instructions text NOT NULL DEFAULT '',
  "policyVersion" integer NOT NULL DEFAULT 1, "dedupKey" varchar,
  "installationId" uuid, "externalId" varchar, archived boolean NOT NULL DEFAULT false,
  "createdAt" timestamp NOT NULL DEFAULT now(), "updatedAt" timestamp NOT NULL DEFAULT now(),
  UNIQUE ("projectId", "dedupKey")
);
CREATE TABLE IF NOT EXISTS chat_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), "projectId" uuid NOT NULL,
  "conversationId" uuid NOT NULL, "requestId" varchar NOT NULL,
  "authorId" varchar NOT NULL, "authorName" varchar NOT NULL, "authorKind" varchar NOT NULL,
  text text NOT NULL, content jsonb, "replyToId" uuid, status varchar NOT NULL DEFAULT 'sent',
  error varchar, "externalThreadId" varchar, "createdAt" timestamp NOT NULL DEFAULT now(),
  UNIQUE ("conversationId", "requestId")
);
ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS sequence SERIAL NOT NULL;
CREATE TABLE IF NOT EXISTS chat_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), "projectId" uuid NOT NULL,
  "conversationId" uuid NOT NULL, "messageId" uuid NOT NULL UNIQUE,
  title varchar NOT NULL, description text NOT NULL, "createdBy" varchar NOT NULL,
  status varchar NOT NULL DEFAULT 'open', "createdAt" timestamp NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS chat_work (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), "projectId" uuid NOT NULL,
  "conversationId" uuid NOT NULL, "agentId" uuid NOT NULL, "messageId" uuid NOT NULL UNIQUE,
  "responseId" uuid NOT NULL, status varchar NOT NULL DEFAULT 'queued',
  "leaseToken" uuid, "leaseUntil" timestamptz, "policyVersion" integer NOT NULL,
  usage jsonb, "createdAt" timestamp NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS chat_installations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), "projectId" uuid NOT NULL,
  "agentId" uuid NOT NULL, provider varchar NOT NULL, "providerId" varchar NOT NULL,
  name varchar NOT NULL, "botId" varchar NOT NULL, secret varchar NOT NULL,
  enabled boolean NOT NULL DEFAULT true, "createdAt" timestamp NOT NULL DEFAULT now(),
  UNIQUE (provider, "providerId")
);
CREATE TABLE IF NOT EXISTS chat_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), "installationId" uuid NOT NULL,
  "messageId" uuid NOT NULL UNIQUE, address jsonb NOT NULL,
  status varchar NOT NULL DEFAULT 'waiting', "externalId" varchar,
  "startedAt" timestamptz, "createdAt" timestamp NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS chat_channels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), "installationId" uuid NOT NULL,
  "externalId" varchar NOT NULL, name varchar NOT NULL, "createdAt" timestamp NOT NULL DEFAULT now(),
  UNIQUE ("installationId", "externalId")
);
CREATE INDEX IF NOT EXISTS chat_agents_project ON chat_agents ("projectId");
CREATE INDEX IF NOT EXISTS chat_conversations_project ON chat_conversations ("projectId");
CREATE INDEX IF NOT EXISTS chat_messages_history ON chat_messages ("conversationId", sequence);
CREATE INDEX IF NOT EXISTS chat_work_queue ON chat_work (status, "createdAt");
CREATE INDEX IF NOT EXISTS chat_work_project ON chat_work ("projectId");
CREATE INDEX IF NOT EXISTS chat_installations_project ON chat_installations ("projectId");
ALTER TABLE chat_agents ADD COLUMN IF NOT EXISTS kind varchar;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chat_agents_supported_kind' AND conrelid = 'chat_agents'::regclass) THEN
    ALTER TABLE chat_agents ADD CONSTRAINT chat_agents_supported_kind CHECK (kind IS NULL OR kind IN ('qae', 'aue'));
  END IF;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS chat_agents_project_kind ON chat_agents ("projectId", kind);
UPDATE chat_agents SET enabled = false WHERE kind IS NULL;
COMMIT;
