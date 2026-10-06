BEGIN;

-- Preserve existing human access while adopting the canonical app roles.
UPDATE qa_project_keys SET role = 'admin' WHERE role = 'operator';
UPDATE qa_project_keys SET role = 'member' WHERE role = 'viewer';
UPDATE qa_org_invitations SET role = 'admin' WHERE role = 'operator';
UPDATE qa_org_invitations SET role = 'member' WHERE role = 'viewer';

COMMIT;
