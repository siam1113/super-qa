CREATE TABLE IF NOT EXISTS qa_org_support_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "projectId" uuid NOT NULL UNIQUE REFERENCES qa_projects(id) ON DELETE CASCADE,
  settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now()
);
