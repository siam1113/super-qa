# Persisted QA workflow and production builds

Delivered: 2026-09-28. Supersedes earlier build-blocker and mocked-QA findings. This is **not** autonomous or multi-tenant production readiness.

## Supported path

`source sync → grounded scenario → imported draft → explicit review → immutable manual run → reported step observations → persisted verdict/dashboard`

Alternatively, author a manual draft. PostgreSQL now owns cases, runs, execution snapshots and healing decisions; MongoDB is not required. Importing copies source knowledge into a separate QA case rather than treating extracted prose as executable automation.

The Test Cases screen supports create/import, review, run planning, pending-run selection, observation submission and cancellation. Dashboard executions open their observations; pending healing suggestions open a review form. API failures show errors rather than substituting demo data. JSON fields are an initial operator interface, not the final onboarding UX.

## Storage and invariants

| Table | Responsibility |
| --- | --- |
| `qa_test_cases` | Current steps/preconditions, revision, review and optional source revision |
| `qa_runs` | Manual admission, client request UUID and normalized request hash |
| `qa_executions` | Frozen case snapshot, pending/terminal status and reported observations |
| `qa_healing_suggestions` | Locator proposals and review decisions, not applied patches |

- New/imported cases are drafts. Every selected case must be approved before run admission.
- Edits require the current revision, increment it and reset approval. Historical execution snapshots stay unchanged.
- Imported actions, expectations and preconditions retain their source revision. Grounded steps cannot silently change under that provenance; create a manual case or import a new proposal.
- Review, run admission and result submission check the currently published document revision under a transaction lock. Changed/deleted evidence returns `409`. Completed observations remain historical records.
- Run creation locks the request UUID. Identical normalized case IDs/environment/browser return the original run; changed input under the same UUID returns `409`. Clients must retain the UUID across transport retries. Omitting it creates a new request.
- The browser currently creates a new UUID per click. After an ambiguous transport failure, inspect pending runs before clicking again; browser retries are not durable across reloads. Case creation/import is not idempotent.
- Run planning persists pending records and dispatches **no automated worker**. It never invents passing results.
- Results require reporter, duration and one actual observation plus evidence reference per step. Any failed step makes the verdict failed. Identical retries succeed; conflicting terminal rewrites fail.
- Cancellation and result submission lock the run first. Cancellation changes only pending executions and does not erase completed results.
- Manual evidence references are operator-supplied text, not uploaded or independently validated artifacts. A passing manual verdict is not an AI-verified claim.
- Healing approval returns `applied: false`; no code or locators are changed.
- Pass rate derives from completed passed/failed observations. Missing confidence, coverage and trends remain unknown.

## HTTP contract

All paths below use `/api/qa`. DTOs and UUID parameters are validated; unknown DTO fields are rejected.

| Method/path | Input / behavior |
| --- | --- |
| `POST /test-cases` | `{title,steps:[{action,expected}],preconditions?:string[]}`; optional priority/owner/flow/risk/tags |
| `POST /test-cases/import/:businessItemId` | Import a current grounded scenario |
| `PUT /test-cases/:id` | Required title, steps and current revision; optional metadata |
| `POST /test-cases/:id/review` | `{revision,status:"approved" or "rejected",reviewer}` |
| `POST /runs` | `{requestId?:UUID,testIds:UUID[],environment?:string,browser?:string}` |
| `GET /runs/:id` | Run/snapshots; awaiting_results, completed or cancelled |
| `POST /runs/:id/cancel` | Cancel pending executions |
| `POST /executions/:id/result` | `{reporter,duration,steps:[{actual,passed,evidence}]}` |
| `POST /healing` | `{issue,affectedTests:UUID[],currentLocator,suggestedLocator,rootCause?,owner?}` |
| `POST /healing/:id/approve` or `/reject` | `{reviewer}`; records decision only |
| `GET /workspace`, `/dashboard`, `/test-cases`, `/executions`, `/healing` | Persisted records and derived aggregates |

Limits: 100 selected cases/run, 50 steps/case, 50 observations/result. Duration is seconds, 0–86400. Submission order must match snapshot step order.

## Migration and rollout

1. Back up the target database; install prior pipeline/evidence migrations first. Do not point test commands at an application database.
2. Drain/restart API instances together for the QA contract change. Demo IDs are not real UUID executions and should not be migrated as history.
3. Apply `psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f apps/api/migrations/20260928-persisted-qa.sql`. The additive transaction is rerunnable against its own schema, not a general schema-drift repair tool.
4. Build API/web and start with `NODE_ENV=production`; set `NEXT_PUBLIC_API_URL` at web build time. Production TypeORM synchronization is disabled. Development may auto-create tables; deployed environments should use explicit migrations.
5. Check empty workspace, draft creation, approval, planning, observations and persistence after reload. Import a scenario from a completed sync and review its preconditions.

No application database was migrated during implementation. Migration repeatability was tested twice in an isolated schema with record preservation. Preserve the additive tables/history if rolling the application back; do not automatically drop QA records.

## Build repairs

- API `tsconfig.build.json` compiles only `src`, with `rootDir: src` and `noEmitOnError`; output matches `node dist/main.js`. Old test-only TypeScript errors no longer block production compilation. This does not claim all legacy test files typecheck.
- Removed the unused Mongoose schema, exported the health return type needed by declaration emit, and changed an invalid legacy action type to supported `custom`.
- Sync Jobs events now increment a selected-log revision instead of calling an out-of-scope `setLogs` function.
- Removed mocked workspace fallback, hardcoded dashboard analysis and unsupported test-library action buttons. Other unfinished platform areas remain outside this slice.

## Verification

```sh
npm run build -w apps/api
npm run build -w apps/web
npm test -w apps/api -- --runInBand --silent
PYTHONPATH=agents python3 -m unittest discover -s agents/tests
docker compose -p qa-pipeline-tests -f docker-compose.pipeline-test.yml up -d --wait
npm exec -w apps/api -- jest test/integration/pipeline-recovery.test.ts test/integration/qa-workflows.test.ts --runInBand --silent
docker compose -p qa-pipeline-tests -f docker-compose.pipeline-test.yml down --volumes
```

Integration tests truncate the isolated database on port 55432 and use isolated Redis on 56379. Never repoint them at an application database.

Results: both production builds pass; **92 API unit, 17 Python and 35 integration tests pass**. The eight QA integration tests cover validation/review gates, concurrent idempotent admission, terminal result retries, snapshots, cancellation, stale evidence, healing decisions, service recreation and migration repeatability.

The existing HTTP pipeline test now also imports a real extracted scenario, reviews it, completes a manual run, and refuses a new run after source revision changes. Scoped retrieval and the Python evidence-tool call remain covered. PostgreSQL, Redis, Nest routing and local extraction are real; connector/embedding outputs and manual observations are controlled fixtures. These are not live-model accuracy, real-browser execution, UI interaction or load-test results. UI validation is a production build/typecheck only.

## Next release gates

1. Authenticated organization/project boundaries and source ACLs. Reviewer/reporter names are self-declared; approval is workflow state, not a security boundary. Do not expose these APIs to untrusted users.
2. Shared QAE/AUE harness: bounded budgets, durable worker dispatch/leases, sandboxed tools, executable assertions, owned artifacts and independent verification. Automated workers need a distinct authenticated result contract, not the human observation endpoint.
3. Append-only review/edit audit history, pagination, source deletion reconciliation and retention. Current cases store latest review plus historical run snapshots, not every edit/review event.
4. Live-provider/browser acceptance and labeled accuracy/cost evaluations. No success-rate or cost-saving percentage is established.
5. Onboarding forms, proposal discovery, artifact uploads and validated healing patches with rollback before enabling application of changes.
