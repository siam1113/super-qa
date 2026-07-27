import { Process, Processor } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { Job } from 'bull';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Source } from './entities/source.entity';
import { SourcesService } from './sources.service';
import { DocumentsService } from '../documents/documents.service';
import { GitHubConnector } from './connectors/github.connector';
import { JiraConnector } from './connectors/jira.connector';
import { ConfluenceConnector } from './connectors/confluence.connector';
import { ISourceConnector, ConnectorDocument, SyncOptions } from './connectors/connector.interface';

interface SyncJobData {
  sourceId: string;
  syncJobId: string;
  incremental?: boolean;
}

@Processor('sync')
export class SyncProcessor {
  private readonly logger = new Logger(SyncProcessor.name);
  private connectors: Map<string, ISourceConnector>;

  constructor(
    @InjectRepository(Source)
    private sourceRepository: Repository<Source>,
    private sourcesService: SourcesService,
    private documentsService: DocumentsService,
  ) {
    this.connectors = new Map();
    this.connectors.set('github', new GitHubConnector());
    this.connectors.set('jira', new JiraConnector());
    this.connectors.set('confluence', new ConfluenceConnector());
  }

  @Process('sync-source')
  async handleSync(job: Job<SyncJobData>) {
    const { sourceId, syncJobId, incremental = false } = job.data;
    this.logger.log(`Starting ${incremental ? 'incremental' : 'full'} sync for source ${sourceId}`);

    let currentStage: 'pulling' | 'processing' | 'indexing' | 'extracting' = 'pulling';

    try {
      // Initialize job stages and set to running
      await this.sourcesService.initializeJobStages(syncJobId);

      // Get source
      const source = await this.sourceRepository.findOne({ where: { id: sourceId } });
      if (!source) {
        throw new Error(`Source ${sourceId} not found`);
      }

      // Get connector
      const connector = this.connectors.get(source.type);
      if (!connector) {
        throw new Error(`No connector available for ${source.type}`);
      }

      // ===== STAGE 1: PULLING =====
      currentStage = 'pulling';
      await this.sourcesService.startStage(syncJobId, 'pulling');

      const syncOptions: SyncOptions = {
        incremental,
        since: incremental && source.syncState?.lastSyncedAt
          ? new Date(source.syncState.lastSyncedAt)
          : undefined,
        cursor: undefined,
      };

      let totalProcessed = 0;
      const allDocuments: ConnectorDocument[] = [];
      let lastSyncedAt: Date | undefined;

      do {
        const result = await connector.fetchDocuments(source.config, syncOptions);
        allDocuments.push(...result.documents);
        totalProcessed += result.documents.length;

        if (result.syncedAt) {
          lastSyncedAt = result.syncedAt;
        }

        await this.sourcesService.updateStageProgress(syncJobId, 'pulling', totalProcessed);
        syncOptions.cursor = result.hasMore ? result.cursor : undefined;
      } while (syncOptions.cursor);

      await this.sourcesService.completeStage(syncJobId, 'pulling');

      // ===== STAGE 2: PROCESSING =====
      currentStage = 'processing';
      await this.sourcesService.startStage(syncJobId, 'processing');

      // Store documents (this is the processing step)
      await this.documentsService.upsertDocuments(sourceId, allDocuments);
      await this.sourcesService.updateStageProgress(syncJobId, 'processing', totalProcessed, totalProcessed);
      await this.sourcesService.completeStage(syncJobId, 'processing');

      // ===== STAGE 3: INDEXING =====
      currentStage = 'indexing';
      await this.sourcesService.startStage(syncJobId, 'indexing');

      // Indexing happens via document processing pipeline
      // Mark as complete (actual indexing is async in processing service)
      await this.sourcesService.updateStageProgress(syncJobId, 'indexing', totalProcessed, totalProcessed);
      await this.sourcesService.completeStage(syncJobId, 'indexing');

      // ===== STAGE 4: EXTRACTING =====
      currentStage = 'extracting';
      await this.sourcesService.startStage(syncJobId, 'extracting');

      // Extraction happens via business extraction service
      // Mark as complete (actual extraction is async in processing service)
      await this.sourcesService.updateStageProgress(syncJobId, 'extracting', totalProcessed, totalProcessed);
      await this.sourcesService.completeStage(syncJobId, 'extracting');

      // ===== COMPLETE JOB =====
      const newSyncState = {
        ...source.syncState,
        lastSyncedAt: lastSyncedAt || new Date(),
        lastCursor: syncOptions.cursor,
      };

      await this.sourcesService.completeJob(syncJobId, {
        documentsTotal: totalProcessed,
        documentsNew: incremental ? totalProcessed : totalProcessed,
        documentsUpdated: 0,
        documentsDeleted: 0,
        businessItemsExtracted: 0, // Will be updated by extraction service
      });

      await this.sourcesService.updateSourceAfterSync(
        sourceId,
        'connected',
        incremental ? source.itemsCount + totalProcessed : totalProcessed,
        undefined,
        newSyncState,
      );

      this.logger.log(`Sync completed for source ${sourceId}: ${totalProcessed} documents`);
    } catch (error) {
      this.logger.error(`Sync failed for source ${sourceId}: ${error.message}`);

      // Fail the current stage
      await this.sourcesService.failStage(syncJobId, currentStage, error.message);

      // Update source status
      await this.sourcesService.updateSourceAfterSync(sourceId, 'error', undefined, error.message);

      throw error;
    }
  }

  /**
   * Handle webhook-triggered document updates
   */
  @Process('webhook-update')
  async handleWebhookUpdate(job: Job<{ sourceId: string; documents: ConnectorDocument[] }>) {
    const { sourceId, documents } = job.data;
    this.logger.log(`Processing webhook update for source ${sourceId}: ${documents.length} documents`);

    try {
      await this.documentsService.upsertDocuments(sourceId, documents);
      this.logger.log(`Webhook update completed for source ${sourceId}`);
    } catch (error) {
      this.logger.error(`Webhook update failed for source ${sourceId}: ${error.message}`);
      throw error;
    }
  }
}
