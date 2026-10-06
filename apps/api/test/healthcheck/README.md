# Healthcheck Tests

This directory contains healthcheck scripts to verify that services are working correctly.

## Embedding Service Test

Tests the embedding service connectivity and functionality.

### Usage

```bash
# From the api directory
npm run healthcheck:embedding

# Or run directly
npx ts-node healthcheck/test-embedding.ts
```

### What It Tests

1. **Configuration Validation**
   - Checks if required environment variables are set
   - Validates API keys are present

2. **Network Connectivity** (OpenAI only)
   - Tests connection to OpenAI API
   - Verifies API endpoint accessibility

3. **Embedding Generation**
   - Generates embeddings for test texts
   - Measures performance
   - Validates output dimensions

4. **Embedding Quality**
   - Checks if embeddings are normalized
   - Tests similarity scores between texts

### Expected Output

```
🏥 Starting Embedding Service Healthcheck...

📋 Configuration:
   Provider: openai
   Model: text-embedding-3-large
   API Key: ✓ Set (sk-proj-ZC...)

1️⃣  Testing Configuration...
   ✓ Configuration valid

2️⃣  Testing OpenAI API Network Connectivity...
   ✓ Successfully connected to OpenAI API

3️⃣  Testing Embedding Generation...
   ✓ Successfully generated embeddings
   Texts: 3
   Dimension: 1536
   Duration: 450ms
   Avg per text: 150ms

4️⃣  Testing Embedding Quality...
   ✓ Embeddings are properly normalized

   Similarity scores:
   Text 0 ↔ Text 1: 0.8523
   Text 0 ↔ Text 2: 0.7891

✅ All healthchecks passed!

Summary:
   Provider: openai
   Model: text-embedding-3-large
   Status: Healthy ✓
```

### Common Issues

#### "fetch failed" Error

**Problem**: Network connectivity issue

**Solutions**:
1. Check internet connection
2. Verify firewall allows HTTPS to api.openai.com
3. Check if behind a corporate proxy
4. Try: `curl https://api.openai.com/v1/models -H "Authorization: Bearer YOUR_KEY"`

#### 401 Unauthorized

**Problem**: Invalid or expired API key

**Solutions**:
1. Get a new API key from https://platform.openai.com/api-keys
2. Update `OPENAI_API_KEY` in `.env` file
3. Ensure the key starts with `sk-`

#### 429 Rate Limit

**Problem**: Too many requests

**Solutions**:
1. Wait a few minutes
2. Check OpenAI usage quota at https://platform.openai.com/usage

### Switching to Local Embeddings

If OpenAI is unavailable, switch to local embeddings:

```bash
# In .env file
EMBEDDING_PROVIDER=local
```

Note: Local embeddings are for testing only and not suitable for production.
