BEGIN;

CREATE TABLE IF NOT EXISTS outpost_activities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "projectId" uuid NOT NULL,
  "agentId" uuid NOT NULL,
  key varchar NOT NULL,
  source varchar NOT NULL DEFAULT 'built_in',
  name varchar NOT NULL,
  description text NOT NULL DEFAULT '',
  skill varchar NOT NULL,
  inputs jsonb NOT NULL DEFAULT '{}',
  instructions text,
  triggers jsonb NOT NULL DEFAULT '[]',
  "autonomyLevel" varchar NOT NULL DEFAULT 'observer',
  enabled boolean NOT NULL DEFAULT true,
  "createdBy" uuid,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS outpost_activities_project_agent_key ON outpost_activities ("projectId", "agentId", key);
CREATE INDEX IF NOT EXISTS outpost_activities_project_id ON outpost_activities ("projectId");
CREATE INDEX IF NOT EXISTS outpost_activities_agent_id ON outpost_activities ("agentId");

CREATE TABLE IF NOT EXISTS outpost_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "projectId" uuid NOT NULL,
  "activityId" uuid NOT NULL,
  "requestId" uuid NOT NULL,
  "triggeredBy" varchar NOT NULL,
  status varchar NOT NULL DEFAULT 'queued',
  "autonomyLevel" varchar NOT NULL,
  "resultSummary" text,
  "artifactRequestId" uuid,
  "chatMessageId" uuid,
  "sessionId" uuid,
  "approvalStatus" varchar NOT NULL DEFAULT 'not_required',
  error text,
  "startedAt" timestamptz,
  "finishedAt" timestamptz,
  "createdAt" timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS outpost_runs_activity_request ON outpost_runs ("activityId", "requestId");
CREATE INDEX IF NOT EXISTS outpost_runs_project_id ON outpost_runs ("projectId");
CREATE INDEX IF NOT EXISTS outpost_runs_status ON outpost_runs (status);

COMMIT;
