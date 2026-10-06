# Database Quick Reference Guide

Quick lookup table for understanding when and why each database/storage is used.

## When to Use Which Database?

| Need | Use | Why |
|------|-----|-----|
| Store a source connection | PostgreSQL `sources` | Relational data with foreign keys |
| Store ingested documents | PostgreSQL `documents` | Structured data with change tracking |
| Store text embeddings | PostgreSQL `chunks` | Future pgvector support |
| Track sync job progress | PostgreSQL `sync_jobs` | ACID transactions for status updates |
| Queue document processing | Redis `processing` queue | Async background jobs |
| Queue source syncing | Redis `sync` queue | Async background jobs |
| Store file attachments | S3/MinIO | Binary blobs, cost-effective storage |
| Link requirements to tests | Neo4j | Graph relationships, traceability |
| Find what tests cover a feature | Neo4j | Graph traversal queries |
| Impact analysis | Neo4j | Multi-hop relationship queries |
| Test execution history | MongoDB (planned) | Flexible schema, time-series |
| AI healing suggestions | MongoDB (planned) | Dynamic structure, rapid iteration |

## Data Operation Patterns

### Creating a New Source
```
1. User clicks "Connect Source"
2. Save to PostgreSQL (sources table)
3. Return source ID to user
```

### Running a Sync
```
1. User triggers sync
2. Create sync job in PostgreSQL (sync_jobs)
3. Add job to Redis (sync queue)
4. Worker pulls from queue
5. Fetch docs from API → Save to PostgreSQL (documents)
6. Queue processing jobs → Redis (processing queue)
7. Workers generate chunks/embeddings → PostgreSQL (chunks)
8. Sync to graph → Neo4j (nodes + relationships)
9. Upload attachments → S3/MinIO
10. Extract business items → PostgreSQL (business_items)
11. Update sync job status → PostgreSQL
```

### Searching Documents
```
1. User submits query
2. Generate embedding
3. Search PostgreSQL chunks (cosine similarity)
4. Get parent documents from PostgreSQL
5. Optional: Get related docs from Neo4j
6. Return results to user
```

### Downloading an Attachment
```
1. User requests file
2. Lookup file key in PostgreSQL metadata
3. Download from S3/MinIO
4. Stream to user
```

## Database Size Estimates (Rough)

Based on 1000 documents from sources:

| Database | Data | Estimated Size |
|----------|------|----------------|
| PostgreSQL | 1000 documents @ 10KB avg | ~10 MB |
| PostgreSQL | 10,000 chunks @ 1KB avg | ~10 MB |
| PostgreSQL | 10,000 embeddings @ 1536 dims | ~60 MB (JSONB) |
| Neo4j | 1000 nodes + 5000 relationships | ~5 MB |
| S3/MinIO | 100 attachments @ 500KB avg | ~50 MB |
| Redis | Queue metadata | ~1 MB |
| **Total** | | **~136 MB** |

For 100K documents: ~13.6 GB

## Connection Limits

| Database | Default Max | Recommended Pool |
|----------|-------------|------------------|
| PostgreSQL | 100 connections | 20-50 |
| Redis | 10,000 connections | 10-20 |
| Neo4j | Unlimited (bolt) | 10-20 |
| S3/MinIO | N/A (HTTP) | N/A |

## Monitoring Checklist

### PostgreSQL
- [ ] Active connections
- [ ] Slow query log
- [ ] Table sizes (especially chunks)
- [ ] Index usage
- [ ] Cache hit ratio

### Redis
- [ ] Memory usage
- [ ] Queue lengths
- [ ] Failed jobs
- [ ] Eviction count

### Neo4j
- [ ] JVM heap usage
- [ ] Store sizes
- [ ] Query performance
- [ ] Transaction count

### S3/MinIO
- [ ] Bucket size
- [ ] Request rate
- [ ] Error rate
- [ ] Bandwidth usage

## Common Queries

### PostgreSQL

```sql
-- Count documents by source
SELECT s.name, COUNT(d.id) as doc_count
FROM sources s
LEFT JOIN documents d ON d.source_id = s.id
GROUP BY s.id, s.name;

-- Find documents without chunks
SELECT d.id, d.title
FROM documents d
LEFT JOIN chunks c ON c.document_id = d.id
WHERE c.id IS NULL;

-- Sync job status
SELECT status, COUNT(*) as count
FROM sync_jobs
GROUP BY status;

-- Check embedding coverage
SELECT
  COUNT(*) as total_chunks,
  COUNT(CASE WHEN embedding IS NOT NULL THEN 1 END) as embedded,
  ROUND(100.0 * COUNT(CASE WHEN embedding IS NOT NULL THEN 1 END) / COUNT(*), 2) as percentage
FROM chunks;
```

### Redis (via CLI)

```bash
# Check queue lengths
redis-cli LLEN bull:processing:wait
redis-cli LLEN bull:sync:wait

# Get queue info
redis-cli --scan --pattern 'bull:*'

# Clear failed jobs
redis-cli DEL bull:processing:failed
```

### Neo4j (Cypher)

```cypher
// Count nodes by type
MATCH (n)
RETURN labels(n) as type, count(n) as count
ORDER BY count DESC;

// Count relationships by type
MATCH ()-[r]->()
RETURN type(r) as relationship, count(r) as count
ORDER BY count DESC;

// Find orphaned nodes (no relationships)
MATCH (n)
WHERE NOT (n)--()
RETURN labels(n), count(n);

// Coverage percentage
MATCH (r:Requirement)
WITH count(r) as total
MATCH (r2:Requirement)<-[:TESTS]-()
RETURN total, count(DISTINCT r2) as covered,
       100.0 * count(DISTINCT r2) / total as percentage;
```

### S3/MinIO (AWS CLI)

```bash
# List bucket contents
aws --endpoint-url http://localhost:9000 s3 ls qa-agent-files/

# Get bucket size
aws --endpoint-url http://localhost:9000 s3 ls s3://qa-agent-files --recursive \
  --summarize --human-readable

# Delete prefix
aws --endpoint-url http://localhost:9000 s3 rm s3://qa-agent-files/sources/SOURCE_ID/ --recursive
```

## Optimization Tips

### PostgreSQL
1. **Add indexes** on frequently queried JSONB fields
   ```sql
   CREATE INDEX idx_doc_metadata_type ON documents USING GIN ((metadata->'type'));
   ```
2. **Use EXPLAIN ANALYZE** to find slow queries
3. **Vacuum regularly** to reclaim space
4. **Partition large tables** (chunks, executions)

### Redis
1. **Monitor memory** and set `maxmemory-policy`
2. **Use job priorities** for critical syncs
3. **Configure retries** with exponential backoff
4. **Clean completed jobs** periodically

### Neo4j
1. **Create constraints** on frequently queried properties
   ```cypher
   CREATE CONSTRAINT FOR (n:Document) REQUIRE n.id IS UNIQUE;
   ```
2. **Use parameters** in queries to cache execution plans
3. **Profile queries** with `PROFILE` prefix
4. **Batch operations** in transactions

### S3/MinIO
1. **Use multipart upload** for files >5MB
2. **Enable compression** for text files
3. **Set lifecycle rules** to delete old temp files
4. **Use CloudFront/CDN** for frequently accessed files

## Database Connection Strings

```bash
# PostgreSQL
postgresql://qaagent:qaagent123@localhost:5432/qaagent

# Redis
redis://localhost:6379

# Neo4j
bolt://neo4j:qaagent123@localhost:7687

# MinIO (S3-compatible)
http://qaagent:qaagent123@localhost:9000/qa-agent-files
```

## Docker Compose Quick Start

```yaml
services:
  postgres:
    image: postgres:15
    environment:
      POSTGRES_DB: qaagent
      POSTGRES_USER: qaagent
      POSTGRES_PASSWORD: qaagent123
    ports:
      - "5432:5432"

  redis:
    image: redis:7
    ports:
      - "6379:6379"

  neo4j:
    image: neo4j:5
    environment:
      NEO4J_AUTH: neo4j/qaagent123
    ports:
      - "7474:7474"  # HTTP
      - "7687:7687"  # Bolt

  minio:
    image: minio/minio
    command: server /data --console-address ":9001"
    environment:
      MINIO_ROOT_USER: qaagent
      MINIO_ROOT_PASSWORD: qaagent123
    ports:
      - "9000:9000"  # API
      - "9001:9001"  # Console
```

## Troubleshooting Quick Fixes

| Issue | Quick Fix |
|-------|-----------|
| PostgreSQL connection refused | Check if service is running: `docker ps` |
| Redis queue stuck | Check worker logs, restart workers |
| Neo4j out of memory | Increase heap size in neo4j.conf |
| S3 upload fails | Verify credentials and bucket exists |
| Slow chunk search | Add index on embedding column (after pgvector) |
| Jobs not processing | Check Redis connection and Bull workers |
| Graph queries slow | Add indexes on frequently queried properties |
| Disk space full | Clear old sync jobs, vacuum PostgreSQL |
