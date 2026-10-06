# Calendar invitations and automatic meeting joins

**Live participation:** When `MEETING_LIVE_ENABLED=true` and OpenAI is configured, newly dispatched active invitations use the [live-voice bridge](live-meeting-voice.md). The text-only active baseline described below applies when that feature is off; silent note-taking is unchanged.

## Delivered scope

An organization admin connects a dedicated Google Workspace or Microsoft work/school mailbox to **QAE or AUE**, selects a sharing conversation, and explicitly enables automatic joining/transcription. Invite that mailbox to a timed Google Meet or Teams event. The server reads its primary calendar, reserves a due invitation, and sends the existing disclosed Recall meeting bot. No per-meeting URL entry is needed after connection.

Adding the agent to Teams chat alone is **not** calendar enrollment. This feature does not create an email account, read a human's entire inbox, or turn a chat bot into a native Teams calling identity. The invited address must be the connected agent mailbox, not merely an unrelated human attendee. One mailbox per fixed agent is supported; custom agents and mailbox identity switching are not.

Global **Calendar** and **Meetings** navigation is available, with filtered tabs inside both QAE and AUE views. Calendar shows a local-time weekly agenda, invitation status, organizer and invitee RSVP details. Meetings shows native/manual/scheduled history and opens the existing transcript, evidence-linked notes and action/context proposals. Invitees/RSVPs are **not a verified attendance report**.

## Implementation phases completed

1. Connect an organization-owned Google or Microsoft mailbox to the existing QAE/AUE through admin-authorized OAuth. Keep account authorization separate from the agent's fixed engineering role/display name. No personal passwords or custom agents.
2. Read invitations from its primary calendar, including recurring occurrences, cancellations and changes. Persist normalized title, times, invitees, RSVP state and supported meeting URL. Do not ingest mail or treat arbitrary descriptions as instructions.
3. Dispatch due invitations with standing admin authorization, fresh calendar state, immutable event identity and durable at-most-once bot admission. Do not blindly replay ambiguous provider writes. Revoke future joins on disconnect and stop affected bots on cancellation.
4. Add Calendar/Meetings navigation and QAE/AUE-specific tabs. Show title, local time/timezone, invitees, join status, and the existing transcript/evidence-linked notes detail view.
5. Verify authorization, OAuth state/PKCE, cross-org isolation, refresh/cancel/reschedule/recurrence, restart/idempotency, and real browser navigation with mocked external providers. Real Google/Microsoft consent and tenant meeting admission remain deployment acceptance gates.

Scheduling is a target, not a promise of instant admission: the API worker must be running and connected, providers may throttle, and the host may need to admit the disclosed AI bot. This release uses the existing Recall meeting transport, not a new native Teams calling bot or Google human-account impersonation.

## One-time deployment setup

1. Apply the organization/chat migrations and `20261004-meetings.sql`, followed by **`apps/api/migrations/20261005-calendar.sql`**. The new migration is additive/rerunnable and adds encrypted mailbox authorization, short-lived OAuth state, occurrence records and meeting metadata. Back up the application database first. Development tests apply migrations only to the isolated test database; this does not migrate a running deployment.
2. Configure the existing web/API organization authentication and a stable 32-byte hex `CHAT_SECRET_KEY`. Tokens and PKCE verifiers use the existing AES-GCM secret envelope. Preserve this key across restarts; changing it without re-encryption requires reconnecting calendars and other chat credentials.
3. Register a Google web OAuth client, enable Calendar API, and configure its consent audience/test users or published application as appropriate. Register a Microsoft Entra confidential web application for your intended work/school tenants. The implementation uses the `organizations` authority, not consumer Microsoft accounts. Register the same exact redirect on both providers: `https://YOUR-WEB-ORIGIN/calendar/callback`.
4. Set server-only configuration; never place client secrets in `NEXT_PUBLIC_*` variables:

   ```dotenv
   AUTH_PUBLIC_URL=https://your-web.example
   GOOGLE_CALENDAR_CLIENT_ID=<Google web client ID>
   GOOGLE_CALENDAR_CLIENT_SECRET=<Google web client secret>
   MICROSOFT_CALENDAR_CLIENT_ID=<Entra application ID>
   MICROSOFT_CALENDAR_CLIENT_SECRET=<Entra secret value>
   CHAT_SECRET_KEY=<64 hexadecimal characters>
   CHAT_WORKER_ENABLED=true
   ```

   Google requests `calendar.readonly` with offline access. Microsoft requests delegated `Calendars.Read`, `User.Read` and `offline_access`. Organization consent policies may require tenant admin approval. Local development permits an HTTP localhost/127.0.0.1 redirect; production requires HTTPS. `AUTH_PUBLIC_URL` must be an origin, with no path/query.
5. Configure Recall credentials, signed callback URL, region and model configuration as described in [meetings.md](meetings.md). Calendar OAuth alone cannot join media or generate notes. Keep at least one API instance's chat/calendar workers running; disabling `CHAT_WORKER_ENABLED` disables scheduling too.
6. In **Calendar → Connect mailbox**, choose QAE/AUE, provider, the dedicated mailbox email, default participation mode and sharing conversation. If no conversation is selected, the UI creates a private admin group for meeting visibility. Confirm standing host/organization authorization and transcription disclosure, then authenticate as that exact mailbox at the provider. A different signed-in account is rejected. Super-admin login alone does not grant organization meeting access.
7. Send a real test invitation with a Meet/Teams URL to the connected mailbox. Ensure the invitation appears in its primary calendar: provider invitation/auto-add policies can prevent unsolicited invitations from appearing. Review provider-side invitation settings or accept the invitation there; the app does not write RSVPs. Verify the event and sync status in Calendar before its start.
8. During the authorized pilot, verify actual bot admission, disclosure, signed transcripts, speaker attribution, notes and cancellation. The organizer may need to admit the bot. Review processing agreements, retention, regional routing, recording/transcription permissions and organization disclosure policy before enabling real meetings.

Provider references: [Google web-server OAuth](https://developers.google.com/identity/protocols/oauth2/web-server), [Google event listing](https://developers.google.com/workspace/calendar/api/v3/reference/events/list), [Google primary-calendar identity](https://developers.google.com/workspace/calendar/api/v3/reference/calendars/get), [Microsoft authorization-code flow](https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-auth-code-flow), and [Microsoft calendar view](https://learn.microsoft.com/en-us/graph/api/user-list-calendarview?view=graph-rest-1.0).

## Runtime and safety contract

### Synchronization

- A separate five-second worker loop runs calendar synchronization, dispatch and reconciliation independently from chat/model work. Each step has at most one in-flight job per process. Durable database leases/reservations allow restart and competing workers without intentionally replaying a provider create request.
- Each mailbox is eligible for synchronization every 30 seconds, with a 180-second lease and a 60-second retry delay after failure. This is a small-deployment polling implementation, not a scale-tested scheduling SLA. Many calendars or slow provider requests increase delay; monitor last-success time and worker capacity.
- Reads span the last ten minutes through the next fourteen days. Google expands recurring instances; Microsoft calendarView returns occurrences. Occurrence IDs are durable keys. UTC storage and provider timezone handling prevent local-server timezone changes from shifting events; UI renders the browser's local timezone.
- Full paginated snapshots must succeed before reconciliation. Partial/oversized results never imply cancellation. Limits: ten pages/2,500 events per snapshot, 4 MB per HTTP response, 15-second request timeout, first 100 invitees retained. Over-limit snapshots pause future joining visibly rather than silently dropping pages.
- No email messages or attachments are ingested. Bounded invitation text is used only to locate an allowlisted meeting URL, not as system instructions. All-day events, unsupported links, removed/declined invitations and events not addressed to the mailbox do not dispatch.

### Dispatch and stopping

- Dispatch targets the scheduled start, with up to five minutes of catch-up after a brief outage. It requires successful calendar data newer than 90 seconds, current owner authorization, agent/conversation access, standing auto-join consent and a configured meeting provider. Older invitations become `missed`; ended meetings are never joined.
- Event reservation, meeting identity and policy/version checks are database-backed. External creation is **at most one attempted request per dispatched occurrence**, not a guarantee the provider admits exactly one participant. Unknown outcomes remain `uncertain`/`failed`; there is no blind automatic retry and therefore no guarantee of delivery after a crash.
- Before dispatch, schedule/link changes update the pending event. After dispatch, time/link changes stop the existing bot and require manual review rather than creating another bot. Cancellation, removing an invitation, skipping it, pausing or disconnecting stops associated live scheduled bots. Polling means changes are not instantaneous.
- An already-started external request cannot be recalled. Local stop prevents more processing; an ambiguous provider removal shows `stop_uncertain` and requires provider-dashboard verification. Disconnect deletes local tokens, not the provider's OAuth grant; revoke that separately in Google/Microsoft account administration if required.
- Scheduled end time stops the bot. The existing one-hour meeting lifetime, five-minute lobby limit and organization quotas also apply; meetings longer than one hour are not fully supported by this pilot. Overlapping scheduled meetings have separate identities, subject to provider capacity and existing quotas.
- Normally ended scheduled meetings enqueue one bounded final notes run from the transcript already received. Missing transcript, quota or authorization failures require manual compilation. This is not a guarantee of receiving late provider transcript segments. Cancelled/skipped meetings do not auto-compile final notes. Notes, task proposals and context publication still require review; no proposed QA work executes automatically.
- Notes mode is silent. Active mode retains the existing transcript-triggered **meeting-chat text** replies; external spoken/full-duplex participation is not added by this release. Slack Huddles and native calendar event creation remain unsupported.

### Access and secrets

- Connect, refresh, policy, skip and disconnect require organization owner/admin authority plus membership in the chosen sharing conversation. Read access is scoped to conversation members; invitee membership alone does not grant app access. Changing conversation membership changes who can see the calendar, transcripts and notes.
- OAuth uses random one-use state hashed at rest, S256 PKCE, a ten-minute expiry, same organization/member/credential binding and exact mailbox verification. Policy versions reject a late callback after disconnect/policy changes. Reconnect keeps the same mailbox/provider/sharing conversation.
- Access/refresh tokens are encrypted server-side and excluded from entity reads/feed responses. Refresh-token rotation is persisted before reading invitations. A mailbox cannot be claimed by a second agent or organization.
- Calendar metadata and meeting content persist after disconnect for history. Automatic retention/purge/export is not implemented. Archive/delete policy and key rotation remain deployment responsibilities. Expired OAuth states are periodically removed.

## API and implementation map

All endpoints below are under `/api/chat/calendar`, protected by the existing organization guard and same-origin web gateway:

| Method/path | Purpose |
| --- | --- |
| `GET /` | Conversation-scoped calendars, invitation agenda, meeting history and setup flags |
| `POST /connect` | Start mailbox authorization with explicit standing consent |
| `POST /callback` | Consume OAuth state, verify identity and encrypt credentials |
| `POST /:id/policy` | Pause/enable auto-join or change default participation mode |
| `POST /:id/disconnect` | Disable mailbox, clear local tokens and stop scheduled bots |
| `POST /:id/refresh` | Queue a rate-limited calendar sync |
| `POST /events/:id/policy` | Skip/allow a pending invitation; skipping stops its live bot |

Core code: `calendar.provider.ts` normalizes provider contracts; `calendar.service.ts` owns authorization/synchronization/scheduling; `calendar.entity.ts` and `20261005-calendar.sql` persist durable state. `MeetingService` validates the internal schedule grant and shares the existing provider/transcript/notes implementation. `CalendarWorker` in `chat.module.ts` runs independently of model work. Frontend: `components/pages/Calendar.tsx`, `components/chat/Meetings.tsx`, agent tabs and `/calendar/callback`.

The agenda feed currently returns up to 500 events ending within the last 30 days or later, plus the latest 200 visible meetings. It is not a full historical export or infinite-paginated calendar. Retained older data is not automatically deleted.

## Verification and rollout gates

```bash
docker compose -p superqa-chat-test -f docker-compose.pipeline-test.yml up -d postgres
npm run build -w apps/api
npm run build:settings-e2e -w apps/web
npm run test:chat:ui -w apps/api -- --silent
npm exec -w apps/api -- jest test/integration/autonomy.test.ts test/integration/chat.test.ts --runInBand --silent
```

Tests use isolated PostgreSQL, real Nest/Next endpoints and real Chromium. Google/Microsoft OAuth, Recall and model transport are **mocked**, not customer credentials. Coverage includes migration reruns, owner restrictions, tenant/conversation isolation, state/PKCE/mailbox verification/replay, concurrent at-most-once dispatch for both providers, timezone/occurrence handling, cancellation/rescheduling, partial-sync/stale-state failure, missed/declined events, disconnect, token renewal/rotation, late-callback fencing and final-note deduplication. Browser coverage includes Calendar details, skip, meeting history/notes/invitees, QAE/AUE tabs and mobile layout, in addition to existing chat/native-video checks.

Review `/tmp/superqa-calendar-desktop.png` and `/tmp/superqa-calendar-mobile.png` after the browser run. These are fixture screenshots, not proof of tenant installation. Production acceptance still requires real provider consent/refresh/revocation, recurring invitation edits and cancellations, bot lobby/tenant admission, signed callback delivery, transcript quality and scheduling latency under expected load. No production database migration or real provider enrollment is performed by the test suite.
