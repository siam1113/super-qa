import { Injectable, NotFoundException, Logger, ConflictException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import * as crypto from 'crypto';
import { Document } from './entities/document.entity';
import { Chunk } from './entities/chunk.entity';
import { ConnectorDocument } from '../sources/connectors/connector.interface';
import { GraphService, NodeType, RelationType } from '../graph/graph.service';
import { StorageService } from '../storage/storage.service';
import { EvidenceScope, validateScope, cosineSimilarity, validVector } from '../retrieval/evidence-contract';

@Injectable()
export class DocumentsService {
  private readonly logger = new Logger(DocumentsService.name);

  constructor(
    @InjectRepository(Document)
    private documentRepository: Repository<Document>,
    @InjectRepository(Chunk)
    private chunkRepository: Repository<Chunk>,
    @InjectQueue('processing')
    private processingQueue: Queue,
    private graphService: GraphService,
    private storageService: StorageService,
  ) {}

  private hashContent(content: string): string {
    return crypto.createHash('sha256').update(content).digest('hex');
  }

  async findAll(sourceId?: string, type?: string, limit = 50, offset = 0) {
    const query = this.documentRepository.createQueryBuilder('document');

    if (sourceId) {
      query.where('document.sourceId = :sourceId', { sourceId });
    }
    if (type) {
      query.andWhere('document.type = :type', { type });
    }

    query.orderBy('document.updatedAt', 'DESC');
    query.take(limit);
    query.skip(offset);

    const [documents, total] = await query.getManyAndCount();
    return { documents, total };
  }

  async findOne(id: string): Promise<Document> {
    const document = await this.documentRepository.findOne({
      where: { id },
      relations: ['chunks'],
    });
    if (!document) {
      throw new NotFoundException(`Document with ID ${id} not found`);
    }
    return document;
  }

  async upsertDocuments(
    sourceId: string,
    connectorDocuments: ConnectorDocument[],
    syncJobId?: string,
    forceReprocess = false,
    options: { deferQueue?: boolean } = {},
  ): Promise<{ total: number; queued: number; skipped: number; documentIds: string[] }> {
    let total = 0;
    let queued = 0;
    let skipped = 0;
    const documentIds = new Set<string>();

    this.logger.log(
      `Upserting ${connectorDocuments.length} documents for source ${sourceId}${forceReprocess ? ' (force reprocess)' : ''}`,
    );

    for (const doc of connectorDocuments) {
      const contentHash = this.hashContent(doc.content);

      // Check if document exists and content changed
      const existing = await this.documentRepository.findOne({
        where: { sourceId, externalId: doc.externalId },
      });

      if (existing) {
        if (!forceReprocess && existing.contentHash === contentHash) {
          // Content unchanged and not forcing reprocess, skip processing
          skipped++;
          total++;
          this.logger.debug(`Document ${doc.externalId} unchanged, skipping`);
          continue;
        }

        // Update existing document
        existing.title = doc.title;
        existing.type = doc.type;
        existing.content = doc.content;
        existing.url = doc.url || null;
        existing.metadata = doc.metadata || null;
        existing.contentHash = contentHash;
        await this.documentRepository.save(existing);

        // Delete old chunks (will be regenerated)
        await this.chunkRepository.delete({ documentId: existing.id });

        // Queue for reprocessing
        documentIds.add(existing.id);
        if (!options.deferQueue) {
          await this.processingQueue.add('process-document', {
            documentId: existing.id,
            syncJobId,
          });
          queued++;
        }
        if (forceReprocess && existing.contentHash === contentHash) {
          this.logger.debug(`Document ${doc.externalId} forced reprocess (content unchanged)`);
        } else {
          this.logger.debug(`Document ${doc.externalId} updated, prepared for processing`);
        }
      } else {
        // Create new document
        const newDoc = this.documentRepository.create({
          sourceId,
          externalId: doc.externalId,
          type: doc.type,
          title: doc.title,
          content: doc.content,
          url: doc.url || null,
          metadata: doc.metadata || null,
          contentHash,
        });
        const saved = await this.documentRepository.save(newDoc);

        // Queue for processing
        documentIds.add(saved.id);
        if (!options.deferQueue) {
          await this.processingQueue.add('process-document', {
            documentId: saved.id,
            syncJobId,
          });
          queued++;
        }

        // Sync to graph database
        await this.syncDocumentToGraph(saved);
        this.logger.debug(`Document ${doc.externalId} created, prepared for processing (ID: ${saved.id})`);
      }

      // Handle attachments if present
      if (doc.attachments && doc.attachments.length > 0) {
        const docId = existing?.id || (await this.documentRepository.findOne({
          where: { sourceId, externalId: doc.externalId },
        }))?.id;

        if (docId) {
          await this.storeAttachments(docId, doc.attachments);
        }
      }

      total++;
    }

    this.logger.log(`Upsert complete: ${total} total, ${queued} queued, ${skipped} skipped`);
    return { total, queued, skipped, documentIds: [...documentIds] };
  }

  /**
   * Queue documents for background processing (indexing)
   * Used when documents are saved but need to be queued separately after metadata is set
   */
  async queueDocumentsForProcessing(sourceId: string, syncJobId: string, documentIds: string[]): Promise<number> {
    const documents = await this.findByManifest(sourceId, documentIds);

    this.logger.log(`Queuing ${documents.length} documents for processing (source: ${sourceId}, job: ${syncJobId})`);

    // Queue each document for processing
    for (const doc of documents) {
      await this.processingQueue.add('process-document', {
        documentId: doc.id,
        syncJobId,
      }, { jobId: `sync-${syncJobId}-document-${doc.id}` });
    }

    return documents.length;
  }

  async findByManifest(sourceId: string, documentIds: string[]): Promise<Document[]> {
    const uniqueIds = [...new Set(documentIds)];
    if (uniqueIds.length === 0) return [];
    const documents = await this.documentRepository.find({
      where: { sourceId, id: In(uniqueIds) },
    });
    if (documents.length !== uniqueIds.length) {
      throw new Error('Sync manifest contains missing or foreign-source documents');
    }
    return documents;
  }

  /**
   * Sync a document to Neo4j graph database
   */
  private async syncDocumentToGraph(document: Document): Promise<void> {
    try {
      await this.graphService.syncDocument({
        id: document.id,
        externalId: document.externalId,
        type: document.type,
        title: document.title,
        sourceId: document.sourceId,
        metadata: document.metadata || undefined,
      });

      // Extract and create relationships from metadata
      await this.extractRelationships(document);

      this.logger.debug(`Synced document ${document.id} to graph`);
    } catch (error) {
      this.logger.warn(`Failed to sync document to graph: ${error.message}`);
      // Don't fail the sync if graph sync fails
    }
  }

  /**
   * Extract relationships from document metadata and content
   */
  private async extractRelationships(document: Document): Promise<void> {
    const metadata = document.metadata || {};

    // Extract issue/PR references from content (e.g., #123, JIRA-456)
    const issueRefs = this.extractReferences(document.content);

    for (const ref of issueRefs) {
      // Find the referenced document
      const refDoc = await this.documentRepository.findOne({
        where: { externalId: ref },
      });

      if (refDoc) {
        await this.graphService.upsertRelationship({
          type: RelationType.REFERENCES,
          fromId: document.id,
          toId: refDoc.id,
          properties: { extractedFrom: 'content' },
        });
      }
    }

    // Create relationships based on document type
    if (document.type === 'pr' && metadata.linkedIssues && Array.isArray(metadata.linkedIssues)) {
      for (const issueRef of metadata.linkedIssues as string[]) {
        const issueDoc = await this.documentRepository.findOne({
          where: { externalId: issueRef },
        });
        if (issueDoc) {
          await this.graphService.upsertRelationship({
            type: RelationType.FIXES,
            fromId: document.id,
            toId: issueDoc.id,
          });
        }
      }
    }
  }

  /**
   * Extract issue/PR references from content
   */
  private extractReferences(content: string): string[] {
    const refs: string[] = [];

    // GitHub style: #123
    const githubRefs = content.match(/#(\d+)/g);
    if (githubRefs) {
      refs.push(...githubRefs.map(r => `issue-${r.slice(1)}`));
    }

    // Jira style: PROJ-123
    const jiraRefs = content.match(/[A-Z]+-\d+/g);
    if (jiraRefs) {
      refs.push(...jiraRefs);
    }

    return [...new Set(refs)]; // Dedupe
  }

  /**
   * Store attachments in blob storage
   */
  private async storeAttachments(
    documentId: string,
    attachments: Array<{ name: string; url: string; mimeType: string; content?: Buffer }>,
  ): Promise<void> {
    for (const attachment of attachments) {
      try {
        if (attachment.content) {
          await this.storageService.uploadBuffer(
            attachment.content,
            attachment.name,
            {
              documentId,
              originalName: attachment.name,
              contentType: attachment.mimeType,
            },
          );
          this.logger.debug(`Stored attachment ${attachment.name} for document ${documentId}`);
        }
      } catch (error) {
        this.logger.warn(`Failed to store attachment ${attachment.name}: ${error.message}`);
      }
    }
  }

  async deleteBySource(sourceId: string): Promise<void> {
    await this.documentRepository.delete({ sourceId });
  }

  async getDocumentWithChunks(documentId: string): Promise<Document> {
    return this.findOne(documentId);
  }

  async saveChunks(documentId: string, chunks: { content: string; index: number; embedding: number[] | null }[]): Promise<void> {
    const startTime = Date.now();
    this.logger.log(`💾 DB: Saving ${chunks.length} chunks to database for document ${documentId.slice(0, 8)}...`);

    const chunkEntities = chunks.map((chunk) =>
      this.chunkRepository.create({
        documentId,
        content: chunk.content,
        chunkIndex: chunk.index,
        embedding: chunk.embedding,
      })
    );

    await this.chunkRepository.save(chunkEntities);
    const elapsed = Date.now() - startTime;
    this.logger.log(`✅ DB: Saved ${chunks.length} chunks in ${elapsed}ms`);
  }

  async searchByEmbedding(embedding: number[], limit: number, scope: EvidenceScope): Promise<Chunk[]> {
    validateScope(scope);
    if (!validVector(embedding) || !Number.isInteger(limit) || limit < 1 || limit > 50) throw new BadRequestException('Invalid embedding or result limit');
    const query = this.chunkRepository.createQueryBuilder('chunk').innerJoinAndSelect('chunk.document', 'document')
      .where('document.sourceId IN (:...sourceIds)', { sourceIds: scope.sourceIds })
      .andWhere("chunk.metadata ->> 'revisionHash' = document.processedHash");
    if (scope.documentTypes) query.andWhere('document.type IN (:...documentTypes)', { documentTypes: scope.documentTypes });
    const allChunks = await query.take(10001).getMany();
    if (allChunks.length > 10000) throw new BadRequestException('Retrieval candidate budget exceeded; narrow the source scope');

    // Calculate cosine similarity
    const withSimilarity = allChunks
      .filter((chunk) => chunk.content.trim() && validVector(chunk.embedding) && chunk.embedding.length === embedding.length)
      .map((chunk) => ({
        chunk,
        similarity: cosineSimilarity(embedding, chunk.embedding!),
      }))
      .sort((a, b) => b.similarity - a.similarity || a.chunk.id.localeCompare(b.chunk.id))
      .slice(0, limit);

    return withSimilarity.map((item) => item.chunk);
  }

  async resolveCitation(documentId: string, chunkId: string, revisionHash: string, scope: EvidenceScope): Promise<Chunk> {
    validateScope(scope);
    const document = await this.documentRepository.findOne({ where: {
      id: documentId, sourceId: In(scope.sourceIds), ...(scope.documentTypes ? { type: In(scope.documentTypes) } : {}),
    } });
    if (!document) throw new NotFoundException('Evidence document not found in scope');
    if (!document.processedHash || document.processedHash !== revisionHash) throw new ConflictException('Evidence revision is stale; retrieve current evidence');
    const chunk = await this.chunkRepository.findOne({ where: { id: chunkId, documentId }, relations: ['document'] });
    if (!chunk || !scope.sourceIds.includes(chunk.document.sourceId) ||
        (scope.documentTypes && !scope.documentTypes.includes(chunk.document.type)) ||
        chunk.metadata?.revisionHash !== revisionHash || chunk.document.processedHash !== revisionHash) throw new ConflictException('Evidence chunk is no longer current');
    return chunk;
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
