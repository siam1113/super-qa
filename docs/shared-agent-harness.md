# Shared QAE/AUE proposal harness

Implemented 2026-09-28. This is a durable, bounded **proposal harness**, not an autonomous browser/code execution sandbox. It is a separate entry point from the legacy conversational agents.

Follow-on implementation: [sandboxed browser execution](sandboxed-browser-execution.md) adds a separate operator-authorized offline execution capability. Proposal approval alone still does not authorize execution; live URLs and arbitrary generated code remain disabled.

The later [project autonomy control plane](autonomy-operations.md) adds scoped suite approval, CI and a separate read-only HTTPS API adapter. Browser/live-code restrictions in this document still apply; project keys do not grant deployment-level harness access.

## What works

The public interface is submit, status, cancel and review. One PostgreSQL-backed module owns admission, task snapshots, provider configuration, reservations, leases, attempts, cancellation, validation and reviews. A standalone Python worker serves both roles through the same implementation:

- **QAE:** proposes up to five structured cases. Each action, expected outcome and precondition must occur verbatim in the supplied source documents. Steps carry exact document/revision references.
- **AUE:** accepts an already approved case revision and proposes a locator/assertion plan. Every step must remain in order with its original action and expectation. Every step requires a `text_equals` assertion preserving the original expectation.
- Both outputs stop at `awaiting_review`. Approval records acceptance of a proposal, **not** permission to execute it. `executionAuthorized` is always false and `testVerdict` is always null.

No automatic code generation/execution, selector repair, shell, browser, source mutation or arbitrary model tools are enabled. The AUE plan's locators remain unverified and its expected strings may need domain-specific clarification before real automation can be generated. Requiring text equality is an intentionally narrow first schema, not a universal oracle language.

## Architecture

```text
operator CLI / trusted HTTP client
    → Nest HarnessModule
        → PostgreSQL harness_runs: frozen task/evidence/case/profile/prompt
        → claim: reserve usage, persist attempt + expiring ownership token
    ← Python worker polls (no Redis delivery dependency)
        → one bounded model call; no nested tools or provider fallback
        → strict JSON parsing
        → authenticated completion
    → server grounding / approved-oracle / current-revision validation
    → awaiting_review → approved | rejected
```

The module is registered in `AppModule`. Production entities are discovered by the existing TypeORM entity glob. `agents/shared/harness/worker.py` is a separate process; starting the existing FastAPI agent server does not implicitly start it.

Implementation seams:

- `harness.service.ts`: authoritative state transitions and accounting, injected `DataSource`.
- `harness-contract.ts`: versioned prompt and deterministic proposal validation.
- `harness.controller.ts`: separate operator/worker credential guards and DTO validation.
- `worker.py`: HTTP/model adapters. Tests inject a model fixture through the same worker implementation used for providers.

## Task and authority contract

Every task supplies a stable request UUID, workspace/application/environment, actor, role, objective, document revision references and budget. AUE additionally supplies `caseId` and `caseRevision`.

The deployment explicitly configures one workspace, one application, one environment and a source allowlist. The server reads document contents itself; callers cannot substitute quotes or source IDs. Evidence must match the current published revision and fit an 18 KB JSON bundle. Selected documents are frozen in the run, and both their revision and contents are rechecked before dispatch, proposal acceptance and review. AUE also rechecks the current approved case revision. Grounded cases must include their source reference.

Operator and worker keys must be distinct, at least 32 characters, and are required through `x-harness-key`. Missing configuration fails closed. Operator keys admit/read/cancel/review tasks; worker keys claim and complete them, but cannot approve proposals. No browser-delivered environment variable should contain these keys.

This is **deployment-scoped capability access, not organization membership/RBAC**. Actor/reviewer strings are self-declared labels. Existing QA, source and conversational routes have separate legacy authorization gaps. A trusted single-organization deployment is the only supported access model here; do not expose the overall application to untrusted organizations yet. Manual QA cases lack tenant ownership metadata; an operator selecting a manual approved case must ensure it belongs to the configured application.

## State, persistence and recovery

| State | Meaning |
| --- | --- |
| `queued` | Persisted task, not yet claimed |
| `running` | Model-call reservation and worker lease persisted |
| `awaiting_review` | Structurally valid, currently grounded proposal; still unverified |
| `approved` / `rejected` | Explicit operator review of proposal |
| `blocked` | Missing evidence, stale/revoked scope, invalid output or requested clarification |
| `failed` | Provider/transport failure, with no success substitution |
| `cancelled` | Operator stopped an active/reviewable run |
| `budget_exhausted` | Admission of another call or active work exceeds a budget |

Admission takes an advisory lock on the request UUID. Canonically identical task retries return the original run; changed input returns `409`. Preserve the UUID across transport retries; use a new UUID for an intentional new task. Idempotency is per task, not a global similarity cache.

Claims serialize through a PostgreSQL advisory lock and permit at most two active worker leases. A lease lasts at most 75 seconds and never exceeds the task deadline. Worker calls stop locally after 60 seconds or five seconds before lease expiry. There is no heartbeat extending a call indefinitely.

On a status read or claim, expired running attempts become `abandoned`. Their full reservations remain charged because provider usage may be unknown. Remaining budget can admit another attempt; old ownership tokens cannot overwrite the new attempt. A task allows at most three attempts/model-call reservations. No Redis queue must survive for recovery to work: queued state is in PostgreSQL and workers poll it.

Completion retries reuse the identical payload/token and never rerun the model. Cancel and completion serialize on the run row; late completion cannot publish after cancellation. Cancelling an awaiting-review run prevents approval. Worker cancellation polls at roughly two-second intervals; disconnecting a local provider request cannot guarantee cancellation of inference/billing at the provider.

Provider errors and invalid proposals terminate the current task rather than silently escalating, changing providers or rerunning weaker checks. Operators can submit a new task with revised evidence/objective. There is no process-level kill test in this release; recovery tests simulate expiry and recreate the service over real PostgreSQL.

## Economics and usage

Task budgets bound model-call reservations, aggregate input/output tokens, output tokens/call, wall time and configured monetary estimates. Maximums: three calls, 64,000 input tokens, 16,000 output tokens, 4,096 output tokens/call, 600 seconds and 10 USD of configured estimated cost per task.

Before dispatch, the server reserves input equal to UTF-8 prompt bytes plus 1,024 envelope tokens, the output cap, and their configured price estimate. This is a conservative **input estimate**, not provider-tokenizer measurement. Provider-reported input/output usage, when available, is recorded separately. Missing usage is never fabricated. Actual reported overage blocks publication and increases displayed charged accounting; this is not a provider-account billing limit and cannot undo charges already incurred.

Reservations are not refunded when usage is lower or unknown, keeping crash recovery conservative. Reported `charged` totals are maxima of reservations and reported usage, not a provider invoice. Price configuration uses integer nano-USD/token (1 USD = 1,000,000,000 nano-USD). The configured schedule/model/version is frozen on submission. Empty/missing prices fail configuration; an explicit `0` is permitted for local/no-charge inference. No current market price is hardcoded.

Python disables SDK retries for OpenAI/Anthropic at client construction and never wraps a call in another model retry or fallback. It sets temperature zero and an output limit; model compatibility must be tested for the configured model. Completion transport retries only replay the result. Prompts contain a bounded source bundle and one frozen case, not growing chat histories or hidden tool conversations. Raw responses/private reasoning are not persisted; validated proposals, attempt summaries and usage are.

These mechanisms constrain spend and reduce redundant work; they do **not** establish measured cost savings or high model accuracy. Source substrings establish provenance, not semantic correctness, completeness or absence of contradictory requirements. Human review remains necessary. Cross-task budgets/account quotas and benchmark-based model routing remain future work.

## Setup and rollout

1. Apply prior pipeline/evidence/QA migrations, then back up the database and apply:

   `psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f apps/api/migrations/20260928-shared-harness.sql`

   This additive transaction is rerunnable against its own schema. No application database was migrated during implementation. Preserve `harness_runs` when rolling back the application.

2. Configure the API from `apps/api/.env.example`:

   `HARNESS_OPERATOR_KEY`, `HARNESS_WORKER_KEY`, `HARNESS_WORKSPACE_ID`, `HARNESS_APPLICATION_ID`, `HARNESS_ENVIRONMENT`, `HARNESS_SOURCE_IDS`, `HARNESS_PROVIDER`, `HARNESS_MODEL`, `HARNESS_INPUT_NANO_USD`, `HARNESS_OUTPUT_NANO_USD`.

   Source IDs are comma-separated UUIDs. Provider is `openai`, `anthropic` or `ollama`. Use your own validated model and price schedule; there is no implicit model default for harness runs. Protect frozen prompts/source content with database access and retention policy, and approve transmission of selected source data to the configured model provider.

3. Build/start the API normally. On the worker host, set `BACKEND_API_URL`, only `HARNESS_WORKER_KEY`, and the chosen provider's credential or `OLLAMA_BASE_URL`. Start from the repository root:

   `PYTHONPATH=agents python3 -m shared.harness.worker`

4. On the operator host, configure only the operator key and backend URL. Create a task JSON file using actual document IDs and currently published revision hashes:

```json
{
  "requestId": "11111111-1111-4111-8111-111111111111",
  "workspaceId": "your-workspace",
  "applicationId": "your-application",
  "environment": "staging",
  "actor": "qa-owner",
  "role": "qae",
  "objective": "Propose checks supported by the login requirement",
  "evidence": [{
    "documentId": "22222222-2222-4222-8222-222222222222",
    "revisionHash": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
  }],
  "budget": {
    "modelCalls": 2,
    "inputTokens": 32000,
    "outputTokens": 4096,
    "outputTokensPerCall": 2048,
    "wallSeconds": 180,
    "costNanoUsd": 100000000
  }
}
```

The monetary budget in this example is 0.10 USD under the configured schedule, not a quoted provider price. For AUE, change the role and add the existing approved case UUID and integer revision. Placeholder IDs/hashes will correctly be refused.

```sh
PYTHONPATH=agents python3 -m shared.harness.cli submit task.json
PYTHONPATH=agents python3 -m shared.harness.cli status RUN_UUID
PYTHONPATH=agents python3 -m shared.harness.cli review RUN_UUID --decision approved --reviewer qa-owner
PYTHONPATH=agents python3 -m shared.harness.cli cancel RUN_UUID
```

The same interface is available at `POST /api/harness/runs`, `GET /api/harness/runs/:id`, `POST /api/harness/runs/:id/cancel`, and `POST /api/harness/runs/:id/review`. Worker routes are under `/api/harness/worker`. CLI submit does not automatically generate or rotate the request UUID, so retrying the same file remains idempotent.

## Verification and acceptance scope

```sh
npm run build -w apps/api
npm test -w apps/api -- --runInBand --silent
PYTHONPATH=agents python3 -m unittest discover -s agents/tests
docker compose -p qa-pipeline-tests -f docker-compose.pipeline-test.yml up -d --wait
npm exec -w apps/api -- jest test/integration/harness.test.ts test/integration/pipeline-recovery.test.ts test/integration/qa-workflows.test.ts --runInBand --silent
docker compose -p qa-pipeline-tests -f docker-compose.pipeline-test.yml down --volumes
```

Integration tests use disposable PostgreSQL/Redis on ports 55432/56379 and truncate test records; never repoint them at application data. Harness coverage includes credentials, scope, DTO validation, idempotency, concurrency, pre-call reservations, exhausted budgets, abandoned leases, cancellation, stale source/case revisions, completion retries, fabricated verdict rejection, weakened AUE assertions, reviews and migration repeatability. Both role journeys execute the real Python worker over real HTTP into PostgreSQL, replacing only model generation with a controlled fixture.

Verified results: API production build passes; **92 API unit tests, 26 Python tests and 51 integration tests pass**. These totals include 16 harness integration tests and nine harness Python tests. The operator CLI help command and `git diff --check` also pass. Existing Python LibreSSL/LangGraph dependency warnings remain; they did not fail the tests.

No live paid provider call, browser execution, semantic accuracy benchmark or production deployment was performed. Legacy chat/task routes still use their previous agent graphs and are **not** protected by these harness budgets. Use the new CLI/HTTP entry point for bounded work; migrating chat orchestration requires a task scope/approval UX rather than silently inventing authority from chat text.

## Next release gates

- Tenant-authenticated task submission, source/case ACLs, membership-based reviewer identity and global organization quotas.
- Reviewed proposal promotion to versioned QA cases/automation artifacts. Current harness approval does not create cases, edit repositories or mark manual executions passed.
- Isolated, allowlisted browser/code execution with artifact capture, deterministic assertion evaluation and no weakened or skipped oracles; connect this through a separate worker capability contract.
- A richer typed assertion language, authoritative DOM/locator evidence, QAE/AUE evaluation datasets and measured accuracy/abstention/cost per accepted artifact.
- Pagination/retention and load tests for the run ledger. Current claim scans active tasks under a dispatcher lock and is intended for a small pilot, not a high-throughput scheduler.
