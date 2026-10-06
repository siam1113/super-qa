import base64
import hashlib
import json
import os
from playwright.sync_api import sync_playwright, expect


def run():
    base = os.environ['CHAT_WEB_URL']
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(args=['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required'])
        contexts = [browser.new_context(viewport={'width': 1440, 'height': 960}) for _ in range(2)]
        for context, variable in zip(contexts, ['CHAT_OWNER_COOKIE', 'CHAT_MEMBER_COOKIE']):
            context.grant_permissions(['camera', 'microphone'])
            context.add_cookies([{'name': 'qa_session', 'value': os.environ[variable].split('=', 1)[1], 'url': base}])
        page, other = [context.new_page() for context in contexts]
        failures = []
        console_errors = []
        page.on('pageerror', lambda failure: failures.append(str(failure)))
        page.on('console', lambda message: console_errors.append(message.text) if message.type == 'error' else None)
        other.on('pageerror', lambda failure: failures.append(str(failure)))

        def answer_live(route):
            body = route.request.post_data_json
            target = route.request.frame.page
            answer = target.evaluate('''async sdp => {
              const context = new AudioContext(); await context.resume();
              const oscillator = context.createOscillator(); oscillator.frequency.value = 440;
              const destination = context.createMediaStreamDestination(); oscillator.connect(destination); oscillator.start();
              const peer = new RTCPeerConnection(); window.liveFixturePeer = peer;
              window.liveFixtureAudio = {context, oscillator};
              peer.ondatachannel = event => {
                const channel = event.channel;
                channel.onopen = () => channel.send(JSON.stringify({type: 'session.started'}));
                channel.onmessage = message => {
                const command = JSON.parse(message.data);
                if (command.type === 'session.instructions.append') {
                  channel.send(JSON.stringify({type: 'session.instructions.appended', client_event_id: command.event_id}));
                  channel.send(JSON.stringify({type: 'session.output_transcript.delta', delta: 'Hi, owner.'}));
                }
                if (command.type === 'session.close') channel.send(JSON.stringify({type: 'session.closed'}));
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
            headers = {
                'Cookie': os.environ['CHAT_OWNER_COOKIE'],
                'Content-Type': 'application/json',
                'x-fixture-live-offer': hashlib.sha256(body['sdp'].encode()).hexdigest(),
                'x-fixture-live-answer': base64.b64encode(answer.encode()).decode(),
            }
            if route.request.headers.get('authorization'):
                headers['Authorization'] = route.request.headers['authorization']
            suffix = route.request.url.split('/api/', 1)[1]
            response = contexts[0].request.post(os.environ['CHAT_API_URL'] + '/' + suffix, headers=headers, data=json.dumps(body))
            route.fulfill(status=response.status, content_type='application/json', body=response.body())

        real_provider = os.environ.get('VOICE_REAL_PROVIDER') == '1'
        if not real_provider:
            page.route('**/api/chat/meetings/*/voice/start', answer_live)
        page.goto(base + '/chat')
        try:
            page.get_by_role('button', name='New conversation', exact=True).click(timeout=10000)
        except Exception as failure:
            raise AssertionError(f'Chat did not load: url={page.url}, title={page.title()}, text={page.locator("body").inner_text()[:1200]}, console={console_errors[-5:]}') from failure
        page.get_by_role('button', name='Group', exact=True).click()
        page.get_by_label('Group name', exact=True).fill('Release discussion')
        page.get_by_label('person@chat.test', exact=True).check()
        page.get_by_label('Agent (optional)', exact=True).select_option(os.environ['CHAT_AGENT_ID'])
        page.get_by_label('What should the agent do in this chat?').fill('Help plan release testing.')
        page.get_by_role('button', name='Start conversation', exact=True).click()
        other.goto(base + '/chat')
        other.get_by_role('button', name='Release discussion', exact=False).click()
        page.get_by_role('button', name='Set up a group call', exact=True).click()
        page.get_by_label('How agents participate', exact=True).select_option('active')
        expect(page.get_by_label('How agents participate', exact=True)).to_contain_text('live voice')
        page.get_by_label('I’m authorized to start this call', exact=False).check()
        page.get_by_role('button', name='Start call', exact=True).click()
        page.get_by_label('I agree to AI-assisted notes', exact=False).check()
        page.get_by_role('button', name='Join call', exact=True).click()
        expect(page.get_by_label('Alex AI participant')).to_be_visible(timeout=20000)
        if real_provider:
            try:
                expect(page.get_by_text('Speaking ·', exact=False)).to_be_visible(timeout=30000)
                page.wait_for_function('''async () => {
                  for (const element of document.querySelectorAll('audio')) {
                    const stream = element.srcObject;
                    if (!(stream instanceof MediaStream) || !stream.getAudioTracks().length || element.paused || element.muted) continue;
                    const context = new AudioContext(); await context.resume();
                    const source = context.createMediaStreamSource(stream);
                    const analyser = context.createAnalyser(); analyser.fftSize = 2048; source.connect(analyser);
                    await new Promise(resolve => setTimeout(resolve, 200));
                    const data = new Float32Array(analyser.fftSize); analyser.getFloatTimeDomainData(data);
                    const audible = data.some(value => Math.abs(value) > 0.005);
                    source.disconnect(); await context.close(); if (audible) return true;
                  }
                  return false;
                }''', timeout=30000)
            except Exception:
                raise AssertionError('Real provider did not produce both an output transcript and audible audio: ' + str(page.locator('.call-alert').all_text_contents()))
            page.get_by_role('button', name='Stop AI voice', exact=True).click()
            expect(page.get_by_text('Voice ended', exact=True)).to_be_visible(timeout=15000)
            page.get_by_role('button', name='End meeting', exact=True).click()
            expect(page.get_by_role('heading', name='You ended the call', exact=True)).to_be_visible(timeout=15000)
            browser.close()
            return
        expect(page.get_by_text('Speaking · Hi, owner.', exact=True)).to_be_visible(timeout=20000)
        page.get_by_role('button', name='Enter full screen', exact=True).click()
        page.wait_for_function('document.fullscreenElement?.getAttribute("aria-label") === "Native video call"')
        alerts = page.locator('.call-alert').all_text_contents()
        assert not alerts, f'Fullscreen displayed an error: {alerts}'
        dialog_errors = [error for error in console_errors if 'dialog' in error.lower() or 'fullscreen' in error.lower()]
        assert not dialog_errors, f'Fullscreen produced a dialog/browser error: {dialog_errors}'
        page.get_by_role('button', name='Exit full screen', exact=True).click()
        page.wait_for_function('document.fullscreenElement === null')
        other.get_by_role('button', name='Set up a group call', exact=True).click()
        other.get_by_role('button', name='Native call · Active participant', exact=False).first.click()
        other.get_by_label('I agree to AI-assisted notes', exact=False).check()
        other.get_by_role('button', name='Join call', exact=True).click()
        expect(other.get_by_label('Alex AI participant')).to_be_visible(timeout=15000)
        expect(page.get_by_label('person@chat.test video tile, connected')).to_be_visible(timeout=20000)
        other.wait_for_function('Array.from(document.querySelectorAll("audio")).some(element => element.srcObject?.getAudioTracks().length && !element.paused && !element.muted)', timeout=20000)
        other.wait_for_function('''async () => {
          for (const element of document.querySelectorAll('audio')) {
            if (!element.srcObject?.getAudioTracks().length) continue;
            const context = new AudioContext(); await context.resume();
            const source = context.createMediaStreamSource(element.srcObject);
            const analyser = context.createAnalyser(); source.connect(analyser);
            await new Promise(resolve => setTimeout(resolve, 150));
            const data = new Float32Array(analyser.fftSize); analyser.getFloatTimeDomainData(data);
            const audible = data.some(value => Math.abs(value) > 0.01);
            source.disconnect(); await context.close(); if (audible) return true;
          }
          return false;
        }''', timeout=20000)
        page.wait_for_function('''async () => {
          const stats = await window.liveFixturePeer.getStats();
          return [...stats.values()].some(item => item.type === 'inbound-rtp' && item.kind === 'audio' && item.packetsReceived > 10);
        }''')
        expect(page.get_by_role('button', name='Ask agent to participate', exact=True)).to_have_count(0)
        page.screenshot(path='/tmp/superqa-live-voice-desktop.png')
        page.set_viewport_size({'width': 390, 'height': 844})
        assert page.evaluate('document.documentElement.scrollWidth <= window.innerWidth'), 'Live voice layout overflowed'
        page.screenshot(path='/tmp/superqa-live-voice-mobile.png')
        page.get_by_role('button', name='Stop AI voice', exact=True).click()
        expect(page.get_by_text('Voice ended', exact=True)).to_be_visible(timeout=15000)
        page.get_by_role('button', name='End meeting', exact=True).click()
        expect(page.get_by_role('heading', name='You ended the call', exact=True)).to_be_visible(timeout=15000)
        expect(page.get_by_role('button', name='Check out the meeting summary here', exact=True)).to_be_visible()
        expect(other.get_by_role('heading', name='This call has ended', exact=True)).to_be_visible(timeout=15000)
        if os.environ.get('VOICE_NATIVE_ONLY') == '1':
            assert failures == [], failures
            browser.close()
            return
        bridge_context = browser.new_context(permissions=['microphone'])
        bridge = bridge_context.new_page()
        bridge.on('pageerror', lambda failure: failures.append(str(failure)))
        bridge.route('**/api/meeting-voice/*/start', answer_live)
        bridge.goto(base + '/meeting-voice' + os.environ['VOICE_BRIDGE_FRAGMENT'])
        expect(bridge.get_by_role('heading', name='Alex · AI participant', exact=True)).to_be_visible(timeout=15000)
        expect(bridge.get_by_text('Listening · live AI participant', exact=True)).to_be_visible(timeout=15000)
        assert not bridge.evaluate('location.hash'), 'Capability remained in browser address'
        bridge.wait_for_function('document.querySelector("audio").srcObject?.getAudioTracks().length === 1')
        bridge.screenshot(path='/tmp/superqa-external-live-voice.png')
        stopped = contexts[0].request.post(base + '/api/chat/meetings/' + os.environ['VOICE_EXTERNAL_MEETING'] + '/end', data={}, headers={'Origin': base})
        assert stopped.ok, stopped.text()
        expect(bridge.get_by_text('Voice ended', exact=True)).to_be_visible(timeout=15000)
        assert failures == [], failures
        browser.close()


if __name__ == '__main__':
    run()
