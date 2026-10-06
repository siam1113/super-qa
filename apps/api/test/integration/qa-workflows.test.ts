import { DataSource } from 'typeorm';
import { Test } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bull';
import request from 'supertest';
import { randomUUID } from 'crypto';
import { readFileSync } from 'fs';
import { join } from 'path';
import { QaController } from '../../src/modules/qa/qa.controller';
import { QaService } from '../../src/modules/qa/qa.service';
import { QaTestCase, QaRun, QaExecution, QaHealingSuggestion } from '../../src/modules/qa/qa.entity';
import { SourcesService } from '../../src/modules/sources/sources.service';
import { BusinessService } from '../../src/modules/business/business.service';
import { AgentsService } from '../../src/modules/agents/agents.service';
import { Source } from '../../src/modules/sources/entities/source.entity';
import { SyncJob } from '../../src/modules/sources/entities/sync-job.entity';
import { SyncWork } from '../../src/modules/pipeline/entities/sync-work.entity';
import { Document } from '../../src/modules/documents/entities/document.entity';
import { Chunk } from '../../src/modules/documents/entities/chunk.entity';
import { BusinessItem, BusinessRelationship } from '../../src/modules/business/entities/business-item.entity';

describe('persisted QA HTTP workflows', () => {
  let database: DataSource;
  let app: any;
  const services = { findAll: async () => [] };
  const business = { getStatsByType: async () => ({}) };
  const agents = { startExecution: async () => { throw new Error('not used in these tests'); }, chatWithMemories: async () => { throw new Error('not used in these tests'); } };
  const generationQueue = { add: async () => undefined };
  const input = { title: 'Login', steps: [{ action: 'Enter valid credentials', expected: 'Access granted' }] };
  const result = { reporter: 'qa-operator', duration: 12, steps: [{ actual: 'Access granted', passed: true, evidence: 'manual observation record 1' }] };

  beforeAll(async () => {
    database = new DataSource({ type: 'postgres', host: '127.0.0.1', port: 55432, username: 'pipeline_test', password: 'pipeline_test', database: 'pipeline_test', synchronize: true,
      entities: [QaTestCase, QaRun, QaExecution, QaHealingSuggestion, Source, SyncJob, SyncWork, Document, Chunk, BusinessItem, BusinessRelationship] });
    await database.initialize();
    const module = await Test.createTestingModule({ controllers: [QaController], providers: [QaService,
      { provide: DataSource, useValue: database }, { provide: SourcesService, useValue: services }, { provide: BusinessService, useValue: business },
      { provide: AgentsService, useValue: agents }, { provide: getQueueToken('qa-generation'), useValue: generationQueue },
    ] }).compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('api');
    await app.init();
  });

  beforeEach(async () => {
    await database.query('TRUNCATE qa_executions, qa_runs, qa_test_cases, qa_healing_suggestions, sources CASCADE');
  });

  afterAll(async () => { await app?.close(); if (database?.isInitialized) await database.destroy(); });

  async function approved() {
    const created = await request(app.getHttpServer()).post('/api/qa/test-cases').send(input).expect(201);
    await request(app.getHttpServer()).post(`/api/qa/test-cases/${created.body.id}/review`).send({ revision: 1, status: 'approved', reviewer: 'reviewer' }).expect(201);
    return created.body;
  }

  it('returns empty persisted data and no fabricated scores on a fresh workspace', async () => {
    const workspace = await request(app.getHttpServer()).get('/api/qa/workspace').expect(200);
    expect(workspace.body.testCases).toEqual([]);
    expect(workspace.body.executions).toEqual([]);
    expect(workspace.body.healingSuggestions).toEqual([]);
    expect(workspace.body.stats).toMatchObject({ passed: 0, failed: 0, aiConfidence: null });
    await request(app.getHttpServer()).post('/api/qa/runs').send({}).expect(400);
    await request(app.getHttpServer()).post('/api/qa/healing/' + randomUUID() + '/approve').send({ reviewer: 'reviewer' }).expect(404);
  });

  it('requires valid steps and review before planning a run', async () => {
    await request(app.getHttpServer()).post('/api/qa/test-cases').send({ title: 'Invalid', steps: [] }).expect(400);
    const created = await request(app.getHttpServer()).post('/api/qa/test-cases').send(input).expect(201);
    await request(app.getHttpServer()).post('/api/qa/runs').send({ testIds: [created.body.id] }).expect(409);
    expect(await database.getRepository(QaRun).count()).toBe(0);
  });

  it('persists an idempotent run, manual observations and measured dashboard across service recreation', async () => {
    const testCase = await approved();
    const body = { requestId: randomUUID(), testIds: [testCase.id], environment: 'staging', browser: 'chromium' };
    const [first, retry] = await Promise.all([request(app.getHttpServer()).post('/api/qa/runs').send(body), request(app.getHttpServer()).post('/api/qa/runs').send(body)]);
    expect(first.status).toBe(201);
    expect(retry.body.id).toBe(first.body.id);
    expect(first.body.status).toBe('awaiting_results');
    expect(await database.getRepository(QaExecution).count()).toBe(1);
    const executionId = first.body.executions[0].id;
    await request(app.getHttpServer()).post('/api/qa/runs').send({ ...body, browser: 'firefox' }).expect(409);
    await request(app.getHttpServer()).post(`/api/qa/executions/${executionId}/result`).send({ ...result, status: 'passed' }).expect(400);
    await request(app.getHttpServer()).post(`/api/qa/executions/${executionId}/result`).send(result).expect(201);
    await request(app.getHttpServer()).post(`/api/qa/executions/${executionId}/result`).send(result).expect(201);
    await request(app.getHttpServer()).post(`/api/qa/executions/${executionId}/result`).send({ ...result, duration: 13 }).expect(409);
    const recreated = new QaService(services as any, business as any, agents as any, database, generationQueue as any);
    expect((await recreated.getDashboard()).stats).toMatchObject({ passed: 1, failed: 0, pending: 0 });
    expect((await recreated.getTestCases())[0].passRate).toBe(100);
    expect((await recreated.getExecutions())[0]).toMatchObject({ mode: 'manual', resultOrigin: 'human-reported', aiConfidence: null });
  });

  it('requires every observation and never overwrites a failed step with a passing verdict', async () => {
    const testCase = await approved();
    const run = await request(app.getHttpServer()).post('/api/qa/runs').send({ testIds: [testCase.id] }).expect(201);
    const executionId = run.body.executions[0].id;
    await request(app.getHttpServer()).post(`/api/qa/executions/${executionId}/result`).send({ ...result, steps: [...result.steps, ...result.steps] }).expect(400);
    const failed = await request(app.getHttpServer()).post(`/api/qa/executions/${executionId}/result`).send({ ...result, steps: [{ actual: 'Access denied', passed: false, evidence: 'screenshot-1' }] }).expect(201);
    expect(failed.body.status).toBe('failed');
    await request(app.getHttpServer()).post(`/api/qa/executions/${executionId}/result`).send(result).expect(409);
  });

  it('resets approval on edits and keeps prior run snapshots immutable', async () => {
    const testCase = await approved();
    const run = await request(app.getHttpServer()).post('/api/qa/runs').send({ testIds: [testCase.id] }).expect(201);
    const updated = await request(app.getHttpServer()).put(`/api/qa/test-cases/${testCase.id}`).send({ ...input, title: 'Revised login', revision: 1 }).expect(200);
    expect(updated.body).toMatchObject({ revision: 2, reviewStatus: 'draft', reviewedBy: null });
    await request(app.getHttpServer()).post(`/api/qa/test-cases/${testCase.id}/review`).send({ revision: 1, status: 'approved', reviewer: 'reviewer' }).expect(409);
    const stored = await request(app.getHttpServer()).get(`/api/qa/runs/${run.body.id}`).expect(200);
    expect(stored.body.executions[0].snapshot.title).toBe('Login');
    await request(app.getHttpServer()).post(`/api/qa/runs/${run.body.id}/cancel`).send({}).expect(201);
    await request(app.getHttpServer()).post(`/api/qa/executions/${run.body.executions[0].id}/result`).send(result).expect(409);
  });

  it('imports grounded scenarios with preconditions and rejects stale evidence', async () => {
    const source = await database.getRepository(Source).save({ name: 'QA source', type: 'github', config: { authType: 'token' }, status: 'connected' });
    const document = await database.getRepository(Document).save({ sourceId: source.id, externalId: 'case', title: 'Login', type: 'issue', content: 'Scenario', contentHash: 'hash', processedHash: 'revision-1' });
    const proposal = await database.getRepository(BusinessItem).save({ type: 'test_case', name: 'Login proposal', sourceId: source.id, documentId: document.id,
      content: { steps: [{ order: 1, ...input.steps[0] }], preconditions: ['Active account'] }, metadata: { revisionHash: 'revision-1' } });
    const imported = await request(app.getHttpServer()).post(`/api/qa/test-cases/import/${proposal.id}`).send({}).expect(201);
    expect(imported.body.preconditions).toEqual(['Active account']);
    await request(app.getHttpServer()).post(`/api/qa/test-cases/${imported.body.id}/review`).send({ revision: 1, status: 'approved', reviewer: 'reviewer' }).expect(201);
    const run = await request(app.getHttpServer()).post('/api/qa/runs').send({ testIds: [imported.body.id] }).expect(201);
    await database.getRepository(Document).update(document.id, { processedHash: 'revision-2' });
    await request(app.getHttpServer()).post('/api/qa/runs').send({ testIds: [imported.body.id] }).expect(409);
    await request(app.getHttpServer()).post(`/api/qa/executions/${run.body.executions[0].id}/result`).send(result).expect(409);
  });

  it('persists healing decisions without claiming to apply a code change', async () => {
    const testCase = await approved();
    const created = await request(app.getHttpServer()).post('/api/qa/healing').send({ issue: 'Selector changed', affectedTests: [testCase.id], currentLocator: '#old', suggestedLocator: '#new' }).expect(201);
    const decision = await request(app.getHttpServer()).post(`/api/qa/healing/${created.body.id}/approve`).send({ reviewer: 'reviewer' }).expect(201);
    expect(decision.body).toMatchObject({ status: 'approved', applied: false });
    const listed = await request(app.getHttpServer()).get('/api/qa/healing?status=approved').expect(200);
    expect(listed.body[0].reviewedBy).toBe('reviewer');
    await request(app.getHttpServer()).post(`/api/qa/healing/${created.body.id}/reject`).send({ reviewer: 'reviewer' }).expect(409);
  });

  it('applies the QA migration twice without losing records', async () => {
    const runner = database.createQueryRunner();
    await runner.connect();
    try {
      await runner.query('CREATE SCHEMA qa_migration_test');
      await runner.query('SET search_path TO qa_migration_test');
      const migration = readFileSync(join(__dirname, '../../migrations/20260928-persisted-qa.sql'), 'utf8');
      await runner.query(migration);
      await runner.query("INSERT INTO qa_test_cases (title, steps) VALUES ('Kept', '[]')");
      await runner.query(migration);
      expect((await runner.query('SELECT title FROM qa_test_cases'))[0].title).toBe('Kept');
    } finally {
      await runner.query('ROLLBACK');
      await runner.query('SET search_path TO public');
      await runner.query('DROP SCHEMA qa_migration_test CASCADE');
      await runner.release();
    }
  });
});
