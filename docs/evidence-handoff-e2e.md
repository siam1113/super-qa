# Scoped retrieval and agent evidence handoff

Implemented 2026-09-28. This verifies a complete **data/evidence vertical slice**, not the complete Super QA product or autonomous test-execution lifecycle.

## Implemented flow

```text
POST /api/sources/:id/sync
  -> durable PostgreSQL admission
  -> Redis/Bull registered worker
  -> connector snapshot, chunking and grounded extraction
  -> atomic document/chunk/knowledge publication
  -> source-scoped retrieval over current revisions
  -> HTTP context plus verifiable citation references
  -> real Python retrieve_source_evidence tool
```

The integration test uses real Nest HTTP handlers, Bull/Redis, PostgreSQL transactions, extraction, retrieval SQL and a separate Python process invoking the actual LangChain tool. Connector responses and embedding vectors are deterministic test adapters. No external organization credentials, paid models, live browser execution or frontend interaction are involved.

## Retrieval contract

All retrieval operations require explicit, nonempty `sourceIds` (up to 50 values). Optional `documentTypes` must also be a nonempty list if supplied. Missing/empty scopes return 400 before generating embeddings; there is no global-search fallback.

Source and type predicates apply in SQL **before similarity ranking and top-k selection**. Eligible chunks must carry a revision matching their document's current `processedHash`; unstamped legacy or stale chunks are excluded. The service also checks adapter output defensively. Query vectors must be finite/nonzero; malformed chunk vectors are not ranked.

Candidate loading is capped at 10,001 scoped chunks: if more than 10,000 qualify, retrieval fails and asks for a narrower scope instead of silently searching an arbitrary subset. Ranking still happens in JavaScript over JSON embeddings, not a pgvector index. This is bounded correctness work, not a large-organization performance solution.

### Endpoints

`POST /api/retrieval/search` accepts:

```json
{
  "query": "login behavior",
  "sourceIds": ["SOURCE_UUID"],
  "documentTypes": ["issue"],
  "limit": 10,
  "minSimilarity": 0.5
}
```

It returns `results[]`, each with content, document information, similarity and a citation. `limit` is an integer from 1 to 50; similarity must be finite and between -1 and 1. Queries must be nonempty and at most 4,000 characters. GET search also requires comma-separated `sourceIds`.

`POST /api/retrieval/query` accepts the same fields plus `maxTokens` (integer 1–16,000; default 2,000), and returns:

- `context`: source text labeled with evidence IDs;
- `citations`: exactly the quotes included in that context;
- `omittedChunks`: ranked chunks omitted because they did not fit;
- `status`: `evidence`, `no_evidence`, or `budget_exhausted` when matches exist but none fit.

The compatibility parameter `maxTokens` enforces a **character budget of maxTokens × 4 UTF-16 code units**, including citation headers and separators. This is not a tokenizer-measured model token limit. Oversized chunks are skipped so smaller following chunks can fit; quotes are not truncated or relabeled as complete. `no_evidence` means no eligible results above the current threshold, not proof that no relevant requirement exists anywhere.

### Citation fields

Every citation contains `sourceId`, `documentId`, `chunkId`, `revisionHash`, exact chunk `quote`, SHA-256 `quoteHash`, and a deterministic ID composed from those identifiers. Chunk quotes may reflect chunker normalization; they do **not** claim original-document character spans. Extracted business-item field spans remain the separate v2 extraction contract.

`POST /api/retrieval/resolve` accepts `sourceIds`, `documentId`, `chunkId`, and `revisionHash`. It returns current evidence, 404 for a document outside the supplied scope, or 409 if that revision/chunk is stale. Re-syncing a changed document invalidates old references. This endpoint does not serve a historical revision archive.

Provider/database failures propagate as errors rather than successful empty context. A current citation proves provenance and snapshot identity, not source authority, factual correctness, human review, permission to act, or a passing test.

## Agent integration

Set deployment configuration:

```sh
BACKEND_API_URL=http://localhost:4000/api
AGENT_SOURCE_IDS=source-uuid-one,source-uuid-two
```

`agents/shared/evidence.py` reads the scope from deployment configuration, not model tool arguments. `retrieve_source_evidence(query, max_tokens)` is registered with both QAE and AUE; their prompts instruct them to cite returned evidence and treat source text as data, not instructions.

The client checks HTTP success, protocol shape, configured scope, citation identities, duplicate IDs, quote hashes, exact correspondence between context and citations, and the UTF-16 context budget. Failures raise rather than becoming empty search results. It labels successful output `trust: untrusted_source_text` and `execution_authorized: false`. These labels are not a substitute for an execution-policy enforcement layer.

**Security limitation:** caller-supplied API source filters are not authentication or organization ACLs. This repository still lacks an authenticated principal-to-source authorization layer. The process-wide agent allowlist is not per-request multi-tenant isolation. Legacy agent/business-search tools remain available and are not migrated to this contract. Do not expose this as an organization-isolated production service.

## Reproducible verification

Prerequisites: installed Node dependencies, Docker, Python with the project's agent dependencies (including httpx and LangChain). The isolated stack uses PostgreSQL port 55432 and Redis port 56379; no application database is reset.

```sh
npm test -w apps/api -- --runInBand --silent
PYTHONPATH=agents python3 -m unittest discover -s agents/tests
docker compose -p qa-pipeline-tests -f docker-compose.pipeline-test.yml up -d --wait
npm run test:evidence-e2e -w apps/api
npm run test:pipeline-recovery -w apps/api
docker compose -p qa-pipeline-tests -f docker-compose.pipeline-test.yml down --volumes
```

The new HTTP test verifies source sync admission, completion through the registered worker, real extraction, pre-ranking exclusion of 20 competing foreign-source chunks, document-type filtering, missing-scope rejection, explicit budget exhaustion, citation resolution, Python tool handoff, changed-document re-sync, rejection of the old citation and return of the new revision. Existing cancellation/recovery/rollback tests remain in the same suite.

Unit tests separately cover invalid query vectors/options, defensive scope/revision checks, whole-context budgeting, tool registration, tampered citations, network failure and the difference between no matches and exhausted context budget.

## Acceptance boundaries and blockers

- This milestone's final validation results are recorded in the implementation log. There is no live semantic-retrieval accuracy benchmark; constant test vectors prove transport/scope/revision contracts only. Local production embeddings remain a non-semantic development baseline.
- Changing embedding provider/model requires reprocessing indexed sources. Same-dimension model compatibility is not yet fenced in retrieval metadata.
- `npm run build -w apps/api` still fails on existing legacy action-type errors, missing unused Mongoose schema dependencies, declaration emission for an unexported health result type, and old test typing errors.
- `npm run build -w apps/web` compiles assets but fails type checking because `SyncJobs.tsx` references undefined `setLogs` around line 702. This was not introduced or modified in this slice.
- QA dashboard/execution endpoints still use mock data. Existing agent generation tools are not yet a durable, policy-enforced, evidence-grounded execution harness. Browser execution, review UI, production deployment, authentication and organization isolation are **not** end-to-end accepted here.

Next implementation gates: resolve the application build blockers; enforce authenticated source authorization across all agent tools; replace mock QA persistence/workflows; then connect reviewed evidence to a budgeted durable QAE/AUE execution harness with real browser or API oracles. Do not infer full platform readiness from this one passing vertical slice.
