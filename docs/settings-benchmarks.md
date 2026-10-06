# Settings and durable benchmark collection

Status: implemented. Verification results are recorded below. This is a scoped control-plane UI, not an enterprise SSO retrofit of the legacy app.

## Deployment admin console

Interactive account, invitation, password and OIDC behavior is documented in [Organization Accounts, Invitations, and SSO](organization-accounts.md).

Provision the first platform super-admin from an interactive API host with `npm run admin:create-super-admin -w apps/api` after applying the organization-auth and super-admin migrations. Sign in through `/login`; the authenticated `/admin` console creates an organization and invites its initial admin using only an organization name and email. Admins then invite teammates from `/settings` → Access. Super-admin recovery issues an audited one-day owner key. Enrollment and recovery are unavailable without an authenticated super-admin session; there is no deployment bootstrap key or public enrollment route.

The requested end-to-end test path is Settings UI → scoped control-plane API → persisted runs → worker observations → benchmark report. Existing live-browser, cleanup and evidence tests remain regression gates.

## Delivery decisions

- Settings works independently of legacy unauthenticated workspace routes, including under production lockdown.
- Project credentials stay in browser memory only. A fixed same-origin Next.js gateway forwards them to the configured control plane; it does not store credentials or accept arbitrary backend URLs.
- Owners can change project display name/quota, manage scoped credentials and pause execution. Deployment origins, live-profile hashes, worker secrets and super-admin authority remain outside browser-editable settings.
- Reviewed benchmark definitions, trial run identities and collection state persist in PostgreSQL. Collection is incremental/idempotent and resumes after browser/API restarts without replaying a trial. Scores derive only from persisted run evidence.
- Synthetic cohorts never establish real-project readiness. Actual customer accuracy still requires authorized staging deployments and independent labels.

## Open Settings

Use the existing **Settings** sidebar entry or navigate directly to `/settings`. The direct route does not fetch legacy workspace endpoints. The sidebar stays available while legacy workspace data loads, so an unavailable workspace API does not block navigation to Settings.

Configure the Next.js server, not a public browser variable:

```dotenv
AUTONOMY_API_URL=http://localhost:4000/api
```

Use HTTPS for a remote API. Plain HTTP is accepted only for loopback. Deploy the frontend behind HTTPS; the connect form rejects non-HTTPS origins except loopback development. `NEXT_PUBLIC_API_URL` still configures legacy screens but is **not** used by the scoped gateway.

The gateway forwards only supported autonomy routes to the fixed configured backend. It rejects admin/worker routes, query strings, malformed credentials and request bodies above 64 KiB. It forwards project bearer credentials and JSON bodies, not session cookies or deployment keys; the separate auth gateway forwards only the account-session cookie to guarded auth routes. Responses are `no-store, private` and vary by Authorization. Redact payloads and Authorization in reverse-proxy/access logs too.

Connect with an existing Owner, Admin, Member or CI key. Worker-runner keys cannot access Settings. Enrollment, break-glass recovery, deployment origin approval, live-profile registration and staging secret provisioning remain administrator operations documented in [autonomy-operations.md](autonomy-operations.md) and [live-workflows.md](live-workflows.md).

### Session and credential handling

- Keys stay in React memory, not localStorage, sessionStorage, URLs or app cookies. Browser extensions/password managers remain outside the app's control.
- Reload, disconnect or leaving Settings clears the in-memory session. Disconnect also clears issued secrets, input manifests, selected benchmark, selected tab and key-role defaults.
- A 401 clears the active session rather than preserving stale privileged controls. The API rechecks expiry/revocation and role on every action.
- New credentials appear once in a password field. Copy is explicit; save the secret in a managed secret store, then dismiss it. Existing secrets cannot be retrieved. The current key's revoke button is disabled; connect with a replacement owner to revoke it.
- Only owners can retrieve credential inventories. Responses contain IDs, roles, labels, expiry and revocation state, never digests or old secret values.

## Settings sections

| Section | Implemented behavior |
| --- | --- |
| Project | Owner/Admin-editable name and 1–100 daily quota; read-only identity, environment, origins and requirements; confirmed pause and resume |
| Access | Owner-only expiring credential issuance/revocation and one-time secret handling; role-aware restrictions |
| Workflows | Stored manifests/hashes and approval state; Owner/Admin JSON draft creation; explicit Owner approval; read-only live-profile policies |
| Benchmarks | Reviewed corpus import, immutable saved definitions, owner approval, incremental collection, pause/resume, evidence export and conservative accuracy gates |

The API enforces permissions independently of browser controls. Admins can update app settings, pause/resume the app, and draft suites/cohorts, but cannot manage organization membership, credentials, or app creation, or approve suites/benchmarks. CI credentials can collect approved cohorts but cannot author them. Project pause cancels active work. Benchmark pause stops future admissions and **does not** cancel a previously admitted run.

Live-profile cards represent approved policy, not worker health. Worker secrets, local cleanup journals and screenshots stay on managed hosts. No button pretends to provision remote credentials or recover test data without the worker-side procedure.

## Durable benchmark protocol

### Migration and review

After the existing autonomy migration, apply `apps/api/migrations/20260928-benchmarks.sql` through the normal reviewed migration process. It adds `qa_benchmarks` with scoped request uniqueness, corpus/hash, approval identity, paused state and ordered trial/run IDs. It is additive and rerunnable. Do not use production TypeORM synchronization as a substitute.

The importer uses the reviewed corpus fields in [live-workflows.md](live-workflows.md): name, kind (`synthetic` or `real_project`), projectId, repetitions and samples. Every sample includes an ID, boolean defect label, approved suite ID/hash, application revision, separate revision check ID, target check ID, reviewer and label-evidence reference.

Requirements: both healthy/defective classes, 2–50 distinct samples, 1–5 repetitions, exact project scope, existing approved suites and an executable API revision oracle equal to the declared revision. Duplicate suite/revision/target tuples are repetitions, not new samples. IDs use letters, digits, underscores or hyphens. The complete gateway request is limited to 64 KiB.

1. Import and **Create draft benchmark**. No tests are admitted yet.
2. Review the saved labels, sources, revisions and suite bindings. An owner explicitly approves the immutable definition.
3. **Resume collection**. One trial is admitted; the collector waits until no project run is active before admitting the next.
4. Review and export evidence. A completed collection can still fail its accuracy gate.

Definitions cannot be edited in place. Changed labels/suites require a new draft and approval. The UI retains its creation request ID across retries of unchanged input within the session. After uncertain creation followed by reconnect, inspect the saved list before creating another draft.

### Persistence, pause and continuation

Each advance transaction locks the project, rechecks authorization, applies existing suite admission/quota/policy checks and saves the new run ID plus benchmark cursor in the same PostgreSQL transaction. Concurrent collectors cannot admit the same trial twice. Retrying an uncertain response finds the recorded trial, or starts from an entirely rolled-back transaction; it does not replay committed work.

Closing/disconnecting stops that browser's admission loop but cannot retract an accepted/in-flight admission or stop the current worker run. Reconnect, select the saved benchmark and resume. Interrupted/cancelled trials remain in the report; they are not replayed. Deliberate remeasurement requires a new benchmark. Resume after a quota reset preserves earlier trials.

This is not a new server scheduler. For unattended collection with workers already running, use a scoped CI/Admin credential:

```bash
PYTHONPATH=agents python3 -m shared.harness.autonomy collect "$BENCHMARK_ID" \
  --output benchmark-evidence.json --timeout 3600
```

The CLI resumes/advances the **same stored benchmark** as Settings, writes atomic `0600` reports and omits worker tokens. Timeout, pause, authorization/policy/quota errors or an unmet rollout gate exit nonzero. Synthetic cohorts therefore exit nonzero even when their measured cohort gate passes.

The older `shared.harness.benchmark` file-driven collector retains its separate cohort-derived run identities. Do not mix it with the durable collector expecting shared trials; use the stored benchmark ID for UI/headless continuation.

### Scoring and provenance

Scores derive from persisted runs, never uploaded results or caller-provided verdicts. Wrong manifests, missing/incorrect revision evidence, uncertain runs or flaky observations abstain. An unrelated failed assertion does not count as detecting the sample's labeled target defect.

Reports include corpus hash, trial/run IDs, snapshots, bounded observations and an evidence checksum. Exports omit worker lease tokens, worker key IDs and completion hashes. Checksums are integrity aids, not attestation against malicious administrators/workers. Browser downloads are sensitive project data and must be stored securely.

Metrics include false passes, missed defects, false failures, abstentions, missing results, completion, instability and distinct-sample 95% Wilson intervals. Partial reports count missing trials conservatively. Repetitions are not additional independent samples. Runtime model cost is zero and excludes proposal/infrastructure costs.

`gatePassed` requires complete correct outcomes and both classes. `rolloutGatePassed` also requires a declared real-project corpus, at least 20 distinct healthy and 20 distinct defective samples, at least three repetitions and no instability. Neither establishes universal QAE/AUE replacement. Label independence, reviewer identity, real-project designation and revision endpoint semantics still require independent human review.

### Scoped endpoints

Paths below are relative to `/api/autonomy` and require bearer authorization:

| Endpoint | Authority / behavior |
| --- | --- |
| GET `/settings` | Owner/Admin/Member/CI; safe configuration and identity |
| POST `/settings` | Owner; `{name,dailyRunLimit}` only; audited |
| GET `/benchmarks` | Read roles; most recent 100 definition summaries |
| POST `/benchmarks` | Owner/Admin; `{requestId,corpus}`; unchanged request is idempotent |
| GET `/benchmarks/:id` | Read roles; persisted evidence and recomputed score |
| POST `/benchmarks/:id/approve` | Owner; validates corpus and approved suites |
| POST `/benchmarks/:id/resume` | Owner/Admin/CI; requires approval and unpaused project |
| POST `/benchmarks/:id/pause` | Owner/Admin/CI; stops admission without cancelling current run |
| POST `/benchmarks/:id/advance` | Owner/Admin/CI; admits at most one next trial under lock |

Existing endpoints handle key issuance/revocation, suite approval and project pause. Benchmark creation, review, pause/resume and trial admission are audited. Long-term retention beyond the recent-definition list remains operator-managed.

## End-to-end verification

Use an isolated web build so the development server cannot overwrite production webpack assets:

```bash
npm run build -w apps/api
npm run build:settings-e2e -w apps/web
python3 -m pip install playwright==1.60.0
python3 -m playwright install chromium
docker compose -p qa-pipeline-tests -f docker-compose.pipeline-test.yml up -d --wait
HARNESS_DOCKER_E2E=1 SETTINGS_UI_E2E=1 npm exec -w apps/api -- jest \
  test/integration/autonomy.test.ts test/integration/browser-execution.test.ts \
  test/integration/harness.test.ts test/integration/pipeline-recovery.test.ts \
  test/integration/qa-workflows.test.ts --runInBand --silent
```

The browser fixture uses actual Chromium, Next.js, Nest, PostgreSQL and HTTPS worker calls—not mocked browser requests. It covers invalid credentials, owner updates, issuance/revocation, suite review, corpus import/approval, collection pause, reload/reconnection, non-replaying resume, real outcomes, evidence export, Member restrictions and revoked-session cleanup. It verifies no legacy workspace calls occur. Existing tests separately retain real isolated live-browser CRUD and cleanup/recovery coverage.

Initial verification found a shared dev/production webpack collision; `.next-settings-e2e` isolates tests without stopping the user's dev server. Browser tests also verified explicit accessible select labels and complete disconnect-state reset. The CI workflow builds this isolated output and enables the UI test; hosted GitHub execution is not claimed.

Local verification on 2026-09-28:

| Check | Result |
| --- | --- |
| API TypeScript build | Passed |
| Isolated Next production build, lint and type checks | Passed |
| API unit/simple tests | 92 passed |
| Five integration suites with both browser flags enabled | 81 passed |
| Python test discovery | 72 passed |
| `git diff --check` | Passed |

Total: **245 passing tests**. The benchmark migration was run twice against an isolated schema with an inserted record retained. Benchmark trial reads use one scoped query rather than concurrent queries on a single transaction connection. No temporary debug instrumentation remains.

The disposable PostgreSQL/Redis stack is removed after verification; test frontend processes and temporary fixtures are stopped/removed. The user's development server is not stopped. Local browser images/build artifacts remain available. No production migration, deployment, hosted CI execution or Git commit was performed.

Real-project acceptance remains unmeasured: verification uses controlled fixtures, not customer credentials or independently labeled customer defects. Existing LibreSSL/LangGraph warnings remain; use a maintained deployment runtime.
