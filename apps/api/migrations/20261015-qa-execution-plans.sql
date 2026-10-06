BEGIN;

CREATE TABLE IF NOT EXISTS qa_execution_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  "testIds" jsonb NOT NULL DEFAULT '[]',
  environment varchar NOT NULL DEFAULT 'manual',
  browser varchar NOT NULL DEFAULT 'manual',
  "createdAt" timestamp NOT NULL DEFAULT now(),
  "updatedAt" timestamp NOT NULL DEFAULT now()
);

COMMIT;
