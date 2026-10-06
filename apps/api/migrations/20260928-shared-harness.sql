BEGIN;
CREATE TABLE IF NOT EXISTS harness_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), "requestId" uuid NOT NULL UNIQUE,
  "requestHash" varchar NOT NULL, task jsonb NOT NULL, evidence jsonb NOT NULL,
  "caseSnapshot" jsonb, profile jsonb NOT NULL, prompt text NOT NULL,
  status varchar NOT NULL DEFAULT 'queued', reason varchar NOT NULL DEFAULT '',
  attempts jsonb NOT NULL DEFAULT '[]', proposal jsonb, review jsonb,
  deadline timestamptz NOT NULL, "leaseUntil" timestamptz,
  "createdAt" timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS harness_runs_status_idx ON harness_runs(status);
COMMIT;
