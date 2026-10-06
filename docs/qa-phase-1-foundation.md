# Phase 1: artifact publication and test readiness

Status: first implementation slice. The remaining Phase 1 skills and end-to-end acceptance journey are still planned in [the roadmap](qa-package-roadmap.md).

## Implemented

- `check_test_readiness` is registered for QAE and AUE, with a dedicated workflow graph and executable operations.
- Skill registration supports graph factories and declared idempotency policies. Existing workflows retain their input identifiers and behavior.
- New completed/interrupted/blocked/failed invocation records receive a versioned artifact reference, creation time and content hash.
- App-scoped results are queued in a local SQLite outbox and published to immutable PostgreSQL records using the runtime's authenticated app identity.
- The agent service retries publication across restarts. `local` operator runs stay local; historical results are not automatically reassigned or published.
- Existing browser harness execution submissions/status artifacts include typed job references, separating execution state from verdict.
- `get_execution_job` and `cancel_execution_job` are direct agent/MCP tools backed by the existing durable browser harness. App resource ownership is checked before cancellation; cancellation requires execution access.
- Agent Settings → Skills includes recent shared results with expandable reports and a readiness-specific view.

The subsequent [requirement-review slice](qa-requirement-review.md) adds requirement review and typed requirement/case handoff. The [repository/data slice](qa-repository-execution.md) subsequently adds bounded repository execution and worker-owned dataset provisioning. The [API/investigation slice](qa-api-investigation.md) adds approved API jobs and evidence comparisons. Remaining core skills are planned. It establishes their integration interfaces. Job references now support the browser harness and autonomy providers; the latter requires its suite binding on lookup. Readiness snapshots are advisory; future suite admission must consume/recheck them.

## Readiness configuration

Set `QA_READINESS_PROFILES` to a map of operator-defined profiles. The agent selects a profile ID; it cannot supply a probe URL or credential value.

```json
{
  "staging": {
    "environment": "staging",
    "target_id": "staging-app",
    "repository_id": "web-app",
    "project_path": ".",
    "framework": "playwright",
    "target_probe": {
      "url": "https://staging.example.com/health",
      "expected_status": 200,
      "revision_pointer": "/revision"
    },
    "worker_probe": {
      "url": "https://runner.example.com/health",
      "ready_pointer": "/ready",
      "bearer_env": "QA_RUNNER_HEALTH_TOKEN"
    },
    "required_credentials": ["QA_RUNNER_HEALTH_TOKEN"],
    "required_checks": ["target_http", "target_revision", "repository", "credentials", "execution_worker"],
    "ttl_seconds": 60
  }
}
```

Grant the profile and underlying resources through the existing app scope map:

```json
{
  "actual-project-uuid": {
    "readiness_profiles": ["staging"],
    "browser_targets": ["staging-app"],
    "repositories": ["web-app"]
  }
}
```

Merge these fields into existing `QA_WORKFLOW_RESOURCES` entries; retain harness scope and other configured resources. `list_workflow_resources` now returns allowed readiness profile IDs.

Call the common dispatcher:

```json
{
  "skill_name": "check_test_readiness",
  "inputs": {
    "profile_id": "staging",
    "expected_target_revision": "reviewed-app-revision",
    "mode": "live"
  }
}
```

`mode: "configuration"` skips network probes. Required live observations then remain unknown and cannot establish readiness. Every snapshot includes its mode, checked time, expiry, required checks, blockers and `test_verdict: null`. Reusing the same workflow UUID returns the historical snapshot; use a new UUID for a fresh check.

### Check meanings

| Check | Actual observation | Limit |
| --- | --- | --- |
| `target_http` | HTTPS GET returns the configured status, optionally satisfying a configured boolean readiness pointer | Reachability of that endpoint; does not establish user-journey correctness |
| `target_revision` | Bounded JSON scalar at the configured pointer matches the requested revision string | Both an expected revision and observed revision are required |
| `credentials` | All configured credential environment references contain values | Presence does not prove successful authentication |
| `repository` | Existing bounded framework inspection reads the configured repository | Does not install dependencies or run project code |
| `browser_adapter` | agent-browser executable and Python MCP package are installed | Does not launch Chromium or verify login |
| `execution_worker` | Configured worker HTTPS endpoint responds with JSON `true` at its readiness pointer | Requires an actual worker health endpoint; a running agent API alone is insufficient |

Probes run in a bounded subprocess, use TLS verification and pinned DNS addresses, reject redirects, and block private addresses unless the profile explicitly supplies `allowed_cidrs`. `AUTONOMY_CA_FILE` can supply a trusted private CA. Health responses needing JSON are capped at 64 KiB. Credentials, response bodies and private filesystem paths are omitted from readiness observations.

The local Herdly target has a `herdly-observation` profile for `target_http` and `browser_adapter` only. Its resource access was added to app bindings already authorized for that target. No live probe was run during implementation; this profile is not a suite-execution readiness claim.

## Artifact lifecycle

The runtime commits the result and publication outbox entry together. The reference contains the scoped request UUID, artifact type, schema/producer versions, creation time and SHA-256 of the canonical result payload. The hash excludes the derived `artifact` and mutable `publication` fields.

`publication` reports `local`, `pending` or `published`. Publication does not change a workflow's outcome. The signed endpoint stores exact payload bytes, validates envelope/result identity, rejects conflicting reuse of a scoped request UUID and returns the same receipt for an identical retry. A late result cannot overwrite a terminal local invocation.

The background publisher handles a bounded rotating batch of scoped stores every cycle, with limited concurrent publication requests. Failed requests retain their outbox entries. It never reruns the originating workflow. Mount durable storage for `QA_WORKFLOW_DB` and its sibling scoped databases.

For standalone CLI/MCP processes without the service background task, publication is attempted when an invocation finishes. Retry the configured app scope's pending publications explicitly:

```sh
PYTHONPATH=agents QA_WORKFLOW_SCOPE=actual-project-uuid python -m shared.skills.cli publish
```

App publication requires matching `AGENT_MEMORY_SIGNING_KEY` values in the runtime and API and a valid `BACKEND_API_URL`. The key remains server-side. The publication signature is purpose-bound and expires after five minutes. App scope comes from verified chat context or the trusted operator configuration, never from model tool arguments.

Records in the new `qa_workflow_artifacts` table are app-scoped and immutable. Existing legacy QA/case records are not backfilled or assigned owners by this change. Reconciling legacy record scope remains Phase 1 work. Typed artifact handoff is now implemented separately; it does not reassign legacy ownership.

## Retrieval and jobs

| Interface | Purpose |
| --- | --- |
| `get_skill_run` | Retrieve the persisted invocation artifact and publication state |
| `get_execution_job` | Read current state/verdict of an owned browser harness job |
| `cancel_execution_job` | Cancel an owned browser job through the existing harness |
| `GET /workflows/jobs/{role}/{execution_id}` | Internal workflow-key-protected job lookup |
| `POST /workflows/jobs/{role}/{execution_id}/cancel` | Internal workflow-key-protected cancellation, subject to execution permission |
| `POST /api/workflow-artifacts` | Signed internal publication; not a browser write endpoint |
| `GET /api/chat/agents/{id}/workflow-artifacts` | Authenticated app-scoped latest 30 results for that agent role |
| `GET /api/chat/agents/{id}/workflow-artifacts/{requestId}` | Authenticated app-scoped immutable report detail |

Execution job state is queued/running/completed/cancelled/interrupted. A separate verdict contains passed/failed/error/blocked when applicable. Job references inside artifacts are historical snapshots; use job lookup for fresh state. The original `browser_execution_status` skill remains available for compatibility.

## Deployment and verification status

- Production: apply `apps/api/migrations/20261004-workflow-artifacts.sql` and restart the API and Python runtime. The migration is additive and does not reassign legacy records. Development TypeORM synchronization discovers the new entity.
- Restart MCP clients to refresh tool discovery. Existing direct HTTP/CLI skill input identifiers remain valid.
- API build, frontend TypeScript compilation, Python syntax parsing and runtime catalog inspection are the implementation checks. No automated tests, live readiness checks, browser runs or publication acceptance scenarios were run for this slice.
- Required future acceptance work: signed publication/replay/conflict/isolation; outbox/API outage and restart; missing/mismatched revision; absent credentials/worker; expired snapshots; job lookup/cancellation; user-interface retrieval. These remain unverified behavior until explicitly exercised.
