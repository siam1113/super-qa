BEGIN;

CREATE TABLE IF NOT EXISTS qa_generation_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind varchar NOT NULL,
  status varchar NOT NULL DEFAULT 'pending',
  label varchar NOT NULL,
  input jsonb NOT NULL,
  result jsonb,
  error text,
  applied boolean NOT NULL DEFAULT false,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS qa_generation_runs_created_idx ON qa_generation_runs ("createdAt" DESC);
CREATE INDEX IF NOT EXISTS qa_generation_runs_status_idx ON qa_generation_runs (status);

COMMIT;
