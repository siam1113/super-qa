# Super QA platform audit

Date: 2026-09-27. Baseline: the working tree, including existing uncommitted work, before takeover changes. This is a repository architecture and implementation audit, not a penetration test or a measured accuracy evaluation. No production credentials or customer systems were used.

## Verdict

The direction is useful, but the platform is currently a prototype with real ingestion and browser-execution components, not an enterprise QA replacement. The biggest issue is trustworthiness: successful-looking UI and execution outcomes are not consistently backed by completed, durable work. Fix that before adding more agent capabilities or dashboards.

`PRODUCT_DESIGN.md` is primarily a UI/product interaction specification. It does not define the operational contracts needed for autonomous QA: what constitutes sufficient evidence, when an agent must abstain, what it may change, what a release gate means, or how organizational boundaries work. Those contracts must accompany implementation.

The strongest first product promise is: connect one application's sources, approve grounded requirements and tests, execute against an approved environment, and produce reproducible findings with evidence. Organization-wide quality requires expanding that verified loop, not merely expanding the sitemap.

## What exists and is worth keeping

| Area | Observed implementation | Assessment |
| --- | --- | --- |
| Web workspace | Next.js shell, navigation, inspectors, source and business-item screens, sync events | Useful review surface; distinguish real and demo data |
| Integration ingestion | GitHub, Jira, Confluence connector implementations | Useful initial scope; advertised integration types exceed implemented connectors |
| Background processing | NestJS, Bull, Redis, PostgreSQL documents/chunks/jobs | Sensible foundation; lifecycle and retry correctness need repair |
| Knowledge extraction | Typed business items, provider interface, validators, relationships | Reusable concepts; extraction quality is not established by heuristic confidence |
| Agent orchestration | Python LangGraph QAE, AUE and SuperQA graphs | Useful routing skeleton; prompts are broader than implemented capabilities |
| Execution | Playwright tool wrappers, interpreter/executor/orchestrator, traces and artifacts | Real execution building blocks; verdict integrity is presently unsafe |
| Storage | PostgreSQL, object storage and graph integration | PostgreSQL plus object storage should anchor durable evidence |

## Prioritized findings

### P0 — Success can be reported without real QA execution

Evidence: `apps/api/src/modules/qa/qa.service.ts` returns mock dashboard metrics, test cases, executions, facts and flows. `runTests()` returns a queued-looking response without scheduling execution. Healing approval/rejection returns success without persistence.

Evidence: `agents/shared/runner/service.py::_execute_single_test` falls back to simulated execution when no test file exists. `agents/qae/harness/interpreter.py::_create_generic_tool_calls` can return an empty list for an unsupported step; `executor.py::execute_step` then marks the step passed through the empty loop's `else` branch. It also copies the expected result into the actual result.

Impact: users can trust a green verdict that has no supporting observation. This directly undermines the product's central promise.

Required: persist real test/run records; return explicit unsupported/error outcomes; separate demo mode; require executable assertions and evidence for passing test verdicts. Never substitute expected text for observations.

### P0 — Organization isolation and authorization are missing foundations

Evidence: `apps/api/src/app.module.ts` registers a throttling guard, not an identity/authorization guard. Source and document entities have no workspace ownership field; source configuration includes tokens in a JSONB column. `SourcesService.findAll/findOne` returns entities containing configuration. Retrieval searches across chunks without tenant restrictions.

Impact: this cannot safely host multiple organizations. Rate limiting and CORS do not establish authorization. Source secrets also need redacted response DTOs and encrypted or referenced storage.

Required: identity, memberships, workspace-scoped queries and database constraints, permission checks, secret references, audit events, and isolated worker/browser execution. Test two organizations with identical external IDs and prove no cross-access through retrieval, events, artifacts or agent tools.

### P0 — Sync scheduling is inconsistent with its own documented contract

Evidence: `sync.processor.ts` calls `upsertDocuments(..., undefined)` intending to defer queueing. `documents.service.ts::upsertDocuments` always queues, even without a sync job ID. The processor then separately queues every source document lacking chunks. Workers can therefore index before job metadata exists, duplicate work, or include unrelated documents.

Impact: missing progress, duplicate embeddings/chunks, selective-sync leakage and unnecessary cost.

Required: explicit deferred dispatch, a manifest of changed document IDs, dispatch only that manifest after metadata is committed, and transactional/outbox recovery for database-to-queue delivery. Missing chunks are not a reliable job-membership model.

### P0 — Completion, retry and cancellation are not durable state machines

Evidence: `ProcessingService` uses process-local sets/maps and increments completion counters without a per-document receipt. It invokes the entire extraction/population phase from the last indexing worker. `SourcesService.completeJob` unconditionally writes completed status; stage and metadata updates mix read/modify/save and direct SQL. `SyncProcessor` marks a source connected while its downstream stages still run. Pending `newSyncState` is stored in job metadata, but `completeJob` does not publish it to the source.

Impact: retries can overcount, multiple workers can start the next phase, cancellation can be overwritten, and a restart can strand work. Incremental checkpoints are not reliably committed after successful downstream work.

Required: persisted document-stage receipts with uniqueness, conditional transitions, durable stage dispatch/outbox, source lease and generation fencing, cancellation checks at mutation boundaries, and transactional finalization. Advance incremental watermarks only after complete success; selective sync must not advance a global source watermark.

### P1 — Extraction ignores sync scope and can hide failures

Evidence: `ProcessingService.startExtractionPhase` fetches the first 1,000 documents for the source instead of the documents in the current job. Extraction failures are caught and turned into empty results both there and in `BusinessExtractionService.extractFromDocument`; item persistence failures are logged and skipped.

Impact: selective/incremental jobs pay to re-extract unrelated documents; large sources are truncated; failed extraction can appear indistinguishable from a legitimate absence of facts.

Required: document/version-scoped extraction; explicit empty, succeeded, failed and abstained outcomes; bounded retry; persisted provenance; no successful stage after unreported partial failure.

### P1 — Retrieval is neither scoped nor scalable

Evidence: `RetrievalService.search` accepts `sourceIds` and `documentTypes` but does not use them. `DocumentsService.searchByEmbedding` loads all chunks and computes similarity in JavaScript. Embeddings default to the local hash-based provider; chunks lack an enforced embedding-model version contract.

Impact: irrelevant context, inaccessible-source leakage once permissions exist, inconsistent rankings across model changes and memory growth with the corpus.

Required: enforce filters before ranking, workspace ACL predicates, pgvector indexing, embedding model/dimension/version tracking, lexical plus semantic retrieval, bounded context and source citations. Benchmark retrieval against labeled questions before calling it accurate.

### P1 — QAE/AUE are conversational loops, not validated engineering workflows

Evidence: `agents/qae/agent.py` and `agents/aue/agent.py` repeatedly invoke a model and tools. `agents/shared/llm.py` has optional output limits but no task-level usage ledger. The AUE prompt promises runnable automation; a prompt and code-generation helper do not establish a checked-out repository, compile/test validation, or reviewable patch lifecycle. Sessions and runner state include in-process storage.

Required QAE contract: requirement evidence → risk/coverage plan → structured test with preconditions and explicit oracle → review → persisted version → execution evidence → classified finding.

Required AUE contract: approved test → repository/environment inspection → minimal automation patch → static checks → sandboxed execution → evidence-backed review proposal. Locator healing must preserve the original oracle and remain reviewable.

Required shared harness: durable run state, tool schemas, capability policy, time/token/tool-call budgets, bounded context, cancellation, typed outcomes, and replayable traces. Separate model proposals from deterministic validation and external writes.

### P1 — Browser context and retry behavior need stronger isolation

Evidence: `TestOrchestrator` stores one interpreter on a global orchestrator. It parses a test before fetching and setting contextual locators; `TestInterpreter.set_locators` accumulates mappings. Business-context fetching is broad rather than test-scoped. `TestExecutor` retries errors by message substring, including actions that may have already changed application state.

Impact: stale locators, cross-run contamination and repeated non-idempotent actions. A retry that passes must not erase the first failure or be counted as a stable pass.

Required: per-run interpreter/context, explicit environment resolution, scoped grounding before interpretation, safe retry policy, isolated browser state, fixture cleanup and separate flaky verdicts.

### P1 — Verification does not support production-readiness claims

Observed command: `npm test -w apps/api -- --runInBand` passes 21 tests across two suites. These test simple behavior and mocks, not the complete production sync/execution loop.

Observed command: `./node_modules/.bin/tsc --project apps/api/tsconfig.json --noEmit --incremental false` fails before takeover changes. Examples: missing Anthropic `generateExplanation`, incompatible action type, missing Mongoose dependencies, and incomplete/incorrect E2E test types.

The E2E suite overrides string provider names while production injects classes and constructs connectors directly. Some E2E suites have uninitialized dependencies. They need repair before their names can be treated as evidence of coverage. No live provider accuracy, browser suite, restart recovery, load or security evaluation was established by this audit.

### P2 — Documentation is ahead of implementation

`docs/sync-pipeline.md` calls the system production-grade and supplies throughput/accuracy numbers without a reproducible benchmark. It describes BullMQ while implementation imports Bull. Its architecture and recovery descriptions conflict with source behavior. `docs/README.md` links to uppercase filenames that do not match the repository's lowercase filenames. GitHub connector documentation describes broader code ingestion than the issue/PR fetch implementation inspected here.

Required: label designed versus implemented versus verified behavior; cite measured benchmark artifacts; keep a change log and executable acceptance checks alongside architectural prose.

## What is extra or premature

These are sequencing judgments, not instructions to delete existing work.

| Investment | Value now | Decision |
| --- | --- | --- |
| Twenty extraction types on every document, plus candidate validation/explanation calls | Broad output without demonstrated precision; potentially many provider calls | Route by document type and requested task; measure before expanding |
| Neo4j duplicating relationships already represented in PostgreSQL | Additional consistency and operating burden | Keep optional until a graph traversal benchmark justifies it |
| Proposed MongoDB QA storage | Another persistence model before the run contract is durable | Prefer PostgreSQL for initial test/run/evidence metadata |
| Multiple execution modes plus simulation fallback | More paths to validate, misleading fallback semantics | One supported deterministic execution contract; isolate demo behavior |
| Large integration gallery and enterprise dashboard breadth | Useful design direction, weak evidence of delivered workflows | Clearly identify unsupported connectors/pages; prioritize one real vertical slice |
| Fine-grained SSE logging and in-memory batching optimizations | Visibility is useful, but cannot compensate for wrong lifecycle state | Preserve events; derive them from authoritative persisted transitions |
| Auto-healing and confidence badges before accuracy evaluation | May hide product regressions and imply calibrated probabilities | Proposal-only healing; provenance and validation results before confidence scores |

## Missing factors that determine success

1. An onboarding contract: application boundaries, approved environments, roles, source authority, test users/data, critical journeys, quality objectives and allowed actions.
2. A versioned evidence model: source revision → fact/proposal → reviewed requirement → test version → automation revision → run → assertion/artifact → finding.
3. A reliable test oracle: independently specified expected behavior, executed assertions, and explicit blocked/unsupported outcomes when evidence is insufficient.
4. A feedback loop: review decisions, false-positive labels, defect escape analysis, flaky-test quarantine and regression evaluation before prompt/model changes ship.
5. Durable execution and recovery: bounded jobs, cancellation, restart replay, idempotent side effects, cleanup and environment isolation.
6. Real CI/repository integration: change impact, required checks, reviewable automation PRs and release evidence linked to commit/environment identity.
7. Data lifecycle: source deletions, permission revocation, stale fact invalidation, retention/deletion and artifact redaction.
8. Measurable economics: provider usage per job/stage, cache effectiveness, cost per verified fact and executable test, and latency/accuracy tradeoffs.

## Accuracy and cost acceptance criteria

Do not target an unsupported single “accuracy %.” Build a versioned, labeled local corpus and publish denominators and failure examples.

| Layer | Measure | Initial gate |
| --- | --- | --- |
| Pipeline | lost/duplicate effects, recovery, checkpoint correctness | zero known violations in deterministic failure/replay fixtures |
| Extraction | evidence-supported precision, recall, contradiction/abstention | every accepted fact has a resolvable source span; benchmark precision/recall before selecting thresholds |
| Retrieval | relevant evidence recall@k, permission leakage | zero unauthorized results; record recall baseline on labeled questions |
| QAE | requirement coverage, executable oracle rate, false passes | no pass from empty/unsupported execution; each approved case has an explicit oracle |
| AUE | compile rate, first-run success, oracle preservation | generated artifacts pass configured checks and preserve expected behavior |
| Execution | seeded-defect detection, false failures, flake rate | detect known failing controls; distinguish infrastructure failure from product defect |
| Economics | actual input/output usage, calls, duration per accepted artifact | hard per-task budgets; compare configurations on the same corpus |

## Recommended delivery order

1. Restore trustworthy pipeline scope and outcomes; add regressions before widening functionality.
2. Add durable manifests/receipts/outbox and verified recovery/checkpoint semantics.
3. Ground and evaluate extraction/retrieval with versioned evidence.
4. Build QAE/AUE around a shared bounded harness and deterministic execution contract.
5. Replace demo QA APIs with persisted test/review/run/finding workflows and connect the UI.
6. Complete organization isolation, secrets, policy, CI onboarding and operational verification before external onboarding.

Track delivered changes and unresolved work in [implementation-log.md](implementation-log.md). This audit is the baseline; it must not be mistaken for a claim that the findings are all fixed.
