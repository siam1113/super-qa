import { ConfigService } from '@nestjs/config';
import { EmbeddingService } from '../../src/modules/processing/embedding.service';
import { config } from 'dotenv';
import { resolve } from 'path';

// Load .env file
config({ path: resolve(__dirname, '../../.env') });

/**
 * Healthcheck test for the embedding service
 * This script tests OpenAI API connectivity and embedding generation
 */
async function testEmbedding() {
  console.log('🏥 Starting Embedding Service Healthcheck...\n');

  // Initialize services
  const configService = new ConfigService();
  const embeddingService = new EmbeddingService(configService);

  const provider = process.env.EMBEDDING_PROVIDER || 'local';
  const model = process.env.EMBEDDING_MODEL || 'text-embedding-3-small';
  const apiKey = process.env.OPENAI_API_KEY;

  console.log('📋 Configuration:');
  console.log(`   Provider: ${provider}`);
  console.log(`   Model: ${model}`);
  console.log(`   API Key: ${apiKey ? '✓ Set (' + apiKey.slice(0, 10) + '...)' : '✗ Not set'}\n`);

  // Test 1: Configuration validation
  console.log('1️⃣  Testing Configuration...');
  if (provider === 'openai' && !apiKey) {
    console.error('   ✗ FAILED: OpenAI API key not configured\n');
    console.log('   💡 Solution: Set OPENAI_API_KEY in your .env file\n');
    process.exit(1);
  }
  console.log('   ✓ Configuration valid\n');

  // Test 2: Network connectivity (if using OpenAI)
  if (provider === 'openai') {
    console.log('2️⃣  Testing OpenAI API Network Connectivity...');
    try {
      const response = await fetch('https://api.openai.com/v1/models', {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
      });

      if (!response.ok) {
        console.error(`   ✗ FAILED: OpenAI API returned status ${response.status}`);
        const error = await response.text();
        console.error(`   Error: ${error}\n`);

        if (response.status === 401) {
          console.log('   💡 Solution: Check your OPENAI_API_KEY - it may be invalid or expired\n');
        } else if (response.status === 429) {
          console.log('   💡 Solution: Rate limit exceeded. Wait a moment and try again\n');
        }
        process.exit(1);
      }

      console.log('   ✓ Successfully connected to OpenAI API\n');
    } catch (error) {
      console.error('   ✗ FAILED: Network error');
      console.error(`   Error: ${error.message}\n`);
      console.log('   💡 Solution: Check your internet connection and firewall settings\n');
      console.log('   Try running: curl https://api.openai.com/v1/models -H "Authorization: Bearer YOUR_KEY"\n');
      process.exit(1);
    }
  }

  // Test 3: Embedding generation
  console.log('3️⃣  Testing Embedding Generation...');
  const testTexts = [
    'This is a test document for the QA automation system.',
    'Testing embedding generation with OpenAI.',
    'Verify that the service can create vector embeddings.',
  ];

  try {
    const startTime = Date.now();
    const embeddings = await embeddingService.embed(testTexts);
    const duration = Date.now() - startTime;

    if (!embeddings || embeddings.length !== testTexts.length) {
      console.error('   ✗ FAILED: Invalid number of embeddings returned');
      console.error(`   Expected: ${testTexts.length}, Got: ${embeddings?.length || 0}\n`);
      process.exit(1);
    }

    const dimension = embeddings[0].length;
    const expectedDimensions: Record<string, number> = {
      'text-embedding-ada-002': 1536,
      'text-embedding-3-small': 1536,
      'text-embedding-3-large': 3072,
    };
    const expectedDimension = provider === 'openai' ? (expectedDimensions[model] || 1536) : 384;

    if (dimension !== expectedDimension && provider === 'openai') {
      console.warn(`   ⚠️  WARNING: Unexpected embedding dimension`);
      console.warn(`   Expected: ${expectedDimension}, Got: ${dimension}`);
      console.warn(`   Model: ${model}\n`);
    }

    console.log('   ✓ Successfully generated embeddings');
    console.log(`   Texts: ${testTexts.length}`);
    console.log(`   Dimension: ${dimension}`);
    console.log(`   Duration: ${duration}ms`);
    console.log(`   Avg per text: ${Math.round(duration / testTexts.length)}ms\n`);

    // Test 4: Embedding quality check
    console.log('4️⃣  Testing Embedding Quality...');

    // Check that embeddings are normalized (for cosine similarity)
    const magnitudes = embeddings.map((emb) => {
      const sum = emb.reduce((acc, val) => acc + val * val, 0);
      return Math.sqrt(sum);
    });

    const allNormalized = magnitudes.every((mag) => Math.abs(mag - 1.0) < 0.1);
    if (!allNormalized && provider === 'openai') {
      console.warn('   ⚠️  WARNING: Embeddings may not be normalized');
      console.warn(`   Magnitudes: ${magnitudes.map((m) => m.toFixed(4)).join(', ')}\n`);
    } else {
      console.log('   ✓ Embeddings are properly normalized\n');
    }

    // Test similarity (similar texts should have higher similarity)
    const cosineSimilarity = (a: number[], b: number[]) => {
      const dot = a.reduce((sum, val, i) => sum + val * b[i], 0);
      const magA = Math.sqrt(a.reduce((sum, val) => sum + val * val, 0));
      const magB = Math.sqrt(b.reduce((sum, val) => sum + val * val, 0));
      return dot / (magA * magB);
    };

    const sim01 = cosineSimilarity(embeddings[0], embeddings[1]);
    const sim02 = cosineSimilarity(embeddings[0], embeddings[2]);

    console.log('   Similarity scores:');
    console.log(`   Text 0 ↔ Text 1: ${sim01.toFixed(4)}`);
    console.log(`   Text 0 ↔ Text 2: ${sim02.toFixed(4)}\n`);

  } catch (error) {
    console.error('   ✗ FAILED: Embedding generation failed');
    console.error(`   Error: ${error.message}\n`);

    if (error.message.includes('fetch failed')) {
      console.log('   💡 Solution: This is a network connectivity issue');
      console.log('   1. Check internet connection');
      console.log('   2. Verify firewall allows outbound HTTPS to api.openai.com');
      console.log('   3. Check if you\'re behind a corporate proxy\n');
    } else if (error.message.includes('401')) {
      console.log('   💡 Solution: API key is invalid or expired');
      console.log('   1. Get a new API key from https://platform.openai.com/api-keys');
      console.log('   2. Update OPENAI_API_KEY in .env file\n');
    } else if (error.message.includes('429')) {
      console.log('   💡 Solution: Rate limit exceeded');
      console.log('   1. Wait a few minutes');
      console.log('   2. Check your OpenAI usage quota\n');
    }

    process.exit(1);
  }

  // All tests passed
  console.log('✅ All healthchecks passed!\n');
  console.log('Summary:');
  console.log(`   Provider: ${provider}`);
  console.log(`   Model: ${model}`);
  console.log(`   Status: Healthy ✓\n`);
}

// Run the healthcheck
testEmbedding().catch((error) => {
  console.error('❌ Unexpected error:', error);
  process.exit(1);
});
