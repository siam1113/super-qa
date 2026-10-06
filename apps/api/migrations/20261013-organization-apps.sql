BEGIN;

CREATE TABLE IF NOT EXISTS qa_organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name varchar NOT NULL,
  "createdAt" timestamp NOT NULL DEFAULT now()
);

ALTER TABLE qa_projects ADD COLUMN IF NOT EXISTS "organizationId" uuid;

-- Existing deployments treated each project workspace as its own organization.
-- Preserve every workspace and make it the first app in a matching parent org.
INSERT INTO qa_organizations (id, name, "createdAt")
SELECT id, name, "createdAt" FROM qa_projects
ON CONFLICT (id) DO NOTHING;

UPDATE qa_projects SET "organizationId" = id WHERE "organizationId" IS NULL;
ALTER TABLE qa_projects ALTER COLUMN "organizationId" SET NOT NULL;
DO $$ BEGIN
  ALTER TABLE qa_projects ADD CONSTRAINT qa_projects_organization_fk
    FOREIGN KEY ("organizationId") REFERENCES qa_organizations(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
CREATE INDEX IF NOT EXISTS qa_projects_organization ON qa_projects("organizationId");

COMMIT;
