"""Approved live workflows with a network-isolated browser and durable cleanup."""
import argparse
import base64
import fcntl
import hashlib
import http.client
import ipaddress
import json
import os
from pathlib import Path
import re
import selectors
import socket
import sqlite3
import subprocess
import sys
import time
from urllib.parse import urlsplit
from uuid import UUID, uuid4

from shared.harness.autonomy import PinnedHTTPS


def safe_path(path):
    return isinstance(path, str) and len(path) <= 2000 and bool(re.fullmatch(r'/(?!/)[A-Za-z0-9_./{}-]*', path)) and '..' not in path and '{' not in path.replace('{namespace}', '') and '}' not in path.replace('{namespace}', '')


def load_profile(path):
    raw = Path(path).read_bytes()
    if len(raw) > 32000:
        raise ValueError('Profile too large')
    profile = json.loads(raw)
    if set(profile) != {'origin', 'environment', 'revision', 'leasePath', 'routes', 'steps'} or profile['environment'] not in ('test', 'staging') or not isinstance(profile['revision'], str) or not profile['revision']:
        raise ValueError('Explicit test/staging revision required')
    origin = urlsplit(profile['origin'])
    if origin.scheme != 'https' or not origin.hostname or origin.username or origin.password or origin.path or origin.query or origin.fragment:
        raise ValueError('HTTPS origin required')
    if not safe_path(profile['leasePath']) or profile['leasePath'].count('{namespace}') != 1:
        raise ValueError('Namespaced lease endpoint required')
    if not isinstance(profile['routes'], list) or not 1 <= len(profile['routes']) <= 50:
        raise ValueError('Bounded exact request rules required')
    for route in profile['routes']:
        if set(route) != {'method', 'path'} or route['method'] not in ('GET', 'POST', 'PUT', 'PATCH', 'DELETE') or not safe_path(route['path']):
            raise ValueError('Invalid route')
        if route['method'] != 'GET' and '{namespace}' not in route['path']:
            raise ValueError('Browser mutations must be namespaced')
        if route['path'] == profile['leasePath']:
            raise ValueError('Browser must not manage data leases')
    if not isinstance(profile['steps'], list) or not 1 <= len(profile['steps']) <= 20:
        raise ValueError('Bounded steps required')
    assertions = []
    for step in profile['steps']:
        operation = step.get('operation')
        fields = {'goto': {'operation', 'path'}, 'click': {'operation', 'selector'}, 'fill': {'operation', 'selector', 'value'}, 'assert': {'operation', 'selector', 'expected'}}
        if operation not in fields or set(step) != fields[operation] or any(not isinstance(value, str) or len(value) > 1000 for value in step.values()):
            raise ValueError('Invalid declarative step')
        if operation == 'goto' and (not safe_path(step['path']) or {'method': 'GET', 'path': step['path']} not in profile['routes']):
            raise ValueError('Navigation requires an exact read rule')
        if operation == 'assert':
            if not step['expected'] or '{namespace}' in step['expected']:
                raise ValueError('Literal, nonempty oracles required')
            assertions.append(step['expected'])
    if not assertions:
        raise ValueError('At least one assertion required')
    return profile, hashlib.sha256(raw).hexdigest(), assertions


class Transport:
    def __init__(self, origin, credential_mode="configured"):
        if origin not in json.loads(os.getenv('AUTONOMY_ALLOWED_ORIGINS', '[]')):
            raise ValueError('Origin not allowed')
        if credential_mode not in ("configured", "anonymous"):
            raise ValueError("Invalid credential mode")
        self.credential_mode = credential_mode
        self.origin = origin

    def request(self, method, path, body=b'', headers=None):
        try:
            payload = {'origin': self.origin, 'credentialMode': self.credential_mode, 'method': method, 'path': path, 'body': base64.b64encode(body).decode(), 'headers': headers or {}}
            completed = subprocess.run([sys.executable, '-m', 'shared.harness.live', 'request'], input=json.dumps(payload), text=True, capture_output=True, timeout=15, check=True)
            return json.loads(completed.stdout)
        except (subprocess.SubprocessError, ValueError):
            raise ValueError('Transport failed without replay') from None

    def pinned_request(self, method, path, body=b'', headers=None):
        if not safe_path(path) or '{' in path or len(body) > 65536:
            raise ValueError('Request policy rejected')
        endpoint = urlsplit(self.origin)
        addresses = {entry[4][0] for entry in socket.getaddrinfo(endpoint.hostname, endpoint.port or 443, type=socket.SOCK_STREAM)}
        networks = [ipaddress.ip_network(value) for value in json.loads(os.getenv('AUTONOMY_ALLOWED_CIDRS', '[]'))]
        if not addresses or any(ipaddress.ip_address(address).is_multicast or ipaddress.ip_address(address).is_unspecified or (not ipaddress.ip_address(address).is_global and not any(ipaddress.ip_address(address) in network for network in networks)) for address in addresses):
            raise ValueError('Destination not allowed')
        forwarded = {key.lower(): value for key, value in (headers or {}).items() if key.lower() in ('content-type', 'cookie', 'origin', 'referer', 'x-csrf-token') and isinstance(value, str) and len(value) <= 8192 and '\r' not in value and '\n' not in value}
        forwarded['accept-encoding'] = 'identity'
        reference = json.loads(os.getenv('AUTONOMY_SECRET_REFS', '{}')).get(self.origin)
        if self.credential_mode == 'anonymous':
            forwarded.pop('cookie', None)
            forwarded.pop('x-csrf-token', None)
        if reference and self.credential_mode == 'configured':
            secret = os.environ.get(reference)
            if not secret or '\r' in secret or '\n' in secret:
                raise ValueError('Missing origin credential')
            forwarded['authorization'] = 'Bearer ' + secret
        connection = PinnedHTTPS(endpoint.hostname, endpoint.port or 443, sorted(addresses)[0])
        try:
            connection.request(method, path, body=body, headers=forwarded)
            response = connection.getresponse()
            content = response.read(1048577)
            if len(content) > 1048576 or response.getheader('Content-Encoding', 'identity') != 'identity' or 300 <= response.status < 400:
                raise ValueError('Response size, encoding or redirect rejected')
            response_headers = {key.lower(): value for key, value in response.getheaders() if key.lower() in ('content-type', 'set-cookie', 'content-security-policy', 'x-content-type-options', 'access-control-allow-origin', 'access-control-allow-credentials')}
            return {'status': response.status, 'headers': response_headers, 'body': base64.b64encode(content).decode()}
        finally:
            connection.close()


class Journal:
    def __init__(self, directory):
        self.directory = Path(directory)
        self.directory.mkdir(mode=0o700, parents=True, exist_ok=True)
        self.lock = os.open(self.directory / 'worker.lock', os.O_RDWR | os.O_CREAT, 0o600)
        try:
            fcntl.flock(self.lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError:
            os.close(self.lock)
            raise ValueError('Another live worker/recovery owns this state directory') from None
        try:
            self.database = sqlite3.connect(self.directory / 'leases.sqlite', timeout=10)
            os.chmod(self.directory / 'leases.sqlite', 0o600)
            self.database.execute('PRAGMA synchronous=FULL')
            self.database.execute('CREATE TABLE IF NOT EXISTS leases (namespace TEXT PRIMARY KEY, profile_hash TEXT NOT NULL, state TEXT NOT NULL)')
            self.database.commit()
        except BaseException:
            if hasattr(self, 'database'):
                self.database.close()
            os.close(self.lock)
            raise

    def prepare(self, namespace, profile_hash):
        with self.database:
            self.database.execute('INSERT INTO leases VALUES (?, ?, ?)', (namespace, profile_hash, 'pending'))

    def cleaned(self, namespace):
        with self.database:
            self.database.execute('UPDATE leases SET state = ? WHERE namespace = ?', ('clean', namespace))

    def pending(self):
        return self.database.execute('SELECT namespace, profile_hash FROM leases WHERE state = ?', ('pending',)).fetchall()

    def close(self):
        self.database.close()
        os.close(self.lock)


def cleanup(profile, namespace, transport, journal):
    path = profile['leasePath'].replace('{namespace}', namespace)
    try:
        if transport.request('DELETE', path)['status'] not in (200, 204, 404):
            return False
        if transport.request('GET', path)['status'] != 404:
            return False
        journal.cleaned(namespace)
        return True
    except (OSError, ValueError, http.client.HTTPException):
        return False


def browser_command(name, image):
    if not re.fullmatch(r'sha256:[a-f0-9]{64}', image):
        raise ValueError('Immutable live browser image ID required')
    return ['docker', 'run', '--pull=never', '--rm', '--init', '--name', name,
            '--network', 'none', '--read-only', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges',
            '--user', '1000:1000', '--pids-limit', '128', '--memory', '768m', '--memory-swap', '768m',
            '--cpus', '1', '--shm-size', '128m', '--tmpfs', '/tmp:rw,nosuid,nodev,noexec,size=192m,mode=1777',
            '--entrypoint', 'python3', '-i', image, '-I', '/opt/qa/live_runner.py']


def pipe_write(stream, payload):
    descriptor = stream.fileno()
    os.set_blocking(descriptor, False)
    deadline = time.monotonic() + 10
    offset = 0
    with selectors.DefaultSelector() as poller:
        poller.register(descriptor, selectors.EVENT_WRITE)
        while offset < len(payload):
            if time.monotonic() >= deadline:
                raise TimeoutError('Browser bridge write deadline')
            if poller.select(timeout=0.1):
                try:
                    offset += os.write(descriptor, payload[offset:])
                except BlockingIOError:
                    pass


def remove_browser(process, name):
    try:
        removed = subprocess.run(['docker', 'rm', '-f', name], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=15, check=False)
        if removed.returncode and process.wait(timeout=5) != 0:
            raise ValueError('Container removal uncertain')
    finally:
        if process.poll() is None:
            process.kill()
        process.wait(timeout=5)
        process.stdin.close()
        process.stdout.close()


def browser(profile, namespace, transport, active):
    name = 'superqa-live-' + str(uuid4())
    process = subprocess.Popen(browser_command(name, os.environ['AUTONOMY_LIVE_IMAGE']), stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
    deadline = time.monotonic() + 90
    rules = {(item['method'], item['path'].replace('{namespace}', namespace)) for item in profile['routes']}
    blocked = False
    buffer = b''
    requests = 0
    total = 0
    poller = selectors.DefaultSelector()
    try:
        pipe_write(process.stdin, (json.dumps({'origin': profile['origin'], 'steps': profile['steps'], 'namespace': namespace}) + '\n').encode())
        poller.register(process.stdout, selectors.EVENT_READ)
        while time.monotonic() < deadline:
            if not active():
                raise ValueError('Run no longer active')
            if not poller.select(timeout=0.5):
                continue
            chunk = os.read(process.stdout.fileno(), 8192)
            if not chunk:
                raise ValueError('Browser exited before evidence')
            buffer += chunk
            if len(buffer) > 150000:
                raise ValueError('Browser output limit')
            while b'\n' in buffer:
                line, buffer = buffer.split(b'\n', 1)
                message = json.loads(line)
                if message.get('type') == 'result':
                    if blocked or message.get('error'):
                        raise ValueError('Browser evidence incomplete or network denied')
                    return message
                requests += 1
                if message.get('type') != 'request' or requests > 100:
                    raise ValueError('Bridge request limit')
                response = {'error': 'policy_error'}
                endpoint = urlsplit(message['url'])
                origin = endpoint.scheme + '://' + endpoint.netloc
                if origin == profile['origin'] and not endpoint.query and not endpoint.fragment and (message['method'], endpoint.path) in rules:
                    try:
                        body = base64.b64decode(message.get('body', ''), validate=True)
                        response = transport.request(message['method'], endpoint.path, body, message.get('headers'))
                        total += len(response['body'])
                        if total > 10000000:
                            raise ValueError('Total transfer limit')
                    except (OSError, ValueError, http.client.HTTPException):
                        response = {'error': 'network_error'}
                if 'error' in response:
                    blocked = True
                pipe_write(process.stdin, (json.dumps(response) + '\n').encode())
        raise ValueError('Browser deadline exceeded')
    finally:
        poller.close()
        remove_browser(process, name)


def execute(check, job, active, browser_adapter=browser):
    result = {'checkId': check['id'], 'profileHash': check['profileHash'], 'error': 'policy_error', 'cleanup': 'not_started', 'artifactHash': '', 'assertions': []}
    journal = None
    try:
        profiles = json.loads(os.getenv('AUTONOMY_LIVE_PROFILE_PATHS', '{}'))
        profile, digest, assertions = load_profile(profiles[check['profileHash']])
        if digest != check['profileHash'] or profile['origin'] != check['origin'] or assertions != check['assertions']:
            return result
        UUID(job['id'])
        namespace = 'sq-' + hashlib.sha256((job['id'] + '/' + check['id']).encode()).hexdigest()[:32]
        transport = Transport(profile['origin'])
        journal = Journal(os.environ['AUTONOMY_LIVE_STATE'])
        if journal.pending() or not active():
            return result
        journal.prepare(namespace, digest)
        result['cleanup'] = 'pending'
        result['error'] = 'execution_error'
        try:
            lease_path = profile['leasePath'].replace('{namespace}', namespace)
            provision = transport.request('PUT', lease_path, json.dumps({'namespace': namespace, 'ttlSeconds': 600}).encode(), {'content-type': 'application/json'})
            if provision['status'] != 201:
                raise ValueError('Lease provision failed')
            lease = json.loads(base64.b64decode(provision['body']))
            if lease != {'namespace': namespace, 'ttlSeconds': 600} or not active():
                raise ValueError('Lease contract or authority invalid')
            evidence = browser_adapter(profile, namespace, transport, active)
            if len(evidence['assertions']) != len(assertions):
                raise ValueError('Incomplete assertions')
            screenshot = base64.b64decode(evidence['screenshot'], validate=True)
            if not 100 <= len(screenshot) <= 65536 or not screenshot.startswith(b'\xff\xd8') or not screenshot.endswith(b'\xff\xd9'):
                raise ValueError('Missing JPEG evidence')
            artifact_hash = hashlib.sha256(screenshot).hexdigest()
            artifact = journal.directory / (artifact_hash + '.jpg')
            descriptor = os.open(artifact, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600) if not artifact.exists() else None
            if descriptor is not None:
                with os.fdopen(descriptor, 'wb') as output:
                    output.write(screenshot)
            result.update(error='', assertions=evidence['assertions'], artifactHash=artifact_hash)
        except (OSError, ValueError, KeyError, TypeError, http.client.HTTPException, subprocess.SubprocessError):
            result['error'] = 'execution_error'
        finally:
            if cleanup(profile, namespace, transport, journal):
                result['cleanup'] = 'clean'
            else:
                result['error'] = 'cleanup_error'
        return result
    except (OSError, ValueError, KeyError, TypeError, sqlite3.Error):
        return result
    finally:
        if journal:
            journal.close()


def recover():
    profiles = json.loads(os.getenv('AUTONOMY_LIVE_PROFILE_PATHS', '{}'))
    journal = Journal(os.environ['AUTONOMY_LIVE_STATE'])
    outcomes = []
    try:
        for namespace, digest in journal.pending():
            clean = False
            try:
                profile, actual, assertions = load_profile(profiles[digest])
                if actual == digest:
                    clean = cleanup(profile, namespace, Transport(profile['origin']), journal)
            except (OSError, ValueError, KeyError):
                pass
            outcomes.append({'namespace': namespace, 'profileHash': digest, 'clean': clean})
    finally:
        journal.close()
    return outcomes


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest='command', required=True)
    profile = commands.add_parser('profile')
    profile.add_argument('path', type=Path)
    commands.add_parser('recover')
    commands.add_parser('request')
    args = parser.parse_args()
    if args.command == 'request':
        request = json.loads(sys.stdin.read(150001))
        result = Transport(request['origin'], request.get('credentialMode', 'configured')).pinned_request(request['method'], request['path'], base64.b64decode(request['body'], validate=True), request['headers'])
        print(json.dumps(result))
        return 0
    if args.command == 'profile':
        profile, digest, assertions = load_profile(args.path)
        print(json.dumps({digest: {'origin': profile['origin'], 'environment': profile['environment'], 'assertions': assertions}}, indent=2))
        return 0
    outcomes = recover()
    print(json.dumps(outcomes, indent=2))
    return 0 if all(item['clean'] for item in outcomes) else 1


if __name__ == '__main__':
    try:
        raise SystemExit(main())
    except (OSError, ValueError, KeyError, http.client.HTTPException):
        print('Live operation failed; no passing evidence.', file=sys.stderr)
        raise SystemExit(1)
