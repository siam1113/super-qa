ALTER TABLE qa_auth_sessions
  ADD COLUMN IF NOT EXISTS "impersonatedBySuperAdminId" uuid REFERENCES qa_super_admins(id) ON DELETE SET NULL;
