import { Injectable, Logger, Inject, forwardRef } from '@nestjs/common';
import { ChunkingService } from './chunking.service';
import { EmbeddingService } from './embedding.service';
import { DocumentsService } from '../documents/documents.service';
import { BusinessExtractionService } from '../business/business-extraction.service';
import { SourcesService } from '../sources/sources.service';

@Injectable()
export class ProcessingService {
  private readonly logger = new Logger(ProcessingService.name);
  private indexingStarted = new Set<string>(); // Track which jobs have started indexing

  // Batch progress updates to reduce DB load
  private progressBatchSize = 5; // Update progress every N documents
  private progressBatch = new Map<string, { count: number; lastUpdate: number }>(); // Track batched updates

  constructor(
    private chunkingService: ChunkingService,
    private embeddingService: EmbeddingService,
    private documentsService: DocumentsService,
    @Inject(forwardRef(() => BusinessExtractionService))
    private businessExtractionService: BusinessExtractionService,
    @Inject(forwardRef(() => SourcesService))
    private sourcesService: SourcesService,
  ) {}

  /**
   * Process a document: ONLY chunk it and generate embeddings (indexing stage)
   */
  async processDocument(documentId: string, syncJobId?: string): Promise<void> {
    const startTime = Date.now();
    const docShort = documentId.slice(0, 8);
    this.logger.log(`📄 Starting document processing: ${docShort}`);

    // Check if job has failed or been cancelled
    if (syncJobId) {
      const checkStartTime = Date.now();
      const job = await this.sourcesService.getSyncJob(syncJobId);
      const checkElapsed = Date.now() - checkStartTime;
      this.logger.log(`  ├─ DB: Job status check completed in ${checkElapsed}ms`);

      if (job.status === 'failed' || job.status === 'cancelled') {
        this.logger.log(`  └─ ⏭️  Skipping document ${docShort} - job is ${job.status}`);
        return;
      }
    }

    // Start indexing stage on first document
    if (syncJobId && !this.indexingStarted.has(syncJobId)) {
      const metadata = await this.sourcesService.getSyncJobMetadata(syncJobId);
      const embeddingProvider = metadata?.embeddingProvider || 'local';
      const embeddingModel = metadata?.embeddingModel || 'default';
      const totalDocs = metadata?.documentsToProcess || 0;

      await this.sourcesService.startStage(syncJobId, 'indexing', {
        provider: embeddingProvider,
        model: embeddingModel,
        tool: 'vector-embeddings',
      });
      await this.sourcesService.addLog(
        syncJobId,
        'info',
        `Starting indexing stage: ${totalDocs} documents to process with ${embeddingProvider} provider`,
        'indexing'
      );
      this.indexingStarted.add(syncJobId);
    }

    // Get current progress for logging
    let progressInfo = '';
    if (syncJobId) {
      const metadata = await this.sourcesService.getSyncJobMetadata(syncJobId);
      if (metadata) {
        const { documentsProcessed, documentsToProcess } = metadata;
        progressInfo = ` [${(documentsProcessed || 0) + 1}/${documentsToProcess || 0}]`;
      }
    }

    const docFetchStartTime = Date.now();
    const document = await this.documentsService.getDocumentWithChunks(documentId);
    const docFetchElapsed = Date.now() - docFetchStartTime;
    this.logger.log(`  ├─ DB: Fetched document in ${docFetchElapsed}ms`);

    // Chunk the content
    const chunkStartTime = Date.now();
    const chunks = document.type === 'code'
      ? this.chunkingService.chunkCode(document.content)
      : this.chunkingService.chunk(document.content);
    const chunkElapsed = Date.now() - chunkStartTime;

    if (chunks.length === 0) {
      this.logger.warn(`  └─ ⚠️  No chunks generated for document ${docShort}`);
      if (syncJobId) {
        await this.sourcesService.addLog(syncJobId, 'warn', `No chunks generated for document ${docShort}`, 'indexing');
        await this.updateIndexingProgress(syncJobId, true);
      }
      return;
    }

    this.logger.log(`  ├─ Chunking: Generated ${chunks.length} chunks in ${chunkElapsed}ms`);
    if (syncJobId) {
      await this.sourcesService.addLog(
        syncJobId,
        'info',
        `📄 Processing document${progressInfo}: ${chunks.length} chunks`,
        'indexing'
      );
    }

    // Generate embeddings
    const texts = chunks.map((c) => c.content);
    let embeddings: number[][];

    try {
      const embeddingStartTime = Date.now();
      this.logger.log(`  ├─ API: Calling embedding service for ${chunks.length} chunks...`);
      embeddings = await this.embeddingService.embed(texts);
      const embeddingElapsed = Date.now() - embeddingStartTime;
      this.logger.log(`  ├─ API: Embeddings generated in ${embeddingElapsed}ms (${Math.round(embeddingElapsed/chunks.length)}ms/chunk)`);
    } catch (error) {
      this.logger.error(`Failed to generate embeddings: ${error.message}`);
      if (syncJobId) {
        await this.sourcesService.addLog(syncJobId, 'error', `Failed to generate embeddings: ${error.message}`, 'indexing');
        await this.sourcesService.failStage(syncJobId, 'indexing', `Embedding generation failed: ${error.message}`);
        await this.sourcesService.updateSyncJob(syncJobId, {
          status: 'failed',
          errorMessage: `Embedding generation failed: ${error.message}`,
        });
        // Mark remaining stages as skipped
        const job = await this.sourcesService.getSyncJob(syncJobId);
        const stagesToSkip: Array<'extracting' | 'populating'> = ['extracting', 'populating'];
        for (const stageName of stagesToSkip) {
          const stageIndex = job.stages.findIndex(s => s.name === stageName);
          if (stageIndex >= 0 && job.stages[stageIndex].status === 'pending') {
            job.stages[stageIndex] = {
              ...job.stages[stageIndex],
              status: 'skipped',
            };
          }
        }
        await this.sourcesService.updateSyncJob(syncJobId, { stages: job.stages });
      }
      throw error;
    }

    // Save chunks with embeddings
    const chunksWithEmbeddings = chunks.map((chunk, idx) => ({
      content: chunk.content,
      index: chunk.index,
      embedding: embeddings[idx] || null,
    }));

    const saveStartTime = Date.now();
    this.logger.log(`  ├─ DB: Saving ${chunks.length} chunks with embeddings...`);
    await this.documentsService.saveChunks(documentId, chunksWithEmbeddings);
    const saveElapsed = Date.now() - saveStartTime;
    this.logger.log(`  ├─ DB: Saved ${chunks.length} chunks in ${saveElapsed}ms`);

    // Update indexing progress (batched to reduce DB load)
    if (syncJobId) {
      const progressStartTime = Date.now();
      this.logger.log(`  ├─ Progress: Updating indexing progress...`);
      await this.updateIndexingProgress(syncJobId);
      const progressElapsed = Date.now() - progressStartTime;
      this.logger.log(`  ├─ Progress: Updated in ${progressElapsed}ms`);
    }

    const totalElapsed = Date.now() - startTime;
    this.logger.log(`  └─ ✅ Document ${docShort} completed in ${totalElapsed}ms (chunking: ${chunkElapsed}ms, embeddings: ${embeddings ? (Date.now() - startTime - saveElapsed - chunkElapsed) : 0}ms, saving: ${saveElapsed}ms)`);
  }

  /**
   * Update indexing stage progress and trigger extraction when complete
   * Uses batching to reduce DB load - only updates UI every N documents
   */
  private async updateIndexingProgress(syncJobId: string, force = false): Promise<void> {
    try {
      const startTime = Date.now();

      // Atomically increment the counter (single fast query)
      this.logger.log(`    ├─ DB: Incrementing counter (1 SQL query)...`);
      const incrementStartTime = Date.now();
      const result = await this.sourcesService.incrementDocumentsProcessed(syncJobId);
      const incrementElapsed = Date.now() - incrementStartTime;
      this.logger.log(`    ├─ DB: Counter incremented in ${incrementElapsed}ms`);

      if (!result) {
        this.logger.warn(`    └─ ⚠️  Failed to increment counter`);
        return;
      }

      const { documentsProcessed, documentsToProcess } = result;

      // Initialize batch tracking for this job
      if (!this.progressBatch.has(syncJobId)) {
        this.progressBatch.set(syncJobId, { count: 0, lastUpdate: Date.now() });
      }

      const batch = this.progressBatch.get(syncJobId)!;
      batch.count++;

      const isComplete = documentsProcessed >= documentsToProcess;
      const shouldUpdateUI = force || isComplete || batch.count >= this.progressBatchSize || (Date.now() - batch.lastUpdate) > 3000;

      if (shouldUpdateUI) {
        this.logger.log(`    ├─ UI Update: Batching ${batch.count} documents, updating progress UI...`);
        const uiUpdateStartTime = Date.now();

        // Update stage progress (2 queries: find, update - refetch removed!)
        await this.sourcesService.updateStageProgress(
          syncJobId,
          'indexing',
          documentsProcessed,
          documentsToProcess,
        );

        // Add log entry (1 query)
        await this.sourcesService.addLog(
          syncJobId,
          'info',
          `Indexed ${documentsProcessed} of ${documentsToProcess} documents`,
          'indexing',
        );

        const uiUpdateElapsed = Date.now() - uiUpdateStartTime;
        this.logger.log(`    ├─ UI Update: Progress updated in ${uiUpdateElapsed}ms (3 DB queries - optimized from 5)`);

        // Reset batch
        batch.count = 0;
        batch.lastUpdate = Date.now();
      } else {
        this.logger.log(`    ├─ UI Update: Skipping UI update (batching ${batch.count}/${this.progressBatchSize} documents)`);
      }

      // If all documents indexed, complete indexing and start extraction
      if (isComplete) {
        this.logger.log(`    ├─ 🎯 All documents indexed (${documentsProcessed}/${documentsToProcess})`);

        await this.sourcesService.addLog(
          syncJobId,
          'info',
          `✓ Indexing complete: ${documentsProcessed} documents indexed with embeddings`,
          'indexing'
        );

        this.logger.log(`    ├─ DB: Completing indexing stage...`);
        const completeStageStartTime = Date.now();
        await this.sourcesService.completeStage(syncJobId, 'indexing');
        const completeStageElapsed = Date.now() - completeStageStartTime;
        this.logger.log(`    ├─ DB: Stage completed in ${completeStageElapsed}ms`);

        // Clean up batch tracking
        this.progressBatch.delete(syncJobId);

        // Start extraction phase
        this.logger.log(`    ├─ Starting extraction phase...`);
        const extractionStartTime = Date.now();
        await this.startExtractionPhase(syncJobId);
        const extractionElapsed = Date.now() - extractionStartTime;
        this.logger.log(`    └─ ✅ Extraction phase started in ${extractionElapsed}ms`);
      }

      const totalElapsed = Date.now() - startTime;
      this.logger.log(`    └─ Progress tracking completed in ${totalElapsed}ms`);
    } catch (error) {
      this.logger.error(`Failed to update indexing progress for sync job ${syncJobId}: ${error.message}`, error.stack);
      try {
        await this.sourcesService.addLog(syncJobId, 'error', `Indexing progress update failed: ${error.message}`, 'indexing');
      } catch (logError) {
        this.logger.error(`Failed to log indexing error: ${logError.message}`);
      }
      throw error;
    }
  }

  /**
   * Start extraction phase for all documents
   */
  private async startExtractionPhase(syncJobId: string): Promise<void> {
    try {
      const phaseStartTime = Date.now();
      this.logger.log(`🔬 Starting extraction phase for sync job ${syncJobId}`);

      // Start extracting stage
      this.logger.log(`💾 DB: Starting extracting stage...`);
      const stageStartTime = Date.now();
      await this.sourcesService.startStage(syncJobId, 'extracting', {
        provider: 'openai',
        model: 'business-extraction',
        strategy: 'ai-powered',
      });
      const stageElapsed = Date.now() - stageStartTime;
      this.logger.log(`✅ DB: Extracting stage started in ${stageElapsed}ms`);

      await this.sourcesService.addLog(syncJobId, 'info', 'Starting business knowledge extraction stage', 'extracting');

      // Get all documents for this job
      this.logger.log(`🔍 DB: Fetching documents for extraction...`);
      const fetchStartTime = Date.now();
      const job = await this.sourcesService.getSyncJob(syncJobId);
      const documentIds = job.metadata?.documentIds;
      if (!Array.isArray(documentIds) || !documentIds.every((id: unknown) => typeof id === 'string')) {
        throw new Error('Sync job has no valid document manifest; start a new sync');
      }
      const documents = await this.documentsService.findByManifest(job.sourceId, documentIds);
      const fetchElapsed = Date.now() - fetchStartTime;
      this.logger.log(`✅ DB: Fetched ${documents.length} documents in ${fetchElapsed}ms`);

      this.logger.log(`Extracting from ${documents.length} documents`);

      // Extract from each document
      let extracted = 0;
      for (const document of documents) {
        await this.extractFromDocument(document, syncJobId);
        extracted++;

        // Update progress
        await this.sourcesService.updateStageProgress(syncJobId, 'extracting', extracted, documents.length);
        await this.sourcesService.addLog(
          syncJobId,
          'info',
          `Extracted from document ${extracted} of ${documents.length}`,
          'extracting'
        );
      }

      await this.sourcesService.addLog(
        syncJobId,
        'info',
        `✓ Extraction complete: Analyzed ${documents.length} documents`,
        'extracting'
      );
      await this.sourcesService.completeStage(syncJobId, 'extracting');
      this.logger.log(`Sync job ${syncJobId}: Extracting stage completed`);

    } catch (error) {
      this.logger.error(`Failed to start extraction phase: ${error.message}`, error.stack);
      await this.sourcesService.addLog(syncJobId, 'error', `Extraction phase failed: ${error.message}`, 'extracting');
      await this.sourcesService.failStage(syncJobId, 'extracting', error.message);
      throw error;
    }
    await this.startPopulationPhase(syncJobId);
  }

  /**
   * Extract business knowledge from a single document
   */
  private async extractFromDocument(
    document: {
      id: string;
      title: string;
      content: string;
      type: string;
      sourceId: string;
      metadata?: Record<string, any> | null;
    },
    syncJobId: string,
  ): Promise<number> {
    try {
      await this.sourcesService.addLog(syncJobId, 'debug', `Extracting from "${document.title}"...`, 'extracting');

      const extraction = await this.businessExtractionService.extractFromDocument({
        id: document.id,
        title: document.title,
        content: document.content,
        type: document.type,
        sourceId: document.sourceId,
        metadata: document.metadata || undefined,
      });

      await this.sourcesService.addLog(
        syncJobId,
        'debug',
        `Found ${extraction.items.length} business items in "${document.title}"`,
        'extracting'
      );

      // Store extraction for population phase
      const metadata = await this.sourcesService.getSyncJobMetadata(syncJobId);
      const extractions = metadata?.extractions || [];
      if (extraction.items.length > 0) {
        extractions.push(extraction);
        await this.sourcesService.setSyncJobMetadata(syncJobId, {
          ...metadata,
          extractions,
        });
      }

      return extraction.items.length;
    } catch (error) {
      this.logger.warn(`Failed to extract from document ${document.id}: ${error.message}`);
      await this.sourcesService.addLog(
        syncJobId,
        'warn',
        `Failed to extract from "${document.title}": ${error.message}`,
        'extracting'
      );
      throw error;
    }
  }

  /**
   * Start population phase
   */
  private async startPopulationPhase(syncJobId: string): Promise<void> {
    try {
      this.logger.log(`Starting population phase for sync job ${syncJobId}`);

      // Start populating stage
      await this.sourcesService.startStage(syncJobId, 'populating', {
        tool: 'typeorm',
        strategy: 'batch-upsert',
        provider: 'postgresql',
      });
      await this.sourcesService.addLog(syncJobId, 'info', 'Starting context population stage', 'populating');

      // Get all extractions
      const metadata = await this.sourcesService.getSyncJobMetadata(syncJobId);
      const extractions = metadata?.extractions || [];
      const documentsToProcess = metadata?.documentsToProcess || 0;

      if (extractions.length === 0) {
        this.logger.log(`No extractions to populate for sync job ${syncJobId}`);
        await this.sourcesService.addLog(syncJobId, 'info', 'No business items found to populate', 'populating');
        await this.sourcesService.completeStage(syncJobId, 'populating');
        await this.completeSync(syncJobId, 0, documentsToProcess);
        return;
      }

      // Populate all extractions
      let totalItems = 0;
      let totalRelationships = 0;
      let populatedCount = 0;

      for (const extraction of extractions) {
        const result = await this.businessExtractionService.saveExtractedItems(extraction);
        totalItems += result.saved;
        totalRelationships += result.relationships;
        populatedCount++;

        await this.sourcesService.addLog(
          syncJobId,
          'debug',
          `Saved ${result.saved} items and ${result.relationships} relationships`,
          'populating'
        );

        // Update progress
        await this.sourcesService.updateStageProgress(syncJobId, 'populating', populatedCount, extractions.length);
      }

      await this.sourcesService.addLog(
        syncJobId,
        'info',
        `✓ Population complete: ${totalItems} business items and ${totalRelationships} relationships saved`,
        'populating'
      );
      await this.sourcesService.completeStage(syncJobId, 'populating');
      this.logger.log(`Sync job ${syncJobId}: Populating stage completed`);

      // Complete the sync
      await this.completeSync(syncJobId, totalItems, documentsToProcess);
    } catch (error) {
      this.logger.error(`Failed to start population phase: ${error.message}`, error.stack);
      await this.sourcesService.addLog(syncJobId, 'error', `Population phase failed: ${error.message}`, 'populating');
      await this.sourcesService.failStage(syncJobId, 'populating', error.message);
      throw error;
    }
  }

  /**
   * Complete the sync job
   */
  private async completeSync(syncJobId: string, businessItemsExtracted: number, documentsTotal: number): Promise<void> {
    await this.sourcesService.completeJob(syncJobId, {
      documentsTotal,
      documentsNew: documentsTotal,
      documentsUpdated: 0,
      documentsDeleted: 0,
      businessItemsExtracted,
    });

    this.logger.log(`Sync job ${syncJobId}: All stages completed successfully`);
    await this.sourcesService.addLog(
      syncJobId,
      'info',
      `✅ Sync complete! Processed ${documentsTotal} documents and extracted ${businessItemsExtracted} business items`
    );

    // Clean up tracking
    this.indexingStarted.delete(syncJobId);
  }
}
