'use client';

import { useEffect, useRef, useState } from 'react';
import { connectLiveVoice } from '@/lib/live-voice';

export default function MeetingVoicePage() {
  const [status, setStatus] = useState('Connecting AI participant…');
  const [name, setName] = useState('Super QA');
  const audio = useRef<HTMLAudioElement>(null);
  const credentials = useRef<string[] | null>(null);
  useEffect(() => {
    if (!credentials.current) credentials.current = location.hash.slice(1).split(':');
    const [meetingId, token] = credentials.current; history.replaceState(null, '', location.pathname);
    if (!/^[a-f0-9-]{36}$/.test(meetingId || '') || !/^[A-Za-z0-9_-]{43}$/.test(token || '')) { setStatus('Meeting authorization is missing'); return; }
    let active = true; let playbackFailed = false; let media: MediaStream | undefined; let stop: (() => Promise<void>) | undefined;
    const request = async (action: string, body: object) => {
      const response = await fetch('/api/meeting-voice/' + meetingId + '/' + action, { method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: JSON.stringify(body), cache: 'no-store', signal: AbortSignal.timeout(40000) });
      if (!response.ok) throw new Error('Meeting voice authorization or setup failed');
      const result = await response.json(); if (active && typeof result.name === 'string') setName(result.name); return result;
    };
    void (async () => {
      try {
        media = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true }, video: false });
        if (!active) { media.getTracks().forEach(track => track.stop()); return; }
        const connection = await connectLiveVoice(media, { request }, stream => { if (audio.current) { audio.current.srcObject = stream; void audio.current.play().catch(() => { playbackFailed = true; setStatus('Audio playback blocked; stopping'); void stop?.(); }); } }, value => { if (active) setStatus(value); });
        stop = connection.stop; if (!active || playbackFailed) await stop();
      } catch { if (active) setStatus('Live voice unavailable · check deployment configuration'); media?.getTracks().forEach(track => track.stop()); }
    })();
    return () => { active = false; media?.getTracks().forEach(track => track.stop()); void stop?.(); };
  }, []);
  return <main className="flex min-h-screen flex-col items-center justify-center gap-6 bg-canvas p-10 text-center text-text-primary"><div className="flex h-36 w-36 items-center justify-center rounded-full border border-accent-purple/50 bg-accent-purple/10 text-5xl">AI</div><h1 className="text-4xl font-semibold">{name} · AI participant</h1><p className="text-xl text-text-secondary">{status}</p><p className="text-sm text-text-secondary">AI-generated voice · meeting audio is processed for discussion and notes</p><audio ref={audio} autoPlay /></main>;
}
