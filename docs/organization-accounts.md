# Organization Accounts, Invitations, and SSO

## What is implemented

- `/admin` creates an organization and emails its first app Owner an invitation. In local development without email delivery, the one-time invite URL is shown for secure manual sharing.
- `/login` supports email/password and optional OIDC SSO. Invited users set a 12–256 character password at `/invite/accept`.
- `/settings` → Access lets app Owners invite people as Owner, Admin, or Member, list pending invitations and members, revoke invitations, and revoke member sessions.
- A person may join multiple apps in the same organization using one email/password account; each app keeps a separate role and membership. Invitations to another app are accepted with the current password, and the profile menu switches the active app.
- Passwords use salted scrypt hashes. Invitation tokens and browser sessions are random, stored as SHA-256 digests, one-use/expiring or revocable, and never returned in normal account responses. Browser sessions are HttpOnly, SameSite=Lax cookies with Secure enabled in production.
- OIDC uses authorization code flow with PKCE, nonce, browser-bound state, discovery issuer checking, RS256 signature/JWKS verification, audience/expiry checks, and verified email matching. SSO authenticates already activated/invited members; it does not auto-provision accounts.
- Existing scoped project API keys remain available for CI, workers, and integrations; interactive browser accounts use sessions.

## Deployment configuration

1. Apply `apps/api/migrations/20260929-organization-auth.sql`, then `apps/api/migrations/20260929-super-admin.sql` after the autonomy and benchmark migrations.
   Apply `apps/api/migrations/20261013-organization-apps.sql` and `apps/api/migrations/20261014-shared-app-memberships.sql` after the existing organization-auth schema to add parent organizations and shared app memberships. Then apply `apps/api/migrations/20261016-app-roles.sql` to map existing Operator/Viewer assignments and invitations to Admin/Member.
2. Set `AUTH_PUBLIC_URL` to the public HTTPS web app URL and set `WEB_ORIGIN` to that origin.
3. Configure Resend delivery using `RESEND_API_KEY` and a verified `AUTH_FROM_EMAIL`. If email is unavailable, the protected admin/owner UI can display a one-time link for manual delivery; share it securely.
4. To enable SSO, register an OIDC web client and configure `OIDC_ISSUER_URL`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`, and `OIDC_REDIRECT_URI`. The redirect URI must be `${AUTH_PUBLIC_URL}/api/auth/oidc/callback`. The deployment currently supports one OIDC issuer per application deployment and RSA RS256 signing keys.
5. Create the first super-admin from an interactive API host using `npm run admin:create-super-admin -w apps/api`. The command prompts for email and a hidden password, hashes it, and writes only the account to the database. It requires the schema migrations above and the API database configuration. No HTTP bootstrap key or unauthenticated enrollment endpoint exists.
6. Restart API and web services, sign in at `/login`, and use `/admin` to create organizations and invite their first app Owner. App Owners invite further users from Settings → Access.

## Super-admin boundary

Super-admin accounts are provisioned out-of-band by an operator with database access, use the same password/session protections as organization accounts, and are gated by a dedicated account-type guard. The authenticated console can create organizations and issue audited one-day owner recovery credentials. Protect super-admin credentials and database access as platform-level authority; use MFA/SSO and tighter operational controls before broad production rollout. Super-admin identity is deployment-wide, not tenant-scoped.

## Scope and remaining identity work

Organizations are parent tenants, and each organization can contain multiple app workspaces. Membership is app-scoped; the same organization account can join multiple apps with separate roles. OIDC provider configuration is deployment-wide rather than organization-specific. Password reset, MFA, enterprise SCIM, domain discovery, account recovery, email delivery retries, and external identity-provider certification are not included. A real customer rollout still needs security review, verified sender/domain setup, a real OIDC tenant test, backup/retention policy, and operational monitoring. The integration suite verifies local invitation, password login, session-based project access, and revocation; no customer IdP or production email provider is used in tests.
