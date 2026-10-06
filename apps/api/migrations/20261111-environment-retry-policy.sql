BEGIN;

ALTER TABLE environments ADD COLUMN IF NOT EXISTS "maxRetries" smallint
  CHECK ("maxRetries" IS NULL OR ("maxRetries" >= 0 AND "maxRetries" <= 10));
ALTER TABLE environments ADD COLUMN IF NOT EXISTS "retryDelayMs" integer
  CHECK ("retryDelayMs" IS NULL OR ("retryDelayMs" >= 0 AND "retryDelayMs" <= 60000));

COMMIT;
