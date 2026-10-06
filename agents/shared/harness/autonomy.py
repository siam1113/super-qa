"""Project-scoped API/live workflow worker and fail-closed CI client."""
import argparse
import http.client
import ipaddress
import json
import os
from pathlib import Path
import socket
import ssl
import subprocess
import sys
import tempfile
import time
from urllib.parse import urlsplit
from uuid import UUID, uuid4
import xml.etree.ElementTree as ET

import httpx


def json_scalar(document, pointer):
    value = document
    if pointer:
        if not pointer.startswith('/'):
            raise ValueError('Invalid pointer')
        for part in pointer[1:].split('/'):
            part = part.replace('~1', '/').replace('~0', '~')
            if isinstance(value, list):
                if not part.isdigit() or (len(part) > 1 and part.startswith('0')):
                    raise ValueError('Invalid array pointer')
                value = value[int(part)]
            elif isinstance(value, dict):
                value = value[part]
            else:
                raise ValueError('Non-container pointer')
    if value is None or type(value) is bool or (type(value) is int and abs(value) <= 9007199254740991) or (isinstance(value, str) and len(value) <= 1000):
        return value
    raise ValueError('Oracle must resolve to a bounded scalar')


class PinnedHTTPS(http.client.HTTPSConnection):
    def __init__(self, hostname, port, address, context=None):
        super().__init__(hostname, port, timeout=5, context=context or ssl.create_default_context(cafile=os.getenv('AUTONOMY_CA_FILE') or None))
        self.address = address

    def connect(self):
        connection = socket.create_connection((self.address, self.port), timeout=self.timeout)
        try:
            self.sock = self._context.wrap_socket(connection, server_hostname=self.host)
        except BaseException:
            connection.close()
            raise


def probe(check, allowed_origins, secret_refs=None, allowed_cidrs=(), context=None):
    observation = {'checkId': check['id'], 'status': 0, 'error': 'policy_error'}
    connection = None
    try:
        origin = check['origin']
        url = urlsplit(origin)
        path = check['path']
        if origin not in allowed_origins or url.scheme != 'https' or url.username or url.password or url.path or url.query or url.fragment or not path.startswith('/') or path.startswith('//') or any(character in path for character in '\\?#\r\n\t '):
            return observation
        addresses = {entry[4][0] for entry in socket.getaddrinfo(url.hostname, url.port or 443, type=socket.SOCK_STREAM)}
        networks = [ipaddress.ip_network(value) for value in allowed_cidrs]
        if not addresses or any(ipaddress.ip_address(address).is_multicast or ipaddress.ip_address(address).is_unspecified or (not ipaddress.ip_address(address).is_global and not any(ipaddress.ip_address(address) in network for network in networks)) for address in addresses):
            return observation
        headers = {'Accept': 'application/json', 'Accept-Encoding': 'identity'}
        reference = (secret_refs or {}).get(origin)
        if reference:
            secret = os.environ.get(reference)
            if not secret or '\r' in secret or '\n' in secret:
                return observation
            headers['Authorization'] = 'Bearer ' + secret
        connection = PinnedHTTPS(url.hostname, url.port or 443, sorted(addresses)[0], context)
        observation['error'] = 'network_error'
        connection.request('GET', path, headers=headers)
        response = connection.getresponse()
        observation['status'] = response.status
        if 300 <= response.status < 400:
            observation['error'] = 'policy_error'
            return observation
        if response.getheader('Content-Encoding', 'identity') != 'identity':
            observation['error'] = 'response_limit'
            return observation
        body = response.read(65537)
        if len(body) > 65536:
            observation['error'] = 'response_limit'
            return observation
        observation['error'] = 'invalid_json'
        document = json.loads(body)
        observation['actual'] = json_scalar(document, check['pointer'])
        observation['error'] = ''
    except (TimeoutError, socket.timeout):
        observation['error'] = 'timeout'
    except (OSError, http.client.HTTPException):
        observation['error'] = 'network_error'
    except (ValueError, KeyError, IndexError, TypeError, RecursionError, OverflowError):
        pass
    finally:
        if connection:
            connection.close()
    return observation


def isolated_probe(check):
    try:
        result = subprocess.run([sys.executable, '-m', 'shared.harness.autonomy', 'probe'], input=json.dumps(check), capture_output=True, text=True, timeout=15, check=True)
        return json.loads(result.stdout)
    except (subprocess.SubprocessError, ValueError):
        return {'checkId': check['id'], 'status': 0, 'error': 'timeout'}


class AutonomyClient:
    def __init__(self, client, key):
        if not key.startswith('sq_') or len(key) != 67:
            raise ValueError('AUTONOMY_PROJECT_KEY required')
        self.client = client
        self.headers = {'Authorization': 'Bearer ' + key}

    def request(self, method, path, body=None):
        response = self.client.request(method, 'autonomy' + path, headers=self.headers, json=body)
        response.raise_for_status()
        return response.json() if response.content else None

    def run_once(self, adapter=isolated_probe):
        from shared.harness.repository import recover
        from shared.harness.api_flow import recover as recover_api
        if not recover(self) or not recover_api(self):
            return False
        job = self.request('POST', '/claim', {})
        if not job:
            return False
        observations = []
        live_observations = []
        repository_observations = []
        api_flow_observations = []
        for check in job['snapshot']['checks']:
            if self.request('GET', '/runs/' + job['id'])['status'] != 'running':
                return True
            if check['kind'] == 'api':
                observations.append(adapter(check))
            elif check['kind'] == 'api_flow':
                from shared.harness.api_flow import execute
                api_flow_observations.append(execute(check, job, lambda: self.request('GET', '/runs/' + job['id']).get('executionAllowed') is True, self))
                if self.request('GET', '/runs/' + job['id'])['status'] != 'running':
                    return True
            elif check['kind'] == 'repository':
                from shared.harness.repository import execute
                repository_observations.append(execute(check, job, lambda: self.request('GET', '/runs/' + job['id']).get('executionAllowed') is True, self))
                if self.request('GET', '/runs/' + job['id'])['status'] != 'running':
                    return True
            elif check['kind'] == 'live':
                from shared.harness.live import execute
                live_observations.append(execute(check, job, lambda: self.request('GET', '/runs/' + job['id'])['status'] == 'running'))
            else:
                while True:
                    execution = self.request('POST', '/runs/' + job['id'] + '/browser/' + check['id'], {'token': job['token']})
                    if execution['status'] not in ('queued', 'running'):
                        break
                    time.sleep(1)
        report = {'token': job['token'], 'observations': observations}
        if api_flow_observations:
            report['apiFlowObservations'] = api_flow_observations
        if repository_observations:
            report['repositoryObservations'] = repository_observations
        if live_observations:
            report['liveObservations'] = live_observations
        for attempt in range(3):
            try:
                self.request('POST', '/runs/' + job['id'] + '/complete', report)
                return True
            except (httpx.TransportError, httpx.HTTPStatusError) as error:
                if isinstance(error, httpx.HTTPStatusError) and error.response.status_code < 500:
                    raise
                if attempt == 2:
                    raise
                time.sleep(1)
        return True


def write_junit(run, path):
    results = run.get('results') or [{'checkId': 'run', 'status': run['status']}]
    suite = ET.Element('testsuite', name='Super QA', tests=str(len(results)), failures=str(sum(item['status'] == 'failed' for item in results)), errors=str(sum(item['status'] not in ('passed', 'failed') or bool(item.get('flaky')) for item in results)))
    for result in results:
        case = ET.SubElement(suite, 'testcase', name=result['checkId'])
        if result['status'] == 'failed':
            ET.SubElement(case, 'failure', message='Approved assertion mismatch')
        elif result['status'] != 'passed' or result.get('flaky'):
            ET.SubElement(case, 'error', message='Unverified or flaky: ' + result['status'])
    ET.ElementTree(suite).write(path, encoding='utf-8', xml_declaration=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest='command', required=True)
    commands.add_parser('probe')
    worker = commands.add_parser('worker')
    worker.add_argument('--once', action='store_true')
    ci = commands.add_parser('ci')
    ci.add_argument('suite_id', type=UUID)
    ci.add_argument('--request-id', type=UUID, default=None)
    ci.add_argument('--output', type=Path, default=Path('superqa-junit.xml'))
    ci.add_argument('--timeout', type=int, default=330)
    commands.add_parser('overview')
    collection = commands.add_parser('collect')
    collection.add_argument('benchmark_id', type=UUID)
    collection.add_argument('--output', type=Path, default=Path('benchmark-evidence.json'))
    collection.add_argument('--timeout', type=int, default=3600)
    args = parser.parse_args()
    if args.command == 'probe':
        check = json.loads(sys.stdin.read(32001))
        result = probe(check, json.loads(os.getenv('AUTONOMY_ALLOWED_ORIGINS', '[]')), json.loads(os.getenv('AUTONOMY_SECRET_REFS', '{}')), json.loads(os.getenv('AUTONOMY_ALLOWED_CIDRS', '[]')))
        print(json.dumps(result))
        return 0
    base = os.getenv('BACKEND_API_URL', 'http://localhost:4000/api').rstrip('/') + '/'
    endpoint = urlsplit(base)
    if endpoint.scheme != 'https' and not (endpoint.scheme == 'http' and endpoint.hostname in ('localhost', '127.0.0.1', '::1')):
        parser.error('Control-plane credentials require HTTPS except on loopback')
    with httpx.Client(base_url=base, timeout=20, follow_redirects=False, trust_env=False) as client:
        api = AutonomyClient(client, os.getenv('AUTONOMY_PROJECT_KEY', ''))
        if args.command == 'overview':
            print(json.dumps(api.request('GET', ''), indent=2))
            return 0
        if args.command == 'collect':
            benchmark_path = '/benchmarks/' + str(args.benchmark_id)
            benchmark = api.request('POST', benchmark_path + '/resume', {})
            deadline = time.monotonic() + max(1, min(args.timeout, 86400))
            while True:
                if benchmark['status'] != 'completed' and not benchmark['paused']:
                    benchmark = api.request('POST', benchmark_path + '/advance', {})
                with tempfile.NamedTemporaryFile(mode='w', dir=args.output.parent, prefix=args.output.name + '.', delete=False) as output:
                    json.dump(benchmark, output, indent=2)
                    output.flush()
                    os.fsync(output.fileno())
                Path(output.name).replace(args.output)
                if benchmark['status'] == 'completed' or benchmark['paused'] or time.monotonic() >= deadline:
                    return 0 if benchmark['status'] == 'completed' and benchmark['report']['rolloutGatePassed'] else 1
                time.sleep(2)
        if args.command == 'worker':
            while True:
                try:
                    worked = api.run_once()
                except (httpx.HTTPError, ValueError):
                    if args.once:
                        return 1
                    worked = False
                if args.once:
                    return 0
                if not worked:
                    time.sleep(2)
        run = api.request('POST', '/runs', {'suiteId': str(args.suite_id), 'requestId': str(args.request_id or uuid4())})
        deadline = time.monotonic() + max(1, min(args.timeout, 600))
        while run['status'] in ('queued', 'running') and time.monotonic() < deadline:
            time.sleep(1)
            run = api.request('GET', '/runs/' + run['id'])
        write_junit(run, args.output)
        print(json.dumps({'runId': run['id'], 'status': run['status'], 'junit': str(args.output)}))
        return 0 if run['status'] == 'passed' else 1


if __name__ == '__main__':
    try:
        raise SystemExit(main())
    except (httpx.HTTPError, ValueError):
        print('Super QA control-plane request failed; no passing verdict.', file=sys.stderr)
        raise SystemExit(1)
