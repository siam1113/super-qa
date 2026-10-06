import asyncio
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import httpx
from shared.harness.browser_executor import BrowserWorker, docker_command, snapshot_bundle
from shared.harness.sandbox.runner import validate_isolation


class ContainerPolicyTests(unittest.TestCase):
    def test_inactive_kernel_tunnels_do_not_look_like_external_networks(self):
        with patch('shared.harness.sandbox.runner.os.geteuid', return_value=1000), patch('shared.harness.sandbox.runner.socket.if_nameindex', return_value=[(1, 'lo'), (2, 'tunl0')]), patch.object(Path, 'read_text', return_value='0x80'):
            validate_isolation()

    def test_active_external_interfaces_are_rejected(self):
        with patch('shared.harness.sandbox.runner.os.geteuid', return_value=1000), patch('shared.harness.sandbox.runner.socket.if_nameindex', return_value=[(1, 'lo'), (2, 'eth0')]), patch.object(Path, 'read_text', return_value='0x1003'):
            with self.assertRaises(ValueError):
                validate_isolation()

    def test_container_is_offline_read_only_and_non_privileged(self):
        command = docker_command('fixture', 'sha256:' + 'a' * 64, Path('/tmp/fixture'))
        self.assertEqual(command[command.index('--network') + 1], 'none')
        self.assertEqual(command[command.index('--user') + 1], '1000:1000')
        self.assertEqual(command[command.index('--cap-drop') + 1], 'ALL')
        self.assertIn('--read-only', command)
        self.assertIn('--memory', command)
        self.assertIn('--pids-limit', command)
        self.assertIn('no-new-privileges', command)
        self.assertNotIn('--privileged', command)
        self.assertNotIn('/var/run/docker.sock', ' '.join(command))
        self.assertNotIn('--env', command)

    def test_image_must_resolve_to_immutable_local_id(self):
        with self.assertRaises(ValueError):
            docker_command('fixture', 'some-image:latest', Path('/tmp/fixture'))

    def test_bundle_copy_preserves_digest_and_detects_changes(self):
        with tempfile.TemporaryDirectory() as temporary:
            source = Path(temporary) / 'source'; source.mkdir()
            copied = Path(temporary) / 'copy'; copied.mkdir()
            (source / 'index.html').write_text('Hello')
            original = snapshot_bundle(source, copied)
            self.assertEqual(original, snapshot_bundle(copied))
            (source / 'index.html').write_text('Changed')
            self.assertNotEqual(original, snapshot_bundle(source))
            self.assertEqual((copied / 'index.html').read_text(), 'Hello')

    def test_symlinks_and_missing_entrypoint_are_rejected(self):
        with tempfile.TemporaryDirectory() as temporary:
            source = Path(temporary)
            with self.assertRaises(ValueError):
                snapshot_bundle(source)
            (source / 'index.html').write_text('Hello')
            (source / 'secret').symlink_to('/etc/passwd')
            with self.assertRaises(ValueError):
                snapshot_bundle(source)


class BrowserWorkerTests(unittest.IsolatedAsyncioTestCase):
    async def test_completion_retry_never_reexecutes_actions(self):
        calls = []
        runs = []

        class Browser:
            async def execute(self, job):
                runs.append(job)
                return {'runnerVersion': 'fixture', 'error': '', 'observations': [], 'screenshot': ''}

        def respond(request):
            if request.url.path.endswith('/claim'):
                return httpx.Response(201, json={'id': 'fixture', 'token': 'token'})
            calls.append(json.loads(request.content))
            return httpx.Response(503 if len(calls) == 1 else 201, json={})

        async with httpx.AsyncClient(base_url='http://fixture/api/', transport=httpx.MockTransport(respond)) as client:
            await BrowserWorker(client, 'k' * 32, Browser()).run_once()
        self.assertEqual(len(runs), 1)
        self.assertEqual(calls[0], calls[1])

    async def test_cancellation_stops_container_adapter_and_sends_no_success(self):
        stopped = asyncio.Event()
        calls = []

        class Browser:
            async def execute(self, job):
                try:
                    await asyncio.sleep(30)
                finally:
                    stopped.set()

        def respond(request):
            if request.url.path.endswith('/claim'):
                return httpx.Response(201, json={'id': 'fixture', 'token': 'token'})
            calls.append(request.method)
            return httpx.Response(200, json={'status': 'cancelled'})

        async with httpx.AsyncClient(base_url='http://fixture/api/', transport=httpx.MockTransport(respond)) as client:
            await BrowserWorker(client, 'k' * 32, Browser()).run_once()
        self.assertTrue(stopped.is_set())
        self.assertEqual(calls, ['GET'])

    async def test_container_failure_does_not_fall_back_to_host_browser(self):
        calls = []

        class Browser:
            async def execute(self, job):
                raise RuntimeError('Docker unavailable')

        def respond(request):
            if request.url.path.endswith('/claim'):
                return httpx.Response(201, json={'id': 'fixture', 'token': 'token'})
            calls.append(json.loads(request.content))
            return httpx.Response(201, json={})

        async with httpx.AsyncClient(base_url='http://fixture/api/', transport=httpx.MockTransport(respond)) as client:
            await BrowserWorker(client, 'k' * 32, Browser()).run_once()
        self.assertEqual(calls[0]['error'], 'infrastructure_error')
        self.assertEqual(calls[0]['observations'], [])


if __name__ == '__main__':
    unittest.main()
