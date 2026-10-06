import { Process, Processor } from '@nestjs/bull';
import { Inject, Logger } from '@nestjs/common';
import { Job } from 'bull';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Source } from './entities/source.entity';
import { SourcesService } from './sources.service';
import { DocumentsService } from '../documents/documents.service';
import { ISourceConnector, ConnectorDocument, SyncOptions } from './connectors/connector.interface';

interface SyncJobData {
  sourceId: string;
  syncJobId: string;
  incremental?: boolean;
  mode?: 'incremental' | 'full' | 'selective';
  externalIds?: string[];
  intents?: string[];
  forceReprocess?: boolean;
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
    @Inject('GitHubConnector') private readonly githubConnector: ISourceConnector,
    @Inject('JiraConnector') private readonly jiraConnector: ISourceConnector,
    @Inject('ConfluenceConnector') private readonly confluenceConnector: ISourceConnector,
    @Inject('UploadConnector') private readonly uploadConnector: ISourceConnector,
  ) {
    this.connectors = new Map();
    this.connectors.set('github', this.githubConnector);
    this.connectors.set('jira', this.jiraConnector);
    this.connectors.set('confluence', this.confluenceConnector);
    this.connectors.set('upload', this.uploadConnector);
  }

  @Process('sync-source')
  async handleSync(job: Job<SyncJobData>) {
    const { sourceId, syncJobId, incremental = false, mode, externalIds, intents, forceReprocess = false } = job.data;
    const syncMode = mode || (incremental ? 'incremental' : 'full');
    const logMessage = `Starting ${syncMode} sync for source ${sourceId}${externalIds ? ` (${externalIds.length} documents selected)` : ''}${forceReprocess ? ' (force reprocess)' : ''}`;
    this.logger.log(logMessage);
    await this.sourcesService.addLog(syncJobId, 'info', logMessage);

    let currentStage: 'pulling' | 'processing' | 'indexing' | 'extracting' | 'populating' = 'pulling';

    try {
      // Initialize job stages and set to running
      await this.sourcesService.initializeJobStages(syncJobId);
      await this.sourcesService.addLog(syncJobId, 'info', 'Sync job initialized and running');

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
      await this.sourcesService.startStage(syncJobId, 'pulling', {
        tool: `${source.type}-connector`,
        provider: source.type,
      });
      await this.sourcesService.addLog(syncJobId, 'info', `Starting pulling stage using ${source.type} connector`, 'pulling');
      await this.sourcesService.addLog(syncJobId, 'debug', 'Authenticating with source API...', 'pulling');

      const syncOptions: SyncOptions = {
        incremental: syncMode === 'incremental',
        since: syncMode === 'incremental' && source.syncState?.lastSyncedAt
          ? new Date(source.syncState.lastSyncedAt)
          : undefined,
        cursor: undefined,
      };

      let totalProcessed = 0;
      const allDocuments: ConnectorDocument[] = [];
      let lastSyncedAt: Date | undefined;

      // For selective sync, create a set for fast lookup and track found documents
      const isSelectiveSync = mode === 'selective' && externalIds && externalIds.length > 0;
      const externalIdsSet = isSelectiveSync ? new Set(externalIds) : null;
      const foundExternalIds = isSelectiveSync ? new Set<string>() : null;

      do {
        const result = await connector.fetchDocuments(source.config, syncOptions);

        // Filter documents immediately during pulling for selective sync
        if (isSelectiveSync && externalIdsSet) {
          const filteredDocs = result.documents.filter((doc) => externalIdsSet.has(doc.externalId));
          allDocuments.push(...filteredDocs);

          // Track which documents we've found
          filteredDocs.forEach((doc) => foundExternalIds?.add(doc.externalId));

          totalProcessed += filteredDocs.length;
          const selectiveMessage = `Selective sync: found ${filteredDocs.length} of ${externalIds.length} selected documents (${foundExternalIds?.size}/${externalIds.length} total)`;
          this.logger.log(selectiveMessage);
          await this.sourcesService.addLog(syncJobId, 'info', selectiveMessage, 'pulling');
        } else {
          allDocuments.push(...result.documents);
          totalProcessed += result.documents.length;
          await this.sourcesService.addLog(syncJobId, 'debug', `Fetched ${result.documents.length} documents (total: ${totalProcessed})`, 'pulling');
        }

        if (result.syncedAt) {
          lastSyncedAt = result.syncedAt;
        }

        await this.sourcesService.updateStageProgress(syncJobId, 'pulling', totalProcessed);
        syncOptions.cursor = result.hasMore ? result.cursor : undefined;

        // For selective sync, stop early if we've found all selected documents
        if (isSelectiveSync && foundExternalIds && foundExternalIds.size >= externalIds.length) {
          const earlyStopMessage = `Selective sync: found all ${externalIds.length} selected documents, stopping pull early`;
          this.logger.log(earlyStopMessage);
          await this.sourcesService.addLog(syncJobId, 'info', earlyStopMessage, 'pulling');
          break;
        }
      } while (syncOptions.cursor);

      await this.sourcesService.addLog(syncJobId, 'info', `✓ Pulled ${totalProcessed} documents from ${source.type}`, 'pulling');
      await this.sourcesService.completeStage(syncJobId, 'pulling');

      const documentsToProcess = allDocuments;
      if (isSelectiveSync) {
        const selectiveSummary = `Selective sync: pulled ${documentsToProcess.length} of ${externalIds.length} selected documents`;
        this.logger.log(selectiveSummary);
        await this.sourcesService.addLog(syncJobId, 'info', selectiveSummary);
      }

      // ===== STAGE 2: PROCESSING =====
      currentStage = 'processing';
      await this.sourcesService.startStage(syncJobId, 'processing', {
        tool: 'document-parser',
        strategy: 'content-extraction',
      });

      await this.sourcesService.addLog(syncJobId, 'info', `Storing ${documentsToProcess.length} documents to database`, 'processing');
      await this.sourcesService.addLog(syncJobId, 'debug', 'Validating and hashing document content...', 'processing');

      const upsertResult = await this.documentsService.upsertDocuments(
        sourceId,
        documentsToProcess,
        undefined,
        forceReprocess,
        { deferQueue: true },
      );

      await this.sourcesService.updateStageProgress(
        syncJobId,
        'processing',
        documentsToProcess.length,
        documentsToProcess.length,
      );

      const skippedMsg = upsertResult.skipped > 0 ? ` (${upsertResult.skipped} unchanged, skipped)` : '';
      await this.sourcesService.addLog(
        syncJobId,
        'info',
        `✓ Stored ${upsertResult.total} documents to database${skippedMsg}`,
        'processing'
      );

      // ===== STAGE 3: INDEXING =====
      // Indexing, extracting, and populating stages will be started and managed
      // by the processing service as documents are processed in the background queue
      const embeddingProvider = process.env.EMBEDDING_PROVIDER || 'local';
      const embeddingModel = process.env.EMBEDDING_MODEL || 'default';

      // Determine how many documents need processing (not skipped)
      const documentsNeedingProcessing = upsertResult.documentIds.length;

      // CRITICAL: Set metadata AND complete processing in single atomic operation
      // This prevents save() race conditions and ensures background workers have metadata available
      await this.sourcesService.setMetadataAndCompleteStage(
        syncJobId,
        {
          documentsToProcess: documentsNeedingProcessing,
          documentIds: upsertResult.documentIds,
          documentsProcessed: 0,
          documentsExtracted: 0,
          businessItemsExtracted: 0,
          intents: intents || [],
          syncMode: syncMode,
          forceReprocess: forceReprocess,
          selectedDocumentsCount: externalIds?.length,
          embeddingProvider,
          embeddingModel,
          newSyncState: {
            ...source.syncState,
            lastSyncedAt: lastSyncedAt || new Date(),
            lastCursor: syncOptions.cursor,
          },
        },
        'processing',
      );

      // NOW queue documents for background processing (metadata is ready)
      if (documentsNeedingProcessing > 0) {
        await this.documentsService.queueDocumentsForProcessing(sourceId, syncJobId, upsertResult.documentIds);
      }

      this.logger.log(`Sync metadata set: ${documentsNeedingProcessing} documents queued for indexing`);

      // Update source to connected but keep sync job running
      await this.sourcesService.updateSourceAfterSync(
        sourceId,
        'connected',
        incremental ? source.itemsCount + totalProcessed : totalProcessed,
        undefined,
        undefined, // Don't update sync state yet
      );

      // If no documents were queued, immediately complete remaining stages
      if (documentsNeedingProcessing === 0) {
        await this.sourcesService.completeStage(syncJobId, 'indexing');
        await this.sourcesService.completeStage(syncJobId, 'extracting');
        await this.sourcesService.completeStage(syncJobId, 'populating');
        await this.sourcesService.completeJob(syncJobId, {
          documentsTotal: totalProcessed,
          documentsNew: 0,
          documentsUpdated: 0,
          documentsDeleted: 0,
          businessItemsExtracted: 0,
        });
        this.logger.log(`Sync completed for source ${sourceId}: ${totalProcessed} documents (all unchanged)`);
      } else {
        // NOTE: Indexing, Extracting, and Populating stages will be completed by the processing service
        // as documents are processed in the background queue
        this.logger.log(`Sync completed for source ${sourceId}: ${totalProcessed} documents`);
      }
    } catch (error) {
      this.logger.error(`Sync failed for source ${sourceId}: ${error.message}`);
      await this.sourcesService.addLog(syncJobId, 'error', `Sync failed: ${error.message}`);

      // Fail the current stage
      await this.sourcesService.failStage(syncJobId, currentStage, error.message);

      // Mark remaining stages as skipped
      const allStages: Array<'pulling' | 'processing' | 'indexing' | 'extracting' | 'populating'> =
        ['pulling', 'processing', 'indexing', 'extracting', 'populating'];
      const currentStageIndex = allStages.indexOf(currentStage);

      const job = await this.sourcesService.getSyncJob(syncJobId);
      let stagesUpdated = false;

      for (let i = currentStageIndex + 1; i < allStages.length; i++) {
        const stageIndex = job.stages.findIndex(s => s.name === allStages[i]);
        if (stageIndex >= 0 && job.stages[stageIndex].status === 'pending') {
          job.stages[stageIndex] = {
            ...job.stages[stageIndex],
            status: 'skipped',
          };
          stagesUpdated = true;
        }
      }

      if (stagesUpdated) {
        await this.sourcesService.updateSyncJob(syncJobId, {
          status: 'failed',
          stages: job.stages,
        });
      }

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
