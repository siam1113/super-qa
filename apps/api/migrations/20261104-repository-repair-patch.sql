-- Additive; runs without a proposed repair remain unaffected.
ALTER TABLE qa_autonomous_runs ADD COLUMN IF NOT EXISTS "repairPatch" jsonb NULL;
