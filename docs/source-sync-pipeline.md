# Source Sync Pipeline

This document describes the complete flow from connecting a data source to having searchable, indexed documents ready for RAG retrieval.

## Architecture Overview

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│  1. CONNECT     │────▶│  2. SYNC        │────▶│  3. FETCH       │
│  Test connection│     │  Trigger job    │     │  Pull documents │
│  Store config   │     │  Bull queue     │     │  From connector │
└─────────────────┘     └─────────────────┘     └─────────────────┘
                                                        │
        ┌───────────────────────────────────────────────┘
        ▼
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│  4. STORE       │────▶│  5. CHUNK       │────▶│  6. EMBED       │
│  Upsert docs    │     │  Split content  │     │  Generate vectors│
│  Detect changes │     │  500 tokens ea  │     │  384/1536 dims  │
└─────────────────┘     └─────────────────┘     └─────────────────┘
                                                        │
        ┌───────────────────────────────────────────────┘
        ▼
┌─────────────────┐     ┌─────────────────┐
│  7. INDEX       │────▶│  8. SEARCH      │
│  Store in DB    │     │  Cosine similarity│
│  pgvector ready │     │  RAG retrieval  │
└─────────────────┘     └─────────────────┘
```

---

## Step-by-Step Flow

### Step 1: Connect Source

**File:** `apps/api/src/modules/sources/sources.service.ts`

When a user adds a new source:

1. Source record created with `status: 'disconnected'`
2. Config stored (auth type, credentials, repository/project info)
3. `testConnection()` validates credentials via connector
4. On success: `status: 'connected'`, permissions extracted
5. On failure: `status: 'error'`, error message saved

**API Endpoints:**
```
POST /api/sources              - Create source
POST /api/sources/:id/test     - Test connection
```

---

### Step 2: Trigger Sync

**File:** `apps/api/src/modules/sources/sources.service.ts`

When sync is triggered (manually or scheduled):

1. Create `SyncJob` record with `status: 'pending'`
2. Update source `status: 'syncing'`
3. Add job to Bull queue (`sync` queue)
4. Return SyncJob ID for progress tracking

**API Endpoints:**
```
POST /api/sources/:id/sync     - Trigger sync
GET  /api/sources/:id/status   - Get sync status
```

---

### Step 3: Fetch Documents

**File:** `apps/api/src/modules/sources/sync.processor.ts`

Background worker processes sync jobs:

```typescript
@Process('sync-source')
async handleSync(job: Job<{ sourceId: string; syncJobId: string }>) {
  // 1. Load source and select connector
  // 2. Fetch documents with pagination
  do {
    result = await connector.fetchDocuments(config, cursor);
    allDocuments.push(...result.documents);
    cursor = result.hasMore ? result.cursor : undefined;
  } while (cursor);
  // 3. Pass to document service
}
```

**Connectors:** `apps/api/src/modules/sources/connectors/`

| Connector | File | What It Fetches |
|-----------|------|-----------------|
| GitHub | `github.connector.ts` | Issues, Pull Requests |
| Jira | `jira.connector.ts` | Issues via JQL |
| Confluence | `confluence.connector.ts` | Wiki pages |

**Connector Interface:**
```typescript
interface ISourceConnector {
  testConnection(config: SourceConfig): Promise<boolean>;
  fetchDocuments(config: SourceConfig, cursor?: string): Promise<{
    documents: RawDocument[];
    cursor?: string;
    hasMore: boolean;
  }>;
  getPermissions(config: SourceConfig): Promise<string[]>;
}
```

---

### Step 4: Store Documents

**File:** `apps/api/src/modules/documents/documents.service.ts`

Upsert logic for each document:

1. Calculate SHA256 hash of content
2. Check if document exists (by `sourceId` + `externalId`)
3. **If exists and unchanged:** Skip (optimization)
4. **If exists and changed:** Update document, delete old chunks, reprocess
5. **If new:** Create document, queue for processing

**Document Entity:**
```typescript
@Entity('documents')
class Document {
  id: string;                    // UUID
  source: Source;                // FK to source
  externalId: string;            // Source-specific ID (e.g., "issue-123")
  type: DocumentType;            // requirement, code, issue, pr, wiki, etc.
  title: string;
  content: string;               // Plain text content
  url: string | null;            // Link back to source
  metadata: Record<string, any>; // Labels, status, dates, etc.
  contentHash: string;           // SHA256 for change detection
  chunks: Chunk[];               // 1:many relationship
}
```

---

### Step 5: Chunk Content

**File:** `apps/api/src/modules/processing/chunking.service.ts`

Split documents into overlapping chunks:

| Document Type | Chunk Size | Overlap |
|---------------|------------|---------|
| Code | 800 tokens | 100 tokens |
| Other | 500 tokens | 50 tokens |

**Chunking Algorithm:**
1. Calculate character limits (4 chars ≈ 1 token)
2. Split at sentence boundaries (`. `, `! `, `? `)
3. Fall back to paragraph/line breaks
4. Ensure overlap for context continuity

**Output:**
```typescript
interface TextChunk {
  content: string;
  index: number;
  startChar: number;
  endChar: number;
}
```

---

### Step 6: Generate Embeddings

**File:** `apps/api/src/modules/processing/embedding.service.ts`

Convert text chunks to vector embeddings:

| Provider | Model | Dimensions | Config |
|----------|-------|------------|--------|
| OpenAI | text-embedding-3-small | 1536 | `EMBEDDING_PROVIDER=openai` |
| HuggingFace | all-MiniLM-L6-v2 | 384 | `EMBEDDING_PROVIDER=huggingface` |
| Local | Hash-based (testing) | 384 | `EMBEDDING_PROVIDER=local` |

**Environment Variables:**
```env
EMBEDDING_PROVIDER=local    # openai, huggingface, or local
OPENAI_API_KEY=             # Required for OpenAI
HUGGINGFACE_API_KEY=        # Required for HuggingFace
```

**Graceful Degradation:**
- If embedding fails, chunks saved without embeddings
- Search still works (returns empty results for vector queries)

---

### Step 7: Store Chunks

**File:** `apps/api/src/modules/documents/entities/chunk.entity.ts`

Store chunks with embeddings in PostgreSQL:

```typescript
@Entity('chunks')
class Chunk {
  id: string;              // UUID
  document: Document;      // FK to document
  content: string;         // Chunk text
  chunkIndex: number;      // Sequence number
  embedding: number[];     // Vector (stored as JSONB)
  metadata: object | null; // Optional metadata
  createdAt: Date;
}
```

**Database Schema:**
```sql
CREATE TABLE chunks (
  id UUID PRIMARY KEY,
  document_id UUID REFERENCES documents(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  chunk_index INTEGER NOT NULL,
  embedding JSONB,  -- Will migrate to vector type
  metadata JSONB,
  created_at TIMESTAMP DEFAULT NOW()
);
```

---

### Step 8: Search & Retrieval

**File:** `apps/api/src/modules/retrieval/retrieval.service.ts`

Vector similarity search for RAG:

1. Convert user query to embedding
2. Calculate cosine similarity with all chunks
3. Return top N most similar chunks
4. Include parent document metadata

**Cosine Similarity:**
```typescript
function cosineSimilarity(a: number[], b: number[]): number {
  const dotProduct = a.reduce((sum, val, i) => sum + val * b[i], 0);
  const magnitudeA = Math.sqrt(a.reduce((sum, val) => sum + val * val, 0));
  const magnitudeB = Math.sqrt(b.reduce((sum, val) => sum + val * val, 0));
  return dotProduct / (magnitudeA * magnitudeB);
}
```

**API Endpoints:**
```
POST /api/retrieval/search   - Vector similarity search
POST /api/retrieval/query    - RAG query with context
GET  /api/documents          - List documents
GET  /api/documents/:id      - Get document with chunks
```

---

## Status Tracking

### Source Status

| Status | Description |
|--------|-------------|
| `disconnected` | Initial state, not yet tested |
| `connected` | Connection verified, ready to sync |
| `syncing` | Sync in progress |
| `error` | Connection or sync failed |

### SyncJob Status

| Status | Description |
|--------|-------------|
| `pending` | Job queued, waiting to start |
| `running` | Currently fetching/processing |
| `completed` | Sync finished successfully |
| `failed` | Sync failed with error |

**Status Flow:**
```
Source:   disconnected → connected → syncing → connected (or error)
SyncJob:                             pending → running → completed (or failed)
```

---

## Data Flow Diagram

```
                                    ┌──────────────┐
                                    │   GitHub     │
                                    │   Jira       │
                                    │   Confluence │
                                    └──────┬───────┘
                                           │
                                           ▼
┌─────────────┐    ┌─────────────┐    ┌─────────────┐
│   Source    │───▶│  SyncJob    │───▶│  Connector  │
│   Config    │    │  (Bull Q)   │    │  Fetch      │
└─────────────┘    └─────────────┘    └──────┬──────┘
                                             │
                                             ▼
                                    ┌─────────────┐
                                    │  Documents  │
                                    │  (PostgreSQL)│
                                    └──────┬──────┘
                                           │
                         ┌─────────────────┼─────────────────┐
                         ▼                 ▼                 ▼
                  ┌─────────────┐   ┌─────────────┐   ┌─────────────┐
                  │   Chunks    │   │  Embeddings │   │   Graph     │
                  │  (split)    │   │  (vectors)  │   │  (Neo4j)*   │
                  └─────────────┘   └─────────────┘   └─────────────┘
                                           │
                                           ▼
                                    ┌─────────────┐
                                    │  Retrieval  │
                                    │  (RAG)      │
                                    └─────────────┘

* Graph sync not yet implemented
```

---

## Key Files Reference

| Component | File Path |
|-----------|-----------|
| Source Service | `apps/api/src/modules/sources/sources.service.ts` |
| Sync Processor | `apps/api/src/modules/sources/sync.processor.ts` |
| GitHub Connector | `apps/api/src/modules/sources/connectors/github.connector.ts` |
| Jira Connector | `apps/api/src/modules/sources/connectors/jira.connector.ts` |
| Confluence Connector | `apps/api/src/modules/sources/connectors/confluence.connector.ts` |
| Document Service | `apps/api/src/modules/documents/documents.service.ts` |
| Chunking Service | `apps/api/src/modules/processing/chunking.service.ts` |
| Embedding Service | `apps/api/src/modules/processing/embedding.service.ts` |
| Processing Processor | `apps/api/src/modules/processing/processing.processor.ts` |
| Retrieval Service | `apps/api/src/modules/retrieval/retrieval.service.ts` |

---

## Implemented Features

### 1. Graph Sync (Neo4j)

Documents are automatically synced to Neo4j after being stored in PostgreSQL.

**How it works:**
- After document upsert, `syncDocumentToGraph()` is called
- Creates node with appropriate type (Requirement, TestCase, Code, Bug, etc.)
- Extracts references from content (e.g., #123, JIRA-456)
- Creates REFERENCES relationships between linked documents
- Creates FIXES relationships for PRs that close issues

**API Endpoints:**
```
GET  /api/graph/health                          - Check Neo4j connection
GET  /api/graph/stats/coverage                  - Coverage statistics
GET  /api/graph/traceability/path?from=X&to=Y   - Find path between nodes
GET  /api/graph/traceability/impact/:id         - Impact analysis
```

### 2. Blob Storage (MinIO)

File attachments are stored in S3-compatible MinIO storage.

**How it works:**
- Connectors can include `attachments` array in documents
- `storeAttachments()` uploads to MinIO bucket
- Files organized by `sources/{sourceId}/` or `documents/{documentId}/`
- Checksums computed for deduplication

**Storage Service Methods:**
```typescript
uploadBuffer(buffer, filename, metadata)   // Upload from buffer
uploadStream(stream, filename, metadata)   // Upload large files
downloadBuffer(key)                        // Download as buffer
downloadStream(key)                        // Download as stream
deleteFile(key)                            // Delete single file
deleteByPrefix(prefix)                     // Delete all files with prefix
```

### 3. Incremental Sync

Only fetch documents that changed since last sync.

**How it works:**
- Source entity tracks `syncState.lastSyncedAt`
- Incremental sync passes `since` parameter to connectors
- GitHub uses `since` parameter in API calls
- Only changed documents are fetched and processed

**API Endpoints:**
```
POST /api/sources/:id/sync              - Full sync
POST /api/sources/:id/sync/incremental  - Incremental sync (only changes)
```

**Source SyncState:**
```typescript
interface SyncState {
  lastCursor?: string;       // Last pagination cursor
  lastSyncedAt?: Date;       // Last successful sync timestamp
  lastModifiedAt?: Date;     // Last modified date from source
  etag?: string;             // ETag for conditional requests
}
```

### 4. Webhooks

Receive real-time updates from sources without polling.

**How it works:**
- Configure webhook URL in source settings
- Sources send events to our webhook endpoint
- Connector parses payload and extracts documents
- Documents queued for processing (same as sync)

**Webhook Endpoints:**
```
POST /api/webhooks/github/:sourceId      - GitHub webhook
POST /api/webhooks/jira/:sourceId        - Jira webhook
POST /api/webhooks/confluence/:sourceId  - Confluence webhook
```

**Configuration:**
```
POST /api/sources/:id/webhook
{
  "enabled": true,
  "secret": "optional-webhook-secret"
}

GET /api/sources/:id/webhook
{
  "enabled": true,
  "webhookUrl": "http://localhost:4000/api/webhooks/github/{sourceId}"
}
```

**Supported GitHub Events:**
- `issues` - Issue created, edited, closed
- `pull_request` - PR opened, edited, closed, merged
- `issue_comment` - Comment added or edited

**Supported Jira Events:**
- `jira:issue_created`
- `jira:issue_updated`
- `jira:issue_deleted`

**Supported Confluence Events:**
- `page_created`
- `page_updated`
- `page_removed`

---

## Configuration

### Environment Variables

```env
# Database
DATABASE_HOST=localhost
DATABASE_PORT=5432
DATABASE_USER=qaagent
DATABASE_PASSWORD=qaagent123
DATABASE_NAME=qaagent

# Redis (Bull queues)
REDIS_HOST=localhost
REDIS_PORT=6379

# Embeddings
EMBEDDING_PROVIDER=local
OPENAI_API_KEY=
HUGGINGFACE_API_KEY=

# OAuth (optional)
GITHUB_CLIENT_ID=
GITHUB_CLIENT_SECRET=
ATLASSIAN_CLIENT_ID=
ATLASSIAN_CLIENT_SECRET=
```

### Docker Services

```bash
# Start all services
docker compose up -d

# Services:
# - postgres (5432) - Primary database with pgvector
# - redis (6379) - Bull queue backend
# - minio (9000/9001) - Blob storage
# - neo4j (7474/7687) - Graph database
```
