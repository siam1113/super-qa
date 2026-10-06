# Sandboxed browser execution

Implemented 2026-09-28. This extends the reviewed AUE proposal harness with a separate, explicitly authorized **offline browser execution** capability. It does not enable arbitrary generated code, live production URLs or shell commands.

The later [project autonomy control plane](autonomy-operations.md) can dispatch these executions from owner-approved recurring suites. Its live HTTPS checks use a separate read-only adapter; this browser remains offline.

## Supported journey

`approved QA case → AUE proposal → proposal review → operator action bindings + target approval → immutable execution → containerized Chromium → observed text + screenshot → server-derived verdict`

The existing proposal review still grants no execution permission by itself. Operators must submit a separate execution request identifying the reviewed proposal and allowlisted target. They must confirm preconditions and bind every natural-language action to `click`, `fill` or `check`. The executor does not ask a model to interpret actions at runtime. Unsupported cases are rejected rather than silently skipped.

The first supported targets are trusted, self-contained **static application bundles** with `index.html`. JavaScript in the application can run in Chromium, but remote APIs, CDN dependencies, federated authentication and live organization environments are unavailable. Use synthetic accounts/data. This provides a reproducible pilot seam without granting agents network credentials or repository/shell access.

## Authority and immutable inputs

- A third, distinct `HARNESS_EXECUTOR_KEY` is required for browser-worker claims and completions. Model-worker credentials cannot submit browser results. Executor credentials cannot submit proposals, authorize new executions or approve reviews.
- Operator requests must reference an approved AUE proposal with a still-approved case revision and current source evidence. Validation runs at admission, claim and completion. Source/case changes block publication; recorded observations remain available for diagnosis.
- Every step retains the approved action, selector, assertion selector and exact expected string. Only action operation/value bindings are supplied at execution admission. There is no ability to override assertions or submit a desired verdict.
- Supported selectors are `#element-id` and `[data-testid="identifier"]`. XPath, arbitrary selector engines, navigation instructions, eval, shell and code strings are not part of the contract.
- Preconditions are an explicit operator attestation, not automatically verified fixtures. The operator remains responsible for mapping natural-language actions to the correct supported operations.
- The API allowlists target IDs and exact bundle hashes. The executor separately maps those IDs to trusted local directories. Bundles contain at most 200 entries/5 MB, require an entry point, and reject symlinks/special files. Files are copied and hashed together before execution, so the container sees a frozen copy rather than a changing source directory.
- The runner image tag is operator-configured and resolved to a local immutable Docker image ID per execution. The image ID is recorded in the report. No image is pulled during execution. A changed image across separate runs remains visible in report provenance; the image is not yet pinned by the API's admission contract.

Existing deployment-scoped keys are still not tenant membership/RBAC. Actor labels are self-declared. Use a trusted single-organization deployment; the rest of the legacy platform has separate authorization gaps.

## Isolation policy

The host broker invokes a fixed Docker command without a shell. Containers receive only the copied target directory read-only and a bounded declarative plan over stdin. API keys, provider credentials, the repository, host home and Docker socket are never mounted/passed into the browser container.

Enforced flags include network disabled, read-only root filesystem, UID/GID 1000, all capabilities dropped, no-new-privileges, one CPU, 768 MB memory, 128 processes, private 128 MB shared memory and a bounded temporary filesystem. The runner rejects root execution or any active network interface other than loopback; dormant kernel tunnel interfaces are permitted. It serves the bundle only on container-local loopback, and the browser additionally blocks requests outside that origin. Service workers and downloads are disabled.

Docker's `none` network provides only loopback, which is why an external target URL is not supported. See [Docker network isolation](https://docs.docker.com/engine/network/drivers/none/). The base image and Python Playwright package are both pinned to 1.60.0, following the requirement to match browser/package versions. See [Playwright Docker guidance](https://playwright.dev/python/docs/docker).

**Security limit:** Chromium's own sandbox is disabled in this controlled test container; OS/container restrictions are the isolation mechanism for this release. This is not a hardened hostile-code or public-web browsing service. The official Playwright image is intended for testing trusted content. Do not use this to execute arbitrary uploaded malicious applications. Dedicated worker hosts/rootless or stronger container isolation, image scanning and a reviewed Chromium sandbox/seccomp setup remain deployment gates for hostile-content workloads.

The host broker itself needs Docker-daemon access and is therefore privileged infrastructure. Run it on a dedicated worker, never inside the web/API process or with user-controlled Docker arguments.

## Deterministic verdicts and artifacts

The fixed runner launches a fresh Chromium context, performs each allowed action and reads a visible assertion target's complete `inner_text`. It polls up to two seconds for exact equality after the action, with bounded selector timeouts. It does not normalize away mismatches or use model judgment. Action failures, missing assertions, page errors and output overflow are infrastructure/action errors rather than passing observations.

The API recomputes verdicts from authenticated executor observations against its stored assertions:

| Status | Meaning |
| --- | --- |
| `queued` / `running` | Admitted / owned by one worker |
| `passed` | Every action completed, every expected text matched, no reported error and a screenshot was captured |
| `failed` | At least one observed text differed from its approved expectation |
| `error` | Action/infrastructure failure, incomplete observations or missing required artifact |
| `blocked` | Evidence/case/target authority changed |
| `cancelled` | Explicit operator cancellation |
| `interrupted` | Lease or queue deadline expired; side effects may be uncertain |

A worker cannot submit a `status` override. Observations must be ordered and bounded. The API rejects terminal rewrites and accepts only byte-equivalent normalized completion retries. It hashes the received final JPEG itself and serves it through an authenticated artifact endpoint. Status responses omit the image bytes and ownership token. CLI artifact download verifies the hash before writing a new file.

The artifact is one final viewport JPEG, not a full trace/video or a screenshot for every step. Reported observations and image hashes are evidence from a trusted executor, not cryptographic proof of browser execution. A compromised executor credential could fabricate observations; isolate and rotate it. The API checks bounded JPEG framing but does not independently decode/replay the image or browser session.

No records in the manual `qa_executions` table are rewritten. Automated results live in `harness_executions`, avoiding conflation of operator-reported results and browser observations. No model calls or token charges occur during execution.

## Recovery, cancellation and retries

Execution submission is idempotent by request UUID plus complete request content. Claiming uses a PostgreSQL transaction/advisory lock and permits one active browser execution per deployment. The queue deadline is five minutes; a claim owns a lease of at most 90 seconds. The runner has a 60-second coroutine limit and 65-second process alarm, while the broker bounds Docker runtime and forcibly removes its own named container on exit/cancellation. The worker polls cancellation about once a second.

Expired executions become `interrupted`, **never automatically queued again**. Browser actions may have side effects, so blind replay is unsafe. A new operator-authorized request can reference `retryOf`, but must keep the same proposal, target/hash and action bindings. Original records remain unchanged. A pass following an assertion failure is marked `flaky`; this is a retry-history flag, not a statistical flake-rate estimate. Infrastructure recovery alone is not labeled an assertion flake.

Completion transport retries resend the same report/token and do not rerun browser actions. A process crash can lose unsubmitted artifacts; the API then retains an interrupted result rather than inventing a verdict. The container process alarm limits work after broker loss, but daemon failure/host power loss still require operational cleanup. Temporary bundle copies are normally removed by the broker; crash leftovers need worker-host retention management.

## Setup

1. Back up the application database, apply the existing QA/harness migrations, then:

   `psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f apps/api/migrations/20260928-browser-execution.sql`

   The migration is additive/rerunnable against its own schema. No application database was migrated during implementation.

2. Build the fixed runner from the repository root:

   `docker build -t superqa-browser:v1 agents/shared/harness/sandbox`

3. Produce a target digest using the same implementation as the worker (replace the path):

```sh
PYTHONPATH=agents python3 -c 'from pathlib import Path; from shared.harness.browser_executor import snapshot_bundle; print(snapshot_bundle(Path("agents/tests/fixtures/browser/healthy")))'
```

4. Configure the API's distinct executor key and `HARNESS_EXECUTION_TARGETS` JSON map, for example `{"login-fixture":"DIGEST"}`. Configure only the executor key on the browser worker, plus:

   - `BACKEND_API_URL`: trusted API address.
   - `HARNESS_BROWSER_IMAGE=superqa-browser:v1`.
   - `HARNESS_BROWSER_TARGETS={"login-fixture":"/absolute/path/to/static/app"}`.

5. Start the broker separately:

   `PYTHONPATH=agents python3 -m shared.harness.browser_executor`

6. On the operator host, create an execution request with real UUIDs:

```json
{
  "requestId": "11111111-1111-4111-8111-111111111111",
  "proposalRunId": "22222222-2222-4222-8222-222222222222",
  "targetId": "login-fixture",
  "actor": "qa-owner",
  "preconditionsConfirmed": true,
  "bindings": [{"operation": "click"}]
}
```

There must be exactly one binding per approved step. `fill` additionally requires a string `value`; other operations reject it. Do not include secrets or real credentials: bindings and observations are persisted.

```sh
PYTHONPATH=agents python3 -m shared.harness.cli execute execution.json
PYTHONPATH=agents python3 -m shared.harness.cli execution-status EXECUTION_UUID
PYTHONPATH=agents python3 -m shared.harness.cli artifact EXECUTION_UUID --output screenshot.jpg
PYTHONPATH=agents python3 -m shared.harness.cli execution-cancel EXECUTION_UUID
```

Equivalent operator endpoints: `POST /api/harness/executions`, `GET /api/harness/executions/:id`, `GET /api/harness/executions/:id/artifact`, `POST /api/harness/executions/:id/cancel`. Executor-only claim/status/completion endpoints live under `/api/harness/executor`.

## Verification

```sh
npm run build -w apps/api
npm test -w apps/api -- --runInBand --silent
PYTHONPATH=agents python3 -m unittest discover -s agents/tests
docker compose -p qa-pipeline-tests -f docker-compose.pipeline-test.yml up -d --wait
HARNESS_DOCKER_E2E=1 npm exec -w apps/api -- jest test/integration/browser-execution.test.ts test/integration/harness.test.ts test/integration/pipeline-recovery.test.ts test/integration/qa-workflows.test.ts --runInBand --silent
docker compose -p qa-pipeline-tests -f docker-compose.pipeline-test.yml down --volumes
```

The database tests truncate only the disposable PostgreSQL database on port 55432; do not repoint them at application data. The Docker browser test is explicitly opt-in and otherwise skipped. With the flag enabled it uses the actual Python broker, Docker container, Chromium, HTTP callbacks and PostgreSQL, testing healthy and deliberately defective login fixtures. Only the AUE proposal generation is controlled; the browser observations are not mocked.

Verified results: API production build passes; **92 API unit tests, 35 Python tests and 60 integration tests pass**, with the real Docker browser test enabled and no skipped integration tests. Healthy login produces `Access granted`/passed; the seeded defect produces `Access denied`/failed. Both runs persist a final screenshot. `git diff --check` passes. The built `superqa-browser:v1` image remains locally available; disposable database services are stopped after verification.

The first real-container run correctly returned an infrastructure error because an overly strict startup check treated dormant Docker Desktop tunnel interfaces as active networking. The check now examines interface flags, still rejecting any active non-loopback interface. Regression tests cover both inactive tunnels and active external interfaces. Network-disabled Docker flags and all other resource/privilege restrictions remain unchanged. Existing LibreSSL/LangGraph Python dependency warnings did not fail tests.

## Remaining gates

Live application environments require a separately designed network allowlist/proxy and secret/test-data lifecycle, not removal of `--network none`. Also pending: tenant membership/source/case ACLs, stronger hostile-code isolation, operator UI, richer typed assertions, backend/API operations, full traces/video, durable object storage/retention, global execution quotas and production load/security validation. General generated code execution and autonomous repository patch application remain disabled.
