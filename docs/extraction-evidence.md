# Extraction accuracy and evidence — first grounded slice

Historical v1 milestone: the current implementation is [extraction coverage v2](./extraction-coverage-v2.md), which adds unlabeled obligations, workflows, BDD scenarios and field-level evidence. The v1 metrics below remain a historical baseline, not current coverage.

Implemented 2026-09-28. This is **not** organization-wide extraction completeness or measured live-model accuracy.

## Decision and architecture

The prior entry point ran twenty regex extractors on every document. Some assembled attributes or steps from unrelated following text, many supplied no source quote, and provider failures fell back to context scores that could pass acceptance. Paid explanations could add unsupported testing semantics. Documents titled `Overview` were skipped regardless of contents.

`BusinessExtractionService.extractFromDocument` now delegates to `extractGrounded(document, provider)`. Candidate construction, deduplication, budgets, provenance and publication checks live in `grounded-extraction.ts`. Existing private broad extractors remain as legacy code but are **not invoked**, including as fallbacks.

This deliberately trades recall for inspectable output. Automatic publication narrows to four forms until other types have evidence contracts and evaluations. This is a behavior change, not completion of the other product requirements.

## Supported input

| Type | Form | Stored claim |
| --- | --- | --- |
| Rule | `Rule: Users must log in.` or `Business rule: ...` | Exact statement as unsplit action; no invented condition |
| Requirement | `Requirement: ...` or `Req: ...` | Exact statement; no guessed category, priority or acceptance criteria |
| API | `GET /v1/users/{id}`; uppercase methods; optional ` - description` | Exact method, path and optional description |
| Fact | `Fact: Session timeout = 30 minutes` | Numeric value and optional unit; name retains the statement |

Rule/requirement statements require `must`, `shall` or `required`. Single-line `-`/`*` bullets are supported. Negation is preserved. Duplicate claims merge evidence occurrences before provider validation; distinct claims remain distinct, including contradictions. Contradiction adjudication is not implemented.

Fenced/indented code, blockquotes, explicit speculative/deprecated/TODO markers, and Markdown example/template/draft/historical sections are excluded. Same-or-higher-level headings end excluded sections. These are conservative syntactic safeguards, **not** complete semantic or prompt-injection defenses. Titles are no longer skip criteria.

HTML, tables, multiline prose, implicit requirements, entities, flows, tests, locators, permissions and relationships need future evidence-aware parsers. `excludedLines` counts nonempty lines outside recognized forms, not missed facts. Completed extraction does not mean exhaustive document understanding.

## Evidence and trust

Automatic items remain `inferred`, unverified proposals with `metadata.extractionVersion = grounded-lines-v1`. Each `metadata.evidence[]` entry contains:

- `sourceId`, `documentId`;
- SHA-256 `contentHash` of the exact input;
- `revisionHash` on the durable path, including snapshot and processing configuration;
- `start`, `end`: zero-based, end-exclusive JavaScript UTF-16 offsets, not byte offsets;
- `quote`: exact span text, preserving leading whitespace and excluding line terminators.

Duplicate statements retain all matching spans. CRLF and Unicode offsets are tested. Display names may truncate; complete statements remain in descriptions/evidence. Scores in `metadata.validation` are classification signals, not calibrated probabilities or verification.

`assertExtractionEvidence` reconstructs permitted claims from the immutable snapshot and checks item fields, identifiers, version, confidence and the complete evidence set. A valid quote cannot support altered item content. This runs before saving durable receipts **and again** inside final publication, including JSONB round trips. Unsupported relationships are rejected.

Evidence proves what a source says, not that it is authoritative, true, current policy or safe to execute. QAE/AUE still need review and deterministic runtime oracles. No evidence viewer or revision-resolution endpoint is added here; quotes and identifiers live in existing metadata and durable snapshots.

## Provider behavior and budgets

- Local mode constructs explicit proposals without model calls or heuristic confidence inflation.
- Remote mode validates grounded candidates, not new generated claims. Only the candidate line is sent. Scores below 60 abstain; accepted items remain inferred.
- Duplicate claims are validated once per document. The active path makes no explanation calls.
- Missing keys, invalid provider selection, transport errors, malformed/empty responses, invalid scores and invalid usage throw. No fallback to local scoring or successful empty extraction. A negative verdict cannot pass via a high numeric score.
- Document limit: 1,000,000 UTF-16 code units. Claim line limit: 2,000. Distinct-candidate limit: 64 locally, 16 remotely. Exceeding limits fails rather than truncates; remote cardinality is checked before spending.
- Sequential calls; a 60-second document deadline checked before/after validation; 30-second provider HTTP timeout; SDK retries disabled. An in-flight call may finish after the deadline, but no further calls launch. Pipeline recovery still applies.
- Provider-reported tokens, calls, candidates, accepted/rejected counts and excluded lines are recorded in receipt reports and aggregated into `SyncJob.metadata.extractionSummary`.

`usageComplete=false` means token totals are partial. Reports cover completed receipts, not calls lost during crashes, failed attempts or retries. Exactly-once billing, cumulative organization budgets and dollar accounting are not implemented. No cost-saving percentage is claimed.

## Revision lifecycle and rollout

The extraction version participates in processing hashes, making previously processed documents eligible for reprocessing. Old in-flight jobs have different configuration: stop old workers, cancel old active jobs and start fresh syncs. No migration beyond the durable-pipeline migration is required.

Successful publication deletes automatic **unverified** items no longer emitted for the document, transactionally; dependent PostgreSQL relationships cascade. Manual items are preserved. Verified/rejected items are not overwritten. Changed revisions retain original reviewed evidence and receive `evidenceStatus: needs-review` plus `currentRevisionHash`. Review status is not silently transferred. Consumers must check this marker; the UI/agent review workflow is outstanding.

**Reprocessing may remove prior broad-extractor proposals for unsupported types. Review/export valuable proposals before rollout.** Neo4j projections are not reconciled here and remain non-authoritative. Source deletions/tombstones and semantic conflict resolution remain separate work.

## Evaluation

`apps/api/test/fixtures/extraction-corpus.ts` contains **20 synthetic, manually labeled examples**, not independent customer data. Unsupported positives remain in the denominator to expose recall gaps.

| Local corpus metric | Result |
| --- | --- |
| Supported true positives | 8 / 8 |
| False positive claims | 0 |
| Precision of emitted claims | 100% (8 / 8) |
| Overall recall | 66.7% (8 / 12 positives) |
| Correct negative abstentions | 8 / 8 |
| Evidence integrity | 8 / 8 emitted claims |
| Model calls | 0 |

These numbers characterize this tiny fixture only, not production accuracy or superiority to the old extractor. No held-out organization corpus or live paid-provider comparison exists yet. Mock provider tests verify error/usage contracts, not reasoning quality.

```sh
npm test -w apps/api -- --runInBand --silent
docker compose -p qa-pipeline-tests -f docker-compose.pipeline-test.yml up -d --wait
npm exec -w apps/api -- jest test/integration/pipeline-recovery.test.ts --runInBand --silent
docker compose -p qa-pipeline-tests -f docker-compose.pipeline-test.yml down --volumes
```

Integration tests use isolated PostgreSQL/Redis and cover forged receipts, publication revalidation, stale proposal replacement, reviewed evidence preservation and recovery/cancellation. No application database is reset. Repository-wide TypeScript compilation remains blocked by legacy action-content, Mongoose and E2E diagnostics; the missing Anthropic explanation-interface implementation is corrected here.

## Next accuracy work

1. Label anonymized organization documents: claims, types, spans, contradictions and abstentions; reserve a held-out split.
2. Add section-aware candidates and field-level evidence for entities, flows, tests and implicit requirements. Expand coverage without relaxing evidence checks.
3. Evaluate bounded model candidate generation against deterministic baselines: per-type precision/recall, unsupported claims, tokens, latency and failures.
4. Add ACL-scoped retrieval and revision citations, review UI, and stale-evidence checks in agent consumers.
5. Add durable per-call usage traces and organization budgets before scaling paid extraction.
