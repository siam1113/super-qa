BEGIN;
CREATE TABLE IF NOT EXISTS harness_executions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), "requestId" uuid NOT NULL UNIQUE,
  "requestHash" varchar NOT NULL, "proposalRunId" uuid NOT NULL,
  "targetId" varchar NOT NULL, "targetHash" varchar NOT NULL, actor varchar NOT NULL,
  steps jsonb NOT NULL, "retryOf" uuid, status varchar NOT NULL DEFAULT 'queued',
  reason varchar NOT NULL DEFAULT '', token uuid, "leaseUntil" timestamptz, deadline timestamptz NOT NULL,
  report jsonb, screenshot text, "artifactHash" varchar, "completionHash" varchar,
  flaky boolean NOT NULL DEFAULT false, "createdAt" timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS harness_executions_status_idx ON harness_executions(status);
COMMIT;
