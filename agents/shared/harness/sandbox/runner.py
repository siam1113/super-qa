"""Fixed browser program; input is data, never Python/JavaScript source."""
import asyncio
import base64
import functools
import http.server
import json
import os
import re
import signal
import socket
import sys
import threading
from pathlib import Path
from urllib.parse import urljoin, urlsplit

class QuietServer(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


async def explore(options):
    """Bounded breadth-first observation of a static target; no form interactions."""
    from playwright.async_api import async_playwright
    if not isinstance(options, dict) or set(options) != {'start_path', 'max_pages', 'max_depth'}:
        raise ValueError('Invalid exploration options')
    if type(options['max_pages']) is not int or not 1 <= options['max_pages'] <= 20 or type(options['max_depth']) is not int or not 0 <= options['max_depth'] <= 4:
        raise ValueError('Invalid exploration budget')
    path = options['start_path']
    if not isinstance(path, str) or len(path) > 300 or not path.startswith('/') or path.startswith('//') or any(c in path for c in '\\?#') or '..' in path.split('/') or any(ord(c) < 32 for c in path):
        raise ValueError('Invalid exploration start path')
    origin = 'http://127.0.0.1:8765'
    server = http.server.ThreadingHTTPServer(('127.0.0.1', 8765), functools.partial(QuietServer, directory='/target'))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    pending = [(path, 0)]
    seen = set()
    pages = []
    output_budget_reached = False
    try:
        async with async_playwright() as playwright:
            browser = await playwright.chromium.launch(headless=True, chromium_sandbox=False)
            try:
                context = await browser.new_context(service_workers='block', accept_downloads=False)
                async def route(request):
                    url = urlsplit(request.request.url)
                    if request.request.method in ('GET', 'HEAD') and url.scheme == 'http' and url.hostname == '127.0.0.1' and url.port == 8765:
                        await request.continue_()
                    else:
                        await request.abort()
                await context.route('**/*', route)
                await context.route_web_socket('**/*', lambda websocket: websocket.close())
                page = await context.new_page()
                page_errors = []
                page.on('pageerror', lambda error: page_errors.append('page_error'))
                page.set_default_timeout(2000)
                while pending and len(pages) < options['max_pages']:
                    path, depth = pending.pop(0)
                    if path in seen:
                        continue
                    seen.add(path)
                    page_errors.clear()
                    observation = {'path': path, 'depth': depth, 'http_status': None, 'error': ''}
                    try:
                        response = await page.goto(origin + path, wait_until='load', timeout=5000)
                        observed_url = urlsplit(page.url)
                        if observed_url.scheme != 'http' or observed_url.netloc != '127.0.0.1:8765':
                            raise ValueError('Navigation left the target origin')
                        observation['http_status'] = response.status if response else None
                        snapshot = await page.evaluate("""() => ({
                            title: document.title.slice(0, 200),
                            headings: [...document.querySelectorAll('h1,h2,h3')].slice(0, 15).map(e => (e.textContent || '').trim().slice(0, 150)),
                            links: [...document.querySelectorAll('a[href]')].slice(0, 40).map(e => ({href: e.getAttribute('href').slice(0, 300), text: (e.textContent || '').trim().slice(0, 100)})),
                            controls: [...document.querySelectorAll('input,button,select,textarea')].slice(0, 30).map(e => ({tag: e.tagName.toLowerCase(), type: e.getAttribute('type'), id: e.id.slice(0, 100), test_id: (e.getAttribute('data-testid') || '').slice(0, 100), label: (e.getAttribute('aria-label') || e.getAttribute('name') || '').slice(0, 100)}))
                        })""")
                        observation.update(snapshot)
                        observation['page_errors'] = len(page_errors)
                        observation['observed_url'] = page.url[:500]
                        if depth < options['max_depth']:
                            for link in snapshot['links']:
                                parsed = urlsplit(urljoin(page.url, link['href']))
                                next_path = parsed.path or '/'
                                if parsed.scheme == 'http' and parsed.netloc == '127.0.0.1:8765' and not parsed.query and next_path not in seen and (next_path, depth + 1) not in pending and len(pending) < 100:
                                    pending.append((next_path, depth + 1))
                    except Exception:
                        observation['error'] = 'navigation_or_observation_error'
                    if len(json.dumps(pages + [observation]).encode()) > 70000:
                        output_budget_reached = True
                        break
                    pages.append(observation)
            finally:
                await browser.close()
    finally:
        server.shutdown()
        server.server_close()
    return {'error': '', 'pages': pages, 'pages_visited': len(pages), 'pending_paths': len(pending),
            'page_budget_reached': len(pages) >= options['max_pages'] and bool(pending),
            'output_budget_reached': output_budget_reached, 'max_depth': options['max_depth']}


async def execute(plan):
    from playwright.async_api import async_playwright
    selector = re.compile(r'^(#[a-zA-Z][a-zA-Z0-9_-]*|\[data-testid="[a-zA-Z0-9_-]+"\])$')
    steps = plan.get('steps')
    if not isinstance(steps, list) or not 1 <= len(steps) <= 20:
        raise ValueError('Invalid step count')
    for index, step in enumerate(steps):
        assertion = step['assertion']
        if step['caseStep'] != index + 1 or step['operation'] not in {'click', 'fill', 'check'} or assertion['kind'] != 'text_equals':
            raise ValueError('Unsupported instruction')
        if not selector.fullmatch(step['selector']) or not selector.fullmatch(assertion['selector']) or not 1 <= len(assertion['expected']) <= 1000:
            raise ValueError('Unsupported selector/oracle')
        if step['operation'] == 'fill' and (not isinstance(step.get('value'), str) or len(step['value']) > 1000):
            raise ValueError('Invalid fill value')
    server = http.server.ThreadingHTTPServer(('127.0.0.1', 8765), functools.partial(QuietServer, directory='/target'))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    observations = []
    screenshot = ''
    errors = []
    async with async_playwright() as playwright:
        browser = await playwright.chromium.launch(headless=True, chromium_sandbox=False)
        context = await browser.new_context(viewport={'width': 640, 'height': 480}, service_workers='block', accept_downloads=False)
        async def route(request):
            url = urlsplit(request.request.url)
            if url.scheme == 'http' and url.hostname == '127.0.0.1' and url.port == 8765:
                await request.continue_()
            else:
                await request.abort()
        await context.route('**/*', route)
        page = await context.new_page()
        page.set_default_timeout(3000)
        page.on('pageerror', lambda error: errors.append('page_error'))
        try:
            await page.goto('http://127.0.0.1:8765/index.html', wait_until='load', timeout=10000)
            for step in steps:
                observation = {'caseStep': step['caseStep'], 'actionCompleted': False, 'actual': '', 'error': ''}
                try:
                    locator = page.locator(step['selector'])
                    if step['operation'] == 'click':
                        await locator.click()
                    elif step['operation'] == 'fill':
                        await locator.fill(step['value'])
                    elif step['operation'] == 'check':
                        await locator.check()
                    observation['actionCompleted'] = True
                except Exception:
                    observation['error'] = 'action_error'
                if observation['actionCompleted']:
                    try:
                        oracle = page.locator(step['assertion']['selector'])
                        await oracle.wait_for(state='visible')
                        end = asyncio.get_running_loop().time() + 2
                        while True:
                            actual = await oracle.inner_text()
                            if len(actual) > 1000:
                                observation['error'] = 'output_limit'
                                break
                            observation['actual'] = actual
                            if actual == step['assertion']['expected'] or asyncio.get_running_loop().time() >= end:
                                break
                            await asyncio.sleep(0.1)
                    except Exception:
                        observation['error'] = 'assertion_missing'
                if errors:
                    observation['error'] = 'page_error'
                observations.append(observation)
                if observation['error'] or observation['actual'] != step['assertion']['expected']:
                    break
            image = await page.screenshot(type='jpeg', quality=25, timeout=3000)
            if len(image) <= 48000:
                screenshot = base64.b64encode(image).decode()
        finally:
            await browser.close()
            server.shutdown()
    return {'error': '', 'observations': observations, 'screenshot': screenshot}


def validate_isolation():
    if os.geteuid() == 0:
        raise ValueError('Non-root container required')
    for _, name in socket.if_nameindex():
        flags = int((Path('/sys/class/net') / name / 'flags').read_text().strip(), 16)
        if name != 'lo' and flags & 1:
            raise ValueError('Active external network interface is forbidden')


def main():
    signal.alarm(65)
    try:
        validate_isolation()
        raw = sys.stdin.buffer.read(64001)
        if len(raw) > 64000:
            raise ValueError('Input limit')
        plan = json.loads(raw)
        operation = explore(plan['explore']) if 'explore' in plan else execute(plan)
        result = asyncio.run(asyncio.wait_for(operation, timeout=60))
    except asyncio.TimeoutError:
        result = {'error': 'timeout', 'observations': [], 'screenshot': ''}
    except Exception:
        result = {'error': 'infrastructure_error', 'observations': [], 'screenshot': ''}
    result['runnerVersion'] = 'offline-chromium-v1/playwright-1.60.0'
    print(json.dumps(result))


if __name__ == '__main__':
    main()
