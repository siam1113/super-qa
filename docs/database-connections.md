# Database Connections

This document contains connection details for all databases used in the QA Agent platform.

## Quick Start

Start all databases with Docker:

```bash
docker compose up -d
```

Check status:

```bash
docker compose ps
```

---

## PostgreSQL (pgvector)

Primary relational database with vector extension for embeddings.

### Connection Details

| Setting  | Value       |
|----------|-------------|
| Host     | localhost   |
| Port     | 5432        |
| User     | qaagent     |
| Password | qaagent123  |
| Database | qaagent     |

### Access Methods

**Command Line:**
```bash
docker exec -it qa-agent-db psql -U qaagent -d qaagent
```

**Connection String:**
```
postgresql://qaagent:qaagent123@localhost:5432/qaagent
```

**GUI Tools:**
- [pgAdmin](https://www.pgadmin.org/) - Official PostgreSQL admin tool
- [DBeaver](https://dbeaver.io/) - Universal database tool
- [TablePlus](https://tableplus.com/) - Modern database GUI

### Tables

| Table     | Description                          |
|-----------|--------------------------------------|
| sources   | Connected data sources (GitHub, Jira, etc.) |
| documents | Synced documents from sources        |
| chunks    | Document chunks with vector embeddings |
| sync_jobs | Background sync job records          |

### Useful Commands

```sql
-- List all tables
\dt

-- Describe a table
\d sources

-- Count documents
SELECT COUNT(*) FROM documents;

-- Check vector extension
SELECT * FROM pg_extension WHERE extname = 'vector';
```

---

## MinIO (S3-Compatible Blob Storage)

Object storage for files, attachments, and binary assets.

### Connection Details

| Setting    | Value           |
|------------|-----------------|
| Endpoint   | localhost:9000  |
| Console    | localhost:9001  |
| Access Key | qaagent         |
| Secret Key | qaagent123      |
| Bucket     | qa-agent-files  |

### Access Methods

**Web Console:**
```
http://localhost:9001
```
Login with `qaagent` / `qaagent123`

**AWS CLI:**
```bash
# Configure
aws configure set aws_access_key_id qaagent
aws configure set aws_secret_access_key qaagent123

# List buckets
aws --endpoint-url http://localhost:9000 s3 ls

# List files in bucket
aws --endpoint-url http://localhost:9000 s3 ls s3://qa-agent-files/
```

**Environment Variables:**
```env
S3_ENDPOINT=http://localhost:9000
S3_REGION=us-east-1
S3_ACCESS_KEY=qaagent
S3_SECRET_KEY=qaagent123
S3_BUCKET=qa-agent-files
```

---

## Neo4j (Graph Database)

Graph database for traceability relationships between requirements, tests, code, and bugs.

### Connection Details

| Setting  | Value                   |
|----------|-------------------------|
| HTTP     | http://localhost:7474   |
| Bolt     | bolt://localhost:7687   |
| Username | neo4j                   |
| Password | qaagent123              |

### Access Methods

**Neo4j Browser:**
```
http://localhost:7474
```
Connect with `neo4j` / `qaagent123`

**Cypher Shell:**
```bash
docker exec -it qa-agent-neo4j cypher-shell -u neo4j -p qaagent123
```

**Environment Variables:**
```env
NEO4J_URI=bolt://localhost:7687
NEO4J_USER=neo4j
NEO4J_PASSWORD=qaagent123
```

### Node Types

| Type        | Description                     |
|-------------|---------------------------------|
| Requirement | Product requirements            |
| TestCase    | Test cases                      |
| Code        | Code files, PRs                 |
| Bug         | Bug reports, issues             |
| Feature     | Feature requests                |
| Document    | Documentation pages             |
| Source      | Data sources                    |

### Relationship Types

| Relationship | Description                           |
|--------------|---------------------------------------|
| TESTS        | TestCase tests a Requirement          |
| IMPLEMENTS   | Code implements a Requirement         |
| COVERS       | TestCase covers Code                  |
| FOUND_IN     | Bug found in TestCase                 |
| AFFECTS      | Bug affects Requirement               |
| FIXES        | Code fixes Bug                        |
| PART_OF      | Child is part of Parent               |
| DEPENDS_ON   | Node depends on another Node          |
| FROM_SOURCE  | Document comes from Source            |
| REFERENCES   | Document references another Document  |

### Useful Cypher Queries

```cypher
-- Count all nodes
MATCH (n) RETURN labels(n), count(n);

-- Find all requirements with tests
MATCH (t:TestCase)-[:TESTS]->(r:Requirement)
RETURN r.title, collect(t.title);

-- Impact analysis - what's affected by a requirement change
MATCH (r:Requirement {id: 'req-123'})<-[*1..3]-(affected)
RETURN affected;

-- Traceability path
MATCH path = shortestPath((a {id: 'id1'})-[*]-(b {id: 'id2'}))
RETURN path;
```

---

## Redis

In-memory cache and message queue for Bull job processing.

### Connection Details

| Setting  | Value     |
|----------|-----------|
| Host     | localhost |
| Port     | 6379      |
| Password | (none)    |

### Access Methods

**Command Line:**
```bash
docker exec -it qa-agent-redis redis-cli
```

**Connection String:**
```
redis://localhost:6379
```

**GUI Tools:**
- [RedisInsight](https://redis.io/insight/) - Official Redis GUI (free)
- [Another Redis Desktop Manager](https://github.com/qishibo/AnotherRedisDesktopManager)

**Environment Variables:**
```env
REDIS_HOST=localhost
REDIS_PORT=6379
```

### Useful Commands

```bash
# Test connection
PING

# List all keys
KEYS *

# List Bull queues
KEYS bull:*

# Get queue info
LLEN bull:sync:wait
```

---

## Health Checks

### API Endpoints

```bash
# Graph database health
curl http://localhost:4000/api/graph/health

# All sources
curl http://localhost:4000/api/sources
```

### Docker Health

```bash
# Check all containers
docker compose ps

# View logs
docker compose logs -f postgres
docker compose logs -f neo4j
docker compose logs -f minio
docker compose logs -f redis
```

---

## Troubleshooting

### PostgreSQL Connection Refused
```bash
# Check if container is running
docker ps | grep qa-agent-db

# Restart container
docker compose restart postgres
```

### Neo4j Not Connecting
```bash
# Check logs
docker compose logs neo4j

# Neo4j takes ~30s to start, wait and retry
```

### MinIO Bucket Not Found
```bash
# Bucket is auto-created on API startup
# Restart API to create bucket
cd apps/api && npm run start:dev
```

### Reset All Data
```bash
# Stop and remove all containers and volumes
docker compose down -v

# Start fresh
docker compose up -d
```
