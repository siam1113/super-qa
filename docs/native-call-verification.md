# Native meeting call review — 2026-10-04

## Reproduced problems

- The host received the greeting instruction and a remote audio track, but the browser did not render agent audio through the intermediate Web Audio broadcast stream. A real WebRTC fixture reproduced the failure: the model sent packets and the UI received its transcript, yet no speaking indicator appeared. Playing the incoming model stream directly fixed the failure. The separate broadcast stream remains available to other human participants and stays excluded from model input.
- Human speaking activity was only measured in the lobby. Joined user tiles had no microphone analyser or speaking class.
- The pre-call dialog used the full in-call height as soon as a meeting existed, even before anyone joined. This left a large empty area below the lobby.
- Repeated stop requests changed an already finalized voice session back to `stopping`, which blocked safe reconnect checks.
- Native call endings did not automatically queue final notes, and the focused summary screen offered no compilation, transcript evidence, or publication controls.
- Meeting request replay compared JSON object serialization rather than participant fields; PostgreSQL JSON key ordering made legitimate retries conflict.
- Mobile call controls could be clipped inside the dialog despite the document itself having no horizontal overflow.

## Delivered behavior

1. A direct agent call opens a compact, content-sized camera preview. Mic/camera toggles, input meter, consent, Cancel, and Join remain visible. The full call layout is reserved for joined participants.
2. The incoming live-model stream plays directly through an audio element. Blocked playback offers an explicit Enable AI audio action. The model input still contains human audio only.
3. Human tiles measure actual audio levels, grow/ripple while speaking, and stop indicating speech when muted. Camera tiles receive a speaking border. Agent activity also follows audio, rather than transcript arrival.
4. Voice connection failures are visible instead of hidden behind screen-reader-only text. Disconnected live agents leave the visual stage and return when playback reconnects. Existing bounded, confirmed-close retries remain in place.
5. Voice startup can be cancelled during ICE setup or admission; late admitted sessions are stopped instead of leaking after the call component unmounts.
6. Ending or explicitly leaving the last human participant closes the native meeting and queues one final notes job when a shared transcript exists. Abandoned lobbies and stale peers still use the existing worker cleanup. Agent tiles alone do not keep a meeting alive.
7. Notes include persisted transcript references. The summary screen exposes preparation/errors, manual compilation, transcript review, and approval before publication to chat. A transcript control also allows written notes during the call.
8. Notes-only calls start the browser caption path after consent where supported. Browsers without speech recognition show a capture error; written notes remain available. Live active calls use the model's server-observed transcript.
9. Finalized stop calls remain finalized. Reported live usage includes the current attempt as well as completed attempts.
10. Mobile controls wrap within the call window and the participant area scrolls independently. Speaking animations respect reduced-motion preferences.

## Visual direction

Retain the application's Inter typeface and existing theme tokens: canvas `#080A0F`, surface `#0D1117`, elevated `#111827`, text `#F9FAFB`, blue `#3B82F6`, and agent purple `#8B5CF6`. The lobby is a single preview above a compact footer. The joined call contains spaced participant tiles and bottom controls; transcript content is shown only when requested. Audio-reactive motion conveys activity rather than decorating the screen.

## Verification

The isolated test database is PostgreSQL on port 55432. Tests must never point at an organization database. Browser tests launch their own Next server on an available local port.

```sh
npm run build -w apps/api
npm run build:settings-e2e -w apps/web
npm exec -w apps/api -- jest test/integration/chat.test.ts --runInBand --silent
CALL_UI_E2E=1 npm exec -w apps/api -- jest test/integration/chat.test.ts --runInBand --silent --testNamePattern='verifies native call greeting'
```

The direct-call browser regression asserts a greeting command, actual generated-audio activity, local microphone activity/mute, camera off/on, responsive controls, call ending, final notes, transcript evidence, and reviewed publication. The two-browser regression checks native peer audio delivery and fullscreen. Backend tests cover permissions, replay, stale/empty meetings, last-person departure, transcript persistence, finalization, and automatic final notes.

Final result: **51 tests passed, one broader legacy chat/calendar browser wrapper skipped**, with `CALL_UI_E2E=1` across the complete chat integration suite. Both native browser tests ran. API and isolated web production builds passed, as did `git diff --check`. The separate real-provider test also passed. No production migration or Git commit was performed.

### Real-provider check

A bounded real GPT-Live check passed using the configured deployment key, synthetic speech, and the isolated test organization. No user's microphone or private meeting transcript was used. The agent audibly greeted `owner`, transcribed the synthetic login-testing question, generated a relevant spoken answer, and produced real model-generated notes with saved transcript evidence.

The optional `CALL_REAL_E2E=1` variant reads the API key and model settings from `apps/api/.env`, uses a pre-generated synthetic WAV at `/tmp/superqa-call-prompt.wav`, and incurs normal provider usage. Do not enable it for routine CI. Its captured evidence contains only synthetic transcript event types/text, not credentials or provider session IDs. The notes mock is replaced by the configured real notes model in this variant.

Artifacts from this review: `/tmp/superqa-call-lobby-before.png` (latest compact lobby despite the historical filename), `/tmp/superqa-call-active.png`, `/tmp/superqa-call-mobile.png`, `/tmp/superqa-live-voice-desktop.png`, `/tmp/superqa-live-voice-mobile.png`, and `/tmp/superqa-real-call.json`.

## Practical limits

### Connection failures and voice shutdown

Meeting requests now show meeting-specific connection/timeout messages; they no longer claim a chat draft was preserved. This includes meeting creation, detail/history, signaling, and voice endpoints. Browser-to-web connection failures use the same distinction. A failed details refresh alone is not proof that a provider has acknowledged voice termination.

- Leaving/ending the host call stops local audio and requests closure over both the model control channel and the API. The last human leaving also ends the native meeting.
- A failed/closed WebRTC transport stops voice immediately when detected. A transport stuck in `disconnected` gets ten seconds to recover, then the old voice session is stopped before any safe reconnect. A brief recovered interruption does not start another session.
- A failed voice heartbeat stops local input/output and requests closure. Independently, the API watchdog checks every five seconds and rejects host relay/peer heartbeats older than 30 seconds. These timings are targets while services are operational, not hard shutdown guarantees.
- Provider closure must be acknowledged before automatic model reconnection. API/provider outages can delay confirmed shutdown; the UI reports unconfirmed final usage instead of claiming termination or zero cost.
- A non-host participant leaving does not shut down a live agent that is still serving the host and other participants.

Regression verification covers sustained versus recovered WebRTC disconnection, failed voice heartbeats, expired server relay leases, idempotent closure, and last-participant departure.

- The successful live check demonstrates the configured native path in local Chromium. Cross-network TURN connectivity, Safari/browser permissions, and external Teams/Meet admission need their own environment checks.
- Notes-only automatic speech capture depends on browser speech recognition. Live active calls use GPT-Live transcription and do not require that browser feature for notes.
- Selected QAE/AUE personas still share one live session and one voice. Separate simultaneous model voices and host-relay failover are not implemented.
- Transcript fragments are persisted in bounded segments, so the transcript panel can lag speech. Final notes wait for voice close/flush. A hard crash can still lose an unflushed tail.
- Model greeting wording and response content are probabilistic; receipt of a greeting command alone is not proof of audible speech. The browser regression checks actual audio activity.
- Automatic notes are proposals. Publication to conversation still requires a user's approval.

The implementation follows the [OpenAI WebRTC guide](https://developers.openai.com/api/docs/guides/voice-webrtc?api=live) and [GPT-Live greeting/session guidance](https://developers.openai.com/api/docs/guides/live-conversations).
