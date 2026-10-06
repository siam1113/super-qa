# How to Run Tests

## Quick Start

```bash
cd apps/api

# Run all tests
npm test

# Run with coverage
npm run test:cov

# Run in watch mode (for development)
npm run test:watch
```

## Test Results ✅

**All 21 tests passing!**

```
Test Suites: 2 passed, 2 total
Tests:       21 passed, 21 total
Time:        ~1s
```

## Available Commands

| Command | Description |
|---------|-------------|
| `npm test` | Run all unit tests |
| `npm run test:unit` | Run unit tests with verbose output |
| `npm run test:mocks` | Run mock service tests specifically |
| `npm run test:cov` | Run tests with coverage report |
| `npm run test:watch` | Run tests in watch mode |

## What's Tested

### Mock Services (20 tests)
- ✅ GitHub connector (authentication, fetching, pagination)
- ✅ Jira connector (authentication, document retrieval)
- ✅ Confluence connector (authentication, wiki fetching)
- ✅ Embedding service (vector generation)
- ✅ Business extraction (flows, rules, entities, APIs)
- ✅ Test fixtures (realistic data validation)

### Basic Tests (1 test)
- ✅ Simple test verification

## Test Coverage

Run `npm run test:cov` to see detailed coverage report.

Coverage HTML report will be generated in: `coverage/lcov-report/index.html`

## Examples

### Run specific test file
```bash
npx jest test/unit/mocks.test.ts
```

### Run tests matching pattern
```bash
npx jest --testNamePattern="GitHub"
```

### Run with debugging
```bash
node --inspect-brk node_modules/.bin/jest test/unit/mocks.test.ts
```

## CI/CD Integration

Tests are ready for CI/CD. Example GitHub Actions:

```yaml
test:
  runs-on: ubuntu-latest
  steps:
    - uses: actions/checkout@v2
    - uses: actions/setup-node@v2
    - run: npm ci
    - run: npm test
```

## Troubleshooting

### Tests not running?
- Check Jest is installed: `npm list jest`
- Verify ts-jest: `npm list ts-jest`
- Clear Jest cache: `npx jest --clearCache`

### TypeScript errors?
- Check tsconfig.json has `experimentalDecorators: true`
- Run: `npx tsc --noEmit test/unit/mocks.test.ts`

---

**Last Updated**: July 30, 2026
**Status**: ✅ All Tests Passing
