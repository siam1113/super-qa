import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { Source, SourceStatus, SyncState } from './entities/source.entity';
import {
  SyncJob,
  SyncJobStage,
  SyncJobStats,
  SyncStageName,
  SYNC_STAGES,
} from './entities/sync-job.entity';
import { CreateSourceDto } from './dto/create-source.dto';
import { UpdateSourceDto } from './dto/update-source.dto';
import { GitHubConnector } from './connectors/github.connector';
import { JiraConnector } from './connectors/jira.connector';
import { ConfluenceConnector } from './connectors/confluence.connector';
import { ISourceConnector } from './connectors/connector.interface';

@Injectable()
export class SourcesService {
  private connectors: Map<string, ISourceConnector>;

  constructor(
    @InjectRepository(Source)
    private sourceRepository: Repository<Source>,
    @InjectRepository(SyncJob)
    private syncJobRepository: Repository<SyncJob>,
    @InjectQueue('sync')
    private syncQueue: Queue,
  ) {
    this.connectors = new Map();
    this.connectors.set('github', new GitHubConnector());
    this.connectors.set('jira', new JiraConnector());
    this.connectors.set('confluence', new ConfluenceConnector());
  }

  private getConnector(type: string): ISourceConnector {
    const connector = this.connectors.get(type);
    if (!connector) {
      throw new BadRequestException(`Connector for ${type} is not implemented yet`);
    }
    return connector;
  }

  async findAll(): Promise<Source[]> {
    return this.sourceRepository.find({
      order: { createdAt: 'DESC' },
    });
  }

  async findOne(id: string): Promise<Source> {
    const source = await this.sourceRepository.findOne({ where: { id } });
    if (!source) {
      throw new NotFoundException(`Source with ID ${id} not found`);
    }
    return source;
  }

  async create(createSourceDto: CreateSourceDto): Promise<Source> {
    const source = this.sourceRepository.create({
      ...createSourceDto,
      status: 'disconnected',
    });
    return this.sourceRepository.save(source);
  }

  async update(id: string, updateSourceDto: UpdateSourceDto): Promise<Source> {
    const source = await this.findOne(id);

    if (updateSourceDto.config) {
      // Merge config, only update provided fields
      const newConfig = { ...source.config };
      if (updateSourceDto.config.authType) newConfig.authType = updateSourceDto.config.authType;
      if (updateSourceDto.config.token) newConfig.token = updateSourceDto.config.token;
      if (updateSourceDto.config.baseUrl) newConfig.baseUrl = updateSourceDto.config.baseUrl;
      if (updateSourceDto.config.repository) newConfig.repository = updateSourceDto.config.repository;
      if (updateSourceDto.config.project) newConfig.project = updateSourceDto.config.project;
      if (updateSourceDto.config.spaceKey) newConfig.spaceKey = updateSourceDto.config.spaceKey;
      if (updateSourceDto.config.additionalConfig) newConfig.additionalConfig = updateSourceDto.config.additionalConfig;
      if (updateSourceDto.config.oauth) {
        newConfig.oauth = {
          accessToken: updateSourceDto.config.oauth.accessToken || source.config.oauth?.accessToken || '',
          refreshToken: updateSourceDto.config.oauth.refreshToken || source.config.oauth?.refreshToken || '',
          expiresAt: updateSourceDto.config.oauth.expiresAt || source.config.oauth?.expiresAt || new Date(),
        };
      }
      source.config = newConfig;
    }
    if (updateSourceDto.name) {
      source.name = updateSourceDto.name;
    }
    if (updateSourceDto.syncMode) {
      source.syncMode = updateSourceDto.syncMode;
    }

    return this.sourceRepository.save(source);
  }

  async remove(id: string): Promise<void> {
    const source = await this.findOne(id);
    await this.sourceRepository.remove(source);
  }

  async testConnection(id: string): Promise<{ success: boolean; message: string; permissions?: string[] }> {
    const source = await this.findOne(id);
    const connector = this.getConnector(source.type);

    try {
      const result = await connector.testConnection(source.config);

      if (result.success) {
        source.status = 'connected';
        if (result.permissions) {
          source.permissions = result.permissions;
        }
        source.errorMessage = null;
      } else {
        source.status = 'error';
        source.errorMessage = result.message;
      }

      await this.sourceRepository.save(source);
      return result;
    } catch (error) {
      source.status = 'error';
      source.errorMessage = error.message;
      await this.sourceRepository.save(source);
      return { success: false, message: error.message };
    }
  }

  async triggerSync(id: string, trigger: 'manual' | 'scheduled' | 'webhook' = 'manual'): Promise<SyncJob> {
    const source = await this.findOne(id);

    if (source.status === 'syncing') {
      throw new BadRequestException('Source is already syncing');
    }

    // Create sync job with stages
    const syncJob = this.syncJobRepository.create({
      sourceId: id,
      status: 'queued',
      trigger,
      stages: SYNC_STAGES.map((name) => ({ name, status: 'pending' as const })),
    });
    await this.syncJobRepository.save(syncJob);

    // Update source status
    source.status = 'syncing';
    await this.sourceRepository.save(source);

    // Add to queue
    await this.syncQueue.add('sync-source', {
      sourceId: id,
      syncJobId: syncJob.id,
    });

    return syncJob;
  }

  async getSyncStatus(id: string): Promise<SyncJob | null> {
    const syncJob = await this.syncJobRepository.findOne({
      where: { sourceId: id },
      order: { createdAt: 'DESC' },
    });
    return syncJob;
  }

  async updateSyncJob(
    syncJobId: string,
    updates: Partial<Pick<SyncJob, 'status' | 'itemsProcessed' | 'itemsTotal' | 'errorMessage' | 'startedAt' | 'completedAt'>>,
  ): Promise<SyncJob> {
    const syncJob = await this.syncJobRepository.findOne({ where: { id: syncJobId } });
    if (!syncJob) {
      throw new NotFoundException(`SyncJob with ID ${syncJobId} not found`);
    }
    Object.assign(syncJob, updates);
    return this.syncJobRepository.save(syncJob);
  }

  async updateSourceAfterSync(
    sourceId: string,
    status: SourceStatus,
    itemsCount?: number,
    errorMessage?: string,
    syncState?: SyncState,
  ): Promise<void> {
    const source = await this.findOne(sourceId);
    source.status = status;
    if (itemsCount !== undefined) {
      source.itemsCount = itemsCount;
    }
    if (syncState) {
      source.syncState = syncState;
    }
    if (status === 'connected') {
      source.lastSync = new Date();
      source.errorMessage = null;
    } else if (errorMessage) {
      source.errorMessage = errorMessage;
    }
    await this.sourceRepository.save(source);
  }

  /**
   * Trigger incremental sync for a source
   */
  async triggerIncrementalSync(sourceId: string): Promise<SyncJob> {
    const source = await this.findOne(sourceId);

    if (source.status === 'syncing') {
      throw new BadRequestException('Sync already in progress');
    }

    // Check if source has been synced before
    if (!source.syncState?.lastSyncedAt) {
      throw new BadRequestException('No previous sync found. Run full sync first.');
    }

    // Create sync job with stages
    const syncJob = this.syncJobRepository.create({
      sourceId,
      status: 'queued',
      trigger: 'manual',
      stages: SYNC_STAGES.map((name) => ({ name, status: 'pending' as const })),
    });
    const savedJob = await this.syncJobRepository.save(syncJob);

    // Update source status
    source.status = 'syncing';
    await this.sourceRepository.save(source);

    // Queue the incremental sync job
    await this.syncQueue.add('sync-source', {
      sourceId,
      syncJobId: savedJob.id,
      incremental: true,
    });

    return savedJob;
  }

  /**
   * Configure webhook for a source
   */
  async configureWebhook(
    sourceId: string,
    webhookConfig: { enabled: boolean; secret?: string },
  ): Promise<Source> {
    const source = await this.findOne(sourceId);

    source.webhookConfig = {
      enabled: webhookConfig.enabled,
      secret: webhookConfig.secret,
      registeredAt: new Date(),
    };

    return this.sourceRepository.save(source);
  }

  /**
   * Get webhook URL for a source
   */
  getWebhookUrl(sourceId: string, sourceType: string): string {
    const baseUrl = process.env.API_URL || 'http://localhost:4000';
    return `${baseUrl}/api/webhooks/${sourceType}/${sourceId}`;
  }

  // ============ Sync Jobs List ============

  async getSyncJobs(
    sourceId?: string,
    limit = 20,
    offset = 0,
  ): Promise<{ jobs: SyncJob[]; total: number }> {
    const query = this.syncJobRepository.createQueryBuilder('job');
    query.leftJoinAndSelect('job.source', 'source');

    if (sourceId) {
      query.where('job.sourceId = :sourceId', { sourceId });
    }

    query.orderBy('job.createdAt', 'DESC');
    query.take(limit);
    query.skip(offset);

    const [jobs, total] = await query.getManyAndCount();
    return { jobs, total };
  }

  async getSyncJob(jobId: string): Promise<SyncJob> {
    const job = await this.syncJobRepository.findOne({
      where: { id: jobId },
      relations: ['source'],
    });
    if (!job) {
      throw new NotFoundException(`Sync job with ID ${jobId} not found`);
    }
    return job;
  }

  async cancelSyncJob(jobId: string): Promise<SyncJob> {
    const job = await this.getSyncJob(jobId);
    if (job.status !== 'queued' && job.status !== 'running') {
      throw new BadRequestException('Can only cancel queued or running jobs');
    }
    job.status = 'cancelled';
    job.completedAt = new Date();
    return this.syncJobRepository.save(job);
  }

  // ============ Stage Tracking ============

  async initializeJobStages(syncJobId: string): Promise<SyncJob> {
    const job = await this.getSyncJob(syncJobId);
    job.stages = SYNC_STAGES.map((name) => ({
      name,
      status: 'pending' as const,
    }));
    job.status = 'running';
    job.startedAt = new Date();
    return this.syncJobRepository.save(job);
  }

  async startStage(syncJobId: string, stageName: SyncStageName): Promise<SyncJob> {
    const job = await this.getSyncJob(syncJobId);
    const stageIndex = job.stages.findIndex((s) => s.name === stageName);
    if (stageIndex >= 0) {
      job.stages[stageIndex] = {
        ...job.stages[stageIndex],
        status: 'running',
        startedAt: new Date(),
      };
    }
    job.currentStage = stageName;
    return this.syncJobRepository.save(job);
  }

  async updateStageProgress(
    syncJobId: string,
    stageName: SyncStageName,
    itemsProcessed: number,
    itemsTotal?: number,
  ): Promise<SyncJob> {
    const job = await this.getSyncJob(syncJobId);
    const stageIndex = job.stages.findIndex((s) => s.name === stageName);
    if (stageIndex >= 0) {
      job.stages[stageIndex] = {
        ...job.stages[stageIndex],
        itemsProcessed,
        itemsTotal: itemsTotal ?? job.stages[stageIndex].itemsTotal,
      };
    }
    job.itemsProcessed = itemsProcessed;
    if (itemsTotal) job.itemsTotal = itemsTotal;
    return this.syncJobRepository.save(job);
  }

  async completeStage(syncJobId: string, stageName: SyncStageName): Promise<SyncJob> {
    const job = await this.getSyncJob(syncJobId);
    const stageIndex = job.stages.findIndex((s) => s.name === stageName);
    if (stageIndex >= 0) {
      job.stages[stageIndex] = {
        ...job.stages[stageIndex],
        status: 'completed',
        completedAt: new Date(),
      };
    }
    return this.syncJobRepository.save(job);
  }

  async failStage(syncJobId: string, stageName: SyncStageName, error: string): Promise<SyncJob> {
    const job = await this.getSyncJob(syncJobId);
    const stageIndex = job.stages.findIndex((s) => s.name === stageName);
    if (stageIndex >= 0) {
      job.stages[stageIndex] = {
        ...job.stages[stageIndex],
        status: 'failed',
        completedAt: new Date(),
        error,
      };
    }
    job.status = 'failed';
    job.errorMessage = error;
    job.completedAt = new Date();
    return this.syncJobRepository.save(job);
  }

  async completeJob(syncJobId: string, stats?: SyncJobStats): Promise<SyncJob> {
    const job = await this.getSyncJob(syncJobId);
    job.status = 'completed';
    job.completedAt = new Date();
    job.currentStage = null;
    if (stats) job.stats = stats;
    return this.syncJobRepository.save(job);
  }
}
