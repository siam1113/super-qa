# Admin organization console

The super-admin console opens on an organization directory. Each organization contains one or more apps; select an organization, then an app to manage its workspace, members, usage limits, agent/chat services, and support settings. A member can use one account across apps within that organization and switch apps from the profile menu. The sticky top bar keeps deployment navigation available while scrolling.

## Current operations

- Create an organization with its first app, or add another app under an existing organization; invite each app's first Owner.
- Review app users, QA run totals and execution limits, QAE/AUE agent availability, and connected Slack/Teams installations.
- Issue an audited, one-day owner recovery credential for a selected app.
- Review deployment-wide service health separately from organization-scoped records.
- Configure ticketing and live-chat provider metadata per app; settings are audited and persisted.
- Invite app users as Owner, Admin, or Member. Invitations use the existing single-use, seven-day flow and report email/manual-link delivery status. Existing organization members can accept an invitation with their current password to join another app.
- Start a 15-minute user impersonation session for support. The console prompts for confirmation, writes start/end audit events, preserves the original admin session in an HttpOnly cookie, and shows a persistent in-app exit banner.
- Switch the admin console between light and dark appearance; the selection is shared with the regular workspace theme preference.
- Show locally bundled provider marks in the support-integration cards so logos remain available offline and contrast against both themes.

## Data model boundaries

`qa_organizations` is the parent entity and each `qa_projects` row is an app with an `organizationId`. App settings, members, limits, support configuration, and QA activity are app-scoped. Shared account credentials are reused across apps within the same organization; app memberships and roles remain separate. Knowledge-source integrations are not keyed to a project, so the organization dashboard does not attribute those shared records to an organization. Support connector settings are stored in `qa_org_support_settings`, but provider-specific ticket/chat exchange still requires connector adapters; the UI distinguishes configured settings from live connections.

The super-admin organization listing returns nested apps with app-scoped QAE/AUE agents, Slack/Teams installations, support settings, users, and run metrics. It never includes integration secrets. Apply `apps/api/migrations/20261012-org-support-settings.sql`, `apps/api/migrations/20261013-super-admin-impersonation.sql`, `apps/api/migrations/20261013-organization-apps.sql`, `apps/api/migrations/20261014-shared-app-memberships.sql`, and `apps/api/migrations/20261016-app-roles.sql` in order before enabling the corresponding production features. The role migration preserves existing access by converting Operator to Admin and Viewer to Member.

Provider marks are bundled under `apps/web/public/brand-icons/`; Zendesk, Jira, and Intercom silhouettes come from Simple Icons, while Freshdesk and Crisp assets are downloaded from their respective vendor sites. The interface keeps them on a neutral badge for light/dark contrast and makes no third-party image requests at runtime.

Impersonation is organization- and member-scoped, requires an active account, uses the member's existing role and permissions (it does not silently elevate that role), expires server-side after 15 minutes, and can be ended from the app banner. If the preserved admin session expires or the admin account is disabled, the browser returns to sign-in rather than restoring an invalid admin session. Impersonation is not a substitute for user consent or support policy; use it only for authorized support work.
