# Live meeting participation

**2026-10-04 native-call update:** See [native-call-verification.md](native-call-verification.md) for the direct-playback fix, compact lobby, audio-reactive avatars, automatic final notes, and successful bounded real GPT-Live verification. Older statements below about unverified native real-provider behavior describe the earlier rollout; Teams/Meet and cross-network pilots remain outstanding.

## Delivered implementation — 2026-10-03

1. Add a server-owned GPT-Live WebRTC session, restricted browser events, durable one-session admission, usage/transcript observation and revocation controls. Keep credentials and configuration out of the browser.
2. Native active meetings: one host browser relays mixed human audio to the model, and a distinct AI audio stream to every peer. Display a disclosed named AI participant. Note-taking stays silent.
3. Teams/Meet: launch Recall Output Media with a one-meeting capability. Its virtual microphone supplies meeting audio; generated speech and an AI participant card return through its camera/audio output. No logged-in human impersonation.
4. Retain notes/evidence and explicit task approval; disable duplicate text/TTS reply paths during live voice. Fail visibly on unsupported setup instead of claiming voice is working.
5. Exercise authorization, duplicate admission, stop/revoke, bounded usage, provider configuration and browser media plumbing with fixtures. Actual GPT-Live account access, latency, interruptions and external tenant admission require a separately authorized pilot.

Slack Huddles remain unsupported by the current transport. Slack's Calls API describes third-party calls; it does not itself carry Huddle audio. A native/Teams/Meet link shared in Slack can use its supported meeting transport, but that is not joining a Slack Huddle.

Sources checked: [OpenAI WebRTC](https://developers.openai.com/api/docs/guides/voice-webrtc?api=live), [Live session configuration](https://developers.openai.com/api/reference/resources/live/methods/create), [server-side controls](https://developers.openai.com/api/docs/guides/voice-server-controls?api=live), [session lifecycle](https://developers.openai.com/api/docs/guides/live-conversations), [Recall Output Media](https://docs.recall.ai/docs/stream-media), [Slack Calls](https://docs.slack.dev/apis/web-api/using-the-calls-api/).

## Selecting participation

With live voice enabled in the deployment, selecting **Participate — live AI voice and discussion** creates a meeting with `liveVoice=true`. Calendar invitations whose default mode is active use the same path. The existing QAE/AUE display name becomes the participant name; the agent always identifies as AI, not as a real human. It listens and speaks through the voice model rather than generating a text reply and then using browser TTS.

Notes-only meetings never create a Live session. For backward compatibility, deployments without live configuration show **Active — text replies (live voice setup required)** and retain the older text interaction. Existing meetings keep their creation-time behavior; enabling the feature does not silently send an already-running call's audio to a new provider. Failed live startup does not silently fall back to another model or keep retrying.

The spoken role prompt combines the fixed QAE/AUE role, chosen display name and conversation guidance, with concise participation, AI disclosure, interruption and uncertainty instructions. Meeting speech cannot authorize actions. This iteration has **no live private-project retrieval or action tools**. Backend delegation requests receive an explicit unavailable/follow-up response; tasks/context remain reviewed notes proposals, not executed actions.

## Deployment

1. Apply prior chat/meeting/calendar migrations, then `apps/api/migrations/20261006-meeting-voice.sql`. It is additive/rerunnable. Back up production before migration. Development only migrated the isolated test schema.
2. Install workspace dependencies and build API/web. This adds the `ws` runtime dependency and its TypeScript definitions for server-side control sockets; no SDK upgrade is required because session creation uses the documented HTTP JSON contract.
3. Configure the API with a project key authorized for GPT-Live:

   ```dotenv
   MEETING_LIVE_ENABLED=true
   OPENAI_API_KEY=<server-only project key with GPT-Live access>
   MEETING_LIVE_MODEL=gpt-live-1
   MEETING_LIVE_VOICE=marin
   CHAT_WORKER_ENABLED=true
   ```

   `CHAT_MODEL` remains the separate reviewed-notes/chat model. Live audio usage is reported in observed seconds, not that model's token totals. Confirm account access and limits; a successful fixture test cannot grant model access. Use provider-side project spend limits and billing alerts. The application does not calculate a dollar price or enforce a currency budget for voice.
4. Native calls need HTTPS (or localhost during development), microphone consent, and the existing deployment STUN/TURN configuration. The meeting host must join and keep their tab open. Every participant must accept the live-audio disclosure before joining. Use headphones: digital loopback is excluded, but loudspeakers can still acoustically feed the model back into a microphone.
5. Teams/Meet require the existing Recall account and signed transcript webhook setup. Set `AUTH_PUBLIC_URL` to the public HTTPS **web** origin and `AUTONOMY_API_URL` in the web deployment to the API origin ending in `/api`. Recall must be able to load `/meeting-voice` and its same-origin `/api/meeting-voice/*` routes. Keep these capability-authenticated routes reachable without an organization-login redirect. They do not accept the user's org session as bot authorization.

Native meetings create a live voice participant only when `MEETING_LIVE_ENABLED=true` and the server has an authorized `OPENAI_API_KEY`. If either condition is missing, the call can still start, but the agent tile reports that GPT-Live is unavailable. After a live session starts, the browser sends the opening greeting over the WebRTC data channel and reports when GPT-Live acknowledges the instruction; that acknowledgment confirms acceptance, not audible playback. Check the output transcript and browser audio permission if the acknowledgement appears but no speech is heard.
6. Allow API egress to `https://api.openai.com/v1/live/sessions` and `wss://api.openai.com/v1/live/sessions/{id}/attach`. Browser/bot WebRTC also requires its negotiated network paths; restrictive firewalls need an actual connectivity pilot. Do not put the OpenAI key, Recall key or provider session ID in the bridge URL/client config.
7. Keep workers enabled for authorization, expiry and control-connection recovery. Graceful shutdown closes locally controlled sessions. A hard crash can lose in-memory transcript fragments and leave close/usage uncertain until recovery. Monitor the visible voice error/finalization state and provider billing during rollout.

Turning `MEETING_LIVE_ENABLED` off stops new live admissions and makes the worker stop existing live sessions after its next check. Stop/end a meeting to revoke a specific participant. Do not use an unannounced production meeting to test credentials.

## Native media path

`NativeCall` keeps human media and the AI audio stream separate. The host mixes their enabled microphone and received human tracks into one model input track. The returned voice goes to a separate Web Audio destination, played locally and sent as a distinct track over each native peer connection. Received AI tracks are not included in model input. A named AI tile displays current participation state; it is not a generated human likeness or a camera feed the model can see.

Only the consenting meeting host can establish the one Live session. A colleague cannot start a second voice session or replace the host's relay. Muting a person's microphone affects their input, not the AI output. The host can **pause/resume AI voice** without ending the call: pausing mutes human audio sent to the model, cancels any current response, and silences AI audio sent to the room. The live session and its heartbeat remain open while paused, so provider usage may continue to accrue; end the meeting to close the session. Leaving/closing the host tab ends participation; automatic browser failover/takeover is intentionally absent to prevent duplicate billing and competing voices. This is still the existing four-person trusted-organization mesh, not a centrally controlled SFU.

## External media path

Active Teams/Meet bots receive an Output Media webpage URL containing a random 256-bit meeting capability in its fragment. The page removes the fragment from the address, captures Recall's virtual meeting microphone, negotiates WebRTC through the backend, and plays generated audio through its output media. The page shows the assigned agent name and an AI card, which the bot can publish as its camera output. No user browser login, password or session cookie is supplied to Recall.

The capability is stored only as a hash, limited to one meeting and one hour, and allows one session startup plus its pulse/stop controls. Duplicate or copied startup attempts do not create more sessions. A capability holder could interfere with that meeting, so treat the Recall create payload and provider dashboard URL as sensitive; avoid logging the fragment. Browser refresh after startup is not a supported reconnection path. Host admission, provider Output Media availability, recording policies and tenant restrictions still govern whether participants actually hear the bot.

## Lifecycle, evidence and limits

- Server creation fixes the model, voice and role configuration. Client data channels may only request `session.close`; they cannot change instructions, inject tools or submit arbitrary provider events to the application. The trusted sideband observes transcript/usage events. No public transcript endpoint is added.
- One durable voice row exists per meeting. Meeting admission is capped at 1,000 creations per project per rolling day. There is one initial Live startup attempt per meeting, with no model-create retries after ambiguous outcomes. Safe, confirmed session closures can reconnect within the browser's bounded retry policy; an ambiguous failed attempt requires reviewing provider usage and starting a new meeting intentionally.
- A five-second watchdog rechecks meeting state, operator authority, enabled agent, conversation access/policy, host peer lease, feature configuration and lifetime. Browser relay heartbeats expire after 30 seconds; orphaned server control ownership becomes recoverable after 45 seconds. These are polling targets, not an independent hard real-time spend circuit breaker. A complete application outage can delay provider shutdown.
- End, cancel, disconnect or permission changes stop local processing and request provider close. `session.closed` confirms finalization; timeouts/disconnections preserve an `uncertain` state. Latest cumulative seconds are retained using a maximum, never summed across updates. Unknown usage is not treated as zero cost. The UI shows observed seconds and whether usage is finalized.
- Native Live transcripts label human input as mixed audio with unverified speakers. External human speaker entries continue to come from signed Recall callbacks, while AI speech comes from the Live sideband. Transcript presence is not proof that speech was audibly delivered or that a factual claim is true.
- Voice fragments are grouped into bounded roughly 30-second segments and flushed after approximately 35 seconds or graceful close. Persisted segments are immutable; later fragments create separate evidence. A hard crash can lose the unflushed tail. Limits are 4,000 characters per segment, 1,000 stored meeting entries and the existing 200-entry/40,000-character notes input. Oversized notes fail visibly; hierarchical long-meeting summarization is not implemented.
- The existing one-hour maximum meeting life applies. GPT-Live audio is processed by OpenAI and external meetings also by Recall; this application does not store raw media and sets Live session `store=false`. This does **not** assert zero provider retention. Confirm provider processing/retention terms and organization policy; persistent transcripts and notes still need the deployment's retention/export/deletion policy.
- Live audio has no pre-playback factual approval step. Prompt behavior, names, language, turn-taking, speech overlap, response timing and transcription accuracy require real evaluations. Tool-free voice cannot silently execute QA work; review remains required for notes/task publication.

## Code and verification

API: `voice.provider.ts` owns the OpenAI contract; `voice.service.ts` handles scoped admission, state, evidence and watchdog; `voice.controller.ts` separates member-authenticated native routes from scoped external capability routes. `MeetingService` chooses live mode at creation and suppresses duplicate text replies. UI: `lib/live-voice.ts`, `NativeVoice.tsx`, `NativeCall.tsx`, `/meeting-voice` and its fixed same-origin gateway.

Run the commands in [meetings.md](meetings.md). The browser test creates a synthetic WebRTC model peer returning a tone; real microphone/camera fixtures, native peer negotiation, backend admission, AI track delivery to a second participant and stop controls execute. The external bridge page is exercised with a simulated Recall environment. Provider session creation/sideband, Recall dispatch and model content are mocked. Synthetic SDP negotiation is injected only through the test application middleware, never through production routes.

Screenshots: `/tmp/superqa-live-voice-desktop.png`, `/tmp/superqa-live-voice-mobile.png`, `/tmp/superqa-external-live-voice.png`.

Before a real rollout, explicitly validate authorized GPT-Live creation/sideband close/usage, microphone mute, barge-in, acoustic echo, cross-network TURN, two or more human speakers, browser suspension, host departure, Teams and Meet lobby admission/output audio, revoked credentials and quota handling. No test here establishes real conversational quality, latency, Slack Huddle support or universal autonomous QAE/AUE capability.

Latest verification: **44 chat/calendar/meeting tests pass with browser checks enabled**, including the native two-peer audio path and external capability page. API and isolated Next production builds pass. Tests exposed and fixed a late-admission cleanup race: a session already closed during revocation must not be reopened merely to close it a second time. No production database migration, provider enrollment, real model call or deployment was performed. Dependency installation reports existing repository audit findings; no unrelated dependency upgrade was attempted.
# Native call greeting and reconnect behavior

The host tab starts GPT-Live only after the host joins and checks the live-audio disclosure. After `session.started`, the trusted sideband sends `session.instructions.append` with a first-name greeting and a sequential introduction instruction for each selected agent. This is a speak-first instruction; it is not a playback receipt, so production monitoring must still verify the output audio/transcript.

Agent participants share one GPT-Live session. This reduces per-agent session cost and avoids agents competing to speak, while preserving distinct names and role instructions. The meeting stage shows one tile per selected agent; subsequent agents are marked as queued to greet. It does not create separate voice identities.

Transport/model failure triggers at most two browser reconnect attempts (three total sessions). The server accepts a retry only if the preceding session is `closed` and finalized, limits each meeting to three attempts, and adds confirmed per-attempt usage into the cumulative seconds total. `uncertain` close results are not retried automatically. This intentionally favors duplicate-billing safety over an unsafe reconnect.

Use `apps/api/migrations/20261008-meeting-voice-reconnect.sql` to add per-attempt accounting before deploying. The transcript-sharing setting blocks stored-transcript note/reply jobs; it does not disable the raw audio processing needed for active voice. The separate join disclosure describes that processing.
