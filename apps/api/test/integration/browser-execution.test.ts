import { DataSource } from 'typeorm';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { createHash, randomUUID } from 'crypto';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { join } from 'path';
import { readFileSync } from 'fs';
import { HarnessRun } from '../../src/modules/harness/harness.entity';
import { HarnessService } from '../../src/modules/harness/harness.service';
import { HarnessController, HarnessWorkerController } from '../../src/modules/harness/harness.controller';
import { HarnessExecution } from '../../src/modules/harness/execution.entity';
import { HarnessExecutionService } from '../../src/modules/harness/execution.service';
import { HarnessExecutionController, HarnessExecutorController } from '../../src/modules/harness/execution.controller';
import { QaTestCase, QaRun, QaExecution, QaHealingSuggestion } from '../../src/modules/qa/qa.entity';
import { Source } from '../../src/modules/sources/entities/source.entity';
import { SyncJob } from '../../src/modules/sources/entities/sync-job.entity';
import { SyncWork } from '../../src/modules/pipeline/entities/sync-work.entity';
import { Document } from '../../src/modules/documents/entities/document.entity';
import { Chunk } from '../../src/modules/documents/entities/chunk.entity';
import { BusinessItem, BusinessRelationship } from '../../src/modules/business/entities/business-item.entity';
import { AutonomyService } from '../../src/modules/autonomy/autonomy.service';
import { AutonomyController, ProjectGuard } from '../../src/modules/autonomy/autonomy.controller';
import { AutonomousRun, AutonomousSuite, ProjectKey, QaAuditEvent, QaOrganization, QaProject } from '../../src/modules/autonomy/autonomy.entity';

describe('authorized deterministic browser executions', () => {
  let database: DataSource;
  let app: any;
  let service: HarnessExecutionService;
  let proposalId: string;
  let document: Document;
  const operatorKey = 'operator-' + 'a'.repeat(32);
  const workerKey = 'worker-' + 'b'.repeat(32);
  const executorKey = 'executor-' + 'c'.repeat(32);
  const originalEnv = { ...process.env };
  const fixtures = join(__dirname, '../../../../agents/tests/fixtures/browser');
  const fixtureHash = (name: string) => createHash('sha256').update('index.html\0' + createHash('sha256').update(readFileSync(join(fixtures, name, 'index.html'))).digest('hex')).digest('hex');
  const post = (path: string, key = operatorKey) => request(app.getHttpServer()).post('/api/harness/' + path).set('x-harness-key', key);

  beforeAll(async () => {
    database = new DataSource({ type: 'postgres', host: '127.0.0.1', port: 55432, username: 'pipeline_test', password: 'pipeline_test', database: 'pipeline_test', synchronize: true,
      entities: [QaOrganization, QaProject, ProjectKey, AutonomousSuite, AutonomousRun, QaAuditEvent, HarnessExecution, HarnessRun, QaTestCase, QaRun, QaExecution, QaHealingSuggestion, Source, SyncJob, SyncWork, Document, Chunk, BusinessItem, BusinessRelationship] });
    await database.initialize();
    const module = await Test.createTestingModule({ controllers: [AutonomyController, HarnessController, HarnessWorkerController, HarnessExecutionController, HarnessExecutorController],
      providers: [AutonomyService, ProjectGuard, HarnessService, HarnessExecutionService, { provide: DataSource, useValue: database }] }).compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('api');
    await app.listen(0, '127.0.0.1');
    service = module.get(HarnessExecutionService);
  });

  beforeEach(async () => {
    await database.query('TRUNCATE harness_executions, harness_runs, qa_executions, qa_runs, qa_test_cases, sources CASCADE');
    Object.assign(process.env, { HARNESS_OPERATOR_KEY: operatorKey, HARNESS_WORKER_KEY: workerKey, HARNESS_EXECUTOR_KEY: executorKey,
      HARNESS_WORKSPACE_ID: 'fixture-workspace', HARNESS_APPLICATION_ID: 'fixture-app', HARNESS_ENVIRONMENT: 'test',
      HARNESS_PROVIDER: 'ollama', HARNESS_MODEL: 'fixture-model', HARNESS_INPUT_NANO_USD: '0', HARNESS_OUTPUT_NANO_USD: '0',
      HARNESS_EXECUTION_TARGETS: JSON.stringify({ healthy: fixtureHash('healthy'), defective: fixtureHash('defective') }) });
    const source = await database.getRepository(Source).save({ name: 'Browser fixture', type: 'github', config: { authType: 'token' }, status: 'connected' });
    process.env.HARNESS_SOURCE_IDS = source.id;
    document = await database.getRepository(Document).save({ sourceId: source.id, externalId: 'login', title: 'Login', type: 'requirement',
      content: 'Click sign in. Access granted.', contentHash: 'a'.repeat(64), processedHash: 'a'.repeat(64) });
    const testCase = await database.getRepository(QaTestCase).save({ title: 'Login', steps: [{ action: 'Click sign in', expected: 'Access granted' }], reviewStatus: 'approved', reviewedBy: 'reviewer' });
    const submitted = await post('runs').send({ requestId: randomUUID(), workspaceId: 'fixture-workspace', applicationId: 'fixture-app', environment: 'test', actor: 'operator',
      role: 'aue', objective: 'Automate the approved login check', evidence: [{ documentId: document.id, revisionHash: document.processedHash }], caseId: testCase.id, caseRevision: 1,
      budget: { modelCalls: 1, inputTokens: 32000, outputTokens: 4096, outputTokensPerCall: 1024, wallSeconds: 300, costNanoUsd: 1000000 } }).expect(201);
    proposalId = submitted.body.id;
    const claimed = await post('worker/claim', workerKey).send({}).expect(201);
    await post(`worker/${proposalId}/complete`, workerKey).send({ token: claimed.body.token, outcome: 'proposal', reason: 'Controlled proposal fixture', proposal: {
      kind: 'automation_plan', caseId: testCase.id, caseRevision: 1, steps: [{ caseStep: 1, action: 'Click sign in', expected: 'Access granted', selector: '#login', assertion: { kind: 'text_equals', selector: '#result', expected: 'Access granted' } }],
    } }).expect(201);
    await post(`runs/${proposalId}/review`).send({ decision: 'approved', reviewer: 'reviewer' }).expect(201);
  });

  afterAll(async () => { process.env = originalEnv; await app?.close(); if (database?.isInitialized) await database.destroy(); });
  const input = (overrides = {}) => ({ requestId: randomUUID(), proposalRunId: proposalId, targetId: 'healthy', actor: 'operator', preconditionsConfirmed: true, bindings: [{ operation: 'click' }], ...overrides });
  const submit = async (overrides = {}) => (await post('executions').send(input(overrides)).expect(201)).body;
  const claim = async () => (await post('executor/claim', executorKey).send({}).expect(201)).body;
  const report = (token: string, overrides = {}) => ({ token, runnerVersion: 'test-fixture', error: '', observations: [{ caseStep: 1, actionCompleted: true, actual: 'Access granted', error: '' }], screenshot: Buffer.from([255, 216, 255, 217]).toString('base64'), ...overrides });

  it('separates model and execution capabilities and requires explicit action authorization', async () => {
    await post('executor/claim', workerKey).send({}).expect(401);
    await post('executions', executorKey).send(input()).expect(401);
    await post('executions').send(input({ preconditionsConfirmed: false })).expect(400);
    await post('executions').send(input({ targetId: 'production' })).expect(400);
    await post('executions').send(input({ bindings: [{ operation: 'eval', value: 'anything' }] })).expect(400);
    await database.getRepository(HarnessRun).update(proposalId, { status: 'awaiting_review' });
    await post('executions').send(input()).expect(409);
  });

  it('deduplicates submit, limits concurrent execution, and snapshots reviewed assertions', async () => {
    const payload = input();
    const [first, second] = await Promise.all([post('executions').send(payload), post('executions').send(payload)]);
    expect(first.body.id).toBe(second.body.id);
    await post('executions').send({ ...payload, targetId: 'defective' }).expect(409);
    await submit();
    const claims = await Promise.all([claim(), claim()]);
    expect(claims.filter(item => item.id)).toHaveLength(1);
    expect(claims.find(item => item.id).steps[0].assertion.expected).toBe('Access granted');
  });

  it('derives verdicts from observations, not a worker-supplied status', async () => {
    const run = await submit(); const job = await claim();
    await post(`executor/${run.id}/complete`, executorKey).send({ ...report(job.token), status: 'passed' }).expect(400);
    const body = report(job.token, { observations: [{ caseStep: 1, actionCompleted: true, actual: 'Access denied', error: '' }] });
    expect((await post(`executor/${run.id}/complete`, executorKey).send(body).expect(201)).body.status).toBe('failed');
    await post(`executor/${run.id}/complete`, executorKey).send(body).expect(201);
    await post(`executor/${run.id}/complete`, executorKey).send(report(job.token)).expect(409);
    expect((await service.status(run.id)).modelCalls).toBe(0);
  });

  it('does not pass missing assertions, infrastructure errors or absent artifacts', async () => {
    for (const overrides of [{ observations: [] }, { screenshot: '' }, { error: 'infrastructure_error' }, { observations: [{ caseStep: 1, actionCompleted: false, actual: 'Access granted', error: 'action_error' }] }]) {
      const run = await submit(); const job = await claim();
      expect((await post(`executor/${run.id}/complete`, executorKey).send(report(job.token, overrides)).expect(201)).body.status).toBe('error');
    }
  });

  it('fences cancellation and never automatically replays an expired execution', async () => {
    const run = await submit(); const job = await claim();
    await post(`executions/${run.id}/cancel`).send({}).expect(201);
    await post(`executor/${run.id}/complete`, executorKey).send(report(job.token)).expect(409);
    const abandoned = await submit(); await claim();
    await database.getRepository(HarnessExecution).update(abandoned.id, { leaseUntil: new Date(0) });
    await claim();
    expect((await service.status(abandoned.id)).status).toBe('interrupted');
    expect((await service.status(abandoned.id)).report).toBeNull();
  });

  it('blocks stale evidence at completion and target changes before dispatch', async () => {
    const run = await submit(); const job = await claim();
    await database.getRepository(Document).update(document.id, { processedHash: 'b'.repeat(64) });
    expect((await post(`executor/${run.id}/complete`, executorKey).send(report(job.token)).expect(201)).body.status).toBe('blocked');
    await database.getRepository(Document).update(document.id, { processedHash: document.processedHash });
    const queued = await submit();
    process.env.HARNESS_EXECUTION_TARGETS = JSON.stringify({ healthy: 'c'.repeat(64) });
    await claim();
    expect((await service.status(queued.id)).status).toBe('blocked');
  });

  it('preserves failed attempts and marks a passing explicit retry as flaky', async () => {
    const first = await submit(); const job = await claim();
    await post(`executor/${first.id}/complete`, executorKey).send(report(job.token, { observations: [{ caseStep: 1, actionCompleted: true, actual: 'Access denied', error: '' }] })).expect(201);
    const retry = await submit({ retryOf: first.id }); const next = await claim();
    const completed = await post(`executor/${retry.id}/complete`, executorKey).send(report(next.token)).expect(201);
    expect(completed.body.flaky).toBe(true);
    expect((await service.status(first.id)).status).toBe('failed');
    const artifact = await request(app.getHttpServer()).get(`/api/harness/executions/${retry.id}/artifact`).set('x-harness-key', operatorKey).expect(200);
    expect(createHash('sha256').update(Buffer.from(artifact.body.base64, 'base64')).digest('hex')).toBe(artifact.body.sha256);
  });

  it('applies its migration twice without dropping execution records', async () => {
    const runner = database.createQueryRunner(); await runner.connect();
    try {
      await runner.query('CREATE SCHEMA browser_migration_test'); await runner.query('SET search_path TO browser_migration_test');
      const sql = readFileSync(join(__dirname, '../../migrations/20260928-browser-execution.sql'), 'utf8');
      await runner.query(sql);
      await runner.query("INSERT INTO harness_executions (\"requestId\", \"requestHash\", \"proposalRunId\", \"targetId\", \"targetHash\", actor, steps, deadline) VALUES ($1, 'hash', $2, 'target', 'hash', 'actor', '[]', now())", [randomUUID(), randomUUID()]);
      await runner.query(sql);
      expect((await runner.query('SELECT count(*)::int AS count FROM harness_executions'))[0].count).toBe(1);
    } finally {
      await runner.query('ROLLBACK'); await runner.query('SET search_path TO public'); await runner.query('DROP SCHEMA browser_migration_test CASCADE'); await runner.release();
    }
  });

  it('rejects attaching an approved browser proposal to a different project scope', async () => {
    const autonomy = new AutonomyService(database, new HarnessService(database), service);
    const enrollment = await autonomy.enroll({ name: 'Other project', workspaceId: 'other-org', applicationId: 'fixture-app', environment: 'test', origins: [], targets: ['healthy'], requirements: ['login'], dailyRunLimit: 5 });
    const owner = await autonomy.authenticate('Bearer ' + enrollment.credential.secret);
    await expect(autonomy.createSuite(owner, { name: 'unsafe', checks: [{ id: 'login', kind: 'browser', requirement: 'login', proposalRunId: proposalId, targetId: 'healthy', bindings: [{ operation: 'click' }] }] })).rejects.toThrow('different project scope');
  });

  (process.env.HARNESS_DOCKER_E2E === '1' ? it : it.skip)('executes healthy and seeded-defect apps in actual network-disabled Chromium containers', async () => {
    for (const targetId of ['healthy', 'defective']) {
      const run = await submit({ targetId });
      await promisify(execFile)('python3', ['tests/browser_worker_fixture.py'], { cwd: join(__dirname, '../../../../agents'), timeout: 110000,
        env: { ...process.env, PYTHONPATH: '.', BACKEND_API_URL: `${await app.getUrl()}/api`, HARNESS_BROWSER_IMAGE: 'superqa-browser:v1', HARNESS_BROWSER_TARGETS: JSON.stringify({ healthy: join(fixtures, 'healthy'), defective: join(fixtures, 'defective') }) } });
      const state = await service.status(run.id);
      expect(state.status).toBe(targetId === 'healthy' ? 'passed' : 'failed');
      expect(state.artifactAvailable).toBe(true);
      expect((state.report as any).observations[0].actual).toBe(targetId === 'healthy' ? 'Access granted' : 'Access denied');
    }
  }, 240000);

  (process.env.HARNESS_DOCKER_E2E === '1' ? it : it.skip)('runs approved project suites end to end through both workers and real Chromium', async () => {
    const autonomy = new AutonomyService(database, new HarnessService(database), service);
    const enrollment = await autonomy.enroll({ name: 'Browser pilot', workspaceId: 'fixture-workspace', applicationId: 'fixture-app', environment: 'test', origins: [], targets: ['healthy', 'defective'], requirements: ['login'], dailyRunLimit: 5 });
    const owner = await autonomy.authenticate('Bearer ' + enrollment.credential.secret);
    const credential = await autonomy.issueKey(owner, { role: 'runner', label: 'project runner', days: 1 });
    for (const targetId of ['healthy', 'defective']) {
      const suite = await autonomy.createSuite(owner, { name: targetId, checks: [{ id: 'login', kind: 'browser', requirement: 'login', proposalRunId: proposalId, targetId, bindings: [{ operation: 'click' }] }] });
      await autonomy.approve(owner, suite.id);
      const run = await autonomy.start(owner, { requestId: randomUUID(), suiteId: suite.id });
      await promisify(execFile)('python3', ['tests/autonomy_browser_fixture.py'], { cwd: join(__dirname, '../../../../agents'), timeout: 110000,
        env: { ...process.env, PYTHONPATH: '.', BACKEND_API_URL: `${await app.getUrl()}/api`, AUTONOMY_PROJECT_KEY: credential.secret, HARNESS_BROWSER_IMAGE: 'superqa-browser:v1', HARNESS_BROWSER_TARGETS: JSON.stringify({ healthy: join(fixtures, 'healthy'), defective: join(fixtures, 'defective') }) } });
      const state = await autonomy.status(owner, run.id);
      expect(state.status).toBe(targetId === 'healthy' ? 'passed' : 'failed');
      expect(state.results?.[0].artifactHash).toMatch(/^[a-f0-9]{64}$/);
    }
  }, 240000);
});
