BEGIN;

ALTER TABLE qa_projects
  ADD COLUMN IF NOT EXISTS "onboardingCompletedAt" timestamptz;

COMMIT;
