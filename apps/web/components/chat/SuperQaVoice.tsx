'use client';

import { useEffect, useRef, useState } from 'react';
import { Mic, MicOff, PhoneOff } from 'lucide-react';
import { connectLiveVoice, LiveTransport, OPENAI_LIVE_VOICES } from '@/lib/live-voice';

type VoiceResponse = { id?: string; sdp?: string; opening?: string; stopped?: boolean; error?: string | null; status?: string; finalized?: boolean; name?: string };

async function voiceRequest(action: 'start' | 'pulse' | 'stop', body: object): Promise<VoiceResponse> {
  const response = await fetch('/api/agents/superqa/voice/' + action, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), credentials: 'same-origin', cache: 'no-store' });
  const text = await response.text();
  let data: unknown; try { data = text ? JSON.parse(text) : null; } catch { data = null; }
  if (!response.ok) { const message = data && typeof data === 'object' && 'message' in data ? (data as { message?: unknown }).message : undefined; throw new Error(typeof message === 'string' ? message : 'Super QA voice request failed'); }
  return (data || {}) as VoiceResponse;
}

// Deliberately simpler than NativeVoice: a solo 1:1 call with Super QA, no meeting, no
// multi-human audio mixing. Mirrors SuperQaVoiceService's own "simpler counterpart" framing.
export function SuperQaVoice({ onExit }: { onExit: () => void }) {
  const [status, setStatus] = useState('Connecting live voice…');
  const [playback, setPlayback] = useState<MediaStream | null>(null);
  const [muted, setMuted] = useState(false);
  const audioRef = useRef<HTMLAudioElement>(null);
  const connectionRef = useRef<Awaited<ReturnType<typeof connectLiveVoice>> | null>(null);

  useEffect(() => {
    let aborted = false;
    const controller = new AbortController();
    let sessionId = '';
    let mic: MediaStream | null = null;
    const transport: LiveTransport = {
      request: async (action, body) => {
        if (action === 'start') {
          let voice: string | undefined;
          try { const stored = window.localStorage.getItem('agent-voice-superqa') || ''; if (OPENAI_LIVE_VOICES.includes(stored as typeof OPENAI_LIVE_VOICES[number])) voice = stored; } catch { /* use the server default */ }
          const result = await voiceRequest('start', { ...body, ...(voice ? { voice } : {}) });
          sessionId = result.id || '';
          return result;
        }
        return voiceRequest(action, { ...body, id: sessionId });
      },
    };
    (async () => {
      try {
        mic = await navigator.mediaDevices.getUserMedia({ audio: true });
        if (aborted) { mic.getTracks().forEach(track => track.stop()); return; }
        const connection = await connectLiveVoice(mic, transport, stream => { if (!aborted) setPlayback(stream); }, value => { if (!aborted) setStatus(value); }, controller.signal);
        if (aborted) { await connection.stop(); return; }
        connectionRef.current = connection;
        const result = await connection.finished;
        if (!aborted && !result.closed) setStatus('Voice disconnected · final usage unconfirmed');
      } catch (failure) { if (!aborted) setStatus((failure as Error).message); }
    })();
    return () => { aborted = true; controller.abort(); mic?.getTracks().forEach(track => track.stop()); void connectionRef.current?.stop(); connectionRef.current = null; };
  }, []);

  useEffect(() => { const audio = audioRef.current; if (!audio || !playback) return; audio.srcObject = playback; void audio.play().catch(() => {}); return () => { audio.srcObject = null; }; }, [playback]);

  const toggleMute = () => { const next = !muted; setMuted(next); connectionRef.current?.setPaused(next); };
  const normal = /^(Connecting|Listening|Speaking|Live agent connected|Agent reconnecting)/.test(status);

  return <div className="flex items-center gap-2 border-t border-border bg-elevated/60 px-3 py-2">
    <audio ref={audioRef} autoPlay />
    <span className={'h-2 w-2 shrink-0 rounded-full ' + (normal ? 'animate-pulse bg-success' : 'bg-warning')} aria-hidden="true" />
    <p className="min-w-0 flex-1 truncate text-xs text-text-secondary" role={normal ? 'status' : 'alert'} aria-live="polite">{status}</p>
    <button type="button" onClick={toggleMute} title={muted ? 'Unmute microphone' : 'Mute microphone'} aria-pressed={muted} className="rounded-lg p-1.5 text-text-secondary transition-colors hover:bg-border">
      {muted ? <MicOff size={14} /> : <Mic size={14} />}
    </button>
    <button type="button" onClick={onExit} title="End voice" className="rounded-lg p-1.5 text-danger transition-colors hover:bg-danger/10">
      <PhoneOff size={14} />
    </button>
  </div>;
}
