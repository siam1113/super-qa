'use client';

import { useEffect, useRef, useState } from 'react';
import { chatRequest } from '@/lib/chat';
import { connectLiveVoice, LiveTransport, OPENAI_LIVE_VOICES } from '@/lib/live-voice';
import { useAudioActivity } from './useAudioActivity';

export function AgentAudio({ stream, onSpeakingChange, context }: { stream: MediaStream; onSpeakingChange?: (speaking: boolean) => void; context?: AudioContext }) {
  const element = useRef<HTMLAudioElement>(null);
  const [blocked, setBlocked] = useState(false);
  useEffect(() => { const audio = element.current!; setBlocked(false); audio.srcObject = stream; void audio.play().catch(() => setBlocked(true)); return () => { audio.pause(); audio.srcObject = null; }; }, [stream]);
  const level = useAudioActivity(stream, !blocked, context);
  const callback = useRef(onSpeakingChange); callback.current = onSpeakingChange;
  useEffect(() => { callback.current?.(level > 0); }, [level > 0]);
  useEffect(() => () => callback.current?.(false), []);
  return <audio ref={element} autoPlay />;
}

export function NativeVoice({ meetingId, session, local, humans, context, broadcast, paused, voicePreferenceKey, iceServers, agentId, onSpeakingChange, onPresenceChange, onOutputStream }: { meetingId: string; session: string; local: MediaStream; humans: MediaStream[]; context: AudioContext; broadcast: MediaStreamAudioDestinationNode; paused: boolean; voicePreferenceKey?: 'qae' | 'aue'; iceServers?: RTCIceServer[]; agentId: string; onSpeakingChange?: (speaking: boolean) => void; onPresenceChange?: (present: boolean) => void; onOutputStream?: (stream: MediaStream | null) => void }) {
  const [status, setStatus] = useState('Connecting live AI…');
  const [playback, setPlayback] = useState<MediaStream | null>(null);
  const presenceCallback = useRef(onPresenceChange); presenceCallback.current = onPresenceChange;
  useEffect(() => { presenceCallback.current?.(Boolean(playback)); }, [playback]);
  const outputCallback = useRef(onOutputStream); outputCallback.current = onOutputStream;
  useEffect(() => { outputCallback.current?.(playback); }, [playback]);
  const connectionRef = useRef<Awaited<ReturnType<typeof connectLiveVoice>> | null>(null);
  const pausedRef = useRef(paused); pausedRef.current = paused;
  const speakingCallback = useRef(onSpeakingChange); speakingCallback.current = onSpeakingChange;
  const input = useRef<MediaStreamAudioDestinationNode | null>(null);
  const sources = useRef<MediaStreamAudioSourceNode[]>([]);
  const streams = useRef(humans); streams.current = humans;
  const update = () => {
    sources.current.forEach(source => source.disconnect()); sources.current = [];
    if (!input.current) return;
    for (const stream of [local, ...streams.current]) if (stream.getAudioTracks().length) {
      const source = context.createMediaStreamSource(new MediaStream(stream.getAudioTracks())); source.connect(input.current); sources.current.push(source);
    }
  };
  useEffect(() => { update(); }, [humans]);
  useEffect(() => {
    let active = true; let output: MediaStreamAudioSourceNode | undefined; let analyser: AnalyserNode | undefined; let animationFrame = 0; let speaking = false; let quietFrames = 0;
    const controller = new AbortController();
    const destination = context.createMediaStreamDestination(); input.current = destination; update();
    const request: LiveTransport['request'] = (action, body) => {
      let voice: string | undefined;
      if (action === 'start' && voicePreferenceKey) {
        try { const storedVoice = window.localStorage.getItem('agent-voice-' + voicePreferenceKey) || ''; if (OPENAI_LIVE_VOICES.includes(storedVoice as typeof OPENAI_LIVE_VOICES[number])) voice = storedVoice; } catch { /* Use the server's per-agent default when storage is unavailable. */ }
      }
      return chatRequest<{ sdp?: string; opening?: string; stopped?: boolean; error?: string | null; status?: string; finalized?: boolean }>('/meetings/' + meetingId + '/voice/' + action, { ...body, sessionId: session, agentId, ...(action === 'start' ? { consent: true, ...(voice ? { voice } : {}) } : {}) });
    };
    void (async () => {
      let attempts = 0;
      let reconnect = false;
      while (active) {
        destination.stream.getAudioTracks().forEach(track => { track.enabled = !pausedRef.current; });
        try {
          const connection = await connectLiveVoice(destination.stream, { request: (action, body) => request(action, { ...body, ...(action === 'start' && reconnect ? { reconnect: true } : {}) }) }, stream => {
            if (!active) return;
            setPlayback(stream);
            output?.disconnect(); analyser?.disconnect(); cancelAnimationFrame(animationFrame);
            output = context.createMediaStreamSource(stream); output.connect(broadcast);
            analyser = context.createAnalyser(); analyser.fftSize = 512; output.connect(analyser);
            const samples = new Float32Array(analyser.fftSize);
            const measure = () => {
              if (!active || !analyser) return;
              analyser.getFloatTimeDomainData(samples);
              const level = Math.sqrt(samples.reduce((sum, sample) => sum + sample * sample, 0) / samples.length);
              if (level > 0.018) { quietFrames = 0; if (!speaking) { speaking = true; speakingCallback.current?.(true); } }
              else if (speaking && ++quietFrames >= 12) { speaking = false; quietFrames = 0; speakingCallback.current?.(false); }
              animationFrame = requestAnimationFrame(measure);
            };
            animationFrame = requestAnimationFrame(measure);
          }, value => { if (active) setStatus(value); }, controller.signal, iceServers);
          connection.setPaused(pausedRef.current);
          if (!active) { await connection.stop(); return; }
          const connected = connection;
          const clearConnection = () => { if (connectionRef.current === connected) connectionRef.current = null; };
          connectionRef.current = connected;
          const result = await connection.finished;
          await connection.stop();
          clearConnection();
          if (!result.reconnectable && !result.closed) return;
        } catch (failure) { if (active) setStatus((failure as Error).message + ' · checking whether the session closed safely'); }
        output?.disconnect(); analyser?.disconnect(); cancelAnimationFrame(animationFrame); output = undefined; analyser = undefined;
        if (active) setPlayback(null);
        if (speaking) { speaking = false; speakingCallback.current?.(false); }
        if (!active || attempts >= 2) return;
        try {
          const previous = await request('pulse', {});
          if (previous.status !== 'closed' || previous.finalized !== true) { setStatus(previous.error || 'Agent paused · waiting for confirmed session close'); return; }
        } catch { setStatus('Agent paused · reconnect could not be confirmed'); return; }
        attempts += 1; reconnect = true; setStatus('Agent reconnecting…');
        await new Promise(resolve => setTimeout(resolve, attempts * 1200));
      }
    })();
    return () => { active = false; controller.abort(); input.current = null; output?.disconnect(); analyser?.disconnect(); cancelAnimationFrame(animationFrame); if (speaking) speakingCallback.current?.(false); sources.current.forEach(source => source.disconnect()); sources.current = []; destination.stream.getTracks().forEach(track => track.stop()); void connectionRef.current?.stop(); connectionRef.current = null; };
  }, [meetingId, session, local, context, broadcast]);
  useEffect(() => { connectionRef.current?.setPaused(paused); if (paused) setStatus('AI voice paused · audio sharing is off'); }, [paused]);
  const normal = /^(Connecting|Listening|Speaking|Live agent connected · (sending greeting|greeting accepted)|Agent reconnecting|AI voice paused)/.test(status);
  return <>{playback && <AgentAudio stream={playback} context={context} />}<div className={normal ? 'sr-only' : 'call-alert'} role={normal ? 'status' : 'alert'} aria-live="polite">{status}</div></>;
}
