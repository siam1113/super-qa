import { DataSource } from 'typeorm';
import { QaModule } from '../../src/modules/qa/qa.module';
import { QaTestCase, QaRun, QaExecution, QaHealingSuggestion } from '../../src/modules/qa/qa.entity';
import { EventEmitter2 } from '@nestjs/event-emitter';
import Queue from 'bull';
import { PipelineStore, LeaseLostError } from '../../src/modules/pipeline/pipeline.store';
import { WorkerWakeupService } from '../../src/common/worker-wakeup.service';
import { PipelineService } from '../../src/modules/pipeline/pipeline.service';
import { SyncWork } from '../../src/modules/pipeline/entities/sync-work.entity';
import { Source } from '../../src/modules/sources/entities/source.entity';
import { SyncJob } from '../../src/modules/sources/entities/sync-job.entity';
import { Document } from '../../src/modules/documents/entities/document.entity';
import { Chunk } from '../../src/modules/documents/entities/chunk.entity';
import { BusinessItem, BusinessRelationship } from '../../src/modules/business/entities/business-item.entity';
import { ChunkingService } from '../../src/modules/processing/chunking.service';
import { ConnectorDocument } from '../../src/modules/sources/connectors/connector.interface';
import { GitHubConnector } from '../../src/modules/sources/connectors/github.connector';
import { Test } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bull';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { SourcesModule } from '../../src/modules/sources/sources.module';
import { SourcesService } from '../../src/modules/sources/sources.service';
import { StorageModule } from '../../src/modules/storage/storage.module';
import { StorageService } from '../../src/modules/storage/storage.service';
import { GraphService } from '../../src/modules/graph/graph.service';
import { ExtractionProviderFactory } from '../../src/modules/business/extraction-providers';
import { EmbeddingService } from '../../src/modules/processing/embedding.service';
import { BusinessExtractionService } from '../../src/modules/business/business-extraction.service';
import { readFileSync } from 'fs';
import { join } from 'path';
import { assertExtractionEvidence, extractGrounded } from '../../src/modules/business/grounded-extraction';
import { LocalExtractionProvider } from '../../src/modules/business/extraction-providers/local-extraction.provider';
import { RetrievalModule } from '../../src/modules/retrieval/retrieval.module';
import request from 'supertest';
import { execFile } from 'child_process';
import { promisify } from 'util';

describe('Durable pipeline with isolated PostgreSQL and Redis', () => {
  let database: DataSource;
  let queue: Queue.Queue;
  let store: PipelineStore;
  let source: Source;
  const document: ConnectorDocument = { externalId: 'issue-1', title: 'Login', content: 'Password required', type: 'issue' };

  beforeAll(async () => {
    database = new DataSource({
      type: 'postgres', host: '127.0.0.1', port: 55432, username: 'pipeline_test', password: 'pipeline_test', database: 'pipeline_test',
      entities: [Source, SyncJob, SyncWork, Document, Chunk, BusinessItem, BusinessRelationship, QaTestCase, QaRun, QaExecution, QaHealingSuggestion], synchronize: true,
    });
    await database.initialize();
    queue = new Queue('pipeline-recovery-test', { redis: { host: '127.0.0.1', port: 56379 }, defaultJobOptions: { removeOnComplete: true, removeOnFail: true } });
    await queue.isReady();
  });

  beforeEach(async () => {
    await database.query('TRUNCATE sync_work, chunks, business_relationships, business_items, documents, sync_jobs, sources CASCADE');
    store = new PipelineStore(database, new EventEmitter2(), new WorkerWakeupService());
    source = await database.getRepository(Source).save({ name: 'Isolated test source', type: 'github', config: { authType: 'token' }, status: 'connected' });
  });

  afterEach(() => jest.restoreAllMocks());
  afterAll(async () => { await queue?.close(); if (database?.isInitialized) await database.destroy(); });

  function worker(embeddings = { embed: jest.fn().mockResolvedValue([[1, 0]]), getDimension: () => 2 }, extraction = { extractFromDocument: jest.fn().mockResolvedValue({ items: [], relationships: [] }) }) {
    return new PipelineService(store, queue, database.getRepository(Source), new ChunkingService(), embeddings as any, extraction as any);
  }

  async function start(request = {}) {
    const job = await store.start(source.id, request);
    const [delivery] = await store.claim();
    await store.begin(job.id, delivery.token);
    return { job, token: delivery.token };
  }

  async function ready(jobId: string, token: string, snapshots = [document]) {
    await store.saveManifest(jobId, token, snapshots);
    const work = await store.work(jobId);
    for (const row of work) {
      await store.saveOutput(jobId, token, row.id, { chunks: [{ content: row.snapshot.content, index: 0, embedding: [1, 0] }] });
      await store.saveOutput(jobId, token, row.id, { extraction: { items: [], relationships: [] } });
    }
    return work;
  }

  async function expire(jobId: string) {
    await database.getRepository(SyncJob).update(jobId, { leaseUntil: new Date(0), nextAttemptAt: new Date(0) });
  }

  it('serializes concurrent sync admission for a source', async () => {
    const results = await Promise.allSettled([store.start(source.id), store.start(source.id)]);
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(await database.getRepository(SyncJob).count()).toBe(1);
  });

  it('applies the production SQL migration twice to a legacy schema', async () => {
    const runner = database.createQueryRunner();
    await runner.connect();
    try {
      await runner.query('CREATE SCHEMA pipeline_migration_test');
      await runner.query('SET search_path TO pipeline_migration_test');
      await runner.query('CREATE TABLE sync_jobs (id uuid PRIMARY KEY, status varchar); CREATE TABLE documents (id uuid PRIMARY KEY)');
      const migration = readFileSync(join(__dirname, '../../migrations/20260927-durable-sync-pipeline.sql'), 'utf8');
      await runner.query(migration);
      await runner.query(migration);
      await runner.query('SELECT "pipelineVersion", "leaseToken", "nextAttemptAt" FROM sync_jobs');
      await runner.query('SELECT "processedHash" FROM documents');
      await runner.query('SELECT snapshot, chunks, extraction FROM sync_work');
    } finally {
      await runner.query('ROLLBACK');
      await runner.query('SET search_path TO public');
      await runner.query('DROP SCHEMA pipeline_migration_test CASCADE');
      await runner.release();
    }
  });

  it('recovers persisted admission after a process restart and fences stale delivery', async () => {
    const job = await store.start(source.id);
    const [oldDelivery] = await store.claim();
    await expire(job.id);
    const restarted = new PipelineStore(database, new EventEmitter2(), new WorkerWakeupService());
    const [newDelivery] = await restarted.claim();
    expect(newDelivery.token).not.toBe(oldDelivery.token);
    await expect(store.begin(job.id, oldDelivery.token)).rejects.toBeInstanceOf(LeaseLostError);
    expect(await restarted.begin(job.id, newDelivery.token)).toBe(true);
    expect(await restarted.begin(job.id, newDelivery.token)).toBe(false);
  });

  it('records idempotent stage receipts and publishes chunks only once', async () => {
    const { job, token } = await start();
    const [work] = await ready(job.id, token);
    await store.saveOutput(job.id, token, work.id, { chunks: [] });
    expect((await store.read(job.id)).metadata?.documentsProcessed).toBe(1);
    expect(await database.getRepository(Chunk).count()).toBe(0);
    await store.publish(job.id, token);
    await expect(store.publish(job.id, token)).rejects.toBeInstanceOf(LeaseLostError);
    expect(await database.getRepository(Chunk).count()).toBe(1);
    const completedSource = await database.getRepository(Source).findOneByOrFail({ id: source.id });
    expect(completedSource.status).toBe('connected');
    expect(new Date(completedSource.syncState!.lastSyncedAt!).getTime()).toBe((await store.read(job.id)).startedAt!.getTime());
  });

  it('cancels durably and rejects late receipts and publication', async () => {
    const { job, token } = await start();
    const [work] = await ready(job.id, token);
    await store.cancel(job.id);
    await expect(store.saveOutput(job.id, token, work.id, { chunks: [] })).rejects.toBeInstanceOf(LeaseLostError);
    await expect(store.publish(job.id, token)).rejects.toBeInstanceOf(LeaseLostError);
    expect(await database.getRepository(Document).count()).toBe(0);
    expect((await store.read(job.id)).status).toBe('cancelled');
    expect(await store.claim()).toEqual([]);
    expect((await database.getRepository(Source).findOneByOrFail({ id: source.id })).syncState).toBeNull();
  });

  it('does not advance the source watermark for selective sync', async () => {
    const previous = new Date('2026-01-01T00:00:00Z');
    await database.getRepository(Source).update(source.id, { syncState: { lastSyncedAt: previous } });
    const { job, token } = await start({ mode: 'selective', externalIds: ['issue-1'] });
    await ready(job.id, token);
    await store.publish(job.id, token);
    expect(new Date((await database.getRepository(Source).findOneByOrFail({ id: source.id })).syncState!.lastSyncedAt!)).toEqual(previous);
  });

  it('skips only a successfully published matching revision and notices title changes', async () => {
    const first = await start();
    await ready(first.job.id, first.token);
    await store.publish(first.job.id, first.token);
    const unchanged = await start();
    await store.saveManifest(unchanged.job.id, unchanged.token, [document]);
    expect(await store.work(unchanged.job.id)).toHaveLength(0);
    await store.publish(unchanged.job.id, unchanged.token);
    const changed = await start();
    await store.saveManifest(changed.job.id, changed.token, [{ ...document, title: 'Updated title' }]);
    expect(await store.work(changed.job.id)).toHaveLength(1);
  });

  it('rolls back document and chunk writes if knowledge publication fails', async () => {
    const { job, token } = await start();
    await store.saveManifest(job.id, token, [document]);
    const [work] = await store.work(job.id);
    await store.saveOutput(job.id, token, work.id, { chunks: [{ content: 'text', index: 0, embedding: [1, 0] }] });
    await database.getRepository(SyncWork).update(work.id, { extraction: { items: [{ type: 'fact', name: null } as any], relationships: [] } });
    await expect(store.publish(job.id, token)).rejects.toThrow();
    expect(await database.getRepository(Document).count()).toBe(0);
    expect(await database.getRepository(Chunk).count()).toBe(0);
    expect((await store.read(job.id)).status).toBe('running');
  });

  it('bounds retries and leaves the watermark unchanged on terminal failure', async () => {
    const { job, token } = await start();
    let currentToken = token;
    for (let attempt = 0; attempt < 3; attempt++) {
      await store.retry(job.id, currentToken, new Error('provider unavailable'));
      if (attempt < 2) {
        expect(await store.claim()).toHaveLength(0);
        await expire(job.id);
        const [delivery] = await store.claim();
        currentToken = delivery.token;
        await store.begin(job.id, currentToken);
      }
    }
    expect((await store.read(job.id)).status).toBe('failed');
    expect(await store.claim()).toHaveLength(0);
    const failedSource = await database.getRepository(Source).findOneByOrFail({ id: source.id });
    expect(failedSource.status).toBe('error');
    expect(failedSource.syncState).toBeNull();
  });

  it('keeps the last published revision readable when replacement is cancelled', async () => {
    const first = await start();
    await ready(first.job.id, first.token);
    await store.publish(first.job.id, first.token);
    const replacement = await start();
    await ready(replacement.job.id, replacement.token, [{ ...document, content: 'New requirement' }]);
    await store.cancel(replacement.job.id);
    expect((await database.getRepository(Document).findOneByOrFail({ externalId: document.externalId })).content).toBe(document.content);
    expect((await database.getRepository(Chunk).find())[0].content).toBe(document.content);
  });

  it('rejects a stale worker after another worker reclaims its lease', async () => {
    const { job, token } = await start();
    const [work] = await ready(job.id, token);
    await expire(job.id);
    const [replacement] = await store.claim();
    await store.begin(job.id, replacement.token);
    await expect(store.saveOutput(job.id, token, work.id, { extraction: { items: [], relationships: [] } })).rejects.toBeInstanceOf(LeaseLostError);
    await expect(store.publish(job.id, token)).rejects.toBeInstanceOf(LeaseLostError);
    await store.publish(job.id, replacement.token);
    expect((await store.read(job.id)).status).toBe('completed');
  });

  it('does not skip a document whose prior sync failed before publication', async () => {
    const first = await start();
    await ready(first.job.id, first.token);
    await store.cancel(first.job.id);
    const second = await start();
    await store.saveManifest(second.job.id, second.token, [document]);
    expect(await store.work(second.job.id)).toHaveLength(1);
  });

  it('invalidates successful document cache when the processor version changes', async () => {
    const first = await start();
    await ready(first.job.id, first.token);
    await store.publish(first.job.id, first.token);
    const previousVersion = process.env.PIPELINE_PROCESSOR_VERSION;
    try {
      process.env.PIPELINE_PROCESSOR_VERSION = 'integration-test-next';
      const next = await start();
      await store.saveManifest(next.job.id, next.token, [document]);
      expect(await store.work(next.job.id)).toHaveLength(1);
    } finally {
      if (previousVersion === undefined) delete process.env.PIPELINE_PROCESSOR_VERSION;
      else process.env.PIPELINE_PROCESSOR_VERSION = previousVersion;
    }
  });

  it('publishes knowledge and chunks idempotently on a forced reprocess', async () => {
    const snapshot = { ...document, content: 'Rule: Users must provide a password.\nFact: Session timeout = 30 minutes' };
    for (let attempt = 0; attempt < 2; attempt++) {
      const { job, token } = await start({ forceReprocess: true });
      await store.saveManifest(job.id, token, [snapshot]);
      const [work] = await store.work(job.id);
      await store.saveOutput(job.id, token, work.id, { chunks: [{ content: 'text', index: 0, embedding: [1, 0] }] });
      await store.saveOutput(job.id, token, work.id, { extraction: await extractGrounded({
        id: work.documentId, sourceId: source.id, content: snapshot.content, revisionHash: work.revisionHash,
      }, new LocalExtractionProvider()) });
      await store.publish(job.id, token);
      expect((await store.read(job.id)).metadata!.extractionSummary).toMatchObject({ accepted: 2, providerCalls: 0, usageComplete: true });
    }
    expect(await database.getRepository(Document).count()).toBe(1);
    expect(await database.getRepository(Chunk).count()).toBe(1);
    expect(await database.getRepository(BusinessItem).count()).toBe(2);
    expect(await database.getRepository(BusinessRelationship).count()).toBe(0);
  });

  it('rejects forged receipts and replaces stale proposals without overwriting reviewed knowledge', async () => {
    const snapshot = { ...document, content: 'Rule: Users must provide a password.\nFact: Session timeout = 30 minutes' };
    const first = await start();
    await store.saveManifest(first.job.id, first.token, [snapshot]);
    const [work] = await store.work(first.job.id);
    await store.saveOutput(first.job.id, first.token, work.id, { chunks: [] });
    const extraction = await extractGrounded({ id: work.documentId, sourceId: source.id, content: snapshot.content, revisionHash: work.revisionHash }, new LocalExtractionProvider());
    const forged = JSON.parse(JSON.stringify(extraction));
    forged.items[0].metadata.evidence[0].sourceId = 'another-source';
    await expect(store.saveOutput(first.job.id, first.token, work.id, { extraction: forged })).rejects.toThrow('evidence');
    await store.saveOutput(first.job.id, first.token, work.id, { extraction });
    await store.publish(first.job.id, first.token);
    const reviewed = await database.getRepository(BusinessItem).findOneByOrFail({ type: 'rule' });
    await database.getRepository(BusinessItem).update(reviewed.id, { verificationStatus: 'verified' });
    const next = await start();
    await ready(next.job.id, next.token, [{ ...snapshot, content: 'No supported statements remain.' }]);
    await store.publish(next.job.id, next.token);
    expect(await database.getRepository(BusinessItem).count()).toBe(1);
    const preserved = await database.getRepository(BusinessItem).findOneByOrFail({ id: reviewed.id });
    expect(preserved.verificationStatus).toBe('verified');
    expect(preserved.metadata!.evidenceStatus).toBe('needs-review');
    expect(preserved.metadata!.evidence).toEqual(reviewed.metadata!.evidence);
  });

  it('rejects an empty selective request and a missing selected document', async () => {
    await expect(store.start(source.id, { mode: 'selective', externalIds: [] })).rejects.toThrow('requires');
    jest.spyOn(GitHubConnector.prototype, 'fetchDocuments').mockResolvedValue({ documents: [document], hasMore: false });
    const job = await store.start(source.id, { mode: 'selective', externalIds: ['missing'] });
    const [delivery] = await store.claim();
    await worker().execute({ data: delivery } as any);
    expect((await store.read(job.id)).errorMessage).toMatch('selected documents');
    expect(await database.getRepository(Document).count()).toBe(0);
  });

  it('does not overwrite a manual item with the same extracted identity', async () => {
    const first = await start();
    const [initial] = await ready(first.job.id, first.token);
    await store.publish(first.job.id, first.token);
    const manual = await database.getRepository(BusinessItem).save({
      sourceId: source.id, documentId: initial.documentId, type: 'rule', name: 'Users must log in.',
      description: 'Manually curated explanation', tags: [], verificationStatus: 'unverified',
    });
    const next = await start();
    const snapshot = { ...document, content: 'Rule: Users must log in.' };
    await store.saveManifest(next.job.id, next.token, [snapshot]);
    const [work] = await store.work(next.job.id);
    await store.saveOutput(next.job.id, next.token, work.id, { chunks: [] });
    await store.saveOutput(next.job.id, next.token, work.id, { extraction: await extractGrounded({
      id: work.documentId, sourceId: source.id, content: snapshot.content, revisionHash: work.revisionHash,
    }, new LocalExtractionProvider()) });
    await store.publish(next.job.id, next.token);
    expect((await database.getRepository(BusinessItem).findOneByOrFail({ id: manual.id })).description).toBe('Manually curated explanation');
    expect((await store.read(next.job.id)).metadata!.preservedManualItems).toBe(1);
  });

  it('publishes real section extraction through the worker and preserves nested evidence in JSONB', async () => {
    const snapshot = { ...document, content: 'Users must sign in.\n\nFlow: Purchase\n1. Select\n2. Pay\n\nScenario: Declined\nGiven a cart\nWhen payment fails\nThen no order exists' };
    const job = await store.start(source.id, { documents: [snapshot] });
    const [delivery] = await store.claim();
    const extraction = new BusinessExtractionService({} as any, { getProvider: () => new LocalExtractionProvider() } as any);
    const processor = new PipelineService(store, queue, database.getRepository(Source), new ChunkingService(),
      { embed: jest.fn().mockResolvedValue([[1, 0]]), getDimension: () => 2 } as any, extraction);
    await processor.execute({ data: delivery } as any);
    expect((await store.read(job.id)).status).toBe('completed');
    const items = await database.getRepository(BusinessItem).find();
    expect(items.map(item => item.type).sort()).toEqual(['flow', 'requirement', 'test_case']);
    expect(items.every(item => item.verificationStatus === 'unverified' && item.confidence === 'inferred')).toBe(true);
    const [work] = await store.work(job.id);
    expect(() => assertExtractionEvidence(work.extraction!, {
      id: work.documentId, sourceId: source.id, content: snapshot.content, revisionHash: work.revisionHash,
    })).not.toThrow();
    expect(items.find(item => item.type === 'test_case')!.metadata!.evidence[0].fields.some((field: any) => field.path === '/content/steps/0/expected')).toBe(true);
  });

  it.each(['field-span', 'expected-outcome'])('rejects corrupted nested %s at publication after a receipt round trip', async corruption => {
    const snapshot = { ...document, content: 'Scenario: Declined\nGiven a cart\nWhen payment fails\nThen no order exists' };
    const { job, token } = await start();
    await store.saveManifest(job.id, token, [snapshot]);
    const [work] = await store.work(job.id);
    await store.saveOutput(job.id, token, work.id, { chunks: [] });
    await store.saveOutput(job.id, token, work.id, { extraction: await extractGrounded({
      id: work.documentId, sourceId: source.id, content: snapshot.content, revisionHash: work.revisionHash,
    }, new LocalExtractionProvider()) });
    const [receipt] = await store.work(job.id);
    const item = receipt.extraction!.items[0];
    if (corruption === 'field-span') item.metadata!.evidence[0].fields[0].start++;
    else (item.content as any).steps[0].expected = 'An order exists';
    await database.getRepository(SyncWork).update(work.id, { extraction: receipt.extraction });
    await expect(store.publish(job.id, token)).rejects.toThrow('evidence');
    expect(await database.getRepository(Document).count()).toBe(0);
    expect(await database.getRepository(BusinessItem).count()).toBe(0);
    expect((await store.read(job.id)).status).toBe('running');
  });

  it('fails a repeated pagination cursor instead of looping or silently truncating', async () => {
    const fetch = jest.spyOn(GitHubConnector.prototype, 'fetchDocuments').mockResolvedValue({ documents: [document], hasMore: true, cursor: 'same' });
    const job = await store.start(source.id);
    const [delivery] = await store.claim();
    await worker().execute({ data: delivery } as any);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect((await store.read(job.id)).errorMessage).toMatch('pagination');
  });

  it('rejects malformed embeddings before saving a receipt', async () => {
    const job = await store.start(source.id, { documents: [document] });
    const [delivery] = await store.claim();
    await worker({ embed: jest.fn().mockResolvedValue([[0, 0]]), getDimension: () => 2 }).execute({ data: delivery } as any);
    expect((await store.work(job.id))[0].chunks).toBeNull();
    expect((await store.read(job.id)).errorMessage).toMatch('invalid vectors');
  });

  it('discards a provider result that returns after cancellation', async () => {
    const job = await store.start(source.id, { documents: [document] });
    const [delivery] = await store.claim();
    const embeddings = { embed: jest.fn(async () => { await store.cancel(job.id); return [[1, 0]]; }), getDimension: () => 2 };
    await worker(embeddings).execute({ data: delivery } as any);
    expect((await store.read(job.id)).status).toBe('cancelled');
    expect((await store.work(job.id))[0].chunks).toBeNull();
    expect(await database.getRepository(Document).count()).toBe(0);
  });

  it('recovers an admitted job when the first queue dispatch fails', async () => {
    const job = await store.start(source.id, { documents: [document] });
    const unavailableQueue = { add: jest.fn().mockRejectedValue(new Error('Redis unavailable')) };
    const dispatcher = new PipelineService(store, unavailableQueue as any, database.getRepository(Source), new ChunkingService(), {} as any, {} as any);
    await dispatcher.dispatch();
    expect((await store.read(job.id)).status).toBe('queued');
    expect((await store.read(job.id)).attempts).toBe(0);
    await expire(job.id);
    const [redelivery] = await new PipelineStore(database, new EventEmitter2(), new WorkerWakeupService()).claim();
    expect(redelivery.jobId).toBe(job.id);
  });

  it('wires the real source module to durable admission and cancellation', async () => {
    const module = await Test.createTestingModule({ imports: [
      ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }),
      EventEmitterModule.forRoot(),
      TypeOrmModule.forRoot({
        type: 'postgres', host: '127.0.0.1', port: 55432, username: 'pipeline_test', password: 'pipeline_test', database: 'pipeline_test',
        entities: [Source, SyncJob, SyncWork, Document, Chunk, BusinessItem, BusinessRelationship],
      }),
      BullModule.forRoot({ redis: { host: '127.0.0.1', port: 56379 } }), SourcesModule, StorageModule,
    ] }).overrideProvider(GraphService).useValue({})
      .overrideProvider(StorageService).useValue({})
      .overrideProvider(EmbeddingService).useValue({ embed: async () => [[1, 0]], getDimension: () => 2 })
      .overrideProvider(BusinessExtractionService).useValue({ extractFromDocument: async () => ({ items: [], relationships: [] }) })
      .overrideProvider(ExtractionProviderFactory).useValue({ getProvider: () => ({ getName: () => 'test' }) }).compile();
    try {
      await module.init();
      const sources = module.get(SourcesService);
      const job = await sources.triggerSync(source.id);
      expect(job.pipelineVersion).toBe(1);
      expect(job.status).toBe('queued');
      expect((await sources.cancelSyncJob(job.id)).status).toBe('cancelled');
      jest.spyOn(GitHubConnector.prototype, 'fetchDocuments').mockResolvedValue({ documents: [document], hasMore: false });
      const next = await sources.triggerSync(source.id);
      await module.get(PipelineService).dispatch();
      const deadline = Date.now() + 6000;
      while ((await store.read(next.id)).status !== 'completed' && Date.now() < deadline) {
        await new Promise(resolve => setTimeout(resolve, 25));
      }
      expect((await store.read(next.id)).status).toBe('completed');
      expect(await database.getRepository(Chunk).count()).toBe(1);
    } finally {
      await module.close();
    }
  });

  it('resumes an indexed document through real Redis without embedding it again', async () => {
    const { job, token } = await start({ documents: [document] });
    await store.saveManifest(job.id, token, [document]);
    const [work] = await store.work(job.id);
    await store.saveOutput(job.id, token, work.id, { chunks: [{ content: 'text', index: 0, embedding: [1, 0] }] });
    await expire(job.id);
    const embeddings = { embed: jest.fn(), getDimension: () => 2 };
    const extraction = { extractFromDocument: jest.fn().mockResolvedValue({ items: [], relationships: [] }) };
    const restarted = new PipelineStore(database, new EventEmitter2(), new WorkerWakeupService());
    const worker = new PipelineService(restarted, queue, database.getRepository(Source), new ChunkingService(), embeddings as any, extraction as any);
    queue.process('run-sync', async delivery => worker.execute(delivery));
    await worker.dispatch();
    const deadline = Date.now() + 5000;
    while ((await restarted.read(job.id)).status !== 'completed' && Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    expect((await restarted.read(job.id)).status).toBe('completed');
    expect(embeddings.embed).not.toHaveBeenCalled();
    expect(extraction.extractFromDocument).toHaveBeenCalledTimes(1);
    expect(await database.getRepository(Chunk).count()).toBe(1);
  });

  it('runs HTTP sync -> Redis worker -> PostgreSQL evidence -> scoped HTTP retrieval -> Python agent tool', async () => {
    const snapshot = { ...document, content: 'Users must log in.\n\nScenario: Login\nGiven an active account\nWhen valid credentials are entered\nThen access is granted' };
    jest.spyOn(GitHubConnector.prototype, 'fetchDocuments').mockResolvedValue({ documents: [snapshot], hasMore: false });
    const module = await Test.createTestingModule({ imports: [
      ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }), EventEmitterModule.forRoot(),
      TypeOrmModule.forRoot({ type: 'postgres', host: '127.0.0.1', port: 55432, username: 'pipeline_test', password: 'pipeline_test', database: 'pipeline_test',
        entities: [Source, SyncJob, SyncWork, Document, Chunk, BusinessItem, BusinessRelationship, QaTestCase, QaRun, QaExecution, QaHealingSuggestion] }),
      BullModule.forRoot({ redis: { host: '127.0.0.1', port: 56379 } }), SourcesModule, StorageModule, RetrievalModule, QaModule,
    ] }).overrideProvider(GraphService).useValue({})
      .overrideProvider(StorageService).useValue({})
      .overrideProvider(EmbeddingService).useValue({ embed: async (texts: string[]) => texts.map(() => [1, 0]), embedOne: async () => [1, 0], getDimension: () => 2 })
      .overrideProvider(ExtractionProviderFactory).useValue({ getProvider: () => new LocalExtractionProvider() }).compile();
    const app = module.createNestApplication();
    app.setGlobalPrefix('api');
    try {
      await app.listen(0, '127.0.0.1');
      const server = app.getHttpServer();
      const sync = await request(server).post(`/api/sources/${source.id}/sync`).send({ mode: 'full' }).expect(201);
      await module.get(PipelineService).dispatch();
      const deadline = Date.now() + 8000;
      while ((await store.read(sync.body.syncJobId)).status !== 'completed' && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 25));
      expect((await store.read(sync.body.syncJobId)).status).toBe('completed');
      expect(await database.getRepository(BusinessItem).count()).toBe(2);
      const proposal = await database.getRepository(BusinessItem).findOneByOrFail({ type: 'test_case', sourceId: source.id });
      const imported = await request(server).post(`/api/qa/test-cases/import/${proposal.id}`).send({}).expect(201);
      expect(imported.body.preconditions).toEqual(['an active account']);
      await request(server).post(`/api/qa/test-cases/${imported.body.id}/review`).send({ revision: 1, status: 'approved', reviewer: 'e2e-reviewer' }).expect(201);
      const manualRun = await request(server).post('/api/qa/runs').send({ testIds: [imported.body.id] }).expect(201);
      await request(server).post(`/api/qa/executions/${manualRun.body.executions[0].id}/result`).send({ reporter: 'e2e-operator', duration: 10,
        steps: imported.body.steps.map(() => ({ actual: 'Access granted in manual observation', passed: true, evidence: 'e2e-controlled-observation' })) }).expect(201);
      const recorded = await request(server).get(`/api/qa/runs/${manualRun.body.id}`).expect(200);
      expect(recorded.body.status).toBe('completed');
      expect(recorded.body.executions[0].status).toBe('passed');
      const other = await database.getRepository(Source).save({ name: 'Excluded source', type: 'github', config: { authType: 'token' }, status: 'connected' });
      const foreign = await database.getRepository(Document).save({ sourceId: other.id, externalId: 'foreign', title: 'Excluded', type: 'issue', content: 'Forbidden text', contentHash: 'b'.repeat(64), processedHash: 'a'.repeat(64) });
      for (let index = 0; index < 20; index++) await database.getRepository(Chunk).save({ documentId: foreign.id, chunkIndex: index, content: 'Forbidden text', embedding: [1, 0], metadata: { revisionHash: foreign.processedHash } });
      await request(server).post('/api/retrieval/query').send({ query: 'login' }).expect(400);
      await request(server).post('/api/retrieval/query').send({ query: 'login', sourceIds: [] }).expect(400);
      const filtered = await request(server).post('/api/retrieval/search').send({ query: 'login', sourceIds: [source.id], documentTypes: ['issue'], limit: 1 }).expect(201);
      expect(filtered.body.results).toHaveLength(1);
      expect(filtered.body.results[0].citation.sourceId).toBe(source.id);
      const wrongType = await request(server).post('/api/retrieval/query').send({ query: 'login', sourceIds: [source.id], documentTypes: ['code'] }).expect(201);
      expect(wrongType.body.status).toBe('no_evidence');
      const query = await request(server).post('/api/retrieval/query').send({ query: 'login', sourceIds: [source.id] }).expect(201);
      expect(query.body.status).toBe('evidence');
      const tinyBudget = await request(server).post('/api/retrieval/query').send({ query: 'login', sourceIds: [source.id], maxTokens: 1 }).expect(201);
      expect(tinyBudget.body.status).toBe('budget_exhausted');
      expect(tinyBudget.body.citations).toEqual([]);
      expect(query.body.context).not.toContain('Forbidden');
      const citation = query.body.citations[0];
      const reference = { documentId: citation.documentId, chunkId: citation.chunkId, revisionHash: citation.revisionHash, sourceIds: [source.id] };
      await request(server).post('/api/retrieval/resolve').send(reference).expect(201);
      await request(server).post('/api/retrieval/resolve').send({ ...reference, sourceIds: [other.id] }).expect(404);
      const python = await promisify(execFile)('python3', ['-c',
        'import asyncio,json; from shared.tools import retrieve_source_evidence; print(asyncio.run(retrieve_source_evidence.ainvoke({"query":"login"})))'], {
        cwd: join(__dirname, '../../../../agents'), timeout: 15000,
        env: { ...process.env, BACKEND_API_URL: `${await app.getUrl()}/api`, AGENT_SOURCE_IDS: source.id },
      });
      const handedOff = JSON.parse(python.stdout.trim());
      expect(handedOff.status).toBe('evidence');
      expect(handedOff.execution_authorized).toBe(false);
      expect(handedOff.citations[0].id).toBe(citation.id);
      jest.spyOn(GitHubConnector.prototype, 'fetchDocuments').mockResolvedValue({ documents: [{ ...snapshot, content: 'Users must use a security key.' }], hasMore: false });
      const changed = await request(server).post(`/api/sources/${source.id}/sync`).send({ mode: 'full' }).expect(201);
      await module.get(PipelineService).dispatch();
      const changedDeadline = Date.now() + 8000;
      while ((await store.read(changed.body.syncJobId)).status !== 'completed' && Date.now() < changedDeadline) await new Promise(resolve => setTimeout(resolve, 25));
      expect((await store.read(changed.body.syncJobId)).status).toBe('completed');
      await request(server).post('/api/retrieval/resolve').send(reference).expect(409);
      await request(server).post('/api/qa/runs').send({ testIds: [imported.body.id] }).expect(409);
      const current = await request(server).post('/api/retrieval/query').send({ query: 'login', sourceIds: [source.id] }).expect(201);
      expect(current.body.citations[0].revisionHash).not.toBe(citation.revisionHash);
    } finally { await app.close(); }
  });
});
