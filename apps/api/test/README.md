# API Test Suite

This directory contains end-to-end tests for the Ultimate QA Agent API, with a focus on the sync pipeline.

## Directory Structure

```
test/
├── e2e/                          # End-to-end tests
│   ├── sync-pipeline.e2e.spec.ts       # Main sync pipeline tests (all 5 stages)
│   ├── sync-stages.e2e.spec.ts         # Individual stage tests
│   └── sync-error-handling.e2e.spec.ts # Error handling and recovery tests
├── fixtures/                     # Test data fixtures
│   └── connector-documents.fixture.ts  # Sample documents from GitHub, Jira, Confluence
├── mocks/                        # Mock implementations
│   ├── connector.mock.ts               # Mock connectors for external sources
│   ├── embedding.mock.ts               # Mock embedding service
│   └── business-extraction.mock.ts     # Mock business extraction service
└── utils/                        # Test utilities
    └── test-helpers.ts                 # Helper functions for tests
```

## Running Tests

### Prerequisites

Before running tests, ensure you have:

1. **PostgreSQL** running for test database
   ```bash
   # Create test database
   createdb ultimate_qa_test
   ```

2. **Redis** running for test queues
   ```bash
   # Ensure Redis is running on localhost:6379
   redis-cli ping  # Should return "PONG"
   ```

3. **Neo4j** (optional, but recommended for full E2E tests)
   ```bash
   # Ensure Neo4j is running on localhost:7687
   ```

4. **Environment Variables**
   - Copy `.env.test` and configure if needed
   - Test uses local mocks by default, so external API keys are not required

### Test Commands

```bash
# Run all tests
npm test

# Run only E2E tests
npm run test:e2e

# Run sync pipeline tests specifically
npm run test:sync-pipeline

# Run tests in watch mode
npm run test:watch

# Generate coverage report
npm run test:cov
```

## Test Coverage

### Sync Pipeline E2E Tests (`sync-pipeline.e2e.spec.ts`)

Comprehensive tests covering the entire 5-stage sync pipeline:

#### Full Pipeline Tests
- ✅ Complete full sync from GitHub source (all 5 stages)
- ✅ Incremental sync with cursor-based pagination
- ✅ Selective sync with specific external IDs
- ✅ Force reprocess flag handling

#### Multi-Source Tests
- ✅ Concurrent syncing of multiple sources (GitHub, Jira, Confluence)
- ✅ Source isolation and data integrity

#### Business Knowledge Extraction
- ✅ Extract flows, rules, entities, and APIs from documents
- ✅ Create relationships between extracted items
- ✅ Confidence scoring and validation

#### Error Handling
- ✅ Connector errors and authentication failures
- ✅ Graceful degradation on stage failures
- ✅ Progress tracking integrity

### Stage-Specific Tests (`sync-stages.e2e.spec.ts`)

Detailed tests for each of the 5 stages:

#### Stage 1: Pulling
- Document fetching from connectors
- Pagination with cursor handling
- Full vs incremental sync modes
- Selective sync early termination

#### Stage 2: Processing
- Content hash calculation (SHA256)
- Document deduplication based on hash
- Force reprocess behavior
- Chunk deletion on content change

#### Stage 3: Indexing
- Document chunking (code-aware and semantic)
- Embedding generation
- Graceful handling of embedding failures
- Chunk overlap for context preservation

#### Stage 4: Extracting
- Pattern matching for business knowledge
- AI validation with confidence scoring
- Multi-type extraction from single document
- Low-confidence filtering

#### Stage 5: Populating
- Business item upsert by name
- Relationship creation
- Confidence-based updates
- Relationship validation

### Error Handling Tests (`sync-error-handling.e2e.spec.ts`)

Comprehensive error scenarios:

- Connection failures and authentication errors
- Stage-level failures with proper error propagation
- Concurrent sync prevention
- Timeout handling
- Recovery mechanisms (manual re-trigger, cursor-based resume)
- Data integrity preservation on failures

## Test Utilities

### TestHelpers

Utility functions for test setup and execution:

```typescript
// Create test database configuration
TestHelpers.createTestDatabaseConfig()

// Create test queue configuration
TestHelpers.createTestQueueConfig()

// Clean all data from database
await TestHelpers.cleanDatabase(dataSource)

// Wait for async condition
await TestHelpers.waitFor(async () => jobCompleted, 10000)

// Create mock queue
const mockQueue = TestHelpers.createMockQueue()
```

### Mock Services

#### Connector Mocks
- `MockGitHubConnector`: Simulates GitHub API
- `MockJiraConnector`: Simulates Jira API
- `MockConfluenceConnector`: Simulates Confluence API

#### Service Mocks
- `MockEmbeddingService`: Generates mock embeddings
- `MockBusinessExtractionService`: Extracts mock business knowledge

## Test Data Fixtures

### Sample Documents

Located in `fixtures/connector-documents.fixture.ts`:

- **GitHub Documents**: Issues, PRs, code files
- **Jira Documents**: User stories with acceptance criteria
- **Confluence Documents**: Architecture documentation

Each fixture contains realistic content with:
- User flows and processes
- Business rules and validations
- Entity schemas and data models
- API endpoint definitions
- Test cases and requirements

## Writing New Tests

### Example: Testing a New Stage

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { TestHelpers } from '../utils/test-helpers';

describe('My New Stage Tests', () => {
  let module: TestingModule;
  let dataSource: DataSource;

  beforeAll(async () => {
    module = await Test.createTestingModule({
      imports: [
        TestHelpers.createTestDatabaseConfig(),
        TestHelpers.createTestQueueConfig(),
        // ... your modules
      ],
    }).compile();

    dataSource = module.get<DataSource>(DataSource);
  });

  beforeEach(async () => {
    await TestHelpers.cleanDatabase(dataSource);
  });

  afterAll(async () => {
    await dataSource.destroy();
    await module.close();
  });

  it('should test my feature', async () => {
    // Arrange
    // Act
    // Assert
  });
});
```

## Continuous Integration

Tests are designed to run in CI/CD environments:

```yaml
# .github/workflows/test.yml example
test:
  runs-on: ubuntu-latest
  services:
    postgres:
      image: postgres:14
      env:
        POSTGRES_DB: ultimate_qa_test
        POSTGRES_PASSWORD: postgres
      ports:
        - 5432:5432
    redis:
      image: redis:7
      ports:
        - 6379:6379

  steps:
    - uses: actions/checkout@v2
    - uses: actions/setup-node@v2
    - run: npm ci
    - run: npm run test:e2e
```

## Troubleshooting

### Database Connection Errors
- Ensure PostgreSQL is running: `pg_isready`
- Check connection settings in `.env.test`
- Verify test database exists: `psql -l | grep ultimate_qa_test`

### Redis Connection Errors
- Ensure Redis is running: `redis-cli ping`
- Check Redis port configuration (default: 6379)

### Tests Timing Out
- Increase timeout in `jest.config.js` if needed
- Check for hanging database connections
- Ensure queues are properly cleaned between tests

### Flaky Tests
- Tests use `maxWorkers: 1` to avoid race conditions
- Database is cleaned before each test
- Use `TestHelpers.waitFor()` for async operations

## Best Practices

1. **Isolation**: Each test should be independent and not rely on others
2. **Cleanup**: Always clean database and queues in `beforeEach`
3. **Mocking**: Use mocks for external services to avoid flaky tests
4. **Assertions**: Be specific with assertions, use meaningful error messages
5. **Performance**: Keep tests fast by mocking slow operations
6. **Coverage**: Aim for >80% coverage on critical paths

## Future Enhancements

- [ ] Add performance benchmarking tests
- [ ] Add stress tests for concurrent processing
- [ ] Add integration tests with real external services (optional)
- [ ] Add snapshot testing for business extraction results
- [ ] Add mutation testing for critical logic
