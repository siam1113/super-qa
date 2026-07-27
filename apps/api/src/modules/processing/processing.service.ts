import { Injectable, Logger, Inject, forwardRef } from '@nestjs/common';
import { ChunkingService } from './chunking.service';
import { EmbeddingService } from './embedding.service';
import { DocumentsService } from '../documents/documents.service';
import { BusinessExtractionService } from '../business/business-extraction.service';

@Injectable()
export class ProcessingService {
  private readonly logger = new Logger(ProcessingService.name);

  constructor(
    private chunkingService: ChunkingService,
    private embeddingService: EmbeddingService,
    private documentsService: DocumentsService,
    @Inject(forwardRef(() => BusinessExtractionService))
    private businessExtractionService: BusinessExtractionService,
  ) {}

  /**
   * Process a document: chunk it and generate embeddings
   */
  async processDocument(documentId: string): Promise<void> {
    this.logger.log(`Processing document ${documentId}`);

    const document = await this.documentsService.getDocumentWithChunks(documentId);

    // Chunk the content
    const chunks = document.type === 'code'
      ? this.chunkingService.chunkCode(document.content)
      : this.chunkingService.chunk(document.content);

    if (chunks.length === 0) {
      this.logger.warn(`No chunks generated for document ${documentId}`);
      return;
    }

    this.logger.log(`Generated ${chunks.length} chunks for document ${documentId}`);

    // Generate embeddings
    const texts = chunks.map((c) => c.content);
    let embeddings: number[][];

    try {
      embeddings = await this.embeddingService.embed(texts);
    } catch (error) {
      this.logger.error(`Failed to generate embeddings: ${error.message}`);
      // Save chunks without embeddings
      embeddings = chunks.map(() => []);
    }

    // Save chunks with embeddings
    const chunksWithEmbeddings = chunks.map((chunk, idx) => ({
      content: chunk.content,
      index: chunk.index,
      embedding: embeddings[idx] || null,
    }));

    await this.documentsService.saveChunks(documentId, chunksWithEmbeddings);

    this.logger.log(`Saved ${chunks.length} chunks for document ${documentId}`);

    // Extract business knowledge from the document
    await this.extractBusinessKnowledge(document);
  }

  /**
   * Extract business knowledge items from a document
   */
  private async extractBusinessKnowledge(document: {
    id: string;
    title: string;
    content: string;
    type: string;
    sourceId: string;
    metadata?: Record<string, any> | null;
  }): Promise<void> {
    try {
      const extraction = await this.businessExtractionService.extractFromDocument({
        id: document.id,
        title: document.title,
        content: document.content,
        type: document.type,
        sourceId: document.sourceId,
        metadata: document.metadata || undefined,
      });

      if (extraction.items.length > 0) {
        const result = await this.businessExtractionService.saveExtractedItems(extraction);
        this.logger.log(
          `Extracted ${result.saved} business items and ${result.relationships} relationships from document ${document.id}`,
        );
      }
    } catch (error) {
      this.logger.warn(
        `Failed to extract business knowledge from document ${document.id}: ${error.message}`,
      );
      // Don't fail processing if extraction fails
    }
  }
}
