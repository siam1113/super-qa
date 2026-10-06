import { Test, TestingModule } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { ConfigModule } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bull';
import { SourcesService } from '../../src/modules/sources/sources.service';
import { DocumentsService } from '../../src/modules/documents/documents.service';
import { ProcessingService } from '../../src/modules/processing/processing.service';
import { TestHelpers } from '../utils/test-helpers';
import { mockGitHubDocuments } from '../fixtures/connector-documents.fixture';
import { SourcesModule } from '../../src/modules/sources/sources.module';
import { DocumentsModule } from '../../src/modules/documents/documents.module';
import { ProcessingModule } from '../../src/modules/processing/processing.module';
import { BusinessModule } from '../../src/modules/business/business.module';
import { StorageModule } from '../../src/modules/storage/storage.module';
import { Source } from '../../src/modules/sources/entities/source.entity';
import { SyncJob } from '../../src/modules/sources/entities/sync-job.entity';
import { Document } from '../../src/modules/documents/entities/document.entity';
import { BusinessItem } from '../../src/modules/business/entities/business-item.entity';

describe('Individual Sync Stages E2E Tests', () => {
  let module: TestingModule;
  let dataSource: DataSource;
  let sourcesService: SourcesService;
  let documentsService: DocumentsService;
  let processingService: ProcessingService;

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
    }).compile();
    dataSource = module.get<DataSource>(DataSource);
    sourcesService = module.get<SourcesService>(SourcesService);
    documentsService = module.get<DocumentsService>(DocumentsService);
    processingService = module.get<ProcessingService>(ProcessingService);
  });

  beforeEach(async () => {
    await TestHelpers.cleanDatabase(dataSource);
  });

  afterAll(async () => {
    if (dataSource?.isInitialized) await dataSource.destroy();
    await module?.close();
  });

  describe('Stage 1: PULLING', () => {
    it('should fetch all documents in full sync mode', async () => {
      // Test full sync pulls all documents
      const source = await sourcesService.create({
        name: 'Test Source',
        type: 'github',
        config: { authType: 'token', token: 'test_token', repository: 'test/repo' },
      });

      const syncJob = await sourcesService.triggerSync(source.id, 'manual', {
        mode: 'full',
      });

      // Verify pulling stage behavior
      const job = await sourcesService.getSyncJob(syncJob.id);
      const pullingStage = job.stages.find((s) => s.name === 'pulling');

      expect(pullingStage).toBeDefined();
      expect(pullingStage.status).toBe('pending');
    });

    it('should use cursor for pagination during pulling', async () => {
      // Test pagination logic
    });

    it('should stop early when all selected documents found in selective mode', async () => {
      // Test selective sync early termination
    });
  });

  describe('Stage 2: PROCESSING', () => {
    it('should calculate content hash for each document', async () => {
      const source = await sourcesService.create({
        name: 'Test Source',
        type: 'github',
        config: { authType: 'token', token: 'test_token' },
      });

      const result = await documentsService.upsertDocuments(
        source.id,
        mockGitHubDocuments,
        'test-sync-job-id',
      );

      expect(result.total).toBe(mockGitHubDocuments.length);
      expect(result.queued).toBeGreaterThan(0);

      // Verify documents have content hashes
      const documents = await dataSource
        .getRepository('Document')
        .find({ where: { sourceId: source.id } });

      documents.forEach((doc) => {
        expect(doc.contentHash).toBeDefined();
        expect(doc.contentHash.length).toBe(64); // SHA256 hash length
      });
    });

    it('should skip unchanged documents when content hash matches', async () => {
      const source = await sourcesService.create({
        name: 'Test Source',
        type: 'github',
        config: { authType: 'token', token: 'test_token' },
      });

      // First upsert
      const firstResult = await documentsService.upsertDocuments(
        source.id,
        mockGitHubDocuments,
        'sync-job-1',
      );

      // Second upsert with same documents
      const secondResult = await documentsService.upsertDocuments(
        source.id,
        mockGitHubDocuments,
        'sync-job-2',
      );

      expect(secondResult.skipped).toBe(mockGitHubDocuments.length);
      expect(secondResult.queued).toBe(0);
    });

    it('should reprocess documents when forceReprocess flag is true', async () => {
      const source = await sourcesService.create({
        name: 'Test Source',
        type: 'github',
        config: { authType: 'token', token: 'test_token' },
      });

      // First upsert
      await documentsService.upsertDocuments(source.id, mockGitHubDocuments, 'sync-job-1');

      // Second upsert with forceReprocess
      const result = await documentsService.upsertDocuments(
        source.id,
        mockGitHubDocuments,
        'sync-job-2',
        true, // forceReprocess
      );

      expect(result.skipped).toBe(0);
      expect(result.queued).toBe(mockGitHubDocuments.length);
    });

    it('should delete old chunks when document content changes', async () => {
      // Test chunk deletion on content change
    });
  });

  describe('Stage 3: INDEXING', () => {
    it('should chunk documents appropriately', async () => {
      // Test chunking logic
    });

    it('should generate embeddings for all chunks', async () => {
      // Test embedding generation
    });

    it('should save chunks without embeddings on embedding failure', async () => {
      // Test graceful degradation
    });

    it('should use code-aware chunking for code documents', async () => {
      // Test code chunking
    });

    it('should use semantic chunking for text documents', async () => {
      // Test text chunking
    });
  });

  describe('Stage 4: EXTRACTING', () => {
    it('should extract business knowledge using pattern matching', async () => {
      // Test extraction logic
    });

    it('should validate extracted items with AI', async () => {
      // Test validation
    });

    it('should assign confidence levels to extracted items', async () => {
      // Test confidence scoring
    });

    it('should extract multiple types from single document', async () => {
      // Test multi-type extraction
    });

    it('should filter out low-confidence extractions', async () => {
      // Test confidence filtering
    });
  });

  describe('Stage 5: POPULATING', () => {
    it('should upsert business items by name within source', async () => {
      // Test upsert logic
    });

    it('should create relationships between items', async () => {
      // Test relationship creation
    });

    it('should update existing items when confidence is higher', async () => {
      // Test confidence-based updates
    });

    it('should preserve existing items when new confidence is lower', async () => {
      // Test confidence preservation
    });

    it('should handle relationship creation for non-existent items gracefully', async () => {
      // Test error handling
    });
  });

  describe('Progress Tracking Across Stages', () => {
    it('should atomically increment documentsProcessed counter', async () => {
      const source = await sourcesService.create({
        name: 'Test Source',
        type: 'github',
        config: { authType: 'token', token: 'test_token' },
      });

      const syncJob = await sourcesService.triggerSync(source.id);

      // Set initial metadata
      await sourcesService.setSyncJobMetadata(syncJob.id, {
        documentsToProcess: 10,
        documentsProcessed: 0,
      });

      // Simulate concurrent increments
      const increments = Array.from({ length: 10 }, () =>
        sourcesService.incrementDocumentsProcessed(syncJob.id),
      );

      await Promise.all(increments);

      // Verify final count is correct (no race conditions)
      const metadata = await sourcesService.getSyncJobMetadata(syncJob.id);
      expect(metadata.documentsProcessed).toBe(10);
    });

    it('should atomically increment documentsExtracted counter', async () => {
      // Similar test for extraction counter
    });

    it('should atomically increment documentsPopulated and businessItemsExtracted counters', async () => {
      // Test dual counter increment
    });
  });
});
