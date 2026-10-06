-- Additive; existing browser/API/live runs remain readable.
ALTER TABLE qa_autonomous_runs ADD COLUMN IF NOT EXISTS dataset jsonb NULL;
ALTER TABLE qa_autonomous_runs ADD COLUMN IF NOT EXISTS "cleanupReceipt" jsonb NULL;
