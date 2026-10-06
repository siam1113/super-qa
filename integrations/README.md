# Slack and Teams bot app templates

Super QA already contains the message adapters and signed webhook endpoints for Slack and Teams. Slack now also has a shared, single-app path (below) distributed via Slack's own OAuth "Add to Slack" install, alongside the original organization-owned flow where each customer workspace creates and installs its own bot app and pastes in its credentials.

## Slack (shared single app — recommended)

This is the one Slack app your own organization owns and installs once; every client workspace installs it via Slack's native OAuth, with no bot credentials to create or hand over.

1. In Slack API (<https://api.slack.com/apps>), create a new app **from an app manifest**, pasting in `integrations/slack/manifest.shared.template.json` with `{{APP_DOMAIN}}` replaced by your public API hostname.
2. Under **OAuth & Permissions**, confirm the redirect URL `https://YOUR_API_ORIGIN/api/chat-hooks/slack/oauth/callback` is present (the manifest already includes it).
3. Under **Basic Information**, copy the **Client ID**, **Client Secret**, and **Signing Secret** into the API environment as `SLACK_CLIENT_ID`, `SLACK_CLIENT_SECRET`, and `SLACK_SIGNING_SECRET`.
4. In **Super QA → Integrations → Slack → Connect**, click **Add to Slack**. Each org admin repeats just this step — there is no app registration or credential entry on their side.

## Slack (organization-owned, legacy)

1. In Slack API, create a new app from `integrations/slack/manifest.json`.
2. Install it in the target workspace and grant the requested bot scopes.
3. In **Super QA → Integrations → Slack → Connect**, choose **Have your own Slack app credentials instead?**, then enter the workspace ID, bot user ID, bot token, signing secret, agent, and connection name.
4. After saving, copy the displayed callback path into the Slack app's **Event Subscriptions → Request URL** as `https://YOUR_API_ORIGIN` plus that path. Slack verifies the endpoint with its URL challenge.
5. Subscribe the app to the bot events listed in the manifest, save the changes, add the bot to a channel or DM, mention it once, then enable the discovered conversation in Super QA.

Both manifests request read history for channels, groups, DMs, and group DMs, plus `chat:write` for replies. Slack only delivers messages from conversations the bot can access. To run the bot in read-only mode, choose **Read only** in Super QA; provider-side `chat:write` remains granted by the app manifest.

## Microsoft Teams

1. Register a single-tenant Microsoft Entra app and Azure Bot, enable the Microsoft Teams channel, and record the app ID and client secret.
2. Connect it in **Super QA → Integrations → Microsoft Teams** using the tenant ID, app ID, secret, agent, and connection name.
3. Set the Azure Bot messaging endpoint to `https://YOUR_API_ORIGIN` plus the callback path shown after connecting.
4. Build a Teams app package using the same app ID and the public Super QA hostname:

   ```sh
   TEAMS_APP_ID="00000000-0000-0000-0000-000000000000" \
   APP_DOMAIN="qa.example.com" \
   python3 integrations/teams/build-package.py
   ```

5. Upload `integrations/teams/dist/super-qa-teams.zip` to the tenant app catalog or sideload it for a pilot. Add the app to a personal chat, group chat, or team, then send a message and enable the discovered conversation in Super QA.

The package template exposes personal, group chat, and team scopes. It does not request Microsoft Graph permissions or read historical Teams messages. The included icons are simple placeholders; replace them with approved brand icons before organization-wide distribution.

## Required deployment settings

The API must have a public HTTPS origin and the chat runtime configured as described in [the text integration setup guide](../docs/chat-and-text-integrations.md). In particular, configure `CHAT_SECRET_KEY`, `OPENAI_API_KEY`, `CHAT_MODEL`, `CHAT_WORKER_ENABLED`, and `AUTH_PUBLIC_URL`. Keep provider secrets server-side; the connection form encrypts them before storage.

The app templates do not create provider accounts or credentials. Slack workspace installation, Microsoft Entra/Azure Bot registration, tenant consent, and the public callback origin must be supplied by the workspace and deployment owners.
