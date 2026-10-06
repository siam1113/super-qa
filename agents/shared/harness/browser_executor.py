"""Container-only browser executor. No local-browser or shell fallback."""
import asyncio
import hashlib
import json
import os
import re
import tempfile
import uuid
from pathlib import Path

import httpx


def snapshot_bundle(source: Path, destination: Path = None) -> str:
    source = source.resolve(strict=True)
    manifest = []
    total = 0
    entries = sorted(source.rglob('*'))
    if len(entries) > 200:
        raise ValueError('Bundle entry limit exceeded')
    for entry in entries:
        if entry.is_symlink() or not (entry.is_file() or entry.is_dir()):
            raise ValueError('Bundle links and special files are forbidden')
        if entry.is_dir():
            continue
        relative = entry.relative_to(source).as_posix()
        if not re.fullmatch(r'[a-zA-Z0-9_./-]+', relative):
            raise ValueError('Unsupported bundle filename')
        if entry.stat().st_size > 5000000:
            raise ValueError('Bundle file limit exceeded')
        content = entry.read_bytes()
        total += len(content)
        if total > 5000000:
            raise ValueError('Bundle size limit exceeded')
        manifest.append(relative + '\0' + hashlib.sha256(content).hexdigest())
        if destination is not None:
            target = destination / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(content)
            target.chmod(0o444)
    if not (source / 'index.html').is_file():
        raise ValueError('Bundle requires index.html')
    return hashlib.sha256('\n'.join(manifest).encode()).hexdigest()


def docker_command(name: str, image: str, target: Path):
    if not re.fullmatch(r'sha256:[a-f0-9]{64}', image):
        raise ValueError('A local immutable image ID is required')
    return ['docker', 'run', '--pull=never', '--rm', '--init', '--name', name,
            '--network', 'none', '--read-only', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges',
            '--user', '1000:1000', '--pids-limit', '128', '--memory', '768m', '--memory-swap', '768m',
            '--cpus', '1', '--shm-size', '128m', '--tmpfs', '/tmp:rw,nosuid,nodev,noexec,size=192m,mode=1777',
            '--mount', f'type=bind,src={target},dst=/target,readonly', '-i', image]


async def bounded_read(stream, maximum):
    chunks = []
    total = 0
    while True:
        chunk = await stream.read(4096)
        if not chunk:
            return b''.join(chunks)
        total += len(chunk)
        if total > maximum:
            raise ValueError('Runner output limit exceeded')
        chunks.append(chunk)


class DockerBrowser:
    def __init__(self, targets: dict, image: str):
        self.targets = targets
        self.image = image

    async def execute(self, job: dict):
        name = 'superqa-browser-' + str(uuid.uuid4())
        process = None
        with tempfile.TemporaryDirectory(prefix='superqa-browser-') as temporary:
            target = Path(temporary) / 'target'
            target.mkdir(mode=0o755)
            source = self.targets.get(job['targetId'])
            if not isinstance(source, str) or snapshot_bundle(Path(source), target) != job['targetHash']:
                raise ValueError('Target bundle is not configured or revision changed')
            inspect = await asyncio.create_subprocess_exec('docker', 'image', 'inspect', '--format', '{{.Id}}', self.image,
                                                           stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.DEVNULL)
            try:
                output, _ = await asyncio.wait_for(inspect.communicate(), timeout=10)
            except BaseException:
                if inspect.returncode is None:
                    inspect.kill()
                await inspect.wait()
                raise
            if inspect.returncode:
                raise ValueError('Configured runner image is unavailable')
            image = output.decode().strip()
            try:
                process = await asyncio.create_subprocess_exec(*docker_command(name, image, target), stdin=asyncio.subprocess.PIPE,
                                                               stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE)
                payload = json.dumps({'explore': job['explore']} if 'explore' in job else {'steps': job['steps']}).encode()
                if len(payload) > 64000:
                    raise ValueError('Plan exceeds runner limit')
                process.stdin.write(payload)
                await process.stdin.drain()
                process.stdin.close()
                stdout, _, _ = await asyncio.wait_for(asyncio.gather(bounded_read(process.stdout, 90000), bounded_read(process.stderr, 16000), process.wait()), timeout=75)
                if process.returncode:
                    raise ValueError('Browser container exited unsuccessfully')
                result = json.loads(stdout)
                result['runnerVersion'] = str(result['runnerVersion']) + '/' + image
                return result
            finally:
                cleanup = await asyncio.create_subprocess_exec('docker', 'rm', '-f', name, stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.DEVNULL)
                try:
                    await asyncio.wait_for(cleanup.wait(), timeout=10)
                except asyncio.TimeoutError:
                    cleanup.kill()
                    await cleanup.wait()
                if process is not None and process.returncode is None:
                    process.kill()
                    await process.wait()


class BrowserWorker:
    def __init__(self, client: httpx.AsyncClient, key: str, browser: DockerBrowser):
        if len(key) < 32:
            raise ValueError('HARNESS_EXECUTOR_KEY requires at least 32 characters')
        self.client = client
        self.headers = {'x-harness-key': key}
        self.browser = browser

    async def request(self, method, path, body=None):
        response = await self.client.request(method, 'harness/executor/' + path, json=body, headers=self.headers)
        response.raise_for_status()
        return response.json() if response.content else None

    async def run_once(self):
        job = await self.request('POST', 'claim', {})
        if not job:
            return False
        operation = asyncio.create_task(self.browser.execute(job))
        try:
            while not operation.done():
                await asyncio.wait({operation}, timeout=1)
                if not operation.done():
                    state = await self.request('GET', job['id'])
                    if state['status'] != 'running':
                        return True
            report = await operation
        except asyncio.CancelledError:
            raise
        except Exception:
            report = {'error': 'infrastructure_error', 'observations': [], 'screenshot': '', 'runnerVersion': 'offline-browser-worker-v1'}
        finally:
            if not operation.done():
                operation.cancel()
            await asyncio.gather(operation, return_exceptions=True)
        body = {**report, 'token': job['token']}
        for attempt in range(3):
            try:
                await self.request('POST', job['id'] + '/complete', body)
                return True
            except httpx.HTTPStatusError as error:
                if error.response.status_code == 409:
                    return True
                if error.response.status_code < 500:
                    raise
            except httpx.TransportError:
                pass
            await asyncio.sleep(attempt + 1)
        raise RuntimeError('Completion not persisted; execution must not be replayed automatically')


async def main():
    from dotenv import load_dotenv
    load_dotenv()
    targets = json.loads(os.environ['HARNESS_BROWSER_TARGETS'])
    browser = DockerBrowser(targets, os.environ['HARNESS_BROWSER_IMAGE'])
    base = os.getenv('BACKEND_API_URL', 'http://localhost:4000/api').rstrip('/') + '/'
    async with httpx.AsyncClient(base_url=base, timeout=10, follow_redirects=False) as client:
        worker = BrowserWorker(client, os.environ['HARNESS_EXECUTOR_KEY'], browser)
        while True:
            try:
                worked = await worker.run_once()
            except Exception as error:
                print('Browser worker transport error: ' + type(error).__name__, flush=True)
                worked = False
            if not worked:
                await asyncio.sleep(5)


if __name__ == '__main__':
    asyncio.run(main())
