BEGIN;
CREATE TABLE IF NOT EXISTS qa_projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name varchar NOT NULL,
  "workspaceId" varchar NOT NULL, "applicationId" varchar NOT NULL, environment varchar NOT NULL,
  paused boolean NOT NULL DEFAULT false, origins jsonb NOT NULL, targets jsonb NOT NULL,
  requirements jsonb NOT NULL, "dailyRunLimit" integer NOT NULL DEFAULT 20,
  "createdAt" timestamp NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS qa_project_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), "projectId" uuid NOT NULL REFERENCES qa_projects(id),
  digest varchar NOT NULL UNIQUE, role varchar NOT NULL, label varchar NOT NULL,
  "expiresAt" timestamptz NOT NULL, revoked boolean NOT NULL DEFAULT false
);
CREATE INDEX IF NOT EXISTS qa_project_keys_project ON qa_project_keys("projectId");
CREATE TABLE IF NOT EXISTS qa_autonomous_suites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), "projectId" uuid NOT NULL REFERENCES qa_projects(id),
  name varchar NOT NULL, version integer NOT NULL DEFAULT 1, "previousId" uuid,
  checks jsonb NOT NULL, "manifestHash" varchar NOT NULL, "approvedBy" uuid,
  "createdAt" timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS qa_autonomous_suites_project ON qa_autonomous_suites("projectId");
CREATE TABLE IF NOT EXISTS qa_autonomous_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), "projectId" uuid NOT NULL REFERENCES qa_projects(id),
  "requestId" uuid NOT NULL, "suiteId" uuid NOT NULL REFERENCES qa_autonomous_suites(id),
  snapshot jsonb NOT NULL, status varchar NOT NULL DEFAULT 'queued', token uuid, "workerKeyId" uuid,
  deadline timestamptz NOT NULL, "browserExecutions" jsonb NOT NULL DEFAULT '{}', results jsonb,
  "completionHash" varchar, "createdAt" timestamp NOT NULL DEFAULT now(), UNIQUE("projectId", "requestId")
);
CREATE TABLE IF NOT EXISTS qa_audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), "projectId" uuid NOT NULL REFERENCES qa_projects(id),
  actor varchar NOT NULL, action varchar NOT NULL, data jsonb NOT NULL DEFAULT '{}',
  "createdAt" timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS qa_audit_events_project ON qa_audit_events("projectId");
COMMIT;
