# QA package implementation roadmap

Status: Phase 1 started. Foundation/readiness, requirement review, bounded repository/data, API/investigation, regression selection, automation maintenance and release readiness are implemented — all nine core C4 skill contracts now have a first version. The full connected pipeline and acceptance journey remain incomplete. See [implementation status](qa-phase-1-foundation.md).
Date: 2026-10-04.
Requested sequence: **core capabilities → depth of existing skills → specialist packs**.

## Objective and scope

Deliver a usable web/API QA package for QAE and AUE, coordinated by Super QA. Completion means a supported workflow can carry versioned requirements through cases, automation, execution, findings, repair, and release assessment with retrievable evidence.

Initial delivery assumptions:

- Web applications and HTTP APIs are the first supported product types.
- Playwright is the first repository execution adapter. Add Cypress through the same execution interface before closing the core phase; retain existing generation support throughout.
- Reuse the existing agent-browser MCP adapter for exploration and the existing execution/autonomy infrastructure where its contracts fit.
- Herdly (`https://herdly.byoursidee.com`, previously supplied without login) is an observation target. Its expected behavior, repository, test data, and authority for mutating scenarios remain separate inputs; the URL alone supplies none of those.
- Use a controlled local/staging fixture with documented expectations, healthy and defective variants, and test data lifecycle for reproducible acceptance work.
- Native mobile and AI-product evaluation are future extensions beyond these three phases.

This roadmap defines scope and acceptance gates. Implementation progress is recorded separately; planned entries below are not a claim of completed capability.

## 1. Architecture commitments

### Responsibilities

| Element | Responsibility |
| --- | --- |
| Skill | Own a QA outcome, typed inputs/outputs, workflow stages, branches, budgets, and declared tools |
| Tool operation | Perform an executable, reusable action or calculation; use an operation name distinct from a skill name |
| Adapter | Connect an operation to a configured repository, worker, browser, HTTP interface, or specialist engine |
| MCP | Transport to an external capability when useful; use a direct adapter for a CLI or internal interface when simpler |
| QAE | Requirement interpretation, test design, exploration, risk, coverage, findings, and release recommendations |
| AUE | Framework integration, automation generation/execution, technical investigation, and maintenance |
| Super QA | Delegate to QAE/AUE; coordinate tasks, pipelines, messages, and platform publication within the user's task |

Keep `list_skills`, `run_skill`, and `get_skill_run` as the expert workflow interface. Long-running job lookup/cancellation are tools, not additional QA skills. Existing HTTP/CLI skill identifiers remain stable unless an explicit versioned migration is introduced.

Each new skill has its own subgraph when it has a meaningful workflow. Shared operations stay shared; techniques such as boundary generation and pairwise enumeration live inside relevant skills. Avoid one graph per calculation or one MCP server per skill.

The current generic graph dispatcher can retain simple deterministic skills. As multi-stage skills arrive, register graph factories by skill rather than growing a single conditional dispatcher indefinitely. Factories receive their adapters through dependency injection and expose the same runtime interface.

### Deterministic execution and bounded reasoning

- Deterministic: schema checks, revisions, authorization, resource resolution, data generation from explicit constraints/seeds, execution, assertions, comparisons, coverage arithmetic, selection rules, cleanup, and exit criteria.
- LLM-assisted when needed: semantic ambiguity review, proposed exploratory hypotheses, unsupported case transformations, code proposals, and evidence-grounded explanations.
- Record the model policy per skill, enforce budgets at reasoning nodes, and preserve the current explicit opt-in for missing-step drafting. Explicit structured requests bypass conversational routing.
- Generated expectations must cite requirements or a reviewed oracle. Observed application behavior alone does not establish intended behavior.
- A model cannot turn missing evidence, missing tests, unsupported checks, or infrastructure errors into a pass. Hypotheses remain distinguishable from observations.

### Common records and execution lifecycle

Extend and connect existing QA/autonomy records before creating another authoritative store:

`Requirement revision → case revision → automation revision → execution attempt → evidence → finding → repair/retest`

Also retain dataset leases, environment/app revisions, regression selections, and release assessments. Shared references carry app scope, artifact ID/type/schema version, content hash, producer/version, creation time, and source/run links. Result payloads remain typed by skill; large evidence is referenced rather than embedded in tool responses.

PostgreSQL owns shared app records and durable jobs; configured object storage owns large artifacts. Existing local SQLite skill artifacts can remain for standalone/local invocation and backward retrieval. The integration must define publication receipts and authoritative IDs so the same result is not independently editable in two stores.

Before linking existing QA records, verify their authenticated app ownership and add required scope fields/migrations. Legacy records without resolvable ownership must stay excluded from app discovery until explicitly mapped. Do not infer ownership from model input.

Separate:

- **Workflow state:** running, blocked, failed, interrupted, or artifact completed, with a referenced job for asynchronous work.
- **Execution state:** queued, running, completed, cancelled, or interrupted.
- **QA verdict:** passed, failed, error, blocked, skipped, or not run, plus separate mixed-attempt/flakiness metadata.

The current skill runtime has a 120-second deadline. Suite, performance, and extended specialist work must submit durable jobs and return references; raising that timeout is not the persistence design. Pipelines wait on authoritative job state and evidence before advancing. `get_skill_run` retrieves the invocation artifact; execution lookup retrieves current job state.

Use the existing durable admission/claim/lease patterns. Do not make the legacy in-memory runner queue the source of truth. Preserve attempt history, cancel on the worker, fence late completion, and reconcile interrupted jobs. Do not automatically replay uncertain mutations. Extend stable request-ID requirements to all new side-effecting invocations using declared effect policy, rather than adding more name checks to `requires_request_id`.

## 2. Current baseline and reuse

| Existing implementation | Reuse | Gap addressed by this roadmap |
| --- | --- | --- |
| `agents/shared/skills/` | Ten workflows, strict inputs, scoped artifacts, operation registration/traces, deterministic calculations | Richer outcome contracts, artifact handoff, new graphs and operations |
| `agents/shared/mcp/agent_browser/` | Scoped browser observations and explicit actions | Exploration strategies and richer evidence; no fabricated test verdicts |
| `agents/shared/harness/autonomy.py` | Bounded HTTP assertions, durable control-plane worker integration, JUnit export | General API workflows and repository suite execution |
| `agents/shared/harness/live.py` | Namespaced provisioning, cleanup journal, approved live profiles | Reusable dataset lease interface, connected to new skills |
| `apps/api/src/modules/qa/` | Persisted cases, manual observations, review and healing records | Scope/revision reconciliation, automation/finding links, durable shared artifacts |
| `apps/api/src/modules/autonomy/` | Scoped projects, suite admission, claims, immutable observations, policy | New execution kinds and evidence contracts where appropriate |
| `agents/shared/runner/` | Existing runner adapter behavior | Reconcile/delegate through durable jobs; avoid a parallel queue |
| Agent settings and platform UI | Actual skill/tool catalogs, role assignments, model selection | New artifact views, job progress, capability/configuration status |

Implementation must inspect each existing interface before extending it. Historical delivery documents describe different bounded pilots and do not establish that all paths are interchangeable or configured for a real app.

## 3. Phase 1 — Complete the core QA loop

### Delivery order

| Milestone | Deliverables | Depends on |
| --- | --- | --- |
| C0 — Shared contracts and execution foundation | Versioned artifact references; scoped publication; job submit/lookup/cancel; durable worker handoff; budgets and effect policy | Existing registry, QA and autonomy infrastructure |
| C1 — Inputs and readiness | `review_requirements`, `check_test_readiness`; shared requirement/case references | C0 |
| C2 — Reproducible execution | `prepare_test_data`, `run_automation_suite`; Playwright first, then Cypress; evidence ingestion | C0, C1 |
| C3 — API and defect loop | `test_api`, `investigate_defect`; reproduction attempts and findings | C1, C2 |
| C4 — Change and release loop | `select_regression_tests`, `maintain_automation`, `assess_release_readiness`; connected pipeline and artifact views | C2, C3 |

All nine core skills below belong to Phase 1. Their first versions have deliberately bounded scope; Phase 2 improves breadth and sophistication.

### Core skill contracts

Operation names below are proposed examples. They enter discovery only when executable bindings and workflow integration exist.

| Skill / owner | Input → output | Initial implementation and shared operations | Acceptance criteria |
| --- | --- | --- | --- |
| `review_requirements` / QAE | Requirement revisions and sources → cited issues, unresolved questions, testability report | Deterministic structure/link checks; bounded semantic review for ambiguity/contradictions. Operations: `resolve_requirement_revision`, `validate_criteria_structure`, `propose_requirement_findings` | Missing expectations are reported; supplied facts and proposed interpretations are distinct; each semantic finding cites evidence; new source revisions invalidate stale assessments |
| `check_test_readiness` / Both | Environment, suite/skill, target revision, resource needs → readiness snapshot with blockers and expiry | Probe configured endpoints, resolve credentials by reference, inspect runner/framework availability, verify expected app revision and data requirements. Operations: `probe_target_health`, `check_runner_capability`, `compare_target_revision` | Healthy, missing-resource, unavailable, and revision-mismatch cases produce distinct outcomes; admission rechecks mutable prerequisites; no credentials appear in artifacts |
| `prepare_test_data` / Both | Reviewed blueprint, synthetic seed, environment → dataset lease and cleanup receipt | Extend existing namespaced provisioning/journal; expose acquire/release/recovery through shared operations. Operations: `generate_fixture_values`, `acquire_dataset_lease`, `release_dataset_lease` | Identical logical request does not create duplicate data; concurrent runs are isolated; cleanup occurs on success/failure/cancellation and can recover after interruption |
| `run_automation_suite` / AUE | Repository revision, configured framework/run profile, selected tests, optional reviewed patch, environment/data references → execution job and per-attempt results | Isolated checkout and worker; configured dependency setup; bounded framework invocation; report/evidence ingestion. Operations: `prepare_execution_checkout`, `invoke_framework_runner`, `ingest_execution_report` | Real repository tests execute for both supported adapters; expected/discovered/executed counts reconcile; zero tests and missing reports do not pass; retries retain earlier failures; cancellation/restart and artifacts remain visible |
| `test_api` / Both | Target profile, versioned request scenarios, expected assertions, data/auth references → per-step observations and verdicts | Extend existing HTTP assertions to schemas, explicit business assertions, request chaining and scoped mutations with cleanup. Operations: `send_scoped_http_request`, `evaluate_response_assertions`, `validate_response_schema` | Checks cover a positive flow, negative input, access denial and a data-changing flow on the fixture; transport errors differ from assertion failures; expectations come from supplied contracts; cleanup is accounted for |
| `investigate_defect` / Both | Failed execution and related case/app/data revisions → evidence-backed finding, reproduction status, competing hypotheses | Correlate artifacts, compare attempts, run a bounded reproduction via existing execution tools, assemble draft report. Operations: `read_execution_evidence`, `compare_execution_attempts`, `assemble_defect_report` | Reproduced, not reproduced and blocked are distinct; exact attempt/revision links and expected/actual behavior exist; root-cause claims require supporting evidence; external issue publication is a separate platform action |
| `select_regression_tests` / Both | Change set, explicit dependency/requirement links, suite catalog, risk and run budget → selected tests, reasons, omissions and mapping gaps | Deterministic mapping and mandatory-smoke rules first; select conservatively when mappings are incomplete. Operations: `read_revision_diff`, `resolve_impacted_cases`, `rank_regression_candidates` | Known affected and mandatory tests remain selected; unknown impact triggers an explicit broader fallback/blocker; output includes omitted scope and budget effects; selection does not claim complete coverage |
| `maintain_automation` / AUE | Failed test, repository revision, original assertions, evidence → proposed patch, before/after results and review decision | Initially supported selector/fixture/setup repairs; bounded code proposal if needed; validate in disposable checkout with the suite runner. Operations: `compare_assertion_manifest`, `prepare_patch_candidate`, `validate_patch_candidate` | Supported repair resolves a demonstrated test defect; removing assertions, skipping tests, changing expectations or widening tolerances cannot qualify as maintenance; unknown equivalence requires review; no automatic merge or baseline approval |
| `assess_release_readiness` / QAE | Candidate app revision, scope, execution evidence, defects and explicit exit policy → recommendation, unmet gates and residual risk | Deterministic revision/freshness checks and policy evaluation; optional evidence-grounded summary. Operations: `resolve_release_evidence`, `evaluate_exit_criteria`, `assemble_release_assessment` | Stale runs cannot satisfy current gates; failed, skipped, blocked and unexecuted cases remain visible; insufficient evidence yields an explicit incomplete recommendation; release authority remains a platform/user decision |

### Core integration details

- Repository execution handles application code in an isolated worker. Commands come from configured framework profiles with structured arguments; models cannot supply arbitrary host shell commands. Lockfile/install/runtime identity is captured with results.
- Reviewed generated patches may be applied to a disposable checkout in C2. Publishing or merging the patch is separate. Deeper project-specific generation belongs to Phase 2.
- Data setup/cleanup is shared by browser, API, repository, and later specialist workflows. Skills pass lease references instead of copying credentials or mutable datasets.
- Case IDs must map to actual discovered framework test identities and revisions. A manually supplied traceability link is distinguishable from a validated mapping.
- Findings live as scoped artifacts before any external tracker integration. Super QA can publish them through configured platform operations when the user's task authorizes that action.
- The settings catalog exposes only wired skills/tools. Resource readiness is represented separately from registration; an installed adapter is not evidence that a target is configured.

### Phase 1 exit gate

A connected pipeline, initiated through Super QA and delegated to QAE/AUE, must:

1. Review versioned fixture requirements and expose unresolved expectations.
2. Reuse the current planning/design skills to create reviewed executable cases.
3. Check readiness and acquire isolated test data.
4. Generate a bounded automation patch or select existing mapped tests.
5. Run a real repository suite and API scenario, retaining evidence and attempts.
6. Detect a seeded product defect and produce a reproducible finding.
7. Demonstrate a separate supported automation repair without weakening the oracle.
8. Rerun against the fixed app revision, update coverage and produce a release assessment.
9. Preserve results across worker interruption and report outstanding cleanup.

The fixture's healthy and known-defective outcomes must be independently labeled. Both framework adapters must satisfy the core execution interface before the phase closes. Report limitations and counts; do not extrapolate fixture success to general product accuracy.

## 4. Phase 2 — Deepen existing skills

Begin after the complete core loop is accepted. Minimum changes necessary for Phase 1 integration can happen in Phase 1; the enhancements below remain Phase 2 work.

| Milestone / skills | Planned depth | Dependencies | Acceptance criteria |
| --- | --- | --- | --- |
| D1 — `design_test_cases`, `plan_tests` | Explicit boundary values, equivalence partitions, negative paths, decision tables, state transitions, data constraints, duplication review; risk/scope choices with source rationale | Requirement review, versioned cases and datasets | Given explicit limits/rules, deterministic strategies produce the expected cases; unspecified rules become questions; every case has an oracle and provenance; semantically suggested cases remain reviewable |
| D2 — `inspect_framework`, `generate_automation` | Inspect existing fixtures, page objects, helpers, setup, naming, assertion styles and test data conventions; reuse them in minimal patches; validate generated output through the suite runner | Core repository worker and case/test mapping | Representative Playwright and Cypress projects with custom fixtures/helpers produce compatible patches; unknown patterns are reported; build/run evidence and assertion preservation accompany the patch |
| D3 — `explore_app` | Charters, explicit hypotheses, journey/state discovery, evidence-linked findings and bounded follow-up selection; optional reasoning between observation batches | Requirement review, dataset leases, finding records | Report visited/unvisited states, actions, stop reasons and evidence; replay a discovered issue; distinguish intended navigation from consequential writes; traversal does not imply a test pass |
| D4 — `analyze_coverage`, `build_test_matrix` | Requirement revision awareness; separate designed/automated/executed/evidenced coverage; constrained pairwise strategy; execute selected browser/environment combinations | Artifact links, suite/API execution and actual framework projects | Stale mappings/runs are excluded from current coverage; each denominator is shown; pairwise output meets feasible pair obligations or reports incompleteness; matrix rows map to execution records and unavailable combinations |
| D5 — `analyze_failures` plus integration with `investigate_defect` | Correlate logs, traces, network evidence, revisions, data and attempt history; deterministic signatures first, bounded hypothesis generation second | Evidence ingestion and controlled reproduction | Known product/test/environment failures are distinguished on a labeled cohort; flaky/mixed outcomes preserve all attempts; uncertain cause remains uncertain; investigation owns reproduction/reporting while analysis owns calculations |

Phase 2 exit gate: the Phase 1 journey works across representative supported project patterns, with explicit coverage semantics and measured limits. Evaluate case validity, seeded-defect detection, false passes, false failures, evidence completeness, runtime and actual model use. Publish denominators and unsupported cases; agree numeric quality gates using a reviewed baseline rather than inventing target accuracy now.

## 5. Phase 3 — Specialist packs

A pack groups related skills, shared operations, adapter configuration and reports. It is not necessarily a new agent, graph layer, or MCP server. Deliver packs in the sequence below after Phase 2, allowing product requirements to reorder packs within a wave.

| Wave / proposed skill | Owner | Initial scope and tools | Prerequisites and exit criteria |
| --- | --- | --- | --- |
| S1 — `assess_accessibility` | Both | Automated accessibility engine through the browser worker, keyboard journeys, focus observations, manual-review checklist | Stable browser/data setup and evidence capture; known violations are detected, unsupported/manual checks remain explicit; no claim of complete accessibility conformance from a scan |
| S1 — `compare_visuals` | AUE | Deterministic captures and image comparison by app revision/browser/viewport; reviewable baseline proposals | Controlled fonts/time/data and approved baselines; a seeded visual change is detected; missing baseline is pending review, and normal execution cannot approve a new baseline |
| S1 — `test_compatibility` | Both | Execute mapped journeys across supported browsers/viewports and configured locales/time zones, including formatting and RTL checks | Executable matrix from D4; unsupported combinations remain visible; each reported result names the actual runtime; viewport emulation is distinguished from a real device |
| S2 — `verify_contracts` | AUE | Schema compatibility and consumer/provider interaction verification, starting with the app's actual service style | API execution, versioned contracts and provider fixtures; detect a known breaking change; schema-only validation is labeled separately from consumer-driven verification |
| S2 — `check_data_integrity` | Both | Read-only invariant/reconciliation checks and migration scenarios against disposable database copies | Dataset lifecycle, scoped database adapter and known invariants; detect a seeded inconsistency; compare before/after migration; store redacted evidence and prove cleanup |
| S2 — `assess_security_controls` | Both | Reviewed role/tenant permission matrices, authentication/session expectations, sensitive-data exposure checks; supported scanner integration only for a defined scope | Distinct role fixtures and isolated target profiles; detect seeded cross-role/cross-tenant access defects; scanner results carry coverage limits; intrusive checks require an explicitly enabled execution profile |
| S3 — `measure_performance` | AUE | Versioned load/scenario definitions, latency/error/throughput measurements, deterministic thresholds, baseline comparisons | Stable environment/dataset/workload and resource budgets; retain workload and system context; known threshold violation fails; incomplete/aborted measurement is not a pass |
| S3 — `exercise_resilience` | AUE | Controlled dependency faults, timeouts, retries, interrupted jobs and recovery scenarios | Isolated fault-injection adapters, observability and guaranteed restoration; demonstrate expected failure/recovery and verify restoration; uncertain restoration blocks completion |

### Tool integration decisions

- Use the installed repository framework and record its version rather than silently upgrading to the latest CLI. The Playwright CLI exposes test selection, project selection, reporting, retries and traces; map the configured version's supported options into the execution adapter. [Playwright CLI](https://playwright.dev/docs/test-cli).
- Accessibility automation must retain manual-review gaps; browser automation cannot detect every accessibility violation. [Playwright accessibility guidance](https://playwright.dev/docs/accessibility-testing).
- Consider Pact when consumer/provider contract testing fits the application. Select the concrete adapter during S2 enrollment based on actual service topology. [Pact introduction](https://docs.pact.io/).
- k6 is a candidate performance adapter with explicit metric thresholds; pin and validate the chosen version during S3. [k6 thresholds](https://grafana.com/docs/k6/latest/using-k6/thresholds/).
- Existing browser MCP remains the exploration transport. New specialist CLIs can run through configured workers without introducing a dedicated MCP server for each one.

Phase 3 exit gate: each enabled pack has a configured target, a positive and known-defective acceptance scenario, versioned artifacts, deterministic result rules, and integration with coverage/release assessment. A pack with unmet prerequisites remains unavailable for execution even if its implementation is installed.

## 6. Definition of done for every delivery slice

1. Typed input/output contracts, role assignment, effect/model policy and declared executable operations.
2. Resource scope and actual adapter configuration resolved by the runtime.
3. Explicit success, blocked, unsupported, error, cancellation and partial-result semantics as applicable.
4. Stable request IDs, durable job references and recovery rules for side effects.
5. Versioned artifacts with provenance, assertion expectations, observed results and evidence references.
6. Settings reflect actual wiring and shared-tool relationships; relevant result/progress views read persisted records.
7. Acceptance scenarios recorded for the skill and its integration path; no passed-workflow/passed-test ambiguity.
8. Documentation, migration/backward-read behavior, operator configuration and rollback behavior are included.

Proposed future verification layers: deterministic contract/operation checks; real adapter integration against controlled services; healthy/defective end-to-end cohorts; cancellation/restart/isolation checks; app UI artifact retrieval. No new tests are authored or executed as part of this planning task.

## 7. Implementation locations and first slice

| Area | Expected change |
| --- | --- |
| `agents/shared/skills/contracts.py`, `registry.py`, `operations.py` | Artifact references, skill schemas/effects, operation bindings and manifests |
| `agents/shared/skills/graphs.py`, `runtime.py`, new focused workflow modules | Graph factory registration, shared execution handoff, new skill implementations |
| `agents/shared/skills/tools.py`, `shared/mcp/qa/server.py` | Keep common dispatch; add actual generic job helpers only as required |
| `agents/shared/harness/` and `agents/shared/runner/` | Adapt durable execution, datasets, reports, framework workers and recovery |
| `apps/api/src/modules/qa/`, `autonomy/`, migrations | Scoped shared records, artifact publication, jobs, findings and lifecycle contracts |
| `apps/web/components/AgentRuntimeSettings.tsx`, QA/pipeline views | Registered capability/configuration state, job progress, artifacts and evidence links |
| `docs/qa-skills.md`, this roadmap | Keep implemented capability documentation separate from planned milestones |

**First implementation slice: C0 + `check_test_readiness` (foundation subset now implemented).** Define the shared artifact/job contracts, reconcile app scope and current persistence, implement readiness with real configured probes, and expose its persisted result through the existing agent/runtime/settings path. Then add requirement review and move into reproducible suite execution.

Inputs to resolve during implementation, without blocking this roadmap:

- First real repository, revision, supported framework/runtime and configured setup/run profile.
- Reviewed requirements and critical journeys with expected outcomes.
- Test environment identity, app revision source, role fixtures and dataset lifecycle adapter.
- Artifact storage/retention configuration, execution budgets and release exit policy.
- Specialist priorities and representative acceptance data before their wave starts.

No calendar estimates are committed here. Each milestone is sized after its adapter audit, and progress is tracked by accepted outcomes rather than skill count.

## 8. Progress ledger

- Implemented first slice: versioned result references, immutable app publication/outbox, browser harness job references and lookup/cancellation tools, graph factories and effect-based request-ID policy, deterministic readiness, and shared result retrieval/UI.
- Local configuration: `herdly-observation` profile; no live probes run.
- Typed requirement/case handoff is implemented for planning, design and coverage, including scoped shared-store reads and revision checks. C0 remains open for reconciliation of legacy QA record ownership. General repository jobs belong to C2.
- C1: readiness and requirement review are implemented. See [requirement review details](qa-requirement-review.md) for bounds, configuration and unverified acceptance work.
- C2 bounded implementation: deterministic fixture artifacts, worker-owned dataset leases/cleanup, pinned Playwright/Cypress repository jobs, immutable attempt reports and current job UI. See [scope and remaining C2 gates](qa-repository-execution.md). No real repository is enrolled and adapter acceptance has not run; C2 is not closed.
- C3 bounded implementation: approved API sequences, explicit response/schema assertions, target revision checks, worker-owned cleanup, and source/reproduction comparison findings. See [API testing and investigation](qa-api-investigation.md). Live API enrollment and acceptance remain open; C3 is not closed.
- C4 first slice: regression selection from exact Git changes and approved suites, pinned case-to-test links, and configured-origin revision evidence for repository jobs. See [regression selection](qa-regression-selection.md). No selection or execution acceptance has run.
- C4 remaining slice: `maintain_automation` validates a reviewed selector/fixture/setup repair (deterministic assertion-manifest preservation check, then one patch-application job in the existing disposable repository checkout) before any merge decision; `assess_release_readiness` evaluates configured release gates against fresh owned suite jobs, pinned coverage and findings and never authorizes a release itself. See [automation maintenance and release readiness](qa-release-and-maintenance.md). C4 is implementation-complete; no live patch validation or policy evaluation acceptance has run, and connected pipeline handoff remains planned, along with all Phase 2/3 capabilities.
- Acceptance scenarios and the complete Phase 1 journey have not been run.
