BEGIN;

ALTER TABLE qa_test_cases ADD COLUMN IF NOT EXISTS "baseUrl" varchar;
ALTER TABLE environments ADD COLUMN IF NOT EXISTS "baseUrl" varchar;

COMMIT;
