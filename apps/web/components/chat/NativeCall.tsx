'use client';

import { useEffect, useRef, useState } from 'react';
import { Bot, Captions, CameraOff, FileText, LockKeyhole, LogOut, Maximize2, MessageSquare, Mic, MicOff, Minimize2, Pause, PhoneOff, Play, Users, Video, VideoOff, X } from 'lucide-react';
import { chatRequest } from '@/lib/chat';
import { CallPeer, MeetingActivityEntry } from '@/lib/meetings';
import { AgentAudio, NativeVoice } from './NativeVoice';
import { MeetingActivity } from './MeetingActivity';
import { useAudioActivity } from './useAudioActivity';

type Recognition = { continuous: boolean; interimResults: boolean; lang: string; start(): void; stop(): void; abort(): void; onresult: ((event: { resultIndex: number; results: { length: number; [index: number]: { isFinal: boolean; [index: number]: { transcript: string } } } }) => void) | null; onerror: (() => void) | null; onend: (() => void) | null };
type SpeechWindow = Window & { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };

function initials(label: string) { return label.trim().split(/\s+/).slice(0, 2).map(part => part[0]).join('').toUpperCase() || 'U'; }
function elapsedLabel(seconds: number) { return `${Math.floor(seconds / 60).toString().padStart(2, '0')}:${(seconds % 60).toString().padStart(2, '0')}`; }

function VideoTile({ stream, label, muted = false, cameraOff = false, state, microphone = true, context }: { stream: MediaStream; label: string; muted?: boolean; cameraOff?: boolean; state?: string; microphone?: boolean; context?: AudioContext }) {
  const video = useRef<HTMLVideoElement>(null);
  const [videoReady, setVideoReady] = useState(false);
  const level = useAudioActivity(stream, microphone, context);
  useEffect(() => { setVideoReady(false); if (video.current) { video.current.srcObject = stream; void video.current.play().catch(() => {}); } }, [stream]);
  const hasVideo = stream.getVideoTracks().length > 0;
  return <div className={'call-video-tile' + (level > 0 ? ' call-video-tile--speaking' : '')} style={{ '--speaking-level': level } as React.CSSProperties} role="group" aria-label={label + ' video tile' + (level > 0 ? ', speaking' : '') + (state ? ', ' + state : '')}>
    <video ref={video} autoPlay playsInline muted={muted} aria-label={label + ' camera'} onCanPlay={() => setVideoReady(true)} onLoadedData={() => setVideoReady(true)} className={'call-video-feed' + (!hasVideo || cameraOff || !videoReady ? ' call-video-feed--hidden' : '')} />
    {(!hasVideo || cameraOff || !videoReady) && <div className="call-avatar" aria-hidden="true"><span>{initials(label)}</span>{cameraOff && <CameraOff size={14} />}</div>}
    <span className="call-tile-name" aria-hidden="true">{label}</span>
  </div>;
}

export function NativeCall({ meetingId, title = 'Native call', live, onJoined, voice, liveVoice, agents = [], userName = 'You', canEndMeeting = false, onEndMeeting, onViewSummary, onCloseWindow, joinedPeers = [], notesOnly = false, shareTranscript = true, transcript = [], activity = [], onPostActivity }: { meetingId: string; title?: string; live: boolean; onJoined: (session: string | null) => void; voice?: { at: string; text: string }; liveVoice?: { name: string; host: boolean; status: string }; agents?: { id: string; name: string; kind?: 'qae' | 'aue'; status?: string }[]; userName?: string; canEndMeeting?: boolean; onEndMeeting?: () => void; onViewSummary?: () => void; onCloseWindow?: () => void; transcript?: { id: string; speaker: string; text: string }[]; notesOnly?: boolean; shareTranscript?: boolean; joinedPeers?: { memberId: string; name: string }[]; activity?: MeetingActivityEntry[]; onPostActivity?: (text: string, replyToId?: string) => Promise<void> }) {
  const [local, setLocal] = useState<{ stream: MediaStream; session: string; iceServers: RTCIceServer[]; joinedAt: number; context: AudioContext; broadcast: MediaStreamAudioDestinationNode } | null>(null);
  const [remote, setRemote] = useState<Record<string, { stream: MediaStream; name: string; state: string }>>({});
  const [agentAudio, setAgentAudio] = useState<Record<string, MediaStream>>({});
  const [agentOutputStreams, setAgentOutputStreams] = useState<Record<string, MediaStream>>({});
  const [agentSpeaking, setAgentSpeaking] = useState<Record<string, boolean>>({});
  const [agentPresent, setAgentPresent] = useState<Record<string, boolean>>({});
  const [voicePaused, setVoicePaused] = useState(false);
  const [sidePanel, setSidePanel] = useState<'transcript' | 'activity' | null>(null); const [manualNote, setManualNote] = useState(''); const [savingNote, setSavingNote] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  const [mic, setMic] = useState(false); const [camera, setCamera] = useState(false); const [captioning, setCaptioning] = useState(false);
  const [previewMic, setPreviewMic] = useState(false); const [preview, setPreview] = useState<MediaStream | null>(null); const [previewError, setPreviewError] = useState('');
  const [previewAttempt, setPreviewAttempt] = useState(0);
  const [mics, setMics] = useState<MediaDeviceInfo[]>([]); const [cameras, setCameras] = useState<MediaDeviceInfo[]>([]);
  const [micDeviceId, setMicDeviceId] = useState(''); const [cameraDeviceId, setCameraDeviceId] = useState('');
  const [micLevel, setMicLevel] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const callExperience = useRef<HTMLElement>(null);
  const previewRef = useRef<MediaStream | null>(null); const previewVideo = useRef<HTMLVideoElement>(null);
  const [leftCall, setLeftCall] = useState(false); const [endedByUser, setEndedByUser] = useState(false);
  const mounted = useRef(true); const capture = useRef<Recognition | null>(null);
  const [speaking, setSpeaking] = useState(false); const micRef = useRef(mic); micRef.current = mic; const stopVoice = useRef<() => void>(() => {}); const played = useRef('');
  const base = '/meetings/' + meetingId;
  const notify = useRef(onJoined); notify.current = onJoined;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    const updateFullscreen = () => setFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', updateFullscreen);
    return () => document.removeEventListener('fullscreenchange', updateFullscreen);
  }, []);
  useEffect(() => {
    if (!local) { setElapsed(0); return; }
    const update = () => setElapsed(Math.max(0, Math.floor((Date.now() - local.joinedAt) / 1000)));
    update();
    const timer = window.setInterval(update, 1000);
    return () => window.clearInterval(timer);
  }, [local]);
  useEffect(() => {
    let active = true;
    const startPreview = async () => {
      try {
        const audio = { echoCancellation: true, noiseSuppression: true, ...(micDeviceId ? { deviceId: { exact: micDeviceId } } : {}) };
        const video = cameraDeviceId ? { deviceId: { exact: cameraDeviceId } } : true;
        let stream: MediaStream;
        try { stream = await navigator.mediaDevices.getUserMedia({ audio, video }); }
        catch { stream = await navigator.mediaDevices.getUserMedia({ audio, video: false }); setCamera(false); }
        if (!active) { stream.getTracks().forEach(track => track.stop()); return; }
        stream.getAudioTracks().forEach(track => { track.enabled = previewMic; });
        stream.getVideoTracks().forEach(track => { track.enabled = camera; });
        previewRef.current = stream; setPreview(stream); setPreviewError('');
        try { const found = await navigator.mediaDevices.enumerateDevices(); if (active) { setMics(found.filter(device => device.kind === 'audioinput')); setCameras(found.filter(device => device.kind === 'videoinput')); } } catch { /* device labels unavailable without permission */ }
      } catch (failure) { if (active) setPreviewError((failure as Error).message || 'Allow microphone access to preview your call setup.'); }
    };
    if (!local && live && !leftCall) void startPreview();
    return () => { active = false; previewRef.current?.getTracks().forEach(track => track.stop()); previewRef.current = null; };
  }, [live, local, leftCall, previewAttempt, micDeviceId, cameraDeviceId]);
  useEffect(() => { if (!previewVideo.current || !preview) return; previewVideo.current.srcObject = preview; void previewVideo.current.play().catch(() => {}); }, [preview, camera]);
  useEffect(() => {
    const track = preview?.getAudioTracks()[0];
    if (!track || !previewMic) { setMicLevel(0); return; }
    const context = new AudioContext(); const analyser = context.createAnalyser(); analyser.fftSize = 256;
    const source = context.createMediaStreamSource(new MediaStream([track])); source.connect(analyser);
    const samples = new Uint8Array(analyser.fftSize); let frame = 0; let active = true;
    const sample = () => { if (!active) return; analyser.getByteTimeDomainData(samples); const energy = samples.reduce((total, value) => total + ((value - 128) / 128) ** 2, 0) / samples.length; setMicLevel(Math.min(1, Math.sqrt(energy) * 4)); frame = requestAnimationFrame(sample); };
    void context.resume().then(sample).catch(() => {});
    return () => { active = false; cancelAnimationFrame(frame); source.disconnect(); analyser.disconnect(); void context.close(); };
  }, [preview, previewMic]);
  useEffect(() => { if (!live) setLocal(null); }, [live]);
  const voiceAt = voice?.at; const voiceText = voice?.text;
  useEffect(() => {
    if (!local || !live || !voiceAt || !voiceText || played.current === voiceAt || Date.parse(voiceAt) < local.joinedAt || Date.now() - Date.parse(voiceAt) > 15000) return;
    played.current = voiceAt;
    if (!window.speechSynthesis) { setError('AI voice is unavailable in this browser; read the written contribution.'); return; }
    capture.current?.abort(); setCaptioning(false); setSpeaking(true);
    local.stream.getAudioTracks().forEach(track => { track.enabled = false; });
    const finish = () => { window.speechSynthesis.cancel(); setSpeaking(false); local.stream.getAudioTracks().forEach(track => { if (track.readyState === 'live') track.enabled = micRef.current; }); };
    stopVoice.current = finish;
    const utterance = new SpeechSynthesisUtterance(voiceText);
    utterance.onend = finish; utterance.onerror = finish;
    window.speechSynthesis.cancel(); window.speechSynthesis.speak(utterance);
    const timeout = setTimeout(finish, 60000);
    return () => { clearTimeout(timeout); utterance.onend = null; utterance.onerror = null; finish(); };
  }, [local, live, voiceAt, voiceText]);

  useEffect(() => {
    if (!local) { notify.current(null); return; }
    let active = true; let polling = false; let cursor = 0; const connections = new Map<string, RTCPeerConnection>(); const candidates = new Map<string, RTCIceCandidateInit[]>(); const agentStreams = new Map<string, string>();
    notify.current(local.session);
    const signal = async (recipient: string, payload: object) => { if (active) await chatRequest(base + '/signal', { sessionId: local.session, requestId: crypto.randomUUID(), recipient, payload: { ...payload, agentStreamId: local.broadcast.stream.id } }); };
    const connection = (peer: CallPeer) => {
      const previous = connections.get(peer.sessionId); if (previous) return previous;
      const next = new RTCPeerConnection({ iceServers: local.iceServers }); connections.set(peer.sessionId, next);
      local.stream.getTracks().forEach(track => next.addTrack(track, local.stream));
      local.broadcast.stream.getTracks().forEach(track => next.addTrack(track, local.broadcast.stream));
      next.onicecandidate = event => { if (event.candidate) void signal(peer.sessionId, { type: 'ice', candidate: event.candidate.toJSON() }).catch(() => { if (active) setError('Could not exchange connection details. Leave and rejoin.'); }); };
      next.ontrack = event => { if (active && event.streams[0]) { if (event.streams[0].id === agentStreams.get(peer.sessionId)) setAgentAudio(current => ({ ...current, [peer.sessionId]: event.streams[0] })); else setRemote(current => ({ ...current, [peer.sessionId]: { stream: event.streams[0], name: peer.name, state: next.connectionState } })); } };
      next.onconnectionstatechange = () => { if (!active) return; setRemote(current => current[peer.sessionId] ? { ...current, [peer.sessionId]: { ...current[peer.sessionId], state: next.connectionState } } : current); if (next.connectionState === 'failed') setError('A media connection failed. Check TURN configuration, then leave and rejoin.'); };
      return next;
    };
    const poll = async () => {
      if (!active || polling) return; polling = true;
      try {
        const result = await chatRequest<{ peers: CallPeer[]; signals: { sequence: number; sender: string; payload: { type: 'offer' | 'answer' | 'ice'; sdp?: string; candidate?: RTCIceCandidateInit; agentStreamId?: string } }[] }>(base + '/poll', { sessionId: local.session, after: cursor });
        if (!active) return;
        for (const [session, peerConnection] of connections) if (!result.peers.some(peer => peer.sessionId === session)) { peerConnection.close(); connections.delete(session); candidates.delete(session); agentStreams.delete(session); setAgentAudio(current => { const updated = { ...current }; delete updated[session]; return updated; }); setRemote(current => { const updated = { ...current }; delete updated[session]; return updated; }); }
        for (const peer of result.peers) if (peer.sessionId !== local.session && !connections.has(peer.sessionId)) {
          const next = connection(peer);
          if (local.session < peer.sessionId) { await next.setLocalDescription(await next.createOffer()); await signal(peer.sessionId, { type: 'offer', sdp: next.localDescription!.sdp }); }
        }
        for (const item of result.signals) {
          const peer = result.peers.find(value => value.sessionId === item.sender);
          if (peer) {
            const next = connection(peer);
            if (item.payload.type === 'ice') {
              if (next.remoteDescription) await next.addIceCandidate(item.payload.candidate);
              else candidates.set(item.sender, [...(candidates.get(item.sender) || []), item.payload.candidate!]);
            } else {
              if (item.payload.agentStreamId) agentStreams.set(peer.sessionId, item.payload.agentStreamId);
              await next.setRemoteDescription({ type: item.payload.type, sdp: item.payload.sdp });
              for (const candidate of candidates.get(item.sender) || []) await next.addIceCandidate(candidate);
              candidates.delete(item.sender);
              if (item.payload.type === 'offer') { await next.setLocalDescription(await next.createAnswer()); await signal(item.sender, { type: 'answer', sdp: next.localDescription!.sdp }); }
            }
          }
          cursor = Math.max(cursor, item.sequence);
        }
      } catch (failure) { if (active) { setError((failure as Error).message + ' Call disconnected for safety; rejoin when available.'); setLocal(null); } }
      finally { polling = false; }
    };
    void poll();
    const events = new EventSource('/api/chat/events', { withCredentials: true });
    const onChange = (event: MessageEvent<string>) => {
      try { if (JSON.parse(event.data).meetingId === meetingId) void poll(); } catch {}
    };
    events.addEventListener('change', onChange as EventListener);
    events.addEventListener('connected', () => void poll());
    const heartbeat = setInterval(poll, 10000); // Refresh the peer lease; signaling arrives over SSE.
    return () => { active = false; events.close(); clearInterval(heartbeat); connections.forEach(peer => peer.close()); local.stream.getTracks().forEach(track => track.stop()); local.broadcast.stream.getTracks().forEach(track => track.stop()); void local.context.close(); capture.current?.abort(); capture.current = null; setCaptioning(false); setRemote({}); setAgentAudio({}); notify.current(null); void chatRequest(base + '/leave', { sessionId: local.session }).catch(() => {}); };
  }, [local, base]);

  const join = async () => {
    setBusy(true); setError(''); let stream: MediaStream | undefined; let context: AudioContext | undefined;
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('Microphone/video requires HTTPS or localhost and a supported browser');
      stream = previewRef.current || await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true }, video: camera });
      stream.getAudioTracks().forEach(track => { track.enabled = previewMic; });
      context = new AudioContext(); await context.resume(); const broadcast = context.createMediaStreamDestination();
      const session = crypto.randomUUID();
      const settings = await chatRequest<{ iceServers: RTCIceServer[]; relayConfigured: boolean }>(base + '/join', { sessionId: session, consent: true });
      if (!mounted.current) { stream.getTracks().forEach(track => track.stop()); await context.close(); await chatRequest(base + '/leave', { sessionId: session }); return; }
      previewRef.current = null; setPreview(null); setLeftCall(false); setEndedByUser(false);
      setMic(previewMic); setLocal({ stream, session, iceServers: settings.iceServers, joinedAt: Date.now(), context, broadcast });
    } catch (failure) { stream?.getTracks().forEach(track => track.stop()); if (context) await context.close(); if (mounted.current) setError((failure as Error).message); }
    finally { if (mounted.current) setBusy(false); }
  };
  const toggleCaptions = () => {
    if (captioning) { capture.current?.abort(); capture.current = null; setCaptioning(false); return; }
    const windowWithSpeech = window as SpeechWindow;
    const Recognizer = windowWithSpeech.SpeechRecognition || windowWithSpeech.webkitSpeechRecognition;
    if (!Recognizer || !local) { setError('Browser captions are unavailable. Use manual transcript entries instead.'); return; }
    const recognition = new Recognizer(); capture.current = recognition; recognition.continuous = true; recognition.interimResults = false; recognition.lang = 'en-US';
    recognition.onresult = event => { for (let index = event.resultIndex; index < event.results.length; index++) if (event.results[index].isFinal) void chatRequest(base + '/entries', { sessionId: local.session, requestId: crypto.randomUUID(), source: 'browser_caption', text: event.results[index][0].transcript.slice(0, 2000) }).catch(failure => setError((failure as Error).message)); };
    recognition.onerror = () => { capture.current = null; setError('Speech recognition stopped. Check microphone permissions or use manual entries.'); setCaptioning(false); };
    recognition.onend = () => { if (notesOnly && capture.current === recognition && micRef.current) { try { recognition.start(); return; } catch {} } setCaptioning(false); };
    try { recognition.start(); setCaptioning(true); } catch { setError('Speech recognition could not start'); }
  };

  useEffect(() => {
    if (!local || !notesOnly || !shareTranscript || !mic) return;
    toggleCaptions();
    return () => { const recognition = capture.current; capture.current = null; recognition?.abort(); setCaptioning(false); };
  }, [local?.session, notesOnly, shareTranscript, mic]);

  const presentAgents = agents.filter(participant => !liveVoice || (liveVoice.host ? agentPresent[participant.id] : liveVoice.status === 'live'));
  const participantCount = 1 + Object.keys(remote).length + presentAgents.length;
  const previewHasMic = Boolean(preview?.getAudioTracks().length);
  const micTestStatus = !previewHasMic ? 'No mic detected' : !previewMic ? 'Mic muted' : micLevel > .045 ? 'Mic working' : 'Speak to test';
  const micTestLevel = previewHasMic && previewMic ? micLevel : 0;
  const closeWindow = () => { if (onCloseWindow) onCloseWindow(); else (document.querySelector('dialog[open]') as HTMLDialogElement | null)?.close(); };
  const visibleLobbyAvatars = joinedPeers.slice(0, 3);
  const extraLobbyAvatars = joinedPeers.length - visibleLobbyAvatars.length;
  const toggleFullscreen = async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else {
        const target = callExperience.current;
        if (!target) throw new Error('Call screen is not available for full screen.');
        await target.requestFullscreen();
      }
    } catch (failure) { setError((failure as Error).message || 'Fullscreen is not available in this browser.'); }
  };
  const endMeeting = async () => { setBusy(true); try { await onEndMeeting?.(); setEndedByUser(true); setLocal(null); } catch (failure) { setError((failure as Error).message); } finally { setBusy(false); } };
  const saveNote = async () => {
    if (!local || !manualNote.trim()) return;
    setSavingNote(true);
    try { await chatRequest(base + '/entries', { sessionId: local.session, requestId: crypto.randomUUID(), source: 'manual', text: manualNote.trim() }); setManualNote(''); }
    catch (failure) { setError((failure as Error).message); }
    finally { setSavingNote(false); }
  };
  return <section ref={callExperience} className={'call-experience' + (local ? ' call-experience--active' : '')} aria-label="Native video call">
    {error && <p role="alert" className="call-alert">{error}</p>}
    {live && !liveVoice && agents.some(agent => !agent.status || agent.status.includes('unavailable')) && <p role="alert" className="call-alert">Agent voice is unavailable for this call. Ask your administrator to enable live voice, then start a new call.</p>}
    {!local ? !live || endedByUser ? <div className="call-end-screen"><span className="call-end-icon"><PhoneOff size={23} /></span><p className="call-eyebrow">Call ended</p><h3>{endedByUser ? 'You ended the call' : 'This call has ended'}</h3><p className="call-lobby-copy">The meeting is over. Review the notes and actions captured during the call.</p><div className="call-lobby-actions"><button type="button" className="call-cancel-button" onClick={closeWindow}>Close</button><button className="call-join-button" onClick={onViewSummary}>Check out the meeting summary here</button></div></div> : leftCall ? <div className="call-end-screen"><span className="call-end-icon"><PhoneOff size={23} /></span><p className="call-eyebrow">Meeting in progress</p><h3>You left the call</h3><p className="call-lobby-copy">The meeting is still ongoing. You can rejoin whenever you’re ready.</p><button className="call-join-button" disabled={busy} onClick={join}>{busy ? <><span className="call-spinner" /> Rejoining…</> : <><Video size={17} /> Join back in</>}</button></div> : <div className="call-lobby">
      <div className={'call-lobby-art' + (preview?.getVideoTracks().length && camera ? ' call-lobby-art--video' : '')}>
        {preview?.getVideoTracks().length ? <video ref={previewVideo} autoPlay playsInline muted className={'call-preview-video' + (!camera ? ' call-preview-video--off' : '')} /> : <div className="call-lobby-mark">{initials(userName.split('@')[0])}</div>}
        {!camera && <div className="call-preview-avatar">{initials(userName.split('@')[0])}</div>}
        <div className="call-device-controls">
          <button type="button" className={'call-device-toggle' + (!previewMic ? ' is-off' : '')} aria-label={previewMic ? 'Mute microphone' : 'Turn microphone on'} data-tooltip={previewMic ? 'Mute microphone' : 'Turn microphone on'} disabled={!preview?.getAudioTracks().length} onClick={() => { const next = !previewMic; setPreviewMic(next); preview?.getAudioTracks().forEach(track => { track.enabled = next; }); }}>{previewMic ? <Mic size={19} /> : <MicOff size={19} />}</button>
          <button type="button" className={'call-device-toggle' + (!camera ? ' is-off' : '')} aria-label={camera ? 'Turn camera off' : 'Turn camera on'} data-tooltip={camera ? 'Turn camera off' : 'Turn camera on'} disabled={!preview?.getVideoTracks().length} onClick={() => { const next = !camera; setCamera(next); preview?.getVideoTracks().forEach(track => { track.enabled = next; }); }}>{camera ? <Video size={19} /> : <VideoOff size={19} />}</button>
        </div>
        <div className="call-mic-test"><span className="call-mic-test-label">MIC</span><div className="call-mic-meter" role="meter" aria-label="Microphone input level" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(micTestLevel * 100)}><span style={{ transform: `scaleX(${Math.max(.035, micTestLevel)})` }} /></div><strong>{micTestStatus}</strong></div>
      </div>
      <div className="call-lobby-content">
        <div className="call-lobby-heading">
          <div>
            <span className="call-eyebrow">Native call</span>
            <h3>{title}</h3>
            <p className="call-lobby-intro">{notesOnly ? 'Agents listen silently and prepare notes afterward.' : 'Agents can join the discussion and speak when needed.'}</p>
          </div>
          <span className="call-secure-badge"><LockKeyhole size={12} /> Encrypted</span>
        </div>
        <section className="call-lobby-permissions">
          <div className="call-lobby-avatars-row">
            {joinedPeers.length > 0 ? <div className="call-dialing-avatars" aria-label={joinedPeers.length + ' already on this call'}>
              {visibleLobbyAvatars.map(peer => <span key={peer.memberId} title={peer.name}>{initials(peer.name)}</span>)}
              {extraLobbyAvatars > 0 && <span>+{extraLobbyAvatars}</span>}
            </div> : null}
            <p>{joinedPeers.length ? `${joinedPeers.length} ${joinedPeers.length === 1 ? 'person' : 'people'} already here` : 'Be the first to join'}</p>
          </div>
          {previewError && <p role="alert" className="call-notice">{previewError} <button className="text-accent-blue underline" onClick={() => setPreviewAttempt(attempt => attempt + 1)}>Retry devices</button></p>}
          <div>
            <p className="call-lobby-section-label">Devices</p>
            <div className="call-device-row">
              <label className="call-device-field"><Mic size={14} aria-hidden="true" /><select aria-label="Microphone" value={micDeviceId} onChange={event => setMicDeviceId(event.target.value)}><option value="">{mics[0]?.label || 'Default microphone'}</option>{mics.filter(device => device.deviceId).map(device => <option key={device.deviceId} value={device.deviceId}>{device.label || 'Microphone'}</option>)}</select></label>
              <label className="call-device-field"><Video size={14} aria-hidden="true" /><select aria-label="Camera" value={cameraDeviceId} onChange={event => setCameraDeviceId(event.target.value)}><option value="">{cameras[0]?.label || 'Default camera'}</option>{cameras.filter(device => device.deviceId).map(device => <option key={device.deviceId} value={device.deviceId}>{device.label || 'Camera'}</option>)}</select></label>
            </div>
          </div>
        </section>
        <footer className="call-lobby-actions"><button type="button" className="call-cancel-button" onClick={closeWindow}>Cancel</button><button className="call-join-button" disabled={busy || !live || !preview} onClick={join}>{busy ? <><span className="call-spinner" /> Connecting…</> : 'Join call'}</button></footer>
      </div>
    </div> : <>
      <header className="call-session-header"><div className="call-session-brand"><span className="call-session-mark"><Video size={16} /></span><div><strong>Native call</strong><span>Conversation room</span></div></div><div className="call-session-status"><span className="call-session-live"><i /> LIVE</span><span className="call-session-time">{elapsedLabel(elapsed)}</span><span className="call-session-divider" /><span className="call-session-participants"><Users size={15} /> {participantCount}</span></div><span className="call-session-encrypted"><LockKeyhole size={14} /> Encrypted</span></header>
      <div className={'call-stage-grid call-stage-grid--' + Math.min(participantCount, 6)}>
        <VideoTile stream={local.stream} label={userName.split('@')[0]} muted cameraOff={!camera} microphone={mic} context={local.context} />
        {Object.entries(remote).map(([id, peer]) => <VideoTile key={id} stream={peer.stream} label={peer.name} state={peer.state} context={local.context} />)}
        {presentAgents.map(participant => <div key={participant.id} aria-label={participant.name + ' AI participant' + (agentSpeaking[participant.id] ? ', speaking' : participant.status ? ', ' + participant.status : '')} className={'call-ai-tile' + (agentSpeaking[participant.id] ? ' call-ai-tile--speaking' : '')}><span className="call-ai-orb" aria-hidden="true"><Bot size={34} /></span><span className="call-tile-name" aria-hidden="true">{participant.name}</span></div>)}
        {Object.entries(agentAudio).map(([id, stream]) => <AgentAudio key={id} stream={stream} context={local.context} onSpeakingChange={speaking => setAgentSpeaking(current => ({ ...current, [agents[0]?.id]: speaking }))} />)}
      </div>
      {liveVoice?.host && agents.map(agentInfo => <NativeVoice key={agentInfo.id} agentId={agentInfo.id} meetingId={meetingId} session={local.session} local={local.stream} humans={[...Object.values(remote).map(peer => peer.stream), ...Object.entries(agentOutputStreams).filter(([id]) => id !== agentInfo.id).map(([, stream]) => stream)]} context={local.context} broadcast={local.broadcast} paused={voicePaused} voicePreferenceKey={agentInfo.kind} iceServers={local.iceServers} onSpeakingChange={speaking => setAgentSpeaking(current => ({ ...current, [agentInfo.id]: speaking }))} onPresenceChange={present => setAgentPresent(current => ({ ...current, [agentInfo.id]: present }))} onOutputStream={stream => setAgentOutputStreams(current => { if (!stream) { const next = { ...current }; delete next[agentInfo.id]; return next; } return { ...current, [agentInfo.id]: stream }; })} />)}
      {sidePanel === 'transcript' && <aside className="call-transcript-panel" aria-label="Call transcript"><header><h3>Transcript</h3><button aria-label="Close transcript" onClick={() => setSidePanel(null)}><X size={18} /></button></header><div role="log" aria-label="Saved call transcript">{transcript.length ? transcript.map(entry => <article key={entry.id}><p>{entry.speaker}</p><span>{entry.text}</span></article>) : <p>{shareTranscript ? 'Spoken notes appear here as they are saved. You can also add a written note.' : 'Transcript sharing is off for this call.'}</p>}</div>{shareTranscript && <form onSubmit={event => { event.preventDefault(); void saveNote(); }}><input aria-label="Manual transcript entry" maxLength={2000} value={manualNote} onChange={event => setManualNote(event.target.value)} placeholder="Add a written note…" /><button disabled={savingNote || !manualNote.trim()}>Add</button></form>}</aside>}
      {sidePanel === 'activity' && <MeetingActivity onClose={() => setSidePanel(null)} activity={activity} busy={busy} onPost={async (text, replyToId) => { try { await onPostActivity?.(text, replyToId); } catch (failure) { setError((failure as Error).message); } }} />}
      <div className="call-control-row"><div className="call-controls">
        <button className={'call-control' + (!mic ? ' call-control--off' : '')} aria-label={mic ? 'Mute microphone' : 'Unmute microphone'} aria-pressed={!mic} data-tooltip={mic ? 'Mute microphone' : 'Unmute microphone'} onClick={() => { local.stream.getAudioTracks().forEach(track => { track.enabled = !mic; }); setMic(!mic); if (mic) { capture.current?.abort(); setCaptioning(false); } }}>{mic ? <Mic size={20} /> : <MicOff size={20} />}</button>
        <button className={'call-control' + (!camera ? ' call-control--off' : '')} aria-label={camera ? 'Turn camera off' : 'Turn camera on'} aria-pressed={!camera} data-tooltip={camera ? 'Turn camera off' : 'Turn camera on'} disabled={!local.stream.getVideoTracks().length} onClick={() => { const next = !camera; local.stream.getVideoTracks().forEach(track => { track.enabled = next; }); setCamera(next); }}>{camera ? <Video size={20} /> : <VideoOff size={20} />}</button>
        <button className={'call-control' + (captioning ? ' call-control--active' : '')} aria-label={captioning ? 'Stop captions' : 'Enable captions'} aria-pressed={captioning} data-tooltip={captioning ? 'Stop captions' : 'Enable captions'} disabled={!mic || speaking} onClick={toggleCaptions}><Captions size={20} /></button>
        <button className={'call-control' + (sidePanel === 'transcript' ? ' call-control--active' : '')} aria-label="Show transcript" aria-pressed={sidePanel === 'transcript'} data-tooltip="Transcript & notes" onClick={() => setSidePanel(sidePanel === 'transcript' ? null : 'transcript')}><FileText size={20} /></button>
        <button className={'call-control' + (sidePanel === 'activity' ? ' call-control--active' : '')} aria-label="Show activity" aria-pressed={sidePanel === 'activity'} data-tooltip="Activity & messages" onClick={() => setSidePanel(sidePanel === 'activity' ? null : 'activity')}><MessageSquare size={20} /></button>
        {liveVoice?.host && <button className={'call-control' + (voicePaused ? ' call-control--active' : '')} aria-label={voicePaused ? 'Resume AI voice' : 'Pause AI voice'} aria-pressed={voicePaused} data-tooltip={voicePaused ? 'Resume AI voice' : 'Pause AI voice'} onClick={() => setVoicePaused(paused => !paused)}>{voicePaused ? <Play size={20} /> : <Pause size={20} />}</button>}
        <button className="call-control call-fullscreen-button" aria-label={fullscreen ? 'Exit full screen' : 'Enter full screen'} data-tooltip={fullscreen ? 'Exit full screen' : 'Enter full screen'} aria-pressed={fullscreen} onClick={() => void toggleFullscreen()}>{fullscreen ? <Minimize2 size={19} /> : <Maximize2 size={19} />}</button>
        <button className="call-window-close" aria-label="Close call window" data-tooltip="Close call window" onClick={closeWindow}><X size={19} /></button>
        <button className="call-leave-button" aria-label="Leave call" data-tooltip="Leave call" onClick={() => { setLeftCall(true); setLocal(null); }}><LogOut size={20} /></button>
        {canEndMeeting && onEndMeeting && <button disabled={busy} className="call-leave-button call-end-meeting-button" aria-label="End meeting" data-tooltip="End meeting for everyone" onClick={() => void endMeeting()}><PhoneOff size={20} /></button>}
      </div></div>
    </>}
  </section>;
}
