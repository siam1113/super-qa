# Ultimate QA Agent - Documentation

Welcome to the Ultimate QA Agent documentation. This folder contains comprehensive guides and technical documentation for the platform.

## Documentation Index

### Takeover Review and Delivery

- [Conversational agent platform plan](./conversational-agent-platform-plan.md): phased design for native chat, Slack/Teams integrations, meetings, voice, and parallel agent work.
- [Chat and text integrations](./chat-and-text-integrations.md): native personal/group chats, named agents, scoped tasks, Slack/Teams bot setup, response/delivery behavior and verification.
- [Meetings](./meetings.md): native video-call pilot, note-taking/active modes, Teams/Meet adapter, consent, deployment and remaining provider/voice gates.
- [Live meeting voice](./live-meeting-voice.md): GPT-Live participation, native audio relay, Teams/Meet media bridge, security controls and real-provider rollout gates.
- [Native call verification](./native-call-verification.md): audio fixes, speaking indicators, compact lobby, automatic final notes, browser regression coverage, and a real GPT-Live call result.
- [Platform audit](./platform-audit.md): implementation findings, priorities, premature scope and missing foundations.
- [Implementation log](./implementation-log.md): delivered changes, verification and outstanding work.
- [Delivery design](./platform-delivery-design.md): proposed pipeline, evidence and QAE/AUE harness contracts.
- [Durable sync pipeline](./durable-sync-pipeline.md): implemented recovery, cancellation, publication and migration runbook.
- [Extraction accuracy and evidence](./extraction-evidence.md): grounded proposals, coverage limits, budgets and reproducible evaluation.
- [Extraction coverage v2](./extraction-coverage-v2.md): current section-aware workflow/scenario extraction, field citations and expanded regression corpus.
- [Evidence handoff end to end](./evidence-handoff-e2e.md): scoped retrieval, revision resolution, Python agent integration, verification and full-platform blockers.
- [Persisted QA workflows](./persisted-qa-workflows.md): build repairs, reviewed cases, manual observations, healing decisions and migration runbook.
- [Shared agent harness](./shared-agent-harness.md): durable QAE/AUE proposals, budgets, leases, access controls, operator commands and execution limitations.
- [QA skills and subgraphs](./qa-skills.md): deterministic QAE/AUE workflows, shared tools, MCP, persisted artifacts, scoped delegation, and configuration.
- [Phase 1 foundation](./qa-phase-1-foundation.md): readiness profiles, versioned app artifacts, publication recovery, job helpers, deployment and current limits.
- [Requirement review and artifact handoff](qa-requirement-review.md) — C1 workflow, revision checks and draft case provenance.
- [Repository execution and data preparation](qa-repository-execution.md): bounded C2 workers, fixture lifecycle, current job reports and deployment.
- [QA package roadmap](./qa-package-roadmap.md): planned delivery of core QA capabilities, deeper existing skills, and specialist packs, with dependencies and acceptance gates.
- [Sandboxed browser execution](./sandboxed-browser-execution.md): authorized offline Chromium runs, immutable assertions, artifacts, recovery and rollout.
- [Autonomy delivery ledger](./autonomy-delivery.md): five-workstream implementation status and remaining replacement-readiness gaps.
- [Autonomy operations](./autonomy-operations.md): scoped onboarding, suites, read-only HTTPS workers, CI, evaluations, lockdown and recovery.
- [Live workflows and accuracy](./live-workflows.md): isolated authenticated browser execution, namespaced mutations, durable cleanup/recovery and revision-bound project benchmarks.
- [Settings and benchmark collection](./settings-benchmarks.md): scoped Settings UI, credential management, durable reviewed cohorts, resumable collection, evidence export and browser verification.
- [Organization accounts and SSO](./organization-accounts.md): password accounts, email invitations, browser sessions, OIDC configuration and identity limits.
- [Integrations and Pipelines](./integrations-and-pipelines.md): connection setup ownership, pipeline tabs, source details, data limits, and current view boundaries.

The audit and implementation log qualify older readiness and performance claims in these docs. Treat unmeasured throughput, cost and confidence figures as unverified, not acceptance results.

### 📊 Database & Storage Architecture

#### [DATABASE_ARCHITECTURE.md](./DATABASE_ARCHITECTURE.md)
**Complete technical reference for all databases and storage systems**

Covers:
- PostgreSQL: Primary relational database (sources, documents, chunks, sync jobs, business items)
- Redis: Background job queuing (processing queue, sync queue)
- Neo4j: Graph database for traceability and relationships
- S3/MinIO: Object storage for files and attachments
- PostgreSQL: persisted cases, manual runs and healing decisions (supersedes the older MongoDB plan)

Includes:
- Detailed purpose and usage for each database
- Complete schema documentation
- Data flow diagrams
- Performance considerations
- Backup & recovery strategies
- Troubleshooting guides

**Read this if you need:**
- Deep understanding of data architecture
- Schema design decisions
- Why we use multiple databases
- Performance optimization strategies

---

#### [QUICK_REFERENCE_DATABASES.md](./QUICK_REFERENCE_DATABASES.md)
**Fast lookup guide for daily development**

Quick references for:
- When to use which database (decision table)
- Common query patterns (SQL, Cypher, Redis CLI)
- Connection strings and configuration
- Monitoring checklists
- Troubleshooting quick fixes
- Database size estimates
- Optimization tips

**Read this if you need:**
- Quick lookup during development
- Common query examples
- Troubleshooting help
- Configuration references

---

## Getting Started with Databases

### Local Development Setup

1. **Start all databases using Docker Compose:**
   ```bash
   docker-compose up -d postgres redis neo4j minio
   ```

2. **Verify connections:**
   ```bash
   # PostgreSQL
   psql postgresql://qaagent:qaagent123@localhost:5432/qaagent -c "\dt"

   # Redis
   redis-cli PING

   # Neo4j (browser)
   open http://localhost:7474

   # MinIO (console)
   open http://localhost:9001
   ```

3. **Configure environment:**
   ```bash
   cp apps/api/.env.example apps/api/.env
   # Edit .env with your database credentials
   ```

### Understanding Data Flow

**For a typical sync operation:**

```
User Trigger
    ↓
PostgreSQL (create sync_job)
    ↓
Redis (queue sync job)
    ↓
Worker fetches from API
    ↓
PostgreSQL (save documents)
    ↓
Redis (queue processing jobs)
    ↓
Workers generate embeddings
    ↓
PostgreSQL (save chunks) + Neo4j (sync graph) + S3 (upload files)
    ↓
PostgreSQL (save business items)
    ↓
PostgreSQL (complete sync_job)
```

See [DATABASE_ARCHITECTURE.md](./DATABASE_ARCHITECTURE.md) for detailed diagrams.

---

## Common Tasks

### Viewing Database Contents

**PostgreSQL:**
```sql
-- See all sources
SELECT id, name, type, status FROM sources;

-- See documents for a source
SELECT id, title, type FROM documents WHERE source_id = 'SOURCE_ID';

-- Check sync job status
SELECT id, status, current_stage FROM sync_jobs ORDER BY created_at DESC LIMIT 10;
```

**Redis:**
```bash
# Check queue lengths
redis-cli LLEN bull:processing:wait
redis-cli LLEN bull:sync:wait

# View queue stats
redis-cli --scan --pattern 'bull:*'
```

**Neo4j:**
```cypher
// View all node types
MATCH (n) RETURN labels(n), count(n) ORDER BY count(n) DESC;

// View relationship types
MATCH ()-[r]->() RETURN type(r), count(r) ORDER BY count(r) DESC;

// Find tests for a requirement
MATCH (t:TestCase)-[:TESTS]->(r:Requirement {id: 'REQ_ID'}) RETURN t;
```

**MinIO:**
```bash
# Using AWS CLI
aws --endpoint-url http://localhost:9000 s3 ls qa-agent-files/

# Or browse console
open http://localhost:9001
```

### Clearing Data

**PostgreSQL:**
```sql
-- Delete all data for a source (cascades to documents, chunks)
DELETE FROM sources WHERE id = 'SOURCE_ID';

-- Clear all sync jobs
TRUNCATE sync_jobs CASCADE;
```

**Redis:**
```bash
# Clear all queues
redis-cli FLUSHALL

# Clear specific queue
redis-cli DEL bull:processing:wait
redis-cli DEL bull:processing:active
redis-cli DEL bull:processing:failed
```

**Neo4j:**
```cypher
// Delete all nodes and relationships
MATCH (n) DETACH DELETE n;

// Delete nodes for a specific source
MATCH (n)-[:FROM_SOURCE]->(:Source {id: 'SOURCE_ID'}) DETACH DELETE n;
```

**MinIO:**
```bash
# Delete all files for a source
aws --endpoint-url http://localhost:9000 s3 rm s3://qa-agent-files/sources/SOURCE_ID/ --recursive
```

---

## Database Migrations

### PostgreSQL

Migrations are managed by TypeORM:

```bash
# Generate migration
npm run migration:generate -- -n MigrationName

# Run migrations
npm run migration:run

# Revert last migration
npm run migration:revert
```

### Neo4j

Schema changes are applied via constraints and indexes in `graph.service.ts`:

```typescript
// Constraints are created on module init
async createConstraints() {
  // Creates UNIQUE constraints on node IDs
  // Creates indexes on externalId
}
```

---

## Performance Tips

### Database Indexing

**PostgreSQL:**
- Indexes exist on `externalId`, `contentHash`, `sourceId`
- Add JSONB indexes for metadata queries:
  ```sql
  CREATE INDEX idx_metadata_type ON documents USING GIN ((metadata->'type'));
  ```

**Neo4j:**
- Constraints auto-create indexes on `id`
- Add indexes on frequently queried properties:
  ```cypher
  CREATE INDEX FOR (n:Document) ON (n.title);
  ```

### Query Optimization

**PostgreSQL:**
```sql
-- Use EXPLAIN ANALYZE to find slow queries
EXPLAIN ANALYZE SELECT * FROM documents WHERE source_id = 'SOURCE_ID';
```

**Neo4j:**
```cypher
// Use PROFILE to analyze query performance
PROFILE MATCH (n:Document) RETURN n LIMIT 10;
```

---

## Backup & Restore

### Development Backup

**PostgreSQL:**
```bash
# Backup
docker exec qa-postgres pg_dump -U qaagent qaagent > backup.sql

# Restore
docker exec -i qa-postgres psql -U qaagent qaagent < backup.sql
```

**Neo4j:**
```bash
# Backup
docker exec qa-neo4j neo4j-admin dump --database=neo4j --to=/backups/neo4j-backup.dump

# Restore
docker exec qa-neo4j neo4j-admin load --from=/backups/neo4j-backup.dump --database=neo4j --force
```

**MinIO:**
```bash
# Sync to local backup
mc mirror minio/qa-agent-files ./backup-files/
```

---

## Monitoring & Health Checks

### Database Health Endpoints

The API provides health check endpoints:

```bash
# Overall health
curl http://localhost:4000/health

# Database-specific checks
curl http://localhost:4000/health/postgres
curl http://localhost:4000/health/redis
curl http://localhost:4000/health/neo4j
curl http://localhost:4000/health/s3
```

### Monitoring Metrics

See [QUICK_REFERENCE_DATABASES.md](./QUICK_REFERENCE_DATABASES.md) for:
- Connection limits
- Size estimates
- Monitoring checklists
- Performance benchmarks

---

## Additional Resources

### Official Documentation
- [PostgreSQL Documentation](https://www.postgresql.org/docs/)
- [Redis Documentation](https://redis.io/docs/)
- [Neo4j Documentation](https://neo4j.com/docs/)
- [AWS S3 API Reference](https://docs.aws.amazon.com/s3/)
- [MinIO Documentation](https://min.io/docs/)

### Tools
- **PostgreSQL:** pgAdmin, DBeaver, psql
- **Redis:** RedisInsight, redis-cli
- **Neo4j:** Neo4j Browser, Neo4j Bloom
- **S3/MinIO:** AWS CLI, MinIO Console, Cyberduck

### Related Docs
- `apps/api/.env.example` - Environment configuration
- `apps/api/src/config/database.config.ts` - TypeORM configuration
- `apps/api/src/modules/graph/graph.service.ts` - Neo4j service
- `apps/api/src/modules/storage/storage.service.ts` - S3/MinIO service

---

## Contributing to Documentation

When adding new database features:

1. Update [DATABASE_ARCHITECTURE.md](./DATABASE_ARCHITECTURE.md) with detailed technical information
2. Add quick reference entries to [QUICK_REFERENCE_DATABASES.md](./QUICK_REFERENCE_DATABASES.md)
3. Update this README if adding a new database/storage system
4. Include example queries and use cases

---

## Questions?

For specific database questions:
- PostgreSQL schema: See entity files in `apps/api/src/modules/*/entities/`
- Redis queues: See `processing.module.ts` and `sources.module.ts`
- Neo4j relationships: See `graph.service.ts`
- S3/MinIO operations: See `storage.service.ts`

- [API testing and defect investigation](qa-api-investigation.md) — C3 request sequences, assertions, scoped fixtures and reproduction findings.

- [Regression selection and traceability](qa-regression-selection.md) — C4 selection policy, pinned case links and repository app revision probes.
