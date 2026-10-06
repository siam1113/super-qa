-- Add logs column to sync_jobs table
ALTER TABLE sync_jobs
ADD COLUMN IF NOT EXISTS logs jsonb DEFAULT '[]'::jsonb;

-- Add an index for better performance when filtering logs
CREATE INDEX IF NOT EXISTS idx_sync_jobs_logs ON sync_jobs USING GIN (logs);
