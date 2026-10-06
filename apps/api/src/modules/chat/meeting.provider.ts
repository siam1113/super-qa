import { BadRequestException, Injectable, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'crypto';
import { Meeting } from './meeting.entity';

export function meetingUrl(provider: string, value?: string) {
  if (provider === 'native') return null;
  let url: URL;
  try { url = new URL(value || ''); } catch { throw new BadRequestException('Enter a valid meeting URL'); }
  const valid = provider === 'google_meet' ? url.hostname === 'meet.google.com' && /^\/[a-z]{3}-[a-z]{4}-[a-z]{3}$/.test(url.pathname) : ['teams.microsoft.com', 'teams.live.com'].includes(url.hostname) && /^\/(l\/meetup-join|meet)\//.test(url.pathname);
  if (!valid || url.protocol !== 'https:' || url.username || url.password || url.port || url.hash) throw new BadRequestException('Unsupported meeting URL');
  return url.toString();
}

// Resolves a single URL (already known to be a meeting link, e.g. from model-judged intent)
// to its provider, without requiring the "join" keyword gate detectMeetingLink below uses.
export function parseMeetingLink(url: string): { provider: 'teams' | 'google_meet'; url: string } | null {
  for (const provider of ['teams', 'google_meet'] as const) {
    try { return { provider, url: meetingUrl(provider, url)! }; } catch {}
  }
  return null;
}

// Scans free text for the first recognizable Teams/Google Meet link, with no keyword
// requirement — for callers (e.g. model-judged join intent) that already know the message
// is a join request and just need the link, if any was shared.
export function scanMeetingLinks(text: string): { provider: 'teams' | 'google_meet'; url: string } | null {
  for (const raw of text.match(/https?:\/\/\S+/g) || []) {
    const candidate = raw.replace(/[.,)>\]]+$/, '');
    const found = parseMeetingLink(candidate);
    if (found) return found;
  }
  return null;
}

// Lets a chat message like "@QAE join this call https://teams.microsoft.com/l/meetup-join/..." trigger
// dispatch directly, without the sender going through the Teams/Meet UI button.
export function detectMeetingLink(text: string): { provider: 'teams' | 'google_meet'; url: string } | null {
  if (!/\bjoin\b/i.test(text)) return null;
  return scanMeetingLinks(text);
}

@Injectable()
export class MeetingProvider {
  configured() { return Boolean(process.env.RECALL_API_KEY && process.env.RECALL_WEBHOOK_SECRET && process.env.MEETING_PUBLIC_API_URL); }

  async request(path: string, body?: object) {
    const region = process.env.RECALL_REGION || 'us-west-2';
    if (!['us-west-2', 'us-east-1', 'eu-central-1', 'ap-northeast-1'].includes(region) || !process.env.RECALL_API_KEY) throw new ServiceUnavailableException('Meeting provider is not configured');
    const response = await fetch('https://' + region + '.recall.ai/api/v1/' + path, { method: body === undefined ? 'GET' : 'POST', headers: { Authorization: process.env.RECALL_API_KEY, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body), redirect: 'error', signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error('Meeting provider request failed (' + response.status + ')');
    return response.status === 204 ? {} : response.json();
  }

  async join(meeting: Meeting, name: string, role: string, voiceUrl?: string) {
    if (!this.configured()) throw new ServiceUnavailableException('External meeting provider is not configured');
    const origin = new URL(process.env.MEETING_PUBLIC_API_URL!);
    if (origin.protocol !== 'https:' || origin.username || origin.password || origin.search || origin.hash || origin.pathname !== '/') throw new ServiceUnavailableException('Configure a public HTTPS API origin');
    return this.request('bot/', {
      meeting_url: meeting.url, bot_name: name + ' (' + role + ')',
      metadata: { superqa_meeting_id: meeting.id },
      ...(voiceUrl ? { output_media: { camera: { kind: 'webpage', config: { url: voiceUrl } } } } : {}),
      recording_config: {
        video_mixed_mp4: null,
        transcript: { provider: { recallai_streaming: { mode: 'prioritize_low_latency', language_code: 'en' } } },
        realtime_endpoints: [{ type: 'webhook', url: origin.origin + '/api/meeting-hooks/recall', events: ['transcript.data'] }],
      },
      chat: { on_bot_join: { send_to: 'everyone', message: 'I am ' + name + ', an AI ' + (meeting.mode === 'notes' ? 'note-taker' : 'participant') + '. With host authorization, I transcribe this meeting for notes and reviewed follow-ups. Ask the host to remove me to stop.' } },
      automatic_leave: { waiting_room_timeout: 300, in_call_recording_timeout: 3600, in_call_not_recording_timeout: 300 },
    });
  }

  leave(botId: string) { return this.request('bot/' + encodeURIComponent(botId) + '/leave_call/', {}); }
  status(botId: string) { return this.request('bot/' + encodeURIComponent(botId) + '/'); }
  speak(botId: string, text: string) { return this.request('bot/' + encodeURIComponent(botId) + '/send_chat_message/', { to: 'everyone', message: text }); }

  verify(raw: Buffer | undefined, headers: Record<string, unknown>) {
    const secret = process.env.RECALL_WEBHOOK_SECRET;
    const eventId = headers['webhook-id']; const timestamp = headers['webhook-timestamp']; const signature = headers['webhook-signature'];
    if (!secret || !raw || raw.length > 100000 || typeof eventId !== 'string' || eventId.length > 200 || typeof timestamp !== 'string' || !/^\d+$/.test(timestamp) || Math.abs(Date.now() / 1000 - Number(timestamp)) > 300 || typeof signature !== 'string') throw new UnauthorizedException('Invalid meeting callback');
    const expected = createHmac('sha256', Buffer.from(secret.replace(/^whsec_/, ''), 'base64')).update(eventId + '.' + timestamp + '.').update(raw).digest();
    if (!signature.split(' ').some(value => { const [version, encoded] = value.split(','); const candidate = Buffer.from(encoded || '', 'base64'); return version === 'v1' && candidate.length === expected.length && timingSafeEqual(candidate, expected); })) throw new UnauthorizedException('Invalid meeting callback');
    return eventId;
  }
}
