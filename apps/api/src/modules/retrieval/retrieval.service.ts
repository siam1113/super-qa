import { BadRequestException, Injectable } from '@nestjs/common';
import { createHash } from 'crypto';
import { EmbeddingService } from '../processing/embedding.service';
import { DocumentsService } from '../documents/documents.service';
import { Chunk } from '../documents/entities/chunk.entity';
import { validateScope, validVector, cosineSimilarity } from './evidence-contract';

export interface EvidenceCitation {
  id: string;
  sourceId: string;
  documentId: string;
  chunkId: string;
  revisionHash: string;
  quote: string;
  quoteHash: string;
}

export interface RetrievalResult {
  omittedChunks?: number;
  chunks: Array<{
    id: string; content: string; documentId: string; documentTitle: string;
    documentType: string; documentUrl: string | null; similarity: number; citation: EvidenceCitation;
  }>;
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
  constructor(private embeddingService: EmbeddingService, private documentsService: DocumentsService) {}

  private citation(chunk: Chunk): EvidenceCitation {
    const revisionHash = String(chunk.metadata!.revisionHash);
    return {
      id: `source:${chunk.document.sourceId}/document:${chunk.documentId}/revision:${revisionHash}/chunk:${chunk.id}`,
      sourceId: chunk.document.sourceId, documentId: chunk.documentId, chunkId: chunk.id, revisionHash,
      quote: chunk.content, quoteHash: createHash('sha256').update(chunk.content).digest('hex'),
    };
  }

  private format(chunk: RetrievalResult['chunks'][number]): string {
    return `[Evidence ${chunk.citation.id}]\n${chunk.content}`;
  }

  async search(query: string, options: SearchOptions = {}): Promise<RetrievalResult> {
    validateScope(options);
    const { limit = 10, minSimilarity = 0.5 } = options;
    if (typeof query !== 'string' || !query.trim() || query.length > 4000 ||
        !Number.isInteger(limit) || limit < 1 || limit > 50 ||
        !Number.isFinite(minSimilarity) || minSimilarity < -1 || minSimilarity > 1) {
      throw new BadRequestException('Invalid retrieval query, limit or similarity');
    }
    const embedding = await this.embeddingService.embedOne(query);
    if (!validVector(embedding)) throw new Error('Invalid query embedding');
    const chunks = await this.documentsService.searchByEmbedding(embedding, limit, {
      sourceIds: options.sourceIds, documentTypes: options.documentTypes,
    });
    const results = chunks.filter(chunk => chunk.document && options.sourceIds.includes(chunk.document.sourceId) &&
      (!options.documentTypes || options.documentTypes.includes(chunk.document.type)) &&
      typeof chunk.metadata?.revisionHash === 'string' && chunk.metadata.revisionHash.length > 0 &&
      chunk.metadata.revisionHash === chunk.document.processedHash)
      .map(chunk => ({ chunk, similarity: chunk.embedding ? cosineSimilarity(embedding, chunk.embedding) : -Infinity }))
      .filter(result => Number.isFinite(result.similarity) && result.similarity >= minSimilarity)
      .sort((left, right) => right.similarity - left.similarity || left.chunk.id.localeCompare(right.chunk.id))
      .slice(0, limit)
      .map(({ chunk, similarity }) => ({
        id: chunk.id, content: chunk.content, documentId: chunk.documentId,
        documentTitle: chunk.document.title, documentType: chunk.document.type, documentUrl: chunk.document.url,
        similarity, citation: this.citation(chunk),
      }));
    return { chunks: results, context: results.map(chunk => this.format(chunk)).join('\n\n---\n\n') };
  }

  async getEvidence(query: string, maxTokens = 2000, options: SearchOptions = {}): Promise<RetrievalResult> {
    if (!Number.isInteger(maxTokens) || maxTokens < 1 || maxTokens > 16000) throw new BadRequestException('Invalid context budget');
    const results = await this.search(query, options);
    const selected: RetrievalResult['chunks'] = [];
    let context = '';
    for (const chunk of results.chunks) {
      const candidate = (context ? '\n\n---\n\n' : '') + this.format(chunk);
      if (context.length + candidate.length > maxTokens * 4) continue;
      selected.push(chunk);
      context += candidate;
    }
    return { chunks: selected, context, omittedChunks: results.chunks.length - selected.length };
  }

  async getContext(query: string, maxTokens = 2000, options: SearchOptions = {}): Promise<string> {
    return (await this.getEvidence(query, maxTokens, options)).context;
  }

  async resolveCitation(documentId: string, chunkId: string, revisionHash: string, options: SearchOptions): Promise<EvidenceCitation> {
    validateScope(options);
    if (![documentId, chunkId].every(value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(value)) ||
        typeof revisionHash !== 'string' || !/^[0-9a-f]{64}$/.test(revisionHash)) throw new BadRequestException('Invalid citation reference');
    return this.citation(await this.documentsService.resolveCitation(documentId, chunkId, revisionHash, options));
  }
}
