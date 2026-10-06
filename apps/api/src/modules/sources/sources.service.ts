import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Source, SourceStatus, SyncState } from './entities/source.entity';
import {
  SyncJob,
  SyncJobStage,
  SyncJobStats,
  SyncStageName,
  SyncJobLog,
  SYNC_STAGES,
} from './entities/sync-job.entity';
import { CreateSourceDto } from './dto/create-source.dto';
import { UpdateSourceDto } from './dto/update-source.dto';
import { GitHubConnector } from './connectors/github.connector';
import { JiraConnector } from './connectors/jira.connector';
import { ConfluenceConnector } from './connectors/confluence.connector';
import { UploadConnector, UploadedFileRef } from './connectors/upload.connector';
import { ISourceConnector } from './connectors/connector.interface';
import { PipelineStore } from '../pipeline/pipeline.store';
import { StorageService } from '../storage/storage.service';

interface UploadedFileInput {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

const returnedRow = (result: any[]) => Array.isArray(result?.[0]) ? result[0][0] : result?.[0];

const ALLOWED_UPLOAD_EXTENSIONS = new Set(['.txt', '.md', '.pdf', '.doc', '.docx']);
const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

@Injectable()
export class SourcesService {
  private readonly logger = new Logger(SourcesService.name);
  private connectors: Map<string, ISourceConnector>;

  constructor(
    @InjectRepository(Source)
    private sourceRepository: Repository<Source>,
    @InjectRepository(SyncJob)
    private syncJobRepository: Repository<SyncJob>,
    @InjectQueue('sync')
    private syncQueue: Queue,
    private eventEmitter: EventEmitter2,
    private pipeline: PipelineStore,
    private storage: StorageService,
  ) {
    this.connectors = new Map();
    this.connectors.set('github', new GitHubConnector());
    this.connectors.set('jira', new JiraConnector());
    this.connectors.set('confluence', new ConfluenceConnector());
    this.connectors.set('upload', new UploadConnector(this.storage));
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
    const originalBaseUrl = source.config?.baseUrl;
    const originalToken = source.config?.token;

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

    const saved = await this.sourceRepository.save(source);

    // Projects/spaces/repositories under the same site or account are split into
    // separate Source rows so each can sync independently, but they share one set of
    // credentials. Propagate a token/email change to every sibling row so they don't
    // keep syncing with a now-stale token. Jira/Confluence siblings share a baseUrl;
    // GitHub has no equivalent site field, so siblings are matched by the token itself.
    const hasCredentialChange = updateSourceDto.config?.token || updateSourceDto.config?.additionalConfig;
    const siblingMatch = ['jira', 'confluence'].includes(saved.type) && originalBaseUrl
      ? (candidate: Source) => candidate.config?.baseUrl === originalBaseUrl
      : saved.type === 'github' && originalToken
      ? (candidate: Source) => candidate.config?.token === originalToken
      : null;
    if (siblingMatch && hasCredentialChange) {
      const siblings = (await this.sourceRepository.find({ where: { type: saved.type } }))
        .filter(sibling => sibling.id !== saved.id && siblingMatch(sibling));
      for (const sibling of siblings) {
        const siblingConfig = { ...sibling.config };
        if (updateSourceDto.config?.token) { siblingConfig.token = updateSourceDto.config.token; siblingConfig.authType = 'token'; }
        if (updateSourceDto.config?.additionalConfig) siblingConfig.additionalConfig = updateSourceDto.config.additionalConfig;
        sibling.config = siblingConfig;
        await this.sourceRepository.save(sibling);
      }
    }

    return saved;
  }

  async remove(id: string): Promise<void> {
    const source = await this.findOne(id);
    await this.sourceRepository.remove(source);
  }

  /**
   * List repositories visible to a connected source's credentials, so the UI can
   * offer a picker instead of a manual "owner/repo" field.
   */
  async listRepositories(id: string) {
    const source = await this.findOne(id);
    const connector = this.getConnector(source.type);
    if (!connector.listRepositories) {
      throw new BadRequestException(`Listing repositories is not supported for ${source.type}`);
    }
    return connector.listRepositories(source.config);
  }

  /**
   * Add another repository under the same connection's credentials, without
   * repeating the OAuth/token setup flow.
   */
  async addRepository(id: string, repository: string, name?: string): Promise<Source> {
    const existing = await this.findOne(id);
    if (existing.type !== 'github') {
      throw new BadRequestException('Only GitHub connections support adding additional repositories');
    }
    if (!repository || !repository.includes('/')) {
      throw new BadRequestException('Invalid repository format. Expected "owner/repo"');
    }

    const githubSources = await this.sourceRepository.find({ where: { type: 'github' } });
    if (githubSources.some((source) => source.config?.repository === repository)) {
      throw new BadRequestException(`${repository} is already connected`);
    }

    const source = this.sourceRepository.create({
      name: name?.trim() || `GitHub - ${repository}`,
      type: 'github',
      config: { ...existing.config, repository },
      status: 'disconnected',
      syncMode: existing.syncMode,
    });
    return this.sourceRepository.save(source);
  }

  /**
   * List Jira projects visible to a connected source's credentials, so the UI can
   * offer a picker instead of a manual project key field.
   */
  async listProjects(id: string) {
    const source = await this.findOne(id);
    const connector = this.getConnector(source.type);
    if (!connector.listProjects) {
      throw new BadRequestException(`Listing projects is not supported for ${source.type}`);
    }
    return connector.listProjects(source.config);
  }

  /**
   * Add another Jira project under the same connection's credentials, without
   * repeating the setup flow. Mirrors addRepository: a new connection row sharing
   * the same credentials, scoped to a different project.
   */
  async addProject(id: string, project: string, name?: string): Promise<Source> {
    const existing = await this.findOne(id);
    if (existing.type !== 'jira') {
      throw new BadRequestException('Only Jira connections support adding additional projects');
    }
    if (!project) {
      throw new BadRequestException('Project key is required');
    }

    const jiraSources = await this.sourceRepository.find({ where: { type: 'jira' } });
    if (jiraSources.some((source) => source.config?.project === project && source.config?.baseUrl === existing.config?.baseUrl)) {
      throw new BadRequestException(`${project} is already connected`);
    }

    const source = this.sourceRepository.create({
      name: name?.trim() || `Jira - ${project}`,
      type: 'jira',
      config: { ...existing.config, project },
      status: 'disconnected',
      syncMode: existing.syncMode,
    });
    return this.sourceRepository.save(source);
  }

  /**
   * List Confluence spaces visible to a connected source's credentials, so the UI can
   * offer a picker instead of a manual space key field.
   */
  async listSpaces(id: string) {
    const source = await this.findOne(id);
    const connector = this.getConnector(source.type);
    if (!connector.listSpaces) {
      throw new BadRequestException(`Listing spaces is not supported for ${source.type}`);
    }
    return connector.listSpaces(source.config);
  }

  /**
   * Add another Confluence space under the same connection's credentials, without
   * repeating the setup flow. Mirrors addRepository: a new connection row sharing
   * the same credentials, scoped to a different space.
   */
  async addSpace(id: string, spaceKey: string, name?: string): Promise<Source> {
    const existing = await this.findOne(id);
    if (existing.type !== 'confluence') {
      throw new BadRequestException('Only Confluence connections support adding additional spaces');
    }
    if (!spaceKey) {
      throw new BadRequestException('Space key is required');
    }

    const confluenceSources = await this.sourceRepository.find({ where: { type: 'confluence' } });
    if (confluenceSources.some((source) => source.config?.spaceKey === spaceKey && source.config?.baseUrl === existing.config?.baseUrl)) {
      throw new BadRequestException(`${spaceKey} is already connected`);
    }

    const source = this.sourceRepository.create({
      name: name?.trim() || `Confluence - ${spaceKey}`,
      type: 'confluence',
      config: { ...existing.config, spaceKey },
      status: 'disconnected',
      syncMode: existing.syncMode,
    });
    return this.sourceRepository.save(source);
  }

  /**
   * Store uploaded files in blob storage and attach them to an "upload" source's config.
   * Mirrors addRepository/addProject/addSpace: a connection-scoped mutation the UI can repeat
   * (upload more files later) without re-running any setup flow — there's none to repeat here.
   */
  async attachFiles(id: string, files: UploadedFileInput[]): Promise<Source> {
    const source = await this.findOne(id);
    if (source.type !== 'upload') {
      throw new BadRequestException('Only "Upload from computer" connections accept file uploads');
    }
    if (!files?.length) {
      throw new BadRequestException('Select at least one file to upload');
    }

    const uploaded: UploadedFileRef[] = [];
    for (const file of files) {
      const extension = (file.originalname.match(/\.[a-zA-Z0-9]+$/)?.[0] || '').toLowerCase();
      if (!ALLOWED_UPLOAD_EXTENSIONS.has(extension)) {
        throw new BadRequestException(`${file.originalname}: only .txt, .md, .pdf, .doc, and .docx files are supported`);
      }
      if (file.size > MAX_UPLOAD_BYTES) {
        throw new BadRequestException(`${file.originalname} is larger than the 25MB limit`);
      }
      const stored = await this.storage.uploadBuffer(file.buffer, file.originalname, {
        sourceId: id,
        originalName: file.originalname,
        contentType: file.mimetype,
      });
      uploaded.push({
        key: stored.key,
        filename: file.originalname,
        mimeType: file.mimetype,
        size: file.size,
        uploadedAt: new Date().toISOString(),
      });
    }

    const existingFiles = (source.config.additionalConfig?.files as UploadedFileRef[] | undefined) || [];
    source.config = {
      ...source.config,
      additionalConfig: { ...source.config.additionalConfig, files: [...existingFiles, ...uploaded] },
    };
    source.status = 'connected';
    return this.sourceRepository.save(source);
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

  async previewDocuments(id: string, maxDocuments: number = 100) {
    const source = await this.findOne(id);
    const connector = this.getConnector(source.type);

    const allDocuments = [];
    let cursor: string | undefined;
    let hasMore = true;

    // Fetch documents in batches until we reach maxDocuments
    while (hasMore && allDocuments.length < maxDocuments) {
      const result = await connector.fetchDocuments(source.config, { cursor });

      allDocuments.push(...result.documents);
      hasMore = result.hasMore;
      cursor = result.cursor;

      // Stop if we have enough
      if (allDocuments.length >= maxDocuments) {
        break;
      }
    }

    // Return only up to maxDocuments
    return allDocuments.slice(0, maxDocuments);
  }

  async triggerSync(
    id: string,
    trigger: 'manual' | 'scheduled' | 'webhook' = 'manual',
    config?: { mode?: 'incremental' | 'full' | 'selective'; externalIds?: string[]; intents?: string[]; forceReprocess?: boolean; forceExtract?: boolean },
  ): Promise<SyncJob> {
    return this.pipeline.start(id, config, trigger);
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
    updates: Partial<Pick<SyncJob, 'status' | 'itemsProcessed' | 'itemsTotal' | 'errorMessage' | 'startedAt' | 'completedAt' | 'stages'>>,
  ): Promise<SyncJob> {
    // Verify job exists
    const exists = await this.syncJobRepository.findOne({ where: { id: syncJobId } });
    if (!exists) {
      throw new NotFoundException(`SyncJob with ID ${syncJobId} not found`);
    }

    // Use QueryBuilder to only update specified fields, preserving metadata
    await this.syncJobRepository
      .createQueryBuilder()
      .update()
      .set(updates)
      .where('id = :id', { id: syncJobId })
      .execute();

    return this.getSyncJob(syncJobId);
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
    return this.pipeline.start(sourceId, { mode: 'incremental' });
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
    if (job.pipelineVersion === 1) return this.pipeline.cancel(jobId);
    if (job.status !== 'queued' && job.status !== 'running') {
      throw new BadRequestException('Can only cancel queued or running jobs');
    }

    // Log cancellation
    const currentStage = job.currentStage;
    await this.addLog(jobId, 'warn', 'Sync job cancelled by user', currentStage || undefined);

    // Fail current stage if one is running
    if (currentStage) {
      await this.failStage(jobId, currentStage, 'Cancelled by user');

      // Mark remaining stages as skipped
      const allStages = SYNC_STAGES;
      const currentStageIndex = allStages.indexOf(currentStage);

      for (let i = currentStageIndex + 1; i < allStages.length; i++) {
        const stageIndex = job.stages.findIndex(s => s.name === allStages[i]);
        if (stageIndex >= 0 && job.stages[stageIndex].status === 'pending') {
          job.stages[stageIndex] = {
            ...job.stages[stageIndex],
            status: 'skipped',
          };
        }
      }
    }

    job.status = 'cancelled';
    job.completedAt = new Date();
    const result = await this.syncJobRepository.save(job);

    // Emit job cancel event for SSE
    this.eventEmitter.emit('job.cancel', {
      jobId: result.id,
      sourceId: result.sourceId,
      data: {
        status: result.status,
        currentStage: result.currentStage,
        stages: result.stages,
        completedAt: result.completedAt,
      },
    });

    return result;
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

  async startStage(
    syncJobId: string,
    stageName: SyncStageName,
    metadata?: Record<string, any>,
  ): Promise<SyncJob> {
    // Load fresh job from database
    const job = await this.syncJobRepository.findOne({
      where: { id: syncJobId },
      relations: ['source'],
    });
    if (!job) {
      throw new NotFoundException(`Sync job with ID ${syncJobId} not found`);
    }

    const stageIndex = job.stages.findIndex((s) => s.name === stageName);
    if (stageIndex >= 0) {
      job.stages[stageIndex] = {
        ...job.stages[stageIndex],
        status: 'running',
        startedAt: new Date(),
        ...(metadata && { metadata }),
      };
    }
    job.currentStage = stageName;

    // Use raw query to only update specific fields, preserving metadata
    await this.syncJobRepository
      .createQueryBuilder()
      .update()
      .set({
        currentStage: job.currentStage,
        stages: job.stages,
      })
      .where('id = :id', { id: syncJobId })
      .execute();

    // Return fresh entity
    const result = await this.syncJobRepository.findOne({
      where: { id: syncJobId },
      relations: ['source'],
    });
    if (!result) {
      throw new NotFoundException(`Sync job with ID ${syncJobId} not found`);
    }

    // Emit stage start event for SSE
    this.eventEmitter.emit('job.stage.start', {
      jobId: syncJobId,
      sourceId: result.sourceId,
      stage: stageName,
      data: {
        status: result.status,
        currentStage: result.currentStage,
        stages: result.stages,
      },
    });

    return result;
  }

  async updateStageProgress(
    syncJobId: string,
    stageName: SyncStageName,
    itemsProcessed: number,
    itemsTotal?: number,
  ): Promise<SyncJob> {
    const startTime = Date.now();
    this.logger.debug(`      ├─ DB Query [1/3]: Finding sync job ${syncJobId.slice(0, 8)}...`);

    const job = await this.syncJobRepository.findOne({
      where: { id: syncJobId },
      relations: ['source'],
    });

    const findElapsed = Date.now() - startTime;
    this.logger.debug(`      ├─ DB Query [1/3]: Found in ${findElapsed}ms`);

    if (!job) {
      throw new NotFoundException(`Sync job with ID ${syncJobId} not found`);
    }

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

    // Use query builder to only update specific fields
    const updateData: any = {
      stages: job.stages,
      itemsProcessed: job.itemsProcessed,
    };
    if (itemsTotal) {
      updateData.itemsTotal = itemsTotal;
    }

    const updateStartTime = Date.now();
    this.logger.debug(`      ├─ DB Update [2/3]: Updating progress (${stageName}: ${itemsProcessed}/${itemsTotal || '?'})...`);

    await this.syncJobRepository
      .createQueryBuilder()
      .update()
      .set(updateData)
      .where('id = :id', { id: syncJobId })
      .execute();

    const updateElapsed = Date.now() - updateStartTime;
    this.logger.debug(`      ├─ DB Update [2/3]: Updated in ${updateElapsed}ms`);

    // Return the updated job object we already have instead of refetching
    // This saves a DB query (was causing 30-50% of the time)
    this.logger.debug(`      └─ Total: ${Date.now() - startTime}ms (saved 1 refetch query)`);

    // Emit progress event for SSE
    this.eventEmitter.emit('job.progress', {
      jobId: syncJobId,
      sourceId: job.sourceId,
      stage: stageName,
      data: {
        status: job.status,
        currentStage: job.currentStage,
        stages: job.stages,
        itemsProcessed: job.itemsProcessed,
        itemsTotal: job.itemsTotal,
      },
    });

    return job;
  }

  async completeStage(syncJobId: string, stageName: SyncStageName): Promise<SyncJob> {
    const startTime = Date.now();
    this.logger.debug(`      ├─ DB Query [1/2]: Finding sync job ${syncJobId.slice(0, 8)} to complete stage "${stageName}"...`);

    const job = await this.syncJobRepository.findOne({
      where: { id: syncJobId },
      relations: ['source'],
    });

    const findElapsed = Date.now() - startTime;
    this.logger.debug(`      ├─ DB Query [1/2]: Found in ${findElapsed}ms`);

    if (!job) {
      throw new NotFoundException(`Sync job with ID ${syncJobId} not found`);
    }

    const stageIndex = job.stages.findIndex((s) => s.name === stageName);
    if (stageIndex >= 0) {
      job.stages[stageIndex] = {
        ...job.stages[stageIndex],
        status: 'completed',
        completedAt: new Date(),
      };
    }

    // Use query builder to only update stages field
    const updateStartTime = Date.now();
    this.logger.debug(`      ├─ DB Update [2/2]: Completing stage "${stageName}"...`);

    await this.syncJobRepository
      .createQueryBuilder()
      .update()
      .set({ stages: job.stages })
      .where('id = :id', { id: syncJobId })
      .execute();

    const updateElapsed = Date.now() - updateStartTime;
    this.logger.debug(`      └─ Total: ${Date.now() - startTime}ms (saved 1 refetch query)`);

    // Return fresh instance to avoid potential stale data issues
    const result = await this.syncJobRepository.findOne({
      where: { id: syncJobId },
      relations: ['source'],
    }) as SyncJob;

    // Emit stage complete event for SSE
    this.eventEmitter.emit('job.stage.complete', {
      jobId: syncJobId,
      sourceId: result.sourceId,
      stage: stageName,
      data: {
        status: result.status,
        currentStage: result.currentStage,
        stages: result.stages,
      },
    });

    return result;
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
    const result = await this.syncJobRepository.save(job);

    // Emit stage fail event for SSE
    this.eventEmitter.emit('job.stage.fail', {
      jobId: syncJobId,
      sourceId: result.sourceId,
      stage: stageName,
      data: {
        status: result.status,
        currentStage: result.currentStage,
        stages: result.stages,
        errorMessage: result.errorMessage,
      },
    });

    return result;
  }

  async completeJob(syncJobId: string, stats?: SyncJobStats): Promise<SyncJob> {
    const updateData: any = {
      status: 'completed',
      completedAt: new Date(),
      currentStage: null,
    };
    if (stats) {
      updateData.stats = stats;
    }

    // Use QueryBuilder to only update specific fields, preserving metadata
    await this.syncJobRepository
      .createQueryBuilder()
      .update()
      .set(updateData)
      .where('id = :id', { id: syncJobId })
      .execute();

    const result = await this.getSyncJob(syncJobId);

    // Emit job complete event for SSE
    this.eventEmitter.emit('job.complete', {
      jobId: syncJobId,
      sourceId: result.sourceId,
      data: {
        status: result.status,
        currentStage: result.currentStage,
        stages: result.stages,
        stats: result.stats,
        completedAt: result.completedAt,
      },
    });

    return result;
  }

  async setSyncJobMetadata(syncJobId: string, metadata: Record<string, any>): Promise<void> {
    const job = await this.getSyncJob(syncJobId);
    job.metadata = metadata;
    await this.syncJobRepository.save(job);
  }

  /**
   * Set metadata and complete a stage in a single atomic operation
   * This prevents save() race conditions that can overwrite metadata
   */
  async setMetadataAndCompleteStage(
    syncJobId: string,
    metadata: Record<string, any>,
    stageName: SyncStageName,
  ): Promise<void> {
    const job = await this.getSyncJob(syncJobId);
    job.metadata = metadata;

    const stageIndex = job.stages.findIndex((s) => s.name === stageName);
    if (stageIndex >= 0) {
      job.stages[stageIndex] = {
        ...job.stages[stageIndex],
        status: 'completed',
        completedAt: new Date(),
      };
    }

    // Use QueryBuilder to only update metadata and stages fields
    await this.syncJobRepository
      .createQueryBuilder()
      .update()
      .set({
        metadata: job.metadata,
        stages: job.stages
      })
      .where('id = :id', { id: syncJobId })
      .execute();
  }

  async getSyncJobMetadata(syncJobId: string): Promise<Record<string, any> | null> {
    const job = await this.getSyncJob(syncJobId);
    return (job as any).metadata || null;
  }

  async getLastSyncJob(sourceId: string): Promise<SyncJob | null> {
    return this.syncJobRepository.findOne({
      where: { sourceId },
      order: { createdAt: 'DESC' },
    });
  }

  /**
   * Atomically increment documentsProcessed counter
   */
  async incrementDocumentsProcessed(syncJobId: string): Promise<{ documentsProcessed: number; documentsToProcess: number } | null> {
    const startTime = Date.now();
    this.logger.debug(`      ├─ DB SQL: Atomic counter increment for job ${syncJobId.slice(0, 8)}...`);

    // Use raw SQL for atomic JSONB update
    const result = await this.syncJobRepository.query(
      `UPDATE sync_jobs
       SET metadata = jsonb_set(
         COALESCE(metadata, '{}'::jsonb),
         '{documentsProcessed}',
         to_jsonb(COALESCE((metadata->>'documentsProcessed')::int, 0) + 1)
       )
       WHERE id = $1
       RETURNING metadata`,
      [syncJobId]
    );
    const row = returnedRow(result);

    const elapsed = Date.now() - startTime;
    this.logger.debug(`      └─ DB SQL: Incremented in ${elapsed}ms`);

    if (!row?.metadata) {
      this.logger.error(`Failed to increment documentsProcessed for sync job ${syncJobId}: No metadata returned`);
      return null;
    }

    const metadata = row.metadata;
    if (!metadata.documentsToProcess) {
      this.logger.warn(`documentsToProcess not set in metadata for sync job ${syncJobId}`);
    }

    return {
      documentsProcessed: metadata.documentsProcessed || 0,
      documentsToProcess: metadata.documentsToProcess || 0,
    };
  }

  /**
   * Atomically increment documentsExtracted counter
   */
  async incrementDocumentsExtracted(syncJobId: string): Promise<{ documentsExtracted: number; documentsToProcess: number } | null> {
    const result = await this.syncJobRepository.query(
      `UPDATE sync_jobs
       SET metadata = jsonb_set(
         COALESCE(metadata, '{}'::jsonb),
         '{documentsExtracted}',
         to_jsonb(COALESCE((metadata->>'documentsExtracted')::int, 0) + 1)
       )
       WHERE id = $1
       RETURNING metadata`,
      [syncJobId]
    );
    const row = returnedRow(result);

    if (!row?.metadata) {
      console.error(`Failed to increment documentsExtracted for sync job ${syncJobId}: No metadata returned`);
      return null;
    }

    const metadata = row.metadata;
    return {
      documentsExtracted: metadata.documentsExtracted || 0,
      documentsToProcess: metadata.documentsToProcess || 0,
    };
  }

  /**
   * Atomically increment documentsPopulated and businessItemsExtracted counters
   */
  async incrementDocumentsPopulated(syncJobId: string, itemsSaved: number): Promise<{ documentsPopulated: number; businessItemsExtracted: number; documentsToProcess: number } | null> {
    const result = await this.syncJobRepository.query(
      `UPDATE sync_jobs
       SET metadata = jsonb_set(
         jsonb_set(
           COALESCE(metadata, '{}'::jsonb),
           '{documentsPopulated}',
           to_jsonb(COALESCE((metadata->>'documentsPopulated')::int, 0) + 1)
         ),
         '{businessItemsExtracted}',
         to_jsonb(COALESCE((metadata->>'businessItemsExtracted')::int, 0) + $2)
       )
       WHERE id = $1
       RETURNING metadata`,
      [syncJobId, itemsSaved]
    );
    const row = returnedRow(result);

    if (!row?.metadata) {
      console.error(`Failed to increment documentsPopulated for sync job ${syncJobId}: No metadata returned`);
      return null;
    }

    const metadata = row.metadata;
    return {
      documentsPopulated: metadata.documentsPopulated || 0,
      businessItemsExtracted: metadata.businessItemsExtracted || 0,
      documentsToProcess: metadata.documentsToProcess || 0,
    };
  }

  /**
   * Append a log entry to a sync job
   */
  async addLog(
    syncJobId: string,
    level: 'info' | 'warn' | 'error' | 'debug',
    message: string,
    stage?: SyncStageName,
  ): Promise<void> {
    const startTime = Date.now();
    const log: SyncJobLog = {
      timestamp: new Date().toISOString(),
      level,
      message,
      ...(stage && { stage }),
    };

    this.logger.debug(`      ├─ DB SQL: Appending ${level} log...`);

    await this.syncJobRepository.query(
      `UPDATE sync_jobs
       SET logs = COALESCE(logs, '[]'::jsonb) || $2::jsonb
       WHERE id = $1`,
      [syncJobId, JSON.stringify(log)]
    );

    const elapsed = Date.now() - startTime;
    this.logger.debug(`      └─ DB SQL: Logged in ${elapsed}ms`);

    // Get sourceId for event emission
    const job = await this.syncJobRepository.findOne({ where: { id: syncJobId }, select: ['sourceId'] });
    if (job) {
      // Emit log event for SSE
      this.eventEmitter.emit('job.log', {
        jobId: syncJobId,
        sourceId: job.sourceId,
        log,
      });
    }
  }

  /**
   * Get logs for a specific sync job and optionally filter by stage
   */
  async getLogs(syncJobId: string, stage?: SyncStageName): Promise<SyncJobLog[]> {
    const job = await this.getSyncJob(syncJobId);
    if (!job.logs) return [];

    if (stage) {
      return job.logs.filter((log) => log.stage === stage);
    }

    return job.logs;
  }
}
