import { Test } from '@nestjs/testing';
import { Observable } from 'rxjs';
import { APP_GUARD } from '@nestjs/core';
import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import request from 'supertest';
import { createHash, createHmac, generateKeyPairSync, randomBytes, randomUUID, sign } from 'crypto';
import { readFileSync } from 'fs';
import { join } from 'path';
import { execFile, spawn } from 'child_process';
import { promisify } from 'util';
import { createServer } from 'net';
import { parse as parseEnvironment } from 'dotenv';
import { NextFunction, Request, Response } from 'express';
import { AuthService } from '../../src/modules/autonomy/auth.service';
import { AutonomyLockdownGuard } from '../../src/modules/autonomy/autonomy.controller';
import { ProjectKey, QaAuditEvent, QaProject } from '../../src/modules/autonomy/autonomy.entity';
import { QaAuthSession, QaOrgMember } from '../../src/modules/autonomy/identity.entity';
import { ChatController, ChatGuard, ChatHookController } from '../../src/modules/chat/chat.controller';
import { ChatActor, ChatService } from '../../src/modules/chat/chat.service';
import { ChatConnectors, decryptCredentials, encryptCredentials, teamsServiceUrl, verifyTeamsToken } from '../../src/modules/chat/chat.connectors';
import { ChatModel, mentioned, parseContent } from '../../src/modules/chat/chat.model';
import { chatEntities, ChatAgent, ChatChannel, ChatConversation, ChatDelivery, ChatInstallation, ChatMessage, ChatTask, ChatWork } from '../../src/modules/chat/chat.entity';
import { MeetingController, MeetingHookController } from '../../src/modules/chat/meeting.controller';
import { MeetingService } from '../../src/modules/chat/meeting.service';
import { MEETING_SERVICE } from '../../src/modules/chat/meeting.tokens';
import { MeetingModel, parseMeetingNotes } from '../../src/modules/chat/meeting.model';
import { MeetingProvider, meetingUrl } from '../../src/modules/chat/meeting.provider';
import { Meeting, MeetingEntry, MeetingPeer, MeetingRun, meetingEntities } from '../../src/modules/chat/meeting.entity';
import { VoiceService } from '../../src/modules/chat/voice.service';
import { VoiceProvider, LiveEvent } from '../../src/modules/chat/voice.provider';
import { MeetingVoice } from '../../src/modules/chat/voice.entity';
import { VoiceController, VoiceBridgeController } from '../../src/modules/chat/voice.controller';
import { AgentSession } from '../../src/modules/agents/entities/agent-session.entity';
import { AgentTask } from '../../src/modules/agents/entities/agent-task.entity';
import { AgentsService } from '../../src/modules/agents/agents.service';
import { AutonomyService } from '../../src/modules/autonomy/autonomy.service';
import { ChatRealtimeService } from '../../src/modules/chat/chat-realtime.service';

describe('scoped native chat and text integrations', () => {
  let database: DataSource; let app: INestApplication; let chat: ChatService; let connectors: ChatConnectors;
  let owner: ChatActor; let ownerCookie: string; let colleague: ChatActor; let colleagueCookie: string; let outsiderCookie: string;
  let agent: ChatAgent;
  let meetings: MeetingService; let meetingProvider: MeetingProvider;
  let voice: VoiceService; let voiceProvider: VoiceProvider;
  let superqaAgent: ChatAgent;
  const voiceAnswers = new Map<string, string>();
  const meetingModel = { compile: jest.fn() };
  const originalEnv = { ...process.env };
  const result = { content: { summary: 'Here is a test plan.', details: ['Check login and logout.'], task: { title: 'Review login coverage', description: 'Compare cases with the agreed requirements.' } }, usage: { inputTokens: 20, outputTokens: 15 } };
  const model = { respond: jest.fn(), detectMeetingJoinIntent: jest.fn().mockResolvedValue({ joining: false }) };
  const post = (path: string, cookie = ownerCookie) => request(app.getHttpServer()).post('/api/chat' + path).set('Cookie', cookie);
  const get = (path: string, cookie = ownerCookie) => request(app.getHttpServer()).get('/api/chat' + path).set('Cookie', cookie);
  const createConversation = async (kind = 'group', members = [colleague.memberId], withAgent = true) => (await post('/conversations').send({ kind, title: 'Release quality', memberIds: members, agentId: withAgent ? agent.id : null, instructions: 'Review quality questions.' }).expect(201)).body;
  const send = (id: string, text = '@Alex help plan testing', cookie = ownerCookie, requestId = randomUUID()) => post('/conversations/' + id + '/messages', cookie).send({ requestId, text });

  async function member(projectId: string, email: string, role: string) {
    const key = await database.manager.save(database.manager.create(ProjectKey, { projectId, digest: randomUUID(), role, label: email, expiresAt: new Date(Date.now() + 3600000) }));
    const account = await database.manager.save(database.manager.create(QaOrgMember, { projectId, email, keyId: key.id, passwordHash: null }));
    const token = 'qs_' + randomBytes(32).toString('hex');
    await database.manager.save(database.manager.create(QaAuthSession, { memberId: account.id, tokenDigest: createHash('sha256').update(token).digest('hex'), expiresAt: new Date(Date.now() + 3600000) }));
    return { actor: { memberId: account.id, projectId, keyId: key.id }, cookie: 'qa_session=' + token };
  }

  beforeAll(async () => {
    process.env.CHAT_WORKER_ENABLED = 'false';
    database = new DataSource({ type: 'postgres', host: '127.0.0.1', port: 55432, username: 'pipeline_test', password: 'pipeline_test', database: 'pipeline_test', synchronize: false, entities: [...chatEntities, ...meetingEntities, MeetingVoice, AgentSession, AgentTask, QaProject, ProjectKey, QaOrgMember, QaAuthSession, QaAuditEvent] });
    await database.initialize();
    const migration = readFileSync(join(__dirname, '../../migrations/20261003-chat.sql'), 'utf8');
    await database.query(migration); await database.query(migration);
    const meetingMigration = readFileSync(join(__dirname, '../../migrations/20261004-meetings.sql'), 'utf8');
    await database.query(meetingMigration); await database.query(meetingMigration);
    const voiceMigration = readFileSync(join(__dirname, '../../migrations/20261006-meeting-voice.sql'), 'utf8');
    await database.query(voiceMigration); await database.query(voiceMigration);
    const superqaKindMigration = readFileSync(join(__dirname, '../../migrations/20261113-chat-agent-superqa-kind.sql'), 'utf8');
    await database.query(superqaKindMigration); await database.query(superqaKindMigration);
    await database.synchronize();
    const module = await Test.createTestingModule({
      controllers: [ChatController, ChatHookController, MeetingController, MeetingHookController, VoiceController, VoiceBridgeController],
      providers: [AuthService, ChatGuard, ChatService, ChatConnectors, MeetingService, MeetingProvider, VoiceService, VoiceProvider,
        { provide: MEETING_SERVICE, useExisting: MeetingService },
        { provide: AgentsService, useValue: { chatForAutomation: async () => { throw new Error('Agents runtime not available in tests'); } } },
        { provide: AutonomyService, useValue: { status: async () => { throw new Error('Autonomy runtime not available in tests'); } } },
        { provide: ChatRealtimeService, useValue: { stream: () => new Observable() } },
        { provide: MeetingModel, useValue: meetingModel }, { provide: DataSource, useValue: database }, { provide: ChatModel, useValue: model }, { provide: APP_GUARD, useClass: AutonomyLockdownGuard }],
    }).compile();
    app = module.createNestApplication({ rawBody: true }); app.setGlobalPrefix('api');
    app.use((incoming: Request, _response: Response, next: NextFunction) => {
      const offer = incoming.headers['x-fixture-live-offer']; const answer = incoming.headers['x-fixture-live-answer'];
      if (typeof offer === 'string' && typeof answer === 'string') voiceAnswers.set(offer, Buffer.from(answer, 'base64').toString('utf8'));
      next();
    });
    await app.listen(0, '127.0.0.1');
    chat = module.get(ChatService); connectors = module.get(ChatConnectors);
    meetings = module.get(MeetingService); meetingProvider = module.get(MeetingProvider);
    voice = module.get(VoiceService); voiceProvider = module.get(VoiceProvider);
  });
  beforeEach(async () => {
    delete process.env.MEETING_LIVE_ENABLED;
    await database.query('TRUNCATE chat_meeting_voice');
    process.env.AUTONOMY_LOCKDOWN = 'true'; process.env.CHAT_SECRET_KEY = 'ab'.repeat(32); process.env.CHAT_DAILY_REPLY_LIMIT = '100';
    await database.query('TRUNCATE chat_meetings, chat_meeting_peers, chat_meeting_signals, chat_meeting_entries, chat_meeting_runs, chat_deliveries, chat_channels, chat_installations, chat_work, chat_tasks, chat_messages, chat_conversations, chat_agents, agent_tasks, agent_sessions, qa_auth_sessions, qa_org_members, qa_project_keys, qa_projects, qa_audit_events CASCADE');
    const project = await database.manager.save(database.manager.create(QaProject, { name: 'Chat test', workspaceId: 'org', applicationId: 'app', environment: 'test', origins: [], targets: [], requirements: [] }));
    const admin = await member(project.id, 'owner@chat.test', 'owner'); owner = admin.actor; ownerCookie = admin.cookie;
    const other = await member(project.id, 'person@chat.test', 'admin'); colleague = other.actor; colleagueCookie = other.cookie;
    const otherProject = await database.manager.save(database.manager.create(QaProject, { name: 'Other org', workspaceId: 'other', applicationId: 'app', environment: 'test', origins: [], targets: [], requirements: [] }));
    outsiderCookie = (await member(otherProject.id, 'outsider@chat.test', 'owner')).cookie;
    const directory = (await get('/directory').expect(200)).body;
    agent = (await post('/agents/' + directory.agents.find(item => item.kind === 'qae').id).send({ name: 'Alex' }).expect(201)).body;
    // Meetings are Super QA-only (see MeetingService.create); meeting fixtures must use this
    // agent, not the QAE one above, which stays for the general chat/installation tests.
    superqaAgent = directory.agents.find(item => item.kind === 'superqa');
    model.respond.mockReset().mockResolvedValue(result);
    delete process.env.RECALL_API_KEY; delete process.env.RECALL_WEBHOOK_SECRET; delete process.env.MEETING_PUBLIC_API_URL;
    process.env.AUTH_PUBLIC_URL = 'http://localhost:3000';
    meetingModel.compile.mockReset().mockImplementation(async (_instructions, entries, kind) => ({ result: { summary: 'The team discussed login coverage.', items: [{ kind: 'action', text: 'Review the login tests.', evidence: [entries[0].id] }], reply: kind === 'reply' ? 'Which login flows are release-critical?' : null }, usage: { total_tokens: 50 } }));
  });
  afterEach(async () => { await voice.onModuleDestroy(); jest.restoreAllMocks(); });
  afterAll(async () => { process.env = originalEnv; await app?.close(); if (database?.isInitialized) await database.destroy(); });

  it('requires member sessions, protects private chats, and rejects cross-organization participants', async () => {
    await request(app.getHttpServer()).get('/api/chat/directory').expect(401);
    await post('/agents/' + agent.id, colleagueCookie).send({ name: 'Other' }).expect(403);
    const conversation = await createConversation('direct', [colleague.memberId], false);
    await get('/conversations/' + conversation.id, colleagueCookie).expect(200);
    await get('/conversations/' + conversation.id, outsiderCookie).expect(404);
    expect((await get('/conversations', outsiderCookie).expect(200)).body).toHaveLength(0);
    const uninvited = await member(owner.projectId, 'private@chat.test', 'member');
    await get('/conversations/' + conversation.id, uninvited.cookie).expect(404);
    await send(conversation.id, 'cannot send', uninvited.cookie).expect(404);
    await post('/conversations').send({ kind: 'group', title: 'Invalid', memberIds: [randomUUID()], instructions: '' }).expect(400);
    await post('/conversations').set('Origin', 'https://evil.test').send({ kind: 'group', title: 'Invalid', memberIds: [], instructions: '' }).expect(403);
  });

  it('deduplicates direct chats and messages, preserves replies, and paginates without gaps', async () => {
    const conversation = await createConversation('direct', [colleague.memberId], false);
    expect((await createConversation('direct', [colleague.memberId], false)).id).toBe(conversation.id);
    const requestId = randomUUID();
    const [first, duplicate] = await Promise.all([send(conversation.id, 'Hello', ownerCookie, requestId), send(conversation.id, 'Hello', ownerCookie, requestId)]);
    expect(first.status).toBe(201); expect(duplicate.body.id).toBe(first.body.id);
    await send(conversation.id, 'Changed', ownerCookie, requestId).expect(409);
    await post('/conversations/' + conversation.id + '/messages', colleagueCookie).send({ requestId: randomUUID(), text: 'Hello back', replyToId: first.body.id }).expect(201);
    for (let index = 0; index < 51; index++) await send(conversation.id, 'Message ' + index).expect(201);
    const page = (await get('/conversations/' + conversation.id).expect(200)).body;
    expect(page.messages).toHaveLength(50); expect(page.hasMore).toBe(true);
    const older = (await get('/conversations/' + conversation.id + '?before=' + page.messages[0].id).expect(200)).body;
    expect(older.messages).toHaveLength(3); expect(older.hasMore).toBe(false);
    expect(new Set([...page.messages, ...older.messages].map(message => message.id)).size).toBe(53);
  });

  it('provides exactly QAE, AUE and Super QA, allows names only, and keeps their roles distinct', async () => {
    const first = (await get('/directory').expect(200)).body.agents;
    expect(first.map(item => item.kind).sort()).toEqual(['aue', 'qae', 'superqa']);
    expect((await get('/directory').expect(200)).body.agents.map(item => item.id)).toEqual(first.map(item => item.id));
    await post('/agents').send({ name: 'Custom agent' }).expect(404);
    await post('/agents/' + agent.id).send({ name: 'Custom', kind: 'custom' }).expect(400);
    await post('/agents/' + agent.id).send({ name: 'Custom', instructions: 'Change your role' }).expect(400);
    await post('/agents/' + agent.id).send({ name: 'Custom', aliases: ['Custom'], email: 'custom@test.com' }).expect(400);
    const aue = first.find(item => item.kind === 'aue');
    const renamed = (await post('/agents/' + aue.id).send({ name: 'Jordan' }).expect(201)).body;
    expect(renamed).toMatchObject({ id: aue.id, kind: 'aue', name: 'Jordan' });
    const conversation = (await post('/conversations').send({ kind: 'direct', title: 'Jordan', memberIds: [], agentId: aue.id, instructions: 'Help with automation planning.' }).expect(201)).body;
    await send(conversation.id, 'Review our CI checks').expect(201);
    await chat.processOne();
    expect(model.respond).toHaveBeenCalledWith('Jordan', expect.stringContaining('Automation Engineer (AUE)'), expect.any(Array), false);
    expect(await database.manager.count(ChatAgent, { where: { projectId: owner.projectId } })).toBe(3);
  });

  it('invokes only mentioned agents in groups, saves structured replies, and creates tasks once', async () => {
    const conversation = await createConversation();
    await send(conversation.id, 'Discussion without invoking an agent').expect(201);
    expect(await chat.processOne()).toBe(false);
    await send(conversation.id).expect(201);
    await Promise.all([chat.processOne(), chat.processOne()]);
    expect(model.respond).toHaveBeenCalledTimes(1);
    expect(model.respond.mock.calls[0][2].map(message => message.text)).toContain('@Alex help plan testing');
    const detail = (await get('/conversations/' + conversation.id).expect(200)).body;
    const response = detail.messages.find(message => message.authorKind === 'agent');
    expect(response).toMatchObject({ status: 'sent', content: result.content });
    const path = '/conversations/' + conversation.id + '/messages/' + response.id + '/task';
    const task = (await post(path).send({}).expect(201)).body;
    expect((await post(path).send({}).expect(201)).body.id).toBe(task.id);
    await post('/conversations/' + conversation.id + '/tasks/' + task.id + '/done').send({}).expect(201);
    expect((await database.manager.findOneByOrFail(ChatTask, { id: task.id })).status).toBe('done');
  });

  it('asks the agent to turn a referenced message into one supported task for both task lists', async () => {
    const conversation = await createConversation();
    const source = (await send(conversation.id, 'The checkout flow fails when the cart has expired; reproduce it and add a regression check.').expect(201)).body;
    // The task request must quote the selected source message so older context is still available to the model.
    const requestMessage = (await post('/conversations/' + conversation.id + '/messages', ownerCookie).send({ requestId: randomUUID(), text: '@Alex create a task from this message', replyToId: source.id }).expect(201)).body;
    await chat.processOne();
    expect(model.respond).toHaveBeenLastCalledWith('Alex', expect.any(String), expect.arrayContaining([expect.objectContaining({ id: source.id })]), true);
    const task = await database.manager.findOneByOrFail(ChatTask, { messageId: source.id });
    expect(task).toMatchObject({ title: result.content.task.title, description: result.content.task.description, conversationId: conversation.id });
    const agentTask = await database.manager.findOneByOrFail(AgentTask, { title: task.title });
    expect(agentTask).toMatchObject({ title: task.title, description: task.description, agentType: 'qae', status: 'todo', labels: ['chat'] });
    expect((await get('/conversations/' + conversation.id).expect(200)).body.tasks).toContainEqual(expect.objectContaining({ id: task.id, messageId: source.id }));
    expect(requestMessage.text).toContain('@Alex create a task from this message');
  });

  it('replies in chat without creating a task when the referenced discussion is not actionable', async () => {
    const conversation = await createConversation();
    const source = (await send(conversation.id, 'Nice idea.').expect(201)).body;
    model.respond.mockResolvedValueOnce({ content: { summary: 'I could not identify a concrete next step to turn into a task.', details: [], task: null }, usage: { inputTokens: 10, outputTokens: 10 } });
    await post('/conversations/' + conversation.id + '/messages', ownerCookie).send({ requestId: randomUUID(), text: '@Alex create a task from this message', replyToId: source.id }).expect(201);
    await chat.processOne();
    expect(await database.manager.count(ChatTask)).toBe(0);
    expect(await database.manager.count(AgentTask)).toBe(0);
    const detail = (await get('/conversations/' + conversation.id).expect(200)).body;
    expect(detail.messages.some(message => message.authorKind === 'agent' && message.status === 'sent' && message.content?.summary.includes('concrete next step'))).toBe(true);
  });

  it('fences policy changes and interrupted work without automatic model retries', async () => {
    const conversation = await createConversation();
    await send(conversation.id).expect(201);
    model.respond.mockImplementationOnce(async () => {
      await chat.policy(owner, conversation.id, { agentId: null, memberIds: [owner.memberId, colleague.memberId], instructions: 'Changed' });
      return result;
    });
    await chat.processOne();
    expect((await database.manager.findOneByOrFail(ChatMessage, { conversationId: conversation.id, authorKind: 'agent' })).status).toBe('failed');
    expect(await chat.processOne()).toBe(false);
    await chat.policy(owner, conversation.id, { agentId: agent.id, memberIds: [owner.memberId], instructions: '' });
    await send(conversation.id).expect(201);
    await database.manager.update(ChatWork, { status: 'queued' }, { status: 'running', leaseUntil: new Date(0) });
    await chat.processOne();
    expect(await database.manager.count(ChatWork, { where: { status: 'running' } })).toBe(0);
    expect(model.respond).toHaveBeenCalledTimes(1);
  });

  it('bounds agent calls and preserves human messaging when the quota is reached', async () => {
    process.env.CHAT_DAILY_REPLY_LIMIT = '1';
    const conversation = await createConversation();
    await send(conversation.id).expect(201); await send(conversation.id).expect(201);
    expect(await database.manager.count(ChatWork)).toBe(1);
    expect(await database.manager.count(ChatMessage, { where: { status: 'failed' } })).toBe(1);
    await send(conversation.id, 'Humans can still chat').expect(201);
  });

  async function slack() {
    jest.spyOn(connectors, 'json').mockResolvedValueOnce({ ok: true, team_id: 'T123', user_id: 'U456' }).mockResolvedValueOnce({ ok: true, channel: { name: 'release' } });
    const installation = (await post('/installations').send({ provider: 'slack', name: 'Slack pilot', providerId: 'T123', botId: 'U456', token: 'xoxb-test-secret', signingSecret: 'test-signing-secret' }).expect(201)).body;
    const event = { type: 'event_callback', team_id: 'T123', event: { type: 'app_mention', channel: 'C123', user: 'U789', text: '<@U456> review release', ts: '123.456' } };
    const incoming = (body = event, signed = true) => {
      const timestamp = String(Math.floor(Date.now() / 1000)); const raw = JSON.stringify(body);
      return request(app.getHttpServer()).post('/api/chat-hooks/slack/' + installation.id).set('Content-Type', 'application/json').set('x-slack-request-timestamp', timestamp).set('x-slack-signature', signed ? 'v0=' + createHmac('sha256', 'test-signing-secret').update('v0:' + timestamp + ':' + raw).digest('hex') : 'v0=' + '0'.repeat(64)).send(raw);
    };
    await incoming().expect(200);
    expect(await database.manager.count(ChatMessage)).toBe(0);
    const conversation = (await post('/installations/' + installation.id + '/conversations').send({ title: 'Slack release', externalId: 'C123', memberIds: [], instructions: 'Help review release risks.' }).expect(201)).body;
    return { installation, conversation, event, incoming };
  }

  it('verifies Slack signatures, discovers channels, deduplicates events and sends threaded replies', async () => {
    const { installation, conversation, event, incoming } = await slack();
    expect(installation.secret).toBeUndefined();
    await incoming(event, false).expect(401);
    await incoming({ ...event, team_id: 'OTHER' }).expect(401);
    await incoming().expect(200); await incoming().expect(200);
    expect(await database.manager.count(ChatWork)).toBe(1);
    await chat.processOne();
    const provider = jest.spyOn(connectors, 'json').mockResolvedValueOnce({ ok: true, ts: 'reply-id' });
    await connectors.deliverOne();
    expect(provider).toHaveBeenLastCalledWith('https://slack.com/api/chat.postMessage', expect.objectContaining({ body: expect.stringContaining('"thread_ts":"123.456"') }));
    expect((await get('/conversations/' + conversation.id).expect(200)).body.deliveries[0].status).toBe('sent');
    await post('/installations/' + installation.id + '/disconnect').send({}).expect(201);
    await incoming().expect(404);
  });

  it('marks uncertain external delivery without blindly posting again', async () => {
    const { incoming } = await slack(); await incoming().expect(200); await chat.processOne();
    jest.spyOn(connectors, 'json').mockRejectedValueOnce(new Error('timeout after remote write'));
    await connectors.deliverOne(); expect((await database.manager.find(ChatDelivery))[0].status).toBe('uncertain');
    expect(await connectors.deliverOne()).toBe(false);
  });

  it('encrypts credentials with tenant-bound authenticated encryption', () => {
    const encrypted = encryptCredentials({ token: 'secret' }, 'org:installation');
    expect(encrypted).not.toContain('secret'); expect(decryptCredentials(encrypted, 'org:installation')).toEqual({ token: 'secret' });
    expect(() => decryptCredentials(encrypted, 'other:installation')).toThrow();
    expect(() => decryptCredentials(encrypted.slice(0, -3), 'org:installation')).toThrow();
  });

  it('validates Teams signatures, audience, tenant, service URL, expiry and channel endorsements', () => {
    const pair = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const key = { ...pair.publicKey.export({ format: 'jwk' }), kid: 'test', endorsements: ['msteams'] };
    const installation = Object.assign(new ChatInstallation(), { botId: randomUUID(), providerId: randomUUID() });
    const body = { serviceUrl: 'https://smba.trafficmanager.net/teams/', channelId: 'msteams', channelData: { tenant: { id: installation.providerId } } };
    const claims = { iss: 'https://api.botframework.com', aud: installation.botId, nbf: Date.now() / 1000 - 10, exp: Date.now() / 1000 + 300, serviceurl: body.serviceUrl };
    const token = (payload = claims) => { const unsigned = Buffer.from(JSON.stringify({ alg: 'RS256', kid: 'test' })).toString('base64url') + '.' + Buffer.from(JSON.stringify(payload)).toString('base64url'); return 'Bearer ' + unsigned + '.' + sign('RSA-SHA256', Buffer.from(unsigned), pair.privateKey).toString('base64url'); };
    expect(() => verifyTeamsToken(token(), body, installation.botId, installation.providerId, [key as any])).not.toThrow();
    expect(() => verifyTeamsToken(token({ ...claims, aud: 'wrong' }), body, installation.botId, installation.providerId, [key as any])).toThrow();
    expect(() => verifyTeamsToken(token({ ...claims, exp: 0 }), body, installation.botId, installation.providerId, [key as any])).toThrow();
    expect(() => verifyTeamsToken(token(), { ...body, serviceUrl: 'https://evil.example' }, installation.botId, installation.providerId, [key as any])).toThrow();
    expect(() => verifyTeamsToken(token(), body, installation.botId, installation.providerId, [{ ...key, endorsements: [] } as any])).toThrow();
    expect(() => verifyTeamsToken(token(), body, installation.botId, null, [key as any])).not.toThrow();
    expect(() => verifyTeamsToken(token(), body, installation.botId, randomUUID(), [key as any])).toThrow();
    expect(() => teamsServiceUrl('https://smba.trafficmanager.net.evil.example/teams/')).toThrow();
    expect(() => teamsServiceUrl('http://127.0.0.1/')).toThrow();
  });

  it('validates response shape and invokes names without substring collisions', () => {
    expect(parseContent(JSON.stringify(result.content))).toEqual(result.content);
    expect(() => parseContent('{"summary":"done","details":[]}')).toThrow();
    expect(mentioned('Alex, help us', ['Alex'])).toBe(true);
    expect(mentioned('Ask Alexander', ['Alex'])).toBe(false);
    expect(mentioned('@Quality pal help', ['Quality pal'])).toBe(true);
  });

  it('stops queued work after membership removal or account revocation', async () => {
    const conversation = await createConversation();
    await send(conversation.id, '@Alex please help', colleagueCookie).expect(201);
    await database.manager.update(QaOrgMember, colleague.memberId, { active: false });
    await chat.processOne();
    expect(model.respond).not.toHaveBeenCalled();
    await get('/conversations/' + conversation.id, colleagueCookie).expect(401);
    expect((await database.manager.findOneByOrFail(ChatWork, { conversationId: conversation.id })).status).toBe('failed');
  });

  it('handles signed Teams activities end to end with a scoped threaded response', async () => {
    const tenant = randomUUID(); const appId = randomUUID();
    const remote = jest.spyOn(connectors, 'json').mockResolvedValueOnce({ access_token: 'teams-access-token' });
    const installation = (await post('/installations').send({ provider: 'teams', name: 'Teams pilot', providerId: tenant, botId: appId, token: 'teams-client-secret' }).expect(201)).body;
    const pair = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const key = { ...pair.publicKey.export({ format: 'jwk' }), kid: 'teams-fixture', endorsements: ['msteams'] };
    remote.mockResolvedValueOnce({ keys: [key] });
    const body = { type: 'message', id: 'activity-1', text: '<at>Alex</at> review release', channelId: 'msteams', serviceUrl: 'https://smba.trafficmanager.net/teams/', channelData: { tenant: { id: tenant } }, from: { id: 'user-1', name: 'Teammate' }, recipient: { id: 'bot-1' }, conversation: { id: 'conversation-1', name: 'Release channel', conversationType: 'channel' }, entities: [{ type: 'mention', mentioned: { id: 'bot-1' } }] };
    const claims = { iss: 'https://api.botframework.com', aud: appId, nbf: Date.now() / 1000 - 10, exp: Date.now() / 1000 + 300, serviceurl: body.serviceUrl };
    const unsigned = Buffer.from(JSON.stringify({ alg: 'RS256', kid: key.kid })).toString('base64url') + '.' + Buffer.from(JSON.stringify(claims)).toString('base64url');
    const token = 'Bearer ' + unsigned + '.' + sign('RSA-SHA256', Buffer.from(unsigned), pair.privateKey).toString('base64url');
    const inbound = () => request(app.getHttpServer()).post('/api/chat-hooks/teams/' + installation.id).set('Authorization', token).send(body);
    await inbound().expect(200);
    await post('/installations/' + installation.id + '/conversations').send({ title: 'Release channel', externalId: 'conversation-1', memberIds: [], instructions: 'Help the team.' }).expect(201);
    await inbound().expect(200); await inbound().expect(200);
    expect(await database.manager.count(ChatWork)).toBe(1);
    await chat.processOne();
    remote.mockResolvedValueOnce({ access_token: 'teams-send-token' }).mockResolvedValueOnce({ id: 'sent-activity' });
    await connectors.deliverOne();
    expect(remote).toHaveBeenLastCalledWith('https://smba.trafficmanager.net/teams/v3/conversations/conversation-1/activities/activity-1', expect.objectContaining({ body: expect.stringContaining('Here is a test plan.') }));
    expect((await database.manager.find(ChatDelivery))[0]).toMatchObject({ status: 'sent', externalId: 'sent-activity' });
  });

  it('connects a new Teams tenant via Microsoft admin consent on the shared endpoint', async () => {
    process.env.TEAMS_SHARED_APP_ID = randomUUID();
    process.env.TEAMS_SHARED_APP_SECRET = 'shared-app-secret-0123456789';
    process.env.API_URL = 'https://api.example.test';
    const sharedAppId = process.env.TEAMS_SHARED_APP_ID;
    const { url } = (await get('/installations/teams/connect-url').expect(200)).body;
    const consentUrl = new URL(url);
    expect(consentUrl.origin + consentUrl.pathname).toBe('https://login.microsoftonline.com/organizations/adminconsent');
    expect(consentUrl.searchParams.get('client_id')).toBe(sharedAppId);
    expect(consentUrl.searchParams.get('redirect_uri')).toBe('https://api.example.test/api/chat-hooks/teams/consent');
    const state = consentUrl.searchParams.get('state')!;
    const tenant = randomUUID();
    const redirect = await request(app.getHttpServer()).get('/api/chat-hooks/teams/consent').query({ tenant, admin_consent: 'True', state }).expect(302);
    expect(redirect.headers.location).toContain('/integrations?installation_connected=teams');
    const installation = await database.manager.findOneByOrFail(ChatInstallation, { provider: 'teams', providerId: tenant });
    expect(installation).toMatchObject({ botId: sharedAppId, name: 'Microsoft Teams', enabled: true });
    expect(installation.agentIds.length).toBe(1);
    // A tenant already connected to a different organization must not be silently reassigned.
    const otherUrl = new URL((await get('/installations/teams/connect-url', outsiderCookie).expect(200)).body.url);
    const rejected = await request(app.getHttpServer()).get('/api/chat-hooks/teams/consent').query({ tenant, admin_consent: 'True', state: otherUrl.searchParams.get('state')! }).expect(302);
    expect(rejected.headers.location).toContain('/integrations?error=');
    expect(await database.manager.count(ChatInstallation, { where: { providerId: tenant } })).toBe(1);
  });

  const createMeeting = async (mode: 'notes' | 'active' = 'notes', provider: 'native' | 'teams' | 'google_meet' = 'native', url?: string) => {
    const conversation = await createConversation();
    return (await post('/meetings').send({ conversationId: conversation.id, requestId: randomUUID(), agentId: superqaAgent.id, mode, provider, ...(url ? { url } : {}), consent: true }).expect(201)).body;
  };
  const joinMeeting = async (id: string, cookie = ownerCookie) => {
    const sessionId = randomUUID(); await post('/meetings/' + id + '/join', cookie).send({ sessionId, consent: true }).expect(201); return sessionId;
  };
  const addEntry = (id: string, sessionId: string, text = 'We need to review login tests.') => post('/meetings/' + id + '/entries').send({ sessionId, requestId: randomUUID(), text, source: 'manual' }).expect(201);
  const queueNotes = (id: string, kind = 'notes') => post('/meetings/' + id + '/runs').send({ requestId: randomUUID(), kind, prompt: '' }).expect(201);

  it('automatically ends empty native calls while keeping calls with active participants live', async () => {
    const empty = await createMeeting();
    await database.manager.update(Meeting, empty.id, { createdAt: new Date(Date.now() - 120000) });
    const attended = await createMeeting();
    await joinMeeting(attended.id);
    await database.manager.update(Meeting, attended.id, { createdAt: new Date(Date.now() - 120000) });
    Object.assign(meetings, { maintainedAt: 0 });

    await meetings.maintain();

    expect(await database.manager.findOneByOrFail(Meeting, { id: empty.id })).toMatchObject({ stopped: true, status: 'ended' });
    expect(await database.manager.findOneByOrFail(Meeting, { id: attended.id })).toMatchObject({ stopped: false, status: 'live' });
  });

  it('ends a native call when its last participant leaves and queues their notes once', async () => {
    const meeting = await createMeeting(); const ownerSession = await joinMeeting(meeting.id);
    const colleagueSession = await joinMeeting(meeting.id, colleagueCookie);
    await addEntry(meeting.id, ownerSession);
    await post('/meetings/' + meeting.id + '/leave').send({ sessionId: ownerSession }).expect(201);
    expect((await get('/meetings/' + meeting.id).expect(200)).body.meeting.stopped).toBe(false);
    await post('/meetings/' + meeting.id + '/leave', colleagueCookie).send({ sessionId: colleagueSession }).expect(201);
    await post('/meetings/' + meeting.id + '/leave', colleagueCookie).send({ sessionId: colleagueSession }).expect(201);
    expect((await get('/meetings/' + meeting.id).expect(200)).body.meeting.status).toBe('ended');
    expect(await database.manager.count(MeetingRun, { where: { meetingId: meeting.id, kind: 'notes' } })).toBe(1);
  });

  it('requires meeting consent, tenant membership, fixed agents and unique dispatch IDs', async () => {
    const conversation = await createConversation();
    const body = { conversationId: conversation.id, requestId: randomUUID(), agentId: superqaAgent.id, mode: 'notes', provider: 'native', consent: true };
    await post('/meetings').send({ ...body, consent: false }).expect(400);
    await post('/meetings', outsiderCookie).send(body).expect(404);
    await post('/meetings').send({ ...body, agentId: randomUUID() }).expect(400);
    const meeting = (await post('/meetings').send(body).expect(201)).body;
    expect((await post('/meetings').send(body).expect(201)).body.id).toBe(meeting.id);
    await post('/meetings').send({ ...body, mode: 'active' }).expect(409);
    await get('/meetings/' + meeting.id, outsiderCookie).expect(404);
    await post('/meetings/' + meeting.id + '/join').send({ sessionId: randomUUID(), consent: false }).expect(400);
    await addEntry(meeting.id, await joinMeeting(meeting.id));
    await post('/meetings/' + meeting.id + '/end', colleagueCookie).send({}).expect(403);
    await post('/meetings/' + meeting.id + '/end').send({}).expect(201);
    await post('/meetings/' + meeting.id + '/join').send({ sessionId: randomUUID(), consent: true }).expect(409);
  });

  it('scopes WebRTC signals to joined sessions, rejects forged transcripts and revokes removed members', async () => {
    const meeting = await createMeeting(); const ownerSession = await joinMeeting(meeting.id); const peerSession = await joinMeeting(meeting.id, colleagueCookie);
    await post('/meetings/' + meeting.id + '/entries').send({ sessionId: ownerSession, requestId: randomUUID(), source: 'provider', speaker: 'Impersonated', text: 'Forged' }).expect(400);
    const signal = { sessionId: ownerSession, requestId: randomUUID(), recipient: peerSession, payload: { type: 'offer', sdp: 'test-sdp' } };
    await post('/meetings/' + meeting.id + '/signal').send(signal).expect(201);
    await post('/meetings/' + meeting.id + '/signal').send(signal).expect(201);
    const poll = (await post('/meetings/' + meeting.id + '/poll', colleagueCookie).send({ sessionId: peerSession, after: 0 }).expect(201)).body;
    expect(poll.signals).toHaveLength(1);
    await post('/meetings/' + meeting.id + '/signal', colleagueCookie).send(signal).expect(403);
    await post('/meetings/' + meeting.id + '/signal').send({ ...signal, requestId: randomUUID(), recipient: randomUUID() }).expect(400);
    await post('/conversations/' + meeting.conversationId + '/policy').send({ memberIds: [owner.memberId], agentId: agent.id, instructions: '' }).expect(201);
    await post('/meetings/' + meeting.id + '/poll', colleagueCookie).send({ sessionId: peerSession, after: 0 }).expect(404);
    const remaining = (await post('/meetings/' + meeting.id + '/poll').send({ sessionId: ownerSession, after: 0 }).expect(201)).body;
    expect(remaining.peers.map(peer => peer.memberId)).toEqual([owner.memberId]);
  });

  it('compiles silent evidence-linked notes and publishes reviewed proposals exactly once', async () => {
    const meeting = await createMeeting(); const session = await joinMeeting(meeting.id); const entry = (await addEntry(meeting.id, session)).body;
    await post('/meetings/' + meeting.id + '/runs').send({ requestId: randomUUID(), kind: 'reply', prompt: '' }).expect(403);
    const run = (await queueNotes(meeting.id)).body;
    await Promise.all([meetings.processOne(), meetings.processOne()]);
    expect(meetingModel.compile).toHaveBeenCalledTimes(1);
    const completed = await database.manager.findOneByOrFail(MeetingRun, { id: run.id });
    expect(completed.status).toBe('done'); expect(completed.result?.reply).toBeNull(); expect(completed.evidenceIds).toEqual([entry.id]);
    expect(await database.manager.count(ChatTask)).toBe(0);
    const message = (await post('/meetings/' + meeting.id + '/runs/' + run.id + '/publish').send({}).expect(201)).body;
    expect((await post('/meetings/' + meeting.id + '/runs/' + run.id + '/publish').send({}).expect(201)).body.id).toBe(message.id);
    await post('/conversations/' + meeting.conversationId + '/messages/' + message.id + '/task').send({}).expect(201);
    expect(await database.manager.count(ChatTask)).toBe(1);
    expect(() => parseMeetingNotes(JSON.stringify({ summary: 'Invented', items: [{ kind: 'action', text: 'Act', evidence: [randomUUID()] }], reply: null }), [entry], 'notes')).toThrow('Invalid meeting evidence');
  });

  it('fences active contributions when the meeting ends during reasoning, but allows final notes', async () => {
    const meeting = await createMeeting('active'); await addEntry(meeting.id, await joinMeeting(meeting.id));
    const run = (await queueNotes(meeting.id, 'reply')).body;
    const original = meetingModel.compile.getMockImplementation()!;
    meetingModel.compile.mockImplementationOnce(async (...args) => { await meetings.end(owner, meeting.id); return original(...args); });
    await meetings.processOne();
    expect((await database.manager.findOneByOrFail(MeetingRun, { id: run.id })).status).toBe('failed');
    const final = (await queueNotes(meeting.id)).body; await meetings.processOne();
    expect((await database.manager.findOneByOrFail(MeetingRun, { id: final.id })).status).toBe('done');
  });

  it('rejects unsupported providers and unsafe URLs without making provider calls', async () => {
    const remote = jest.spyOn(meetingProvider, 'request');
    const conversation = await createConversation();
    const body = { conversationId: conversation.id, requestId: randomUUID(), agentId: agent.id, mode: 'notes', provider: 'slack', consent: true };
    await post('/meetings').send(body).expect(400);
    await post('/meetings').send({ ...body, provider: 'google_meet', url: 'https://meet.google.com/abc-defg-hij' }).expect(503);
    for (const url of ['http://meet.google.com/abc-defg-hij', 'https://meet.google.com.evil.test/abc-defg-hij', 'https://user:secret@meet.google.com/abc-defg-hij', 'https://127.0.0.1/']) expect(() => meetingUrl('google_meet', url)).toThrow();
    expect(remote).not.toHaveBeenCalled();
  });

  it('authorizes native voice only for joined active participants and rate-limits playback', async () => {
    const meeting = await createMeeting('active'); const session = await joinMeeting(meeting.id); await addEntry(meeting.id, session);
    const run = (await queueNotes(meeting.id, 'reply')).body; await meetings.processOne();
    await post('/meetings/' + meeting.id + '/runs/' + run.id + '/play').send({ sessionId: randomUUID() }).expect(403);
    await post('/meetings/' + meeting.id + '/runs/' + run.id + '/play').send({ sessionId: session }).expect(201);
    expect((await database.manager.findOneByOrFail(MeetingRun, { id: run.id })).voiceAt).not.toBeNull();
    await post('/meetings/' + meeting.id + '/runs/' + run.id + '/play').send({ sessionId: session }).expect(409);
    await post('/meetings/' + meeting.id + '/end').send({}).expect(201);
    await post('/meetings/' + meeting.id + '/runs/' + run.id + '/play').send({ sessionId: session }).expect(409);
  });

  it('fails closed before model spend after member revocation and never replays an expired run', async () => {
    const meeting = await createMeeting(); await addEntry(meeting.id, await joinMeeting(meeting.id));
    const run = (await queueNotes(meeting.id)).body;
    await database.manager.update(QaOrgMember, owner.memberId, { active: false });
    await meetings.processOne(); expect(meetingModel.compile).not.toHaveBeenCalled();
    expect((await database.manager.findOneByOrFail(MeetingRun, { id: run.id })).status).toBe('failed');
    await database.manager.update(QaOrgMember, owner.memberId, { active: true });
    await database.manager.update(MeetingRun, run.id, { status: 'running', startedAt: new Date(Date.now() - 120000) });
    await meetings.processOne(); expect(meetingModel.compile).not.toHaveBeenCalled();
    expect((await database.manager.findOneByOrFail(MeetingRun, { id: run.id })).status).toBe('failed');
  });

  it('verifies external transcripts, deduplicates events and delivers only active requested replies', async () => {
    process.env.RECALL_API_KEY = 'fixture'; process.env.RECALL_WEBHOOK_SECRET = 'whsec_' + Buffer.alloc(32, 7).toString('base64'); process.env.MEETING_PUBLIC_API_URL = 'https://api.example.test';
    const botId = randomUUID(); const remote = jest.spyOn(meetingProvider, 'request').mockResolvedValue({ id: botId });
    const meeting = await createMeeting('active', 'google_meet', 'https://meet.google.com/abc-defg-hij');
    expect(remote).toHaveBeenCalledWith('bot/', expect.objectContaining({ bot_name: 'Super QA (Super QA)', recording_config: expect.objectContaining({ video_mixed_mp4: null }) }));
    const payload = JSON.stringify({ event: 'transcript.data', data: { bot: { id: botId }, data: { participant: { name: 'Human participant' }, words: [{ text: 'Alex, what should we test for login?' }] } } });
    const timestamp = String(Math.floor(Date.now() / 1000)); const eventId = 'fixture-transcript';
    const signature = createHmac('sha256', Buffer.alloc(32, 7)).update(eventId + '.' + timestamp + '.' + payload).digest('base64');
    const inbound = (signed = true) => request(app.getHttpServer()).post('/api/meeting-hooks/recall').set('Content-Type', 'application/json').set('webhook-id', eventId).set('webhook-timestamp', timestamp).set('webhook-signature', signed ? 'v1,' + signature : 'v1,invalid').send(payload);
    await inbound(false).expect(401); expect(await database.manager.count(MeetingEntry)).toBe(0);
    await inbound().expect(200); await inbound().expect(200);
    expect(await database.manager.count(MeetingEntry)).toBe(1); expect(await database.manager.count(MeetingRun)).toBe(1);
    await meetings.processOne();
    expect(remote).toHaveBeenLastCalledWith('bot/' + botId + '/send_chat_message/', { to: 'everyone', message: 'Which login flows are release-critical?' });
    await post('/meetings/' + meeting.id + '/end').send({}).expect(201);
    await inbound().expect(409);
  });

  it('does not redispatch a meeting after uncertain provider creation', async () => {
    process.env.RECALL_API_KEY = 'fixture'; process.env.RECALL_WEBHOOK_SECRET = 'fixture'; process.env.MEETING_PUBLIC_API_URL = 'https://api.example.test';
    const remote = jest.spyOn(meetingProvider, 'request').mockRejectedValue(new Error('Timeout after accepting bot'));
    const conversation = await createConversation();
    const body = { conversationId: conversation.id, requestId: randomUUID(), agentId: superqaAgent.id, mode: 'notes' as const, provider: 'teams' as const, url: 'https://teams.microsoft.com/l/meetup-join/meeting-id', consent: true as const };
    await post('/meetings').send({ ...body, requestId: randomUUID(), agentId: agent.id }).expect(400);
    const first = (await post('/meetings').send(body).expect(201)).body;
    expect(first.status).toBe('uncertain');
    expect((await post('/meetings').send(body).expect(201)).body.id).toBe(first.id);
    expect(remote).toHaveBeenCalledTimes(1);
  });

  const liveFixture = (initialEvents: LiveEvent[] = []) => {
    process.env.MEETING_LIVE_ENABLED = 'true'; process.env.OPENAI_API_KEY = 'fixture-live-key';
    const created = jest.spyOn(voiceProvider, 'create').mockResolvedValue({ id: 'live_fixture', sdp: 'fixture-answer' });
    let receive: (event: LiveEvent) => void = () => {};
    const close = jest.fn(async () => { receive({ type: 'session.closed', usage: { seconds: 12 } }); return true; });
    jest.spyOn(voiceProvider, 'attach').mockImplementation(async (_id, handler) => { receive = handler; initialEvents.forEach(event => handler(event)); return { close }; });
    return { created, close, receive: (event: LiveEvent) => receive(event) };
  };

  it('verifies native live AI audio playback and call fullscreen in two browsers', async () => {
    const realProvider = process.env.LIVE_VOICE_REAL_E2E === '1';
    let fixture: ReturnType<typeof liveFixture> | undefined;
    let realFailure = '';
    if (realProvider) {
      const configured = parseEnvironment(readFileSync(join(__dirname, '../../.env')));
      for (const [key, value] of Object.entries(configured)) if (!process.env[key]) process.env[key] = value;
      process.env.MEETING_LIVE_ENABLED = 'true';
      if (!process.env.OPENAI_API_KEY) throw new Error('Real provider check needs OPENAI_API_KEY in apps/api/.env');
      const create = voiceProvider.create.bind(voiceProvider);
      jest.spyOn(voiceProvider, 'create').mockImplementation(async (...args) => { try { return await create(...args); } catch (error) { realFailure = 'session creation: ' + (error as Error).message; throw error; } });
      const attach = voiceProvider.attach.bind(voiceProvider);
      jest.spyOn(voiceProvider, 'attach').mockImplementation(async (...args) => { try { return await attach(...args); } catch (error) { realFailure = 'control connection: ' + (error as Error).message; throw error; } });
    } else {
      fixture = liveFixture();
      fixture.created.mockImplementation(async sdp => {
        const answer = voiceAnswers.get(createHash('sha256').update(sdp).digest('hex'));
        if (!answer) throw new Error('Missing browser SDP fixture');
        return { id: 'live_ui_' + randomUUID(), sdp: answer };
      });
    }
    let web: ReturnType<typeof spawn> | undefined;
    try {
      const probe = createServer(); await new Promise<void>(resolve => probe.listen(0, '127.0.0.1', resolve));
      const address = probe.address(); if (!address || typeof address === 'string') throw new Error('Missing test port');
      const port = address.port; await new Promise<void>(resolve => probe.close(() => resolve()));
      const root = join(__dirname, '../../../..'); let output = '';
      web = spawn(process.execPath, [join(root, 'node_modules/next/dist/bin/next'), 'start', '-p', String(port), '-H', '127.0.0.1'], { cwd: join(root, 'apps/web'), env: { ...process.env, AUTH_PUBLIC_URL: 'http://127.0.0.1:' + port, NODE_ENV: 'production', NEXT_BUILD_DIR: '.next-settings-e2e', AUTONOMY_API_URL: (await app.getUrl()) + '/api' }, stdio: ['ignore', 'pipe', 'pipe'] });
      web.stderr?.on('data', chunk => { output = (output + chunk.toString()).slice(-3000); });
      const webUrl = 'http://127.0.0.1:' + port; let ready = false;
      for (let attempt = 0; attempt < 100; attempt++) { try { ready = (await fetch(webUrl + '/chat')).ok; } catch {} if (ready) break; await new Promise(resolve => setTimeout(resolve, 100)); }
      if (!ready) throw new Error('Chat web startup failed: ' + output);
      try {
        await promisify(execFile)('python3', ['tests/voice_ui_fixture.py'], { cwd: join(root, 'agents'), env: { ...process.env, CHAT_WEB_URL: webUrl, CHAT_API_URL: (await app.getUrl()) + '/api', CHAT_OWNER_COOKIE: ownerCookie, CHAT_MEMBER_COOKIE: colleagueCookie, CHAT_AGENT_ID: agent.id, VOICE_NATIVE_ONLY: '1', ...(realProvider ? { VOICE_REAL_PROVIDER: '1' } : {}) }, timeout: 90000 });
      } catch (error) {
        if (realProvider) throw new Error('Real provider diagnostic: ' + (realFailure || 'provider request succeeded; browser startup failed') + '\n' + String((error as Error & { stderr?: string }).stderr || (error as Error).message).slice(-1400));
        throw error;
      }
      if (!realProvider) {
        expect(fixture!.created).toHaveBeenCalledTimes(1);
        expect(fixture!.close).toHaveBeenCalledTimes(1);
      }
    } finally { web?.kill('SIGTERM'); }
  }, 120000);

  it('uses the GPT-Live WebRTC contract with server-only configuration and restricted browser control', async () => {
    process.env.MEETING_LIVE_ENABLED = 'true'; process.env.OPENAI_API_KEY = 'fixture-live-key';
    const remote = jest.spyOn(globalThis, 'fetch').mockResolvedValue(new globalThis.Response(JSON.stringify({ session: { id: 'live_exact_prefix' }, transport: { type: 'webrtc', sdp: 'answer' } }), { status: 201 }));
    expect(await voiceProvider.create('offer', 'Disclosed QA participant')).toEqual({ id: 'live_exact_prefix', sdp: 'answer' });
    const [url, options] = remote.mock.calls[0]; expect(url).toBe('https://api.openai.com/v1/live/sessions');
    const payload = JSON.parse(String(options?.body));
    expect(payload.session.model).toBe('gpt-live-1'); expect(payload.session.store).toBe(false);
    expect(payload.session.client.data_channel.allowed_client_events).toEqual(['session.close', 'session.instructions.append', 'response.cancel', 'session.input_audio.mute', 'session.input_audio.unmute']);
    expect(payload.transport).toEqual({ type: 'webrtc', sdp: 'offer' }); expect(payload.session.audio.format).toBeUndefined();
  });

  it('admits one live native relay only for the consenting host and hides provider secrets', async () => {
    const fixture = liveFixture(); const meeting = await createMeeting('active'); const sessionId = randomUUID();
    expect(meeting.liveVoice).toBe(true);
    await post('/meetings/' + meeting.id + '/voice/start').send({ sessionId, consent: true, sdp: 'fixture', agentId: meeting.agentId }).expect(403);
    await post('/meetings/' + meeting.id + '/join').send({ sessionId, consent: true }).expect(201);
    const body = { sessionId, consent: true, sdp: 'fixture', agentId: meeting.agentId };
    await post('/meetings/' + meeting.id + '/voice/start', outsiderCookie).send(body).expect(404);
    await post('/meetings/' + meeting.id + '/voice/start', colleagueCookie).send(body).expect(403);
    const admitted = await Promise.all([post('/meetings/' + meeting.id + '/voice/start').send(body), post('/meetings/' + meeting.id + '/voice/start').send(body)]);
    expect(admitted.map(result => result.status).sort()).toEqual([201, 409]); expect(fixture.created).toHaveBeenCalledTimes(1);
    expect(admitted.find(result => result.status === 201)?.body.opening).toContain('Greet the caller now');
    expect(admitted.find(result => result.status === 201)?.body.opening).toContain('Hi, owner.');
    expect(fixture.created.mock.calls[0][1]).toContain('disclosed AI');
    const detail = (await get('/meetings/' + meeting.id).expect(200)).body;
    const detailVoice = detail.voices.find((row: { agentId: string }) => row.agentId === meeting.agentId);
    expect(detailVoice.providerId).toBeUndefined(); expect(detailVoice.capability).toBeUndefined();
    await post('/meetings/' + meeting.id + '/runs').send({ requestId: randomUUID(), kind: 'reply', prompt: 'duplicate' }).expect(409);
    await post('/meetings/' + meeting.id + '/voice/stop').send({ sessionId, agentId: meeting.agentId }).expect(201);
    expect(fixture.close).toHaveBeenCalledTimes(1);
    expect((await database.manager.findOneByOrFail(MeetingVoice, { meetingId: meeting.id })).finalized).toBe(true);
  });

  it('keeps note takers silent and does not spend after ambiguous live startup', async () => {
    const fixture = liveFixture(); const notes = await createMeeting('notes'); const sessionId = randomUUID();
    await post('/meetings/' + notes.id + '/join').send({ sessionId, consent: true }).expect(201);
    await post('/meetings/' + notes.id + '/voice/start').send({ sessionId, consent: true, sdp: 'fixture', agentId: notes.agentId }).expect(409); expect(fixture.created).not.toHaveBeenCalled();
    await post('/meetings/' + notes.id + '/end').send({}).expect(201);
    const meeting = await createMeeting('active');
    await post('/meetings/' + meeting.id + '/join').send({ sessionId, consent: true }).expect(201);
    fixture.created.mockRejectedValue(new Error('Unknown remote outcome'));
    await post('/meetings/' + meeting.id + '/voice/start').send({ sessionId, consent: true, sdp: 'fixture', agentId: meeting.agentId }).expect(409);
    await post('/meetings/' + meeting.id + '/voice/start').send({ sessionId, consent: true, sdp: 'fixture', agentId: meeting.agentId }).expect(409);
    expect(fixture.created).toHaveBeenCalledTimes(1);
    expect((await database.manager.findOneByOrFail(MeetingVoice, { meetingId: meeting.id })).status).toBe('uncertain');
  });

  it('keeps confirmed voice closure idempotent and compiles final native notes', async () => {
    const fixture = liveFixture();
    const meeting = await createMeeting('active'); const sessionId = await joinMeeting(meeting.id);
    await post('/meetings/' + meeting.id + '/voice/start').send({ sessionId, consent: true, sdp: 'fixture', agentId: meeting.agentId }).expect(201);
    const stored = await database.manager.findOneByOrFail(MeetingVoice, { meetingId: meeting.id });
    await voice.event(stored, { type: 'session.input_transcript.delta', event_id: 'final-note', delta: 'Review login coverage before release.', start_ms: 1000 });
    await post('/meetings/' + meeting.id + '/end').send({}).expect(201);
    await post('/meetings/' + meeting.id + '/voice/stop').send({ sessionId, agentId: meeting.agentId }).expect(201);
    await post('/meetings/' + meeting.id + '/end').send({}).expect(201);
    expect(await database.manager.findOneByOrFail(MeetingVoice, { id: stored.id })).toMatchObject({ status: 'closed', finalized: true });
    expect(fixture.close).toHaveBeenCalledTimes(1);
    expect(await database.manager.count(MeetingRun, { where: { meetingId: meeting.id, kind: 'notes' } })).toBe(1);
    await meetings.processOne();
    expect(await database.manager.findOneByOrFail(MeetingRun, { meetingId: meeting.id })).toMatchObject({ status: 'done', evidenceIds: expect.any(Array) });
  });

  it('waits for an in-flight voice close before compiling final notes on last departure', async () => {
    const fixture = liveFixture(); const meeting = await createMeeting('active'); const sessionId = await joinMeeting(meeting.id);
    await post('/meetings/' + meeting.id + '/voice/start').send({ sessionId, consent: true, sdp: 'fixture', agentId: meeting.agentId }).expect(201);
    const stored = await database.manager.findOneByOrFail(MeetingVoice, { meetingId: meeting.id });
    await voice.event(stored, { type: 'session.input_transcript.delta', event_id: 'concurrent-final-note', delta: 'Check the login flow.', start_ms: 1000 });
    let releaseClose: () => void = () => {};
    let closeStarted: () => void = () => {};
    const started = new Promise<void>(resolve => { closeStarted = resolve; });
    fixture.close.mockImplementationOnce(async () => { closeStarted(); await new Promise<void>(resolve => { releaseClose = resolve; }); fixture.receive({ type: 'session.closed', usage: { seconds: 12 } }); return true; });
    const stopping = voice.pulse(owner, meeting.id, sessionId, meeting.agentId, undefined, true);
    await started;
    const leaving = meetings.leave(owner, meeting.id, sessionId);
    releaseClose();
    await Promise.all([stopping, leaving]);
    expect(fixture.close).toHaveBeenCalledTimes(1);
    expect(await database.manager.count(MeetingEntry, { where: { meetingId: meeting.id } })).toBe(1);
    expect(await database.manager.count(MeetingRun, { where: { meetingId: meeting.id, kind: 'notes' } })).toBe(1);
  });

  it.each(['teams', 'google_meet'])('routes %s active participation through a single-use scoped media capability', async provider => {
    const fixture = liveFixture(); process.env.AUTH_PUBLIC_URL = 'https://web.example.test';
    process.env.RECALL_API_KEY = 'fixture'; process.env.RECALL_WEBHOOK_SECRET = 'fixture'; process.env.MEETING_PUBLIC_API_URL = 'https://api.example.test';
    const remote = jest.spyOn(meetingProvider, 'request').mockResolvedValue({ id: randomUUID() });
    const meeting = await createMeeting('active', provider, provider === 'teams' ? 'https://teams.microsoft.com/l/meetup-join/fixture' : 'https://meet.google.com/abc-defg-hij');
    const payload = remote.mock.calls[0][1] as { output_media: { camera: { config: { url: string } } } };
    const url = new URL(payload.output_media.camera.config.url); const token = url.hash.split(':')[1];
    expect(url.origin).toBe('https://web.example.test');
    const bridge = (credential: string, action: string) => request(app.getHttpServer()).post('/api/meeting-voice/' + meeting.id + '/' + action).set('Authorization', 'Bearer ' + credential);
    await bridge('wrong', 'start').send({ sdp: 'fixture' }).expect(403);
    await bridge(token, 'start').send({ sdp: 'fixture' }).expect(201);
    await bridge(token, 'start').send({ sdp: 'fixture' }).expect(409);
    expect(fixture.created).toHaveBeenCalledTimes(1);
    await post('/meetings/' + meeting.id + '/end').send({}).expect(201);
    await bridge(token, 'pulse').send({}).expect(201);
    expect(fixture.close).toHaveBeenCalledTimes(1);
  });

  it.each(['relay', 'role', 'policy'])('stops live voice after %s loss and persists observed usage without summing totals', async loss => {
    const fixture = liveFixture(); const meeting = await createMeeting('active'); const sessionId = randomUUID();
    await post('/meetings/' + meeting.id + '/join').send({ sessionId, consent: true }).expect(201);
    await post('/meetings/' + meeting.id + '/voice/start').send({ sessionId, consent: true, sdp: 'fixture', agentId: meeting.agentId }).expect(201);
    const stored = await database.manager.findOneByOrFail(MeetingVoice, { meetingId: meeting.id });
    await voice.event(stored, { type: 'session.usage.updated', usage: { seconds: 10 } });
    await voice.event(stored, { type: 'session.usage.updated', usage: { seconds: 12 } });
    await voice.event(stored, { type: 'session.usage.updated', usage: { seconds: 11 } });
    const polled = (await get('/meetings/' + meeting.id).expect(200)).body;
    expect(polled.voices.find((row: { agentId: string }) => row.agentId === meeting.agentId).seconds).toBe(12);
    if (loss === 'relay') await database.manager.update(MeetingPeer, { meetingId: meeting.id }, { seenAt: new Date(0) });
    if (loss === 'role') await database.manager.update(ProjectKey, owner.keyId, { role: 'member' });
    if (loss === 'policy') await database.manager.increment(ChatConversation, { id: meeting.conversationId }, 'policyVersion', 1);
    await voice.maintain(); expect(fixture.close).toHaveBeenCalledTimes(1);
  });

  it('closes a late successful voice admission if the meeting ends while creation is in flight', async () => {
    const fixture = liveFixture(); const meeting = await createMeeting('active'); const sessionId = randomUUID();
    await post('/meetings/' + meeting.id + '/join').send({ sessionId, consent: true }).expect(201);
    fixture.created.mockImplementationOnce(async () => { await meetings.end(owner, meeting.id); return { id: 'live_late', sdp: 'answer' }; });
    await post('/meetings/' + meeting.id + '/voice/start').send({ sessionId, consent: true, sdp: 'fixture', agentId: meeting.agentId }).expect(409);
    expect(fixture.close).toHaveBeenCalledTimes(1);
    const closed = await database.manager.findOneByOrFail(MeetingVoice, { meetingId: meeting.id });
    expect(closed.stopped).toBe(true); expect(closed.finalized).toBe(true); expect(closed.status).toBe('closed');
  });

  it('stores immutable live transcript segments for notes, deduplicates deltas and labels mixed audio honestly', async () => {
    liveFixture(); const meeting = await createMeeting('active'); const sessionId = randomUUID();
    await post('/meetings/' + meeting.id + '/join').send({ sessionId, consent: true }).expect(201);
    await post('/meetings/' + meeting.id + '/voice/start').send({ sessionId, consent: true, sdp: 'fixture', agentId: meeting.agentId }).expect(201);
    const stored = await database.manager.findOneByOrFail(MeetingVoice, { meetingId: meeting.id });
    const delta = { type: 'session.input_transcript.delta', event_id: 'input-1', delta: 'Review login', start_ms: 1000 };
    await voice.event(stored, delta); await voice.event(stored, delta);
    await voice.event(stored, { ...delta, event_id: 'input-2', delta: ' coverage.', start_ms: 2000 });
    await voice.event(stored, { type: 'session.output_transcript.delta', event_id: 'output-1', delta: 'Which login flows?', start_ms: 3000 });
    await post('/meetings/' + meeting.id + '/voice/stop').send({ sessionId, agentId: meeting.agentId }).expect(201);
    const entries = await database.manager.find(MeetingEntry, { order: { sequence: 'ASC' } });
    expect(entries).toHaveLength(2); expect(entries[0].text).toBe('Review login coverage.'); expect(entries[0].speaker).toContain('speakers unverified'); expect(entries[1].speaker).toBe('Super QA (AI participant)');
    await post('/meetings/' + meeting.id + '/runs').send({ requestId: randomUUID(), kind: 'notes', prompt: '' }).expect(201);
    await meetings.processOne(); expect((await database.manager.find(MeetingRun))[0].status).toBe('done');
  });

  (process.env.CALL_UI_E2E === '1' ? it : it.skip)('verifies native call greeting, microphone activity, camera and cleanup in the browser', async () => {
    const root = join(__dirname, '../../../..');
    const real = process.env.CALL_REAL_E2E === '1';
    const fixture = real ? null : liveFixture([{ type: 'session.input_transcript.delta', event_id: 'browser-notes-fixture', delta: 'We must review login coverage before release.', start_ms: 1000 }]);
    if (real) {
      const configuration = parseEnvironment(readFileSync(join(root, 'apps/api/.env')));
      for (const key of ['OPENAI_API_KEY', 'CHAT_MODEL', 'MEETING_LIVE_MODEL', 'MEETING_LIVE_VOICE']) if (configuration[key]) process.env[key] = configuration[key];
      process.env.MEETING_LIVE_ENABLED = 'true';
      const notes = new MeetingModel(); meetingModel.compile.mockImplementation(notes.compile.bind(notes));
    }
    const conversation = await createConversation('direct', []);
    await database.manager.update(ChatConversation, conversation.id, { title: 'Voice regression' });
    fixture?.created.mockImplementation(async sdp => {
      const answer = voiceAnswers.get(createHash('sha256').update(sdp).digest('hex'));
      if (!answer) throw new Error('Missing browser SDP fixture');
      return { id: 'live_ui_' + randomUUID(), sdp: answer };
    });
    const probe = createServer(); await new Promise<void>(resolve => probe.listen(0, '127.0.0.1', resolve));
    const address = probe.address(); if (!address || typeof address === 'string') throw new Error('Missing test port');
    await new Promise<void>(resolve => probe.close(() => resolve()));
    const webUrl = 'http://127.0.0.1:' + address.port;
    const web = spawn(process.execPath, [join(root, 'node_modules/next/dist/bin/next'), 'start', '-p', String(address.port), '-H', '127.0.0.1'], { cwd: join(root, 'apps/web'), env: { ...process.env, AUTH_PUBLIC_URL: webUrl, NODE_ENV: 'production', NEXT_BUILD_DIR: '.next-settings-e2e', AUTONOMY_API_URL: (await app.getUrl()) + '/api' }, stdio: 'ignore' });
    let processing: Promise<unknown> | null = null;
    const worker = setInterval(() => { if (!processing) processing = meetings.processOne().finally(() => { processing = null; }); }, 150);
    try {
      for (let attempt = 0; attempt < 100; attempt++) {
        try { if ((await fetch(webUrl + '/chat')).ok) break; } catch {}
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      await promisify(execFile)('python3', ['tests/native_call_ui_fixture.py'], { cwd: join(root, 'agents'), env: { ...process.env, CHAT_WEB_URL: webUrl, CHAT_API_URL: (await app.getUrl()) + '/api', CHAT_OWNER_COOKIE: ownerCookie }, timeout: 90000 });
      if (fixture) expect(fixture.created).toHaveBeenCalledTimes(1);
      if (real) {
        await meetings.processOne();
        const notes = await database.manager.findOneByOrFail(MeetingRun, { kind: 'notes', status: 'done' });
        expect(notes.evidenceIds.length).toBeGreaterThan(0);
        expect(JSON.stringify(notes.result)).toMatch(/log\s?in|password|credential/i);
      }
    } finally { clearInterval(worker); await processing; web.kill('SIGTERM'); }
  }, 120000);

  (process.env.CHAT_UI_E2E === '1' ? it : it.skip)('supports chat, video, meeting history, agent tabs and mobile layout in the browser', async () => {
    process.env.CHAT_MODEL = 'fixture-model'; process.env.OPENAI_API_KEY = 'fixture-key';
    const scheduled = await createMeeting('notes');
    await database.manager.save(database.manager.create(MeetingEntry, { meetingId: scheduled.id, eventId: 'ui-meeting-transcript', speaker: 'Teammate', source: 'provider', text: 'Review login coverage before release.' }));
    await meetings.enqueue(owner, scheduled.id, { requestId: randomUUID(), kind: 'notes', prompt: '' }); await meetings.processOne();
    let web: ReturnType<typeof spawn> | undefined; let worker: ReturnType<typeof setInterval> | undefined;
    try {
      const probe = createServer(); await new Promise<void>(resolve => probe.listen(0, '127.0.0.1', resolve));
      const address = probe.address(); if (!address || typeof address === 'string') throw new Error('Missing test port');
      const port = address.port; await new Promise<void>(resolve => probe.close(() => resolve()));
      const root = join(__dirname, '../../../..'); let output = '';
      web = spawn(process.execPath, [join(root, 'node_modules/next/dist/bin/next'), 'start', '-p', String(port), '-H', '127.0.0.1'], { cwd: join(root, 'apps/web'), env: { ...process.env, AUTH_PUBLIC_URL: 'http://127.0.0.1:' + port, NODE_ENV: 'production', NEXT_BUILD_DIR: '.next-settings-e2e', AUTONOMY_API_URL: (await app.getUrl()) + '/api' }, stdio: ['ignore', 'pipe', 'pipe'] });
      web.stderr?.on('data', chunk => { output = (output + chunk.toString()).slice(-3000); });
      const webUrl = 'http://127.0.0.1:' + port;
      let ready = false;
      for (let attempt = 0; attempt < 100; attempt++) {
        try { ready = (await fetch(webUrl + '/chat')).ok; } catch {}
        if (ready) break;
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      if (!ready) throw new Error('Chat web startup failed: ' + output);
      let processing = false;
      worker = setInterval(() => { if (!processing) { processing = true; Promise.all([chat.processOne(), meetings.processOne()]).finally(() => { processing = false; }); } }, 150);
      await promisify(execFile)('python3', ['tests/chat_ui_fixture.py'], { cwd: join(root, 'agents'), env: { ...process.env, CHAT_WEB_URL: webUrl, CHAT_OWNER_COOKIE: ownerCookie, CHAT_MEMBER_COOKIE: colleagueCookie, CHAT_AGENT_ID: agent.id }, timeout: 90000 });
      expect(await database.manager.count(ChatTask)).toBe(1);
      expect(await database.manager.count(ChatConversation, { where: { kind: 'direct' } })).toBe(1);
      const fixture = liveFixture();
      fixture.created.mockImplementation(async sdp => {
        const answer = voiceAnswers.get(createHash('sha256').update(sdp).digest('hex'));
        if (!answer) throw new Error('Missing browser SDP fixture');
        return { id: 'live_ui_' + randomUUID(), sdp: answer };
      });
      process.env.AUTH_PUBLIC_URL = 'https://web.example.test';
      const external = await createMeeting('active', 'google_meet', 'https://meet.google.com/abc-defg-hij');
      const providerCalls = jest.mocked(meetingProvider.request).mock.calls;
      const externalPayload = providerCalls[providerCalls.length - 1][1] as { output_media: { camera: { config: { url: string } } } };
      const fragment = new URL(externalPayload.output_media.camera.config.url).hash;
      await promisify(execFile)('python3', ['tests/voice_ui_fixture.py'], { cwd: join(root, 'agents'), env: { ...process.env, CHAT_WEB_URL: webUrl, CHAT_API_URL: (await app.getUrl()) + '/api', CHAT_OWNER_COOKIE: ownerCookie, CHAT_MEMBER_COOKIE: colleagueCookie, VOICE_BRIDGE_FRAGMENT: fragment, VOICE_EXTERNAL_MEETING: external.id }, timeout: 90000 });
      expect(fixture.created).toHaveBeenCalledTimes(2);
      expect(fixture.close).toHaveBeenCalledTimes(2);
    } finally { if (worker) clearInterval(worker); web?.kill('SIGTERM'); }
  }, 120000);
});
