# Database & Storage Architecture

This document provides a comprehensive overview of all databases and storage systems used in the Ultimate QA Agent platform, their purposes, and when each is used.

---

## Overview

The platform uses a **polyglot persistence** approach, leveraging different databases for different use cases:

| Database/Storage | Technology | Purpose | Status |
|-----------------|------------|---------|--------|
| PostgreSQL | Relational DB | Primary application data | ✅ Active |
| Redis | In-memory Cache | Background job queuing | ✅ Active |
| Neo4j | Graph DB | Relationship traceability | ✅ Active |
| S3/MinIO | Object Storage | File & attachment storage | ✅ Active |
| MongoDB | Document DB | QA execution data | 🚧 Planned |

---

## 1. PostgreSQL - Primary Relational Database

### Purpose
PostgreSQL serves as the **main application database**, storing structured relational data that requires ACID guarantees, complex queries, and referential integrity.

### Configuration
```env
DATABASE_HOST=localhost
DATABASE_PORT=5432
DATABASE_USER=qaagent
DATABASE_PASSWORD=qaagent123
DATABASE_NAME=qaagent
```

### What We Store

#### Sources (`sources` table)
**Purpose:** Track external data sources connected to the platform
- **What:** GitHub repos, Jira projects, Confluence spaces
- **When:** Created when user connects a new source
- **Key Fields:**
  - `type`: github | jira | confluence
  - `status`: disconnected | connected | syncing | error
  - `config`: Authentication credentials (OAuth tokens, API keys)
  - `syncMode`: manual | scheduled | webhook
  - `syncState`: Last sync timestamp, cursor for incremental syncs

#### Documents (`documents` table)
**Purpose:** Store all ingested content from sources
- **What:** Requirements, code files, issues, PRs, wiki pages, test cases, API specs
- **When:** Created during sync jobs when pulling data from sources
- **Key Fields:**
  - `sourceId`: Reference to parent source
  - `externalId`: Original ID from source (e.g., "issue-123", "PR-456")
  - `type`: requirement | code | issue | pr | wiki | test_case | api_spec
  - `content`: Full text content
  - `contentHash`: SHA-256 hash for change detection
  - `metadata`: JSONB field for source-specific data
- **Indexing:**
  - Indexed on `externalId` and `contentHash` for fast lookups
  - Change detection compares hash to avoid reprocessing unchanged docs

#### Chunks (`chunks` table)
**Purpose:** Store document fragments with embeddings for semantic search
- **What:** Text chunks split from documents (200-500 tokens each)
- **When:** Generated during document processing pipeline
- **Key Fields:**
  - `documentId`: Parent document reference
  - `content`: Chunk text
  - `chunkIndex`: Position in original document
  - `embedding`: Vector embedding (JSONB array, pgvector planned)
- **Use Cases:**
  - Semantic search: Find relevant context for AI queries
  - RAG (Retrieval Augmented Generation): Feed context to LLMs
  - Similarity search: Find related content across sources

#### Sync Jobs (`sync_jobs` table)
**Purpose:** Track sync pipeline execution and progress
- **What:** Background jobs that pull, process, index, and extract data
- **When:** Created whenever a source sync is triggered
- **Key Fields:**
  - `sourceId`: Source being synced
  - `status`: queued | running | completed | failed | cancelled
  - `trigger`: manual | scheduled | webhook
  - `currentStage`: pulling | processing | indexing | extracting | populating
  - `stages`: JSONB array tracking each stage's progress
  - `metadata`: JSONB with counters (documentsProcessed, documentsExtracted, etc.)
- **Stage Pipeline:**
  1. **Pulling:** Fetch documents from external source API
  2. **Processing:** Parse and store documents in database
  3. **Indexing:** Generate embeddings and chunks
  4. **Extracting:** Extract business knowledge using AI
  5. **Populating:** Save extracted items to context database

#### Business Items (`business_items` table)
**Purpose:** Store extracted business context and knowledge
- **What:** Requirements, test cases, business rules, user flows, validations
- **When:** Extracted from documents using AI during sync pipeline
- **Key Fields:**
  - `type`: requirement | test_case | business_rule | user_flow | validation
  - `title`: Short description
  - `description`: Full details
  - `sourceReferences`: JSONB array linking to source documents
  - `relationships`: JSONB array of related items
  - `confidence`: AI extraction confidence score (0-100)
- **Use Cases:**
  - Context for AI agents
  - Traceability between requirements and tests
  - Business knowledge graph

#### Environments (`environments` table)
**Purpose:** Track test execution environments
- **What:** Dev, staging, production environments with configurations
- **When:** Created by users to organize test execution

#### Agent Sessions & Tasks (`agent_sessions`, `agent_tasks` tables)
**Purpose:** Track AI agent execution and task history
- **What:** Sessions when agents are invoked, individual tasks performed
- **When:** Created during AI agent operations
- **Key Fields:**
  - Session: `status`, `startedAt`, `completedAt`, `metadata`
  - Task: `type`, `status`, `input`, `output`, `duration`

### Database Features Used
- **JSONB:** Flexible schema for metadata, config, relationships
- **Indexes:** B-tree on IDs/hashes, planned GIN indexes for JSONB
- **Transactions:** ACID guarantees for sync operations
- **Foreign Keys:** Referential integrity (CASCADE deletes)
- **Atomic Updates:** Raw SQL for concurrent counter increments

---

## 2. Redis - Background Job Queue

### Purpose
Redis serves as the **message broker and task queue** for asynchronous background processing using Bull (BullMQ).

### Configuration
```env
REDIS_HOST=localhost
REDIS_PORT=6379
```

### What We Store

#### Processing Queue (`processing`)
**Purpose:** Queue documents for chunking and embedding generation
- **What:** Jobs to process individual documents
- **When:** Queued after documents are upserted during sync
- **Job Data:**
  ```typescript
  {
    documentId: string,
    syncJobId?: string  // Optional: links to parent sync job
  }
  ```
- **Processing:**
  1. Chunk document content (semantic chunking for text, AST-based for code)
  2. Generate embeddings using configured provider (OpenAI, HuggingFace, local)
  3. Save chunks with embeddings to database
  4. Update sync job progress counters

#### Sync Queue (`sync`)
**Purpose:** Queue source sync operations
- **What:** Jobs to pull and process data from connected sources
- **When:** Triggered manually, on schedule, or by webhook
- **Job Data:**
  ```typescript
  {
    sourceId: string,
    syncJobId: string,
    incremental?: boolean  // Full vs incremental sync
  }
  ```
- **Processing:**
  1. Fetch documents from source API (GitHub, Jira, Confluence)
  2. Upsert documents to database
  3. Queue processing jobs for new/changed documents
  4. Track progress through 5 stages

### Queue Features Used
- **Job Retries:** Automatic retry on failure with exponential backoff
- **Concurrency:** Process multiple jobs in parallel
- **Progress Tracking:** Update job status and progress
- **Job Events:** Listen for completed/failed events
- **Delayed Jobs:** Schedule jobs for future execution (planned for scheduled syncs)

---

## 3. Neo4j - Graph Database

### Purpose
Neo4j stores **relationships and enables traceability queries** across requirements, tests, code, bugs, and features.

### Configuration
```env
NEO4J_URI=bolt://localhost:7687
NEO4J_USER=neo4j
NEO4J_PASSWORD=qaagent123
```

### Node Types

| Node Type | Label | Represents |
|-----------|-------|------------|
| Requirement | `Requirement` | Business requirements, user stories |
| TestCase | `TestCase` | Test cases and test scenarios |
| Code | `Code` | Source code files, pull requests |
| Bug | `Bug` | Issues, defects, bugs |
| Feature | `Feature` | Features, epics |
| Document | `Document` | Generic documents (wiki, specs) |
| Source | `Source` | Connected data sources |

### Relationship Types

| Relationship | Direction | Meaning |
|-------------|-----------|---------|
| `TESTS` | TestCase → Requirement | Test validates a requirement |
| `IMPLEMENTS` | Code → Requirement | Code implements a requirement |
| `COVERS` | TestCase → Code | Test exercises code |
| `FOUND_IN` | Bug → TestCase | Bug discovered by test |
| `AFFECTS` | Bug → Requirement | Bug impacts a requirement |
| `FIXES` | Code → Bug | Code change fixes a bug |
| `BLOCKS` | Bug → Feature | Bug prevents feature completion |
| `PART_OF` | Child → Parent | Hierarchical relationship |
| `DEPENDS_ON` | Node → Node | Dependency relationship |
| `FROM_SOURCE` | Document → Source | Document origin |
| `REFERENCES` | Document → Document | Cross-references |

### What We Store

#### Documents as Nodes
**When:** Synced from PostgreSQL during document creation
- Maps document types to node types:
  - `requirement` → `Requirement`
  - `test_case` → `TestCase`
  - `code`, `pr` → `Code`
  - `issue` → `Bug`
  - `feature` → `Feature`
  - Others → `Document`

#### Extracted Relationships
**When:** Extracted during document processing
- **From Metadata:**
  - PR `linkedIssues` → creates `FIXES` relationships
  - Issue references → creates `REFERENCES` relationships
- **From Content:**
  - Parses references like `#123`, `JIRA-456`
  - Creates links between related documents

### Use Cases

#### Traceability Queries
```cypher
// Find all tests for a requirement
MATCH (t:TestCase)-[:TESTS]->(r:Requirement {id: $reqId})
RETURN t

// Get full traceability path
MATCH path = shortestPath((from {id: $fromId})-[*1..5]-(to {id: $toId}))
RETURN nodes(path), relationships(path)
```

#### Impact Analysis
```cypher
// What would be affected if this requirement changes?
MATCH (start:Requirement {id: $reqId})-[*1..3]->(affected)
RETURN affected, labels(affected)
```

#### Coverage Statistics
```cypher
// Calculate requirement coverage
MATCH (r:Requirement)
OPTIONAL MATCH (r)<-[:TESTS]-(t:TestCase)
RETURN count(DISTINCT r) as totalReqs,
       count(DISTINCT t) as coveredReqs
```

### Database Features Used
- **Unique Constraints:** On `id` for each node type
- **Indexes:** On `externalId` for fast lookups
- **Cypher Queries:** Graph pattern matching
- **Shortest Path:** Find traceability paths
- **Graph Algorithms:** Impact analysis, coverage

---

## 4. S3/MinIO - Object Storage

### Purpose
S3-compatible object storage for **binary files and attachments** too large for relational database.

### Configuration
```env
# MinIO (local development)
S3_ENDPOINT=http://localhost:9000
S3_REGION=us-east-1
S3_ACCESS_KEY=qaagent
S3_SECRET_KEY=qaagent123
S3_BUCKET=qa-agent-files

# Or AWS S3 (production)
# S3_ENDPOINT=https://s3.amazonaws.com
# S3_REGION=us-east-1
# S3_ACCESS_KEY=AKIAIOSFODNN7EXAMPLE
# S3_SECRET_KEY=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY
# S3_BUCKET=my-qa-agent-bucket
```

### What We Store

#### Document Attachments
**What:** Files attached to documents (images, PDFs, videos, archives)
- **Key Pattern:** `sources/{sourceId}/{timestamp}-{random}-{filename}`
- **When:** Uploaded during sync if document has attachments
- **Metadata:**
  - `originalName`: Original filename
  - `checksum`: MD5 hash for integrity
  - `sourceId`: Parent source ID
  - `documentId`: Parent document ID

#### Uploaded Files
**What:** User-uploaded files
- **Key Pattern:** `uploads/{timestamp}-{random}-{filename}`
- **When:** User uploads via API

#### Document-Specific Files
**What:** Files associated with specific documents
- **Key Pattern:** `documents/{documentId}/{timestamp}-{random}-{filename}`

### Storage Operations

#### Upload Methods
1. **Buffer Upload:** For small files (<10MB) loaded into memory
2. **Stream Upload:** For large files using multipart upload

#### File Management
- **Checksum Validation:** MD5 hash computed and stored
- **Metadata Storage:** Custom metadata attached to each object
- **Lifecycle:** Files deleted when parent source/document is deleted
- **List/Search:** Query files by prefix (e.g., all files for a source)

### Object Storage Features Used
- **S3 API Compatibility:** Works with AWS S3, MinIO, DigitalOcean Spaces, Cloudflare R2
- **Multipart Upload:** Efficient large file handling
- **Object Metadata:** Custom key-value pairs per object
- **Bucket Lifecycle:** Automatic creation on startup
- **Path-Style Requests:** Required for MinIO

---

## 5. MongoDB - QA Execution Data (Planned)

### Purpose
MongoDB will store **test execution data and dynamic QA facts** that benefit from flexible schemas.

### Status
🚧 **Currently Planned** - Schemas defined but not yet integrated

### What Will Be Stored

#### Test Cases
**Purpose:** Test case definitions and metadata
- **Fields:**
  - `title`, `priority`, `automation`, `owner`
  - `flow`: User flow name
  - `tags`: Array of tags
  - `lastRun`, `passRate`, `coverage`
  - `risk`, `aiScore`: AI-generated metrics

#### Executions
**Purpose:** Individual test execution records
- **Fields:**
  - `testName`, `testId`, `flow`
  - `browser`, `environment`, `status`
  - `duration`, `retry`, `aiConfidence`
  - `startedAt`, `completedAt`
  - `errorMessage`, `stackTrace`
- **Use Case:** Time-series data, execution history, analytics

#### Healing Suggestions
**Purpose:** AI-generated test repair suggestions
- **Fields:**
  - `issue`, `affectedTests`, `confidence`
  - `currentLocator`, `suggestedLocator`
  - `status`: pending | approved | rejected
  - `rootCause`, `risk`, `owner`

#### Flows
**Purpose:** User flows and journey definitions
- **Fields:**
  - `name`, `module`, `description`
  - `risk`, `priority`, `coverage`, `automation`
  - `relatedPages`, `dependencies`

#### Facts
**Purpose:** Dynamic business rules and constraints
- **Fields:**
  - `text`: Fact description
  - `category`: flow | execution | page | api | business_rule | constraint | validation
  - `confidence`, `source`, `createdBy`
  - `aiGenerated`, `humanVerified`
  - `relatedObjects`: Array of related IDs

### Why MongoDB for QA Data?
1. **Flexible Schema:** Test execution data varies by test type
2. **Time-Series:** Natural fit for execution history
3. **Embedded Documents:** Nest test steps, assertions, screenshots
4. **Array Operations:** Efficiently query tags, affected tests, related objects
5. **Aggregation Pipeline:** Complex analytics on execution data

---

## Data Flow Diagrams

### Sync Pipeline Data Flow

```
┌─────────────┐
│   Source    │ (GitHub/Jira/Confluence)
│  Connector  │
└──────┬──────┘
       │ Pull documents
       ▼
┌─────────────┐
│ PostgreSQL  │ Store documents + metadata
│  documents  │ Detect changes via contentHash
└──────┬──────┘
       │ Queue if new/changed
       ▼
┌─────────────┐
│    Redis    │ Background jobs
│   Queue     │
└──────┬──────┘
       │ Process
       ▼
┌─────────────┐
│ PostgreSQL  │ Save chunks + embeddings
│   chunks    │
└──────┬──────┘
       │
       ├─────────────────┐
       │                 │
       ▼                 ▼
┌─────────────┐   ┌─────────────┐
│    Neo4j    │   │  S3/MinIO   │
│ Sync nodes  │   │   Upload    │
│ & relations │   │ attachments │
└─────────────┘   └─────────────┘
       │
       ▼
┌─────────────┐
│ PostgreSQL  │ Extract & save business items
│ business_   │
│   items     │
└─────────────┘
```

### Query/Retrieval Data Flow

```
┌─────────────┐
│  User Query │
└──────┬──────┘
       │
       ▼
┌─────────────┐
│  Generate   │ Embedding service
│  Embedding  │
└──────┬──────┘
       │
       ▼
┌─────────────┐
│ PostgreSQL  │ Similarity search on chunks
│   chunks    │ (cosine similarity, future: pgvector)
└──────┬──────┘
       │ Retrieve top-K chunks
       ▼
┌─────────────┐
│ PostgreSQL  │ Get full documents
│  documents  │
└──────┬──────┘
       │ Optional: get relationships
       ▼
┌─────────────┐
│    Neo4j    │ Graph traversal for related context
└──────┬──────┘
       │
       ▼
┌─────────────┐
│  AI Agent   │ Use retrieved context for answer
└─────────────┘
```

---

## Performance Considerations

### PostgreSQL
- **Indexes:** Ensure fast lookups on `externalId`, `contentHash`, `sourceId`
- **JSONB Queries:** Use GIN indexes for metadata/relationship queries
- **Partitioning:** Consider partitioning `chunks` by `documentId` for large datasets
- **pgvector:** Future migration from JSONB arrays to native vector type
- **Vacuuming:** Regular maintenance for JSONB tables

### Redis
- **Memory:** Monitor memory usage, configure eviction policies
- **Persistence:** Enable RDB/AOF for job queue durability
- **Concurrency:** Tune worker count based on CPU/memory

### Neo4j
- **Constraints:** Unique constraints prevent duplicate nodes
- **Indexes:** Composite indexes on frequently queried properties
- **Query Optimization:** Use EXPLAIN to analyze Cypher queries
- **Batch Writes:** Use transactions for bulk operations

### S3/MinIO
- **Multipart Upload:** Use for files >5MB
- **CDN:** Consider CloudFront/CDN for frequently accessed files
- **Lifecycle Policies:** Auto-delete old execution artifacts
- **Compression:** Compress large text files before upload

---

## Backup & Recovery Strategy

### PostgreSQL
- **pg_dump:** Daily automated backups
- **WAL Archiving:** Point-in-time recovery
- **Replicas:** Read replicas for high availability

### Redis
- **RDB Snapshots:** Daily snapshots
- **AOF:** Append-only file for durability
- **Sentinel/Cluster:** High availability setup

### Neo4j
- **neo4j-admin backup:** Regular graph backups
- **Causal Clustering:** For production HA

### S3/MinIO
- **Versioning:** Enable object versioning
- **Cross-Region Replication:** For disaster recovery
- **Lifecycle Rules:** Archive to Glacier for old files

---

## Future Enhancements

### Short Term
1. **pgvector Extension:** Native vector similarity search in PostgreSQL
2. **MongoDB Integration:** Complete QA module with execution tracking
3. **Redis Sentinel:** High availability for job queues

### Long Term
1. **TimescaleDB:** Time-series optimization for execution data
2. **Elasticsearch:** Full-text search across all documents
3. **ClickHouse:** Analytics database for execution metrics
4. **Object Storage CDN:** Edge caching for attachments

---

## Environment-Specific Configurations

### Development
- MinIO for object storage (local)
- Single PostgreSQL instance
- Neo4j community edition
- Redis standalone

### Production
- AWS S3 or DigitalOcean Spaces
- PostgreSQL with read replicas
- Neo4j Enterprise with clustering
- Redis Sentinel cluster
- Automated backups and monitoring

---

## Troubleshooting

### PostgreSQL Issues
- **Slow Queries:** Check missing indexes with `EXPLAIN ANALYZE`
- **Connection Pool:** Tune max connections and pool size
- **Disk Space:** Monitor JSONB table growth

### Redis Issues
- **Memory Limit:** Check `maxmemory` and eviction policy
- **Connection Errors:** Verify network/firewall rules
- **Job Failures:** Check Bull queue error logs

### Neo4j Issues
- **Connection Failed:** Verify bolt:// URI and credentials
- **Slow Queries:** Add indexes, use query profiling
- **Memory:** Tune `dbms.memory.heap` settings

### S3/MinIO Issues
- **Upload Failures:** Check credentials and bucket permissions
- **Slow Uploads:** Use multipart upload for large files
- **Access Denied:** Verify IAM policies or MinIO access keys

---

## References

- [PostgreSQL Documentation](https://www.postgresql.org/docs/)
- [Redis Documentation](https://redis.io/docs/)
- [Neo4j Documentation](https://neo4j.com/docs/)
- [AWS S3 Documentation](https://docs.aws.amazon.com/s3/)
- [MinIO Documentation](https://min.io/docs/)
- [Bull Queue Documentation](https://github.com/OptimalBits/bull)
