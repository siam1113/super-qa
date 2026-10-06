import json
import os
from pathlib import Path
import ssl
import subprocess
import tempfile
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from unittest.mock import patch

import httpx

from shared.harness.autonomy import AutonomyClient, isolated_probe, json_scalar, main, probe, write_junit
from shared.harness.evaluation import evaluate


class AutonomyTests(unittest.TestCase):
    def test_durable_collector_exports_evidence_and_fails_closed_for_synthetic_gate(self):
        calls = []
        def handler(request):
            calls.append(request.url.path)
            return httpx.Response(200, json={'status': 'collecting' if request.url.path.endswith('/resume') else 'completed', 'paused': False, 'report': {'gatePassed': True, 'rolloutGatePassed': False}, 'trials': [{'run': {'id': 'persisted-run'}}]})
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / 'report.json'
            client = httpx.Client(base_url='http://localhost/api/', transport=httpx.MockTransport(handler))
            with patch('shared.harness.autonomy.httpx.Client', return_value=client), patch.dict(os.environ, {'AUTONOMY_PROJECT_KEY': 'sq_' + 'a' * 64}), patch('sys.argv', ['autonomy', 'collect', '11111111-1111-4111-8111-111111111111', '--output', str(output)]):
                self.assertEqual(main(), 1)
            self.assertEqual(json.loads(output.read_text())['trials'][0]['run']['id'], 'persisted-run')
            self.assertEqual(output.stat().st_mode & 0o777, 0o600)
            self.assertEqual([path.rsplit('/', 1)[1] for path in calls], ['resume', 'advance'])

    def test_scalar_pointer(self):
        self.assertEqual(json_scalar({'a/b': [{'~': True}]}, '/a~1b/0/~0'), True)
        for value, pointer in [({'a': []}, '/a'), ([1], '/01'), ({'a': float('nan')}, '/a'), ({'a': 9007199254740992}, '/a'), ({'a': 1.5}, '/a'), ({}, '/missing')]:
            with self.assertRaises((ValueError, KeyError)):
                json_scalar(value, pointer)

    def test_missing_and_uncertain_results_fail_evaluation(self):
        corpus = [{'id': 'bug', 'defective': True}, {'id': 'good', 'defective': False}]
        report = evaluate(corpus, [{'id': 'good', 'status': 'passed', 'modelCostNanoUsd': 0}])
        self.assertEqual(report['missedDefects'], 1)
        self.assertEqual(report['abstentions'], 1)
        self.assertFalse(report['gatePassed'])
        report = evaluate(corpus, [{'id': 'bug', 'status': 'passed', 'modelCostNanoUsd': 5}, {'id': 'good', 'status': 'failed', 'modelCostNanoUsd': 0}])
        self.assertEqual((report['falsePasses'], report['falseFailures']), (1, 1))
        self.assertEqual(report['modelCostNanoUsd'], 5)

    def test_evaluation_requires_both_classes_and_unique_complete_results(self):
        corpus = [{'id': 'bug', 'defective': True}, {'id': 'good', 'defective': False}]
        results = [{'id': 'bug', 'status': 'failed', 'modelCostNanoUsd': 0}, {'id': 'good', 'status': 'passed', 'modelCostNanoUsd': 0}]
        self.assertTrue(evaluate(corpus, results)['gatePassed'])
        self.assertFalse(evaluate(corpus[:1], results[:1])['gatePassed'])
        with self.assertRaises(ValueError):
            evaluate(corpus, results + results)
        with self.assertRaises(ValueError):
            evaluate(corpus, [{'id': 'other', 'status': 'passed', 'modelCostNanoUsd': 0}])

    def test_junit_never_silently_skips_uncertain_or_flaky(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'junit.xml'
            write_junit({'status': 'running'}, path)
            self.assertIn('errors="1"', path.read_text())
            write_junit({'status': 'error', 'results': [{'checkId': '<test>', 'status': 'passed', 'flaky': True}]}, path)
            self.assertIn('errors="1"', path.read_text())
            self.assertIn('&lt;test&gt;', path.read_text())

    def test_worker_retries_report_not_execution(self):
        calls = []
        probes = []

        def handler(request):
            calls.append(request.url.path)
            if request.url.path.endswith('/claim'):
                return httpx.Response(200, json={'id': 'run', 'token': 'lease', 'snapshot': {'checks': [{'id': 'check', 'kind': 'api'}]}})
            if request.url.path.endswith('/complete'):
                return httpx.Response(503 if calls.count('/api/autonomy/runs/run/complete') == 1 else 200, json={})
            return httpx.Response(200, json={'status': 'running'})

        with httpx.Client(base_url='http://localhost/api/', transport=httpx.MockTransport(handler)) as client, patch('shared.harness.autonomy.time.sleep'):
            api = AutonomyClient(client, 'sq_' + 'a' * 64)
            self.assertTrue(api.run_once(lambda check: probes.append(check) or {'checkId': 'check', 'status': 200, 'error': '', 'actual': True}))
        self.assertEqual(len(probes), 1)
        self.assertEqual(calls.count('/api/autonomy/runs/run/complete'), 2)

    def test_paused_run_never_dispatches_probe(self):
        def handler(request):
            return httpx.Response(200, json={'id': 'run', 'token': 'lease', 'snapshot': {'checks': [{'kind': 'api'}]}} if request.url.path.endswith('/claim') else {'status': 'cancelled'})
        with httpx.Client(base_url='http://localhost/api/', transport=httpx.MockTransport(handler)) as client:
            AutonomyClient(client, 'sq_' + 'a' * 64).run_once(lambda check: self.fail('Probe must not execute'))

    def test_probe_process_timeout_is_not_a_passing_observation(self):
        with patch('shared.harness.autonomy.subprocess.run', side_effect=subprocess.TimeoutExpired('probe', 15)):
            self.assertEqual(isolated_probe({'id': 'slow'}), {'checkId': 'slow', 'status': 0, 'error': 'timeout'})


class LiveTLSProbeTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.directory = tempfile.TemporaryDirectory()
        cert = Path(cls.directory.name) / 'cert.pem'
        key = Path(cls.directory.name) / 'key.pem'
        config = Path(cls.directory.name) / 'openssl.cnf'
        config.write_text('[req]\ndistinguished_name=dn\nx509_extensions=ext\nprompt=no\n[dn]\nCN=localhost\n[ext]\nsubjectAltName=DNS:localhost\nbasicConstraints=CA:TRUE\n')
        subprocess.run(['openssl', 'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-keyout', str(key), '-out', str(cert), '-config', str(config)], check=True, capture_output=True)
        cls.seen = []

        class Handler(BaseHTTPRequestHandler):
            def do_GET(self):
                cls.seen.append((self.path, self.headers.get('Authorization')))
                self.send_response(302 if self.path == '/redirect' else 200)
                self.send_header('Location', 'https://169.254.169.254/latest')
                self.end_headers()
                self.wfile.write(b'x' * 65537 if self.path == '/large' else json.dumps({'ok': self.path != '/defective'}).encode())

            def log_message(self, *args):
                pass

        cls.server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        server_context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        server_context.load_cert_chain(cert, key)
        cls.server.socket = server_context.wrap_socket(cls.server.socket, server_side=True)
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.context = ssl.create_default_context(cafile=str(cert))
        cls.origin = 'https://localhost:' + str(cls.server.server_port)

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join()
        cls.directory.cleanup()

    def call(self, path, **kwargs):
        return probe({'id': 'check', 'origin': self.origin, 'path': path, 'pointer': '/ok'}, [self.origin], allowed_cidrs=['127.0.0.0/8', '::1/128'], context=self.context, **kwargs)

    def test_real_tls_healthy_defective_and_worker_secret(self):
        with patch.dict(os.environ, {'FIXTURE_BEARER': 'secret-value'}):
            result = self.call('/healthy', secret_refs={self.origin: 'FIXTURE_BEARER'})
        self.assertEqual(result, {'checkId': 'check', 'status': 200, 'error': '', 'actual': True})
        self.assertEqual(self.seen[-1][1], 'Bearer secret-value')
        self.assertNotIn('secret-value', json.dumps(result))
        self.assertFalse(self.call('/defective')['actual'])

    def test_redirect_and_large_response_fail_closed(self):
        before = len(self.seen)
        self.assertEqual(self.call('/redirect')['error'], 'policy_error')
        self.assertEqual(len(self.seen), before + 1)
        self.assertEqual(self.call('/large')['error'], 'response_limit')

    def test_private_dns_denied_by_default(self):
        before = len(self.seen)
        result = probe({'id': 'check', 'origin': self.origin, 'path': '/', 'pointer': ''}, [self.origin], context=self.context)
        self.assertEqual(result['error'], 'policy_error')
        self.assertEqual(len(self.seen), before)

    def test_origin_and_path_escape_denied(self):
        for path in ['//example.com', '/\\example.com', '/?token=secret']:
            self.assertEqual(self.call(path)['error'], 'policy_error')

    def test_untrusted_certificate_is_not_silently_accepted(self):
        result = probe({'id': 'check', 'origin': self.origin, 'path': '/healthy', 'pointer': '/ok'}, [self.origin], allowed_cidrs=['127.0.0.0/8', '::1/128'], context=ssl.create_default_context())
        self.assertEqual(result['error'], 'network_error')
        self.assertNotIn('actual', result)
