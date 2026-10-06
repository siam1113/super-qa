BEGIN;
CREATE TABLE IF NOT EXISTS qa_test_cases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), title text NOT NULL,
  priority varchar NOT NULL DEFAULT 'P2', automation varchar NOT NULL DEFAULT 'manual',
  owner varchar NOT NULL DEFAULT '', flow varchar NOT NULL DEFAULT '', risk varchar,
  tags jsonb NOT NULL DEFAULT '[]', steps jsonb NOT NULL, preconditions jsonb NOT NULL DEFAULT '[]',
  "reviewStatus" varchar NOT NULL DEFAULT 'draft', revision integer NOT NULL DEFAULT 1,
  "reviewedBy" varchar, evidence jsonb,
  "createdAt" timestamp NOT NULL DEFAULT now(), "updatedAt" timestamp NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS qa_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), "requestId" uuid NOT NULL UNIQUE,
  "requestHash" varchar NOT NULL, mode varchar NOT NULL DEFAULT 'manual',
  environment varchar NOT NULL, browser varchar NOT NULL, "createdAt" timestamp NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS qa_executions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), "runId" uuid NOT NULL REFERENCES qa_runs(id) ON DELETE CASCADE,
  "testId" uuid NOT NULL, snapshot jsonb NOT NULL, status varchar NOT NULL DEFAULT 'pending',
  result jsonb, "completedAt" timestamptz, "createdAt" timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS qa_executions_run_idx ON qa_executions ("runId");
CREATE INDEX IF NOT EXISTS qa_executions_test_idx ON qa_executions ("testId");
CREATE TABLE IF NOT EXISTS qa_healing_suggestions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), issue text NOT NULL, "affectedTests" jsonb NOT NULL,
  "currentLocator" text NOT NULL, "suggestedLocator" text NOT NULL,
  "rootCause" varchar NOT NULL DEFAULT '', owner varchar NOT NULL DEFAULT '',
  status varchar NOT NULL DEFAULT 'pending', "reviewedBy" varchar, "createdAt" timestamp NOT NULL DEFAULT now()
);
COMMIT;
