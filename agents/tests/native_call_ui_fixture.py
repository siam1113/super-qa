import base64
import hashlib
import json
import os
import sys
from playwright.sync_api import sync_playwright, expect


def run():
    base = os.environ['CHAT_WEB_URL']
    real = os.environ.get('CALL_REAL_E2E') == '1'
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(args=['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'])
        context = browser.new_context(viewport={'width': 1280, 'height': 900}, permissions=['camera', 'microphone'])
        context.add_cookies([{'name': 'qa_session', 'value': os.environ['CHAT_OWNER_COOKIE'].split('=', 1)[1], 'url': base}])
        page = context.new_page()
        failures = []
        page.on('pageerror', lambda failure: failures.append(str(failure)))
        page.add_init_script('''
          window.liveEvents = [];
          const createChannel = RTCPeerConnection.prototype.createDataChannel;
          RTCPeerConnection.prototype.createDataChannel = function(...args) {
            const channel = createChannel.apply(this, args);
            channel.addEventListener('message', event => { const data = JSON.parse(event.data); window.liveEvents.push({type: data.type, delta: data.delta}); });
            const send = channel.send.bind(channel);
            channel.send = data => { const event = JSON.parse(data); if (event.type === 'session.instructions.append') window.greetingInstruction = event.content; send(data); };
            return channel;
          };
          window.callAudioContexts = [];
          const BrowserAudioContext = window.AudioContext;
          window.AudioContext = class extends BrowserAudioContext {
            constructor(...args) { super(...args); window.callAudioContexts.push(this); }
          };
          const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
          navigator.mediaDevices.getUserMedia = async constraints => {
            const stream = await original(constraints);
            if (constraints.audio) {
              const context = new AudioContext(); await context.resume();
              const oscillator = context.createOscillator();
              const gain = context.createGain(); gain.gain.value = .15;
              const destination = context.createMediaStreamDestination();
              oscillator.connect(gain).connect(destination); oscillator.start();
              stream.getAudioTracks().forEach(track => { stream.removeTrack(track); track.stop(); });
              destination.stream.getTracks().forEach(track => stream.addTrack(track));
              window.microphoneFixture = {context, oscillator, gain, destination};
            }
            return stream;
          };
        ''')
        if real:
            page.add_init_script('window.realCallTest = true; window.promptAudio = ' + json.dumps(base64.b64encode(open('/tmp/superqa-call-prompt.wav', 'rb').read()).decode()))

        def answer_live(route):
            body = route.request.post_data_json
            answer = page.evaluate('''async sdp => {
              const context = new AudioContext(); await context.resume();
              const oscillator = context.createOscillator();
              const gain = context.createGain(); gain.gain.value = 0;
              const destination = context.createMediaStreamDestination();
              oscillator.connect(gain).connect(destination); oscillator.start();
              const peer = new RTCPeerConnection(); window.liveFixturePeer = peer;
              window.liveFixtureAudio = {context, oscillator, gain};
              peer.ondatachannel = event => {
                const channel = event.channel;
                channel.onopen = () => channel.send(JSON.stringify({type: 'session.started'}));
                channel.onmessage = message => {
                  const data = JSON.parse(message.data);
                  if (data.type === 'session.instructions.append') {
                    window.greetingInstruction = data.content;
                    gain.gain.value = .2;
                    channel.send(JSON.stringify({type: 'session.instructions.appended', client_event_id: data.event_id}));
                    channel.send(JSON.stringify({type: 'session.output_transcript.delta', delta: 'Hi, owner.'}));
                  }
                  if (data.type === 'session.close') channel.send(JSON.stringify({type: 'session.closed'}));
                };
              };
              await peer.setRemoteDescription({type: 'offer', sdp});
              destination.stream.getTracks().forEach(track => peer.addTrack(track, destination.stream));
              await peer.setLocalDescription(await peer.createAnswer());
              await new Promise(resolve => {
                if (peer.iceGatheringState === 'complete') resolve();
                else peer.addEventListener('icegatheringstatechange', () => { if (peer.iceGatheringState === 'complete') resolve(); });
              });
              return peer.localDescription.sdp;
            }''', body['sdp'])
            response = context.request.post(os.environ['CHAT_API_URL'] + '/chat/' + route.request.url.split('/api/chat/', 1)[1], headers={
                'Cookie': os.environ['CHAT_OWNER_COOKIE'], 'Content-Type': 'application/json',
                'x-fixture-live-offer': hashlib.sha256(body['sdp'].encode()).hexdigest(),
                'x-fixture-live-answer': base64.b64encode(answer.encode()).decode(),
            }, data=json.dumps(body))
            route.fulfill(status=response.status, content_type='application/json', body=response.body())

        if not real:
            page.route('**/api/chat/meetings/*/voice/start', answer_live)
        page.goto(base + '/chat')
        page.get_by_role('button', name='Alex Agent conversation', exact=True).click()
        page.get_by_role('button', name='Call Alex', exact=True).click()
        expect(page.get_by_role('heading', name='Ready to join?')).to_be_visible()
        page.wait_for_function('window.microphoneFixture')
        page.wait_for_function('document.querySelector(".call-preview-video")?.readyState >= 2')
        if real:
            page.evaluate('window.microphoneFixture.gain.gain.value = 0')
        page.screenshot(path='/tmp/superqa-call-lobby-before.png')
        page.get_by_label('I agree to AI-assisted notes', exact=False).check()
        page.get_by_role('button', name='Join call', exact=True).click()
        page.wait_for_function('window.greetingInstruction?.includes("Hi, owner")')
        try:
            expect(page.locator('.call-ai-tile--speaking')).to_have_count(1, timeout=30000)
        except Exception:
            print(page.evaluate('''async () => ({
              statuses: [...document.querySelectorAll('[role="status"],[role="alert"]')].map(element => element.textContent),
              contexts: window.callAudioContexts.map(context => context.state),
              audio: [...document.querySelectorAll('audio')].map(element => ({paused: element.paused, ready: element.readyState, tracks: element.srcObject?.getTracks().map(track => ({enabled: track.enabled, state: track.readyState}))})),
              events: window.liveEvents,
            })'''), file=sys.stderr)
            raise
        if real:
            page.wait_for_function('window.liveEvents.filter(event => event.type === "session.output_transcript.delta").map(event => event.delta).join("").toLowerCase().includes("owner")', timeout=30000)
            page.evaluate('window.liveReplyOffset = window.liveEvents.filter(event => event.type === "session.output_transcript.delta").map(event => event.delta).join("").length')
            page.evaluate('''async () => {
              const {context, destination} = window.microphoneFixture;
              const audio = await context.decodeAudioData(Uint8Array.from(atob(window.promptAudio), char => char.charCodeAt(0)).buffer);
              const source = context.createBufferSource(); source.buffer = audio; source.connect(destination); source.start();
            }''')
            page.wait_for_function('window.liveEvents.filter(event => event.type === "session.input_transcript.delta").map(event => event.delta).join("").toLowerCase().includes("login")', timeout=30000)
            try:
                page.wait_for_function('/log\\s?in|credential|password|sign.in/i.test(window.liveEvents.filter(event => event.type === "session.output_transcript.delta").map(event => event.delta).join("").slice(window.liveReplyOffset))', timeout=30000)
            finally:
                evidence = page.evaluate('({events: window.liveEvents, statuses: [...document.querySelectorAll("[role=status],[role=alert]")].map(element => element.textContent)})')
                with open('/tmp/superqa-real-call.json', 'w') as report:
                    json.dump(evidence, report, indent=2)
            expect(page.locator('.call-ai-tile--speaking')).to_have_count(0, timeout=15000)
            page.evaluate('window.microphoneFixture.gain.gain.value = .15')
        expect(page.locator('.call-video-tile--speaking')).to_have_count(1, timeout=5000)
        page.get_by_role('button', name='Mute microphone', exact=True).click()
        expect(page.locator('.call-video-tile--speaking')).to_have_count(0)
        page.get_by_role('button', name='Unmute microphone', exact=True).click()
        expect(page.locator('.call-video-tile--speaking')).to_have_count(1)
        page.get_by_role('button', name='Turn camera off', exact=True).click()
        page.get_by_role('button', name='Turn camera on', exact=True).click()
        expect(page.locator('.call-video-feed')).not_to_have_class('call-video-feed call-video-feed--hidden')
        page.screenshot(path='/tmp/superqa-call-active.png')
        page.set_viewport_size({'width': 390, 'height': 844})
        page.screenshot(path='/tmp/superqa-call-mobile.png')
        assert page.locator('.call-controls').evaluate('element => { const bounds = element.getBoundingClientRect(); return [...element.querySelectorAll("button")].every(button => { const rect = button.getBoundingClientRect(); return rect.left >= bounds.left && rect.right <= bounds.right; }); }'), 'Call controls overflow'
        page.get_by_role('button', name='End meeting', exact=True).click()
        expect(page.get_by_text('You ended the call', exact=True)).to_be_visible(timeout=15000)
        page.get_by_role('button', name='Check out the meeting summary here', exact=True).click()
        expect(page.get_by_role('button', name='Approve & publish notes', exact=True)).to_be_visible(timeout=35000)
        expect(page.get_by_role('region', name='Meeting transcript')).to_contain_text('login')
        page.get_by_role('button', name='Approve & publish notes', exact=True).click()
        expect(page.get_by_role('button', name='Published to conversation', exact=True)).to_be_disabled()
        assert failures == [], failures
        browser.close()


if __name__ == '__main__':
    run()
