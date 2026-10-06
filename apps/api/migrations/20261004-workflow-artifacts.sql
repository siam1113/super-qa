BEGIN;
CREATE TABLE IF NOT EXISTS qa_workflow_artifacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "projectId" uuid NOT NULL,
  "requestId" uuid NOT NULL,
  "agentType" varchar NOT NULL,
  skill varchar NOT NULL,
  "schemaVersion" integer NOT NULL DEFAULT 1,
  "contentHash" varchar NOT NULL,
  "resultJson" text NOT NULL,
  status varchar NOT NULL,
  summary text NOT NULL,
  "producedAt" timestamptz NOT NULL,
  "publishedAt" timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS qa_workflow_artifacts_request ON qa_workflow_artifacts ("projectId", "requestId");
CREATE INDEX IF NOT EXISTS qa_workflow_artifacts_project ON qa_workflow_artifacts ("projectId");
COMMIT;
