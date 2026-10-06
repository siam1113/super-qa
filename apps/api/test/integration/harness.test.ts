import { DataSource } from 'typeorm';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { randomUUID } from 'crypto';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { join } from 'path';
import { readFileSync } from 'fs';
import { HarnessRun } from '../../src/modules/harness/harness.entity';
import { HarnessService } from '../../src/modules/harness/harness.service';
import { HarnessController, HarnessWorkerController } from '../../src/modules/harness/harness.controller';
import { QaTestCase, QaRun, QaExecution, QaHealingSuggestion } from '../../src/modules/qa/qa.entity';
import { Source } from '../../src/modules/sources/entities/source.entity';
import { SyncJob } from '../../src/modules/sources/entities/sync-job.entity';
import { SyncWork } from '../../src/modules/pipeline/entities/sync-work.entity';
import { Document } from '../../src/modules/documents/entities/document.entity';
import { Chunk } from '../../src/modules/documents/entities/chunk.entity';
import { BusinessItem, BusinessRelationship } from '../../src/modules/business/entities/business-item.entity';

describe('shared durable harness', () => {
  let database: DataSource;
  let app: any;
  let service: HarnessService;
  let document: Document;
  const operatorKey = 'operator-' + 'a'.repeat(32);
  const workerKey = 'worker-' + 'b'.repeat(32);
  const originalEnv = { ...process.env };
  const operator = (path: string) => request(app.getHttpServer()).post('/api/harness/' + path).set('x-harness-key', operatorKey);
  const worker = (path: string) => request(app.getHttpServer()).post('/api/harness/worker/' + path).set('x-harness-key', workerKey);

  beforeAll(async () => {
    database = new DataSource({ type: 'postgres', host: '127.0.0.1', port: 55432, username: 'pipeline_test', password: 'pipeline_test', database: 'pipeline_test', synchronize: true,
      entities: [HarnessRun, QaTestCase, QaRun, QaExecution, QaHealingSuggestion, Source, SyncJob, SyncWork, Document, Chunk, BusinessItem, BusinessRelationship] });
    await database.initialize();
    const module = await Test.createTestingModule({ controllers: [HarnessController, HarnessWorkerController], providers: [HarnessService, { provide: DataSource, useValue: database }] }).compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('api');
    await app.listen(0, '127.0.0.1');
    service = module.get(HarnessService);
  });

  beforeEach(async () => {
    await database.query('TRUNCATE harness_runs, qa_executions, qa_runs, qa_test_cases, sources CASCADE');
    Object.assign(process.env, { HARNESS_OPERATOR_KEY: operatorKey, HARNESS_WORKER_KEY: workerKey, HARNESS_WORKSPACE_ID: 'fixture-workspace',
      HARNESS_APPLICATION_ID: 'fixture-app', HARNESS_ENVIRONMENT: 'test', HARNESS_PROVIDER: 'ollama', HARNESS_MODEL: 'fixture-model', HARNESS_INPUT_NANO_USD: '1', HARNESS_OUTPUT_NANO_USD: '2' });
    const source = await database.getRepository(Source).save({ name: 'Harness fixture', type: 'github', config: { authType: 'token' }, status: 'connected' });
    process.env.HARNESS_SOURCE_IDS = source.id;
    document = await database.getRepository(Document).save({ sourceId: source.id, externalId: 'login', title: 'Login', type: 'requirement',
      content: 'An active account. Enter credentials. Access granted.', contentHash: 'a'.repeat(64), processedHash: 'a'.repeat(64) });
  });

  afterAll(async () => {
    process.env = originalEnv;
    await app?.close();
    if (database?.isInitialized) await database.destroy();
  });

  function task(overrides: Record<string, unknown> = {}) {
    return { requestId: randomUUID(), workspaceId: 'fixture-workspace', applicationId: 'fixture-app', environment: 'test', actor: 'fixture-operator',
      role: 'qae', objective: 'Propose grounded login checks', evidence: [{ documentId: document.id, revisionHash: document.processedHash }],
      budget: { modelCalls: 2, inputTokens: 32000, outputTokens: 4096, outputTokensPerCall: 1024, wallSeconds: 300, costNanoUsd: 1000000 }, ...overrides };
  }

  function proposal() {
    return { kind: 'cases', cases: [{ title: 'Login', preconditions: ['An active account'], steps: [{ action: 'Enter credentials', expected: 'Access granted', documentId: document.id, revisionHash: document.processedHash }] }] };
  }

  async function submit(overrides = {}) {
    return (await operator('runs').send(task(overrides)).expect(201)).body;
  }

  async function claim() { return (await worker('claim').send({}).expect(201)).body; }
  async function complete(job: any, overrides = {}) {
    return worker(`${job.id}/complete`).send({ token: job.token, outcome: 'proposal', proposal: proposal(), reason: 'Fixture proposal', usage: { inputTokens: 100, outputTokens: 100 }, ...overrides }).expect(201);
  }

  it('fails closed without keys and separates worker/operator authority', async () => {
    await request(app.getHttpServer()).post('/api/harness/runs').send(task()).expect(401);
    await request(app.getHttpServer()).post('/api/harness/worker/claim').set('x-harness-key', operatorKey).send({}).expect(401);
    await request(app.getHttpServer()).post('/api/harness/runs').set('x-harness-key', workerKey).send(task()).expect(401);
    delete process.env.HARNESS_OPERATOR_KEY;
    await operator('runs').send(task()).expect(503);
  });

  it('rejects scope changes, missing budgets and unapproved AUE input', async () => {
    await operator('runs').send(task({ environment: 'production' })).expect(403);
    await operator('runs').send(task({ budget: {} })).expect(400);
    await operator('runs').send(task({ role: 'aue' })).expect(400);
    process.env.HARNESS_SOURCE_IDS = randomUUID();
    await operator('runs').send(task()).expect(403);
    expect(await database.getRepository(HarnessRun).count()).toBe(0);
  });

  it('does not silently treat an unset price schedule as free inference', async () => {
    process.env.HARNESS_INPUT_NANO_USD = '';
    await operator('runs').send(task()).expect(503);
    expect(await database.getRepository(HarnessRun).count()).toBe(0);
  });

  it('deduplicates admission and detects changed idempotency input', async () => {
    const input = task();
    const [first, second] = await Promise.all([operator('runs').send(input), operator('runs').send(input)]);
    expect(first.status).toBe(201);
    expect(first.body.id).toBe(second.body.id);
    await operator('runs').send({ ...input, objective: 'Changed' }).expect(409);
    expect(await database.getRepository(HarnessRun).count()).toBe(1);
  });

  it('reserves before dispatch and caps global concurrent claims', async () => {
    await submit(); await submit(); await submit();
    const jobs = await Promise.all([claim(), claim(), claim(), claim()]);
    const claimed = jobs.filter(job => job?.id);
    expect(claimed).toHaveLength(2);
    expect(new Set(claimed.map(job => job.id)).size).toBe(2);
    const state = await service.status(claimed[0].id);
    expect(state.charged.modelCalls).toBe(1);
    expect(state.charged.inputTokens).toBeGreaterThan(1024);
    expect(state.attempts[0]).not.toHaveProperty('token');
  });

  it('makes no dispatch when the monetary or token reserve cannot fit', async () => {
    const input = task();
    const first = await submit({ budget: { ...input.budget, costNanoUsd: 1 } });
    expect(await claim()).toEqual({});
    expect((await service.status(first.id)).status).toBe('budget_exhausted');
    const second = await submit({ budget: { ...input.budget, outputTokens: 128 } });
    await claim();
    expect((await service.status(second.id)).charged.modelCalls).toBe(0);
  });

  it('retains uncertain usage across lease recovery and fences the old worker', async () => {
    const run = await submit();
    const first = await claim();
    await database.getRepository(HarnessRun).update(run.id, { leaseUntil: new Date(0) });
    const second = await claim();
    expect(second.token).not.toBe(first.token);
    expect((await service.status(run.id)).charged.modelCalls).toBe(2);
    await worker(`${first.id}/complete`).send({ token: first.token, outcome: 'failed', reason: 'Late' }).expect(409);
    await database.getRepository(HarnessRun).update(run.id, { leaseUntil: new Date(0) });
    await claim();
    const state = await new HarnessService(database).status(run.id);
    expect(state.status).toBe('budget_exhausted');
    expect(state.attempts.map(attempt => attempt.status)).toEqual(['abandoned', 'abandoned']);
  });

  it('cancellation and wall deadline prevent late proposals', async () => {
    const run = await submit();
    const job = await claim();
    await operator(`runs/${run.id}/cancel`).send({}).expect(201);
    await worker(`${run.id}/complete`).send({ token: job.token, outcome: 'proposal', reason: 'Late', proposal: proposal() }).expect(409);
    expect((await service.status(run.id)).proposal).toBeNull();
    const expired = await submit();
    await database.getRepository(HarnessRun).update(expired.id, { deadline: new Date(0) });
    expect((await service.status(expired.id)).status).toBe('budget_exhausted');
  });

  it('validates grounding and never promotes model text into a passing verdict', async () => {
    await submit();
    const job = await claim();
    const unsupported = proposal();
    unsupported.cases[0].steps[0].expected = 'Payment succeeds';
    const result = await complete(job, { proposal: unsupported });
    expect(result.body.status).toBe('blocked');
    expect(result.body.testVerdict).toBeNull();
    expect(result.body.proposal).toBeNull();
    await submit();
    const forged = await complete(await claim(), { proposal: { ...proposal(), passed: true } });
    expect(forged.body.status).toBe('blocked');
  });

  it('persists proposals, idempotent completions and explicit reviews', async () => {
    await submit();
    const job = await claim();
    expect((await complete(job)).body.status).toBe('awaiting_review');
    expect((await complete(job)).body.charged.modelCalls).toBe(1);
    const review = await operator(`runs/${job.id}/review`).send({ decision: 'approved', reviewer: 'reviewer' }).expect(201);
    expect(review.body.status).toBe('approved');
    expect(review.body.executionAuthorized).toBe(false);
    await operator(`runs/${job.id}/review`).send({ decision: 'rejected', reviewer: 'reviewer' }).expect(409);
  });

  it('refuses stale evidence at completion and at review', async () => {
    await submit();
    const job = await claim();
    await complete(job);
    await database.getRepository(Document).update(document.id, { processedHash: 'b'.repeat(64) });
    await operator(`runs/${job.id}/review`).send({ decision: 'approved', reviewer: 'reviewer' }).expect(409);
    await database.getRepository(Document).update(document.id, { processedHash: document.processedHash });
    await submit();
    const changed = await claim();
    await database.getRepository(Document).update(document.id, { content: 'Changed under the same hash' });
    expect((await complete(changed)).body.status).toBe('blocked');
  });

  it('records actual provider overage without publishing its proposal', async () => {
    await submit();
    const job = await claim();
    const result = await complete(job, { usage: { inputTokens: 99999, outputTokens: 99999 } });
    expect(result.body.status).toBe('budget_exhausted');
    expect(result.body.charged.inputTokens).toBe(99999);
    expect(result.body.proposal).toBeNull();
  });

  it('requires every approved assertion in an AUE plan', async () => {
    const approved = await database.getRepository(QaTestCase).save({ title: 'Login', steps: [{ action: 'Enter credentials', expected: 'Access granted' }], reviewStatus: 'approved', reviewedBy: 'reviewer' });
    await submit({ role: 'aue', caseId: approved.id, caseRevision: 1 });
    const job = await claim();
    const plan = { kind: 'automation_plan', caseId: approved.id, caseRevision: 1, steps: [{ caseStep: 1, action: 'Enter credentials', expected: 'Access granted', selector: '#login', assertion: { kind: 'text_equals', selector: '#result', expected: 'Access granted' } }] };
    expect((await complete(job, { proposal: plan })).body.status).toBe('awaiting_review');
    await submit({ role: 'aue', caseId: approved.id, caseRevision: 1 });
    const weakened = { ...plan, steps: [] };
    expect((await complete(await claim(), { proposal: weakened })).body.status).toBe('blocked');
    await database.getRepository(QaTestCase).update(approved.id, { revision: 2 });
    await operator(`runs/${job.id}/review`).send({ decision: 'approved', reviewer: 'reviewer' }).expect(409);
  });

  it('runs the Python worker through real HTTP and persists a reviewable proposal', async () => {
    const run = await submit();
    const output = await promisify(execFile)('python3', ['tests/harness_worker_fixture.py'], { cwd: join(__dirname, '../../../../agents'), timeout: 15000,
      env: { ...process.env, PYTHONPATH: '.', BACKEND_API_URL: `${await app.getUrl()}/api`, HARNESS_FIXTURE_REPLY: JSON.stringify(proposal()) } });
    expect(output.stdout.trim()).toBe('completed');
    const state = await new HarnessService(database).status(run.id);
    expect(state.status).toBe('awaiting_review');
    expect(state.attempts[0].usage).toEqual({ inputTokens: 100, outputTokens: 100 });
  });

  it('uses the same Python worker for AUE without weakening the approved oracle', async () => {
    const approved = await database.getRepository(QaTestCase).save({ title: 'Login', steps: [{ action: 'Enter credentials', expected: 'Access granted' }], reviewStatus: 'approved', reviewedBy: 'reviewer' });
    const run = await submit({ role: 'aue', caseId: approved.id, caseRevision: 1 });
    const plan = { kind: 'automation_plan', caseId: approved.id, caseRevision: 1, steps: [{ caseStep: 1, action: 'Enter credentials', expected: 'Access granted', selector: '#login', assertion: { kind: 'text_equals', selector: '#result', expected: 'Access granted' } }] };
    await promisify(execFile)('python3', ['tests/harness_worker_fixture.py'], { cwd: join(__dirname, '../../../../agents'), timeout: 15000,
      env: { ...process.env, PYTHONPATH: '.', BACKEND_API_URL: `${await app.getUrl()}/api`, HARNESS_FIXTURE_REPLY: JSON.stringify(plan) } });
    const state = await service.status(run.id);
    expect(state.status).toBe('awaiting_review');
    expect(state.proposal).toEqual(plan);
    expect(state.executionAuthorized).toBe(false);
  });

  it('applies its additive migration twice preserving records', async () => {
    const runner = database.createQueryRunner();
    await runner.connect();
    try {
      await runner.query('CREATE SCHEMA harness_migration_test');
      await runner.query('SET search_path TO harness_migration_test');
      const migration = readFileSync(join(__dirname, '../../migrations/20260928-shared-harness.sql'), 'utf8');
      await runner.query(migration);
      await runner.query("INSERT INTO harness_runs (\"requestId\", \"requestHash\", task, evidence, profile, prompt, deadline) VALUES ($1, 'hash', '{}', '[]', '{}', 'prompt', now())", [randomUUID()]);
      await runner.query(migration);
      expect((await runner.query('SELECT count(*)::int AS count FROM harness_runs'))[0].count).toBe(1);
    } finally {
      await runner.query('ROLLBACK');
      await runner.query('SET search_path TO public');
      await runner.query('DROP SCHEMA harness_migration_test CASCADE');
      await runner.release();
    }
  });
});
