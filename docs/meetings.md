# Meetings implementation and rollout

**Live-voice addendum:** New active meetings can now use GPT-Live speech-to-speech in native calls and the Teams/Meet Output Media bridge. Enable it explicitly and follow [live-meeting-voice.md](live-meeting-voice.md). The text/TTS behavior below describes the baseline retained when live voice is disabled and for existing meetings. Slack Huddles remain unsupported; real-provider voice acceptance is not established by fixture tests.

## Phases

1. Native small-group video calls: authenticated conversation members, consent, microphone/camera controls, leave/end, temporary WebRTC signaling, and explicit connection errors. QAE/AUE remain the only agent identities.
2. Transcript-led agents: silent note-taker or active participant, attributed transcript, bounded reasoning, evidence-linked notes/action/context proposals, human-reviewed publication, and stop controls.
3. External meeting adapter: organization-authorized Teams/Google Meet bots through a separately configured Recall account, signed transcript events, bounded lifetime, explicit uncertain join/leave states. This is separate from Slack/Teams text credentials.
4. Production gates: live customer-tenant pilots, TURN deployment, transcript quality/voice latency evaluation, retention/privacy review, and external full-duplex voice. Slack Huddles require a separately supported integration; do not substitute Slack Calls API or impersonate a human account.

Phases 1–3 now have a pilot implementation, with the exact scope below. Phase 4 remains a release gate, not a completed capability. No provider credentials or live meeting authorization have been supplied; fixture tests cannot establish real tenant acceptance.

## Provider constraints checked 2026-10-03

- [Slack Calls API](https://docs.slack.dev/apis/web-api/using-the-calls-api) represents an external call service; it does not supply Huddle media access.
- [Recall output media](https://docs.recall.ai/docs/stream-media) supports Teams/Meet, not Slack Huddles. External low-latency voice requires output-media infrastructure and is distinct from transcript-led meeting-chat responses.
- [Google Meet Media API](https://developers.google.com/workspace/meet/media-api/guides/get-started) has developer-preview enrollment requirements; it is not a universal unattended meeting bot interface.
- Recall [real-time transcripts](https://docs.recall.ai/docs/bot-real-time-transcription), [webhook verification](https://docs.recall.ai/docs/authenticating-requests-from-recallai), and [meeting chat](https://docs.recall.ai/reference/bot_send_chat_message_create) define the adapter contract.

## Provider decision (2026-10-05): staying on Recall for now

Considered replacing Recall with native first-party calling bots for both providers; decided to stay on Recall for Teams and Google Meet alike until revisited.

- **Teams**: Microsoft's Graph Calling API + Azure Communication Services would let a bot be directly invited mid-call (not just calendar/URL-triggered) and would make Recall unnecessary for Teams specifically — it's a strict superset of what Recall does there. But it needs high-privilege **application** Graph permissions (`Calls.AccessMedia.All`, `Calls.JoinGroupCall.All`, tenant-admin consent) and our own real-time media pipeline, a meaningfully larger build than the current HTTP-call-to-Recall integration.
- **Google Meet**: the equivalent would be Google's Meet Media API, which is still **developer-preview**, enrollment-gated, and per Google's own docs is not positioned as a general unattended-bot interface — it may not support a fully automatic always-on join even after building against it. Dropping Recall for Meet is blocked on Google's platform maturity, not just engineering effort.
- Even if the Teams Calling Bot were built, Recall would still be needed for Google Meet (the Calling Bot is Microsoft-only), so there's no path to dropping Recall entirely without also solving the Google side.

Revisit when: Google's Meet Media API exits developer preview with clearer unattended-bot support, or there's a concrete need for the "invite the agent mid-call" UX on Teams badly enough to justify the Graph Calling API build.

## Privacy and scope

Meeting host attestation is required before external dispatch. Native participants individually accept transcription disclosure before joining. Raw native audio/video is not stored by this application. Optional browser speech recognition may process microphone audio through the browser vendor; availability and accuracy vary. Manual attributed transcript entries remain available. A note-taker never replies into the meeting; an active participant responds on request, not to every utterance. Suggested work/context is not automatically executed or inserted into the organization knowledge base.

## What is implemented

Open an organization conversation, then **Calls & meetings**. An Owner or Admin starts a call, chooses the existing QAE or AUE, and selects note-taking or active participation. Conversation members can view its meeting history and native members can join after accepting disclosure. Membership is rechecked for every request. Super-admin identity alone is not an organization meeting entitlement.

### Native video pilot

- The native call UI has a full-width responsive stage, camera-off participant tiles, a named AI tile, elapsed/live status and a compact mic/camera/captions/AI-voice-pause/leave dock. The host can pause and resume AI audio processing during a call; the live session remains open and may continue accruing provider usage until the meeting ends. Pre-join consent and call health remain visible. Noise status reflects the browser media track's `noiseSuppression` setting; this is not a Krisp SDK integration.
- Audio/video uses browser WebRTC peer connections, not a third-party iframe. Four human participants maximum, one live call per conversation, one joined tab per member, one-hour maximum session. Camera and microphone toggles, leave, and host-end controls are available.
- Authenticated PostgreSQL signaling exchanges offers, answers and ICE candidates. A one-second heartbeat/signaling poll discovers peers; leases expire after 30 seconds. Signals expire after 60 seconds. Closing the modal leaves the call. On authorization/poll failure, the supplied client stops media rather than retaining an uncontrolled connection.
- Production requires HTTPS and deployment-owned STUN/TURN. Without TURN, same-network tests can pass while real cross-network calls fail. TURN REST credentials are signed per member, valid for one hour; the shared secret remains server-side.
- Each person can enable their own English browser captions or submit manual entries. Captions are attributed to the signed-in member; clients cannot submit another speaker name or a provider transcript. This is not universal streaming speech recognition and does not listen to silent participants whose captions are disabled.
- Active replies are generated only on explicit request. An operator who is joined can request **Speak to native call**. Joined clients receive the request and use their own browser speech synthesis, at most once per request. Voices can differ by device. This is synchronized client playback, not a server media participant or full-duplex voice model. Microphones are temporarily muted and captions stopped during playback to avoid feedback; captions must be re-enabled explicitly. Playback has a one-minute rate limit, timeout and local stop control.
- P2P authorization revocation depends on compliant clients closing existing peer connections after the next poll. A centrally enforced media disconnect needs an SFU; the current mesh is intentionally a trusted-organization pilot, not a hostile-client conferencing service.

### Notes, actions and context

- Finalized provider transcripts, browser captions and manual contributions are stored with their source and speaker. There is no claim of perfect speaker identification or transcription accuracy.
- **Compile notes** produces a summary plus decision/action/context/question proposals. Every item must reference real transcript entry IDs. References prove source identity, not semantic correctness. The UI links each item to its transcript evidence.
- Native note-taking is silent. Teams/Meet bots additionally post a disclosure when joining; note-takers send no generated replies. Active external agents respond through meeting chat when their name/role appears in a finalized transcript or when an Owner or Admin asks from Super QA.
- **Approve & publish notes** creates one idempotent conversation message. The first suggested action becomes an ordinary reviewed chat-task proposal; all other proposals remain visible in the notes. A further explicit task confirmation is required. No QA execution or organization knowledge-base update occurs automatically.
- Runs are durable queued/running/done/failed records with input evidence IDs, provider usage and policy versions. Model calls have no automatic retries, a 30-second timeout and 2,400 output-token cap. Stop, membership changes and conversation-policy changes fence late replies. Interrupted runs fail visibly instead of spending again.
- Pilot limits are 1,000 meetings and 100 reasoning runs per project per rolling day, 1,000 transcript entries per meeting, and 200 entries/40,000 transcript characters per model run. The meeting quota is currently a shared hardcoded value for all projects. Oversized transcripts fail explicitly rather than silently dropping earlier discussion. Hierarchical summarization and larger-scale concurrency are future work.
- Notes are compiled on request, including after ending the call. Calendar-scheduled meetings also enqueue one final notes run after a normal end; cancelled/skipped meetings do not. See [calendar-auto-join.md](calendar-auto-join.md) for authorization, transcript availability and failure semantics. Meeting tasks and context require human review.

### Teams and Google Meet

For invitation-driven joining, connect the dedicated QAE/AUE mailbox through the new **Calendar** view. Scheduled invitations, title/time/invitee metadata, default participation mode and **Meetings** history are implemented separately from Teams chat installation. Setup, supported scopes and limitations: [Calendar invitation auto-join](calendar-auto-join.md).

The optional adapter creates a Recall bot with the chosen QAE/AUE name, AI disclosure, real-time transcript callbacks, no mixed-video artifact, five-minute lobby limit, and one-hour recording limit. It does not reuse Teams text-bot credentials or the user's browser login. Hosts must admit the bot and provider/tenant policies still apply.

Real-time callbacks verify timestamped HMAC signatures over the exact raw body before application parsing. Accepted event IDs are deduplicated and bound to the returned provider bot ID and its original organization. No unsigned transcript ingestion endpoint is exposed. Model reasoning is queued separately from the callback response.

Create and leave requests are not blindly replayed after ambiguous network failures. An uncertain join stays visibly uncertain; inspect the provider dashboard before trying again. Local stop prevents further ingestion/reasoning immediately; a failed external removal displays `stop_uncertain` and requires provider-side verification. Work already in flight cannot be recalled. Operator **Refresh provider status** reconciles known bot state; complete automatic provider-lifecycle webhook reconciliation remains future work. The worker periodically stops expired or unauthorized meetings and cleans expired signaling.

External active contributions are **meeting-chat text**, not spoken audio. Slack Huddles are rejected by the API and shown as unsupported, not advertised as a working integration. External low-latency voice and Slack Huddle participation remain unimplemented.

## Deployment

1. Apply existing organization and chat migrations, then `apps/api/migrations/20261004-meetings.sql`. It is additive/rerunnable. Meeting timestamps are explicitly timezone-aware so host timezone cannot expire a new call prematurely. No application database was migrated during development.
2. Configure `OPENAI_API_KEY`, `CHAT_MODEL` and the existing web/API auth origins as for chat. The existing chat worker also services meeting jobs. Disabling `CHAT_WORKER_ENABLED` disables these background jobs and periodic cleanup; one worker instance must remain enabled.
3. Configure native media with your own infrastructure:

   ```dotenv
   MEETING_STUN_URL=stun:your-turn-host.example:3478
   MEETING_TURN_URL=turns:your-turn-host.example:5349
   MEETING_TURN_SECRET=<TURN REST shared secret>
   ```

4. To enable Teams/Meet dispatch, provision an authorized Recall account, configure its workspace verification secret, and set server-only values:

   ```dotenv
   RECALL_API_KEY=<provider API key>
   RECALL_WEBHOOK_SECRET=whsec_<base64 workspace verification secret>
   RECALL_REGION=us-west-2
   MEETING_PUBLIC_API_URL=https://your-api.example
   ```

   The public origin must have no `/api` suffix. Expose `POST /api/meeting-hooks/recall` with exact raw-body handling and no browser-session requirement; its signature verification is mandatory. The adapter configures the transcript callback per bot. Region must match the account. Live endpoint shape/permissions and tenant acceptance still need a real-provider pilot before production.
5. Verify provider retention, contractual processing terms and regional routing before enabling external meetings. Disabling mixed video does not mean the transcription provider never processes or retains audio. This release does not configure provider retention or automatically purge stored transcripts, notes and published chat messages. Define and implement organization retention/export/deletion before broad rollout. Never deploy with real meeting credentials solely to run the fixture tests.

## API map

All browser endpoints are under `/api/chat`, behind organization sessions, origin checks and conversation membership:

| Endpoint | Purpose |
| --- | --- |
| `GET /conversations/:id/meetings` | Scoped history and provider configuration availability |
| `POST /meetings` | Idempotent host-attested creation/dispatch |
| `GET /meetings/:id` | Transcript, state, evidence-linked runs |
| `POST /meetings/:id/join` | Per-member consent and short-lived ICE credentials |
| `POST /meetings/:id/poll` | Membership-checked heartbeat and signaling |
| `POST /meetings/:id/signal` | Bounded, deduplicated peer-only SDP/ICE |
| `POST /meetings/:id/leave` | Stop own participation |
| `POST /meetings/:id/end` | Host stops meeting/agent |
| `POST /meetings/:id/entries` | Joined member submits own caption/manual entry |
| `POST /meetings/:id/runs` | Queue bounded notes or active contribution |
| `POST /meetings/:id/runs/:runId/publish` | Review and publish notes once |
| `POST /meetings/:id/runs/:runId/play` | Joined operator requests native active-agent speech |
| `POST /meetings/:id/sync` | Host checks external bot status |

## Verification

```bash
docker compose -p superqa-chat-test -f docker-compose.pipeline-test.yml up -d postgres
npm run build -w apps/api
npm run build:settings-e2e -w apps/web
npm run test:chat:ui -w apps/api -- --silent
```

The suite exercises real PostgreSQL transactions, session authorization, signed synthetic Recall transcript events, mocked provider/model transport, and two Chromium contexts exchanging real WebRTC media from synthetic camera/microphone sources. Browser checks cover consent, camera/mic call lifecycle, remote decoded video, notes, cited proposals, publication, active contributions, shared speech dispatch and host end. Screenshots: `/tmp/superqa-meeting-desktop.png` and `/tmp/superqa-meeting-mobile.png`.

Speech dispatch checks do not measure audible speech quality, browser speech-recognition accuracy, cross-network TURN performance, or real Teams/Google Meet installation. These are separate pilot acceptance gates.

Latest local acceptance: API and isolated Next builds pass; all **23 chat/meeting tests pass**, including the two-browser test. The combined authentication/autonomy and chat regression reports **41 passed, 3 optional checks skipped**; the meeting browser check is separately enabled in the 23-test run. `git diff --check` passes. No live provider/model calls or production changes were made.
# Native chat calls

Calls started from Chat or an agent's Chat tab are always native calls. One-to-one agent chats open the call directly; group chats first provide a participant picker and one role field per selected QAE/AUE. Selected people appear as removable chips. External calendar-driven Teams and Google Meet meetings remain supported through Calendar and are not part of the native-call composer.

Meeting records persist `participantMemberIds`, `agentParticipants` (agent ID plus the user's role instruction), and `shareTranscriptWithAgents`. New calls default transcript sharing on. Turning it off blocks meeting note/reply runs that consume saved transcript text. Live voice is a separate path that processes call audio and still requires explicit in-call consent; the UI calls out that distinction.

Human peers must be selected for the call (the host is always included), and the API rejects joins from other conversation members. Existing meetings are backfilled to their conversation members and legacy meeting agent. Apply `apps/api/migrations/20261007-native-call-participants.sql` before deploying this version.

When GPT-Live starts, the trusted sideband sends a short opening instruction to greet the host by first name and introduce selected agents sequentially. Multiple agent tiles currently share one Live session to avoid duplicating audio sessions and cost; role instructions are kept distinct in the meeting record and session prompt. The voice is therefore a single shared model voice, not independently synthesized voices.

Live sessions have a maximum of three attempts per meeting. A browser reconnect is only accepted when the previous attempt is reported as closed and finalized; uncertain sessions remain stopped to avoid overlapping or duplicate billed audio. Confirmed attempt usage is accumulated. Apply `apps/api/migrations/20261008-meeting-voice-reconnect.sql` before deploying this version. The browser retries at most twice with a short backoff, and the server still caps attempts if clients misbehave.

Run `npm run build -w apps/api` and `npm run build:settings-e2e -w apps/web` after applying the additive migrations. These builds validate types/bundling only; production Live voice and multi-browser media require a configured GPT-Live deployment, HTTPS, and suitable STUN/TURN connectivity.
