import base64
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import Mock, patch
from uuid import uuid4

from shared.harness.live import Journal, Transport, browser_command, execute, load_profile, pipe_write, recover, remove_browser, safe_path
from shared.harness.benchmark import collect, interval, measured_status, validate


def profile_fixture(origin='https://staging.example.com'):
    return {'origin': origin, 'environment': 'test', 'revision': 'fixture-v1', 'leasePath': '/leases/{namespace}',
            'routes': [{'method': 'GET', 'path': '/app/{namespace}'}, {'method': 'POST', 'path': '/app/{namespace}/items'}],
            'steps': [{'operation': 'goto', 'path': '/app/{namespace}'}, {'operation': 'fill', 'selector': '#name', 'value': 'Synthetic item'},
                      {'operation': 'click', 'selector': '#save'}, {'operation': 'assert', 'selector': '#result', 'expected': 'Saved'}]}


class LiveTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.path = Path(self.directory.name) / 'profile.json'
        self.profile = profile_fixture()
        self.path.write_text(json.dumps(self.profile))
        profile, self.digest, assertions = load_profile(self.path)
        self.check = {'id': 'live', 'kind': 'live', 'origin': profile['origin'], 'profileHash': self.digest, 'assertions': assertions}
        self.job = {'id': str(uuid4())}
        self.environment = patch.dict(os.environ, {'AUTONOMY_LIVE_PROFILE_PATHS': json.dumps({self.digest: str(self.path)}), 'AUTONOMY_LIVE_STATE': self.directory.name, 'AUTONOMY_ALLOWED_ORIGINS': json.dumps([profile['origin']])})
        self.environment.start()
        self.calls = []
        self.fail_delete = False

    def tearDown(self):
        self.environment.stop()
        self.directory.cleanup()

    def transport(self, method, path, body=b'', headers=None):
        self.calls.append((method, path))
        if method == 'PUT':
            return {'status': 201, 'body': base64.b64encode(body).decode()}
        return {'status': 500 if self.fail_delete else 204 if method == 'DELETE' else 404}

    def evidence(self, *args):
        return {'assertions': [{'actual': 'Saved', 'visible': True}], 'screenshot': base64.b64encode(b'\xff\xd8' + b'x' * 100 + b'\xff\xd9').decode()}

    def test_provision_execute_cleanup_and_no_replay(self):
        with patch.object(Transport, 'request', side_effect=self.transport):
            result = execute(self.check, self.job, lambda: True, self.evidence)
            self.assertEqual((result['error'], result['cleanup']), ('', 'clean'))
            self.assertEqual(len(result['artifactHash']), 64)
            self.assertEqual([method for method, path in self.calls], ['PUT', 'DELETE', 'GET'])
            self.assertEqual(execute(self.check, self.job, lambda: True, self.evidence)['error'], 'policy_error')
            self.assertEqual(len(self.calls), 3)

    def test_execution_failure_still_cleans(self):
        with patch.object(Transport, 'request', side_effect=self.transport):
            result = execute(self.check, self.job, lambda: True, lambda *args: (_ for _ in ()).throw(ValueError('failure')))
        self.assertEqual((result['error'], result['cleanup']), ('execution_error', 'clean'))

    def test_uncertain_provision_always_compensated_without_create_retry(self):
        def uncertain(method, path, body=b'', headers=None):
            if method == 'PUT':
                self.calls.append((method, path))
                raise ValueError('Lost response after commit')
            return self.transport(method, path, body, headers)
        with patch.object(Transport, 'request', side_effect=uncertain):
            result = execute(self.check, self.job, lambda: True, self.evidence)
        self.assertEqual(result['cleanup'], 'clean')
        self.assertEqual([method for method, path in self.calls], ['PUT', 'DELETE', 'GET'])

    def test_pending_cleanup_blocks_new_work_and_recovery_only_deletes(self):
        self.fail_delete = True
        with patch.object(Transport, 'request', side_effect=self.transport):
            self.assertEqual(execute(self.check, self.job, lambda: True, self.evidence)['error'], 'cleanup_error')
            self.assertEqual(execute(self.check, {'id': str(uuid4())}, lambda: True, self.evidence)['error'], 'policy_error')
            self.fail_delete = False
            before = len(self.calls)
            self.assertTrue(recover()[0]['clean'])
            self.assertEqual([method for method, path in self.calls[before:]], ['DELETE', 'GET'])
            self.assertEqual(recover(), [])

    def test_crash_intent_survives_reopen_and_is_cleanup_only(self):
        journal = Journal(self.directory.name)
        journal.prepare('sq-' + 'a' * 32, self.digest)
        journal.close()
        with patch.object(Transport, 'request', side_effect=self.transport):
            self.assertTrue(recover()[0]['clean'])
        self.assertEqual([method for method, path in self.calls], ['DELETE', 'GET'])

    def test_cancel_before_provision_does_not_mutate(self):
        with patch.object(Transport, 'request', side_effect=self.transport):
            result = execute(self.check, self.job, lambda: False, self.evidence)
        self.assertEqual(result['cleanup'], 'not_started')
        self.assertFalse(self.calls)

    def test_cancel_after_provision_still_cleans(self):
        with patch.object(Transport, 'request', side_effect=self.transport):
            active = iter([True, False])
            result = execute(self.check, self.job, lambda: next(active), lambda *args: self.fail('Cancelled browser must not start'))
        self.assertEqual((result['error'], result['cleanup']), ('execution_error', 'clean'))

    def test_missing_artifact_cannot_pass(self):
        with patch.object(Transport, 'request', side_effect=self.transport):
            result = execute(self.check, self.job, lambda: True, lambda *args: {**self.evidence(), 'screenshot': ''})
        self.assertEqual((result['error'], result['cleanup']), ('execution_error', 'clean'))

    def test_cleanup_must_verify_absence(self):
        def incomplete(method, path, body=b'', headers=None):
            response = self.transport(method, path, body, headers)
            return {'status': 200} if method == 'GET' else response
        with patch.object(Transport, 'request', side_effect=incomplete):
            result = execute(self.check, self.job, lambda: True, self.evidence)
        self.assertEqual((result['error'], result['cleanup']), ('cleanup_error', 'pending'))

    def test_recovery_never_uses_a_changed_profile(self):
        journal = Journal(self.directory.name)
        journal.prepare('sq-' + 'b' * 32, self.digest)
        journal.close()
        self.path.write_text(json.dumps({**self.profile, 'leasePath': '/other/{namespace}'}))
        with patch.object(Transport, 'request', side_effect=self.transport):
            self.assertFalse(recover()[0]['clean'])
        self.assertFalse(self.calls)

    def test_changed_profile_or_oracle_is_rejected(self):
        self.path.write_text(json.dumps({**self.profile, 'revision': 'changed'}))
        with patch.object(Transport, 'request', side_effect=self.transport):
            self.assertEqual(execute(self.check, self.job, lambda: True, self.evidence)['error'], 'policy_error')
        self.assertFalse(self.calls)

    def test_journal_excludes_concurrent_worker(self):
        journal = Journal(self.directory.name)
        try:
            with self.assertRaises(ValueError):
                Journal(self.directory.name)
        finally:
            journal.close()

    def test_profile_denies_production_code_and_unnamespaced_mutations(self):
        for change in [{'environment': 'production'}, {'routes': [{'method': 'POST', 'path': '/users'}]}, {'steps': [{'operation': 'evaluate', 'value': 'evil'}]}, {'leasePath': '/leases/all'}]:
            self.path.write_text(json.dumps({**self.profile, **change}))
            with self.assertRaises(ValueError):
                load_profile(self.path)

    def test_path_and_container_security(self):
        for path in ['//evil.com', '/a/../b', '/%2fsecret', '/?token=x', '/\\host', '/{other}']:
            self.assertFalse(safe_path(path))
        command = browser_command('test', 'sha256:' + 'a' * 64)
        self.assertIn('none', command)
        self.assertIn('--read-only', command)
        self.assertNotIn('--mount', command)
        self.assertNotIn('-e', command)
        with self.assertRaises(ValueError):
            browser_command('test', 'latest')

    def test_transport_hard_timeout_is_not_retried(self):
        with patch('shared.harness.live.subprocess.run', side_effect=subprocess.TimeoutExpired('request', 15)) as command:
            with self.assertRaises(ValueError):
                Transport(self.profile['origin']).request('PUT', '/leases/test')
        self.assertEqual(command.call_count, 1)

    def test_transport_denies_private_dns_before_connect(self):
        with patch('shared.harness.live.socket.getaddrinfo', return_value=[(0, 0, 0, '', ('169.254.169.254', 443))]), patch('shared.harness.live.PinnedHTTPS') as connection, patch.dict(os.environ, {'AUTONOMY_ALLOWED_CIDRS': '[]'}):
            with self.assertRaises(ValueError):
                Transport(self.profile['origin']).pinned_request('GET', '/app')
            connection.assert_not_called()

    def test_bridge_write_deadline_prevents_a_stalled_reader(self):
        read_descriptor, write_descriptor = os.pipe()
        try:
            with os.fdopen(write_descriptor, 'wb') as stream, patch('shared.harness.live.time.monotonic', side_effect=[0, 11]):
                with self.assertRaises(TimeoutError):
                    pipe_write(stream, b'payload')
        finally:
            os.close(read_descriptor)

    def test_container_auto_removal_may_precede_cli_exit(self):
        process = Mock()
        process.poll.return_value = None
        process.wait.return_value = 0
        with patch('shared.harness.live.subprocess.run', return_value=Mock(returncode=1)):
            remove_browser(process, 'already-removed')
        process.wait.assert_called()

    def test_uncertain_container_teardown_is_not_silently_accepted(self):
        process = Mock()
        process.poll.return_value = None
        process.wait.return_value = 1
        with patch('shared.harness.live.subprocess.run', return_value=Mock(returncode=1)):
            with self.assertRaises(ValueError):
                remove_browser(process, 'unknown')

    def test_transport_rejects_redirect_encoding_and_large_response(self):
        for status, encoding, content in [(302, 'identity', b''), (200, 'gzip', b''), (200, 'identity', b'x' * 1048577)]:
            response = Mock(status=status)
            response.read.return_value = content
            response.getheader.return_value = encoding
            connection = Mock()
            connection.getresponse.return_value = response
            with patch('shared.harness.live.socket.getaddrinfo', return_value=[(0, 0, 0, '', ('93.184.216.34', 443))]), patch('shared.harness.live.PinnedHTTPS', return_value=connection):
                with self.assertRaises(ValueError):
                    Transport(self.profile['origin']).pinned_request('GET', '/app')
                connection.close.assert_called_once()


class BenchmarkTests(unittest.TestCase):
    def setUp(self):
        self.suite_id = str(uuid4())
        self.sample = {'id': 'sample', 'defective': False, 'suiteId': self.suite_id, 'manifestHash': 'hash', 'revision': 'v1', 'revisionCheckId': 'revision', 'targetCheckId': 'target', 'reviewedBy': 'human', 'labelEvidence': 'review/123'}
        other_id = str(uuid4())
        self.corpus = {'name': 'cohort', 'kind': 'synthetic', 'projectId': 'project', 'repetitions': 1, 'samples': [self.sample, {**self.sample, 'id': 'bug', 'suiteId': other_id, 'defective': True}]}
        self.overview = {'project': {'id': 'project'}, 'suites': [{'id': self.suite_id, 'approvedBy': 'owner', 'manifestHash': 'hash', 'checks': [{'id': 'revision', 'kind': 'api', 'expected': 'v1'}, {'id': 'target'}]}]}
        self.overview['suites'].append({**self.overview['suites'][0], 'id': other_id})
        self.run = {'id': str(uuid4()), 'suiteId': self.suite_id, 'snapshot': {'manifestHash': 'hash'}, 'status': 'passed', 'modelCostNanoUsd': 0, 'results': [{'checkId': 'revision', 'status': 'passed', 'observation': {'actual': 'v1'}}, {'checkId': 'target', 'status': 'passed'}]}

    def test_revision_or_manifest_drift_is_uncertain(self):
        self.assertEqual(measured_status(self.sample, self.run), 'passed')
        self.assertEqual(measured_status({**self.sample, 'revision': 'v2'}, self.run), 'error')
        self.assertEqual(measured_status({**self.sample, 'manifestHash': 'changed'}, self.run), 'error')

    def test_cohort_requires_review_scope_and_both_labels(self):
        validate(self.corpus, self.overview)
        for corpus in [{**self.corpus, 'projectId': 'other'}, {**self.corpus, 'samples': [self.sample, self.sample]}, {**self.corpus, 'repetitions': 0}]:
            with self.assertRaises(ValueError):
                validate(corpus, self.overview)

    def test_collection_binds_runs_and_never_promotes_synthetic_scores(self):
        requests = []
        outer = self
        class API:
            def request(self, method, path, body=None):
                if method == 'GET':
                    return outer.overview
                requests.append(body)
                run = json.loads(json.dumps(outer.run))
                run['suiteId'] = body['suiteId']
                if len(requests) % 2 == 0:
                    run['status'] = 'failed'
                    run['results'][1]['status'] = 'failed'
                return run
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / 'report.json'
            first = collect(API(), self.corpus, output)
            second = collect(API(), self.corpus, output)
            self.assertTrue(first['report']['gatePassed'])
            self.assertFalse(first['report']['rolloutGatePassed'])
            self.assertEqual(requests[:2], requests[2:])
            self.assertEqual(first['report']['cohortHash'], second['report']['cohortHash'])
            self.assertEqual(json.loads(output.read_text())['evidence'][0]['runId'], self.run['id'])

    def test_intervals_do_not_claim_certainty_from_one_sample(self):
        self.assertLess(interval(1, 1)[0], 0.3)
        self.assertIsNone(interval(0, 0))
