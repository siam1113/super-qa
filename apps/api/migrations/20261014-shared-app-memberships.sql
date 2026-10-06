BEGIN;

ALTER TABLE qa_org_members DROP CONSTRAINT IF EXISTS qa_org_members_email_key;
DROP INDEX IF EXISTS qa_org_members_email_key;
CREATE UNIQUE INDEX IF NOT EXISTS qa_org_members_project_email ON qa_org_members("projectId", email);

COMMIT;
