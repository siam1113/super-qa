# Live workflows, test data and project accuracy

Status: implemented; local verification is recorded below. This extends, rather than relaxes, the offline harness. Real-organization accuracy remains unmeasured until authorized project cohorts are run.

## Design and authority

- Live workflows are immutable operator-authored profiles approved by hash at the deployment and suite levels. No model-authored arbitrary Python/JavaScript runs on a worker.
- Chromium retains Docker `--network none`. Intercepted HTTP requests cross a bounded standard-I/O bridge to a DNS-pinned, TLS-verifying host transport. Exact origin/method/path rules mediate every request. Browser processes never receive control-plane credentials or the host environment.
- Every live run gets its own test-data namespace. Provision intent is persisted before a network write. Cleanup runs on success, assertion failure and cancellation; durable pending intents support cleanup-only recovery after crashes. Uncertain cleanup cannot pass.
- Mutations require an application-owned test-lease endpoint, isolated staging data and server-enforced expiry. This is compensation, not a distributed transaction or general production rollback.
- Accuracy collection uses persisted control-plane run IDs, immutable suite hashes, independently reviewed labels and application revision metadata. Synthetic fixtures will be reported separately from real-project validation.

## Progress

- Reviewed existing autonomy lifecycle, immutable assertions, network-disabled browser isolation and evaluation gaps.
- Selected a separate live-profile adapter so existing offline execution remains unchanged.

- Added live-profile registration, immutable suite assertions, server-derived outcomes and fail-closed cleanup/artifact requirements.
- Implemented network-disabled Chromium with a bounded host HTTP bridge, per-origin worker credentials, namespaced provisioning, SQLite cleanup intents and cleanup-only crash recovery.
- Verified authenticated live CRUD against a real local TLS application using Chromium, including healthy/seeded-defect outcomes and failed cleanup followed by recovery. These are controlled fixtures, not real-world accuracy measurements.
- Added run-linked benchmark collection with executable revision checks, repeated trials, false-pass/missed-defect/false-failure accounting, stability, confidence intervals and separate synthetic versus real-project gates.
- Added explicit bridge-write deadlines. Regression testing exposed an auto-removal timing edge: a container may already be removing while its Docker CLI still exits. Teardown now waits for a bounded successful CLI exit before classifying that case; nonzero/uncertain exit still fails. A deterministic regression test went red before the fix and green afterward.

## 1. Live workflow contract

Use `agents/shared/harness/examples/live-profile.json` as an example, not as a runnable configuration for your application. Profiles are operator-authored data, not executable scripts. Each contains:

| Field | Contract |
| --- | --- |
| `origin` | One explicit HTTPS origin, also approved for the project and on the worker |
| `environment` | `test` or `staging`, matching the project; production is rejected |
| `revision` | Human review metadata; actual revision verification uses a separate API check in benchmark suites |
| `leasePath` | Application-owned lifecycle path containing exactly one `{namespace}` |
| `routes` | Up to 50 exact method/path rules; no wildcard routes, redirects, percent encoding, query strings, traversal or arbitrary origins |
| `steps` | Up to 20 declarative `goto`, `fill`, `click`, `assert` operations; at least one literal text assertion |

Supported HTTP methods are GET/POST/PUT/PATCH/DELETE. Every non-GET browser route must contain `{namespace}`; the lifecycle endpoint itself cannot be a browser rule. Each namespace is derived from the durable run/check identity, not user/model-selected. Fill values are synthetic test inputs; never embed credentials or sensitive data in a profile. Values/paths can substitute `{namespace}`; expected assertions cannot.

`assert` waits for a unique visible locator and expected text, then captures actual text/visibility. Missing or mismatched UI assertions fail; execution/policy errors abstain. The API compares captured values with the frozen suite assertions. The runner cannot simply send `passed`. Missing assertions, errors, missing screenshot hashes or unverified cleanup prevent a pass. The exact screenshot is retained in worker state; only its hash and bounded observations reach the API.

### Profile review and deployment registration

1. Implement the staging lifecycle endpoint described below. Verify that it isolates all created records and external effects.
2. Review the application revision, synthetic seed blueprint, selectors, literal oracles and exact request rules. Include all required static assets; missing network rules fail closed rather than silently extending authority.
3. Calculate the profile digest and registry entry:

```bash
PYTHONPATH=agents python3 -m shared.harness.live profile /managed/profiles/staging.json
```

4. Set the printed hash-to-policy JSON in the API's `AUTONOMY_LIVE_PROFILES`. It includes `origin`, `environment` and `assertions`. Set `AUTONOMY_ALLOWED_ORIGINS` on both API and worker, and enroll the origin in the scoped project.
5. Add a live check to an ordinary suite, then approve it with an owner credential:

```json
{
  "id": "create-item",
  "requirement": "items-create",
  "kind": "live",
  "origin": "https://staging.example.com",
  "profileHash": "<64-character SHA-256 printed by the command>",
  "assertions": ["Saved"]
}
```

The digest covers the exact file bytes, including whitespace. The worker independently verifies the file hash, origin and assertion list. The deployment registry is rechecked at suite creation, approval, admission, claim and completion. Removing a profile fences new work and late completion, but cannot retract a previously sent request.

Maintenance revisions cannot change a live profile hash or assertion list. A changed profile requires a separate explicitly reviewed suite. This conservative rule prevents selector/route changes from hiding oracle changes inside a hash. Existing QAE/AUE proposal generation remains separate: **this does not implement automatic conversion of arbitrary proposals into live profiles**.

### Worker configuration

```bash
docker build -t superqa-browser:v1 agents/shared/harness/sandbox
docker image inspect superqa-browser:v1 --format '{{.Id}}'
```

Use the resulting immutable image ID, not a mutable tag, in worker configuration:

```dotenv
AUTONOMY_LIVE_IMAGE=sha256:<image-id>
AUTONOMY_LIVE_PROFILE_PATHS={"<profile-sha256>":"/managed/profiles/staging.json"}
AUTONOMY_LIVE_STATE=/managed/persistent/superqa-live
AUTONOMY_ALLOWED_ORIGINS=["https://staging.example.com"]
AUTONOMY_SECRET_REFS={"https://staging.example.com":"STAGING_QA_BEARER"}
STAGING_QA_BEARER=<least-privilege staging credential>
AUTONOMY_ALLOWED_CIDRS=[]
AUTONOMY_CA_FILE=
```

Run the existing `shared.harness.autonomy worker` with its scoped runner key. CI admission/polling and JUnit are unchanged. There is no new database migration: live manifests/results use existing JSONB columns. Deploy the API, worker and rebuilt image together; older workers cannot execute `live` checks.

The worker state directory must be private, persistent, backed up and owned by the service account; do not use a disposable container filesystem or a shared untrusted directory. One worker/recovery process owns a state directory at a time via an exclusive OS file lock. Use a dedicated state directory per project and preserve it across worker upgrades. SQLite uses full synchronous commits; completed identities remain recorded to reject replay. Do not prune the journal while runs may be retried.

### Browser and transport security

- Browser containers have no network, host mounts, inherited environment or Docker socket. They retain read-only filesystem, nonroot UID, dropped capabilities, memory/CPU/PID limits and restricted tmpfs. The existing Chromium `--no-sandbox` limitation remains; Docker/managed host isolation is the protection, not a claim of a hardened hostile-site browser sandbox.
- Request interception relays only approved requests over standard I/O. The host pins TLS connections to validated DNS addresses, verifies certificates/hostname and rejects private destinations unless explicitly permitted by deployment CIDRs. Credentials are injected only by the host for the configured origin. Browser-supplied Authorization headers are not forwarded. Session cookies and a small header allowlist support same-origin applications; general SSO is not implemented.
- Service workers are blocked; WebSockets are closed; browser downloads are disabled. This follows Playwright's [request interception guidance](https://playwright.dev/python/docs/network), which notes that service workers can bypass routing. Network isolation remains effective even for browser network paths that interception does not cover.
- Limits: 100 bridged requests, 64 KiB request bodies, 1 MiB response bodies, approximately 7.5 MiB aggregate decoded response data, 15 seconds per host request, 10 seconds per bridge write, 90 seconds browser loop plus bounded in-flight work/teardown, 64 KiB screenshot and the existing five-minute suite deadline. No transport or browser-action retries are added. Only identical completion reports are retried.
- Unexpected requests, rejected redirects, timeouts and transport limits make the workflow uncertain, even if later DOM text matches. No traffic headers, full response bodies, console logs or secret values are persisted as evidence. Screenshots/visible text can still contain application data: use synthetic tenants and restricted artifact retention. Artifacts are local JPEGs named by SHA-256, mode `0600`; there is no new artifact-serving endpoint.

Not supported: unrestricted public browsing, third-party origins, OAuth redirects, WebSockets, service-worker-dependent apps, arbitrary query/encoded URLs, mobile/native, file upload/download, custom script execution or arbitrary production mutations. A typical existing app may need a staging adapter and additional explicit asset rules; this is not plug-and-play for every website.

## 2. Mutating test-data lifecycle

The application/environment owner supplies a **test-only lease endpoint**, protected by least-privilege staging credentials. A route such as `/__qa/leases/{namespace}` must implement:

| Request | Required behavior |
| --- | --- |
| PUT with `{"namespace":"sq-…","ttlSeconds":600}` | Atomically provision isolated synthetic data, return 201 and exactly the same JSON object. A duplicate request must not create a second dataset. |
| DELETE | Idempotently delete/compensate **all** namespace-owned data and pending side effects; return 200, 204 or 404 only when cleanup is complete. |
| GET after DELETE | Return 404 only when the namespace's data/effects are absent. Returning 200 leaves cleanup pending. |
| Server-side expiry | Independently expire all namespace resources after 600 seconds, even if Super QA/its host disappears. |

The staging adapter chooses the seed blueprint from the reviewed lifecycle path. UI/API mutations must remain confined to that namespace; use server authorization/tenant isolation, not only a URL convention. Disable real payments, emails and other irreversible integrations, or use provider sandboxes with compensating cleanup. An endpoint echoing TTL is **not proof** that expiry/compensation is implemented; environment owners must verify it independently. Never point this contract at a generic customer deletion endpoint.

Lifecycle:

1. Validate authority/profile and ensure no pending cleanup exists.
2. Persist `pending` intent with namespace and immutable profile hash **before** provisioning.
3. Provision exactly once; an uncertain response does not cause another PUT.
4. Execute the browser only while the scoped run remains active.
5. In `finally`, DELETE then verify absence, including after provisioning uncertainty, assertion failure and cancellation.
6. Mark the journal `clean` only after verification. Otherwise retain `pending`, report an error and refuse subsequent live execution using that state directory.

Cancellation/pause stops further bridged work on the next authority check, not a request already in flight. Cleanup remains authorized after cancellation because it compensates already authorized mutations. If the process is killed or its host disappears, pending intent survives on persistent storage; server TTL is the independent backstop.

### Recovery and monitoring

Stop/drain the worker before recovery. With the same managed profiles, origin allowlist, least-privilege secrets, CA and persistent state configured:

```bash
PYTHONPATH=agents python3 -m shared.harness.live recover
```

This only retries idempotent DELETE/absence verification for pending intents. It never reprovisions, reruns browser actions or changes the original terminal verdict. Nonzero exit means at least one namespace remains uncertain. Missing/modified profiles, unavailable credentials and removed origins leave intents pending; retain immutable profile files until cleanup is complete. Restore only narrowly scoped cleanup authority or use the application owner's recovery procedure, never loosen general browser policy.

Monitor pending intents and nonzero recovery exits in addition to `GET /autonomy` attention items. Schedule cleanup-only recovery during worker downtime and alert an operator on failure. This delivery does not provision an external scheduler/notification service. Catastrophic state-volume loss requires the application's independent TTL/inventory reconciliation; SQLite cannot compensate for lost infrastructure.

## 3. Real-project accuracy collection

The new collector executes approved suites via the control plane, then scores **persisted observations**, rather than accepting a hand-written results file. It does not supply real project credentials or fabricate labels.

Each sample needs a reviewed healthy/defective label, source evidence (bug ticket, independently verified regression or controlled mutation), immutable suite hash, target check and **separate executable revision check**. Use isolated revision-specific staging deployments so collection does not depend on manually swapping a deployment mid-run. Both the application revision API and target workflow must refer to the same intended deployment; this semantic connection requires owner review.

Example corpus shape (fill every placeholder and include both healthy and defective samples):

```json
{
  "name": "project-held-out-release-cohort",
  "kind": "real_project",
  "projectId": "<scoped-project-uuid>",
  "repetitions": 3,
  "samples": [
    {
      "id": "healthy-create-item",
      "defective": false,
      "suiteId": "<approved-suite-uuid>",
      "manifestHash": "<stored-suite-hash>",
      "revision": "<application-revision>",
      "revisionCheckId": "revision",
      "targetCheckId": "create-item",
      "reviewedBy": "<independent-reviewer>",
      "labelEvidence": "<reviewed-bug-or-baseline-reference>"
    }
  ]
}
```

The separate `revision` check must be an ordinary API check whose expected scalar equals the supplied revision. Revision mismatch/missing evidence, wrong manifest, uncertain runs or flaky observations abstain; a failure in some unrelated check cannot be credited as detection of the labeled target defect. Metrics describe **the labeled target check**, not all possible defects in a project. Duplicate suite/revision/target samples are rejected as repetitions, not counted as new cases.

Start workers, then use a separate CI key:

```bash
PYTHONPATH=agents python3 -m shared.harness.benchmark cohort.json --output project-accuracy.json
```

The collector:

- Validates the entire corpus against project-approved manifests before admission.
- Uses deterministic request UUIDs derived from the complete cohort, sample and repetition. Rerunning an unchanged cohort resumes/fetches existing runs rather than rerunning mutations. Changing the cohort authorizes new run identities.
- Writes a private (`0600`), atomic report checkpoint after each result, retaining corpus, run IDs, request IDs, snapshots, observations, artifact hashes and an evidence checksum. Treat files as sensitive project data. Checksums detect accidental changes, not malicious rewriting/signatures.
- Counts missing/uncertain defective outcomes as missed defects, not successful abstention. Reports false passes, false failures, completion, model execution cost, unstable samples and 95% Wilson intervals over distinct labeled samples; repetitions are not additional independent evidence.
- Distinguishes synthetic fixtures from `real_project` cohorts. Label/reviewer metadata remains an attestation, not cryptographic proof or an independent investigation.
- Requires at least 20 distinct healthy and 20 distinct defective samples, three repetitions, no instability/errors/misses/false passes/false failures and a real-project corpus for `rolloutGatePassed`. CLI exit zero means this gate passed, not universal replacement readiness. This starting gate is configurable only by changing reviewed code, not by silently lowering a run's assertions.

Project quotas remain enforced. A 40-sample × 3-repetition cohort needs 120 admissions, more than the maximum 100-per-UTC-day project limit: collect across days with the same corpus/request identities. Transport/quota failures exit nonzero and preserve earlier checkpoints. Polling timeout writes an abstention checkpoint and stops without starting more runs.

Before broad adoption: use independent/blinded labels, held-out real defects across authentication/permissions/state transitions, adversarial cases, multiple application revisions and longer observation windows. Review confidence intervals and correlated cases, rather than treating 100% on a small set as certainty. The collector measures deterministic approved workflow execution; model-generated case relevance, semantic requirement coverage, security/compliance completeness and all infrastructure/proposal costs remain separate measurements.

## Verification

Verified locally on 2026-09-28:

| Check | Result |
| --- | --- |
| API TypeScript build | Passed |
| API unit/simple tests | 92 passed |
| Five integration suites with actual Docker Chromium, PostgreSQL and Redis | 76 passed |
| Python discovery, including lifecycle/security/benchmark tests | 71 passed |
| `git diff --check` | Passed |

Total: **239 passing tests**. The new live end-to-end scenario runs authenticated HTTPS CRUD through the scoped API, Python worker, network-disabled Chromium and pinned host bridge. A two-sample synthetic cohort executes two repetitions per sample, preserves run/revision evidence and correctly distinguishes healthy versus seeded-defect outcomes. Additional scenarios verify cleanup failure prevents a pass, cleanup-only recovery removes the orphan without rerunning the mutation or rewriting the verdict, and unexpected external requests fail closed with successful data cleanup. Tests also cover profile/oracle drift, missing screenshots, cancellation before/after provisioning, uncertain provisioning, crash-intent recovery, failed absence verification, private DNS, redirects/limits and bounded teardown.

Commands:

```bash
npm run build -w apps/api
npm test -w apps/api -- --runInBand --silent
PYTHONPATH=agents python3 -m unittest discover -s agents/tests
docker build -t superqa-browser:v1 agents/shared/harness/sandbox
docker compose -p qa-pipeline-tests -f docker-compose.pipeline-test.yml up -d --wait
HARNESS_DOCKER_E2E=1 npm exec -w apps/api -- jest \
  test/integration/autonomy.test.ts test/integration/browser-execution.test.ts \
  test/integration/harness.test.ts test/integration/pipeline-recovery.test.ts \
  test/integration/qa-workflows.test.ts --runInBand --silent
docker compose -p qa-pipeline-tests -f docker-compose.pipeline-test.yml down --volumes
```

No organization credentials, external staging endpoint, real customer corpus, production migration or deployment was used. The real-project acceptance gate therefore remains **unmeasured**, not passed. The test lease endpoint demonstrates the transport/lifecycle contract; it is not proof that a customer's expiry/compensation implementation works. The unchanged frontend was not rebuilt in this extension. Hosted GitHub Actions was not executed; its existing integration command includes the new tests automatically. Existing local LibreSSL and LangGraph deprecation warnings remain.

## Changed implementation

- `apps/api/src/modules/autonomy/autonomy.contract.ts`, `autonomy.entity.ts`, `autonomy.dto.ts`, `autonomy.service.ts`: live check shape, deployment/profile authority, immutable assertions and deterministic completion.
- `agents/shared/harness/live.py`: profile validation, pinned transport, private lifecycle journal, bounded container bridge, cleanup and recovery CLI.
- `agents/shared/harness/sandbox/live_runner.py`, `Dockerfile`, `.dockerignore`: fixed live browser program inside the existing isolated image; offline runner unchanged.
- `agents/shared/harness/autonomy.py`: live adapter dispatch and completion handoff.
- `agents/shared/harness/benchmark.py`: scoped suite execution, reproducible run identities, revision-bound scoring and private report checkpoints.
- `agents/shared/harness/examples/live-profile.json`: explicit staging profile example.
- `agents/tests/test_live.py`, `agents/tests/live_benchmark_fixture.py`, `apps/api/test/integration/autonomy.test.ts`: focused and full-stack verification.
- API/worker `.env.example` files, documentation index, delivery ledger and root README: configuration and adoption guidance.
