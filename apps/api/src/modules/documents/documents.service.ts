import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import * as crypto from 'crypto';
import { Document } from './entities/document.entity';
import { Chunk } from './entities/chunk.entity';
import { ConnectorDocument } from '../sources/connectors/connector.interface';
import { GraphService, NodeType, RelationType } from '../graph/graph.service';
import { StorageService } from '../storage/storage.service';

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

  async upsertDocuments(sourceId: string, connectorDocuments: ConnectorDocument[]): Promise<number> {
    let processed = 0;

    for (const doc of connectorDocuments) {
      const contentHash = this.hashContent(doc.content);

      // Check if document exists and content changed
      const existing = await this.documentRepository.findOne({
        where: { sourceId, externalId: doc.externalId },
      });

      if (existing) {
        if (existing.contentHash === contentHash) {
          // Content unchanged, skip
          continue;
        }

        // Update existing document
        existing.title = doc.title;
        existing.content = doc.content;
        existing.url = doc.url || null;
        existing.metadata = doc.metadata || null;
        existing.contentHash = contentHash;
        await this.documentRepository.save(existing);

        // Delete old chunks (will be regenerated)
        await this.chunkRepository.delete({ documentId: existing.id });

        // Queue for reprocessing
        await this.processingQueue.add('process-document', {
          documentId: existing.id,
        });
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
        await this.processingQueue.add('process-document', {
          documentId: saved.id,
        });

        // Sync to graph database
        await this.syncDocumentToGraph(saved);
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

      processed++;
    }

    return processed;
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
    const chunkEntities = chunks.map((chunk) =>
      this.chunkRepository.create({
        documentId,
        content: chunk.content,
        chunkIndex: chunk.index,
        embedding: chunk.embedding,
      })
    );

    await this.chunkRepository.save(chunkEntities);
  }

  async searchByEmbedding(embedding: number[], limit = 10): Promise<Chunk[]> {
    // For now, we'll do a simple JS-based similarity search
    // Once pgvector is properly set up, we can use SQL: ORDER BY embedding <=> $1
    const allChunks = await this.chunkRepository.find({
      where: {},
      relations: ['document'],
    });

    // Calculate cosine similarity
    const withSimilarity = allChunks
      .filter((chunk) => chunk.embedding && chunk.embedding.length > 0)
      .map((chunk) => ({
        chunk,
        similarity: this.cosineSimilarity(embedding, chunk.embedding!),
      }))
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, limit);

    return withSimilarity.map((item) => item.chunk);
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
