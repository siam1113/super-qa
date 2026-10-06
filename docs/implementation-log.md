# Super QA implementation log

## 2026-10-03 — Recover chat JSON parse error

- Reproduced the reported `Unexpected token '<'` symptom: a running Next.js dev server returned an HTML 500 because a production build reused `.next` and replaced a dev chunk (`46.js` was missing).
- Restarted the local web server and verified the meeting API route returns a JSON 401 when unauthenticated. Isolated future dev output under `.next-dev/`; production and isolated build output stay separate.
- Updated `chatRequest` to show a readable service error when a response is HTML or empty. The isolated web production build and `git diff --check` pass.

## 2026-10-03 — Native video call UI refresh

- Reworked the native call into a full-width responsive stage with participant tiles, AI identity, elapsed/live status, camera-off state and a compact mic/camera/captions/leave control dock.
- Added a pre-join lobby with consent, camera selection and concise audio/privacy details; surfaced browser-reported noise suppression without claiming Krisp SDK support.
- Moved transcript and notes beneath the call stage on wide layouts and documented the native media filter behavior in `meetings.md`.
- Verification: isolated web production build and `git diff --check` pass. The ordinary build directory had a missing generated Next.js chunk; the isolated build completed successfully.

## 2026-10-03 — Calendar invitation auto-join and meeting history

- Added dedicated QAE/AUE mailbox OAuth for Google and Microsoft, encrypted offline tokens, exact-account verification, one-use state/PKCE and policy-version fencing.
- Added durable invitation synchronization and at-most-once scheduled Meet/Teams bot dispatch, recurring occurrence/timezone handling, cancellation/pause/disconnect controls and automatic final notes for normally ended scheduled meetings.
- Added global Calendar/Meetings views and both agent tabs, with title/time/invitees/RSVP details, scoped history and evidence-linked meeting notes.
- Documented setup and bounded behavior in `calendar-auto-join.md`. Real provider consent/admission remains a deployment acceptance gate; no production migration was performed.
- Verification before live voice: API and isolated web builds pass; browser-enabled chat/calendar suite **32 passed**; after adding token renewal and disconnect-race tests, combined authentication/autonomy/chat regression **52 passed, 3 optional checks skipped**. Providers/models are fixtures; browser media is synthetic.

## 2026-10-03 — Live participation implementation progress

- Verified the linked official OpenAI GPT-Live WebRTC contract and Recall Output Media contract. The selected voice API is `POST /v1/live/sessions`, default model `gpt-live-1`, with a separate authenticated control/observation WebSocket. Slack Calls is not a Huddle audio transport.
- Added durable one-session-per-meeting admission, opaque server-only provider identity, capability-scoped external bridge, restricted client events, observed cumulative voice usage, explicit incomplete-close status and independent revocation/expiry checks.
- Added native host audio mixing with separate human and AI tracks. The model hears humans, not its digitally routed output; participants hear one shared named AI participant. Host departure stops the relay; there is no automatic takeover or session replay.
- Added Teams/Meet bot Output Media page with a dedicated meeting capability, virtual microphone input, live model audio output and an AI participant card. Note-takers remain silent; live meetings reject duplicate queued reply/TTS paths.
- Live transcript segments are stored as immutable evidence for reviewed notes. Mixed native human audio is labeled without invented speaker identity. External human transcripts still use the signed Recall callback; Live contributes the AI transcript.
- Final browser-enabled suite: **44 passed**, including synthetic full-duplex media delivered to a second participant, the external capability page, cumulative usage, role/policy revocation and a late-admission shutdown regression. API and isolated web builds pass. Setup, behavior and acceptance gates are documented in `live-meeting-voice.md`. No live GPT-Live/Recall calls or production deployment were performed.
- Combined authentication/autonomy/chat regression: **62 passed, 3 optional checks skipped**. The separately enabled browser suite overlaps these tests; counts must not be added together. Final `git diff --check` passes.

## 2026-10-03 — Native meeting pilot and Teams/Meet adapter

Added conversation-scoped native video calls for four people using real WebRTC peer media, short-lived signaling, explicit participant consent, camera/microphone controls, host end and per-member leave. Only existing named QAE/AUE profiles can participate. Native transcripts support explicit browser captions and attributed manual contributions. Silent note-taking and active participation are separately enforced; active native contributions can be played through joined clients' speech synthesis, with microphone/caption feedback protection and human speech controls.

Added durable bounded meeting reasoning, evidence-ID validation, decision/action/context/question proposals, and idempotent reviewed publication into chat. Suggested tasks still require separate confirmation and never execute automatically. The optional Recall adapter dispatches disclosed Teams/Google Meet bots, verifies signed live transcript callbacks, responds to name-triggered requests through meeting chat, and exposes uncertain join/leave/delivery outcomes without blind retries. Slack Huddles and external spoken/full-duplex participation are explicitly unsupported in this release.

Verification: API and isolated Next production builds pass; **23 chat/meeting tests pass**, including two Chromium contexts exchanging decoded synthetic video over real WebRTC, consent/mic/leave/end controls, transcript and notes publication, and shared speech dispatch. Fixture tests cover organization isolation, immutable agent roles, signal retries, forged/replayed callbacks, invalid meeting URLs, silent-mode enforcement, stale/revoked work, ambiguous bot creation, and bounded voice requests. Browser screenshots were visually reviewed. The tests exposed and fixed timezone-dependent meeting expiry and JSONB key-order-dependent signal retries. They do not establish actual microphone transcription accuracy, audible voice quality, TURN/cross-network reliability, or real Teams/Meet tenant acceptance.

No live provider/model call, application database migration or production deployment was performed. TURN and provider credentials, retention policy, live tenant acceptance, richer summarization, SFU-grade media revocation, external voice and Slack Huddles remain rollout work. Full scope, limitations, routes, environment configuration and phased plan: [meetings.md](meetings.md).

## 2026-10-03 — Native chat, fixed QAE/AUE identities, and text integrations

Added organization-scoped personal/group conversations, participant-only history, stable message pagination, idempotent sends, quoted replies, per-conversation instructions, bounded structured agent responses, and explicitly confirmed tracked tasks. The responsive Chat UI includes conversation search/filtering, message and delivery states, task cards, personal drafts, and mobile navigation. Browser validation covers two signed-in members, group and personal chat, persistence after reload, agent replies, task confirmation/completion, and desktop/mobile layouts.

Per product clarification, organizations have only two supported agent profiles: QAE and AUE. Opening Chat provisions these fixed roles. Admins can change their display names only; custom creation and changes to roles, aliases, email, or base instructions are rejected. Fixed role instructions are supplied by the server. Conversation-specific guidance remains supported. Legacy custom profiles retain history but cannot be selected or execute work; the migration disables them.

Added private-app Slack and Teams text adapters with credential validation/encryption, signed inbound events, explicit channel approval, metadata-only discovery before approval, source-event deduplication, thread-scoped context, disconnect fencing, and a durable reply outbox. Uncertain outbound writes are not blindly retried. PostgreSQL-backed model work uses bounded context/output, rolling organization quotas, leases, and membership/policy checks before spending and publishing.

Verification: API build and isolated Next production build pass. All **14 chat tests pass**, including the real browser flow with fixed-profile rename controls. Combined authentication/autonomy and chat regression runs report **32 passed, 3 skipped**; the chat browser test is separately enabled in the 14-test run, while the other two optional autonomy browser/harness checks are not enabled in this regression command. Desktop/mobile screenshots were visually reviewed. Tests use a real isolated PostgreSQL database with synthetic accounts, mocked model/provider transport, and signed Slack/Teams fixtures; no live tenant installation or live-model accuracy claim is made.

Deployment remains explicit: apply the additive migration and configure the model, encryption key, public origin, and provider app credentials using [chat-and-text-integrations.md](chat-and-text-integrations.md). No application database was migrated or production deployment performed. Chat tasks do not dispatch the QAE/AUE execution harness; meetings, voice, public OAuth installation, automated retention, and broader concurrent work scheduling remain outside this text-first release.

## 2026-09-28 — Authorized offline browser execution

Extended the proposal harness with a separate executor capability/key, durable `harness_executions` records, explicit operator action bindings and target revision allowlisting. Reviewed AUE expectations remain immutable. The API derives verdicts from ordered browser observations, rejects verdict overrides/missing assertions, fences cancellation/stale evidence and retains explicit retry history. It never automatically replays an interrupted browser operation. Passing retries following assertion failures are marked flaky without changing the original failure.

Added a fixed Python/Chromium runner in a pinned Playwright Docker image. The broker uses no shell or host-browser fallback: network disabled, non-root, read-only filesystem/target, dropped capabilities, no-new-privileges and CPU/memory/process/time limits. It copies/hashes bounded trusted app bundles, captures final JPEG evidence and records the actual image ID. No model calls occur during execution. Operator CLI commands cover execution submission/status/cancellation and hash-verified artifact download.

Verification: API production build, 92 API unit tests, 35 Python tests and **60 integration tests all pass**. The real browser test is enabled, not skipped: it drives healthy and seeded-defect login applications through the actual HTTP → Python broker → Docker/Chromium → PostgreSQL path. Healthy text passes; incorrect text fails; both produce persisted screenshots. Additional tests cover capability separation, idempotency, concurrency, admission/claim freshness, missing or forged verdict evidence, cancellation, lease interruption, retained failure/retry history, bundle isolation and rerunnable migration. `git diff --check` passes.

The first browser test exposed a false isolation alarm from dormant kernel tunnel interfaces. Startup now rejects active non-loopback interfaces while accepting dormant tunnels, with regression tests; Docker networking and privilege controls were not relaxed. Docker image build and CLI validation succeeded. No application database was migrated, production deployment performed or live model/provider used. The disposable test stack is stopped; the built runner image remains available.

Scope remains deliberately narrow: trusted self-contained static app bundles, no external URLs or arbitrary generated code/shell, no production credentials. Chromium's own sandbox is disabled inside the restricted container; this is not a hostile-code/public-web service. Membership/RBAC, live-environment network policy, richer oracles, UI, durable trace/object storage and stronger execution isolation remain release gates. Full details and commands: [sandboxed-browser-execution.md](sandboxed-browser-execution.md).

## 2026-09-28 — Shared QAE/AUE proposal harness

Added `HarnessModule` with PostgreSQL task/evidence/case/profile snapshots, idempotent admission, pre-call token/cost reservations, bounded leases, cancellation, attempt history, source/case freshness checks and explicit proposal review. Separate deployment-scoped operator/worker keys fail closed when unconfigured. A standalone Python worker and operator CLI use the same interface for QAE grounded case proposals and AUE assertion-preserving locator plans. SDK retries are disabled for harness OpenAI/Anthropic calls; completion retries replay results without another model invocation. No tools, automatic execution or passing verdicts can be authorized by model text.

Verification: API production build passes; 92 API unit tests, 26 Python tests and 51 isolated PostgreSQL/Redis integration tests pass. Sixteen new harness integration tests cover keys/scope, missing prices, DTOs, duplicate admission, concurrency, reservations, lease expiry/recreation, late-worker fencing, cancellation/deadlines, unsupported evidence, fabricated verdicts, stale revisions, overage accounting, preserved AUE assertions, review and migration repeatability. Both QAE and AUE exercise the real Python worker over HTTP into PostgreSQL with only model generation replaced by fixtures. Nine new Python tests cover parsing, unknown usage, prohibited tool calls, response bounds, provider limits, replay-safe completion, provider failure, cancellation and prompt reservation checks. `git diff --check` passes.

Scope: this is the **proposal/review harness**, not the execution sandbox. It does not promote proposals into QA cases, apply patches, run browsers or independently verify artifacts. Exact quotes establish provenance, not semantic accuracy. Monetary totals are configured estimates with conservative reservations, not provider billing guarantees. Existing chat graphs are not automatically migrated or covered by these budgets. Tenant membership, case/source ACLs, global organization quotas, live-provider evaluation and sandboxed execution remain release gates. No application database was migrated and no live model call or production deployment was performed.

Runbook, commands, schema, limits and next steps: [shared-agent-harness.md](shared-agent-harness.md).

## 2026-09-28 — Production builds and persisted QA workflows

Both delivery tracks are implemented: API/web production compilation succeeds, and the QA API no longer serves synthetic case/run/healing records. PostgreSQL stores reviewed cases, immutable manual execution snapshots, reported observations and healing decisions. The web operator workbench supports create/import, review, run planning, results and cancellation; dashboard and inspectors show recorded data without demo fallback or invented analysis.

Source scenario imports retain preconditions and revision evidence. Transactional admission checks approval/current evidence, deduplicates client request IDs and fences conflicting results or cancellation. Editing resets approval without rewriting historical snapshots. Healing review explicitly does not apply a patch. Production compilation is separated from legacy test-only TypeScript files; the obsolete Mongoose schema, health declaration and invalid action literal blockers are repaired, along with Sync Jobs log refresh.

Verification: both production builds pass; 92 API unit tests, 17 Python tests and 35 isolated PostgreSQL/Redis integration tests pass. The HTTP pipeline test continues through grounded scenario import, review, manual observation completion and stale-source refusal. Eight dedicated QA tests cover persistence, concurrency, result idempotency, revision gates, snapshots, cancellation, healing review and additive migration repeatability. An initial regression found that transformed DTO prototypes broke identical result retries; comparisons now normalize persisted JSON values and the retry test passes.

These tests use controlled connector/embedding outputs and human observation fixtures, not live-model/browser accuracy measurements. UI validation is compilation/typechecking, not a browser acceptance run. No application database was migrated or deployment performed. Authentication/tenant ACLs, independently verified artifacts, automated QAE/AUE worker dispatch, full review audit history and cost/accuracy evaluation remain release gates. This is a persisted **manual** QA lifecycle, not a claim that the whole autonomous platform is complete.

See [persisted-qa-workflows.md](persisted-qa-workflows.md) for contracts, migration, reproducible verification, known retry limits and the next harness phase.

## Working rules

- Preserve the existing working tree; no reset, automatic commit or wholesale rewrite.
- Record observed defects, focused fixes, exact verification commands and remaining risks.
- Separate implemented behavior from planned architecture and measured behavior.
- Deliver pipeline correctness before broader agent/product features.

## 2026-09-27 — Takeover baseline

Read `PRODUCT_DESIGN.md`, documentation indexes and pipeline descriptions; traced API ingestion, processing, extraction, retrieval, QA endpoints and Python agent/execution code.

Baseline validation: 21 API tests passed. API TypeScript compilation failed on existing provider interfaces, extraction types, unused Mongoose schema imports and E2E test issues. See [platform-audit.md](platform-audit.md).

## 2026-09-28 — Extraction accuracy and evidence

- Routed extraction through `grounded-extraction.ts`: exact quotes, UTF-16 spans, source/document identity, content and durable revision hashes. Proposals remain inferred, not automatically verified.
- Deliberately narrowed active publication to explicit rules, requirements, APIs and numeric facts; retained old broad extractors as inactive legacy code. Removed title-based skipping. Unsupported forms abstain rather than create unsupported structured claims.
- Added evidence/claim reconstruction at receipt admission and transactional publication, including JSONB key-order independence, tampered-content rejection and prevention of injected verification fields.
- Removed provider-error confidence fallback and silent configuration fallback. Added strict response/usage validation, disabled SDK retries, bounded document/candidate/time budgets, duplicate-before-validation handling and receipt/job usage summaries. No active explanation calls.
- Reprocessing removes stale automatic unverified proposals. Manual and reviewed items are preserved, including identity collisions; changed reviewed revisions receive a needs-review marker without overwriting original evidence.
- Added a 20-example synthetic corpus with explicit unsupported positives. Local results: 8 supported true positives, 0 false positives, 4 false negatives, 8 correct negative abstentions. Overall recall is 66.7%; this is a small regression fixture, not a production accuracy claim.

Verification: **62 API unit/simple tests and 23 isolated PostgreSQL/Redis integration tests pass**. Tests include source-span integrity, duplicate paid-call avoidance, budget exhaustion, provider transport/parse errors, forgery rejection, stale proposal lifecycle, manual identity preservation and prior pipeline recovery. The test-first contract initially failed because the new module did not exist; integration testing exposed JSONB key ordering, which was corrected. `git diff --check` passes. Full TypeScript compilation still fails on baseline legacy action-content, Mongoose and E2E diagnostics; no diagnostics match the new evidence/provider/pipeline test files. The Anthropic interface mismatch is fixed.

See [extraction-evidence.md](extraction-evidence.md) for exact accepted syntax, failure modes, rollout implications, evaluation commands and remaining work. No live paid-provider evaluation, organization corpus, retrieval ACL/citation work, evidence UI or production deployment is included. Existing broader proposals can disappear on reprocessing: review/export before rollout. The isolated test stack is stopped after verification.

## 2026-09-28 — Section-aware extraction coverage v2

- Added a pure candidate parser behind the existing grounded-extraction interface. It supports bounded unlabeled normative requirements, contiguous numbered workflows and a strict Given/When/Then scenario subset, while keeping old broad extractors inactive.
- Added exact per-field source spans for all six active types. Workflow steps and BDD expected outcomes are reconstructed from source text; no expected behavior or test verdict is invented. Canonical comparison handles nested JSONB key reordering without ignoring array order.
- Corrected nested excluded-section handling, mapped `test_case` to the provider's `testCase` contract, added block budgets and rejected ambiguous same-name claims before provider spending to avoid persistence overwrites.
- Bumped the extraction version to `grounded-sections-v2`, invalidating processing hashes and requiring fresh jobs after worker rollout. Existing review-preservation rules remain in force.
- Kept the original 20 corpus source texts and extended their declared supported scope: coarse type-level recall improves from 8/12 to 11/12 positives, with zero false positives on that fixture. Added 12 mixed/section documents with exact structured-content labels: 11/13 gold claims emitted, zero false positives; unsupported entity and unknown-actor examples remain explicit false negatives. These are synthetic regression results, not production accuracy estimates.

Verification: **83 API unit/simple tests and 26 isolated PostgreSQL/Redis integration tests pass**. New coverage includes malformed/incomplete scenarios, excluded sections, CRLF/Unicode spans, block budgets, provider type mapping, name collisions, real extraction through the worker, and rollback after persisted nested-field/outcome tampering. Five new contract tests initially failed against v1, then passed after implementation. `git diff --check` passes. Full TypeScript compilation still fails on documented legacy action-content/Mongoose/E2E diagnostics; no diagnostics match the new parser, evidence, corpus or integration-test files.

Documentation: [extraction-coverage-v2.md](extraction-coverage-v2.md) describes exact grammar, field transformations, evaluation denominators, failure behavior and rollout. Representative anonymized organization documents were requested but not supplied during this milestone. Entity parsing, broad natural-language extraction, retrieval ACL/citations, evidence review UI and organization budgets remain outstanding. No paid model calls or production deployment occurred; isolated test services are stopped after verification.

## 2026-09-28 — Scoped retrieval and end-to-end evidence handoff

- Required explicit source scope and applied source/type predicates before ranking. Excluded stale/unstamped chunks, validated vectors/options, bounded candidates, and included citation overhead in context limits.
- Added revisioned chunk quotes and hashes, a citation-resolution endpoint with stale-revision rejection, and distinct evidence/no-evidence/budget-exhausted responses.
- Added a deployment-scoped Python evidence client and registered its tool with QAE/AUE. It checks scope, quote integrity and exact context/citation correspondence; transport failures remain errors. This does not migrate or authorize the legacy agent tool surface.
- Added one cross-language HTTP test spanning source sync admission, Redis/Bull, real extraction, PostgreSQL publication, scoped retrieval, citation resolution, a separate Python tool process and a changed-revision re-sync. External connector and embedding outputs are controlled adapters, not live accuracy measurements.

Verification: **92 API unit/simple tests, 27 PostgreSQL/Redis integration tests and 17 Python tests pass**. The new test-first retrieval contract failed against the old implementation and passed after the fixes. The integrated fixture initially lacked the required document content hash; that fixture was corrected before rerunning successfully. `git diff --check` passes. The isolated test stack is stopped after verification; no application database was modified.

Full-product checks are **not green**: API production compilation exposes existing legacy action-content, missing unused Mongoose imports, unexported health declaration and old test-typing failures. Web compilation reaches type checking but fails at the pre-existing undefined `setLogs` reference in `SyncJobs.tsx`. These unrelated build defects were recorded rather than silently bypassed. Python emits existing LibreSSL/LangGraph warnings. Mock QA endpoints, authenticated organization authorization, real browser execution, review UI and a durable budgeted agent harness remain outstanding.

See [evidence-handoff-e2e.md](evidence-handoff-e2e.md) for API/configuration contracts, reproducible commands and the exact end-to-end acceptance boundary. Passing the evidence vertical slice is not a claim that the entire platform works end to end.

## Delivery backlog and gates (current status)

| Milestone | Status | Acceptance |
| --- | --- | --- |
| Repository audit | Written | Findings tied to implementation and explicit validation limits |
| Exact sync document scope | Initial fix implemented; unit verified | Deferred dispatch; only changed/selected IDs indexed and extracted |
| Durable pipeline recovery | Bounded-batch implementation; integration verified | Persisted dispatch intent, leases/receipts, atomic finalization, checkpoint and cancellation tests; see limitations below |
| Evidence and retrieval | Extraction v2 and source-scoped HTTP-to-agent handoff implemented | Field/chunk citations, revision resolution and integrated verification; authenticated ACLs and review UI outstanding |
| Shared QAE/AUE harness | Not implemented | Enforced budgets, structured plans, deterministic oracles, durable traces and review boundaries |
| Real QA workflows | Not implemented | Persistent cases/runs/findings, UI triggers real work, no implicit simulation |
| Organization onboarding | Not implemented | Identity/isolation/secrets, policy, CI integration and isolated acceptance environment |

The complete end-to-end platform is not yet delivered. The product design's page inventory is not a substitute for these gates.

## 2026-09-27 — First implementation slice

### Pipeline

- `DocumentsService.upsertDocuments` now supports explicit deferred dispatch and returns the exact changed document IDs. Existing webhook callers still dispatch immediately.
- `SyncProcessor` persists that manifest before dispatch. Its zero-work branch uses manifest size instead of the now-zero deferred queue count. Incremental mode controls connector options even without the legacy boolean.
- Manifest dispatch validates source ownership, deduplicates IDs and supplies stable per-job/document queue IDs. It no longer scans for all source documents without chunks.
- Extraction reads the same manifest, removing the source-wide 1,000-document selection. Old active jobs without a manifest fail with an instruction to start a new sync.
- Extraction and population failures now propagate instead of appearing as successful empty work. Item write errors and non-uniqueness relationship write errors propagate as well. Provider-internal fallback behavior remains a separate outstanding issue.

### Execution verdict integrity

- The executor rejects empty tests, unsupported empty steps, state/plan size mismatches and tests with no executable assertion.
- Missing/unknown tool status and timeouts cannot produce a passing step. Continuing after failure no longer produces an overall pass.
- Actual-result summaries describe executed calls instead of copying expected-result text. Assertion-to-requirement correctness still needs semantic evaluation; the presence of an assertion alone does not prove the right oracle was used.
- Missing runner test definitions no longer fall through to simulated outcomes. The QAE execution helper also stops instead of inventing a demo specification.
- The runner now fetches the specification and passes `test_spec` to the orchestrator; trace/aggregate fields use the actual execution-state contract. An MCP error is returned as an error instead of automatically rerunning through a second execution engine.

### Verification

- Before fixes, the deferred-dispatch regression observed one unexpected early queue call; the extraction-error regression resolved successfully despite a provider failure. Seven executor verdict regressions failed against the original executor. The runner regression reproduced invalid execution-state field access.
- `npm test -w apps/api -- --runInBand`: 30 tests passed in five suites after pipeline changes. Nine new tests exercise production document/processing/processor code with fake external dependencies; the other 21 predate this work.
- `PYTHONPATH=agents python3 -m unittest discover -s agents/tests -v`: ten tests cover execution fixes, including refusing a second execution engine after backend failure. Browser/provider/network behavior is mocked; this is not a real-browser or model-accuracy result. The environment emits existing LibreSSL and LangGraph dependency warnings.
- API TypeScript check still reports the baseline errors listed in the audit; the repeat check introduced no additional diagnostic categories or newly failing files.

### Compatibility and remaining risks

- Existing active sync jobs have no manifest: restart them with force reprocessing after workers are drained. Do not mix old and new workers for the same sync.
- The manifest stores IDs, not immutable revisions. Concurrent source mutation, source leases, receipt deduplication, durable dispatch/outbox, atomic chunk replacement and terminal-state fencing are still required.
- Queue job IDs reduce duplicate dispatch only while those queue records exist; they do not guarantee exactly-once effects after retention/cleanup or worker retries.
- A partially dispatched or failed batch requires explicit recovery; unchanged-content skipping is not yet aware of failed downstream processing.
- Source checkpoint publication, source status lifecycle, metadata-only changes, selective-not-found handling and source deletions remain open.
- QA APIs still return demo data; durable cases/runs and the complete AUE workflow remain open. These fixes do not establish an end-to-end production platform.

Next implementation contract: [platform-delivery-design.md](platform-delivery-design.md). The next substantial milestone is durable pipeline recovery, with restart/cancellation/retry tests against isolated PostgreSQL and Redis, before expanding agent autonomy.

## 2026-09-27 — Durable pipeline implementation

This entry supersedes the first slice's recovery limitations for version-1 jobs. Legacy pipeline files remain but their consumers are no longer registered.

- Added `PipelineStore`, `PipelineService`, `PipelineModule` and `SyncWork` records. Source API admission and webhook admission now persist requests before acknowledgement; a periodic dispatcher recovers work from PostgreSQL into the `pipeline` Bull queue.
- Added source-row admission locking, worker leases, heartbeat renewal, bounded attempts, persisted document snapshots and idempotent indexing/extraction receipts.
- Publication now atomically replaces documents/chunks, writes business knowledge, completes the job and advances the source checkpoint. Cancellation and stale leases fence late writes. Old published data remains available until replacement publication.
- Hash-based skipping now requires prior successful publication and includes metadata/title and processing configuration. Global checkpoints advance only for successful full/incremental connector jobs and use the discovery-start watermark.
- Added vector validation, operation timeouts, discovery limits, selective-not-found errors and pagination-loop detection.
- Added an additive, rerunnable SQL migration and a separate Docker Compose test stack. No existing development/production database was migrated or cleared.
- Retained reviewed business items instead of overwriting them; count preserved reviews and unresolved relationship endpoints explicitly.

Verification: all **21 integration tests pass**, using actual PostgreSQL transactions/locking, migration repeatability and Redis/Bull delivery. They cover concurrent admission, lost dispatch, expired/stale leases, receipt replay, cancellation during provider work, rollback, bounded retries, unchanged/title-only changes, processor-version cache invalidation, idempotent knowledge publication, checkpoint semantics, malformed vectors, pagination and a complete sync through Nest's registered Bull worker. The existing **30 API unit tests also pass**. `git diff --check` passes. The repeat TypeScript check reports the existing baseline failures, with no diagnostics in the new pipeline or integration-test files.

Scope limits: connector/model outputs in tests are controlled, not live accuracy evaluations; no OS-process kill or load benchmark was run. New writes are authoritative in PostgreSQL; graph projection, binary attachment storage, deletion/stale-fact reconciliation, a webhook backlog and streaming large-source ingestion remain outstanding. Webhooks during active sync are rejected rather than falsely acknowledged. Organization isolation and the full agent harness remain pending.

See [durable-sync-pipeline.md](durable-sync-pipeline.md) for exact lifecycle, limits, rollout and verification commands. Existing repository-wide TypeScript failures remain separately tracked; no production-readiness claim is made.

The isolated `qa-pipeline-tests` Docker stack is stopped after verification. No application server was deployed, and no production/source credentials were used. Next: resolve provider fallback and evidence/provenance semantics, establish extraction/retrieval evaluations, then implement shared QAE/AUE task budgets and durable run contracts.

## 2026-09-28 — Five-workstream bounded autonomy delivery

Follow-on stages documented in the evidence, QA, harness and browser runbooks precede this entry. The latest delivery adds a project-scoped control plane around approved suites, rather than granting legacy chat unrestricted organization access.

- Historical onboarding implementation: hashed scoped keys, deployment origin/target policy, project locking, and audited recovery via deployment bootstrap authority. Superseded on 2026-09-29 by the authenticated super-admin flow documented below; bootstrap enrollment/recovery is no longer supported.
- Execution: immutable approved suite snapshots, idempotent admission, quotas/claims, read-only pinned-address HTTPS probes, existing offline browser handoff, deterministic verdicts and fail-closed CI/JUnit. Worker-side secret references never enter suite manifests; selected scalar evidence must be non-sensitive.
- QAE/AUE: connects reviewed evidence-bound AUE plans to recurring execution; reports declared coverage gaps; maintenance revisions cannot remove checks or change approved oracles. General selector/code repair and root-cause diagnosis remain unavailable.
- Evaluation: labeled-corpus metrics/gates for false passes, missed defects, false failures, abstention/missing outcomes and measured execution-model cost. Added fixture-based GitHub Actions workflow; no external accuracy claim or hosted CI run.
- Operations: project pause/run cancellation, expiry without automatic replay, audit/attention summaries and explicit recovery instructions. External alerting, independent watchdogs and enterprise audit infrastructure are not claimed.

Final local verification: API and web builds pass; **92 API unit/simple + 74 integration + 47 Python = 213 tests pass**. Integration includes actual local TLS API calls, Python CI exit/JUnit, network-disabled Chromium and healthy/seeded-defect outcomes. A fixture TLS trust failure was resolved with explicit optional CA configuration while retaining verification. Regression assertions cover rejection of untrusted certificates, unsafe numeric oracles, missing evidence, tenant/role violations and assertion weakening. `git diff --check` passes.

The isolated PostgreSQL/Redis test stack is removed; unrelated containers and application databases were not touched. No deployment or commit was performed. See [autonomy-delivery.md](autonomy-delivery.md) for the delivered/pending matrix and [autonomy-operations.md](autonomy-operations.md) for configuration, endpoints, rollout and verification commands. This is a bounded autonomous pilot, **not a universal autonomous QAE/AUE replacement**; live browser workflows, mutating test-data lifecycle and real-project accuracy validation remain major acceptance gates.

## 2026-09-28 — Live workflows, recoverable mutations and project benchmarks

This extension supersedes the prior absence of a live-browser/test-data adapter, but does not claim general production autonomy or measured customer accuracy.

- Added deployment-allowlisted, hash-bound test/staging profiles and approved `live` suite checks. Server-derived verdicts require exact assertions, screenshot evidence and verified cleanup. Profile/oracle changes require explicit review, not automatic weakening.
- Added authenticated live Chromium execution while retaining Docker network isolation. A bounded standard-I/O bridge relays only exact authorized origin/method/path requests through DNS-pinned verified TLS. Credentials remain on the host; browser-supplied Authorization is ignored. Unsupported traffic fails closed.
- Added application-owned namespaced provisioning, durable pre-write SQLite intents, bounded execution and finally-based DELETE/absence verification. Pending cleanup blocks further live work. Cleanup-only recovery never replays provisioning/actions or rewrites terminal verdicts; independent server TTL remains an application-owner requirement.
- Added scoped benchmark collection with independently reviewed labels, explicit application-revision API checks, frozen suite hashes, deterministic request IDs, repeated trials and private atomic evidence checkpoints. Reports count false passes, misses, false failures, abstentions and instability, with sample-based confidence intervals and a separate real-project rollout gate.
- Added tests for cancellation, uncertain provision, crash-intent recovery, stale profiles, cleanup verification, missing artifacts, transport policies and resource deadlines. A teardown timing edge received a deterministic red/green regression: automatic Docker removal can precede CLI exit; bounded successful CLI completion is accepted, uncertain teardown is not.
- Verified actual authenticated HTTPS CRUD using a local staging fixture, real Chromium and PostgreSQL, including healthy/seeded-defect benchmark trials, cleanup failure/recovery and blocked external requests.

Final verification: **92 API unit/simple + 76 integration + 71 Python = 239 passing tests**; API build and `git diff --check` pass. Existing frontend code was not changed/rebuilt. Temporary diagnostic instrumentation was removed. No production database migration, deployment, hosted CI run or Git commit was performed. The isolated database stack is removed after verification; the rebuilt local browser image remains.

See [live-workflows.md](live-workflows.md) for the full contract, configuration, lifecycle endpoint responsibilities, recovery instructions, benchmark format, rollout criteria and verification. Real-project accuracy remains **unmeasured**: no authorized customer environment or independently labeled real-project corpus was supplied. General SSO/cross-origin flows, arbitrary mutations/production rollback and automatic live-profile generation remain outside this implementation.

## 2026-09-28 — Settings UI and durable benchmark collection

- Added a real Settings page and `/settings` deep link, independent of legacy workspace calls. Navigation remains available during workspace loading. Added project policy, credential access, reviewed workflows and benchmark sections using the existing visual system.
- Added a fixed same-origin gateway with a restricted route allowlist, bounded bodies, credential validation, no-store/private responses and HTTPS enforcement for non-loopback backends. Browser credentials stay in memory; disconnect/reload/revocation clear the session. Bootstrap and worker routes are not exposed through this gateway.
- Added owner-only name/quota updates and safe role-aware settings views. Credential inventory omits digests/secrets; issuance displays a one-time secret; actions remain backend-authorized and audited.
- Added immutable persisted benchmark definitions, owner approval, incremental project-locked admission, pause/resume, retained trial identities and server-derived reports. Concurrent collectors cannot replay a committed trial. Missing/revision-drift/flaky evidence never becomes passing accuracy.
- Added UI evidence export and `shared.harness.autonomy collect` for headless continuation of the same benchmark. Synthetic cohorts never pass the real-project rollout gate. Existing file-driven collection remains a separate mode.
- Added the additive/rerunnable `20260928-benchmarks.sql` migration and verified repeat application preserves data in an isolated schema. Production migration was not run.
- Exercised the complete browser path against real Next/Nest/PostgreSQL and TLS worker calls: invalid keys, project updates, issuance/revocation, suite review, cohort import/approval, pause, reload, resume without replay, measured outcomes, export, Member restrictions and expired/revoked-session clearing. Existing isolated live-browser and test-data recovery tests remain green.
- Resolved shared dev/production webpack output collision by introducing an isolated E2E build directory rather than stopping the user's dev server. Browser verification also drove explicit accessible select labels and complete disconnect-state reset. Batched benchmark evidence reads avoid parallel queries on one PostgreSQL transaction connection.

Verification: **92 API unit/simple + 81 integration + 72 Python = 245 passing tests**. API and isolated web production builds pass; web lint/type checks and `git diff --check` pass. Real Chromium was used for Settings, and existing Docker Chromium tests were retained. No production migration, deployment, hosted GitHub Actions run or commit was performed. The disposable test stack and test frontend processes are removed after verification.

See [settings-benchmarks.md](settings-benchmarks.md) for configuration, migration, UI workflow, security/role boundaries, collection semantics, endpoints and commands. Real-project accuracy is still unmeasured; no customer labels, credentials or live organization environment were fabricated.

## 2026-09-29 — Authenticated platform super-admin

- Replaced deployment bootstrap enrollment and recovery with a separate authenticated super-admin identity and guarded organization-management endpoints.
- Added `qa_super_admins` and unambiguous organization/super-admin sessions in `20260929-super-admin.sql`. Provision the initial account interactively with `npm run admin:create-super-admin -w apps/api`; the password is hidden and stored as a salted scrypt hash.
- `/admin` now requires a super-admin login. Organization creation requires the first admin email and creates an invitation; no unauthenticated enrollment path or deployment bootstrap key remains.
- Updated account, operations, and Settings documentation. Automated integration coverage now enrolls through a super-admin session and uses an invited user's session for project actions.
- Remaining security follow-up: super-admin MFA/SSO policy, recovery/rotation runbook, rate-limit/login alerting, and production security review.
# 2026-10-03 — Native meeting flow redesign

- Added native-call entry points in Chat and QAE/AUE chat views. Direct agent calls open the meeting immediately; groups use a participant/agent setup view.
- Added participant chips, per-agent role instructions, and a persisted transcript-sharing switch. The meeting API enforces the selected human roster and prevents transcript-based runs when sharing is off.
- Kept Teams/Google Meet scheduled calendar meetings separate; user-started calls submitted through the API must be native.
- Added a trusted GPT-Live opening instruction for the host greeting and sequential agent introductions. Current multi-agent audio intentionally uses one shared voice session.
- Added bounded client recovery and server-side confirmed-close/usage gates, capped at three sessions per meeting. Uncertain Live sessions do not auto-restart.
- Added additive migrations `20261007-native-call-participants.sql` and `20261008-meeting-voice-reconnect.sql`; documented behavior in `docs/meetings.md` and `docs/live-meeting-voice.md`.
- Validation: `npm run build -w apps/api`, `npm run build:settings-e2e -w apps/web`, and `git diff --check` pass. No tests were run.

## 2026-10-04 — Native call audio and end-to-end review

- Reproduced silent agent playback in a real Chromium/WebRTC fixture, then fixed local playback to use the incoming model stream directly. Kept the separate AI broadcast for other participants and excluded it from model input.
- Added actual microphone activity indicators, audio-driven agent activity, visible voice errors, startup cancellation, compact lobby sizing, and mobile controls that stay within the dialog.
- Made confirmed voice close idempotent, coordinated concurrent close requests, and corrected in-progress usage reporting. Fixed native meeting request replay across JSONB key ordering.
- Ended calls when the last human explicitly leaves; final shared transcript notes queue automatically. Added a transcript drawer, written notes, and a summary workflow with evidence review and approved publication.
- Ran a bounded real GPT-Live call with synthetic speech: heard the greeting, transcribed the login-testing question, received a relevant spoken answer, and generated real evidence-linked notes. Credentials remained server-side and no private user audio was used.
- Added focused browser and cleanup regression coverage. See [native-call-verification.md](native-call-verification.md) for commands, artifacts, scope, and remaining browser/provider limits.
- Final validation: 51 chat/meeting integration tests pass with the direct-call and two-browser native media checks enabled; one broader legacy chat/calendar browser wrapper remains skipped. API/web production builds and whitespace checks pass. The separate configured real-model voice/transcript/notes check passes.
