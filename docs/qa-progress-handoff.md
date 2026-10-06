# QA skills — progress handoff

Updated: 2026-10-04
Repository: `/Users/siam/Developer/ultimate-qa-agent`

## Resume here

**All nine core C4 skills now have a first implementation**, including `maintain_automation` (AUE) and `assess_release_readiness` (QAE). See [automation maintenance and release readiness](qa-release-and-maintenance.md). **Next: enroll a real repository/suite/release policy and connect the pipeline (selection → execution → findings → repair/retest → coverage → release) to validate the complete Phase 1 journey; see "Core integration and setup gaps" and "Acceptance work" below.**

The agreed sequence is **core capabilities → deepen existing skills → specialist packs**. Phase 1 is still open. Implementation and catalog registration do not mean live execution has been validated.

## Done

### Shared architecture and agent settings

- Skill registry with typed inputs, role assignments, model/effect policies, declared operations and LangGraph factories.
- Distinct skill and tool names: skills compose reusable executable operations.
- Common agent/MCP dispatch: `list_skills`, `run_skill`, `get_skill_run`, resource discovery, execution lookup and cancellation.
- Super QA delegates QA work to QAE/AUE and retains platform coordination responsibilities.
- Settings expose actual wired skills/tools and provider-discovered model choices; MCP tab removed.
- Immutable app-scoped workflow artifacts, local durable publication outbox, shared retrieval, job references and result views.

### Implemented skills

**Both QAE and AUE:**

- `check_test_readiness`
- `prepare_test_data`
- `test_api`
- `investigate_defect`
- `select_regression_tests`
- `analyze_coverage`
- `build_test_matrix`
- `execute_browser_test`
- `browser_execution_status`
- `explore_app`
- `analyze_failures`

**QAE only:** `review_requirements`, `plan_tests`, `design_test_cases`.

**AUE only:** `inspect_framework`, `generate_automation`, `run_automation_suite`, `maintain_automation`.

**QAE only (new):** `assess_release_readiness`.

Latest running catalog: **15 skills per expert, 19 unique skills**. Explicit deterministic workflows bypass conversational reasoning. Requirement semantic review and missing case-step drafting retain bounded, opt-in model use.

### Core implementation slices

| Slice | Implemented |
| --- | --- |
| C0 — Foundation | Artifact publication/retrieval, scoped resources, durable jobs, operation traces and idempotency policies |
| C1 — Inputs/readiness | Requirement review, versioned requirement/case handoff, readiness snapshots |
| C2 — Execution/data | Deterministic fixture preparation; worker-owned dataset leases and cleanup; pinned Playwright/Cypress repository execution; attempt reports and recovery |
| C3 — API/defects | Approved bounded API sequences, exact response/schema assertions, request chaining, negative/auth cases, revision probes, cleanup; evidence collection and optional single reproduction job |
| C4 — Complete | Regression selection, pinned case-to-test links and optional app revision probes for repository jobs; validated repair-patch maintenance in a disposable checkout; release-gate readiness evaluation |

### Most recent changes

- `maintain_automation` (AUE): rejects a proposed selector/fixture/setup repair unless every originally present assertion's expectation (selector/locator calls collapsed before comparison) is still present and no skip/only marker was introduced; otherwise queues or reads back one validated patch job. The repository worker applies the reviewed diff to the disposable `git archive` checkout before it is bind-mounted read-only, and reports a `repairPatchHash` that `repositoryResult` must match for the run to read as complete.
- `assess_release_readiness` (QAE): evaluates a configured release-gate policy against fresh, owned suite jobs at a candidate revision plus pinned coverage/finding artifacts. Stale, pending, revision-mismatched or unexecuted mandatory gates force an explicit `incomplete_evidence` recommendation rather than a guess; `release_authorized` is always `false`.
- New configuration: `QA_RELEASE_POLICIES` (grant profile IDs through `release_policies` workflow resources); repository profiles may declare `allowedRepairPaths`; `StartAutonomousRunDto`/`qa_autonomous_runs` carry an optional pinned `repairPatch` (additive migration `20261104-repository-repair-patch.sql`).
- See [automation maintenance and release readiness](qa-release-and-maintenance.md) for the full contract, worker changes and invocation examples.
- `select_regression_tests` reads exact Git commit changes and pinned requirement/case artifacts, then resolves approved repository suites.
- Mandatory smoke and affected tests are retained. Missing impact/case mappings select all configured suites.
- Selection currently operates on **whole approved suites**. Budget overruns are explicit; required tests are not silently removed.
- Repository profiles can pin a published case artifact and map case IDs/revisions to expected framework test IDs.
- Repository profiles can specify an HTTPS target origin, expected app revision and revision probe. Instrumented jobs check the configured origin before and after execution.
- `run_automation_suite` requires matching `expected_target_revision` for instrumented profiles. Legacy profiles remain supported without app revision evidence.
- Result views expose selection reasons, omitted suites, budgets, revision observations and case links.
- New configuration: `QA_REGRESSION_PROFILES`; grant profile IDs through app `regression_profiles` resources plus underlying repository/suite access.

## What's left

### Core integration and setup gaps

- Enroll a real repository, exact revision, approved suites and dependency/runner image.
- Configure a target environment, revision endpoint, fixture lease service and API profiles.
- Configure at least one repository profile's `allowedRepairPaths` and one release policy (`QA_RELEASE_POLICIES`) against real suites.
- Publish reviewed source requirements/cases and configure actual impact/case mappings.
- Implement shared evidence export/retrieval for raw reports, logs, screenshots and traces.
- Connect selection → execution → findings → repair/retest → coverage → release assessment through the platform pipeline.
- Reconcile legacy QA record ownership/app scope.
- Integrate readiness snapshots with execution admission where still advisory.

### Acceptance work — not yet performed

- Real Playwright and Cypress adapter runs.
- Positive, negative, authorization and mutating API scenarios.
- Healthy/seeded-defective application outcomes and reproduction comparisons.
- Scope isolation, stale revisions/artifacts, missing reports and zero-test handling.
- Cancellation, worker restart, completion retries and cleanup recovery.
- Regression selection for renames/deletions, unknown impact, mandatory scope and budget overruns.
- A real repair patch applied, validated (passing) and rejected (weakened/skip/widened) through the actual durable worker and disposable checkout, not just the unit-level diff/manifest checks done so far.
- A real release-gate evaluation against actual suite jobs: stale evidence, revision mismatch, missing mandatory gate, and open-finding-count rejection.
- Published artifact retrieval and the full Phase 1 UI/pipeline journey.

**No real repository, API suite or regression policy is enrolled locally.** Herdly (`https://herdly.byoursidee.com`, no login supplied) remains an observation target. No mutating test expectations or dataset service have been inferred from that URL.

### After Phase 1

- **Phase 2:** richer case-design techniques, framework-aware generation, charter-based exploration, deeper coverage/matrix strategies, and richer failure evidence correlation.
- **Phase 3:** specialist packs, according to the roadmap.

## Important implementation limits

- Case/test semantic mappings are operator-declared; matching test identities does not prove behavioral coverage.
- Revision probes observe the configured origin at two instants. Approved repository configuration must actually target that origin; probes do not inspect every request made by project code.
- Legacy repository jobs without observed app revisions remain incomparable for strict reproduction.
- Defect investigation reports root cause as unproven. It does not publish external issues.
- API schema assertions implement a bounded subset, not full JSON Schema.
- Regression selection currently supports one configured repository and whole repository suites; it does not execute its recommendation.
- Automation maintenance's assertion-preservation check is deterministic text comparison (selector calls collapsed, expectation text otherwise compared verbatim), not semantic equivalence; it can reject a valid rewrite that doesn't match this shape.
- Release readiness coverage reflects designed cases per criterion, not executed/evidenced coverage; finding state reflects the pinned investigation outcome at read time, not an independently re-verified fix.

## Checks completed

Latest slice: API TypeScript build (`npm run build -w apps/api`, `src/` only — `tsconfig.json`'s full `test/` tree has pre-existing unrelated errors), Python module compilation, full catalog/graph construction for both new skills (and all existing ones), and hand-built unit checks of `apply_repair_patch` (git-apply confinement, path/hash rejection) and `compare_assertion_manifest` (safe selector repair accepted; removed assertion, added skip marker, widened timeout all rejected) all passed. `python3 -m unittest tests.test_skills` was run for regression coverage: 28/32 pass; the 4 failures (`test_expired_invocation_is_not_replayed`, `test_parent_contains_subgraphs_and_explicit_input_skips_model`, `test_superqa_delegates_to_expert_without_an_extra_reasoning_call`, plus one error) are a pre-existing LangGraph nested-subgraph-in-node issue, confirmed independent of this slice by removing the two new skills from the registry and reproducing the identical failure.

**No tests were added; no live QA flows, container runs, fixture provisioning, real patch application, policy evaluation or LLM calls were performed for the recent implementation slices.** Continue respecting the instruction not to add/run tests unless the user requests testing or verification.

## Local environment and working tree

- Agent runtime: `http://127.0.0.1:8010`; restart it after Python changes (no autoreload).
- **Port 8000 belongs to an unrelated repository — leave it alone.**
- Python environment: `/tmp/superqa-workflows-venv/bin/python`.
- Runtime command from repo root:

  ```sh
  /tmp/superqa-workflows-venv/bin/python -m uvicorn main:app --app-dir agents --host 127.0.0.1 --port 8010 >> agents/.qa-workflows/runtime.log 2>&1
  ```

- API: port 4000 with development autoreload.
- `/agents/qae/settings` and `/agents/aue/settings` expose the running catalog. Internal `/workflows/*` HTTP routes require `QA_WORKFLOW_KEY`, which was not configured in the last inspection; agent dispatch does not use that route.
- The working tree contains extensive pre-existing modifications/untracked files. Preserve them; do not reset, clean, stash or assume all changes belong to this slice. No commits were created for these slices.
- Calendar/card requests were corrected by the user; no calendar redesign was performed.

## Files to start with

- [Roadmap](qa-package-roadmap.md)
- [Implemented skill catalog](qa-skills.md)
- [Foundation and readiness](qa-phase-1-foundation.md)
- [Requirement review/handoff](qa-requirement-review.md)
- [Repository execution/data](qa-repository-execution.md)
- [API testing/investigation](qa-api-investigation.md)
- [Regression selection/traceability](qa-regression-selection.md)
- [Automation maintenance/release readiness](qa-release-and-maintenance.md)

Implementation locations:

- `agents/shared/skills/registry.py`, `operations.py`, `capabilities.py`, `runtime.py`
- `agents/shared/skills/regression.py`, `release.py`, `maintenance.py`, `investigation.py`, `suites.py`, `handoff.py`
- `agents/shared/harness/repository.py`, `revisions.py`, `api_flow.py`, `repository_runner/`
- `apps/api/src/modules/autonomy/repository.contract.ts`, `api-flow.contract.ts`, `autonomy.service.ts`, `autonomy.dto.ts`, `autonomy.entity.ts`
- `apps/api/migrations/20261104-repository-repair-patch.sql`
- `apps/web/components/WorkflowArtifacts.tsx`
