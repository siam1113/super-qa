import { DataSource } from 'typeorm';
import { Test } from '@nestjs/testing';
import { APP_GUARD } from '@nestjs/core';
import { Controller, Get } from '@nestjs/common';
import request from 'supertest';
import { createHash, randomUUID, scryptSync } from 'crypto';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { createServer } from 'https';
import { execFile, spawn } from 'child_process';
import { createServer as createNetServer } from 'net';
import { promisify } from 'util';
import { AutonomyService } from '../../src/modules/autonomy/autonomy.service';
import { AutonomyController, AutonomyLockdownGuard, ProjectGuard } from '../../src/modules/autonomy/autonomy.controller';
import { AutonomousRun, AutonomousSuite, ProjectKey, QaAuditEvent, QaOrganization, QaProject } from '../../src/modules/autonomy/autonomy.entity';
import { HarnessService } from '../../src/modules/harness/harness.service';
import { HarnessExecutionService } from '../../src/modules/harness/execution.service';
import { QaBenchmark } from '../../src/modules/autonomy/benchmark.entity';
import { QaAuthSession, QaOidcAttempt, QaOrgInvitation, QaOrgMember, QaSuperAdmin } from '../../src/modules/autonomy/identity.entity';
import { AuthService } from '../../src/modules/autonomy/auth.service';
import { AuthController, SuperAdminGuard } from '../../src/modules/autonomy/auth.controller';

@Controller('legacy')
class LegacyController { @Get() get() { return { secret: 'must not be reachable' }; } }

describe('project autonomy control plane', () => {
  let database: DataSource;
  let app: any;
  let owner: string;
  let runner: string;
  let superAdminCookie: string;
  const originalEnv = { ...process.env };
  const superAdminEmail = 'admin@example.com';
  const superAdminPassword = 'admin';
  const project = { name: 'Pilot', workspaceId: 'org', applicationId: 'app', environment: 'test', origins: ['https://example.com'], targets: [], requirements: ['login', 'logout'], dailyRunLimit: 10 };
  const check = { id: 'login-check', requirement: 'login', kind: 'api', origin: 'https://example.com', path: '/health', expectedStatus: 200, pointer: '/ok', expected: true };
  const authorize = (req: any, key: string) => key.startsWith('qa_session=') ? req.set('Cookie', key) : req.set('Authorization', 'Bearer ' + key);
  const post = (path: string, key = owner) => authorize(request(app.getHttpServer()).post('/api/autonomy' + path), key);
  const get = (path: string, key = owner) => authorize(request(app.getHttpServer()).get('/api/autonomy' + path), key);
  const enrollRequest = (input: any = project) => request(app.getHttpServer()).post('/api/auth/super-admin/organizations').set('Cookie', superAdminCookie).send({ ...input, adminEmail: input.adminEmail || `admin-${randomUUID()}@example.com` });
  const enroll = async (input: any = project) => {
    const enrolled = (await enrollRequest(input).expect(201)).body;
    const token = new URL(enrolled.invitation.inviteUrl).searchParams.get('token');
    const accepted = await request(app.getHttpServer()).post('/api/auth/accept-invitation').send({ token, password: 'valid test password 123' }).expect(201);
    enrolled.credential = { secret: accepted.headers['set-cookie'][0].split(';')[0] };
    return { body: enrolled };
  };

  beforeAll(async () => {
    database = new DataSource({ type: 'postgres', host: '127.0.0.1', port: 55432, username: 'pipeline_test', password: 'pipeline_test', database: 'pipeline_test', synchronize: true, entities: [QaOrganization, QaProject, ProjectKey, AutonomousSuite, AutonomousRun, QaAuditEvent, QaBenchmark, QaOrgMember, QaOrgInvitation, QaAuthSession, QaOidcAttempt, QaSuperAdmin] });
    await database.initialize();
    await database.manager.delete(QaSuperAdmin, { email: superAdminEmail });
    const salt = 'test-admin-salt';
    await database.manager.save(database.manager.create(QaSuperAdmin, { email: superAdminEmail, passwordHash: `scrypt$${salt}$${scryptSync(superAdminPassword, salt, 64).toString('hex')}`, active: true }));
    const module = await Test.createTestingModule({ controllers: [AutonomyController, AuthController, LegacyController], providers: [AutonomyService, AuthService, ProjectGuard, SuperAdminGuard, { provide: APP_GUARD, useClass: AutonomyLockdownGuard }, { provide: DataSource, useValue: database }, { provide: HarnessService, useValue: { executionSnapshot: jest.fn() } }, { provide: HarnessExecutionService, useValue: {} }] }).compile();
    app = module.createNestApplication(); app.setGlobalPrefix('api'); await app.listen(0, '127.0.0.1');
  });

  beforeEach(async () => {
    Object.assign(process.env, { NODE_ENV: 'test', AUTH_PUBLIC_URL: 'http://localhost:3000', RESEND_API_KEY: '', OIDC_ISSUER_URL: '', OIDC_CLIENT_ID: '', OIDC_CLIENT_SECRET: '', OIDC_REDIRECT_URI: '', AUTONOMY_LOCKDOWN: 'true', AUTONOMY_ALLOWED_ORIGINS: JSON.stringify(project.origins), AUTONOMY_LIVE_PROFILES: '{}' });
    await database.query('TRUNCATE qa_auth_sessions, qa_oidc_attempts, qa_org_invitations, qa_org_members, qa_benchmarks, qa_audit_events, qa_autonomous_runs, qa_autonomous_suites, qa_project_keys, qa_projects CASCADE');
    const login = await request(app.getHttpServer()).post('/api/auth/login').send({ email: superAdminEmail, password: superAdminPassword }).expect(201);
    superAdminCookie = login.headers['set-cookie'][0].split(';')[0];
    owner = (await enroll()).body.credential.secret;
    runner = (await post('/keys').send({ role: 'runner', label: 'runner', days: 1 }).expect(201)).body.secret;
  });

  afterAll(async () => { process.env = originalEnv; await app?.close(); if (database?.isInitialized) await database.destroy(); });

  async function suite() {
    const created = (await post('/suites').send({ name: 'smoke', checks: [check] }).expect(201)).body;
    await post(`/suites/${created.id}/approve`).send({}).expect(201);
    return created;
  }

  async function queued() {
    const approved = await suite();
    return (await post('/runs').send({ requestId: randomUUID(), suiteId: approved.id }).expect(201)).body;
  }

  it('locks legacy routes and stores only hashed, expiring scoped credentials', async () => {
    await request(app.getHttpServer()).get('/api/legacy').expect(403);
    await get('', 'wrong').expect(401);
    expect(JSON.stringify(await database.manager.find(ProjectKey))).not.toContain(owner);
    const issued = (await post('/keys').send({ role: 'member', label: 'member', days: 1 }).expect(201)).body;
    await post('/keys', issued.secret).send({ role: 'owner', label: 'escalate', days: 1 }).expect(403);
    await post(`/keys/${issued.id}/revoke`).send({}).expect(201);
    await get('', issued.secret).expect(401);
    await database.manager.update(ProjectKey, { role: 'runner' }, { expiresAt: new Date(0) });
    await post('/claim', runner).send({}).expect(401);
  });

  it('creates an organization with only a name and initial Owner email', async () => {
    const enrolled = (await enrollRequest({ name: 'Acme', adminEmail: 'admin@acme.com' }).expect(201)).body;
    expect(enrolled.project.name).toBe('Acme');
    expect(enrolled.adminEmail).toBe('admin@acme.com');
    expect(enrolled.project.workspaceId).toMatch(/^[0-9a-f-]{36}$/i);
    expect(enrolled.project.applicationId).toBe('default');
    expect(enrolled.project.environment).toBe('test');
    expect(enrolled.project.dailyRunLimit).toBe(20);
    expect(enrolled.credential).toBeNull();
    expect(enrolled.invitation.email).toBe('admin@acme.com');
    expect(enrolled.invitation.delivery).toBe('manual');
    const rawToken = new URL(enrolled.invitation.inviteUrl).searchParams.get('token');
    expect((await database.manager.findOneBy(QaOrgInvitation, { id: enrolled.invitation.id })).tokenDigest).toBe(createHash('sha256').update(rawToken!).digest('hex'));
  });

  it('activates invited accounts, authenticates password sessions and revokes logout sessions', async () => {
    const enrolled = (await enrollRequest({ name: 'Password Org', adminEmail: 'first-admin@example.com' }).expect(201)).body;
    const token = new URL(enrolled.invitation.inviteUrl).searchParams.get('token');
    const accepted = await request(app.getHttpServer()).post('/api/auth/accept-invitation').send({ token, password: 'correct horse battery staple' }).expect(201);
    const cookie = accepted.headers['set-cookie'][0].split(';')[0];
    expect(accepted.body.user).toMatchObject({ email: 'first-admin@example.com', role: 'owner' });
    expect((await request(app.getHttpServer()).get('/api/auth/session').set('Cookie', cookie).expect(200)).body.user.email).toBe('first-admin@example.com');
    await request(app.getHttpServer()).get('/api/autonomy/settings').set('Cookie', cookie).expect(200);
    expect((await database.manager.findOneBy(QaOrgInvitation, { id: enrolled.invitation.id })).tokenDigest).not.toContain(token);
    await request(app.getHttpServer()).post('/api/auth/logout').set('Cookie', cookie).send({}).expect(201);
    await request(app.getHttpServer()).get('/api/auth/session').set('Cookie', cookie).expect(401);
    const loggedIn = await request(app.getHttpServer()).post('/api/auth/login').send({ email: 'first-admin@example.com', password: 'correct horse battery staple' }).expect(201);
    expect(loggedIn.headers['set-cookie'][0]).toContain('qa_session=qs_');
    const invitation = (await request(app.getHttpServer()).post('/api/auth/invitations').set('Cookie', owner).send({ email: 'teammate@example.com', role: 'member' }).expect(201)).body;
    const teammateToken = new URL(invitation.inviteUrl).searchParams.get('token');
    const teammate = await request(app.getHttpServer()).post('/api/auth/accept-invitation').send({ token: teammateToken, password: 'another secure passphrase' }).expect(201);
    expect(teammate.body.user.role).toBe('member');
    await request(app.getHttpServer()).post(`/api/auth/members/${teammate.body.user.id}/revoke`).set('Cookie', owner).send({}).expect(201);
    await request(app.getHttpServer()).get('/api/auth/session').set('Cookie', teammate.headers['set-cookie'][0].split(';')[0]).expect(401);
  });

  it('exposes safe role-aware settings and persists owner updates without widening deployment policy', async () => {
    const settings = (await get('/settings').expect(200)).body;
    expect(settings.identity.role).toBe('owner');
    expect(settings.project.name).toBe('Pilot');
    expect(settings.credentials).toHaveLength(2);
    expect(JSON.stringify(settings)).not.toContain('digest');
    expect(JSON.stringify(settings)).not.toContain(owner);
    await post('/settings').send({ name: 'Reviewed staging', dailyRunLimit: 30 }).expect(201);
    expect((await get('/settings').expect(200)).body.project.name).toBe('Reviewed staging');
    await post('/settings').send({ name: 'unsafe', dailyRunLimit: 30, origins: ['https://evil.com'] }).expect(400);
    const member = (await post('/keys').send({ role: 'member', label: 'reader', days: 1 }).expect(201)).body.secret;
    expect((await get('/settings', member).expect(200)).body.credentials).toEqual([]);
    await post('/settings', member).send({ name: 'forbidden', dailyRunLimit: 1 }).expect(403);
  });

  it('collects an approved benchmark incrementally without replay and derives scores from durable observations', async () => {
    const samples = [];
    for (const defective of [false, true]) {
      const approved = (await post('/suites').send({ name: defective ? 'defect' : 'healthy', checks: [check, { ...check, id: 'revision', expected: 'rev-v1', pointer: '/revision' }] }).expect(201)).body;
      await post(`/suites/${approved.id}/approve`).send({}).expect(201);
      samples.push({ id: defective ? 'defect' : 'healthy', defective, suiteId: approved.id, manifestHash: approved.manifestHash, revision: 'rev-v1', revisionCheckId: 'revision', targetCheckId: check.id, reviewedBy: 'independent reviewer', labelEvidence: 'controlled fixture' });
    }
    const projectId = (await get('/settings').expect(200)).body.project.id;
    const input = { requestId: randomUUID(), corpus: { name: 'UI cohort', kind: 'synthetic', projectId, repetitions: 1, samples } };
    const benchmark = (await post('/benchmarks').send(input).expect(201)).body;
    expect((await post('/benchmarks').send(input).expect(201)).body.id).toBe(benchmark.id);
    await post(`/benchmarks/${benchmark.id}/resume`).send({}).expect(409);
    await post(`/benchmarks/${benchmark.id}/approve`).send({}).expect(201);
    await post(`/benchmarks/${benchmark.id}/resume`).send({}).expect(201);
    for (const defective of [false, true]) {
      const [first, duplicate] = await Promise.all([post(`/benchmarks/${benchmark.id}/advance`).send({}).expect(201), post(`/benchmarks/${benchmark.id}/advance`).send({}).expect(201)]);
      expect(first.body.trials.map(item => item.run?.id)).toEqual(duplicate.body.trials.map(item => item.run?.id));
      const job = (await post('/claim', runner).send({}).expect(201)).body;
      expect(job).toBeTruthy();
      await post(`/runs/${job.id}/complete`, runner).send({ token: job.token, observations: [{ checkId: check.id, status: 200, error: '', actual: !defective }, { checkId: 'revision', status: 200, error: '', actual: 'rev-v1' }] }).expect(201);
    }
    const report = (await get(`/benchmarks/${benchmark.id}`).expect(200)).body;
    expect(report.status).toBe('completed');
    expect(report.report).toMatchObject({ gatePassed: true, rolloutGatePassed: false, falsePasses: 0, missedDefects: 0, falseFailures: 0, missingResults: 0 });
    expect((await post(`/benchmarks/${benchmark.id}/advance`).send({}).expect(201)).body.trials.map(item => item.run.id)).toEqual(report.trials.map(item => item.run.id));
    expect((await get('').expect(200)).body.runs).toHaveLength(2);
    expect(JSON.stringify(report)).not.toContain('token');
  });

  it('fences benchmark roles, scope, quota and paused collection while preserving uncertain evidence', async () => {
    const samples = [];
    for (const defective of [false, true]) {
      const suite = (await post('/suites').send({ name: String(defective), checks: [check, { ...check, id: 'revision', expected: 'v1' }] }).expect(201)).body;
      await post(`/suites/${suite.id}/approve`).send({}).expect(201);
      samples.push({ id: String(defective), defective, suiteId: suite.id, manifestHash: suite.manifestHash, revision: 'v1', revisionCheckId: 'revision', targetCheckId: check.id, reviewedBy: 'reviewer', labelEvidence: 'fixture' });
    }
    const projectId = (await get('/settings').expect(200)).body.project.id;
    const input = { requestId: randomUUID(), corpus: { name: 'fenced', kind: 'synthetic', projectId, repetitions: 1, samples } };
    for (const corpus of [{ ...input.corpus, projectId: randomUUID() }, { ...input.corpus, samples: [samples[0], { ...samples[0], id: 'duplicate', defective: true }] }, { ...input.corpus, samples: [samples[0], { ...samples[1], revision: 'wrong' }] }]) await post('/benchmarks').send({ ...input, corpus }).expect(400);
    const member = (await post('/keys').send({ role: 'member', label: 'member', days: 1 }).expect(201)).body.secret;
    const admin = (await post('/keys').send({ role: 'admin', label: 'admin', days: 1 }).expect(201)).body.secret;
    await post('/benchmarks', member).send(input).expect(403);
    const benchmark = (await post('/benchmarks', admin).send(input).expect(201)).body;
    await post(`/benchmarks/${benchmark.id}/approve`, admin).send({}).expect(403);
    await post(`/benchmarks/${benchmark.id}/advance`, member).send({}).expect(403);
    await post('/benchmarks').send({ ...input, corpus: { ...input.corpus, name: 'changed' } }).expect(409);
    const otherOwner = (await enroll({ ...project, name: 'Other' })).body.credential.secret;
    await get(`/benchmarks/${benchmark.id}`, otherOwner).expect(404);
    await post(`/benchmarks/${benchmark.id}/approve`).send({}).expect(201);
    expect((await post(`/benchmarks/${benchmark.id}/advance`).send({}).expect(201)).body.trials.every(item => item.run === null)).toBe(true);
    await post('/settings').send({ name: 'Pilot', dailyRunLimit: 1 }).expect(201);
    await post(`/benchmarks/${benchmark.id}/resume`).send({}).expect(201);
    const admitted = (await post(`/benchmarks/${benchmark.id}/advance`).send({}).expect(201)).body;
    await post(`/benchmarks/${benchmark.id}/pause`).send({}).expect(201);
    const runId = admitted.trials[0].run.id;
    expect((await get('/runs/' + runId).expect(200)).body.status).toBe('queued');
    await post(`/runs/${runId}/cancel`).send({}).expect(201);
    await post(`/benchmarks/${benchmark.id}/resume`).send({}).expect(201);
    await post(`/benchmarks/${benchmark.id}/advance`).send({}).expect(409);
    const result = (await get(`/benchmarks/${benchmark.id}`, member).expect(200)).body;
    expect(result.trials[0].run.status).toBe('cancelled');
    expect(result.report).toMatchObject({ gatePassed: false, rolloutGatePassed: false, completed: 1, abstentions: 2, missingResults: 1 });
    expect(result.runIds).toEqual([runId]);
  });

  it('counts false passes, false failures and revision uncertainty instead of crediting unrelated failures', async () => {
    const samples = [];
    for (const id of ['healthy', 'missed', 'drifted']) {
      const suite = (await post('/suites').send({ name: id, checks: [check, { ...check, id: 'revision', expected: 'v1' }] }).expect(201)).body;
      await post(`/suites/${suite.id}/approve`).send({}).expect(201);
      samples.push({ id, defective: id !== 'healthy', suiteId: suite.id, manifestHash: suite.manifestHash, revision: 'v1', revisionCheckId: 'revision', targetCheckId: check.id, reviewedBy: 'independent reviewer', labelEvidence: 'controlled wrong outcomes' });
    }
    const projectId = (await get('/settings').expect(200)).body.project.id;
    const benchmark = (await post('/benchmarks').send({ requestId: randomUUID(), corpus: { name: 'Never inflate accuracy', kind: 'real_project', projectId, repetitions: 1, samples } }).expect(201)).body;
    await post(`/benchmarks/${benchmark.id}/approve`).send({}).expect(201);
    await post(`/benchmarks/${benchmark.id}/resume`).send({}).expect(201);
    for (const sample of samples) {
      await post(`/benchmarks/${benchmark.id}/advance`).send({}).expect(201);
      const job = (await post('/claim', runner).send({}).expect(201)).body;
      await post(`/runs/${job.id}/complete`, runner).send({ token: job.token, observations: [{ checkId: check.id, status: 200, error: '', actual: sample.id === 'missed' }, { checkId: 'revision', status: 200, error: '', actual: sample.id === 'drifted' ? 'v2' : 'v1' }] }).expect(201);
    }
    const result = (await get(`/benchmarks/${benchmark.id}`).expect(200)).body;
    expect(result.report).toMatchObject({ gatePassed: false, rolloutGatePassed: false, completed: 3, falsePasses: 1, falseFailures: 1, missedDefects: 2, detectedDefects: 0, abstentions: 1 });
    expect(result.evidenceHash).toMatch(/^[a-f0-9]{64}$/);
  });

  (process.env.SETTINGS_UI_E2E === '1' ? it : it.skip)('wires Settings, scoped credentials and resumable benchmarks through real browser and worker execution', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'superqa-settings-'));
    const certificate = join(directory, 'cert.pem'); const privateKey = join(directory, 'key.pem');
    let server: ReturnType<typeof createServer> | undefined;
    let web: ReturnType<typeof spawn> | undefined;
    try {
      await promisify(execFile)('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=localhost', '-addext', 'subjectAltName=DNS:localhost', '-keyout', privateKey, '-out', certificate]);
      server = createServer({ key: readFileSync(privateKey), cert: readFileSync(certificate) }, (incoming, response) => {
        response.setHeader('Content-Type', 'application/json');
        response.end(JSON.stringify({ ok: incoming.url === '/healthy', revision: 'ui-fixture-v1' }));
      });
      await new Promise<void>(resolve => server?.listen(0, '127.0.0.1', resolve));
      const address = server.address(); if (!address || typeof address === 'string') throw new Error('TLS fixture failed');
      const origin = `https://localhost:${address.port}`;
      process.env.AUTONOMY_ALLOWED_ORIGINS = JSON.stringify([origin]);
      const enrolled = (await enroll({ ...project, origins: [origin] })).body;
      owner = enrolled.credential.secret;
      runner = (await post('/keys').send({ role: 'runner', label: 'UI fixture runner', days: 1 }).expect(201)).body.secret;
      const settingsOwnerKey = (await post('/keys').send({ role: 'owner', label: 'UI fixture owner', days: 1 }).expect(201)).body.secret;
      const member = (await post('/keys').send({ role: 'member', label: 'UI fixture member', days: 1 }).expect(201)).body.secret;
      const samples = [];
      for (const defective of [false, true]) {
        const suite = (await post('/suites').send({ name: defective ? 'Defective UI fixture' : 'Healthy UI fixture', checks: [{ ...check, origin, path: defective ? '/defective' : '/healthy' }, { ...check, id: 'revision', origin, path: '/revision', pointer: '/revision', expected: 'ui-fixture-v1' }] }).expect(201)).body;
        samples.push({ id: defective ? 'defective' : 'healthy', defective, suiteId: suite.id, manifestHash: suite.manifestHash, revision: 'ui-fixture-v1', revisionCheckId: 'revision', targetCheckId: check.id, reviewedBy: 'fixture reviewer', labelEvidence: 'Synthetic controlled TLS application' });
      }
      const corpus = join(directory, 'corpus.json'); const output = join(directory, 'export.json');
      writeFileSync(corpus, JSON.stringify({ name: 'Browser-reviewed cohort', kind: 'synthetic', projectId: enrolled.project.id, repetitions: 1, samples }));
      const portProbe = createNetServer();
      await new Promise<void>(resolve => portProbe.listen(0, '127.0.0.1', resolve));
      const portAddress = portProbe.address(); if (!portAddress || typeof portAddress === 'string') throw new Error('No web port');
      const webPort = portAddress.port;
      await new Promise<void>(resolve => portProbe.close(() => resolve()));
      const root = join(__dirname, '../../../..'); const backend = `${await app.getUrl()}/api`;
      let webOutput = '';
      web = spawn(process.execPath, [join(root, 'node_modules/next/dist/bin/next'), 'start', '-p', String(webPort), '-H', '127.0.0.1'], { cwd: join(root, 'apps/web'), env: { ...process.env, NODE_ENV: 'production', NEXT_BUILD_DIR: '.next-settings-e2e', AUTONOMY_API_URL: backend }, stdio: ['ignore', 'pipe', 'pipe'] });
      web.stdout?.on('data', chunk => { webOutput = (webOutput + chunk.toString()).slice(-4000); });
      web.stderr?.on('data', chunk => { webOutput = (webOutput + chunk.toString()).slice(-4000); });
      const webUrl = `http://127.0.0.1:${webPort}`;
      let ready = false;
      for (let attempt = 0; attempt < 100; attempt++) {
        try { ready = (await fetch(webUrl + '/settings')).ok; } catch (error) { webOutput = String(error) + '\n' + webOutput.slice(-3500); }
        if (ready) break;
        if (web.exitCode !== null) throw new Error('Settings web process exited');
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      if (!ready) throw new Error('Settings startup failed: ' + webOutput);
      expect((await fetch(webUrl + '/api/autonomy/settings')).status).toBe(401);
      expect((await fetch(webUrl + '/api/autonomy/enroll', { headers: { Authorization: 'Bearer ' + owner } })).status).toBe(404);
      const environment = { ...process.env, PYTHONPATH: '.', BACKEND_API_URL: backend, AUTONOMY_PROJECT_KEY: runner, SETTINGS_OWNER_KEY: settingsOwnerKey, SETTINGS_MEMBER_KEY: member, SETTINGS_WEB_URL: webUrl, AUTONOMY_ALLOWED_CIDRS: '["127.0.0.0/8", "::1/128"]', AUTONOMY_CA_FILE: certificate };
      await promisify(execFile)('python3', ['tests/settings_ui_fixture.py', corpus, output], { cwd: join(root, 'agents'), env: environment, timeout: 150000 });
      const report = JSON.parse(readFileSync(output, 'utf8'));
      expect(report.report).toMatchObject({ gatePassed: true, rolloutGatePassed: false, completed: 2, falsePasses: 0, missedDefects: 0, falseFailures: 0 });
      expect((await get('').expect(200)).body.runs).toHaveLength(2);
      expect((await get('/settings').expect(200)).body.project.name).toBe('Browser-reviewed project');
    } finally {
      if (web && web.exitCode === null) await new Promise<void>(resolve => {
        const timer = setTimeout(() => { web?.kill('SIGKILL'); resolve(); }, 5000);
        web?.once('exit', () => { clearTimeout(timer); resolve(); }); web?.kill('SIGTERM');
      });
      if (server) await new Promise<void>(resolve => server?.close(() => resolve()));
      rmSync(directory, { recursive: true, force: true });
    }
  }, 180000);

  it('rejects unsafe enrollment and suite execution contracts', async () => {
    await enrollRequest({ ...project, origins: ['http://169.254.169.254'] }).expect(400);
    for (const changed of [{ method: 'POST' }, { id: '__proto__' }, { path: '//evil.com' }, { expected: {} }, { expected: 9007199254740992 }, { expected: 1.5 }, { origin: 'https://evil.com' }, { origin: { toString: 'invalid' } }, { requirement: 'invented' }]) await post('/suites').send({ name: 'unsafe', checks: [{ ...check, ...changed }] }).expect(400);
    process.env.AUTONOMY_LOCKDOWN = 'false';
    await request(app.getHttpServer()).post('/api/auth/super-admin/organizations').set('Cookie', superAdminCookie).send({ name: 'Policy disabled', adminEmail: 'x@example.com' }).expect(201);
  });

  it('requires live profile authority, immutable assertions and clean complete evidence', async () => {
    const live = { id: 'live', requirement: 'login', kind: 'live', origin: project.origins[0], profileHash: 'a'.repeat(64), assertions: ['Saved'] };
    await post('/suites').send({ name: 'live', checks: [live] }).expect(400);
    process.env.AUTONOMY_LIVE_PROFILES = JSON.stringify({ [live.profileHash]: { origin: live.origin, environment: 'test', assertions: live.assertions } });
    const approved = (await post('/suites').send({ name: 'live', checks: [live] }).expect(201)).body;
    await post(`/suites/${approved.id}/approve`).send({}).expect(201);
    await post('/suites').send({ name: 'weaken', previousId: approved.id, checks: [{ ...live, assertions: ['Anything'] }] }).expect(400);
    for (const changed of [{ cleanup: 'pending' }, { artifactHash: '' }, { assertions: [] }, { assertions: [{ actual: 'Wrong', visible: true }] }, {}]) {
      const run = (await post('/runs').send({ requestId: randomUUID(), suiteId: approved.id }).expect(201)).body;
      const claim = (await post('/claim', runner).send({}).expect(201)).body;
      const observation = { checkId: live.id, profileHash: live.profileHash, error: '', cleanup: 'clean', artifactHash: 'b'.repeat(64), assertions: [{ actual: 'Saved', visible: true }], ...changed };
      await post(`/runs/${run.id}/complete`, runner).send({ token: claim.token, observations: [], liveObservations: [] }).expect(400);
      const completed = (await post(`/runs/${run.id}/complete`, runner).send({ token: claim.token, observations: [], liveObservations: [observation] }).expect(201)).body;
      expect(completed.status).toBe('cleanup' in changed || 'artifactHash' in changed || changed.assertions?.length === 0 ? 'error' : 'assertions' in changed ? 'failed' : 'passed');
    }
    process.env.AUTONOMY_LIVE_PROFILES = '{}';
    await post('/runs').send({ requestId: randomUUID(), suiteId: approved.id }).expect(400);
  });

  (process.env.HARNESS_DOCKER_E2E === '1' ? it : it.skip)('executes live authenticated CRUD, cleanup and a revision-bound benchmark through real Chromium', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'superqa-live-'));
    const certificate = join(directory, 'cert.pem');
    const privateKey = join(directory, 'key.pem');
    const leases = new Set<string>();
    let mutations = 0;
    let cleanupFailure = false;
    let unexpectedNetwork = false;
    let server: ReturnType<typeof createServer> | undefined;
    try {
      await promisify(execFile)('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=localhost', '-addext', 'subjectAltName=DNS:localhost', '-keyout', privateKey, '-out', certificate]);
      server = createServer({ key: readFileSync(privateKey), cert: readFileSync(certificate) }, (incoming, response) => {
        response.setHeader('Content-Type', 'application/json');
        if (incoming.headers.authorization !== 'Bearer synthetic-live-secret') { response.statusCode = 401; response.end('{}'); return; }
        const path = incoming.url || '';
        if (path === '/revision') { response.end(JSON.stringify({ revision: 'fixture-v1' })); return; }
        const lease = /^\/leases\/(sq-[a-f0-9]{32})$/.exec(path);
        if (lease) {
          if (incoming.method === 'PUT') { leases.add(lease[1]); response.statusCode = 201; response.end(JSON.stringify({ namespace: lease[1], ttlSeconds: 600 })); return; }
          if (incoming.method === 'DELETE') { if (!cleanupFailure) leases.delete(lease[1]); response.statusCode = cleanupFailure ? 500 : 204; response.end(); return; }
          response.statusCode = leases.has(lease[1]) ? 200 : 404; response.end('{}'); return;
        }
        const application = /^\/(healthy|defective)\/app\/(sq-[a-f0-9]{32})(\/items)?$/.exec(path);
        if (!application || !leases.has(application[2])) { response.statusCode = 404; response.end('{}'); return; }
        if (incoming.method === 'POST' && application[3]) { mutations++; response.end(JSON.stringify({ message: application[1] === 'healthy' ? 'Saved' : 'Wrong' })); return; }
        response.setHeader('Content-Type', 'text/html');
        response.end(`<html><body>${unexpectedNetwork ? '<img src="https://forbidden.invalid/tracker">' : ''}<input id="name"><button id="save">Save</button><div id="result">Waiting</div><script>document.querySelector('#save').onclick=async()=>{const result=await fetch(location.pathname+'/items',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:document.querySelector('#name').value})});document.querySelector('#result').innerText=(await result.json()).message;};</script></body></html>`);
      });
      await new Promise<void>(resolve => server?.listen(0, '127.0.0.1', resolve));
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('No fixture address');
      const origin = `https://localhost:${address.port}`;
      process.env.AUTONOMY_ALLOWED_ORIGINS = JSON.stringify([origin]);
      const enrolled = (await enroll({ ...project, origins: [origin] })).body;
      owner = enrolled.credential.secret;
      runner = (await post('/keys').send({ role: 'runner', label: 'live runner', days: 1 }).expect(201)).body.secret;
      const ciKey = (await post('/keys').send({ role: 'ci', label: 'benchmark', days: 1 }).expect(201)).body.secret;
      const registry = {};
      const paths = {};
      const samples = [];
      for (const variant of ['healthy', 'defective']) {
        const path = `/${variant}/app/{namespace}`;
        const profile = { origin, environment: 'test', revision: 'fixture-v1', leasePath: '/leases/{namespace}', routes: [{ method: 'GET', path }, { method: 'POST', path: path + '/items' }], steps: [{ operation: 'goto', path }, { operation: 'fill', selector: '#name', value: 'Synthetic item' }, { operation: 'click', selector: '#save' }, { operation: 'assert', selector: '#result', expected: 'Saved' }] };
        const content = JSON.stringify(profile);
        const digest = createHash('sha256').update(content).digest('hex');
        const file = join(directory, variant + '.json'); writeFileSync(file, content);
        registry[digest] = { origin, environment: 'test', assertions: ['Saved'] }; paths[digest] = file;
        process.env.AUTONOMY_LIVE_PROFILES = JSON.stringify(registry);
        const suite = (await post('/suites').send({ name: variant, checks: [{ ...check, id: 'revision', origin, path: '/revision', pointer: '/revision', expected: 'fixture-v1' }, { id: 'crud', requirement: 'login', kind: 'live', origin, profileHash: digest, assertions: ['Saved'] }] }).expect(201)).body;
        await post(`/suites/${suite.id}/approve`).send({}).expect(201);
        samples.push({ id: variant, defective: variant === 'defective', suiteId: suite.id, manifestHash: suite.manifestHash, revision: 'fixture-v1', revisionCheckId: 'revision', targetCheckId: 'crud', reviewedBy: 'integration-test', labelEvidence: 'Controlled seeded defect, not customer evidence' });
      }
      const image = (await promisify(execFile)('docker', ['image', 'inspect', 'superqa-browser:v1', '--format', '{{.Id}}'])).stdout.trim();
      const environment = { ...process.env, PYTHONPATH: '.', BACKEND_API_URL: `${await app.getUrl()}/api`, AUTONOMY_PROJECT_KEY: runner, BENCHMARK_CI_KEY: ciKey, AUTONOMY_ALLOWED_CIDRS: '["127.0.0.0/8", "::1/128"]', AUTONOMY_CA_FILE: certificate, AUTONOMY_SECRET_REFS: JSON.stringify({ [origin]: 'FIXTURE_LIVE_SECRET' }), FIXTURE_LIVE_SECRET: 'synthetic-live-secret', AUTONOMY_LIVE_PROFILE_PATHS: JSON.stringify(paths), AUTONOMY_LIVE_IMAGE: image, AUTONOMY_LIVE_STATE: join(directory, 'state') };
      const corpus = join(directory, 'corpus.json'); const output = join(directory, 'benchmark.json');
      writeFileSync(corpus, JSON.stringify({ name: 'live fixture', kind: 'synthetic', projectId: enrolled.project.id, repetitions: 2, samples }));
      await promisify(execFile)('python3', ['tests/live_benchmark_fixture.py', corpus, output], { cwd: join(__dirname, '../../../../agents'), env: environment, timeout: 150000 });
      const benchmark = JSON.parse(readFileSync(output, 'utf8'));
      expect(benchmark.report).toMatchObject({ gatePassed: true, rolloutGatePassed: false, falsePasses: 0, falseFailures: 0, missedDefects: 0, abstentions: 0, distinctSamples: 2 });
      expect(mutations).toBe(4); expect(leases.size).toBe(0);
      expect(benchmark.evidence.every(item => item.run.results[1].observation.cleanup === 'clean')).toBe(true);
      expect(JSON.stringify(benchmark)).not.toContain('synthetic-live-secret');
      cleanupFailure = true;
      const run = (await post('/runs').send({ requestId: randomUUID(), suiteId: samples[0].suiteId }).expect(201)).body;
      await promisify(execFile)('python3', ['-m', 'shared.harness.autonomy', 'worker', '--once'], { cwd: join(__dirname, '../../../../agents'), env: environment, timeout: 45000 });
      const completed = (await get('/runs/' + run.id).expect(200)).body;
      expect(completed.status).toBe('error'); expect(completed.results[1].observation.cleanup).toBe('pending'); expect(leases.size).toBe(1);
      cleanupFailure = false;
      const recovery = await promisify(execFile)('python3', ['-m', 'shared.harness.live', 'recover'], { cwd: join(__dirname, '../../../../agents'), env: environment, timeout: 30000 });
      expect(JSON.parse(recovery.stdout)[0].clean).toBe(true); expect(leases.size).toBe(0); expect(mutations).toBe(5);
      expect((await get('/runs/' + run.id).expect(200)).body.status).toBe('error');
      unexpectedNetwork = true;
      const blocked = (await post('/runs').send({ requestId: randomUUID(), suiteId: samples[0].suiteId }).expect(201)).body;
      await promisify(execFile)('python3', ['-m', 'shared.harness.autonomy', 'worker', '--once'], { cwd: join(__dirname, '../../../../agents'), env: environment, timeout: 45000 });
      const blockedResult = (await get('/runs/' + blocked.id).expect(200)).body;
      expect(blockedResult.status).toBe('error'); expect(blockedResult.results[1].observation.cleanup).toBe('clean'); expect(leases.size).toBe(0);
    } finally {
      if (server) await new Promise<void>(resolve => server?.close(() => resolve()));
      rmSync(directory, { recursive: true, force: true });
    }
  }, 200000);

  it('recovers an expired owner only through an authenticated super-admin session', async () => {
    const overview = (await get('').expect(200)).body;
    await database.manager.update(ProjectKey, { projectId: overview.project.id, role: 'owner' }, { expiresAt: new Date(0) });
    await get('').expect(401);
    const recovered = await request(app.getHttpServer()).post(`/api/auth/super-admin/organizations/${overview.project.id}/recover-owner`).set('Cookie', superAdminCookie).send({}).expect(201);
    expect((await get('', recovered.body.secret).expect(200)).body.audit.some(event => event.action === 'owner.recovered')).toBe(true);
  });

  it('fences cross-project reads, approvals and submissions', async () => {
    const run = await queued();
    const other = (await enroll({ ...project, applicationId: 'other' })).body.credential.secret;
    await get('/runs/' + run.id, other).expect(404);
    await post('/suites/' + run.suiteId + '/approve', other).send({}).expect(404);
    await post('/runs', other).send({ requestId: randomUUID(), suiteId: run.suiteId }).expect(409);
    await post('/claim', owner).send({}).expect(403);
  });

  it('requires approval, retains immutable revisions and reports coverage honestly', async () => {
    const first = (await post('/suites').send({ name: 'first', checks: [check] }).expect(201)).body;
    await post('/runs').send({ requestId: randomUUID(), suiteId: first.id }).expect(409);
    await post(`/suites/${first.id}/approve`).send({}).expect(201);
    await post('/suites').send({ name: 'weakened', previousId: first.id, checks: [{ ...check, expected: false }] }).expect(400);
    await post('/suites').send({ name: 'removed', previousId: first.id, checks: [{ ...check, id: 'replacement' }] }).expect(400);
    const revision = (await post('/suites').send({ name: 'second', previousId: first.id, checks: [{ ...check, path: '/v2/health' }] }).expect(201)).body;
    expect(revision).toMatchObject({ version: 2, approvedBy: null });
    expect((await database.manager.findOneByOrFail(AutonomousSuite, { id: first.id })).checks[0].expected).toBe(true);
    expect((await get('').expect(200)).body.coverage).toMatchObject({ mapped: 1, total: 2, gaps: ['logout'] });
  });

  it('deduplicates concurrent admission, enforces quota and only claims once', async () => {
    const approved = await suite();
    await database.manager.update(QaProject, { id: approved.projectId }, { dailyRunLimit: 1 });
    const input = { requestId: randomUUID(), suiteId: approved.id };
    const [first, second] = await Promise.all([post('/runs').send(input), post('/runs').send(input)]);
    expect(first.status).toBe(201); expect(second.body.id).toBe(first.body.id);
    await post('/runs').send({ ...input, requestId: randomUUID() }).expect(409);
    const claims = await Promise.all([post('/claim', runner).send({}), post('/claim', runner).send({})]);
    expect(claims.filter(response => response.body.id)).toHaveLength(1);
  });

  it('derives exact verdicts and forbids overwriting failures or missing evidence', async () => {
    const run = await queued();
    const claim = (await post('/claim', runner).send({}).expect(201)).body;
    const report = { token: claim.token, observations: [{ checkId: check.id, status: 200, error: '', actual: false }] };
    await post(`/runs/${run.id}/complete`, runner).send({ ...report, status: 'passed' }).expect(400);
    await post(`/runs/${run.id}/complete`, runner).send({ ...report, observations: [] }).expect(400);
    await post(`/runs/${run.id}/complete`, runner).send({ ...report, observations: [{ ...report.observations[0], actual: { nested: true } }] }).expect(400);
    expect((await post(`/runs/${run.id}/complete`, runner).send(report).expect(201)).body.status).toBe('failed');
    await post(`/runs/${run.id}/complete`, runner).send(report).expect(201);
    await post(`/runs/${run.id}/complete`, runner).send({ ...report, observations: [{ ...report.observations[0], actual: true }] }).expect(409);
    expect((await get('/runs/' + run.id).expect(200)).body.token).toBeUndefined();
  });

  it('fences another runner and treats missing or errored observations as uncertainty', async () => {
    const other = (await post('/keys').send({ role: 'runner', label: 'other runner', days: 1 }).expect(201)).body.secret;
    for (const observation of [{ checkId: check.id, status: 200, error: '' }, { checkId: check.id, status: 200, error: 'network_error', actual: true }]) {
      const run = await queued();
      const claim = (await post('/claim', runner).send({}).expect(201)).body;
      const report = { token: claim.token, observations: [observation] };
      await post(`/runs/${run.id}/complete`, other).send(report).expect(409);
      expect((await post(`/runs/${run.id}/complete`, runner).send(report).expect(201)).body.status).toBe('error');
    }
  });

  it('pauses active work, fences completion and interrupts expired runs without replay', async () => {
    const run = await queued();
    const claim = (await post('/claim', runner).send({}).expect(201)).body;
    await post('/pause').send({ paused: true }).expect(201);
    expect((await get('/runs/' + run.id).expect(200)).body.status).toBe('cancelled');
    await post(`/runs/${run.id}/complete`, runner).send({ token: claim.token, observations: [{ checkId: check.id, status: 200, error: '', actual: true }] }).expect(409);
    await post('/pause').send({ paused: false }).expect(201);
    const expired = await queued();
    await database.manager.update(AutonomousRun, expired.id, { deadline: new Date(0) });
    await post('/claim', runner).send({}).expect(201);
    expect((await get('/runs/' + expired.id).expect(200)).body.status).toBe('interrupted');
    expect((await get('').expect(200)).body.audit.some(event => event.action === 'run.interrupted')).toBe(true);
  });

  it('honors cancellation and deployment origin revocation without accepting a late pass', async () => {
    const cancelled = await queued();
    await post('/runs/' + cancelled.id + '/cancel').send({}).expect(201);
    expect((await get('/runs/' + cancelled.id).expect(200)).body.status).toBe('cancelled');
    const run = await queued();
    const claim = (await post('/claim', runner).send({}).expect(201)).body;
    process.env.AUTONOMY_ALLOWED_ORIGINS = '[]';
    await post(`/runs/${run.id}/complete`, runner).send({ token: claim.token, observations: [{ checkId: check.id, status: 200, error: '', actual: true }] }).expect(403);
    expect((await get('/runs/' + run.id).expect(200)).body.status).not.toBe('passed');
  });

  it('applies the production migration twice without losing project records', async () => {
    const connection = database.createQueryRunner(); await connection.connect();
    try {
      await connection.query('CREATE SCHEMA autonomy_migration_test'); await connection.query('SET search_path TO autonomy_migration_test');
      const sql = readFileSync(join(__dirname, '../../migrations/20260928-autonomy.sql'), 'utf8');
      await connection.query(sql);
      await connection.query(`INSERT INTO qa_projects (name, "workspaceId", "applicationId", environment, origins, targets, requirements) VALUES ('pilot', 'org', 'app', 'test', '[]', '[]', '["login"]')`);
      await connection.query(sql);
      expect((await connection.query('SELECT count(*)::int AS count FROM qa_projects'))[0].count).toBe(1);
      const benchmarks = readFileSync(join(__dirname, '../../migrations/20260928-benchmarks.sql'), 'utf8');
      await connection.query(benchmarks);
      await connection.query(`INSERT INTO qa_benchmarks ("projectId", "requestId", corpus, "corpusHash") SELECT id, gen_random_uuid(), '{}', 'migration-fixture' FROM qa_projects`);
      await connection.query(benchmarks);
      expect((await connection.query('SELECT count(*)::int AS count FROM qa_benchmarks'))[0].count).toBe(1);
      const identity = readFileSync(join(__dirname, '../../migrations/20260929-organization-auth.sql'), 'utf8');
      await connection.query(identity);
      await connection.query(identity);
      expect((await connection.query(`SELECT to_regclass('qa_org_members') AS members, to_regclass('qa_org_invitations') AS invitations, to_regclass('qa_auth_sessions') AS sessions, to_regclass('qa_oidc_attempts') AS oidc`))[0]).toMatchObject({ members: 'qa_org_members', invitations: 'qa_org_invitations', sessions: 'qa_auth_sessions', oidc: 'qa_oidc_attempts' });
    } finally {
      await connection.query('ROLLBACK'); await connection.query('SET search_path TO public'); await connection.query('DROP SCHEMA autonomy_migration_test CASCADE'); await connection.release();
    }
  });

  it('runs real TLS API checks through the Python worker and fail-closed CI/JUnit client', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'superqa-tls-'));
    const certificate = join(directory, 'cert.pem');
    const privateKey = join(directory, 'key.pem');
    let server: ReturnType<typeof createServer> | undefined;
    try {
      await promisify(execFile)('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=localhost', '-addext', 'subjectAltName=DNS:localhost', '-keyout', privateKey, '-out', certificate]);
      server = createServer({ key: readFileSync(privateKey), cert: readFileSync(certificate) }, (incoming, response) => {
        response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify({ ok: incoming.url === '/healthy' }));
      });
      await new Promise<void>(resolve => server?.listen(0, '127.0.0.1', resolve));
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('Fixture server did not start');
      const origin = `https://localhost:${address.port}`;
      process.env.AUTONOMY_ALLOWED_ORIGINS = JSON.stringify([origin]);
      owner = (await enroll({ ...project, origins: [origin] })).body.credential.secret;
      runner = (await post('/keys').send({ role: 'runner', label: 'real worker', days: 1 }).expect(201)).body.secret;
      const ciKey = (await post('/keys').send({ role: 'ci', label: 'ci', days: 1 }).expect(201)).body.secret;
      const environment = { ...process.env, PYTHONPATH: '.', BACKEND_API_URL: `${await app.getUrl()}/api`, AUTONOMY_ALLOWED_CIDRS: '["127.0.0.0/8", "::1/128"]', AUTONOMY_CA_FILE: certificate };
      for (const path of ['/healthy', '/defective']) {
        const created = (await post('/suites').send({ name: path, checks: [{ ...check, origin, path }] }).expect(201)).body;
        await post(`/suites/${created.id}/approve`).send({}).expect(201);
        const requestId = randomUUID();
        const run = (await post('/runs', ciKey).send({ requestId, suiteId: created.id }).expect(201)).body;
        await promisify(execFile)('python3', ['-m', 'shared.harness.autonomy', 'worker', '--once'], { cwd: join(__dirname, '../../../../agents'), env: { ...environment, AUTONOMY_PROJECT_KEY: runner }, timeout: 30000 });
        const completed = (await get('/runs/' + run.id).expect(200)).body;
        expect(completed.results).toMatchObject([{ observation: { error: '', actual: path === '/healthy' } }]);
        expect(completed.status).toBe(path === '/healthy' ? 'passed' : 'failed');
        const output = join(directory, path.slice(1) + '.xml');
        let exitCode = 0;
        try {
          await promisify(execFile)('python3', ['-m', 'shared.harness.autonomy', 'ci', created.id, '--request-id', requestId, '--output', output], { cwd: join(__dirname, '../../../../agents'), env: { ...environment, AUTONOMY_PROJECT_KEY: ciKey }, timeout: 30000 });
        } catch (error) { exitCode = error.code; }
        expect(exitCode).toBe(path === '/healthy' ? 0 : 1);
        expect(readFileSync(output, 'utf8')).toContain(path === '/healthy' ? 'failures="0"' : 'failures="1"');
      }
    } finally {
      if (server) await new Promise<void>(resolve => server?.close(() => resolve()));
      rmSync(directory, { recursive: true, force: true });
    }
  }, 90000);
});
