# Native chat and text integrations

Implemented 2026-10-03. This release covers organization conversations and text bot adapters. It does not implement meetings, speech, automatic QA execution, or a public Slack/Teams app marketplace installation flow.

Subsequent meeting work is documented separately in [meetings](meetings.md): native video-call pilot, reviewed meeting notes, active contributions, browser voice playback and an optional Teams/Google Meet adapter. The limitations of that pilot still apply; Slack Huddle participation is not provided by these text connections.

## User journey

Open **Chat** in the navigation or `/chat` after signing in with an organization account. Platform super-admin accounts do not inherit access to organization conversations; create an organization and accept its member invitation to use Chat.

- **Personal:** choose another active organization member, or a named agent. Repeating that selection reopens the existing direct conversation.
- **Group:** choose a name and members. Optionally add one agent and describe what it should do in that conversation.
- **Messages:** send with Enter, insert a line break with Shift+Enter, quote a message with Reply, and load older history. Drafts remain in memory per conversation when switching chats or after a failed send; reloading the page discards unsent drafts.
- **Agents:** every organization has exactly two supported profiles: **QAE (QA Engineer)** and **AUE (Automation Engineer)**. They are provisioned automatically on first opening Chat. Organization admins can assign their display names; custom-agent creation, editable roles, custom aliases, and editable base instructions are unavailable. The chosen name and fixed QAE/AUE role name invoke that profile. Agents reply automatically in native personal agent chats and on mention in groups. Provider-specific mentions and provider personal messages can also trigger a reply.
- **Responses:** the UI distinguishes queued, preparing, sent, and failed responses. Completed agent responses contain a summary, optional detail bullets, and an optional task proposal. Human and model text is rendered as escaped text, not HTML.
- **Tasks:** an Owner or Admin can create a tracked task from a message or confirm a proposed task. Repeated confirmation returns the same task. Tasks can be marked complete in the conversation task panel. They do not start QAE/AUE runs or claim any tests were executed.
- **Settings:** the conversation creator controls group membership, the assigned agent, and its conversation instructions. Added people see the existing history. Removing a person blocks subsequent reads and writes. Personal chat participants are fixed.

## Deployment

1. Apply the existing organization/auth migrations before `apps/api/migrations/20261003-chat.sql`. The chat migration is additive and rerunnable. Back up the database using the deployment's normal process. Production continues to require explicit migrations; development uses the existing TypeORM synchronization setting.

   If an earlier development build created custom chat profiles, the migration retains their history and disables those profiles. They are excluded from selection and work execution. Open Chat to provision the two fixed profiles, then assign QAE/AUE to applicable groups or reconnect integrations. Existing custom-profile direct chats retain their history; start a new personal chat with QAE or AUE. A nullable legacy role column preserves these records, while a database check and unique organization/role index constrain supported profiles.
2. Configure the API environment:

   ```dotenv
   OPENAI_API_KEY=<server-side key>
   CHAT_MODEL=<approved Chat Completions model with JSON mode>
   CHAT_SECRET_KEY=<64 hexadecimal characters from a secure random generator>
   CHAT_DAILY_REPLY_LIMIT=100
   CHAT_WORKER_ENABLED=true
   AUTH_PUBLIC_URL=https://your-web-app.example
   ```

   Generate the encryption key with `openssl rand -hex 32`. Keep it in a secret manager and back it up with the credential recovery procedure. Changing it without re-encrypting or reconnecting installations makes stored credentials unreadable. Neither it nor provider credentials belong in `NEXT_PUBLIC_*` variables.
3. The web app uses the existing server-only `AUTONOMY_API_URL`, including `/api`, to proxy `/api/chat` using the browser's HttpOnly session. Set `AUTH_PUBLIC_URL` in the web environment too when using a reverse proxy, so write requests are checked against the public browser origin. Native chat works without a configured model; agent replies fail explicitly until the model is configured. Connections require the encryption key.
4. Run the API normally. Its chat worker polls PostgreSQL once per second. Set `CHAT_WORKER_ENABLED=false` on API instances that should only serve requests. No Redis consumer or separate Python conversational service is required for this phase.
5. Expose the verified provider callbacks at your **API** HTTPS origin, not the Next `/api/chat` proxy. The UI displays the callback path for each connection. Existing organization and conversation APIs remain behind session authentication in production lockdown.

## Slack pilot setup

Two Slack registration paths exist side by side: a shared, multi-tenant Slack app (one app, installed via Slack's own OAuth by every client org) and a legacy organization-owned app (each org registers and installs its own bot, then pastes its credentials in). The shared path is the one to use for new client onboarding; it is the Slack equivalent of the Teams "Shared multi-tenant app" path below.

Ready-to-import Slack and Teams app definitions and the Teams package builder are in [integrations](../integrations/README.md).

### Shared multi-tenant app (current path)

One organization-owned Slack app serves every client workspace. Unlike Teams' admin-consent redirect, Slack's OAuth "Add to Slack" flow both authorizes and installs the bot in one step, so there is no separate app-catalog push.

1. Create the shared Slack app once from `integrations/slack/manifest.shared.template.json` (fill in `{{APP_DOMAIN}}` first), or build it up manually in the Slack API dashboard with the bot scopes `app_mentions:read`, `channels:history`, `channels:read`, `chat:write`, `groups:history`, `groups:read`, `im:history`, `im:read`, `mpim:history`, `mpim:read`.
2. Under **OAuth & Permissions**, add the redirect URL `https://YOUR_API/api/chat-hooks/slack/oauth/callback`. Under **Event Subscriptions**, set the shared Request URL to `https://YOUR_API/api/chat-hooks/slack` (no installation ID in either path) and subscribe to the same bot events as the legacy manifest (`app_mention`, `message.channels`, `message.groups`, `message.im`, `message.mpim`, `member_left_channel`, `tokens_revoked`, `app_uninstalled`).
3. Set `SLACK_CLIENT_ID`, `SLACK_CLIENT_SECRET`, and `SLACK_SIGNING_SECRET` (the app's one signing secret, shared by every installed workspace) in the API environment.
4. In Super QA, the admin clicks **Add to Slack** (`GET /api/chat/installations/slack/install-url`, owner-only), which returns Slack's own OAuth authorize URL; the browser is sent there directly, with the installing admin's identity carried in a signed `state` param — there is nothing to store out-of-band.
5. The workspace admin approves the requested scopes. Slack redirects back to `https://YOUR_API/api/chat-hooks/slack/oauth/callback`, which exchanges the code for a bot token and creates the `ChatInstallation` immediately, assigned to the project's Super QA agent.
6. Add the bot to the desired channel or DM and mention it once. Refresh Super QA's connections to see the discovered conversation, then click **Enable** — the same discovery step the legacy path below also uses.

A workspace that messages the bot without ever completing the OAuth install has no `ChatInstallation`; events from an unrecognized team ID on the shared endpoint are verified against the shared app's one signing secret and then silently ignored — never auto-provisioned.

### Legacy organization-owned app

1. Create a Slack app with a bot from `integrations/slack/manifest.json`. Request `chat:write`, `app_mentions:read`, and only the relevant history scopes (`channels:history`, `groups:history`, `im:history`, `mpim:history`) for conversations you intend to read. Subscribe to corresponding bot message events and `app_mention`. Subscribe to uninstall/revocation events and `member_left_channel` for access removal.
2. Install the app in the target workspace. Obtain its workspace ID, bot **user** ID, `xoxb-` bot token, and app signing secret. `auth.test` validates the token/workspace/bot identity when connecting.
3. In Super QA, choose **Have your own Slack app credentials instead?**, then choose the agent, name the connection, and enter these app credentials. They are encrypted using AES-256-GCM with project/installation authenticated context; normal API responses omit the secret column.
4. Set the Slack Events request URL to `https://YOUR_API/api/chat-hooks/slack/INSTALLATION_ID`. Signed URL verification is supported. Each organization-owned app needs its own callback configuration; this is separate from the shared app's one callback above.
5. Add the bot to the desired channel or DM and mention it once. Refresh Super QA's connections to see the discovered conversation, then click **Enable**. Before enablement only conversation metadata is retained; the discovery message is not stored or answered. Mention the bot again after enablement.
6. Open the connected conversation in native Chat. The admin who enabled it is initially its sole native reader; add authorized organization teammates through conversation settings. Native readers may create internal tasks, but type messages in Slack itself. Agent replies are sent to the source Slack thread.

Slack requests require a valid timestamped HMAC over the raw HTTP request body, whether through the shared app's one signing secret or an organization-owned app's own. Old requests, wrong workspace IDs, invalid signatures, bot echoes, message subtypes, and unapproved conversations do not start a response. Both `message` and `app_mention` deliveries for one Slack message share an idempotency key. Message edit/delete synchronization, historical backfill, Slack Connect policy mapping, attachments, and Slack slash commands are not part of this release.

## Teams pilot setup

Two Teams registration paths exist side by side: a legacy per-client Azure Bot (its own messaging endpoint, one callback per installation) and the current one-app-for-everyone path below, which is the one to use for new client onboarding.

### Shared multi-tenant app (current path)

One organization-owned Entra app/Azure Bot serves every client tenant. The Entra app registration is multi-tenant ("Accounts in any organizational directory"); the Azure Bot resource itself is `SingleTenant` app type, since Azure stopped issuing new `MultiTenant` bot registrations in mid-2025 — that distinction lives in the Entra app, not the bot resource. See [bot-type-options](https://techcommunity.microsoft.com/discussions/teamsdeveloper/what-is-the-recommended-bot-type-for-multi-tenant-bots/4420239) for background.

1. Register the shared Azure Bot/Entra application once, enable the Teams channel, and set `TEAMS_SHARED_APP_ID`/`TEAMS_SHARED_APP_SECRET` in the API environment. On the Entra app's API permissions blade, add the Microsoft Graph application permissions it needs and mark them as requiring admin consent — that consent grant is what the flow below collects per tenant.
2. Set its messaging endpoint to the single shared callback: `https://YOUR_API/api/chat-hooks/teams` (no installation ID in the path).
3. In Super QA, the admin clicks **Install to your organization** (`GET /api/chat/installations/teams/connect-url`, owner-only), which returns Microsoft's admin-consent URL for the shared app; the browser is sent there directly.
4. The client's own Teams/Global admin reviews and grants org-wide admin consent. Microsoft redirects back to `https://YOUR_API/api/chat-hooks/teams/consent` with the consenting tenant's ID — that single redirect is what creates the `ChatInstallation` and assigns it the project's Super QA agent; there is no code to generate or relay through the bot.
5. Add the app to a chat/team in that tenant (sideload a `.zip`, publish to the Teams Store/AppSource, or push it via the tenant's own app catalog) and send a message mentioning it. Refresh connections, enable the discovered conversation, and send another mention — the same discovery step the legacy path below also uses.

Admin consent alone does not install the Teams app into any team or chat; it only authorizes this connection. A tenant whose admin never completes the consent redirect has no `ChatInstallation`, so messages the bot receives from an unrecognized tenant on the shared endpoint are verified against the shared app's signing audience and then silently ignored — never auto-provisioned.

### Legacy per-client app

1. Register the Azure Bot/Entra application, enable the Teams channel, and prepare/install a Teams app manifest with the bot's ID and the required `personal`, `team`, and/or `groupChat` scopes. Tenant administrators must permit that app.
2. Connect it in Super QA with the assigned agent, connection name, tenant UUID, Microsoft application UUID, and client secret. Connection setup checks the client-credentials token endpoint for `https://api.botframework.com/.default`.
3. Set the Azure Bot messaging endpoint to `https://YOUR_API/api/chat-hooks/teams/INSTALLATION_ID`.
4. Add the app to a chat/team and send a message mentioning it (or send a personal message). Refresh connections, enable the discovered conversation, and send another mention. As with Slack, an unapproved conversation's message content is not retained.
5. Replies use the authenticated service URL and the original activity/thread. Native Chat shows delivery as waiting, sending, sent, failed, or uncertain.

Inbound verification requires an RSA-signed Bot Connector JWT with the expected issuer, app audience, validity window, service URL claim, and `msteams` signing-key endorsement. For the legacy per-installation callback it also checks the activity's tenant against that installation; for the shared callback the audience is checked against the shared app instead, and the tenant is looked up rather than pre-checked. Only commercial Teams service hosts `smba.trafficmanager.net` and `smba.infra.teams.microsoft.com` are supported. Sovereign clouds, emulator tokens, managed identities, interactive cards, and Graph historical chat synchronization are excluded. Signing keys are cached for an hour. A signing-key rotation may require the cache to refresh before new-key activities are accepted.

## Disconnection and credential rotation

**Disconnect and stop reading** disables ingress and clears the encrypted credentials, archives connected conversations, and prevents queued work from starting or being delivered. History remains visible to existing native participants; this action is not a data deletion request. A provider request already in flight cannot be recalled.

To rotate credentials or reconnect, submit the same workspace/tenant again with verified replacement credentials. Its installation ID/callback URL is retained. Previously archived conversations require explicit Enable again. A workspace/tenant already connected to another organization cannot be claimed by a different organization.

## Runtime and correctness

- `QaProject.id` is the existing organization scope used by accounts. Every native API operation rechecks an active member and unrevoked/unexpired project key within that scope. A user must also belong to the conversation; even app Owners do not automatically read other members' personal messages. Bearer CI/runner keys are not accepted by native Chat.
- PostgreSQL owns conversations, messages, queued agent work, tasks, installations, discovered channels, and delivery records. A transaction creates the incoming message, queued reply, work record, and any outbound delivery together. Source events and task confirmations have database uniqueness constraints.
- Native sends use client-generated UUID request IDs. Retries with the same ID/content return the same message; reusing an ID for other content or another author is rejected.
- A worker leases work, performs one model request, then conditionally publishes its result. Conversation policy changes, agent changes/disabling, member removal/revocation, and disconnects fence publication. Expired work is visibly failed and never automatically spends again. The user may deliberately issue another request.
- Replies are bounded to 12 messages, 2,000 characters per message, 8,000 instruction characters, one provider call, a 30-second provider timeout, and 1,400 output tokens. The organization-wide rolling 24-hour reply quota counts reserved work, including failed work. These are usage bounds, not dollar-denominated billing guarantees. Provider-reported token usage is stored on the work record.
- Concurrent worker instances use row locks and leases with at most one active model turn per organization. A single API process services one model turn at a time while delivering outbound messages independently. Broader parallel tasks/meetings and priority scheduling remain the next runtime phase.
- External history supplied to a reply is restricted to its originating provider thread. There is no organization-wide retrieval, source browsing, external tool execution, or QAE/AUE execution in this model path.
- Delivery is a durable outbox. After a network timeout or process failure during an outbound write, status becomes **uncertain**. The system avoids automatic replay that could duplicate an externally visible response. Operators should check the provider conversation before issuing another mention. Definite pre-send failures are marked failed.
- Agent/configuration, connection, channel authorization, and task changes produce audit records without message bodies or secrets. Stored conversations and tasks currently have no automated retention/purge policy; operators must define retention before a broader production rollout.

## API map

All native routes are under `/api/chat` and require an organization member session.

| Route | Purpose |
| --- | --- |
| `GET /directory` | Current member, active organization members, agents, model configuration status |
| `POST /agents/:id` | Admin assigns QAE/AUE a display name with `{name}`; custom creation and other fields are rejected |
| `GET/POST /conversations` | List own conversations / create direct or group chat |
| `GET /conversations/:id?before=messageUUID` | Authorized history, tasks and delivery states, 50 messages per page |
| `POST /conversations/:id/policy` | Creator updates membership and agent instructions |
| `POST /conversations/:id/messages` | Send `{requestId, text, replyToId?}` |
| `POST /conversations/:id/messages/:messageId/task` | Owner/Admin confirms task |
| `POST /conversations/:id/tasks/:taskId/done` | Mark tracked task complete |
| `GET/POST /installations` | Admin lists/connections or verifies credentials |
| `GET /installations/teams/connect-url` | Owner gets Microsoft's admin-consent URL to self-serve-connect a Teams tenant to the shared app |
| `GET /installations/slack/install-url` | Owner gets Slack's own OAuth authorize URL to self-serve-connect a workspace to the shared app |
| `POST /installations/:id/conversations` | Admin authorizes a discovered provider conversation |
| `POST /installations/:id/disconnect` | Disable ingress/egress and clear secret |

Provider routes `/api/chat-hooks/slack/:id` (legacy organization-owned bot), `/api/chat-hooks/slack` (shared multi-tenant bot), `/api/chat-hooks/teams/:id` (legacy per-client bot), and `/api/chat-hooks/teams` (shared multi-tenant bot) use provider authentication rather than browser sessions. Never exempt them from their signature/JWT checks when deploying behind a proxy. Slack verification requires the exact raw body; Nest raw-body support is enabled in `main.ts`. `/api/chat-hooks/slack/oauth/callback` and `/api/chat-hooks/teams/consent` are the two browser-redirect OAuth callbacks and are not signed provider payloads.

## Verification and sources

Reproducible verification:

```bash
docker compose -p superqa-chat-test -f docker-compose.pipeline-test.yml up -d postgres
npm exec -w apps/api -- jest test/integration/chat.test.ts --runInBand
npm run build -w apps/api
npm run build:settings-e2e -w apps/web
CHAT_UI_E2E=1 npm exec -w apps/api -- jest test/integration/chat.test.ts --runInBand
```

The tests use PostgreSQL on port 55432 with synthetic accounts, a mocked model, signed provider fixtures, and mocked provider transport. The opt-in browser test starts isolated web/API servers and exercises two organization members, a group, personal messages, agent replies, confirmed tasks, reloads, and a mobile viewport. It writes `/tmp/superqa-chat-desktop.png` and `/tmp/superqa-chat-mobile.png`. These tests do not establish live-provider model accuracy or prove a real Slack/Teams tenant installation.

The provider adapters follow [Slack request verification](https://docs.slack.dev/authentication/verifying-requests-from-slack/) and [Bot Connector authentication](https://learn.microsoft.com/en-us/azure/bot-service/rest-api/bot-framework-rest-connector-authentication?view=azure-bot-service-4.0). The model adapter uses the installed OpenAI SDK with bounded [Chat Completions JSON mode](https://developers.openai.com/api/reference/resources/chat); JSON is additionally validated locally, and incomplete/malformed outputs fail visibly.
