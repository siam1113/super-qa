import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import WebSocket = require('ws');

export type LiveEvent = { type: string; event_id?: string; delta?: string; start_ms?: number; end_ms?: number; usage?: { seconds?: number }; reason?: string };
export const OPENAI_LIVE_VOICES = ['alloy', 'ash', 'ballad', 'coral', 'echo', 'sage', 'shimmer', 'verse', 'marin', 'cedar'] as const;

// How long to wait for the real delegation answer before speaking a quick filler so the
// meeting isn't left in dead air during a slow tool call. "append" (not "set") in the
// commentary event name implies multiple sends per delegation_id are expected, so the
// filler and the real answer that follows are both just appends to the same delegation.
const FILLER_DELAY_MS = 1500;
const DELEGATION_FILLER = 'Let me check on that.';

export type LiveFailureReason = 'auth' | 'quota' | 'server' | 'network' | 'protocol' | 'unknown';
export class LiveProviderError extends Error {
  constructor(public readonly reason: LiveFailureReason, message: string, public readonly status?: number) {
    super(message);
    this.name = 'LiveProviderError';
  }
}
function statusReason(status: number): LiveFailureReason {
  return status === 401 || status === 403 ? 'auth' : status === 429 ? 'quota' : status >= 500 ? 'server' : 'unknown';
}

@Injectable()
export class VoiceProvider {
  configured() { return process.env.MEETING_LIVE_ENABLED === 'true' && Boolean(process.env.OPENAI_API_KEY); }
  async create(sdp: string, instructions: string, voice: string) {
    if (!this.configured()) throw new ServiceUnavailableException('Enable and configure GPT-Live before active participation');
    let response: Response;
    try {
      response = await fetch('https://api.openai.com/v1/live/sessions', {
        method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15000),
        headers: { Authorization: 'Bearer ' + process.env.OPENAI_API_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({ session: { model: process.env.MEETING_LIVE_MODEL || 'gpt-live-1', instructions, store: false, audio: { output: { voice: OPENAI_LIVE_VOICES.includes(voice as typeof OPENAI_LIVE_VOICES[number]) ? voice : 'marin' } }, client: { data_channel: { allowed_client_events: ['session.close', 'session.instructions.append', 'response.cancel', 'session.input_audio.mute', 'session.input_audio.unmute', 'session.commentary.append'], allowed_server_events: ['session.started', 'session.closed', 'session.input_transcript.delta', 'session.output_transcript.delta', 'session.instructions.appended', 'session.delegation.created', 'error'].map(type => ({ type })) } } }, transport: { type: 'webrtc', sdp } }),
      });
    } catch (error) {
      throw new LiveProviderError('network', 'Live session request failed: ' + (error instanceof Error ? error.message : 'network error'));
    }
    if (!response.ok) throw new LiveProviderError(statusReason(response.status), 'Live session creation failed (' + response.status + ')', response.status);
    const result = await response.json();
    if (typeof result.session?.id !== 'string' || result.session.id.length > 256 || result.transport?.type !== 'webrtc' || typeof result.transport.sdp !== 'string' || result.transport.sdp.length > 64000) throw new LiveProviderError('protocol', 'Invalid Live session response');
    return { id: result.session.id as string, sdp: result.transport.sdp as string };
  }
  async speak(voice: string, text: string) {
    if (!process.env.OPENAI_API_KEY) throw new ServiceUnavailableException('Voice preview requires OPENAI_API_KEY to be configured');
    const response = await fetch('https://api.openai.com/v1/audio/speech', {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15000),
      headers: { Authorization: 'Bearer ' + process.env.OPENAI_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: process.env.VOICE_PREVIEW_MODEL || 'gpt-4o-mini-tts', voice: OPENAI_LIVE_VOICES.includes(voice as typeof OPENAI_LIVE_VOICES[number]) ? voice : 'marin', input: text, response_format: 'mp3' }),
    });
    if (!response.ok) throw new ServiceUnavailableException('Voice preview is unavailable for this voice right now');
    return Buffer.from(await response.arrayBuffer());
  }
  /**
   * resolveDelegation decides what to tell the model for a client-targeted delegation.
   * OpenAI's Live API deliberately does NOT include the requested task/arguments in
   * session.delegation.created (only {id, type, target}) — the caller must infer what's
   * being asked from the ongoing conversation itself, which is why this is a callback
   * into VoiceService (which holds the meeting/transcript/agent context) rather than
   * logic living here. Must resolve to a string; this method has no opinion on content,
   * including the safety fallback when no real answer is available — that's the caller's
   * call entirely.
   */
  async attach(id: string, receive: (event: LiveEvent) => void, lost: () => void, resolveDelegation: (delegationId: string) => Promise<string>) {
    const socket = new WebSocket('wss://api.openai.com/v1/live/sessions/' + encodeURIComponent(id) + '/attach', { headers: { Authorization: 'Bearer ' + process.env.OPENAI_API_KEY }, handshakeTimeout: 10000, maxPayload: 1000000 });
    let handshakeStatus: number | undefined;
    socket.on('unexpected-response', (_request, response) => { handshakeStatus = response.statusCode; response.resume(); socket.terminate(); });
    let finalized = false;
    const delegations = new Set<string>();
    // OpenAI can create several delegations in quick succession — e.g. the model asks a
    // clarifying question, gets no answer yet, and delegates again on the next turn before
    // the first one's commentary has landed. Resolving them concurrently means whichever
    // LLM call finishes first wins the race independent of creation order, so the model ends
    // up speaking several unrelated "let me check"/answer fragments mashed into one jumbled
    // utterance. Chaining ensures only one is in flight, handled strictly in creation order.
    let delegationChain = Promise.resolve();
    let complete: (() => void) | null = null;
    socket.on('message', data => {
      try {
        const event = JSON.parse(data.toString());
        if (event.type === 'session.delegation.created' && event.delegation?.target === 'client' && typeof event.delegation.id === 'string' && !delegations.has(event.delegation.id) && delegations.size < 100) {
          delegations.add(event.delegation.id);
          const delegationId = event.delegation.id;
          delegationChain = delegationChain.then(() => new Promise<void>(settle => {
            let settled = false;
            const fillerTimer = setTimeout(() => {
              if (!settled && socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'session.commentary.append', delegation_id: delegationId, content: DELEGATION_FILLER }));
            }, FILLER_DELAY_MS);
            resolveDelegation(delegationId).catch(() => 'No external task was executed. This meeting participant has no backend tools or private project retrieval. Offer a follow-up proposal for human review, and explain the limitation instead of claiming completed work.').then(content => {
              settled = true;
              clearTimeout(fillerTimer);
              if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'session.commentary.append', delegation_id: delegationId, content }));
              settle();
            });
          }));
        }
        if (event.type === 'session.closed') { finalized = true; complete?.(); }
        if (['session.started', 'session.closed', 'session.usage.updated', 'session.input_transcript.delta', 'session.output_transcript.delta', 'session.instructions.appended', 'error'].includes(event.type)) receive(event);
      } catch { socket.close(); }
    });
    socket.on('close', () => { if (!finalized) lost(); });
    socket.on('error', () => {});
    const connectFailure = (error?: unknown) => handshakeStatus
      ? new LiveProviderError(statusReason(handshakeStatus), 'Live control connection rejected (' + handshakeStatus + ')', handshakeStatus)
      : new LiveProviderError('network', 'Live control connection failed: ' + (error instanceof Error ? error.message : 'connection closed'));
    await new Promise<void>((resolve, reject) => { socket.once('open', resolve); socket.once('error', error => reject(connectFailure(error))); socket.once('close', () => reject(connectFailure())); });
    return {
      close: async () => {
        if (!finalized && socket.readyState === WebSocket.OPEN) await new Promise<void>(resolve => {
          const timer = setTimeout(resolve, 8000);
          complete = () => { clearTimeout(timer); resolve(); };
          socket.send(JSON.stringify({ type: 'session.close' }));
        });
        socket.terminate(); return finalized;
      },
    };
  }
}
