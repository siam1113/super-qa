# Database Architecture - Visual Diagrams

This document provides visual representations of the database architecture and data flows.

## System Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           ULTIMATE QA AGENT                              │
│                                                                          │
│  ┌────────────────────────┐         ┌──────────────────────────┐       │
│  │      Web Frontend      │         │      Python Agents       │       │
│  │     (Next.js/React)    │◄───────►│   (AI/ML Workloads)     │       │
│  └────────┬───────────────┘         └──────────┬───────────────┘       │
│           │                                    │                        │
│           │ HTTP/WebSocket                     │ HTTP                   │
│           ▼                                    ▼                        │
│  ┌───────────────────────────────────────────────────────────┐         │
│  │                  NestJS API Server                         │         │
│  │                                                             │         │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐  │         │
│  │  │ Sources  │  │Documents │  │Processing│  │ Business │  │         │
│  │  │  Module  │  │  Module  │  │  Module  │  │  Module  │  │         │
│  │  └──────────┘  └──────────┘  └──────────┘  └──────────┘  │         │
│  │                                                             │         │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐  │         │
│  │  │  Graph   │  │ Storage  │  │Retrieval │  │   QA     │  │         │
│  │  │  Module  │  │  Module  │  │  Module  │  │  Module  │  │         │
│  │  └──────────┘  └──────────┘  └──────────┘  └──────────┘  │         │
│  └───────────────────────────────────────────────────────────┘         │
│           │                  │                │               │         │
└───────────┼──────────────────┼────────────────┼───────────────┼─────────┘
            │                  │                │               │
            ▼                  ▼                ▼               ▼
   ┌────────────────┐  ┌─────────────┐  ┌──────────┐  ┌──────────────┐
   │   PostgreSQL   │  │    Redis    │  │  Neo4j   │  │   S3/MinIO   │
   │  (Primary DB)  │  │   (Queue)   │  │ (Graph)  │  │   (Blobs)    │
   └────────────────┘  └─────────────┘  └──────────┘  └──────────────┘
```

---

## Database Layer - Detailed View

```
┌─────────────────────────────────────────────────────────────────────────┐
│                          DATABASE LAYER                                  │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  ┌───────────────────────────────────────────────────────────┐          │
│  │              PostgreSQL (Primary Database)                 │          │
│  │                                                             │          │
│  │  ┌───────────────┐  ┌───────────────┐  ┌───────────────┐ │          │
│  │  │    sources    │  │   documents   │  │     chunks    │ │          │
│  │  ├───────────────┤  ├───────────────┤  ├───────────────┤ │          │
│  │  │ • id          │  │ • id          │  │ • id          │ │          │
│  │  │ • type        │  │ • sourceId    │  │ • documentId  │ │          │
│  │  │ • status      │  │ • externalId  │  │ • content     │ │          │
│  │  │ • config      │  │ • type        │  │ • chunkIndex  │ │          │
│  │  │ • syncMode    │  │ • title       │  │ • embedding   │ │          │
│  │  │ • syncState   │  │ • content     │  │               │ │          │
│  │  │               │  │ • contentHash │  │               │ │          │
│  │  └───────┬───────┘  │ • metadata    │  └───────────────┘ │          │
│  │          │          └───────┬───────┘                     │          │
│  │          │                  │                             │          │
│  │          │  ┌───────────────┴───────────┐                 │          │
│  │          │  │                           │                 │          │
│  │          ▼  ▼                           ▼                 │          │
│  │  ┌───────────────┐              ┌───────────────┐         │          │
│  │  │   sync_jobs   │              │business_items │         │          │
│  │  ├───────────────┤              ├───────────────┤         │          │
│  │  │ • id          │              │ • id          │         │          │
│  │  │ • sourceId    │              │ • type        │         │          │
│  │  │ • status      │              │ • title       │         │          │
│  │  │ • stages      │              │ • description │         │          │
│  │  │ • metadata    │              │ • sourceRefs  │         │          │
│  │  └───────────────┘              │ • confidence  │         │          │
│  │                                 └───────────────┘         │          │
│  └─────────────────────────────────────────────────────────────         │
│                                                                          │
│  ┌───────────────────────────────────────────────────────────┐          │
│  │              Redis (Job Queue & Cache)                     │          │
│  │                                                             │          │
│  │  ┌──────────────────┐       ┌──────────────────┐          │          │
│  │  │  sync queue      │       │processing queue  │          │          │
│  │  ├──────────────────┤       ├──────────────────┤          │          │
│  │  │ Jobs:            │       │ Jobs:            │          │          │
│  │  │ • sourceId       │       │ • documentId     │          │          │
│  │  │ • syncJobId      │       │ • syncJobId      │          │          │
│  │  │ • incremental    │       │                  │          │          │
│  │  └──────────────────┘       └──────────────────┘          │          │
│  └─────────────────────────────────────────────────────────────         │
│                                                                          │
│  ┌───────────────────────────────────────────────────────────┐          │
│  │              Neo4j (Traceability Graph)                    │          │
│  │                                                             │          │
│  │         (Document)──[FROM_SOURCE]──>(Source)               │          │
│  │              │                                              │          │
│  │              │                                              │          │
│  │    ┌─────────┼──────────┐                                  │          │
│  │    │         │          │                                  │          │
│  │    ▼         ▼          ▼                                  │          │
│  │ (Requirement) (TestCase) (Code)                            │          │
│  │    │         │          │                                  │          │
│  │    │    [TESTS]    [IMPLEMENTS]                            │          │
│  │    │         │          │                                  │          │
│  │    └─────────┴──────────┘                                  │          │
│  │              │                                              │          │
│  │              ▼                                              │          │
│  │           (Bug)──[AFFECTS]──>(Feature)                     │          │
│  │              │                                              │          │
│  │         [FIXES]                                             │          │
│  │              │                                              │          │
│  │              ▼                                              │          │
│  │           (Code)                                            │          │
│  └─────────────────────────────────────────────────────────────         │
│                                                                          │
│  ┌───────────────────────────────────────────────────────────┐          │
│  │              S3/MinIO (Object Storage)                     │          │
│  │                                                             │          │
│  │  Bucket: qa-agent-files/                                   │          │
│  │    ├── sources/                                             │          │
│  │    │   └── {sourceId}/                                      │          │
│  │    │       └── {timestamp}-{random}-{filename}             │          │
│  │    │                                                        │          │
│  │    ├── documents/                                           │          │
│  │    │   └── {documentId}/                                    │          │
│  │    │       └── {timestamp}-{random}-{filename}             │          │
│  │    │                                                        │          │
│  │    └── uploads/                                             │          │
│  │        └── {timestamp}-{random}-{filename}                 │          │
│  └─────────────────────────────────────────────────────────────         │
│                                                                          │
│  ┌───────────────────────────────────────────────────────────┐          │
│  │              MongoDB (Future - QA Data)                    │          │
│  │                                                             │          │
│  │  Collections:                                               │          │
│  │  • testcases       - Test case definitions                 │          │
│  │  • executions      - Test execution history                │          │
│  │  • healingSuggestions - AI repair suggestions              │          │
│  │  • flows           - User journey definitions              │          │
│  │  • facts           - Business rules & constraints          │          │
│  └─────────────────────────────────────────────────────────────         │
└──────────────────────────────────────────────────────────────────────────┘
```

---

## Data Flow: Source Sync Pipeline

```
┌────────────┐
│   User     │
│  Triggers  │
│   Sync     │
└─────┬──────┘
      │
      ▼
┌──────────────────────────────────────────────────────────────┐
│                STAGE 1: PULLING                               │
└──────────────────────────────────────────────────────────────┘
      │
      ▼
┌─────────────┐
│   GitHub/   │ ──fetch──> ┌──────────────┐
│Jira/Conflu  │             │  Connector   │
│   -ence     │             │   Service    │
└─────────────┘             └──────┬───────┘
                                   │ Documents array
                                   ▼
┌──────────────────────────────────────────────────────────────┐
│                STAGE 2: PROCESSING                            │
└──────────────────────────────────────────────────────────────┘
                                   │
                                   ▼
                            ┌─────────────┐
                            │ PostgreSQL  │
                            │  documents  │◄── Check contentHash
                            └──────┬──────┘    for changes
                                   │
                     ┌─────────────┴──────────────┐
                     │                            │
               New/Changed                   Unchanged
                     │                            │
                     ▼                            ▼
            ┌─────────────┐               ┌────────────┐
            │    Redis    │               │    Skip    │
            │   Queue     │               │ Processing │
            │ processing  │               └────────────┘
            └──────┬──────┘
                   │
                   ▼
┌──────────────────────────────────────────────────────────────┐
│              STAGE 3: INDEXING (Background)                   │
└──────────────────────────────────────────────────────────────┘
                   │
      ┌────────────┼────────────┐
      │            │            │
      ▼            ▼            ▼
┌──────────┐ ┌──────────┐ ┌──────────┐
│Chunking  │ │Embedding │ │  Save    │
│ Service  │→│ Service  │→│PostgreSQL│
└──────────┘ └──────────┘ └──────────┘
                               │
                               ▼
                         ┌──────────┐
                         │PostgreSQL│
                         │  chunks  │
                         └─────┬────┘
                               │
                               ▼
                    Atomic increment:
                    documentsProcessed++
                               │
                               ▼
┌──────────────────────────────────────────────────────────────┐
│              STAGE 4: EXTRACTING (Background)                 │
└──────────────────────────────────────────────────────────────┘
                               │
                               ▼
                    ┌────────────────────┐
                    │    AI Extraction   │
                    │      Service       │
                    └──────────┬─────────┘
                               │ Business items
                               ▼
                    Atomic increment:
                    documentsExtracted++
                               │
                               ▼
┌──────────────────────────────────────────────────────────────┐
│              STAGE 5: POPULATING (Background)                 │
└──────────────────────────────────────────────────────────────┘
                               │
                ┌──────────────┼───────────────┐
                │              │               │
                ▼              ▼               ▼
        ┌──────────┐   ┌──────────┐   ┌──────────┐
        │PostgreSQL│   │  Neo4j   │   │ S3/MinIO │
        │business_ │   │  Graph   │   │  Upload  │
        │  items   │   │  Sync    │   │Attachment│
        └─────┬────┘   └──────────┘   └──────────┘
              │
              ▼
    Atomic increment:
    documentsPopulated++
    businessItemsExtracted += N
              │
              ▼
    ┌─────────────────┐
    │  All Stages     │
    │   Complete?     │
    └────────┬────────┘
             │ Yes
             ▼
    ┌─────────────────┐
    │   Mark Sync     │
    │   Completed     │
    └─────────────────┘
```

---

## Data Flow: Semantic Search Query

```
┌────────────┐
│   User     │
│   Query    │
│  "How do I │
│  login?"   │
└─────┬──────┘
      │
      ▼
┌──────────────────────────────────────────────────────────────┐
│              STEP 1: Generate Embedding                       │
└──────────────────────────────────────────────────────────────┘
      │
      ▼
┌─────────────┐
│  Embedding  │ ───────> [0.123, -0.456, 0.789, ...]
│   Service   │          (1536-dim vector)
└─────────────┘
      │
      ▼
┌──────────────────────────────────────────────────────────────┐
│              STEP 2: Vector Similarity Search                 │
└──────────────────────────────────────────────────────────────┘
      │
      ▼
┌─────────────┐
│ PostgreSQL  │ ───────> Cosine similarity:
│   chunks    │          distance = 1 - (A·B)/(||A||×||B||)
└──────┬──────┘
       │ Top-K chunks (K=10)
       │
       ▼
┌──────────────────────────────────────────────────────────────┐
│              STEP 3: Retrieve Full Documents                  │
└──────────────────────────────────────────────────────────────┘
       │
       ▼
┌─────────────┐
│ PostgreSQL  │ ───────> Full document content + metadata
│  documents  │
└──────┬──────┘
       │
       ▼
┌──────────────────────────────────────────────────────────────┐
│         STEP 4: Get Related Context (Optional)                │
└──────────────────────────────────────────────────────────────┘
       │
       ▼
┌─────────────┐
│   Neo4j     │ ───────> Related documents via graph
│   Graph     │          (requirements, tests, code)
└──────┬──────┘
       │
       ▼
┌──────────────────────────────────────────────────────────────┐
│         STEP 5: Enrich with Business Context                  │
└──────────────────────────────────────────────────────────────┘
       │
       ▼
┌─────────────┐
│ PostgreSQL  │ ───────> Business items linked to docs
│business_items│         (requirements, test cases, etc.)
└──────┬──────┘
       │
       ▼
┌──────────────────────────────────────────────────────────────┐
│         STEP 6: Feed to AI Agent                              │
└──────────────────────────────────────────────────────────────┘
       │
       ▼
┌─────────────┐
│  AI Agent   │ ───────> Generate answer using:
│   (LLM)     │          • Retrieved chunks
│             │          • Full documents
│             │          • Related context
│             │          • Business items
└──────┬──────┘
       │
       ▼
┌─────────────┐
│   Answer    │
│  Returned   │
│  to User    │
└─────────────┘
```

---

## Database Interaction Patterns

### Pattern 1: Atomic Counter Updates (Concurrent-Safe)

```
┌────────────┐  ┌────────────┐  ┌────────────┐
│  Worker 1  │  │  Worker 2  │  │  Worker 3  │
└─────┬──────┘  └─────┬──────┘  └─────┬──────┘
      │               │               │
      │  Document A   │  Document B   │  Document C
      │  processed    │  processed    │  processed
      │               │               │
      ▼               ▼               ▼
┌────────────────────────────────────────────┐
│           PostgreSQL sync_jobs             │
│                                            │
│  Atomic SQL:                               │
│  UPDATE sync_jobs                          │
│  SET metadata = jsonb_set(                 │
│    metadata,                               │
│    '{documentsProcessed}',                 │
│    to_jsonb(COALESCE(                      │
│      (metadata->>'documentsProcessed')::int│
│      , 0) + 1)                             │
│  )                                         │
│  WHERE id = $1                             │
│  RETURNING metadata                        │
│                                            │
│  Result: documentsProcessed = 3 ✓          │
│  (No lost updates!)                        │
└────────────────────────────────────────────┘
```

### Pattern 2: Change Detection (Avoid Redundant Processing)

```
┌────────────┐
│  Sync Job  │
└─────┬──────┘
      │ Fetch 100 documents
      ▼
┌─────────────────────────────────┐
│    For each document:           │
│                                 │
│  1. Compute contentHash         │
│     SHA-256(document.content)   │
│                                 │
│  2. Check existing:             │
│     SELECT * FROM documents     │
│     WHERE sourceId = $1         │
│       AND externalId = $2       │
│                                 │
│  3. Compare hashes:             │
│     IF existing.hash == new.hash│
│     THEN skip (unchanged)       │
│     ELSE queue for processing   │
└─────────────────────────────────┘
      │
      ▼
┌─────────────────────────────────┐
│  Result:                        │
│  • 90 unchanged → skip          │
│  • 5 updated → queue            │
│  • 5 new → queue                │
│                                 │
│  documentsToProcess = 10        │
│  (Not 100!)                     │
└─────────────────────────────────┘
```

### Pattern 3: Graph Relationship Extraction

```
┌────────────┐
│  Document  │
│  (GitHub PR│
│   #123)    │
└─────┬──────┘
      │
      ▼
┌─────────────────────────────────┐
│  Parse metadata:                │
│  {                              │
│    linkedIssues: ["issue-456"]  │
│  }                              │
└──────┬──────────────────────────┘
       │
       ▼
┌─────────────────────────────────┐
│  Find linked document:          │
│  SELECT id FROM documents       │
│  WHERE externalId = 'issue-456' │
└──────┬──────────────────────────┘
       │
       ▼
┌─────────────────────────────────┐
│  Create graph relationship:     │
│                                 │
│  MATCH (pr {id: $prId})         │
│  MATCH (issue {id: $issueId})   │
│  MERGE (pr)-[:FIXES]->(issue)   │
└─────────────────────────────────┘
       │
       ▼
    ┌───────┐
    │ Neo4j │
    │ Graph │
    └───────┘
```

---

## Scaling Considerations

### Horizontal Scaling Targets

```
┌────────────────────────────────────────────────────────────┐
│                    Application Tier                         │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐  │
│  │ API      │  │ API      │  │ API      │  │ API      │  │
│  │ Server 1 │  │ Server 2 │  │ Server 3 │  │ Server N │  │
│  └─────┬────┘  └─────┬────┘  └─────┬────┘  └─────┬────┘  │
│        │             │             │             │        │
│        └─────────────┴─────────────┴─────────────┘        │
│                          │                                 │
└──────────────────────────┼─────────────────────────────────┘
                           │
           ┌───────────────┼───────────────┐
           │               │               │
           ▼               ▼               ▼
    ┌──────────┐    ┌──────────┐    ┌──────────┐
    │PostgreSQL│    │  Redis   │    │  Neo4j   │
    │          │    │          │    │          │
    │ Primary  │    │ Cluster  │    │ Cluster  │
    │   +      │    │ (Sentinel│    │(Causal)  │
    │ Replicas │    │   HA)    │    │          │
    └──────────┘    └──────────┘    └──────────┘
```

### Vertical Scaling Guidelines

| Database | Small (Dev) | Medium (Staging) | Large (Prod) |
|----------|-------------|------------------|--------------|
| PostgreSQL | 2 CPU, 4GB RAM | 4 CPU, 16GB RAM | 8+ CPU, 32GB+ RAM |
| Redis | 1 CPU, 2GB RAM | 2 CPU, 8GB RAM | 4+ CPU, 16GB+ RAM |
| Neo4j | 2 CPU, 4GB RAM | 4 CPU, 16GB RAM | 8+ CPU, 32GB+ RAM |
| MinIO | 2 CPU, 4GB RAM | 4 CPU, 8GB RAM | 8+ CPU, 16GB+ RAM |

---

## Summary

This architecture leverages:

1. **PostgreSQL**: Strong consistency, relational integrity, JSONB flexibility
2. **Redis**: Fast queuing, reliable job processing
3. **Neo4j**: Powerful graph queries, traceability paths
4. **S3/MinIO**: Scalable blob storage, cost-effective
5. **MongoDB** (planned): Flexible schemas for dynamic QA data

Each database is chosen for its specific strengths, creating a robust polyglot persistence architecture.
