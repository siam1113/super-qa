import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HfInference } from '@huggingface/inference';

export type EmbeddingProvider = 'local' | 'openai' | 'huggingface';

@Injectable()
export class EmbeddingService {
  private readonly logger = new Logger(EmbeddingService.name);
  private provider: EmbeddingProvider;
  private hfClient: HfInference | null = null;
  private openaiApiKey: string | null = null;

  // Model dimensions
  private readonly dimensions: Record<string, number> = {
    'sentence-transformers/all-MiniLM-L6-v2': 384,
    'text-embedding-ada-002': 1536,
    'text-embedding-3-small': 1536,
    'text-embedding-3-large': 3072,
  };

  constructor(private configService: ConfigService) {
    this.provider = (this.configService.get('EMBEDDING_PROVIDER') as EmbeddingProvider) || 'local';

    const hfApiKey = this.configService.get('HUGGINGFACE_API_KEY');
    if (hfApiKey) {
      this.hfClient = new HfInference(hfApiKey);
    }

    this.openaiApiKey = this.configService.get('OPENAI_API_KEY') || null;

    this.logger.log(`Embedding service initialized with provider: ${this.provider}`);
  }

  /**
   * Generate embeddings for a list of texts
   */
  async embed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];

    switch (this.provider) {
      case 'openai':
        return this.embedWithOpenAI(texts);
      case 'huggingface':
        return this.embedWithHuggingFace(texts);
      case 'local':
      default:
        return this.embedLocal(texts);
    }
  }

  /**
   * Generate embedding for a single text
   */
  async embedOne(text: string): Promise<number[]> {
    const results = await this.embed([text]);
    return results[0] || [];
  }

  /**
   * Get the dimension of embeddings
   */
  getDimension(): number {
    const model = this.configService.get('EMBEDDING_MODEL') || 'text-embedding-3-small';

    if (this.provider === 'openai') {
      return this.dimensions[model] || 1536;
    }

    if (this.provider === 'huggingface') {
      return 384;
    }

    // local
    return 384;
  }

  private async embedWithOpenAI(texts: string[]): Promise<number[][]> {
    if (!this.openaiApiKey) {
      throw new Error('OpenAI API key not configured');
    }

    const model = this.configService.get('EMBEDDING_MODEL') || 'text-embedding-3-small';
    const totalChars = texts.reduce((sum, t) => sum + t.length, 0);

    try {
      const startTime = Date.now();
      this.logger.log(`📤 OpenAI API Call: model=${model}, texts=${texts.length}, chars=${totalChars}`);

      const response = await fetch('https://api.openai.com/v1/embeddings', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.openaiApiKey}`,
        },
        body: JSON.stringify({
          model,
          input: texts,
        }),
      });

      const elapsed = Date.now() - startTime;

      if (!response.ok) {
        const error = await response.text();
        this.logger.error(`❌ OpenAI API error (${response.status}) after ${elapsed}ms: ${error}`);
        throw new Error(`OpenAI API error (${response.status}): ${error}`);
      }

      const data = await response.json();
      const tokensUsed = data.usage?.total_tokens || 'unknown';
      this.logger.log(`✅ OpenAI API Success: embeddings=${data.data.length}, tokens=${tokensUsed}, time=${elapsed}ms`);
      return data.data.map((item: { embedding: number[] }) => item.embedding);
    } catch (error) {
      this.logger.error(`OpenAI embedding failed: ${error.message}`, error.stack);

      // If it's a network error, provide more details
      if (error.message?.includes('fetch failed')) {
        throw new Error(`Network error calling OpenAI API. Please check your internet connection and API key. Details: ${error.message}`);
      }

      throw error;
    }
  }

  private async embedWithHuggingFace(texts: string[]): Promise<number[][]> {
    if (!this.hfClient) {
      throw new Error('HuggingFace client not configured');
    }

    const embeddings: number[][] = [];
    for (const text of texts) {
      const result = await this.hfClient.featureExtraction({
        model: 'sentence-transformers/all-MiniLM-L6-v2',
        inputs: text,
      });
      embeddings.push(result as unknown as number[]);
    }
    return embeddings;
  }

  /**
   * Simple local embedding using character n-grams
   * This is a fallback when no external service is available
   * NOT suitable for production semantic search
   */
  private async embedLocal(texts: string[]): Promise<number[][]> {
    // Use a simple hash-based embedding for testing
    // In production, you'd use a local model like sentence-transformers
    return texts.map((text) => this.simpleHashEmbedding(text));
  }

  private simpleHashEmbedding(text: string, dim = 384): number[] {
    const embedding = new Array(dim).fill(0);
    const normalized = text.toLowerCase().replace(/[^a-z0-9\s]/g, '');
    const words = normalized.split(/\s+/);

    for (const word of words) {
      for (let i = 0; i < word.length; i++) {
        const hash = this.hashCode(word.slice(i, i + 3));
        const idx = Math.abs(hash) % dim;
        embedding[idx] += 1;
      }
    }

    // Normalize
    const magnitude = Math.sqrt(embedding.reduce((sum, val) => sum + val * val, 0));
    if (magnitude > 0) {
      for (let i = 0; i < dim; i++) {
        embedding[i] /= magnitude;
      }
    }

    return embedding;
  }

  private hashCode(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash; // Convert to 32bit integer
    }
    return hash;
  }
}
