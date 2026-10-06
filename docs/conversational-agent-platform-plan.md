# Conversational Agent Platform — Build Plan

Status: phased implementation plan; none of the features below should be treated as delivered until its acceptance gate passes.

2026-10-03 meeting update: a native four-person WebRTC pilot, QAE/AUE note-taking/active modes, reviewed evidence-linked notes, shared browser voice playback and an optional Teams/Google Meet transcript/chat bot adapter are implemented in [meetings](meetings.md). This is not full Phase 4/5 completion: Slack Huddles, external full-duplex speech, retention, real-tenant acceptance and production media infrastructure remain gates.

2026-10-03 implementation update: the first native personal/group chat and organization-owned Slack/Teams text adapters are described in [chat and text integrations](chat-and-text-integrations.md). This includes member-scoped conversations, named agents, per-chat instructions, bounded replies, reviewed tasks and durable delivery. Public OAuth app distribution, broader QA task execution, meetings and voice remain pending. The scope was narrowed to a simple native chat by the user; advanced chat features follow later.

Scope correction: only the built-in **QAE** and **AUE** are supported. Users assign display names to those two profiles; they cannot create custom agents or redefine the base engineering roles. This restriction supersedes the earlier configurable-agent proposals below. Per-conversation guidance remains supported.

## Product outcome

An organization can name its QAE and AUE, install those agents into approved conversations, configure per-conversation behavior, and let them observe/respond/create tasks under explicit permissions. Each agent will eventually run independent work concurrently and, where the provider supports it, join scheduled calls with transparent voice participation.

The agent is a first-class service identity, not a shared human account. The organization controls its display name, while QAE/AUE identities and roles remain fixed. Provider access comes from independently installed bot/app authorization with least-privilege scopes and an auditable channel/meeting grant.

## Current baseline and constraints

- Organization accounts, invitations, browser sessions, OIDC, and authenticated super-admin organization creation exist. See [organization accounts](organization-accounts.md).
- There is an `AgentsModule` with legacy QAE/AUE-style chat/session/task endpoints and a Python-agent proxy. It is not an organization-aware chat product or a secure multi-tenant conversational runtime.
- The existing bounded QAE/AUE harness is proposal/review and approved-suite oriented; it is not a general-purpose agent task executor. See [shared agent harness](shared-agent-harness.md) and [autonomy delivery ledger](autonomy-delivery.md).
- The product currently has no first-class native conversation/message/membership model, per-conversation agent instruction, provider installation record, event inbox, durable orchestration queue, real-time media service, or voice consent UX.
- Current lockdown intentionally blocks legacy unscoped chat endpoints; do not expose them as the new multi-organization integration surface. New APIs must enforce organization, conversation, agent, and capability scope on every request and background job.
- Slack bot access is installation- and scope-based and messages/events are limited to conversations the app can access. Teams messaging bots and Teams meeting media bots are distinct capability paths. Real-time Teams media is a specialized .NET/C# and Azure-hosted service with significant compute/network needs; it must not be hidden inside the current Node API.
- Slack's Calls API integrates an app's own call service into Slack; it is not a general mechanism for an app bot to join and speak in a Slack Huddle. Treat Huddle participation as unsupported unless Slack documents a supported bot participant API for the intended distribution model.

## Core design

### Identity and authorization

Model an `Agent` under an organization with `displayName`, `primaryEmail`, aliases, enabled state, owner, and policy. Keep identity separate from `AgentInstallation` (provider credentials/tenant), `ConversationMembership`, and `MeetingSession`. Credentials are encrypted at rest and never returned after installation. Use OAuth/app installation and admin consent, not user passwords or pasted personal access tokens as the normal onboarding path.

Every inbound event and outbound action carries `organizationId`, `agentId`, `providerInstallationId`, `conversationId`, `eventId`, and an idempotency key. Verify provider signatures, replay windows, tenant/workspace ownership, installation status, event subscription, bot membership, and allowed action policy before dispatch. Store a minimal event envelope and retention-controlled content; support disconnect, token revocation, data deletion, and audit export.

### Conversation and agent behavior

Native chat needs durable `Conversation`, `Participant`, `Message`, `MessageDelivery`, and `AgentConversationPolicy` records. The per-conversation system prompt is versioned policy input, not an arbitrary overwrite of safety, organization policy, tool permissions, or platform instructions. Resolve effective instructions as platform safety → organization agent policy → conversation-specific intent → task context. Keep provenance/version IDs for every agent response.

Provide a small action catalog: read authorized messages, reply/thread reply, react where supported, create/assign/update a task, request clarification, and propose a follow-up. Make high-impact actions approval-gated. Messages may trigger an agent by explicit mention, configured alias, or administrator-defined rule; do not continuously run a model for every event. Deduplicate, debounce, thread/context-bound, and rate-limit invocations to control loops and costs.

### Parallel runtime

Use one durable orchestration layer for chat turns, tasks, monitoring, and meeting work. Persist `AgentRun`, `WorkItem`, `Lease`, `ToolInvocation`, `Approval`, and `Artifact` records; use the existing PostgreSQL + Redis/BullMQ pattern for durable state plus transport. Each work item declares org/agent, trigger, scope, policy version, idempotency key, deadline, budget, concurrency class, and cancellation state. Limit per-org and per-agent concurrency; prioritize interactive chat over background monitoring; checkpoint long work; resume after restart; cancel/fence late writes. Never share mutable conversation histories across runs.

### Voice and meetings

Separate meeting scheduling/join orchestration from media transport and from the shared reasoning runtime. Join only after explicit policy/host authorization; identify the participant as an AI agent; announce recording/transcription state as required; allow a human to mute/remove/stop the agent; persist consent and meeting audit state. Default to transient streaming and minimum retention. Do not store raw audio/video unless explicitly enabled and legally reviewed. Start with transcript/event-driven participation where provider APIs permit it, then add speech-to-text, turn-taking, response arbitration, and text-to-speech. Full duplex/low-latency voice is a later capability, not a property of ordinary chat APIs.

## Phases and gates

### Phase 0 — Product and security contract

Deliver domain model/ERD, API contracts, data-retention matrix, threat model, provider capability matrix, tenant-isolation test plan, consent UX, and cost/concurrency budgets. Decide supported task/action policy, agent alias invocation rules, failure behavior, and supported deployment regions. Confirm that the existing product’s native chat scope is defined (web/mobile, files, search, notifications, retention) before building a second chat surface accidentally.

Gate: reviewed contract and migration plan; explicit provider installation/permission inventory; no implicit organization-wide access.

### Phase 1 — Agent identity, admin setup, and secure integrations

Add organization-scoped agent create/edit/disable APIs and UI; display name, email, aliases, purpose, base policy, and ownership. Build integration records and encrypted secret storage. Add Slack OAuth installation and Teams app/bot installation/admin-consent flows, least-privilege scopes, health/reconnect/revoke state, and accessible-channel discovery. Start with provider-managed bot identities; never request a person's password. Add webhook signature validation, event deduplication, and audit records.

Gate: two isolated organizations can independently create agents and install/uninstall test workspaces; cross-tenant reads/writes and forged/replayed callbacks fail tests.

### Phase 2 — Native chat and controlled conversation membership

Implement native conversations, membership, messages, threads, mentions, unread state, and an agent as a participant. Provide invite/add/remove agent UX and versioned per-conversation instructions with a safe preview/test action. Deliver inbox/outbox processing, provider adapter interfaces, Slack/Teams text events, and normalized message/reaction/thread operations. Start with mention-triggered responses and explicit task creation; include human approval for external write actions until evaluations meet the launch bar.

Gate: complete native chat vertical slice and one Slack + one Teams text channel slice. Verify event replay, retries, ordering, thread context, token revocation, permission changes, data deletion, safe prompt injection handling, and traceable message/task outcomes.

### Phase 3 — Durable task and parallel-work runtime

Route chat-created tasks, QA tasks, scheduled monitoring, and delegated analysis through durable work items and agent runs. Add leases, retries, cancellation, priorities, per-agent/per-org concurrency caps, execution budgets, idempotent tools, approval checkpoints, run timeline, and operator controls. Connect QAE/AUE through the existing bounded harness as explicit tools/workflows instead of bypassing its evidence and approval rules. Keep each run's bounded context separate and attach source/message references rather than copying whole histories.

Gate: restart/duplicate-delivery/cancellation/race tests; no duplicate external action; measured bounded token/cost/runtime; foreground chat remains responsive during background task load.

### Phase 4 — Meeting participation, first transcript-led

Implement native meeting session lifecycle and in-meeting agent identity/consent controls. For Teams, first support meeting metadata/authorized transcript or event workflows where tenant policy and Graph permissions allow; build a dedicated service boundary for real-time media only if target customers require it. Validate join authorization, disclosure, access to transcript/media, retention, host removal, and audit. For Slack, support links/notes/follow-up or an explicitly integrated external call service; do not promise joining Slack Huddles as a participant absent a supported API.

Gate: customer tenant/admin consent, legal/privacy review, realistic latency/cost test, reconnect and host-removal exercise, and permission-limited meeting data end-to-end.

### Phase 5 — Vocal participation and quality/scale readiness

Add streaming speech-to-text / turn detection / speech generation with interruption handling, push-to-talk or explicit speak modes, per-meeting voice/persona settings, language/accessibility options, and clear disclosure. Add safety filters, bounded speaking policy, human override, noisy/ambiguous audio handling, and silence/fallback behavior. Evaluate task completion, response grounding, latency, interruption rate, transcription accuracy, false triggers, token/audio cost, and consent compliance before enabling broad autonomy.

Gate: opt-in pilot targets pass published thresholds across noisy, multilingual, overlapping-speaker, and adversarial scenarios; an administrator can disable voice globally and per agent.

### Phase 6 — Managed rollout and continuous evaluation

Add connector health dashboards, delivery lag/retry/dead-letter queues, run and spend dashboards, audit export, organization deletion/export, scoped retention, alerting, load/chaos tests, backup/restore, accessibility and abuse testing. Roll out behind per-org/per-agent capabilities and staged flags. Expand autonomous write permissions only when evaluation and incident data justify each action class.

Gate: production security review, tenant-isolation sign-off, disaster-recovery test, support/runbooks, provider app review/approval, and a documented rollback path.

## Initial implementation order

1. Ship Phase 0 contract and Phase 1 domain/authentication foundation.
2. Build one complete native-chat path before provider breadth: add agent → configure conversation intent → mention agent → grounded answer or task → audit/review.
3. Add one-way-at-a-time Slack and Teams text adapters behind the same normalized event/action interfaces.
4. Add durable parallel task execution and QAE/AUE harness invocation.
5. Begin meeting work with transcript/event-based Teams support and a capability check for Slack; only then decide whether real-time media investment is justified.
6. Add voice and broader autonomous actions after privacy, accuracy, and operational gates pass.

## Non-goals and safeguards

- No shared human passwords, account impersonation, arbitrary channel scraping, or silent meeting recording.
- No direct model-generated SQL, arbitrary code execution, or organization-wide action rights derived from a conversation prompt.
- No claim of universal replacement of QAE/AUE staff. Autonomy is enabled per action and environment, with evidence, permissions, budgets, review and rollback.
- No “Slack Huddle voice agent” commitment based on Slack's Calls API alone; that API presents third-party call services in Slack, not a general bot-media bridge.
- No putting Teams real-time media in the current NestJS process. It is a separately operated media service with its own deployment and reliability envelope.

## Provider references checked (2026-10-03)

- Slack Events API delivers events according to authorized scopes and what the installing user/bot can access: [Events API](https://api.slack.com/apis/connections/events-api). Conversation history for a bot is constrained to conversations the bot belongs to: [conversations.history](https://api.slack.com/methods/conversations.history). The Slack Calls API surfaces an app's own call service within Slack; Slack does not provide the call media: [Calls API](https://api.slack.com/apis/calls).
- Teams calling/meeting bot registration requires app manifest capabilities and Graph permissions/admin consent: [register a calls and meetings bot](https://learn.microsoft.com/en-us/microsoftteams/platform/bots/calls-and-meetings/registering-calling-bot). Real-time application-hosted media requires C#/.NET and Windows Server/Azure infrastructure and substantial media operations: [real-time media concepts](https://learn.microsoft.com/en-us/microsoftteams/platform/bots/calls-and-meetings/real-time-media-concepts), [application-hosted media requirements](https://learn.microsoft.com/en-us/microsoftteams/platform/bots/calls-and-meetings/requirements-considerations-application-hosted-media-bots).
