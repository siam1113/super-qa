'use client';

import { useEffect, useState } from 'react';

export function useAudioActivity(stream?: MediaStream | null, enabled = true, sharedContext?: AudioContext) {
  const [level, setLevel] = useState(0);
  useEffect(() => {
    if (!stream?.getAudioTracks().length || !enabled) { setLevel(0); return; }
    const context = sharedContext || new AudioContext();
    const analyser = context.createAnalyser(); analyser.fftSize = 512;
    const source = context.createMediaStreamSource(new MediaStream(stream.getAudioTracks()));
    source.connect(analyser);
    const samples = new Float32Array(analyser.fftSize);
    let frame = 0; let active = true; let previous = 0; let lastVoice = 0;
    const sample = (now: number) => {
      if (!active) return;
      if (now - previous >= 80) {
        previous = now;
        analyser.getFloatTimeDomainData(samples);
        const energy = Math.sqrt(samples.reduce((sum, value) => sum + value * value, 0) / samples.length);
        const audible = stream.getAudioTracks().some(track => track.enabled && track.readyState === 'live');
        if (audible && energy > .012) lastVoice = now;
        setLevel(audible && now - lastVoice < 240 ? Math.max(.08, Math.min(1, energy * 5)) : 0);
      }
      frame = requestAnimationFrame(sample);
    };
    void context.resume().then(() => { if (active) frame = requestAnimationFrame(sample); }).catch(() => {});
    return () => { active = false; cancelAnimationFrame(frame); source.disconnect(); analyser.disconnect(); if (!sharedContext) void context.close(); };
  }, [stream, enabled, sharedContext]);
  return enabled ? level : 0;
}
