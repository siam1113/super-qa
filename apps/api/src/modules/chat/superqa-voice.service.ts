import { ForbiddenException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { ChatActor, ChatService } from './chat.service';
import { ChatAgent } from './chat.entity';
import { LiveEvent, OPENAI_LIVE_VOICES, VoiceProvider } from './voice.provider';
import { AgentsService } from '../agents/agents.service';

const DELEGATION_SAFE_FALLBACK = 'No external task was executed. This voice session has no backend tools right now. Offer a follow-up proposal for human review, and explain the limitation instead of claiming completed work.';
const DELEGATION_TIMEOUT_MS = 8000;
const SESSION_IDLE_TIMEOUT_MS = 30 * 60 * 1000;

interface SuperQaVoiceSession {
  memberId: string;
  projectId: string;
  providerId: string;
  control: { close(): Promise<boolean> };
  transcript: Array<{ speaker: string; text: string }>;
  finalized: boolean;
  createdAt: number;
}

/**
 * A deliberately simpler, parallel counterpart to VoiceService: a solo, 1:1 live voice
 * conversation between one project member and the Super QA agent, not a multi-party
 * meeting. VoiceService's model (Meeting rows, agentParticipants, admin-only gating,
 * meeting-scoped transcript persistence, turn-taking prompts for multiple AI tiles) is
 * all meeting-specific and doesn't fit this case — forcing it through there would mean
 * faking a one-person "meeting" just to satisfy that model. This reuses only the two
 * genuinely generic pieces: VoiceProvider (the raw GPT-Live wire contract) and
 * AgentsService.chatForAutomation (real tool-enabled turns, same as the meeting path).
 *
 * Scope decision: sessions are in-memory only, not persisted. A server restart drops any
 * live session (the user just reconnects — there's no multi-party state, billing
 * reconciliation, or audit trail need that would justify the extra persistence layer
 * VoiceService carries for meetings). Revisit if that durability turns out to matter.
 */
@Injectable()
export class SuperQaVoiceService {
  private sessions = new Map<string, SuperQaVoiceSession>();

  constructor(private readonly chat: ChatService, private readonly provider: VoiceProvider, private readonly agents: AgentsService) {}

  configured() { return this.provider.configured(); }

  private session(id: string, actor: ChatActor): SuperQaVoiceSession {
    const session = this.sessions.get(id);
    if (!session || session.memberId !== actor.memberId || session.projectId !== actor.projectId) throw new NotFoundException('Voice session not found');
    return session;
  }

  async start(actor: ChatActor, sdp: string, voice?: string) {
    if (!this.configured()) throw new ServiceUnavailableException('Enable and configure GPT-Live before voice chat');
    this.sweep();
    const agent = await this.chat.scoped(actor, async manager => {
      await this.chat.directory(actor); // idempotent; guarantees the superqa ChatAgent row exists
      return manager.findOneByOrFail(ChatAgent, { projectId: actor.projectId, kind: 'superqa' });
    });
    const instructions = await this.chat.scoped(actor, async manager => {
      const basePrompt = await this.chat.resolveScenarioPrompt(manager, actor.projectId, agent.id, 'superqa', 'conversation');
      return 'You are a disclosed AI voice participant named ' + agent.name + '. Never imply you are human. Greet the caller briefly when the session starts, then listen.\n' + basePrompt
        + '\nYou have no direct backend tools over this voice channel; when something requires real tool/skill use, delegate — the platform will fetch a real, tool-backed answer for you to speak.';
    });
    const requestedVoice = voice && (OPENAI_LIVE_VOICES as readonly string[]).includes(voice) ? voice : 'marin';
    const remote = await this.provider.create(sdp, instructions, requestedVoice);
    const id = randomUUID();
    try {
      const control = await this.provider.attach(remote.id, event => this.event(id, event), () => this.event(id, { type: 'connection.lost' }), () => this.delegate(id));
      this.sessions.set(id, { memberId: actor.memberId, projectId: actor.projectId, providerId: remote.id, control, transcript: [], finalized: false, createdAt: Date.now() });
      return { id, sdp: remote.sdp, name: agent.name };
    } catch (error) {
      this.sessions.delete(id);
      throw error;
    }
  }

  async pulse(actor: ChatActor, id: string, stop = false) {
    const session = this.session(id, actor);
    if (stop && !session.finalized) {
      session.finalized = await session.control.close();
      this.sessions.delete(id);
    }
    return { finalized: session.finalized };
  }

  private event(id: string, event: LiveEvent) {
    const session = this.sessions.get(id);
    if (!session) return;
    if (event.type === 'connection.lost' || event.type === 'error' || event.type === 'session.closed') { session.finalized = true; return; }
    if (!['session.input_transcript.delta', 'session.output_transcript.delta'].includes(event.type) || typeof event.delta !== 'string' || !event.delta) return;
    const speaker = event.type === 'session.output_transcript.delta' ? 'Super QA' : 'You';
    const last = session.transcript.at(-1);
    if (last?.speaker === speaker) last.text += event.delta;
    else session.transcript.push({ speaker, text: event.delta });
    if (session.transcript.length > 60) session.transcript.splice(0, session.transcript.length - 60);
  }

  /**
   * Same shape as MeetingService.liveReply/delegate: ground a real, tool-enabled turn in
   * the conversation so far, bounded by a timeout so a slow tool call fails safely back
   * to the honest "no backend tools" message instead of leaving the model hanging.
   */
  private async delegate(id: string): Promise<string> {
    const session = this.sessions.get(id);
    if (!session || !session.transcript.length) return DELEGATION_SAFE_FALLBACK;
    try {
      const context = this.chat.formatMeetingTranscript('Live voice chat with Super QA', session.transcript);
      const prompt = 'You are in a live voice conversation and just requested to delegate a task to your backend tools. The transcript above is your only signal for what was asked — infer it from the most recent lines and use your real tools/skills to answer concisely, as something you could say out loud. If nothing concrete is actually being requested of you right now, say so briefly rather than guessing.';
      const timeout = new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Delegation timed out')), DELEGATION_TIMEOUT_MS));
      const live = await Promise.race([this.agents.chatForAutomation('superqa', { message: prompt }, [], undefined, undefined, undefined, context), timeout]);
      return live.response.trim().slice(0, 600) || DELEGATION_SAFE_FALLBACK;
    } catch {
      return DELEGATION_SAFE_FALLBACK;
    }
  }

  private sweep() {
    const cutoff = Date.now() - SESSION_IDLE_TIMEOUT_MS;
    for (const [id, session] of this.sessions) {
      if (session.finalized || session.createdAt < cutoff) { void session.control.close().catch(() => {}); this.sessions.delete(id); }
    }
  }
}
