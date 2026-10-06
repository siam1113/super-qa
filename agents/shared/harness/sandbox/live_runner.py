"""No network access: relay approved requests through the parent process."""
import base64
import json
import sys

from playwright.sync_api import sync_playwright, expect


def main():
    job = json.loads(sys.stdin.readline(32001))
    assertions = []
    error = ''
    screenshot = ''

    def route_request(route):
        request = route.request
        print(json.dumps({'type': 'request', 'url': request.url, 'method': request.method,
                          'headers': request.all_headers(), 'body': base64.b64encode(request.post_data_buffer or b'').decode()}), flush=True)
        response = json.loads(sys.stdin.readline(1500001))
        if response.get('error'):
            route.abort()
        else:
            route.fulfill(status=response['status'], headers=response['headers'], body=base64.b64decode(response['body']))

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True, args=['--no-sandbox', '--disable-dev-shm-usage'])
        context = browser.new_context(service_workers='block', accept_downloads=False, viewport={'width': 960, 'height': 640})
        context.set_default_timeout(5000)
        context.route('**/*', route_request)
        context.route_web_socket('**/*', lambda websocket: websocket.close())
        page = context.new_page()
        try:
            for step in job['steps']:
                operation = step['operation']
                if operation == 'goto':
                    response = page.goto(job['origin'] + step['path'].replace('{namespace}', job['namespace']), wait_until='domcontentloaded')
                    if response is None or response.status >= 400:
                        raise ValueError('Navigation failed')
                    continue
                locator = page.locator(step['selector'])
                if operation == 'fill':
                    locator.fill(step['value'].replace('{namespace}', job['namespace']))
                elif operation == 'click':
                    locator.click()
                elif operation == 'assert':
                    try:
                        expect(locator).to_be_visible()
                        expect(locator).to_have_text(step['expected'], use_inner_text=True)
                    except AssertionError:
                        pass
                    visible = locator.count() == 1 and locator.is_visible()
                    actual = locator.inner_text() if visible else ''
                    if len(actual) > 1000:
                        raise ValueError('Observation too large')
                    assertions.append({'actual': actual, 'visible': visible})
                else:
                    raise ValueError('Unsupported operation')
            screenshot = base64.b64encode(page.screenshot(type='jpeg', quality=35, full_page=False)).decode()
        except Exception:
            error = 'execution_error'
        finally:
            context.close()
            browser.close()
    print(json.dumps({'type': 'result', 'error': error, 'assertions': assertions, 'screenshot': screenshot}), flush=True)


if __name__ == '__main__':
    main()
