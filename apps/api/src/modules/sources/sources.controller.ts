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
} from '@nestjs/common';
import { SourcesService } from './sources.service';
import { CreateSourceDto } from './dto/create-source.dto';
import { UpdateSourceDto } from './dto/update-source.dto';
import { STAGE_DESCRIPTIONS, STATUS_DESCRIPTIONS } from './entities/sync-job.entity';

@Controller('sources')
export class SourcesController {
  constructor(private readonly sourcesService: SourcesService) {}

  @Get()
  async findAll() {
    const sources = await this.sourcesService.findAll();
    // Transform for frontend compatibility
    return sources.map((source) => ({
      id: source.id,
      name: source.name,
      type: source.type,
      status: source.status,
      lastSync: source.lastSync?.toISOString() || null,
      itemsCount: source.itemsCount,
      permissions: source.permissions,
      syncMode: source.syncMode,
    }));
  }

  @Get(':id')
  async findOne(@Param('id') id: string) {
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
      config: {
        authType: source.config.authType,
        baseUrl: source.config.baseUrl,
        repository: source.config.repository,
        project: source.config.project,
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

  @Post(':id/test')
  async testConnection(@Param('id') id: string) {
    return this.sourcesService.testConnection(id);
  }

  @Post(':id/sync')
  async triggerSync(@Param('id') id: string) {
    const syncJob = await this.sourcesService.triggerSync(id);
    return {
      syncJobId: syncJob.id,
      status: syncJob.status,
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
   */
  @Get('jobs/all')
  async getAllSyncJobs(
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    const { jobs, total } = await this.sourcesService.getSyncJobs(
      undefined,
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
        itemsProcessed: job.itemsProcessed,
        itemsTotal: job.itemsTotal,
        errorMessage: job.errorMessage,
        startedAt: job.startedAt?.toISOString(),
        completedAt: job.completedAt?.toISOString(),
        createdAt: job.createdAt.toISOString(),
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
        itemsProcessed: job.itemsProcessed,
        itemsTotal: job.itemsTotal,
        errorMessage: job.errorMessage,
        startedAt: job.startedAt?.toISOString(),
        completedAt: job.completedAt?.toISOString(),
        createdAt: job.createdAt.toISOString(),
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
      descriptions: {
        stages: STAGE_DESCRIPTIONS,
        statuses: STATUS_DESCRIPTIONS,
      },
    };
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
