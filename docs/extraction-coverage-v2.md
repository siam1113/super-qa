# Extraction coverage v2 — section-aware, field-grounded proposals

Implemented 2026-09-28. This extends the [v1 evidence milestone](./extraction-evidence.md). The current extraction version is `grounded-sections-v2`. This is still a bounded deterministic extractor, not a general document-understanding agent.

## What changed

The public interface remains `extractGrounded(document, provider)` plus `assertExtractionEvidence(result, document)`. A pure internal parser, `extraction-candidates.ts`, handles source segmentation and candidate construction. The outer module owns provenance, deduplication, budgets, provider validation and evidence reconstruction. Both receipt admission and final publication use the same reconstruction contract.

Active output now covers six types: rules, requirements, APIs, numeric facts, flows and test cases. No broad legacy extractor was re-enabled. Entity extraction remains deferred until an appropriate schema/AST parser and field-level gold labels are available.

### Unlabeled requirements

Standalone statements such as `Users must authenticate before checkout.` now become inferred requirements without requiring a `Requirement:` prefix. This is **syntax recognition**, not general inference.

The accepted subject list is deliberately bounded: users, guests, administrators, customers, clients, servers, or optionally `the` followed by system/application/service/platform. Singular/plural forms are supported where applicable. A statement must use `must` or `shall`, end in `.` or `!`, and contain no question mark. Negation is preserved. Bullets are supported. Explicit rule/requirement forms retain their prior behavior except that questions now abstain.

Unknown actors, reported speech, speculative text and arbitrary prose remain outside this parser. Explicit rules are not duplicated as requirements. Opposing statements remain separate proposals; no conflict is silently resolved.

### Numbered workflows

Accepted headers include `Flow: Checkout`, `Workflow: Checkout`, and `Checkout flow:`; an ATX Markdown heading prefix is optional. A flow requires at least two consecutive numbered steps starting at 1, using `1.` or `1)` syntax.

The parser takes only the immediately following contiguous block. Blank lines, Markdown headings, excluded regions or another recognized flow/scenario header end that block. Broken numbering, non-step body text or incomplete flows abstain as a whole. There is no scan into an arbitrary following 2,000-character window and no invented actors, conditions or alternative paths.

### BDD scenarios

`Scenario: Declined payment` followed by explicit `Given`, `When`, `Then` clauses produces a `test_case` proposal:

- `Given` and its `And`/`But` clauses become ordered preconditions.
- One `When` phase and its continuations become one action string.
- One `Then` phase and its continuations become the expected-outcome string.
- Continuations are joined with LF; keyword text is removed, but negation and remaining text are preserved.

This first subset requires all three phases in order. Multiple action/outcome cycles, missing outcomes, scenario outlines/placeholders, backgrounds, tables and docstrings are not inferred. A scenario never receives a generated expected outcome or automation status. These proposals are not executable tests and have no pass/fail verdict until an agent supplies an approved execution plan and runtime oracle.

Block keywords use `Given`/`When`/`Then`/`And`/`But` capitalization. Blank lines within a scenario are outside the initial supported format; abstention is preferred to attaching a later unrelated outcome.

## Field-level evidence

All existing evidence identifiers, content/revision hashes and exact parent quotes remain. Each evidence occurrence now also has `fields[]`, with:

```json
{
  "path": "/content/steps/0/expected",
  "start": 84,
  "end": 103,
  "quote": "no order is created"
}
```

The numbers are illustrative. Real offsets are calculated from the original document, using zero-based, end-exclusive UTF-16 positions. Field paths use JSON Pointer notation. The parent evidence supplies source/document/revision identity. Fields are checked against the full source snapshot, not a normalized copy.

One field may cite multiple spans: API display names combine method/path; a BDD action or expectation can combine continuation clauses. Step order is either parsed from workflow numbering or structurally assigned as 1 for the single BDD step. Empty rule conditions and structural step indices do not imply source assertions. Full descriptions are source text; display names can be capped at 200 characters. Field mappings describe these deterministic transformations, not arbitrary model paraphrases.

Reconstruction checks both the complete structured claim and the entire evidence mapping. Changing a nested expected outcome, moving a field span, deleting a citation or injecting a verification field fails. Canonical comparison now recursively handles PostgreSQL JSONB key reordering in nested objects and arrays; array order remains significant.

Two different claims with the same `(type, name)` within one document now **fail before provider spending**. The current persistence identity otherwise risks overwriting one with the other. Give distinct scenarios/workflows distinct names. Even formatting-only differences in descriptions may trigger this conservative conflict check. Exact duplicates still merge evidence and validate once.

## Scope and budget safeguards

- Existing 1,000,000-code-unit document, 2,000-code-unit single-line claim, 64 local candidate and 16 paid-call limits remain.
- A structured block has at most 50 body lines and 8,000 UTF-16 code units including its header. Overflow fails, not truncates.
- Remote providers receive the complete bounded candidate block and its correct validation type (`test_case` maps to `testCase`). No separate explanation calls are added.
- Existing deadlines, disabled SDK retries and usage reporting remain. No live paid-provider calls were used for validation of this milestone.
- Fenced/indented code, blockquotes, and example/draft/deprecated sections remain excluded. Nested excluded sections cannot accidentally reopen a still-excluded parent. A fence closes only on a matching standalone delimiter.

These rules are not a complete semantic or prompt-injection defense. A syntactically supported source can be wrong or malicious. All generated items remain inferred and unverified; reviewed items and stale-evidence handling retain the v1 lifecycle.

## Evaluation results and limitations

Two checked-in synthetic corpora are used. Neither is a held-out customer benchmark.

| Corpus | Measure | Result |
| --- | --- | --- |
| Original 20 documents, unchanged source texts | Type-level positive matches | 11 / 12, up from 8 / 12 in v1 |
| Original corpus | False positives / correct negative abstentions | 0 / 8 |
| New 12 mixed/section documents | Exact type + name + structured-content matches | 11 / 13 gold claims |
| New corpus | False positives / correct negative documents | 0 / 3 |
| Both | Model calls | 0 |

The original corpus measures 91.7% recall at its coarse type-label level. The new corpus measures 84.6% claim recall with exact structured-content matching. Precision of emitted claims is 100% on these fixtures only. The remaining misses are explicit coverage gaps: an entity and an unknown requirement actor. Evidence reconstruction and each field's exact quote are checked separately. These are regression results, **not production accuracy estimates**. No representative organization documents were supplied during implementation.

Additional tests cover malformed BDD, missing oracles, numbering gaps, scope boundaries, name collisions, CRLF/Unicode, block budgets, provider type mapping and JSONB round trips. Integration tests run actual extraction through the worker and verify publication rollback after persisted expected-outcome or field-span corruption.

Run the same commands as the v1 evidence guide:

```sh
npm test -w apps/api -- --runInBand --silent
docker compose -p qa-pipeline-tests -f docker-compose.pipeline-test.yml up -d --wait
npm exec -w apps/api -- jest test/integration/pipeline-recovery.test.ts --runInBand --silent
docker compose -p qa-pipeline-tests -f docker-compose.pipeline-test.yml down --volumes
```

## Rollout and next gates

The version bump changes processing configuration hashes, so successful v1 documents are eligible for reprocessing. Stop old workers and cancel old active jobs before starting v2 syncs; do not mix versions within an in-flight job. No new database schema migration is required. Existing v1 receipts are not accepted as v2 evidence. Previously reviewed content remains reviewed but gets the existing needs-review marker when its source revision changes.

Before broad rollout, obtain representative anonymized documents, label exact expected claims/fields and reserve a held-out split. Extend document formats and actor coverage against that corpus, rather than removing abstention safeguards. Organization ACL-scoped retrieval, evidence review UI, source authority/conflict policy, AST-backed entities, general model candidate generation and durable organization-wide cost accounting remain pending. Repository-wide TypeScript build failures recorded in the implementation log are still separate blockers.
