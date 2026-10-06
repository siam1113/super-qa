# Bounded autonomous QA: operator runbook

For the subsequent opt-in live-browser/data-lifecycle adapter and run-linked benchmark collector, see [live-workflows.md](live-workflows.md). The read-only/offline restrictions below describe the original adapters; they remain unchanged rather than being bypassed.

The scoped `/settings` UI and durable UI/headless benchmark continuation are now documented in [settings-benchmarks.md](settings-benchmarks.md). That page works under lockdown; other legacy unscoped screens remain blocked. Apply the additional benchmark migration before using collection.

## Scope and trust

The runtime executes pre-approved suites without a model call on every run. QAE/AUE proposal generation continues through the existing evidence-bound, budgeted harness. Approval is not proof of correctness: reviewers must verify requirements, selectors, test data, permissions and oracles.

Supported execution:

1. Offline trusted static web bundles through the existing Docker/Chromium sandbox. Fresh browser/container state supplies isolation and cleanup; the executor removes its own container. The app cannot reach live services.
2. Explicit HTTPS GET endpoints returning a bounded JSON scalar selected by JSON Pointer. No redirects, query strings, request bodies, custom methods, arbitrary headers, retries of probe execution, or code evaluation.

GET alone does not prove absence of side effects. The environment owner must approve semantically read-only endpoints and non-sensitive oracle fields. A compromised trusted runner can lie about its observations; credentials authenticate the runner, not cryptographically attest the host. Use managed, least-privilege runner hosts and network egress controls. Browser workers also remain trusted evidence producers. Do not advertise universal defect detection.

## Deployment and lockdown

Apply existing pipeline/QA/harness/browser migrations first, then `apps/api/migrations/20260928-autonomy.sql`, using your normal reviewed database migration process. The new SQL is additive and rerunnable. No application database was migrated during implementation. Production disables TypeORM synchronization; never enable synchronization as a migration strategy.

Backend configuration:

```dotenv
AUTONOMY_LOCKDOWN=true
AUTONOMY_ALLOWED_ORIGINS=["https://staging.example.com"]
```

Use TLS at the API ingress, restrict database access to platform operators, redact authorization headers and request bodies in proxy logs, and keep all keys out of frontend/public environment variables. Create platform super-admins out-of-band with `npm run admin:create-super-admin -w apps/api` after applying the identity migrations. No deployment enrollment key is configured or accepted.

**Compatibility change:** `NODE_ENV=production` enforces lockdown by default; `AUTONOMY_LOCKDOWN=false` is a deliberate, explicit opt-out that does override production (added so a single-tenant dev/staging deployment can still run the legacy UI — see "Turning lockdown off" below). An *unset* `AUTONOMY_LOCKDOWN` in production stays locked; only the literal string `false` opts out. In development, `AUTONOMY_LOCKDOWN=true` enables it. Lockdown blocks legacy unscoped source, QA, retrieval, chat and other controllers. Only the guarded autonomy/harness controllers and health controller remain reachable. The legacy frontend therefore does not operate as a project-scoped UI in this mode. Do not expose separate legacy Python chat servers publicly. This is an intentional boundary, not an enterprise RBAC retrofit of old routes.

### Turning lockdown off

`AUTONOMY_LOCKDOWN=false` in `.env` (read by `docker-compose.prod.yml`, defaults to locked if unset) unlocks the legacy routes — Sources, QA workspace, Environments, Chat, Agents tasks — even under `NODE_ENV=production`. Nothing else about production behavior changes: TLS-only cookies, disabled TypeORM `synchronize`, and the HTTPS-invitation-link check all stay as-is.

**Why this is unsafe for more than one tenant:** the legacy tables (`sources`, `qa_test_cases`, `qa_runs`, `qa_executions`, `environments`, chat tables, etc.) predate the per-project model and have **no `projectId` column at all** — confirmed by inspecting the entities, not just an unenforced check. It isn't that scoping exists and the lockdown guard was the only enforcement; there is no tenant dimension in the data itself. With lockdown off, every session — from any project, if more than one ever exists on the deployment — reads and writes the same global, unpartitioned pool of rows. Safe only for a deployment that is genuinely single-tenant for its entire lifetime; becomes a real cross-tenant data leak the moment a second isolated org is created on the same deployment.

**Options, if a deployment ever needs both the legacy feature set and more than one tenant** (roughly increasing effort):
1. **Policy only, no code change.** Keep `AUTONOMY_LOCKDOWN=false` exclusively on deployments that will only ever have one tenant; keep lockdown on anywhere multiple orgs might share a deployment.
2. **One deployment per tenant.** Separate Docker stack (same compose file) per customer instead of one shared multi-tenant stack. Infra-level isolation instead of app-level; no code changes, higher hosting/ops cost per tenant.
3. **Retrofit real tenancy onto the legacy tables.** Add `projectId` to every legacy table (a dozen+), migrate existing rows, and scope every query by the caller's project — the same pattern `ProjectGuard` already applies to the autonomy routes. A real multi-entity migration plus an audit of every service method touching these tables.
4. **Same migration as #3, enforced through a shared layer** (interceptor / base repository that auto-injects the project filter) instead of hand-editing each service method — centralizes enforcement so a future query can't forget to scope itself, at the cost of more upfront design work.

None of options 2–4 are implemented. Recommendation if this becomes real: prefer #1/#2 until a second tenant actually needs the legacy feature set; only invest in #3/#4 once that's a concrete requirement, not speculatively.

Existing harness operator/model-worker/browser-executor keys remain deployment-level privileges. They must never be handed to project CI jobs or model prompts. Browser proposal scope is still one configured `HARNESS_WORKSPACE_ID` / `HARNESS_APPLICATION_ID` / `HARNESS_ENVIRONMENT` per deployment. Use separate deployments for distinct browser harness scopes until ingestion/proposal tenancy is implemented. API-only projects have their own stored scope and keys.

## Enrollment and credentials

All paths below are relative to `/api`. Super-admin routes require an authenticated `qa_session` cookie. Project API requests use `Authorization: Bearer <project-key>`; project browser sessions are also accepted by guarded project routes.

`POST /auth/super-admin/organizations`:

```json
{
  "name": "Staging pilot",
  "adminEmail": "admin@example.com",
  "workspaceId": "example-org",
  "applicationId": "example-app",
  "environment": "staging",
  "origins": ["https://staging.example.com"],
  "targets": [],
  "requirements": ["health-contract", "login", "logout"],
  "dailyRunLimit": 20
}
```

Origins must match the deployment allowlist exactly, with no trailing slash, credentials or path. Targets must already be configured as approved bundle hashes in `HARNESS_EXECUTION_TARGETS`. Requirement IDs are a human-approved catalog, not auto-discovered completeness guarantees.

The authenticated `/admin` UI asks only for an organization name and its first app Owner's email. The service generates internal project scope/defaults and sends that Owner an expiring invitation. Once accepted, the user signs in with a password and receives a session; no API key needs to be shared for browser access.

`POST /autonomy/keys` accepts `{"role":"runner","label":"staging runner","days":7}`. Expiry is 1–90 days. Keys are individually revocable with `POST /autonomy/keys/:id/revoke`. Rotate before expiry. Keep issued key IDs in administrative inventory; issuance/revocation IDs are also in audit records.

Human app roles are Owner, Admin and Member. CI and runner are machine credential scopes.

| Credential scope | Allowed actions |
| --- | --- |
| owner | Read, issue/revoke keys, manage organization/app settings and membership, add apps, draft/approve suites, start/cancel runs, pause/unpause |
| admin | Read, update current app settings, pause/unpause, draft suites, start/cancel runs; cannot manage organization/app membership or credentials, add apps, or approve suites |
| member | Read project overview and run status only |
| ci | Machine credential: read project overview/run status and start approved suites |
| runner | Machine credential: claim project work, read project run status, dispatch browser checks, report API observations |

Every service action rechecks revocation, expiry and role after acquiring the project lock. Project IDs derive from the credential, not request bodies. Cross-project run lookup returns not found. Results require both the lease token and the exact runner credential that claimed the run.

## Suite creation, automation and maintenance

`POST /autonomy/suites` creates an immutable draft manifest:

```json
{
  "name": "staging smoke",
  "checks": [
    {
      "id": "health",
      "requirement": "health-contract",
      "kind": "api",
      "origin": "https://staging.example.com",
      "path": "/health",
      "expectedStatus": 200,
      "pointer": "/ok",
      "expected": true
    }
  ]
}
```

The API oracle is exact status plus exact scalar equality. Expected status must be 2xx. Expected values are boolean, safe integer (absolute value at most 9,007,199,254,740,991), null or a string up to 1,000 characters. Floating-point and oversized numeric observations are rejected to avoid cross-runtime rounding causing false passes; use explicit decimal strings when exact decimal values matter. JSON Pointer supports escaped keys/array positions. Missing keys, non-scalar responses and parsing failures are uncertainty, not passes.

Browser check shape:

```json
{
  "id": "login",
  "requirement": "login",
  "kind": "browser",
  "proposalRunId": "<approved AUE run UUID>",
  "targetId": "approved-static-app",
  "bindings": [{"operation": "click"}]
}
```

Generate/review the AUE proposal using [shared-agent-harness.md](shared-agent-harness.md). It must already bind an approved case and current evidence. This service checks project workspace/application/environment, then the existing executor rechecks approved steps, source/case revisions, selectors and target hash. Bind every approved step; supported operations are `click`, `fill` and `check`. Fill values are persisted test inputs: **never place real credentials in browser bindings**. Offline fixtures should use synthetic data.

`POST /autonomy/suites/:id/approve` requires an owner. Approval authorizes recurring execution with these inputs and attests that preconditions/test data are safe for every run. Source/case staleness can still block browser dispatch/completion. Owner approval is not inferred from a model response.

Supply `previousId` to create a maintenance revision. The old manifest remains unchanged; the new version starts unapproved. A maintenance revision cannot remove checks, change requirement IDs/check kind, replace API status/pointer/expected values, or switch a browser proposal. It may change API endpoint routing or approved browser targets/bindings and add checks, subject to review. A requirements/oracle change must be an explicitly separate reviewed suite. There is no automatic assertion weakening, passing rerun overwrite, code rewrite or selector repair. The existing harness retains failed executions and marks explicit passing retries as flaky.

`GET /autonomy` exports stored suite manifests and hashes. The coverage report means only **catalog requirement → at least one approved check**. Old approved versions also count; it does not prove runtime freshness or semantic coverage. Missing catalog items appear as gaps. Failure classification distinguishes observed assertion mismatch from missing/infrastructure evidence; it does not claim a product root cause.

## Workers and secret handling

Run the suite worker on a trusted host with environment variables supplied by a process manager/secret manager:

```dotenv
BACKEND_API_URL=https://qa-control.example.com/api
AUTONOMY_PROJECT_KEY=<runner credential>
AUTONOMY_ALLOWED_ORIGINS=["https://staging.example.com"]
AUTONOMY_SECRET_REFS={"https://staging.example.com":"STAGING_QA_BEARER"}
STAGING_QA_BEARER=<read-only staging credential>
AUTONOMY_ALLOWED_CIDRS=[]
AUTONOMY_CA_FILE=
```

```bash
PYTHONPATH=agents python3 -m shared.harness.autonomy worker
```

The command reads the process environment; it does not automatically load `.env`. Origin secret references are controlled by worker configuration, not suite/model input. The adapter sends the referenced secret as a Bearer header only to that approved origin. It never persists response bodies or headers; the selected scalar is persisted evidence, so choose non-sensitive fields. Exception output does not echo secret headers/bodies.

The adapter resolves all origin addresses, rejects private/local destinations by default, and pins the actual TLS connection to one validated address while preserving hostname verification/SNI. Redirects are not followed. Explicit `AUTONOMY_ALLOWED_CIDRS` can permit internal staging networks; configuring broad ranges weakens protection and is an administrator responsibility. Multicast/unspecified addresses are always denied. No proxy environment is used for control-plane calls or target probes. An optional `AUTONOMY_CA_FILE` trusts a managed private CA bundle; it does not disable verification.

Each API probe runs in a separate process with a 15-second hard timeout, 5-second socket timeout and 64-KiB response limit. Every suite has at most ten checks. The suite worker never automatically re-executes a probe after uncertain delivery; it retries only the identical completion report, at most three times.

For browser checks, also run the existing `shared.harness.browser_executor` with only its executor key, configured bundle paths and immutable local image. See [sandboxed-browser-execution.md](sandboxed-browser-execution.md) for image build, isolation and cleanup. The suite worker receives execution status from the API; browser verdicts come from persisted browser observations, not project-runner supplied booleans.

## Durable runs and CI

`POST /autonomy/runs` accepts `{"requestId":"<UUID>","suiteId":"<approved UUID>"}`. Repeating the same request ID/suite returns the original run. Reusing it for a different suite conflicts. Admission freezes the approved manifest; project locking serializes admission, quota checks and claims.

States: `queued` → `running` → `passed`, `failed` or `error`; active work can become `cancelled` or `interrupted`. Runs have a five-minute total deadline from admission. One suite runs per project; the existing browser executor additionally allows one browser execution per deployment. A large/slow suite may exceed the deadline and must not pass.

The API requires one bounded observation per API check and derives equality itself. For browser checks it reads the persisted execution and artifact hash. Any missing, blocked, cancelled, interrupted or flaky result prevents a passing suite. A product assertion failure makes the suite fail even if other checks are uncertain. Worker-supplied suite status is rejected. Terminal reports cannot be overwritten; exact duplicates are idempotent.

Use a separate CI-role credential with workers already running:

```bash
PYTHONPATH=agents python3 -m shared.harness.autonomy ci "$SUITE_ID" \
  --request-id "$STABLE_JOB_REQUEST_UUID" --output superqa-junit.xml
```

Exit 0 means the entire run passed. Defects, uncertainty, transport/auth failures and polling timeout exit nonzero. JUnit classifies mismatches as failures and unverified/flaky outcomes as errors, never skipped successes. If admission/transport fails before a report can be written, the command still fails; configure CI to treat a missing artifact as failure. Retain a stable request UUID across CI retries to avoid accidental duplicate execution. A new request ID explicitly authorizes a new run.

The CLI requires HTTPS for non-loopback control-plane addresses. The repository workflow `.github/workflows/autonomy.yml` builds/tests the backend and verifies fixture paths including actual Chromium. It does not run against your organization or deploy infrastructure, and its hosted execution was not verified here.

## Evaluation protocol

Maintain independently reviewed ground-truth labels:

```json
[{"id":"healthy-v1","defective":false},{"id":"seeded-defect-v1","defective":true}]
```

Results are measured outcomes linked by ID, not generated labels:

```json
[{"id":"healthy-v1","status":"passed","modelCostNanoUsd":0},{"id":"seeded-defect-v1","status":"failed","modelCostNanoUsd":0}]
```

```bash
PYTHONPATH=agents python3 -m shared.harness.evaluation corpus.json results.json --output evaluation.json
```

The strict initial gate requires both healthy and defective samples, no false passes, no missed defects, no false failures and no abstentions/missing results. Duplicate/unknown IDs, invalid labels and missing cost values are rejected. Errors/blocked/missing outcomes count as abstentions and also as missed defects on defective samples. Reports include sample/class counts, defect recall, false-failure rate, completion rate and measured model cost; undefined class rates are null, not invented percentages.

Suite execution uses zero model calls; its zero model cost excludes prior proposal generation and all infrastructure costs. Proposal budgets/usage remain in the existing harness records. The evaluation tool consumes supplied labels/results; it does not authenticate their provenance, automatically execute an external corpus, or establish real-project accuracy. Keep run IDs/artifacts, label review history, corpus versions and environment revisions alongside evaluations. Run blinded held-out and adversarial real-project cohorts before changing rollout authority.

## Operations and recovery

- Poll `GET /autonomy` with a Member credential for recent runs, immutable manifests, declared gaps, last recent claim, attention items and latest 100 audit events. Active count covers all active runs; history arrays are bounded to 100. Export long-term history directly through your controlled database/reporting pipeline.
- Expiry is reconciled on authenticated scoped requests/worker polls, not by an independent daemon. Configure external periodic overview polling and alerts for interruption, error, failure, no progress and coverage gaps. No Slack/PagerDuty/email integration is silently assumed.
- `POST /autonomy/runs/:id/cancel` stops one active run (Owner/Admin). `POST /autonomy/pause` with `{"paused":true}` blocks new admission and cancels active runs/known browser children. The browser worker checks cancellation while running. A currently in-flight GET can finish within its 15-second bound, but its late report cannot become a pass. Unpause with `false`; cancelled runs are not revived.
- Revoking a runner key immediately blocks future API actions; it does not kill the worker process or retract an already sent GET. Pause first if an immediate project stop is required. Revocation/expiry during a run means the run eventually interrupts; a different runner cannot take over its lease.
- A crashed/expired run is **never automatically replayed**. Inspect evidence/side effects, fix the environment, then explicitly submit a new request UUID. PostgreSQL remains authoritative across API/worker restarts. No full process-kill/fleet failover benchmark was performed.
- If all app Owners are locked out, a platform super-admin signs in at `/login` and uses `/admin` to issue an audited one-day Owner recovery key. Existing keys are not automatically revoked; use the recovered authority to revoke compromised keys and rotate credentials.
- Audit events are append-only through the API. They are not a cryptographically tamper-evident ledger against database administrators. Configure backups, restricted DB roles, retention and an external audit sink for production.
- Origin removal from the deployment allowlist fences new admission, claims and completion. Already issued network requests cannot be recalled. Update the worker allowlist too. Existing source/case/target freshness checks fence browser execution.
- There is no test-data provisioner/rollback engine for live systems. Current live checks are read-only by contract; offline browser fixtures are disposable. Do not enable mutating workflows by bypassing these restrictions.

## Verification record

Verified locally on 2026-09-28:

| Check | Result |
| --- | --- |
| API TypeScript build | Passed |
| Web production build, lint/type checks | Passed |
| Existing API unit/simple suites | 92 passed |
| Full integration regression with `HARNESS_DOCKER_E2E=1` | 74 passed across five suites |
| Python test discovery | 47 passed |
| `git diff --check` | Passed |

Total: **213 passing tests**. The integration run includes real PostgreSQL/Redis, HTTP, Python worker/CI transport, local verified TLS APIs, Docker Chromium, healthy/seeded-defect outcomes, project/role isolation, revocation/recovery, cancellation, quotas, immutable maintenance, stale evidence and migration repeatability. Controlled model fixtures are not live model accuracy measurements. No real-organization benchmark or hosted CI execution was performed.

Commands used:

```bash
npm run build -w apps/api
npm run build -w apps/web
npm test -w apps/api -- --runInBand --silent
PYTHONPATH=agents python3 -m unittest discover -s agents/tests
docker compose -p qa-pipeline-tests -f docker-compose.pipeline-test.yml up -d --wait
HARNESS_DOCKER_E2E=1 npm exec -w apps/api -- jest \
  test/integration/autonomy.test.ts test/integration/browser-execution.test.ts \
  test/integration/harness.test.ts test/integration/pipeline-recovery.test.ts \
  test/integration/qa-workflows.test.ts --runInBand --silent
docker compose -p qa-pipeline-tests -f docker-compose.pipeline-test.yml down --volumes
```

The isolated test stack was stopped and removed after verification; unrelated containers were not touched. The existing local `superqa-browser:v1` image remains available. No application/production database was migrated or cleared; no application was deployed. Existing working-tree changes were preserved and no commit was made.

Known local environment warnings: system Python uses LibreSSL, triggering urllib3's existing OpenSSL warning; LangGraph emits an existing serializer deprecation warning. Neither is evidence of deployment readiness; use a maintained Python/OpenSSL runtime in production.
