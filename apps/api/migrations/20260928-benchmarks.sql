BEGIN;
CREATE TABLE IF NOT EXISTS qa_benchmarks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "projectId" uuid NOT NULL REFERENCES qa_projects(id),
  "requestId" uuid NOT NULL,
  corpus jsonb NOT NULL,
  "corpusHash" varchar NOT NULL,
  "approvedBy" uuid,
  paused boolean NOT NULL DEFAULT true,
  "runIds" jsonb NOT NULL DEFAULT '[]',
  "createdAt" timestamp NOT NULL DEFAULT now(),
  UNIQUE ("projectId", "requestId")
);
CREATE INDEX IF NOT EXISTS qa_benchmarks_project ON qa_benchmarks("projectId");
COMMIT;
