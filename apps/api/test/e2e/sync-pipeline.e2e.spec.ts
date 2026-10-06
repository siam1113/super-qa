import { Test, TestingModule } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule, getQueueToken } from '@nestjs/bull';
import { ConfigModule } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { Queue } from 'bull';
import { SourcesService } from '../../src/modules/sources/sources.service';
import { SourcesModule } from '../../src/modules/sources/sources.module';
import { DocumentsModule } from '../../src/modules/documents/documents.module';
import { ProcessingModule } from '../../src/modules/processing/processing.module';
import { BusinessModule } from '../../src/modules/business/business.module';
import { BusinessService } from '../../src/modules/business/business.service';
import { StorageModule } from '../../src/modules/storage/storage.module';
import { SyncProcessor } from '../../src/modules/sources/sync.processor';
import { ProcessingProcessor } from '../../src/modules/processing/processing.processor';
import { EmbeddingService } from '../../src/modules/processing/embedding.service';
import { BusinessExtractionService } from '../../src/modules/business/business-extraction.service';
import { Source } from '../../src/modules/sources/entities/source.entity';
import { SyncJob } from '../../src/modules/sources/entities/sync-job.entity';
import { Document } from '../../src/modules/documents/entities/document.entity';
import { BusinessItem } from '../../src/modules/business/entities/business-item.entity';
import { TestHelpers } from '../utils/test-helpers';
import { MockGitHubConnector, MockJiraConnector, MockConfluenceConnector } from '../mocks/connector.mock';
import { MockEmbeddingService } from '../mocks/embedding.mock';
import { MockBusinessExtractionService } from '../mocks/business-extraction.mock';

describe('Sync Pipeline E2E Tests', () => {
  let module: TestingModule;
  let dataSource: DataSource;
  let sourcesService: SourcesService;
  let syncProcessor: SyncProcessor;
  let processingProcessor: ProcessingProcessor;
  let syncQueue: Queue;
  let processingQueue: Queue;

  beforeAll(async () => {
    module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true }),
        EventEmitterModule.forRoot(),
        TestHelpers.createTestDatabaseConfig(),
        TestHelpers.createTestQueueConfig(),
        BullModule.registerQueue({ name: 'sync' }),
        BullModule.registerQueue({ name: 'processing' }),
        TypeOrmModule.forFeature([Source, SyncJob, Document, BusinessItem]),
        SourcesModule,
        DocumentsModule,
        ProcessingModule,
        BusinessModule,
        StorageModule,
      ],
    })
      .overrideProvider('GitHubConnector')
      .useClass(MockGitHubConnector)
      .overrideProvider('JiraConnector')
      .useClass(MockJiraConnector)
      .overrideProvider('ConfluenceConnector')
      .useClass(MockConfluenceConnector)
      .overrideProvider(EmbeddingService)
      .useClass(MockEmbeddingService)
      .overrideProvider(BusinessExtractionService)
      .useClass(MockBusinessExtractionService)
      .compile();

    dataSource = module.get<DataSource>(DataSource);
    sourcesService = module.get<SourcesService>(SourcesService);
    (module.get(BusinessExtractionService) as unknown as MockBusinessExtractionService).setBusinessService(module.get(BusinessService));
    syncProcessor = module.get<SyncProcessor>(SyncProcessor);
    processingProcessor = module.get<ProcessingProcessor>(ProcessingProcessor);
    syncQueue = module.get<Queue>(getQueueToken('sync'));
    processingQueue = module.get<Queue>(getQueueToken('processing'));
  });

  beforeEach(async () => {
    // Clean database before each test
    await TestHelpers.cleanDatabase(dataSource);
    // Clean queues
    await syncQueue.empty();
    await processingQueue.empty();
  });

  async function processQueuedDocuments(): Promise<void> {
    while (true) {
      const waiting = await processingQueue.getJobs(['waiting']);
      if (!waiting.length) return;
      for (const job of waiting) {
        await processingProcessor.handleProcessDocument(job as any);
        await job.remove();
      }
    }
  }

  async function processSync(data: Record<string, unknown>): Promise<void> {
    await syncProcessor.handleSync({ data } as any);
    await processQueuedDocuments();
  }

  afterAll(async () => {
    await syncQueue?.close();
    await processingQueue?.close();
    if (dataSource?.isInitialized) await dataSource.destroy();
    await module?.close();
  });

  describe('Full Sync Pipeline (All 5 Stages)', () => {
    it('should complete a full sync successfully from GitHub source', async () => {
      // ARRANGE: Create a GitHub source
      const source = await sourcesService.create({
        name: 'Test GitHub Repo',
        type: 'github',
        config: {
          authType: 'token',
          token: 'test_token',
          baseUrl: 'https://api.github.com',
          repository: 'test/repo',
        },
      });

      // ACT: Trigger sync
      const syncJob = await sourcesService.triggerSync(source.id, 'manual', {
        mode: 'full',
      });

      // Manually process the sync job (simulate queue processing)
      await processSync({ sourceId: source.id, syncJobId: syncJob.id, mode: 'full' });

      // Wait for all stages to complete
      await TestHelpers.waitFor(async () => {
        const job = await sourcesService.getSyncJob(syncJob.id);
        return job.status === 'completed';
      }, 30000);

      // ASSERT: Verify sync job completed
      const completedJob = await sourcesService.getSyncJob(syncJob.id);
      expect(completedJob.status).toBe('completed');
      expect(completedJob.completedAt).toBeDefined();

      // ASSERT: Verify all 5 stages completed
      const stages = completedJob.stages;
      expect(stages).toHaveLength(5);
      expect(stages.find((s) => s.name === 'pulling')?.status).toBe('completed');
      expect(stages.find((s) => s.name === 'processing')?.status).toBe('completed');
      expect(stages.find((s) => s.name === 'indexing')?.status).toBe('completed');
      expect(stages.find((s) => s.name === 'extracting')?.status).toBe('completed');
      expect(stages.find((s) => s.name === 'populating')?.status).toBe('completed');

      // ASSERT: Verify documents were created
      const sourceWithDocs = await dataSource
        .getRepository(Source)
        .findOne({ where: { id: source.id }, relations: ['documents'] });
      expect(sourceWithDocs.documents.length).toBeGreaterThan(0);

      // ASSERT: Verify source status updated
      expect(sourceWithDocs.status).toBe('connected');
      expect(sourceWithDocs.lastSync).toBeDefined();
    });

    it('should handle incremental sync correctly', async () => {
      // ARRANGE: Create source and run initial full sync
      const source = await sourcesService.create({
        name: 'Test GitHub Repo',
        type: 'github',
        config: {
          authType: 'token',
          token: 'test_token',
          repository: 'test/repo',
        },
      });

      const initialSync = await sourcesService.triggerSync(source.id, 'manual', {
        mode: 'full',
      });

      await processSync({ sourceId: source.id, syncJobId: initialSync.id, mode: 'full' });

      await TestHelpers.waitFor(async () => {
        const job = await sourcesService.getSyncJob(initialSync.id);
        return job.status === 'completed';
      });

      // Update source with sync state
      await dataSource.getRepository(Source).update(source.id, {
        syncState: { lastSyncedAt: new Date(), lastCursor: '0' },
      } as any);

      // ACT: Trigger incremental sync
      const incrementalSync = await sourcesService.triggerSync(source.id, 'manual', {
        mode: 'incremental',
      });

      await processSync({ sourceId: source.id, syncJobId: incrementalSync.id, mode: 'incremental' });

      await TestHelpers.waitFor(async () => {
        const job = await sourcesService.getSyncJob(incrementalSync.id);
        return job.status === 'completed';
      });

      // ASSERT: Verify incremental sync completed
      const completedIncremental = await sourcesService.getSyncJob(incrementalSync.id);
      expect(completedIncremental.status).toBe('completed');
      expect(completedIncremental.stages.every((s) => s.status === 'completed')).toBe(true);
    });

    it('should handle selective sync with specific externalIds', async () => {
      // ARRANGE
      const source = await sourcesService.create({
        name: 'Test GitHub Repo',
        type: 'github',
        config: {
          authType: 'token',
          token: 'test_token',
          repository: 'test/repo',
        },
      });

      // ACT: Trigger selective sync for specific documents
      const syncJob = await sourcesService.triggerSync(source.id, 'manual', {
        mode: 'selective',
        externalIds: ['issue-1', 'pr-2'],
      });

      await processSync({ sourceId: source.id, syncJobId: syncJob.id, mode: 'selective', externalIds: ['issue-1', 'pr-2'] });

      await TestHelpers.waitFor(async () => {
        const job = await sourcesService.getSyncJob(syncJob.id);
        return job.status === 'completed';
      });

      // ASSERT: Verify only selected documents were synced
      const documents = await dataSource
        .getRepository(Document)
        .find({ where: { sourceId: source.id } });

      expect(documents.length).toBeLessThanOrEqual(2);
      const externalIds = documents.map((d) => d.externalId);
      expect(externalIds).toEqual(expect.arrayContaining(['issue-1', 'pr-2']));
    });
  });

  describe('Stage-by-Stage Verification', () => {
    it('should complete PULLING stage and fetch documents from connector', async () => {
      // ARRANGE
      const source = await sourcesService.create({
        name: 'Test Jira Project',
        type: 'jira',
        config: {
          authType: 'token',
          token: 'test_token',
          email: 'test@example.com',
          baseUrl: 'https://test.atlassian.net',
        },
      });

      const syncJob = await sourcesService.triggerSync(source.id);

      // ACT: Process sync
      await processSync({ sourceId: source.id, syncJobId: syncJob.id });

      // ASSERT: Verify pulling stage completed
      const job = await sourcesService.getSyncJob(syncJob.id);
      const pullingStage = job.stages.find((s) => s.name === 'pulling');
      expect(pullingStage.status).toBe('completed');
      expect(pullingStage.completedAt).toBeDefined();
    });

    it('should complete PROCESSING stage and create/update documents', async () => {
      // Similar test for processing stage
    });

    it('should complete INDEXING stage and generate embeddings', async () => {
      // Test for indexing stage
    });

    it('should complete EXTRACTING stage and extract business knowledge', async () => {
      // Test for extracting stage
    });

    it('should complete POPULATING stage and save business items', async () => {
      // Test for populating stage
    });
  });

  describe('Error Handling and Recovery', () => {
    it('should fail sync job when connector returns error', async () => {
      // ARRANGE: Create source with invalid credentials
      const source = await sourcesService.create({
        name: 'Invalid Source',
        type: 'github',
        config: {
          authType: 'token',
          token: '', // Empty token to trigger error
        },
      });

      const syncJob = await sourcesService.triggerSync(source.id);

      // ACT & ASSERT: Expect sync to fail
      const connector = module.get<any>('GitHubConnector');
      jest.spyOn(connector, 'fetchDocuments').mockRejectedValueOnce(new Error('Bad credentials'));
      await expect(syncProcessor.handleSync({ data: { sourceId: source.id, syncJobId: syncJob.id } } as any)).rejects.toThrow('Bad credentials');

      const failedJob = await sourcesService.getSyncJob(syncJob.id);
      expect(failedJob.status).toBe('failed');
      expect(failedJob.errorMessage).toBeDefined();
    });

    it('should handle forceReprocess flag correctly', async () => {
      // ARRANGE: Create source and sync once
      const source = await sourcesService.create({
        name: 'Test Source',
        type: 'github',
        config: {
          authType: 'token',
          token: 'test_token',
          repository: 'test/repo',
        },
      });

      const firstSync = await sourcesService.triggerSync(source.id);
      await processSync({ sourceId: source.id, syncJobId: firstSync.id });

      await TestHelpers.waitFor(async () => {
        const job = await sourcesService.getSyncJob(firstSync.id);
        return job.status === 'completed';
      });

      // ACT: Sync again with forceReprocess
      const secondSync = await sourcesService.triggerSync(source.id, 'manual', {
        mode: 'full',
        forceReprocess: true,
      });

      await processSync({ sourceId: source.id, syncJobId: secondSync.id, forceReprocess: true });

      await TestHelpers.waitFor(async () => {
        const job = await sourcesService.getSyncJob(secondSync.id);
        return job.status === 'completed';
      });

      // ASSERT: Verify all documents were reprocessed
      const job = await sourcesService.getSyncJob(secondSync.id);
      expect(job.status).toBe('completed');
      // With forceReprocess, no documents should be skipped
      expect(job.stats.documentsTotal).toBeGreaterThan(0);
    });
  });

  describe('Progress Tracking', () => {
    it('should update stage progress correctly throughout sync', async () => {
      // Test progress tracking
    });

    it('should atomically increment counters to avoid race conditions', async () => {
      // Test atomic operations
    });
  });

  describe('Multi-Source Sync', () => {
    it('should handle syncing multiple sources concurrently', async () => {
      // ARRANGE: Create multiple sources
      const githubSource = await sourcesService.create({
        name: 'GitHub Source',
        type: 'github',
        config: { authType: 'token', token: 'test_token', repository: 'test/repo' },
      });

      const jiraSource = await sourcesService.create({
        name: 'Jira Source',
        type: 'jira',
        config: {
          authType: 'token',
          token: 'test_token',
          email: 'test@example.com',
        },
      });

      const confluenceSource = await sourcesService.create({
        name: 'Confluence Source',
        type: 'confluence',
        config: {
          authType: 'token',
          token: 'test_token',
          email: 'test@example.com',
        },
      });

      // ACT: Trigger syncs for all sources
      const [githubSync, jiraSync, confluenceSync] = await Promise.all([
        sourcesService.triggerSync(githubSource.id),
        sourcesService.triggerSync(jiraSource.id),
        sourcesService.triggerSync(confluenceSource.id),
      ]);

      // Process all syncs
      await Promise.all([
        syncProcessor.handleSync({
          data: { sourceId: githubSource.id, syncJobId: githubSync.id },
        } as any),
        syncProcessor.handleSync({
          data: { sourceId: jiraSource.id, syncJobId: jiraSync.id },
        } as any),
        syncProcessor.handleSync({
          data: { sourceId: confluenceSource.id, syncJobId: confluenceSync.id },
        } as any),
      ]);
      await processQueuedDocuments();

      // ASSERT: Verify all completed successfully
      const jobs = await Promise.all([
        sourcesService.getSyncJob(githubSync.id),
        sourcesService.getSyncJob(jiraSync.id),
        sourcesService.getSyncJob(confluenceSync.id),
      ]);

      jobs.forEach((job) => {
        expect(job.status).toBe('completed');
        expect(job.stages.every((s) => s.status === 'completed')).toBe(true);
      });
    });
  });

  describe('Business Knowledge Extraction', () => {
    it('should extract flows, rules, entities, and APIs from documents', async () => {
      // ARRANGE
      const source = await sourcesService.create({
        name: 'Knowledge Source',
        type: 'github',
        config: {
          authType: 'token',
          token: 'test_token',
          repository: 'test/repo',
        },
      });

      // ACT
      const syncJob = await sourcesService.triggerSync(source.id);
      await processSync({ sourceId: source.id, syncJobId: syncJob.id });

      await TestHelpers.waitFor(async () => {
        const job = await sourcesService.getSyncJob(syncJob.id);
        return job.status === 'completed';
      });

      // ASSERT: Verify business items were extracted
      const businessItems = await dataSource
        .getRepository(BusinessItem)
        .find({ where: { sourceId: source.id } });

      expect(businessItems.length).toBeGreaterThan(0);

      // Verify different types were extracted
      const types = new Set(businessItems.map((item) => item.type));
      expect(types.size).toBeGreaterThan(1); // Should have multiple types

      // Check for specific types based on mock data
      const hasFlow = businessItems.some((item) => item.type === 'flow');
      const hasRule = businessItems.some((item) => item.type === 'rule');
      const hasEntity = businessItems.some((item) => item.type === 'entity');
      const hasApi = businessItems.some((item) => item.type === 'api');

      expect(hasFlow || hasRule || hasEntity || hasApi).toBe(true);
    });

    it('should create relationships between extracted items', async () => {
      // Test relationship creation
    });
  });

  describe('Content Hashing and Deduplication', () => {
    it('should skip unchanged documents on subsequent syncs', async () => {
      // Test content hash deduplication
    });

    it('should update documents when content changes', async () => {
      // Test document updates
    });
  });
});
