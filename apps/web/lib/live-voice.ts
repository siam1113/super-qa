export const OPENAI_LIVE_VOICES = ['alloy', 'ash', 'ballad', 'coral', 'echo', 'sage', 'shimmer', 'verse', 'marin', 'cedar'] as const;

// Approximate categorization based on OpenAI's typical voice descriptions; not an official
// OpenAI classification. Safe to adjust if a voice reads differently in practice.
export const OPENAI_LIVE_VOICE_GENDER: Record<typeof OPENAI_LIVE_VOICES[number], 'female' | 'male'> = {
  alloy: 'male',
  ash: 'male',
  ballad: 'male',
  coral: 'female',
  echo: 'male',
  sage: 'female',
  shimmer: 'female',
  verse: 'male',
  marin: 'female',
  cedar: 'male',
};

export type LiveTransport = { request(action: 'start' | 'pulse' | 'stop', body: object): Promise<{ sdp?: string; opening?: string; stopped?: boolean; error?: string | null; status?: string; finalized?: boolean }> };
export type LiveDisconnect = { reconnectable: boolean; closed: boolean };
export type LiveVoiceConnection = { stop(): Promise<void>; setPaused(paused: boolean): void; finished: Promise<LiveDisconnect> };

export async function connectLiveVoice(input: MediaStream, transport: LiveTransport, output: (stream: MediaStream) => void, status: (value: string) => void, signal?: AbortSignal, iceServers?: RTCIceServer[]) {
  // This connection always crosses the public internet to reach OpenAI, unlike peer-to-peer human
  // calls which can stay on-LAN. It needs at least a STUN server to find a reachable candidate,
  // regardless of whether this meeting's own TURN/STUN relay (meant for human-to-human calls) is configured.
  const peer = new RTCPeerConnection({ iceServers: [...(iceServers || []), { urls: 'stun:stun.l.google.com:19302' }] });
  const channel = peer.createDataChannel('oai-events');
  let closing = false; let closed = false; let started = false; let timer: ReturnType<typeof setInterval> | undefined; let stopTask: Promise<void> | null = null;
  let modelStarted = false; let paused = false; let opening = ''; let greetingEventId: string | undefined; let cancelEventId: string | undefined; let startupTimer: ReturnType<typeof setTimeout> | undefined; let finish: (result: LiveDisconnect) => void = () => {};
  const finished = new Promise<LiveDisconnect>(resolve => { finish = resolve; });
  let receivedAudio: MediaStream | undefined;
  let disconnectTimer: ReturnType<typeof setTimeout> | undefined;
  let finalize: (() => void) | undefined;
  const sendGreeting = () => {
    if (!modelStarted || !opening || greetingEventId || channel.readyState !== 'open') return;
    greetingEventId = crypto.randomUUID();
    channel.send(JSON.stringify({ type: 'session.instructions.append', event_id: greetingEventId, delegation_id: null, content: opening }));
    status('Live agent connected · sending greeting');
  };
  const sendPauseEvents = () => {
    if (channel.readyState !== 'open') return;
    cancelEventId = crypto.randomUUID();
    channel.send(JSON.stringify({ type: 'response.cancel', event_id: cancelEventId }));
    channel.send(JSON.stringify({ type: 'session.input_audio.mute', event_id: crypto.randomUUID() }));
  };
  const stop = async () => {
    if (stopTask) return stopTask;
    closing = true;
    stopTask = (async () => {
      if (timer) clearInterval(timer);
      if (startupTimer) clearTimeout(startupTimer);
      if (disconnectTimer) clearTimeout(disconnectTimer);
      input.getTracks().forEach(track => { track.enabled = false; });
      receivedAudio?.getTracks().forEach(track => { track.enabled = false; });
      const drain = new Promise<void>(resolve => {
        const timeout = setTimeout(resolve, 8500); finalize = () => { clearTimeout(timeout); resolve(); };
        if (closed || channel.readyState !== 'open') finalize(); else channel.send(JSON.stringify({ type: 'session.close' }));
      });
      const revoke = started && !closed ? transport.request('stop', {}).catch(() => {}) : Promise.resolve();
      await Promise.all([drain, revoke]); peer.close(); channel.close(); signal?.removeEventListener('abort', abort);
      status(closed ? 'Voice ended' : 'Voice disconnected · final usage unconfirmed');
      finish({ closed, reconnectable: false });
    })();
    return stopTask;
  };
  const setPaused = (next: boolean) => {
    if (closing || paused === next) return;
    paused = next;
    input.getAudioTracks().forEach(track => { track.enabled = !paused; });
    receivedAudio?.getAudioTracks().forEach(track => { track.enabled = !paused; });
    if (channel.readyState === 'open') {
      if (paused) sendPauseEvents();
      else channel.send(JSON.stringify({ type: 'session.input_audio.unmute', event_id: crypto.randomUUID() }));
    }
    if (!paused) sendGreeting();
    status(paused ? 'AI voice paused · audio sharing is off' : 'Listening · live AI participant');
  };
  const abort = () => { void stop(); };
  signal?.addEventListener('abort', abort, { once: true });
  channel.onmessage = message => {
    try {
      const event = JSON.parse(message.data);
      const isCancelError = event.type === 'error' && cancelEventId && event.client_event_id === cancelEventId;
      if (event.type === 'session.started') {
        modelStarted = true;
        if (startupTimer) clearTimeout(startupTimer);
        status(paused ? 'AI voice paused · audio sharing is off' : 'Listening · live AI participant');
        if (!paused) sendGreeting();
      }
      if (event.type === 'session.instructions.appended' && event.client_event_id === greetingEventId && !paused) status('Live agent connected · greeting accepted');
      if (event.type === 'session.output_transcript.delta' && !paused) status('Speaking · ' + String(event.delta || '').slice(-160));
      if (event.type === 'session.closed') { closed = true; finalize?.(); finish({ closed: true, reconnectable: false }); void stop(); }
      if (isCancelError) cancelEventId = undefined;
      if (event.type === 'error' && greetingEventId && event.client_event_id === greetingEventId) status('Live agent connected · greeting instruction rejected');
      else if (event.type === 'error' && !isCancelError) { status('Live model disconnected; checking whether it can safely rejoin'); finish({ closed: false, reconnectable: true }); void stop(); }
    } catch { status('Invalid live event; stopping voice'); void stop(); }
  };
  channel.onopen = () => { if (paused) sendPauseEvents(); else sendGreeting(); };
  channel.onclose = () => { if (!closing) { const reconnectable = !closed; status(reconnectable ? 'Live control connection lost · checking for a safe reconnect' : 'Voice ended'); finish({ closed, reconnectable }); void stop(); } };
  peer.ontrack = event => { receivedAudio = event.streams[0] || new MediaStream([event.track]); if (!closing) output(receivedAudio); else receivedAudio.getTracks().forEach(track => { track.enabled = false; }); };
  const disconnect = () => {
    if (closing) return;
    status('Live audio connection lost · stopping voice before reconnecting');
    finish({ closed: false, reconnectable: true }); void stop();
  };
  peer.onconnectionstatechange = () => {
    if (closing) return;
    if (peer.connectionState === 'disconnected') {
      if (!disconnectTimer) disconnectTimer = setTimeout(disconnect, 10000);
      return;
    }
    if (disconnectTimer) { clearTimeout(disconnectTimer); disconnectTimer = undefined; }
    if (['failed', 'closed'].includes(peer.connectionState)) disconnect();
  };
  try {
    if (signal?.aborted) { await stop(); throw new Error('Voice startup cancelled'); }
    input.getAudioTracks().forEach(track => peer.addTrack(track, input));
    await peer.setLocalDescription(await peer.createOffer());
    await new Promise<void>((resolve, reject) => {
      if (peer.iceGatheringState === 'complete') { resolve(); return; }
      const timeout = setTimeout(() => { peer.removeEventListener('icegatheringstatechange', change); reject(new Error('Live audio ICE setup timed out')); }, 8000);
      const change = () => { if (peer.iceGatheringState === 'complete') { clearTimeout(timeout); peer.removeEventListener('icegatheringstatechange', change); resolve(); } };
      peer.addEventListener('icegatheringstatechange', change);
    });
    if (closing) throw new Error('Voice startup cancelled');
    started = true;
    const result = await transport.request('start', { sdp: peer.localDescription!.sdp });
    if (closing) { await transport.request('stop', {}).catch(() => {}); throw new Error('Voice startup cancelled'); }
    if (!result.sdp) throw new Error('No live audio answer');
    opening = result.opening || '';
    await peer.setRemoteDescription({ type: 'answer', sdp: result.sdp });
    sendGreeting();
    if (!modelStarted) startupTimer = setTimeout(() => { status('Live session did not become ready · checking for a safe reconnect'); finish({ closed: false, reconnectable: true }); void stop(); }, 30000);
    let polling = false;
    timer = setInterval(async () => {
      if (polling || closing) return; polling = true;
      try { const current = await transport.request('pulse', {}); if (current.stopped) { const reconnectable = current.status === 'closed' && current.finalized === true; status(reconnectable ? 'Agent disconnected · rejoining' : current.error || 'Voice stopped'); finish({ closed: reconnectable, reconnectable }); void stop(); } }
      catch { status('Voice connection lost. Stopping agent audio.'); void stop(); }
      finally { polling = false; }
    }, 5000);
    return { stop, setPaused, finished } satisfies LiveVoiceConnection;
  } catch (failure) { await stop(); throw failure; }
}
