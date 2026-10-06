import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException, ServiceUnavailableException, forwardRef } from '@nestjs/common';
import { createHmac } from 'crypto';
import { isDeepStrictEqual } from 'util';
import { EntityManager, In, LessThan, MoreThan } from 'typeorm';
import { ChatActor, ChatService } from './chat.service';
import { ChatAgent, ChatConversation, ChatMessage } from './chat.entity';
import { ChatRole, chatRoleKinds, chatRoles } from './chat.roles';
import { mentioned } from './chat.model';
import { Meeting, MeetingActivity, MeetingEntry, MeetingPeer, MeetingRun, MeetingSignal } from './meeting.entity';
import { ActivityMessageDto, EntryDto, JoinMeetingDto, MeetingDto, PollDto, RunDto, SignalDto } from './meeting.dto';
import { MeetingModel } from './meeting.model';
import { MeetingProvider, meetingUrl } from './meeting.provider';
import { VoiceService } from './voice.service';
import { MeetingVoice } from './voice.entity';
import { AgentsService } from '../agents/agents.service';

const EMPTY_NATIVE_CALL_TIMEOUT_MS = 60_000;
const DAILY_MEETING_LIMIT = 1_000;
const LIVE_REPLY_MAX_CHARS = 1200;

@Injectable()
export class MeetingService {
  constructor(@Inject(forwardRef(() => ChatService)) private readonly chat: ChatService, private readonly model: MeetingModel, private readonly provider: MeetingProvider, private readonly voice: VoiceService, private readonly agents: AgentsService) {}
  private get database() { return this.chat.database; }

  private async access(manager: EntityManager, actor: ChatActor, id: string, host = false) {
    const meeting = await manager.findOneBy(Meeting, { id, projectId: actor.projectId });
    if (!meeting) throw new NotFoundException();
    const conversation = await this.chat.conversation(manager, actor, meeting.conversationId);
    if (host && meeting.createdBy !== actor.memberId) throw new ForbiddenException('Only the meeting host can do this');
    return { meeting, conversation };
  }
  private live(meeting: Meeting) {
    if (meeting.stopped || !['live', 'joining'].includes(meeting.status) || meeting.createdAt.getTime() + 3600000 < Date.now()) throw new ConflictException('Meeting is not live');
  }
  private async peer(manager: EntityManager, actor: ChatActor, meeting: Meeting, sessionId: string) {
    this.live(meeting);
    if (meeting.provider !== 'native') throw new BadRequestException('Use the external meeting application');
    const peer = await manager.findOneBy(MeetingPeer, { meetingId: meeting.id, memberId: actor.memberId, sessionId, seenAt: MoreThan(new Date(Date.now() - 30000)) });
    if (!peer) throw new ForbiddenException('Join this call and accept its disclosure first');
    return peer;
  }

  private async stopNativeVoice(meeting: Meeting) {
    const voiceSessions = await this.database.manager.find(MeetingVoice, { where: { meetingId: meeting.id } });
    const actor = { projectId: meeting.projectId, memberId: meeting.createdBy, keyId: meeting.keyId };
    for (const voiceSession of voiceSessions) {
      if (!voiceSession.peerSession || voiceSession.finalized) continue;
      try { await this.voice.pulse(actor, meeting.id, voiceSession.peerSession, voiceSession.agentId, undefined, true); } catch {}
    }
  }

  private async endIfNativeCallEmpty(id: string, now: number, lastParticipantLeft = false) {
    return this.database.transaction(async manager => {
      const meeting = await manager.getRepository(Meeting).findOne({
        where: { id, stopped: false, status: In(['live', 'joining']) },
        lock: { mode: 'pessimistic_write' },
      });
      if (!meeting || meeting.provider !== 'native' || !lastParticipantLeft && meeting.createdAt.getTime() + EMPTY_NATIVE_CALL_TIMEOUT_MS > now) return null;
      const activePeers = await manager.count(MeetingPeer, { where: { meetingId: id, seenAt: MoreThan(new Date(now - 30000)) } });
      if (activePeers) return null;
      meeting.stopped = true; meeting.status = 'ended'; meeting.version++;
      await manager.save(meeting);
      await manager.delete(MeetingPeer, { meetingId: id });
      await manager.delete(MeetingSignal, { meetingId: id });
      await this.chat.logActivity(manager, meeting, 'meeting_ended', { id: null, kind: 'system', name: null });
      return meeting;
    });
  }

  async list(actor: ChatActor, conversationId: string) {
    return this.chat.scoped(actor, async manager => {
      await this.chat.conversation(manager, actor, conversationId);
      return { meetings: await manager.find(Meeting, { where: { conversationId, projectId: actor.projectId }, order: { createdAt: 'DESC' }, take: 20 }), externalConfigured: this.provider.configured(), liveConfigured: this.voice.configured(), slackSupported: false };
    });
  }

  async active(actor: ChatActor) {
    return this.chat.scopedRead(actor, async manager => {
      const conversations = await manager.getRepository(ChatConversation).createQueryBuilder('conversation')
        .select(['conversation.id', 'conversation.title', 'conversation.kind', 'conversation.memberIds', 'conversation.agentId', 'conversation.createdBy', 'conversation.instructions', 'conversation.archived', 'conversation.updatedAt'])
        .where('conversation.projectId = :projectId', { projectId: actor.projectId })
        .andWhere('conversation.memberIds @> :members::jsonb', { members: JSON.stringify([actor.memberId]) })
        .getMany();
      if (!conversations.length) return { meeting: null, conversation: null };
      const meetings = await manager.find(Meeting, {
        where: { projectId: actor.projectId, conversationId: In(conversations.map(item => item.id)), provider: 'native', stopped: false, status: 'live' },
        order: { createdAt: 'DESC' }, take: 20,
      });
      const meeting = meetings[0] || null;
      const conversation = meeting ? conversations.find(item => item.id === meeting.conversationId) || null : null;
      return { meeting, conversation };
    });
  }

  async create(actor: ChatActor, input: MeetingDto) {
    const url = meetingUrl(input.provider, input.url);
    if (input.provider !== 'native' && !this.provider.configured()) throw new ServiceUnavailableException('Configure the external meeting provider before dispatch');
    const reserved = await this.chat.scoped(actor, async (manager, member, key) => {
      if (!['owner', 'admin'].includes(key.role)) throw new ForbiddenException('Admin role required to start meetings');
      const conversation = await this.chat.conversation(manager, actor, input.conversationId);
      if (conversation.archived) throw new ConflictException('Conversation is archived');
      const existing = await manager.findOneBy(Meeting, { projectId: actor.projectId, requestId: input.requestId });
      if (existing) {
        const participants = input.agentParticipants || [{ agentId: input.agentId, role: 'Participate as the meeting QA teammate.' }];
        const sameAgents = existing.agentParticipants.length === participants.length && existing.agentParticipants.every((participant, index) => participant.agentId === participants[index].agentId && participant.role === participants[index].role);
        if (existing.createdBy !== actor.memberId || existing.conversationId !== input.conversationId || existing.agentId !== input.agentId || existing.mode !== input.mode || existing.provider !== input.provider || existing.url !== url || JSON.stringify([...existing.participantMemberIds].sort()) !== JSON.stringify([...new Set(input.participantMemberIds || conversation.memberIds)].sort()) || !sameAgents || existing.shareTranscriptWithAgents !== (input.shareTranscriptWithAgents ?? true)) throw new ConflictException('Meeting request ID already used');
        return { meeting: existing, fresh: false, name: '', role: '' };
      }
      const participantMemberIds = [...new Set(input.participantMemberIds || conversation.memberIds)];
      if (participantMemberIds.length === 0 || participantMemberIds.length > 4 || !participantMemberIds.includes(member.id) || participantMemberIds.some(id => !conversation.memberIds.includes(id))) throw new BadRequestException('Choose up to four conversation members, including yourself');
      const agentParticipants = input.agentParticipants === undefined ? [{ agentId: input.agentId, role: 'Participate as the meeting QA teammate.' }] : input.agentParticipants;
      if (new Set(agentParticipants.map(item => item.agentId)).size !== agentParticipants.length) throw new BadRequestException('Each agent can only be added once');
      // Super QA is the sole identity for third-party meetings (Teams/Slack/Google Meet) —
      // it's the one face the platform presents to external participants there. Native
      // in-app calls are unaffected: QAE/AUE (individually or together) can still be called
      // directly, same as before this restriction existed.
      if (input.provider !== 'native') {
        const meetingAgentIds = [...new Set([input.agentId, ...agentParticipants.map(item => item.agentId)])];
        const meetingAgents = await manager.find(ChatAgent, { where: { id: In(meetingAgentIds), projectId: actor.projectId } });
        if (meetingAgents.length !== meetingAgentIds.length || meetingAgents.some(item => item.kind !== 'superqa')) throw new BadRequestException('Only Super QA can join Teams, Slack and Google Meet meetings');
      }
      await this.chat.validateParticipants(manager, actor.projectId, [], input.agentId);
      for (const participant of agentParticipants) await this.chat.validateParticipants(manager, actor.projectId, [], participant.agentId);
      if (await manager.count(Meeting, { where: { projectId: actor.projectId, createdAt: MoreThan(new Date(Date.now() - 86400000)) } }) >= DAILY_MEETING_LIMIT) throw new ConflictException('Daily meeting limit reached');
      // Native calls are a single in-app room per conversation, so only one may be active there
      // at a time. Third-party meetings (Teams/Google Meet) are independent Recall bots with no
      // shared room — Super QA can be dispatched into several different calls concurrently, in
      // this conversation or others. Only block a literal duplicate: the same meeting URL already
      // has a bot joining/live/uncertain here.
      const recency = MoreThan(new Date(Date.now() - 3600000));
      const active = input.provider === 'native'
        ? await manager.findOneBy(Meeting, { conversationId: conversation.id, provider: 'native', stopped: false, status: In(['live', 'joining', 'uncertain']), createdAt: recency })
        : await manager.findOneBy(Meeting, { conversationId: conversation.id, provider: input.provider, url: url!, stopped: false, status: In(['live', 'joining', 'uncertain']), createdAt: recency });
      if (active) throw new ConflictException(input.provider === 'native' ? 'This conversation already has an active or uncertain meeting' : 'Super QA is already joining or in this meeting');
      const agent = await manager.findOneByOrFail(ChatAgent, { id: input.agentId });
      const meeting = await manager.save(manager.create(Meeting, { projectId: actor.projectId, conversationId: conversation.id, createdBy: member.id, keyId: key.id, requestId: input.requestId, agentId: agent.id, participantMemberIds, agentParticipants, shareTranscriptWithAgents: input.shareTranscriptWithAgents ?? true, mode: input.mode, provider: input.provider, url, title: conversation.title, status: 'joining' }));
      meeting.liveVoice = input.mode === 'active' && agentParticipants.length > 0 && this.voice.configured();
      await manager.save(meeting);
      const voiceUrl = meeting.liveVoice && meeting.provider !== 'native' ? await this.voice.prepare(manager, meeting) : undefined;
      await this.chat.audit(manager, actor, 'meeting.created_with_consent', { meetingId: meeting.id, mode: meeting.mode, provider: meeting.provider });
      const role = agent.kind ? chatRoles[agent.kind]?.name || agent.kind.toUpperCase() : 'Agent';
      return { meeting, fresh: true, name: agent.name, role, voiceUrl };
    });
    if (!reserved.fresh || input.provider === 'native') return reserved.meeting;
    try {
      const bot = await this.provider.join(reserved.meeting, reserved.name, reserved.role, reserved.voiceUrl);
      if (typeof bot.id !== 'string' || !/^[a-f0-9-]{36}$/.test(bot.id)) throw new Error('Invalid bot identity');
      await this.database.manager.update(Meeting, { id: reserved.meeting.id }, { botId: bot.id });
      const current = await this.database.manager.findOneByOrFail(Meeting, { id: reserved.meeting.id });
      if (current.stopped) { await this.provider.leave(bot.id); await this.database.manager.update(Meeting, current.id, { status: 'ended', error: null }); }
    } catch {
      await this.database.manager.update(Meeting, { id: reserved.meeting.id }, { status: 'uncertain', error: 'Join/removal outcome unknown. Check the provider dashboard before creating another bot.' });
    }
    return this.database.manager.findOneByOrFail(Meeting, { id: reserved.meeting.id });
  }

  async detail(actor: ChatActor, id: string) {
    return this.chat.scoped(actor, async manager => {
      const { meeting, conversation } = await this.access(manager, actor, id);
      const entries = await manager.find(MeetingEntry, { where: { meetingId: id }, order: { sequence: 'ASC' }, take: 1000 });
      const peers = await manager.find(MeetingPeer, { where: { meetingId: id, memberId: In(conversation.memberIds), seenAt: MoreThan(new Date(Date.now() - 30000)) } });
      const voices = await manager.find(MeetingVoice, { where: { meetingId: id } });
      const activity = await manager.find(MeetingActivity, { where: { meetingId: id }, order: { sequence: 'ASC' }, take: 1000 });
      return { meeting, entries, peers: peers.map(peer => ({ memberId: peer.memberId, name: peer.name })), voices: voices.map(voice => ({ agentId: voice.agentId, status: voice.status, seconds: voice.seconds + voice.attemptSeconds, finalized: voice.finalized, error: voice.error })), runs: await manager.find(MeetingRun, { where: { meetingId: id }, order: { createdAt: 'DESC' }, take: 20 }), activity };
    });
  }

  async join(actor: ChatActor, id: string, input: JoinMeetingDto) {
    return this.chat.scoped(actor, async (manager, member) => {
      await this.access(manager, actor, id);
      const meeting = await manager.getRepository(Meeting).findOne({ where: { id, projectId: actor.projectId }, lock: { mode: 'pessimistic_write' } });
      if (!meeting) throw new NotFoundException();
      this.live(meeting);
      if (meeting.provider !== 'native') throw new BadRequestException('Join using the provider meeting link');
      if (meeting.participantMemberIds?.length && !meeting.participantMemberIds.includes(member.id)) throw new ForbiddenException('You were not selected for this call');
      await manager.delete(MeetingPeer, { meetingId: id, seenAt: LessThan(new Date(Date.now() - 30000)) });
      const existing = await manager.findOneBy(MeetingPeer, { meetingId: id, memberId: member.id });
      if (existing && existing.sessionId !== input.sessionId) throw new ConflictException('Already joined in another tab; leave that call first');
      if (!existing && await manager.count(MeetingPeer, { where: { meetingId: id } }) >= 4) throw new ConflictException('Native pilot calls support four people');
      await manager.save(manager.create(MeetingPeer, { ...existing, meetingId: id, memberId: member.id, name: member.email, sessionId: input.sessionId, seenAt: new Date(), consentAt: existing?.consentAt || new Date() }));
      await this.chat.audit(manager, actor, 'meeting.joined_with_consent', { meetingId: id });
      if (!existing) await this.chat.logActivity(manager, meeting, 'human_joined', { id: member.id, kind: 'member', name: member.email });
      if (meeting.status === 'joining') await manager.update(Meeting, meeting.id, { status: 'live', liveAt: new Date() });
      const iceServers: object[] = [];
      if (process.env.MEETING_STUN_URL) iceServers.push({ urls: process.env.MEETING_STUN_URL });
      if (process.env.MEETING_TURN_URL && process.env.MEETING_TURN_SECRET) {
        const username = Math.floor(Date.now() / 1000 + 3600) + ':' + member.id;
        iceServers.push({ urls: process.env.MEETING_TURN_URL, username, credential: createHmac('sha1', process.env.MEETING_TURN_SECRET).update(username).digest('base64') });
      }
      return { iceServers, relayConfigured: Boolean(process.env.MEETING_TURN_URL && process.env.MEETING_TURN_SECRET) };
    });
  }

  async poll(actor: ChatActor, id: string, input: PollDto) {
    return this.chat.scoped(actor, async manager => {
      const { meeting, conversation } = await this.access(manager, actor, id);
      const peer = await this.peer(manager, actor, meeting, input.sessionId);
      await manager.update(MeetingPeer, peer.id, { seenAt: new Date() });
      await manager.delete(MeetingSignal, { meetingId: id, createdAt: LessThan(new Date(Date.now() - 60000)) });
      const peers = await manager.find(MeetingPeer, { where: { meetingId: id, seenAt: MoreThan(new Date(Date.now() - 30000)), memberId: In(conversation.memberIds) } });
      const signals = await manager.find(MeetingSignal, { where: { meetingId: id, recipient: input.sessionId, sequence: MoreThan(input.after) }, order: { sequence: 'ASC' }, take: 200 });
      return { peers, signals };
    });
  }

  async signal(actor: ChatActor, id: string, input: SignalDto) {
    if (JSON.stringify(input.payload).length > 16000 || !['offer', 'answer', 'ice'].includes(input.payload.type) || (input.payload.type !== 'ice' && typeof input.payload.sdp !== 'string') || (input.payload.type === 'ice' && (!input.payload.candidate || typeof input.payload.candidate !== 'object'))) throw new BadRequestException('Invalid signal');
    return this.chat.scoped(actor, async manager => {
      const { meeting, conversation } = await this.access(manager, actor, id);
      await this.peer(manager, actor, meeting, input.sessionId);
      const recipient = await manager.findOneBy(MeetingPeer, { meetingId: id, sessionId: input.recipient, memberId: In(conversation.memberIds), seenAt: MoreThan(new Date(Date.now() - 30000)) });
      if (!recipient || recipient.memberId === actor.memberId) throw new BadRequestException('Invalid call recipient');
      const existing = await manager.findOneBy(MeetingSignal, { meetingId: id, requestId: input.requestId });
      if (existing) {
        if (existing.sender !== input.sessionId || existing.recipient !== input.recipient || !isDeepStrictEqual(existing.payload, JSON.parse(JSON.stringify(input.payload)))) throw new ConflictException('Signal ID already used');
        return existing;
      }
      if (await manager.count(MeetingSignal, { where: { meetingId: id, sender: input.sessionId, createdAt: MoreThan(new Date(Date.now() - 60000)) } }) >= 150) throw new ConflictException('Signaling rate limit');
      return manager.save(manager.create(MeetingSignal, { meetingId: id, requestId: input.requestId, sender: input.sessionId, recipient: input.recipient, payload: input.payload }));
    });
  }

  async leave(actor: ChatActor, id: string, sessionId: string) {
    const removed = await this.chat.scoped(actor, async (manager, member) => {
      const { meeting } = await this.access(manager, actor, id);
      const deleted = await manager.delete(MeetingPeer, { meetingId: id, memberId: actor.memberId, sessionId });
      if (deleted.affected) await this.chat.logActivity(manager, meeting, 'human_left', { id: member.id, kind: 'member', name: member.email });
      return deleted;
    });
    if (removed.affected) {
      const ended = await this.endIfNativeCallEmpty(id, Date.now(), true);
      if (ended) { await this.stopNativeVoice(ended); await this.queueFinalNotes(ended); }
    }
    return { left: true };
  }

  async end(actor: ChatActor, id: string) {
    const meeting = await this.chat.scoped(actor, async (manager, member) => {
      const { meeting } = await this.access(manager, actor, id, true);
      if (!meeting.stopped) {
        meeting.stopped = true; meeting.version++;
        meeting.status = meeting.provider === 'native' ? 'ended' : 'stopping';
        await manager.save(meeting); await manager.delete(MeetingPeer, { meetingId: id }); await manager.delete(MeetingSignal, { meetingId: id });
        await this.chat.audit(manager, actor, 'meeting.stopped', { meetingId: id });
        await this.chat.logActivity(manager, meeting, 'meeting_ended', { id: member.id, kind: 'member', name: member.email });
      }
      return meeting;
    });
    if (meeting.provider === 'native') { await this.stopNativeVoice(meeting); await this.queueFinalNotes(meeting); }
    if (meeting.provider !== 'native' && meeting.status !== 'ended') {
      try {
        if (!meeting.botId) throw new Error('Unknown bot');
        await this.provider.leave(meeting.botId);
        await this.database.manager.update(Meeting, id, { status: 'ended', error: null });
      } catch { await this.database.manager.update(Meeting, id, { status: 'stop_uncertain', error: 'Agent processing stopped locally. Verify removal in the provider dashboard.' }); }
    }
    return this.database.manager.findOneByOrFail(Meeting, { id });
  }

  async entry(actor: ChatActor, id: string, input: EntryDto) {
    return this.chat.scoped(actor, async (manager, member) => {
      const { meeting } = await this.access(manager, actor, id); await this.peer(manager, actor, meeting, input.sessionId);
      const existing = await manager.findOneBy(MeetingEntry, { meetingId: id, eventId: input.requestId });
      if (existing) {
        if (existing.text !== input.text.trim() || existing.speaker !== member.email || existing.source !== input.source) throw new ConflictException('Transcript ID already used');
        return existing;
      }
      return this.append(manager, meeting, input.requestId, member.email, input.text, input.source);
    });
  }
  async postActivity(actor: ChatActor, id: string, input: ActivityMessageDto) {
    return this.chat.scoped(actor, async (manager, member) => {
      const { meeting } = await this.access(manager, actor, id);
      if (meeting.participantMemberIds?.length && !meeting.participantMemberIds.includes(member.id)) throw new ForbiddenException('You were not selected for this call');
      const existing = await manager.findOneBy(MeetingActivity, { meetingId: id, requestId: input.requestId });
      if (existing) {
        if (existing.authorId !== member.id || existing.text !== input.text.trim() || existing.replyToId !== (input.replyToId || null)) throw new ConflictException('Request ID already used');
        return existing;
      }
      if (input.replyToId && !await manager.findOneBy(MeetingActivity, { id: input.replyToId, meetingId: id, kind: 'message' })) throw new BadRequestException('Reply must reference a message in this meeting');
      if (await manager.count(MeetingActivity, { where: { meetingId: id, kind: 'message' } }) >= 500) throw new ConflictException('Meeting message limit reached');
      return manager.save(manager.create(MeetingActivity, { meetingId: id, projectId: actor.projectId, kind: 'message', authorId: member.id, authorKind: 'member', authorName: member.email, text: input.text.trim().slice(0, 4000), replyToId: input.replyToId || null, requestId: input.requestId }));
    });
  }
  private async append(manager: EntityManager, meeting: Meeting, eventId: string, speaker: string, text: string, source: MeetingEntry['source']) {
    if (!text.trim()) throw new BadRequestException('Empty transcript');
    if (await manager.count(MeetingEntry, { where: { meetingId: meeting.id } }) >= 1000) throw new ConflictException('Transcript limit reached');
    return manager.save(manager.create(MeetingEntry, { meetingId: meeting.id, eventId, speaker: speaker.slice(0, 200), text: text.trim().slice(0, 2000), source }));
  }

  async enqueue(actor: ChatActor, id: string, input: RunDto, requireRelevance = false) {
    return this.chat.scoped(actor, async (manager, member, key) => {
      const { meeting, conversation } = await this.access(manager, actor, id);
      if (!['owner', 'admin'].includes(key.role)) throw new ForbiddenException('Admin role required');
      const existing = await manager.findOneBy(MeetingRun, { meetingId: id, requestId: input.requestId });
      if (existing) {
        if (existing.memberId !== actor.memberId || existing.kind !== input.kind || existing.prompt !== input.prompt) throw new ConflictException('Run ID already used');
        return existing;
      }
      if (!meeting.shareTranscriptWithAgents) throw new ForbiddenException('Transcript sharing is off for this meeting; agents cannot process transcript text');
      if (input.kind === 'reply') { this.live(meeting); if (meeting.mode !== 'active') throw new ForbiddenException('Note-takers cannot participate'); if (meeting.liveVoice) throw new ConflictException('Speak to the live participant instead of queuing a duplicate text reply'); }
      if (conversation.archived) throw new ConflictException('Conversation archived');
      if (await manager.count(MeetingRun, { where: { projectId: actor.projectId, createdAt: MoreThan(new Date(Date.now() - 86400000)) } }) >= 100) throw new ConflictException('Daily meeting reasoning limit reached');
      if (await manager.findOneBy(MeetingRun, { meetingId: id, status: In(['queued', 'running']) })) throw new ConflictException('Meeting agent is already working');
      const latest = await manager.findOne(MeetingEntry, { where: { meetingId: id }, order: { sequence: 'DESC' } });
      if (!latest) throw new ConflictException('No transcript yet');
      return manager.save(manager.create(MeetingRun, { meetingId: id, projectId: actor.projectId, memberId: member.id, keyId: key.id, requestId: input.requestId, kind: input.kind, prompt: input.prompt, requireRelevance: input.kind === 'reply' && requireRelevance, version: meeting.version, policyVersion: conversation.policyVersion, throughSequence: latest.sequence }));
    });
  }

  async processOne() {
    await this.database.manager.update(MeetingRun, { status: 'running', startedAt: LessThan(new Date(Date.now() - 60000)) }, { status: 'failed', error: 'Interrupted run; not automatically retried', delivery: 'uncertain' });
    const run = await this.database.transaction(async manager => {
      const row = await manager.findOne(MeetingRun, { where: { status: 'queued' }, order: { createdAt: 'ASC' }, lock: { mode: 'pessimistic_write', onLocked: 'skip_locked' } });
      if (!row) return null;
      row.status = 'running'; row.startedAt = new Date(); return manager.save(row);
    });
    if (!run) return false;
    const actor = { projectId: run.projectId, memberId: run.memberId, keyId: run.keyId };
    try {
      const snapshot = await this.chat.scoped(actor, async manager => {
        const { meeting, conversation } = await this.access(manager, actor, run.meetingId);
        if (meeting.version !== run.version || conversation.policyVersion !== run.policyVersion || conversation.archived) throw new Error('Meeting policy changed');
        if (!meeting.shareTranscriptWithAgents) throw new Error('Transcript sharing is off for this meeting');
        if (run.kind === 'reply') { this.live(meeting); if (meeting.mode !== 'active') throw new Error('Agent is a note-taker'); }
        const agent = await manager.findOneByOrFail(ChatAgent, { id: meeting.agentId, projectId: actor.projectId, enabled: true, kind: In(chatRoleKinds) });
        const entries = await manager.getRepository(MeetingEntry).createQueryBuilder('entry').where('entry.meetingId = :id AND entry.sequence <= :sequence', { id: meeting.id, sequence: run.throughSequence }).orderBy('entry.sequence', 'ASC').take(1001).getMany();
        if (entries.length > 200 || entries.reduce((sum, entry) => sum + entry.text.length, 0) > 40000) throw new Error('Transcript exceeds this pilot’s 200-entry/40,000-character note limit; review the transcript manually');
        const basePrompt = await this.chat.resolveScenarioPrompt(manager, actor.projectId, agent.id, agent.kind!, 'meeting');
        return { meeting, entries, instructions: basePrompt + '\nMeeting guidance: ' + conversation.instructions, agentKind: agent.kind! };
      });
      const output = await this.model.compile(snapshot.instructions, snapshot.entries, run.kind, run.prompt, run.requireRelevance);
      const deliverable = run.kind === 'reply' && output.result.relevant;
      let reply = output.result.reply;
      if (deliverable) reply = await this.liveReply(snapshot.agentKind, snapshot.meeting.title, snapshot.entries, run.prompt, reply!);
      await this.chat.scoped(actor, async manager => {
        const { meeting, conversation } = await this.access(manager, actor, run.meetingId);
        const current = await manager.findOneByOrFail(MeetingRun, { id: run.id });
        if (current.status !== 'running' || meeting.version !== run.version || conversation.policyVersion !== run.policyVersion || conversation.archived) throw new Error('Meeting changed during reasoning');
        if (run.kind === 'reply') this.live(meeting);
        await manager.update(MeetingRun, run.id, { result: { ...output.result, reply }, usage: output.usage, evidenceIds: snapshot.entries.map(entry => entry.id), status: 'done', delivery: deliverable && meeting.provider !== 'native' ? 'sending' : null });
      });
      // A relevance-gated run that decided it had nothing to add produces no reply to
      // deliver — nothing more to do (still recorded as 'done' with an empty result above).
      if (deliverable && snapshot.meeting.provider !== 'native') {
        try {
          await this.chat.scoped(actor, async manager => { const { meeting } = await this.access(manager, actor, run.meetingId); this.live(meeting); if (meeting.version !== run.version || !meeting.botId) throw new Error('Delivery fenced'); });
          if (!snapshot.meeting.botId) throw new Error('Missing bot');
          await this.provider.speak(snapshot.meeting.botId, reply!);
          await this.database.manager.update(MeetingRun, run.id, { delivery: 'sent' });
        } catch { await this.database.manager.update(MeetingRun, run.id, { delivery: 'uncertain' }); }
      }
    } catch (error) { await this.database.manager.update(MeetingRun, { id: run.id, status: 'running' }, { status: 'failed', error: error instanceof Error && !/api|key|token/i.test(error.message) ? error.message.slice(0, 200) : 'Meeting reasoning failed' }); }
    return true;
  }

  /**
   * Replace a deliverable reply's bare-completion text with a real, tool-enabled turn
   * from the meeting's own bound agent (QAE/AUE/Super QA) — grounded in the same
   * transcript window the run was already scoped to, via the same meetingContext
   * mechanism the human console chat uses, so the agent can actually use its tools
   * and skills (and, for Super QA, open a console session with QAE/AUE) before
   * answering, instead of only ever producing a tool-less guess.
   *
   * Falls back to the bare-completion reply (never a canned placeholder — see
   * AgentsService.chatForAutomation) if the agents runtime call fails, so a transient
   * outage costs quality, not the whole turn.
   */
  private async liveReply(agentKind: ChatRole, meetingTitle: string, entries: MeetingEntry[], prompt: string, fallbackReply: string): Promise<string> {
    try {
      const context = this.chat.formatMeetingTranscript(meetingTitle, entries);
      const live = await this.agents.chatForAutomation(agentKind, { message: prompt || 'Continue actively participating in the meeting based on the transcript above.' }, [], undefined, undefined, undefined, context);
      const trimmed = live.response.trim().slice(0, LIVE_REPLY_MAX_CHARS);
      return trimmed || fallbackReply;
    } catch {
      return fallbackReply;
    }
  }

  async publish(actor: ChatActor, id: string, runId: string) {
    return this.chat.scoped(actor, async (manager, member, key) => {
      const { meeting, conversation } = await this.access(manager, actor, id);
      if (!['owner', 'admin'].includes(key.role)) throw new ForbiddenException('Admin role required');
      if (conversation.archived) throw new ConflictException('Conversation archived');
      const run = await manager.findOneBy(MeetingRun, { id: runId, meetingId: id, status: 'done' });
      if (!run?.result) throw new NotFoundException();
      if (run.publishedMessageId) return manager.findOneByOrFail(ChatMessage, { id: run.publishedMessageId });
      const details = run.result.items.map(item => '[' + item.kind + '] ' + item.text + ' (transcript: ' + item.evidence.join(', ') + ')');
      const action = run.result.items.find(item => item.kind === 'action');
      const message = await manager.save(manager.create(ChatMessage, { projectId: actor.projectId, conversationId: meeting.conversationId, requestId: 'meeting:' + run.id, authorId: member.id, authorName: member.email, authorKind: 'member', text: 'Reviewed meeting notes: ' + run.result.summary, content: { summary: 'Reviewed meeting notes: ' + run.result.summary, details, task: action ? { title: action.text.slice(0, 160), description: action.text + '\nMeeting: ' + meeting.id + '\nEvidence: ' + action.evidence.join(', ') } : null } }));
      await manager.update(MeetingRun, run.id, { publishedMessageId: message.id });
      await this.chat.audit(manager, actor, 'meeting.notes_published', { meetingId: id, runId, messageId: message.id });
      return message;
    });
  }

  async play(actor: ChatActor, id: string, runId: string, sessionId: string) {
    return this.chat.scoped(actor, async (manager, member, key) => {
      const { meeting } = await this.access(manager, actor, id);
      await this.peer(manager, actor, meeting, sessionId);
      if (meeting.liveVoice) throw new ConflictException('Live meetings use model audio, not browser speech playback');
      if (meeting.mode !== 'active' || !['owner', 'admin'].includes(key.role)) throw new ForbiddenException('Active participant and admin required');
      const run = await manager.findOneBy(MeetingRun, { id: runId, meetingId: id, status: 'done', kind: 'reply', version: meeting.version });
      if (!run?.result?.reply) throw new NotFoundException();
      const recent = await manager.findOneBy(MeetingRun, { meetingId: id, voiceAt: MoreThan(new Date(Date.now() - 60000)) });
      if (recent) throw new ConflictException('Allow the previous contribution to finish before speaking again');
      await manager.update(MeetingRun, run.id, { voiceAt: new Date() });
      await this.chat.audit(manager, actor, 'meeting.voice_requested', { meetingId: id, runId, memberId: member.id });
      return { requested: true };
    });
  }

  async callback(raw: Buffer | undefined, headers: Record<string, unknown>) {
    const eventId = this.provider.verify(raw, headers);
    let body: any; try { body = JSON.parse(raw!.toString('utf8')); } catch { throw new BadRequestException('Invalid callback'); }
    if (body.event !== 'transcript.data') return { ignored: true };
    const botId = body.data?.bot?.id;
    if (typeof botId !== 'string') throw new BadRequestException('Missing bot identity');
    const meeting = await this.database.manager.findOneBy(Meeting, { botId });
    if (!meeting) throw new NotFoundException();
    const data = body.data?.data;
    if (!Array.isArray(data?.words) || data.words.length > 1000 || data.words.some((word: { text?: unknown }) => typeof word?.text !== 'string')) throw new BadRequestException('Invalid transcript');
    const text = data.words.map((word: { text: string }) => word.text).join(' ');
    if (!text.trim() || text.length > 2000) throw new BadRequestException('Transcript bounds exceeded');
    const speaker = typeof data.participant?.name === 'string' ? data.participant.name : 'Unknown participant';
    const actor = { projectId: meeting.projectId, memberId: meeting.createdBy, keyId: meeting.keyId };
    const accepted = await this.chat.scoped(actor, async manager => {
      const { meeting: current, conversation } = await this.access(manager, actor, meeting.id);
      this.live(current);
      if (conversation.archived) throw new ConflictException('Conversation archived');
      const existing = await manager.findOneBy(MeetingEntry, { meetingId: meeting.id, eventId });
      if (existing) return { accepted: true, invoke: false, requireRelevance: false };
      await this.append(manager, current, eventId, speaker, text, 'provider');
      if (current.status === 'joining') await manager.update(Meeting, current.id, { status: 'live' });
      const agent = await manager.findOneBy(ChatAgent, { id: current.agentId, enabled: true, kind: In(chatRoleKinds) });
      // An explicit @mention always gets a reply. Otherwise, instead of staying silent, still
      // queue a relevance-gated run: the model itself decides whether it has anything useful
      // to add (see MeetingModel.compile's requireRelevance mode) — "always listening," same
      // mechanism as multi-agent text chat, not a second policy.
      const eligible = Boolean(agent && current.mode === 'active' && !current.liveVoice && !speaker.includes('(AI '));
      const mention = eligible && mentioned(text, [agent!.name, agent!.kind!]);
      return { accepted: true, invoke: eligible, requireRelevance: eligible && !mention };
    });
    if (accepted.invoke) {
      try { await this.enqueue(actor, meeting.id, { requestId: 'provider:' + eventId, kind: 'reply', prompt: text.slice(0, 1000) }, accepted.requireRelevance); }
      catch { return { accepted: true, replyQueued: false }; }
    }
    return { accepted: true };
  }

  private maintainedAt = 0;
  private async queueFinalNotes(meeting: Meeting) {
    if (!meeting.shareTranscriptWithAgents || !meeting.agentParticipants.length) return;
    if (!await this.database.manager.exists(MeetingEntry, { where: { meetingId: meeting.id } })) return;
    try {
      await this.enqueue({ projectId: meeting.projectId, memberId: meeting.createdBy, keyId: meeting.keyId }, meeting.id, { requestId: 'native-final:' + meeting.id, kind: 'notes', prompt: '' });
    } catch {
      await this.database.manager.update(Meeting, meeting.id, { error: 'Final notes could not be queued. Open the meeting summary to retry.' });
    }
  }
  /**
   * Meeting-history data for Chat.tsx's "Meetings" tab, Agents.tsx's /meetings command, and
   * the standalone meeting-history view — timing/highlight derivation previously lived in
   * CalendarService.feed() (removed with the calendar feature) alongside unrelated calendar
   * agenda data; this is just that half, under its proper owner.
   */
  async feed(actor: ChatActor) {
    return this.chat.scoped(actor, async manager => {
      const conversations = await manager.getRepository(ChatConversation).createQueryBuilder('chat').where('chat.projectId = :projectId', actor).andWhere('chat.memberIds @> :members::jsonb', { members: JSON.stringify([actor.memberId]) }).getMany();
      const ids = conversations.map(conversation => conversation.id);
      const meetings = ids.length ? await manager.find(Meeting, { where: { projectId: actor.projectId, conversationId: In(ids) }, order: { createdAt: 'DESC' }, take: 200 }) : [];
      const meetingIds = meetings.map(meeting => meeting.id);
      const voiceRows = meetingIds.length ? await manager.find(MeetingVoice, { where: { meetingId: In(meetingIds) }, select: { meetingId: true, seconds: true, attemptSeconds: true } }) : [];
      const noteRuns = meetingIds.length ? await manager.find(MeetingRun, { where: { meetingId: In(meetingIds), kind: 'notes', status: 'done' }, order: { createdAt: 'DESC' } }) : [];
      const entryStats: { meetingId: string; firstAt: Date | string; lastAt: Date | string; count: string }[] = meetingIds.length ? await manager.getRepository(MeetingEntry).createQueryBuilder('entry')
        .select('entry.meetingId', 'meetingId').addSelect('MIN(entry.createdAt)', 'firstAt').addSelect('MAX(entry.createdAt)', 'lastAt').addSelect('COUNT(entry.id)', 'count')
        .where('entry.meetingId IN (:...meetingIds)', { meetingIds }).groupBy('entry.meetingId').getRawMany() : [];
      const voices = new Map<string, { seconds: number; attemptSeconds: number }>();
      for (const row of voiceRows) {
        const current = voices.get(row.meetingId) || { seconds: 0, attemptSeconds: 0 };
        voices.set(row.meetingId, { seconds: current.seconds + row.seconds, attemptSeconds: current.attemptSeconds + row.attemptSeconds });
      }
      const entries = new Map(entryStats.map(row => [row.meetingId, row]));
      const meetingHighlights: Record<string, string[]> = {};
      for (const run of noteRuns) {
        if (meetingHighlights[run.meetingId]) continue;
        const items = (run.result?.items || []).map(item => item.text.trim()).filter(Boolean);
        const summarySentences = (run.result?.summary || '').split(/(?<=[.!?])\s+/).map(text => text.trim()).filter(Boolean);
        meetingHighlights[run.meetingId] = [...items, ...summarySentences].filter((text, index, all) => all.indexOf(text) === index).slice(0, 5);
      }
      const meetingTimings = Object.fromEntries(meetings.map(meeting => {
        const stats = entries.get(meeting.id);
        const voice = voices.get(meeting.id);
        const firstEntryAt = stats ? new Date(stats.firstAt) : null;
        const lastEntryAt = stats ? new Date(stats.lastAt) : null;
        const scheduledStart = meeting.scheduledStart ? new Date(meeting.scheduledStart) : null;
        const scheduledEnd = meeting.scheduledEnd ? new Date(meeting.scheduledEnd) : null;
        const startedAt = scheduledStart || firstEntryAt || meeting.createdAt;
        const voiceSeconds = (voice?.seconds || 0) + (voice?.attemptSeconds || 0);
        const transcriptSeconds = stats && Number(stats.count) > 1 && firstEntryAt && lastEntryAt ? Math.max(0, (lastEntryAt.getTime() - firstEntryAt.getTime()) / 1000) : null;
        const scheduledSeconds = scheduledStart && scheduledEnd ? Math.max(0, (scheduledEnd.getTime() - scheduledStart.getTime()) / 1000) : null;
        const durationSeconds = voiceSeconds > 0 ? voiceSeconds : scheduledSeconds ?? transcriptSeconds;
        const endedAt = voiceSeconds > 0 ? new Date(startedAt.getTime() + voiceSeconds * 1000) : scheduledEnd || (meeting.stopped ? lastEntryAt : null);
        return [meeting.id, { startedAt: startedAt.toISOString(), endedAt: endedAt?.toISOString() || null, durationSeconds }];
      }));
      return { meetings, meetingTimings, meetingHighlights, conversations, configured: { meetingBot: this.provider.configured() } };
    });
  }

  async maintain() {
    if (Date.now() - this.maintainedAt < 15000) return;
    this.maintainedAt = Date.now();
    await this.database.manager.delete(MeetingSignal, { createdAt: LessThan(new Date(Date.now() - 60000)) });
    await this.database.manager.delete(MeetingPeer, { seenAt: LessThan(new Date(Date.now() - 30000)) });
    const meetings = await this.database.manager.find(Meeting, { where: { stopped: false, status: In(['live', 'joining', 'uncertain']) }, order: { createdAt: 'ASC' }, take: 100 });
    for (const meeting of meetings) {
      const actor = { projectId: meeting.projectId, memberId: meeting.createdBy, keyId: meeting.keyId };
      let allowed = meeting.createdAt.getTime() + 3600000 > Date.now();
      try { await this.chat.scoped(actor, async manager => { const { conversation } = await this.access(manager, actor, meeting.id); if (conversation.archived) allowed = false; }); } catch { allowed = false; }
      if (!allowed) {
        const result = await this.database.manager.update(Meeting, { id: meeting.id, stopped: false }, { stopped: true, version: meeting.version + 1, status: meeting.provider === 'native' ? 'ended' : 'stopping' });
        if (!result.affected) continue;
        await this.database.manager.delete(MeetingPeer, { meetingId: meeting.id });
        await this.chat.logActivity(this.database.manager, meeting, 'meeting_ended', { id: null, kind: 'system', name: null });
        if (meeting.provider !== 'native') {
          try { if (!meeting.botId) throw new Error('Unknown provider bot'); await this.provider.leave(meeting.botId); await this.database.manager.update(Meeting, meeting.id, { status: 'ended' }); }
          catch { await this.database.manager.update(Meeting, meeting.id, { status: 'stop_uncertain', error: 'Local access revoked or time limit reached. Verify bot removal in provider dashboard.' }); }
        }
      } else if (meeting.provider !== 'native' && meeting.status === 'joining' && !meeting.botId && meeting.createdAt.getTime() + 60000 < Date.now()) {
        await this.database.manager.update(Meeting, { id: meeting.id, status: 'joining' }, { status: 'uncertain', error: 'Join was interrupted. Inspect the provider dashboard; do not blindly retry.' });
      }
      if (meeting.provider === 'native' && ['live', 'joining'].includes(meeting.status)) {
        const ended = await this.endIfNativeCallEmpty(meeting.id, Date.now());
        if (ended) { await this.stopNativeVoice(ended); await this.queueFinalNotes(ended); }
      }
    }
  }

  async sync(actor: ChatActor, id: string) {
    const meeting = await this.chat.scoped(actor, async manager => {
      const { meeting } = await this.access(manager, actor, id, true);
      if (!meeting.botId) throw new ConflictException('No confirmed provider bot; inspect the provider dashboard');
      if (meeting.syncedAt && Date.now() - meeting.syncedAt.getTime() < 10000) throw new ConflictException('Wait before refreshing provider status');
      await manager.update(Meeting, id, { syncedAt: new Date() }); return meeting;
    });
    const result = await this.provider.status(meeting.botId!);
    const code = result.status_changes?.at(-1)?.code;
    const status = ['done', 'call_ended', 'fatal'].includes(code) ? 'ended' : code === 'in_call_recording' ? 'live' : 'joining';
    await this.database.manager.update(Meeting, { id, stopped: false }, status === 'ended' ? { status, stopped: true, version: meeting.version + 1 } : { status });
    return this.detail(actor, id);
  }
}
