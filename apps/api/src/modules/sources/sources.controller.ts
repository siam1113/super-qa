import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  HttpCode,
  HttpStatus,
  Sse,
  ParseUUIDPipe,
  UploadedFiles,
  UseInterceptors,
  BadRequestException,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { Observable } from 'rxjs';
import { createHash } from 'crypto';
import { SourcesService } from './sources.service';
import { SseEventsService } from './sse-events.service';
import { CreateSourceDto } from './dto/create-source.dto';
import { UpdateSourceDto } from './dto/update-source.dto';
import { STAGE_DESCRIPTIONS, STATUS_DESCRIPTIONS } from './entities/sync-job.entity';
import { CircuitBreakerService } from '../../common/circuit-breaker.service';

/**
 * A stable, non-reversible fingerprint of a source's credentials, so the UI can tell
 * which sources share the same underlying token/account (e.g. several GitHub repos
 * added under one PAT) and group them, without the token itself ever leaving the API.
 */
function credentialKey(config: { token?: string; oauth?: { accessToken?: string } }): string | null {
  const secret = config?.token || config?.oauth?.accessToken;
  return secret ? createHash('sha256').update(secret).digest('hex').slice(0, 16) : null;
}

interface MulterFile {
  fieldname: string;
  originalname: string;
  encoding: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

interface MessageEvent {
  data: string | object;
  id?: string;
  type?: string;
  retry?: number;
}

@Controller('sources')
export class SourcesController {
  constructor(
    private readonly sourcesService: SourcesService,
    private readonly sseEventsService: SseEventsService,
    private readonly circuitBreaker: CircuitBreakerService,
  ) {}

  /**
   * SSE endpoint for real-time sync job updates.
   * Keep static routes before `:id` so `events` is not treated as a source UUID.
   */
  @Sse('events')
  subscribeToEvents(@Query('clientId') clientId?: string): Observable<MessageEvent> {
    return this.sseEventsService.createConnection(clientId);
  }

  @Get()
  async findAll() {
    const sources = await this.sourcesService.findAll();
    // Get last sync job for each source
    const sourcesWithSync = await Promise.all(
      sources.map(async (source) => {
        const lastSyncJob = await this.sourcesService.getLastSyncJob(source.id);
        return {
          id: source.id,
          name: source.name,
          type: source.type,
          status: source.status,
          lastSync: source.lastSync?.toISOString() || null,
          lastSyncJobId: lastSyncJob?.id || null,
          lastSyncStatus: lastSyncJob?.status || null,
          itemsCount: source.itemsCount,
          permissions: source.permissions,
          syncMode: source.syncMode,
          errorMessage: source.errorMessage,
          repository: source.config?.repository,
          project: source.config?.project,
          spaceKey: source.config?.spaceKey,
          baseUrl: source.config?.baseUrl,
          credentialKey: credentialKey(source.config || {}),
        };
      }),
    );
    return sourcesWithSync;
  }

  @Get(':id')
  async findOne(@Param('id', new ParseUUIDPipe()) id: string) {
    const source = await this.sourcesService.findOne(id);
    return {
      id: source.id,
      name: source.name,
      type: source.type,
      status: source.status,
      lastSync: source.lastSync?.toISOString() || null,
      itemsCount: source.itemsCount,
      permissions: source.permissions,
      syncMode: source.syncMode,
      errorMessage: source.errorMessage,
      config: {
        authType: source.config.authType,
        baseUrl: source.config.baseUrl,
        repository: source.config.repository,
        project: source.config.project,
        spaceKey: source.config.spaceKey,
        // Don't expose tokens
      },
    };
  }

  @Post()
  async create(@Body() createSourceDto: CreateSourceDto) {
    const source = await this.sourcesService.create(createSourceDto);
    return {
      id: source.id,
      name: source.name,
      type: source.type,
      status: source.status,
      syncMode: source.syncMode,
    };
  }

  @Patch(':id')
  async update(@Param('id') id: string, @Body() updateSourceDto: UpdateSourceDto) {
    const source = await this.sourcesService.update(id, updateSourceDto);
    return {
      id: source.id,
      name: source.name,
      type: source.type,
      status: source.status,
      syncMode: source.syncMode,
    };
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param('id') id: string) {
    await this.sourcesService.remove(id);
  }

  /**
   * Upload files to an "upload" source. Can be called again later to add more files to the
   * same connection — mirrors addRepository/addProject/addSpace, just for raw files instead
   * of picking an item from the provider's own list.
   */
  @Post(':id/files')
  @UseInterceptors(FilesInterceptor('files', 10, { limits: { fileSize: 25 * 1024 * 1024 } }))
  async uploadFiles(@Param('id') id: string, @UploadedFiles() files: MulterFile[]) {
    if (!files?.length) {
      throw new BadRequestException('Select at least one file to upload');
    }
    const source = await this.sourcesService.attachFiles(id, files);
    return {
      id: source.id,
      name: source.name,
      type: source.type,
      status: source.status,
      filesCount: (source.config.additionalConfig?.files as unknown[] | undefined)?.length || 0,
    };
  }

  @Post(':id/test')
  async testConnection(@Param('id') id: string) {
    return this.sourcesService.testConnection(id);
  }

  /**
   * List repositories visible to this connection's credentials, so the user can
   * pick one instead of typing "owner/repo" manually.
   */
  @Get(':id/repositories')
  async listRepositories(@Param('id') id: string) {
    const repositories = await this.sourcesService.listRepositories(id);
    return { repositories };
  }

  /**
   * Add another repository under this connection's credentials (no re-auth required).
   */
  @Post(':id/repositories')
  async addRepository(
    @Param('id') id: string,
    @Body() body: { repository: string; name?: string },
  ) {
    const source = await this.sourcesService.addRepository(id, body.repository, body.name);
    return {
      id: source.id,
      name: source.name,
      type: source.type,
      status: source.status,
      syncMode: source.syncMode,
    };
  }

  /**
   * List Jira projects visible to this connection's credentials, so the user can
   * pick one instead of typing a project key manually.
   */
  @Get(':id/projects')
  async listProjects(@Param('id') id: string) {
    const projects = await this.sourcesService.listProjects(id);
    return { projects };
  }

  /**
   * Add another Jira project under this connection's credentials (no re-auth required).
   */
  @Post(':id/projects')
  async addProject(
    @Param('id') id: string,
    @Body() body: { project: string; name?: string },
  ) {
    const source = await this.sourcesService.addProject(id, body.project, body.name);
    return {
      id: source.id,
      name: source.name,
      type: source.type,
      status: source.status,
      syncMode: source.syncMode,
    };
  }

  /**
   * List Confluence spaces visible to this connection's credentials, so the user can
   * pick one instead of typing a space key manually.
   */
  @Get(':id/spaces')
  async listSpaces(@Param('id') id: string) {
    const spaces = await this.sourcesService.listSpaces(id);
    return { spaces };
  }

  /**
   * Add another Confluence space under this connection's credentials (no re-auth required).
   */
  @Post(':id/spaces')
  async addSpace(
    @Param('id') id: string,
    @Body() body: { spaceKey: string; name?: string },
  ) {
    const source = await this.sourcesService.addSpace(id, body.spaceKey, body.name);
    return {
      id: source.id,
      name: source.name,
      type: source.type,
      status: source.status,
      syncMode: source.syncMode,
    };
  }

  @Post(':id/sync')
  async triggerSync(
    @Param('id') id: string,
    @Body() body?: { mode?: 'incremental' | 'full' | 'selective'; externalIds?: string[]; intents?: string[]; forceReprocess?: boolean; forceExtract?: boolean },
  ) {
    const syncJob = await this.sourcesService.triggerSync(id, 'manual', body);
    return {
      syncJobId: syncJob.id,
      status: syncJob.status,
    };
  }

  @Get(':id/preview-documents')
  async previewDocuments(
    @Param('id') id: string,
    @Query('limit') limit?: string,
  ) {
    const documents = await this.sourcesService.previewDocuments(
      id,
      limit ? parseInt(limit, 10) : 100,
    );
    return {
      documents: documents.map((doc) => ({
        externalId: doc.externalId,
        type: doc.type,
        title: doc.title,
        url: doc.url,
        metadata: doc.metadata,
      })),
      total: documents.length,
    };
  }

  @Get(':id/status')
  async getSyncStatus(@Param('id') id: string) {
    const syncJob = await this.sourcesService.getSyncStatus(id);
    if (!syncJob) {
      return { status: 'no_sync_history' };
    }
    return {
      syncJobId: syncJob.id,
      status: syncJob.status,
      itemsProcessed: syncJob.itemsProcessed,
      itemsTotal: syncJob.itemsTotal,
      startedAt: syncJob.startedAt?.toISOString(),
      completedAt: syncJob.completedAt?.toISOString(),
      errorMessage: syncJob.errorMessage,
    };
  }

  /**
   * Trigger incremental sync (only fetch changes since last sync)
   */
  @Post(':id/sync/incremental')
  async triggerIncrementalSync(@Param('id') id: string) {
    const syncJob = await this.sourcesService.triggerIncrementalSync(id);
    return {
      syncJobId: syncJob.id,
      status: syncJob.status,
      type: 'incremental',
    };
  }

  /**
   * Configure webhook for real-time updates
   */
  @Post(':id/webhook')
  async configureWebhook(
    @Param('id') id: string,
    @Body() body: { enabled: boolean; secret?: string },
  ) {
    const source = await this.sourcesService.configureWebhook(id, body);
    return {
      enabled: source.webhookConfig?.enabled,
      webhookUrl: this.sourcesService.getWebhookUrl(id, source.type),
    };
  }

  /**
   * Get webhook configuration
   */
  @Get(':id/webhook')
  async getWebhookConfig(@Param('id') id: string) {
    const source = await this.sourcesService.findOne(id);
    return {
      enabled: source.webhookConfig?.enabled || false,
      webhookUrl: this.sourcesService.getWebhookUrl(id, source.type),
      registeredAt: source.webhookConfig?.registeredAt,
    };
  }

  // ============ Sync Jobs Endpoints ============

  /**
   * Get all sync jobs across all sources
   * Protected by circuit breaker to prevent infinite query loops
   */
  @Get('jobs/all')
  async getAllSyncJobs(
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    // Use circuit breaker to protect against cascading failures
    const { jobs, total } = await this.circuitBreaker.execute(
      'sync-jobs-query',
      async () => {
        return this.sourcesService.getSyncJobs(
          undefined,
          limit ? parseInt(limit, 10) : 20,
          offset ? parseInt(offset, 10) : 0,
        );
      },
      async () => {
        // Fallback: return empty result if circuit is open
        return { jobs: [], total: 0 };
      },
    );

    return {
      jobs: jobs.map((job) => ({
        id: job.id,
        sourceId: job.sourceId,
        sourceName: job.source?.name,
        status: job.status,
        trigger: job.trigger,
        currentStage: job.currentStage,
        stages: job.stages,
        stats: job.stats,
        metadata: job.metadata,
        itemsProcessed: job.itemsProcessed,
        itemsTotal: job.itemsTotal,
        errorMessage: job.errorMessage,
        startedAt: job.startedAt?.toISOString(),
        completedAt: job.completedAt?.toISOString(),
        createdAt: job.createdAt.toISOString(),
        syncMode: (job.metadata as any)?.syncMode,
        forceReprocess: (job.metadata as any)?.forceReprocess,
        forceExtract: (job.metadata as any)?.forceExtract,
        selectedDocumentsCount: (job.metadata as any)?.selectedDocumentsCount,
      })),
      total,
      descriptions: {
        stages: STAGE_DESCRIPTIONS,
        statuses: STATUS_DESCRIPTIONS,
      },
    };
  }

  /**
   * Get sync jobs for a specific source
   */
  @Get(':id/jobs')
  async getSyncJobs(
    @Param('id') sourceId: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    const { jobs, total } = await this.sourcesService.getSyncJobs(
      sourceId,
      limit ? parseInt(limit, 10) : 20,
      offset ? parseInt(offset, 10) : 0,
    );

    return {
      jobs: jobs.map((job) => ({
        id: job.id,
        sourceId: job.sourceId,
        sourceName: job.source?.name,
        status: job.status,
        trigger: job.trigger,
        currentStage: job.currentStage,
        stages: job.stages,
        stats: job.stats,
        metadata: job.metadata,
        itemsProcessed: job.itemsProcessed,
        itemsTotal: job.itemsTotal,
        errorMessage: job.errorMessage,
        startedAt: job.startedAt?.toISOString(),
        completedAt: job.completedAt?.toISOString(),
        createdAt: job.createdAt.toISOString(),
        syncMode: (job.metadata as any)?.syncMode,
        forceReprocess: (job.metadata as any)?.forceReprocess,
        forceExtract: (job.metadata as any)?.forceExtract,
        selectedDocumentsCount: (job.metadata as any)?.selectedDocumentsCount,
      })),
      total,
      descriptions: {
        stages: STAGE_DESCRIPTIONS,
        statuses: STATUS_DESCRIPTIONS,
      },
    };
  }

  /**
   * Get a specific sync job
   */
  @Get(':id/jobs/:jobId')
  async getSyncJob(@Param('id') _sourceId: string, @Param('jobId') jobId: string) {
    const job = await this.sourcesService.getSyncJob(jobId);
    return {
      id: job.id,
      sourceId: job.sourceId,
      sourceName: job.source?.name,
      status: job.status,
      trigger: job.trigger,
      currentStage: job.currentStage,
      stages: job.stages,
      stats: job.stats,
      itemsProcessed: job.itemsProcessed,
      itemsTotal: job.itemsTotal,
      errorMessage: job.errorMessage,
      startedAt: job.startedAt?.toISOString(),
      completedAt: job.completedAt?.toISOString(),
      createdAt: job.createdAt.toISOString(),
      syncMode: (job.metadata as any)?.syncMode,
      forceReprocess: (job.metadata as any)?.forceReprocess,
      forceExtract: (job.metadata as any)?.forceExtract,
      selectedDocumentsCount: (job.metadata as any)?.selectedDocumentsCount,
      descriptions: {
        stages: STAGE_DESCRIPTIONS,
        statuses: STATUS_DESCRIPTIONS,
      },
    };
  }

  /**
   * Get logs for a specific sync job
   */
  @Get(':id/jobs/:jobId/logs')
  async getSyncJobLogs(
    @Param('id') _sourceId: string,
    @Param('jobId') jobId: string,
    @Query('stage') stage?: string,
  ) {
    const logs = await this.sourcesService.getLogs(jobId, stage as any);
    return { logs };
  }

  /**
   * Cancel a sync job
   */
  @Post(':id/jobs/:jobId/cancel')
  async cancelSyncJob(@Param('id') _sourceId: string, @Param('jobId') jobId: string) {
    const job = await this.sourcesService.cancelSyncJob(jobId);
    return {
      id: job.id,
      status: job.status,
    };
  }

  /**
   * Get stage and status descriptions for UI tooltips
   */
  @Get('meta/descriptions')
  getDescriptions() {
    return {
      stages: STAGE_DESCRIPTIONS,
      statuses: STATUS_DESCRIPTIONS,
    };
  }

}
