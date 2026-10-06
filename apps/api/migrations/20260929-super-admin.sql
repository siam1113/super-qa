BEGIN;

CREATE TABLE IF NOT EXISTS qa_super_admins (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email varchar(254) NOT NULL UNIQUE,
  "passwordHash" varchar NOT NULL,
  active boolean NOT NULL DEFAULT true,
  "createdAt" timestamp NOT NULL DEFAULT now()
);

ALTER TABLE qa_auth_sessions ALTER COLUMN "memberId" DROP NOT NULL;
ALTER TABLE qa_auth_sessions ADD COLUMN IF NOT EXISTS "superAdminId" uuid REFERENCES qa_super_admins(id) ON DELETE CASCADE;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'qa_auth_sessions_principal_check') THEN
    ALTER TABLE qa_auth_sessions ADD CONSTRAINT qa_auth_sessions_principal_check CHECK (("memberId" IS NOT NULL AND "superAdminId" IS NULL) OR ("memberId" IS NULL AND "superAdminId" IS NOT NULL));
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS qa_auth_sessions_super_admin ON qa_auth_sessions("superAdminId");

COMMIT;
