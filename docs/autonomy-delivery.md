# Autonomous QA delivery ledger

Status: bounded pilot implementation delivered; final verification results are recorded below. This ledger tracks the five requested workstreams. Completion of code is not evidence of universal autonomous replacement or measured model accuracy.

**Subsequent extension:** [Live workflows and accuracy](live-workflows.md) adds approved staging browser profiles, namespaced data provisioning/cleanup and revision-bound benchmark collection. The original delivery matrix below is historical; unrestricted browsing, general production rollback and measured real-organization accuracy are still not established.

**Settings extension:** [Settings and durable benchmarks](settings-benchmarks.md) adds a scoped browser control plane, role-aware credential/project management, persisted reviewed cohorts and resumable UI/headless collection with actual browser verification.

## Delivery plan

1. Project enrollment, scoped/revocable credentials, role checks, environment policy, secret references and a lockdown mode that closes legacy unauthenticated routes.
2. Durable autonomous suites combining approved offline browser plans with allowlisted read-only live API assertions; CI admission/polling; bounded execution and explicit uncertain outcomes.
3. Requirement coverage gaps, versioned approved automation manifests, deterministic failure classification and retained assertions/retry history. Unsupported maintenance escalates rather than weakening tests.
4. A labeled evaluation runner reporting false passes, missed defects, false failures, abstention and cost with denominators; regression CI.
5. Project quotas, pause controls, append-only audit events, expired-worker handling and operational summaries/escalations.

## Constraints

No real organization, authoritative requirements, credentials, production permission or labeled real-project corpus has been supplied. These must not be fabricated. Verification uses local controlled services and existing browser fixtures. Live browser egress and arbitrary repository/code mutation remain closed until their isolation and authority contracts are implemented and verified. External secret values stay on trusted workers, not in source control or client responses.

## Progress

- Reviewed existing proposal/browser harness, credential separation, immutable oracles and legacy route gaps.
- Chosen an explicit project-scoped control plane rather than implicitly granting organization-wide powers to existing chat tools.
- Implemented hashed, expiring, revocable project credentials, the Owner/Admin/Member app roles and CI/runner machine credential scopes, deployment-approved HTTPS origins, project quotas and legacy-route lockdown.
- Implemented immutable reviewed suites, durable admission/claims/completion, project isolation, cancellation, pause, audit records and coverage/attention summaries.
- Connected approved AUE browser plans to existing sandbox execution; a project worker cannot provide its own browser verdict. Added a separate bounded read-only TLS API adapter and CI/JUnit client.
- Added maintenance invariants: a revision cannot remove checks, change requirement mappings or replace API oracles/browser proposals. New versions still require owner approval.
- Added labeled-corpus evaluation accounting for missing outcomes, false passes, missed defects, false failures, abstention and execution-model cost. Added repository CI workflow.
- Verified real local HTTPS transport and actual network-disabled Chromium against healthy and seeded-defect fixtures. A TLS fixture initially failed certificate verification; explicit private-CA configuration fixes trust without disabling certificate/hostname checks. Temporary diagnostic output was removed.
- Added audited, one-day break-glass owner recovery for expired/lost owner credentials.

## Delivered versus still required

| Workstream | Implemented in this delivery | Not established / intentionally unavailable |
| --- | --- | --- |
| 1. Secure onboarding | Scoped projects; Owner/Admin/Member app credentials and CI/runner machine credentials; revocation/expiry; HTTPS allowlist; worker-side secret references; lockdown; authenticated super-admin organization creation and audited owner recovery | Enterprise SSO, tenant-scoped ingestion and legacy chat, external vault integration, infrastructure deployment/security review |
| 2. Execution | Approved offline UI automation, read-only HTTPS JSON assertions, bounded workers, immutable run snapshots, CI exit status/JUnit | Live authenticated browser flows, mobile/native, mutating API tests, arbitrary repo builds, environment/data provisioning and rollback |
| 3. QAE/AUE reliability | Existing evidence-bound proposal harness connected to reviewed suites; declared coverage gaps; deterministic assertion/error classification; assertion-preserving maintenance revisions | General product understanding, automatic root-cause diagnosis, autonomous code/selector repair, proof that mapped requirements are fully tested |
| 4. Accuracy proof | Evaluation tool with explicit denominators/missing data; healthy/defective execution fixtures; regression gates | Real-organization labeled benchmark, longitudinal reliability, provider/model accuracy and end-to-end business defect recall |
| 5. Operations | Quotas; one active suite per project; deadlines/no replay; cancellation/pause; audit events; uncertainty attention list; fail-closed CI; authenticated super-admin recovery | Deployed alert transport, independent watchdog service, external tamper-evident audit archive, fleet/availability/load testing |

This is an autonomous runner for **approved, bounded scopes**, not an autonomous replacement for every QAE/AUE. Approval and environment ownership remain human responsibilities. Unsupported work escalates; it is not silently marked complete.

## Verification

See the final verification entry in `autonomy-operations.md`. Tests use disposable databases, synthetic requirements, controlled model proposals, a local TLS API and static browser fixtures. No customer environment, production migration, real provider benchmark or hosted GitHub Actions run was performed.

## Files and boundaries

- `apps/api/src/modules/autonomy/`: project authorization, suite contracts and durable orchestration.
- `apps/api/migrations/20260928-autonomy.sql`: additive, rerunnable production tables.
- `agents/shared/harness/autonomy.py`: read-only API adapter, suite worker and CI client.
- `agents/shared/harness/evaluation.py`: labeled evaluation gate.
- `apps/api/test/integration/autonomy.test.ts`: real HTTP/PostgreSQL/TLS/Python/CI tests.
- `apps/api/test/integration/browser-execution.test.ts`: project scope and real Docker browser handoff.
- `agents/tests/test_autonomy.py`: adapter, security bounds, retry behavior, evaluation and JUnit tests.
- `.github/workflows/autonomy.yml`: repeatable fixture-based regression workflow.
- [Operator runbook](autonomy-operations.md): configuration, API contracts, onboarding, CI, recovery and limitations.
