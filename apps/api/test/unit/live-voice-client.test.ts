import { connectLiveVoice } from '../../../web/lib/live-voice';

describe('live voice disconnect cleanup', () => {
  const originalPeer = globalThis.RTCPeerConnection;
  let channel: any;
  let peer: any;
  let inputTrack: { enabled: boolean };
  let outputTrack: { enabled: boolean };
  let transport: { request: jest.Mock };

  beforeEach(() => {
    jest.useFakeTimers();
    inputTrack = { enabled: true }; outputTrack = { enabled: true };
    channel = {
      readyState: 'open', close: jest.fn(),
      send: jest.fn(data => { if (JSON.parse(data).type === 'session.close') Promise.resolve().then(() => channel.onmessage({ data: JSON.stringify({ type: 'session.closed' }) })); }),
    };
    peer = {
      connectionState: 'connected', iceGatheringState: 'complete', localDescription: { sdp: 'fixture-offer' },
      createDataChannel: () => channel, addTrack: jest.fn(), createOffer: jest.fn().mockResolvedValue({ sdp: 'fixture-offer' }),
      setLocalDescription: jest.fn().mockResolvedValue(undefined), setRemoteDescription: jest.fn().mockResolvedValue(undefined), close: jest.fn(),
    };
    Object.defineProperty(globalThis, 'RTCPeerConnection', { configurable: true, writable: true, value: jest.fn(() => peer) });
    transport = { request: jest.fn(async action => action === 'start' ? { sdp: 'fixture-answer' } : { stopped: false }) };
  });
  afterEach(() => { Object.defineProperty(globalThis, 'RTCPeerConnection', { configurable: true, writable: true, value: originalPeer }); jest.useRealTimers(); });

  const connect = async () => {
    const input = { getTracks: () => [inputTrack], getAudioTracks: () => [inputTrack] } as unknown as MediaStream;
    const connection = await connectLiveVoice(input, transport, jest.fn(), jest.fn());
    channel.onmessage({ data: JSON.stringify({ type: 'session.started' }) });
    peer.ontrack({ streams: [{ getTracks: () => [outputTrack] }] });
    return connection;
  };

  it('stops media and requests provider closure when disconnected for ten seconds', async () => {
    const connection = await connect();
    peer.connectionState = 'disconnected'; peer.onconnectionstatechange();
    await jest.advanceTimersByTimeAsync(9999);
    expect(inputTrack.enabled).toBe(true);
    await jest.advanceTimersByTimeAsync(1);
    expect(inputTrack.enabled).toBe(false); expect(outputTrack.enabled).toBe(false);
    expect(transport.request).toHaveBeenCalledWith('stop', {});
    expect(peer.close).toHaveBeenCalledTimes(1);
    await expect(connection.finished).resolves.toMatchObject({ reconnectable: true });
  });

  it('allows a brief connection interruption to recover without closing the session', async () => {
    const connection = await connect();
    peer.connectionState = 'disconnected'; peer.onconnectionstatechange();
    await jest.advanceTimersByTimeAsync(5000);
    peer.connectionState = 'connected'; peer.onconnectionstatechange();
    await jest.advanceTimersByTimeAsync(10000);
    expect(inputTrack.enabled).toBe(true);
    expect(transport.request).not.toHaveBeenCalledWith('stop', {});
    await connection.stop();
  });

  it('stops media after the voice heartbeat fails', async () => {
    const connection = await connect();
    transport.request.mockImplementation(async action => { if (action === 'pulse') throw new Error('API offline'); return {}; });
    await jest.advanceTimersByTimeAsync(5000);
    expect(inputTrack.enabled).toBe(false); expect(outputTrack.enabled).toBe(false);
    expect(transport.request).toHaveBeenCalledWith('stop', {});
    await connection.stop();
  });
});
