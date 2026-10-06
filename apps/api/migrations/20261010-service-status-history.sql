BEGIN;

CREATE TABLE IF NOT EXISTS qa_service_status_incidents (
  id BIGSERIAL PRIMARY KEY,
  service text NOT NULL CHECK (service IN ('chat', 'pipelines', 'agents')),
  status text NOT NULL CHECK (status = 'unhealthy'),
  message text NOT NULL,
  "startedAt" timestamptz NOT NULL DEFAULT now(),
  "resolvedAt" timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS qa_service_status_one_open_incident
  ON qa_service_status_incidents (service)
  WHERE "resolvedAt" IS NULL;

CREATE INDEX IF NOT EXISTS qa_service_status_incidents_started_at
  ON qa_service_status_incidents ("startedAt" DESC);

COMMIT;
