# Quick Start Guide - Running Sync Pipeline Tests

This guide will help you quickly set up and run the sync pipeline tests.

## Prerequisites Setup (5 minutes)

### 1. Start PostgreSQL
```bash
# If using Docker
docker run --name postgres-test -e POSTGRES_PASSWORD=postgres -p 5432:5432 -d postgres:14

# Create test database
docker exec -it postgres-test psql -U postgres -c "CREATE DATABASE ultimate_qa_test;"

# OR if using local PostgreSQL
createdb ultimate_qa_test
```

### 2. Start Redis
```bash
# If using Docker
docker run --name redis-test -p 6379:6379 -d redis:7

# OR if using local Redis
redis-server

# Verify Redis is running
redis-cli ping  # Should return "PONG"
```

### 3. (Optional) Start Neo4j
```bash
# If using Docker
docker run --name neo4j-test \
  -p 7474:7474 -p 7687:7687 \
  -e NEO4J_AUTH=neo4j/test_password \
  -d neo4j:latest
```

## Running Tests

### Quick Test (recommended for first run)

Run a simple test to verify everything is working:

```bash
cd /Users/siam/Developer/ultimate-qa-agent/apps/api

# Install dependencies (if not already done)
npm install

# Run the main sync pipeline test
npm run test:sync-pipeline
```

### Full Test Suite

```bash
# Run all E2E tests
npm run test:e2e

# Run all tests including unit tests (when added)
npm test

# Run with coverage report
npm run test:cov
```

### Watch Mode (for development)

```bash
npm run test:watch
```

## What the Tests Cover

### 1. **Full Sync Pipeline Test** (`sync-pipeline.e2e.spec.ts`)
   - ✅ All 5 stages: Pulling → Processing → Indexing → Extracting → Populating
   - ✅ Full, incremental, and selective sync modes
   - ✅ Multi-source syncing (GitHub, Jira, Confluence)
   - ✅ Business knowledge extraction (flows, rules, entities, APIs)
   - ✅ Error handling and recovery

### 2. **Individual Stage Tests** (`sync-stages.e2e.spec.ts`)
   - ✅ Each stage tested in isolation
   - ✅ Progress tracking and atomic operations
   - ✅ Content hashing and deduplication
   - ✅ Embedding generation
   - ✅ Business item extraction and relationships

### 3. **Error Handling Tests** (`sync-error-handling.e2e.spec.ts`)
   - ✅ Connection failures
   - ✅ Stage-level errors
   - ✅ Concurrent sync prevention
   - ✅ Data integrity on failures

## Expected Output

When tests run successfully, you should see:

```
 PASS  test/e2e/sync-pipeline.e2e.spec.ts
  Sync Pipeline E2E Tests
    Full Sync Pipeline (All 5 Stages)
      ✓ should complete a full sync successfully from GitHub source (1234ms)
      ✓ should handle incremental sync correctly (987ms)
      ✓ should handle selective sync with specific externalIds (876ms)
    Stage-by-Stage Verification
      ✓ should complete PULLING stage and fetch documents from connector (543ms)
      ...
    Multi-Source Sync
      ✓ should handle syncing multiple sources concurrently (1567ms)
    Business Knowledge Extraction
      ✓ should extract flows, rules, entities, and APIs from documents (1234ms)

Test Suites: 3 passed, 3 total
Tests:       25 passed, 25 total
Snapshots:   0 total
Time:        45.678 s
```

## Troubleshooting

### "Connection refused" errors

**Problem**: Cannot connect to PostgreSQL/Redis

**Solution**:
```bash
# Check if services are running
docker ps  # Should show postgres-test and redis-test

# Check PostgreSQL
psql -U postgres -h localhost -c "SELECT 1;"

# Check Redis
redis-cli ping
```

### "Database does not exist" errors

**Problem**: Test database not created

**Solution**:
```bash
# Create the test database
createdb ultimate_qa_test

# OR with Docker
docker exec -it postgres-test psql -U postgres -c "CREATE DATABASE ultimate_qa_test;"
```

### Tests hang or timeout

**Problem**: Queue jobs not processing

**Solution**:
- Ensure Redis is running and accessible
- Check `.env.test` has correct Redis configuration
- Try clearing Redis: `redis-cli FLUSHDB`

### "Port already in use" errors

**Problem**: Ports 5432 or 6379 already taken

**Solution**:
```bash
# Find and stop conflicting processes
lsof -i :5432
lsof -i :6379

# Or use different ports in .env.test
```

## Test Data

Tests use mock data defined in `test/fixtures/connector-documents.fixture.ts`:

- **3 GitHub documents**: Issue, PR, Code file
- **1 Jira document**: User story with test cases
- **1 Confluence document**: Architecture documentation

Each document contains realistic content designed to trigger extraction of:
- Flows (user authentication flow)
- Rules (password validation requirements)
- Entities (User, RefreshToken schemas)
- APIs (POST /api/auth/login, etc.)

## Next Steps

After tests pass successfully:

1. **Review Coverage Report**
   ```bash
   npm run test:cov
   # Open coverage/lcov-report/index.html in browser
   ```

2. **Add Custom Tests**
   - Copy one of the existing test files
   - Modify to test your specific scenarios
   - Run with `npm test -- your-test-file.spec.ts`

3. **Run in CI/CD**
   - Tests are designed to run in GitHub Actions
   - See `test/README.md` for CI configuration example

## Clean Up

When done testing:

```bash
# Stop and remove Docker containers
docker stop postgres-test redis-test neo4j-test
docker rm postgres-test redis-test neo4j-test

# Or if using local services, just stop them normally
```

## Getting Help

If you encounter issues:

1. Check `test/README.md` for detailed documentation
2. Review test logs for specific error messages
3. Ensure all environment variables in `.env.test` are correct
4. Try running tests one at a time to isolate issues

## Performance Notes

- Tests run sequentially (`maxWorkers: 1`) to avoid database conflicts
- Full suite takes approximately 30-60 seconds
- Individual test files run faster (10-20 seconds)
- Watch mode provides instant feedback during development
