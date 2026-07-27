import { Injectable, Logger } from '@nestjs/common';
import { EmbeddingService } from '../processing/embedding.service';
import { DocumentsService } from '../documents/documents.service';
import { Chunk } from '../documents/entities/chunk.entity';

export interface RetrievalResult {
  chunks: {
    id: string;
    content: string;
    documentId: string;
    documentTitle: string;
    documentType: string;
    documentUrl: string | null;
    similarity: number;
  }[];
  context: string;
}

export interface SearchOptions {
  limit?: number;
  sourceIds?: string[];
  documentTypes?: string[];
  minSimilarity?: number;
}

@Injectable()
export class RetrievalService {
  private readonly logger = new Logger(RetrievalService.name);

  constructor(
    private embeddingService: EmbeddingService,
    private documentsService: DocumentsService,
  ) {}

  /**
   * Search for relevant chunks based on a query
   */
  async search(query: string, options: SearchOptions = {}): Promise<RetrievalResult> {
    const { limit = 10, minSimilarity = 0.5 } = options;

    this.logger.log(`Searching for: "${query.slice(0, 50)}..."`);

    // Generate embedding for the query
    const queryEmbedding = await this.embeddingService.embedOne(query);

    // Search for similar chunks
    const chunks = await this.documentsService.searchByEmbedding(queryEmbedding, limit * 2);

    // Calculate similarity and filter
    const results = chunks
      .map((chunk) => ({
        chunk,
        similarity: chunk.embedding ? this.cosineSimilarity(queryEmbedding, chunk.embedding) : 0,
      }))
      .filter((r) => r.similarity >= minSimilarity)
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, limit);

    // Build context string
    const context = results
      .map((r) => `[From: ${r.chunk.document?.title || 'Unknown'}]\n${r.chunk.content}`)
      .join('\n\n---\n\n');

    return {
      chunks: results.map((r) => ({
        id: r.chunk.id,
        content: r.chunk.content,
        documentId: r.chunk.documentId,
        documentTitle: r.chunk.document?.title || 'Unknown',
        documentType: r.chunk.document?.type || 'unknown',
        documentUrl: r.chunk.document?.url || null,
        similarity: Math.round(r.similarity * 100) / 100,
      })),
      context,
    };
  }

  /**
   * Get context for RAG based on a query
   */
  async getContext(query: string, maxTokens = 2000): Promise<string> {
    const results = await this.search(query, { limit: 10 });

    // Estimate tokens (rough: 4 chars per token)
    let context = '';
    let estimatedTokens = 0;
    const charsPerToken = 4;

    for (const chunk of results.chunks) {
      const chunkTokens = Math.ceil(chunk.content.length / charsPerToken);
      if (estimatedTokens + chunkTokens > maxTokens) break;

      context += `\n\n[Source: ${chunk.documentTitle}]\n${chunk.content}`;
      estimatedTokens += chunkTokens;
    }

    return context.trim();
  }

  private cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) return 0;

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }

    const magnitude = Math.sqrt(normA) * Math.sqrt(normB);
    return magnitude === 0 ? 0 : dotProduct / magnitude;
  }
}
