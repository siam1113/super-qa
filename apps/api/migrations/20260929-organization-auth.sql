BEGIN;

CREATE TABLE IF NOT EXISTS qa_org_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "projectId" uuid NOT NULL REFERENCES qa_projects(id) ON DELETE CASCADE,
  email varchar(254) NOT NULL UNIQUE,
  "keyId" uuid NOT NULL UNIQUE REFERENCES qa_project_keys(id),
  "passwordHash" varchar,
  "tokenVersion" integer NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  "createdAt" timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS qa_org_members_project ON qa_org_members("projectId");

CREATE TABLE IF NOT EXISTS qa_org_invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "projectId" uuid NOT NULL REFERENCES qa_projects(id) ON DELETE CASCADE,
  email varchar(254) NOT NULL,
  role varchar NOT NULL,
  "tokenDigest" varchar NOT NULL UNIQUE,
  "expiresAt" timestamptz NOT NULL,
  "acceptedAt" timestamptz,
  "revokedAt" timestamptz,
  "createdBy" uuid,
  "memberKeyId" uuid NOT NULL REFERENCES qa_project_keys(id),
  "createdAt" timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS qa_org_invites_project_email ON qa_org_invitations("projectId", email);

CREATE TABLE IF NOT EXISTS qa_auth_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "memberId" uuid NOT NULL REFERENCES qa_org_members(id) ON DELETE CASCADE,
  "tokenDigest" varchar NOT NULL UNIQUE,
  "expiresAt" timestamptz NOT NULL,
  "revokedAt" timestamptz,
  "createdAt" timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS qa_auth_sessions_member ON qa_auth_sessions("memberId");

CREATE TABLE IF NOT EXISTS qa_oidc_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "stateDigest" varchar NOT NULL UNIQUE,
  nonce varchar NOT NULL,
  verifier varchar NOT NULL,
  "expiresAt" timestamptz NOT NULL,
  "createdAt" timestamp NOT NULL DEFAULT now()
);

COMMIT;
