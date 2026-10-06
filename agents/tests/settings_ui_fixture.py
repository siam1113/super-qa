"""Real Chromium → Next gateway → scoped API → real HTTPS worker fixture."""
import json
import os
from pathlib import Path
import sys
import threading

import httpx
from playwright.sync_api import sync_playwright, expect

from shared.harness.autonomy import AutonomyClient


base = os.environ['BACKEND_API_URL'].rstrip('/') + '/'
stop = threading.Event()
errors = []


def work():
    try:
        with httpx.Client(base_url=base, timeout=20, trust_env=False) as client:
            api = AutonomyClient(client, os.environ['AUTONOMY_PROJECT_KEY'])
            while not stop.is_set():
                if not api.run_once():
                    stop.wait(0.1)
    except Exception as error:
        errors.append(type(error).__name__)


worker = threading.Thread(target=work)
corpus = Path(sys.argv[1]).read_text()
try:
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        context = browser.new_context(viewport={'width': 1440, 'height': 1100}, accept_downloads=True)
        page = context.new_page()
        page.set_default_timeout(15000)
        legacy = []
        page.on('request', lambda request: legacy.append(request.url) if '/api/qa/' in request.url else None)
        page.goto(os.environ['SETTINGS_WEB_URL'] + '/settings')
        expect(page.get_by_role('heading', name='Connect a project')).to_be_visible()
        page.get_by_label('Project credential', exact=True).fill('sq_' + '0' * 64)
        page.get_by_role('button', name='Connect project', exact=True).click()
        expect(page.get_by_role('alert').filter(has_text='Credential expired')).to_be_visible()
        page.get_by_label('Project credential', exact=True).fill(os.environ['SETTINGS_OWNER_KEY'])
        page.get_by_role('button', name='Connect project', exact=True).click()
        expect(page.get_by_role('heading', name='Project policy')).to_be_visible()
        page.get_by_label('Project name', exact=True).fill('Browser-reviewed project')
        page.get_by_role('button', name='Save project settings').click()
        expect(page.get_by_role('status')).to_contain_text('Project settings saved')
        page.get_by_role('button', name='Access', exact=True).click()
        page.get_by_label('Key label', exact=True).fill('browser-issued member')
        page.get_by_role('button', name='Issue credential', exact=True).click()
        expect(page.get_by_label('New credential', exact=True)).to_be_visible()
        issued = page.get_by_label('New credential', exact=True).input_value()
        assert issued.startswith('sq_') and len(issued) == 67
        storage = page.evaluate('JSON.stringify({local: {...localStorage}, session: {...sessionStorage}})')
        assert issued not in storage and os.environ['SETTINGS_OWNER_KEY'] not in storage
        page.get_by_role('button', name='Dismiss secret').click()
        page.get_by_role('button', name='Revoke browser-issued member', exact=True).click()
        expect(page.get_by_role('row').filter(has_text='browser-issued member')).to_contain_text('Revoked')
        with httpx.Client(base_url=base, trust_env=False) as client:
            assert client.get('autonomy/settings', headers={'Authorization': 'Bearer ' + issued}).status_code == 401
        page.get_by_role('button', name='Workflows', exact=True).click()
        for sample in json.loads(corpus)['samples']:
            detail = page.locator('details').filter(has_text=sample['suiteId'])
            detail.locator('summary').click()
            page.get_by_label('I reviewed the selected suite’s assertions, scope and test data.').check()
            detail.get_by_role('button', name='Approve reviewed suite').click()
            expect(detail.locator('summary')).to_contain_text('Approved')
        page.get_by_role('button', name='Benchmarks', exact=True).click()
        page.get_by_label('Reviewed corpus JSON', exact=True).fill(corpus)
        page.get_by_role('button', name='Create draft benchmark').click()
        expect(page.get_by_test_id('benchmark-status')).to_contain_text('draft')
        expect(page.get_by_role('button', name='Approve benchmark', exact=True)).to_be_disabled()
        page.get_by_label('I reviewed labels, evidence sources, revisions and suite bindings.').check()
        page.get_by_role('button', name='Approve benchmark', exact=True).click()
        page.get_by_role('button', name='Resume collection', exact=True).click()
        expect(page.get_by_role('cell', name='queued', exact=True)).to_be_visible()
        page.get_by_role('button', name='Pause collection', exact=True).click()
        expect(page.get_by_test_id('benchmark-status')).to_contain_text('paused')
        benchmark_id = page.get_by_label('Saved benchmarks', exact=True).input_value()
        page.reload()
        expect(page.get_by_role('heading', name='Connect a project')).to_be_visible()
        expect(page.get_by_label('Project credential', exact=True)).to_have_value('')
        page.get_by_label('Project credential', exact=True).fill(os.environ['SETTINGS_OWNER_KEY'])
        page.get_by_role('button', name='Connect project', exact=True).click()
        page.get_by_role('button', name='Benchmarks', exact=True).click()
        page.get_by_label('Saved benchmarks', exact=True).select_option(benchmark_id)
        expect(page.get_by_test_id('benchmark-status')).to_contain_text('paused')
        worker.start()
        page.get_by_role('button', name='Resume collection', exact=True).click()
        expect(page.get_by_test_id('benchmark-status')).to_contain_text('completed · 2/2', timeout=60000)
        expect(page.get_by_test_id('benchmark-gate')).to_contain_text('Real-project rollout is not established')
        with page.expect_download() as downloaded:
            page.get_by_role('button', name='Export evidence', exact=True).click()
        exported = Path(sys.argv[2])
        downloaded.value.save_as(exported)
        report = json.loads(exported.read_text())
        assert report['report']['gatePassed'] and not report['report']['rolloutGatePassed']
        assert len({trial['run']['id'] for trial in report['trials']}) == 2
        assert os.environ['SETTINGS_OWNER_KEY'] not in exported.read_text()
        assert all('token' not in trial['run'] for trial in report['trials'])
        if os.getenv('SETTINGS_SCREENSHOT'):
            page.screenshot(path=os.environ['SETTINGS_SCREENSHOT'], full_page=True)
        page.get_by_role('button', name='Disconnect', exact=True).click()
        expect(page.get_by_role('heading', name='Connect a project')).to_be_visible()
        page.get_by_label('Project credential', exact=True).fill(os.environ['SETTINGS_MEMBER_KEY'])
        page.get_by_role('button', name='Connect project', exact=True).click()
        expect(page.get_by_label('Project name', exact=True)).to_have_value('Browser-reviewed project')
        expect(page.get_by_role('button', name='Save project settings')).to_be_disabled()
        page.get_by_role('button', name='Access', exact=True).click()
        expect(page.get_by_text('Your member role does not expose the credential inventory.')).to_be_visible()
        page.get_by_role('button', name='Benchmarks', exact=True).click()
        expect(page.get_by_label('Reviewed corpus JSON', exact=True)).to_have_count(0)
        page.get_by_label('Saved benchmarks', exact=True).select_option(benchmark_id)
        expect(page.get_by_test_id('benchmark-status')).to_contain_text('completed · 2/2')
        with httpx.Client(base_url=base, trust_env=False) as client:
            administrator = AutonomyClient(client, os.environ['SETTINGS_OWNER_KEY'])
            credentials = administrator.request('GET', '/settings')['credentials']
            member = next(item for item in credentials if item['label'] == 'UI fixture member')
            administrator.request('POST', '/keys/' + member['id'] + '/revoke', {})
        page.get_by_role('button', name='Refresh settings', exact=True).click()
        expect(page.get_by_role('heading', name='Connect a project')).to_be_visible()
        expect(page.get_by_role('alert').filter(has_text='Credential expired')).to_be_visible()
        assert not legacy, 'Settings must not request legacy workspace data'
        context.close()
        browser.close()
finally:
    stop.set()
    if worker.ident is not None:
        worker.join(timeout=30)
if errors or worker.is_alive():
    raise SystemExit(1)
print(json.dumps({'browser': 'passed', 'benchmarkId': benchmark_id, 'trials': 2, 'rolloutGatePassed': False}))
