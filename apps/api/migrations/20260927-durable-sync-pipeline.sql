BEGIN;

ALTER TABLE sync_jobs
  ADD COLUMN IF NOT EXISTS "pipelineVersion" integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS request jsonb,
  ADD COLUMN IF NOT EXISTS "leaseToken" uuid,
  ADD COLUMN IF NOT EXISTS "leaseUntil" timestamptz,
  ADD COLUMN IF NOT EXISTS attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "nextAttemptAt" timestamptz;

ALTER TABLE documents ADD COLUMN IF NOT EXISTS "processedHash" varchar;

CREATE TABLE IF NOT EXISTS sync_work (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sync_job_id uuid NOT NULL REFERENCES sync_jobs(id) ON DELETE CASCADE,
  "externalId" varchar NOT NULL,
  "documentId" uuid NOT NULL,
  "revisionHash" varchar NOT NULL,
  snapshot jsonb NOT NULL,
  chunks jsonb,
  extraction jsonb
);

CREATE UNIQUE INDEX IF NOT EXISTS sync_work_job_external_id ON sync_work (sync_job_id, "externalId");
CREATE INDEX IF NOT EXISTS sync_jobs_recovery ON sync_jobs ("leaseUntil", "nextAttemptAt")
  WHERE "pipelineVersion" = 1 AND status IN ('queued', 'running');

COMMIT;
