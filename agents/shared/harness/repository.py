"""Bounded repository execution behind the existing durable autonomy worker."""
import base64
import hashlib
import io
import json
import os
from pathlib import Path
import re
import signal
import shutil
import subprocess
import tarfile
import tempfile
import time
from typing import List, Literal, Optional
from uuid import UUID
from urllib.parse import urlsplit

from pydantic import ConfigDict, Field, field_validator, model_validator

from shared.skills.contracts import Contract
from shared.skills.datasets import DatasetPlan, digest, generate_values, load_dataset_profile
from shared.harness.live import Journal, Transport, cleanup
from shared.harness.revisions import RevisionProbe, read_revision


class CaseArtifact(Contract):
    requestId: UUID
    contentHash: str = Field(pattern=r'^[a-f0-9]{64}$')
    snapshotHash: str = Field(pattern=r'^[a-f0-9]{64}$')


class CaseLink(Contract):
    testId: str = Field(pattern=r'^[a-f0-9]{64}$')
    caseId: str = Field(min_length=1, max_length=150)
    caseRevision: int = Field(ge=1, strict=True)


class RepairPatch(Contract):
    model_config = ConfigDict(extra='forbid', str_strip_whitespace=False)
    path: str = Field(pattern=r'^[A-Za-z0-9_./-]+\.(?:ts|js|tsx|jsx|mjs|cjs)$')
    diff: str = Field(min_length=1, max_length=20000)
    baseContentHash: str = Field(pattern=r'^[a-f0-9]{64}$')
    diffHash: str = Field(pattern=r'^[a-f0-9]{64}$')

    @field_validator('path')
    @classmethod
    def no_traversal(cls, value):
        if value.startswith('/') or '..' in value.split('/'):
            raise ValueError('Repair path must be relative and cannot traverse parent directories')
        return value


class RepositoryProfile(Contract):
    projectId: UUID
    environment: Literal['test', 'staging']
    repositoryId: str = Field(pattern=r'^[\w-]{1,100}$')
    revision: str = Field(pattern=r'^[a-f0-9]{40}$')
    framework: Literal['playwright', 'cypress']
    frameworkVersion: str = Field(pattern=r'^[\w.-]{1,50}$')
    expectedTests: List[str] = Field(min_length=1, max_length=100)
    datasetProfileHash: Optional[str] = Field(default=None, pattern=r'^[a-f0-9]{64}$')
    datasetOrigin: Optional[str] = None
    targetOrigin: Optional[str] = None
    targetRevision: Optional[str] = Field(default=None, min_length=1, max_length=200)
    revisionProbe: Optional[RevisionProbe] = None
    caseArtifact: Optional[CaseArtifact] = None
    caseLinks: List[CaseLink] = Field(default_factory=list, max_length=500)
    allowedRepairPaths: List[str] = Field(default_factory=list, max_length=20)
    image: str = Field(pattern=r'^sha256:[a-f0-9]{64}$')
    network: str = Field(default='none', pattern=r'^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$')
    specs: List[str] = Field(min_length=1, max_length=30)
    projectPath: str = '.'
    projects: List[str] = Field(default_factory=list, max_length=10)
    timeoutSeconds: int = Field(default=120, ge=10, le=180, strict=True)
    retries: int = Field(default=0, ge=0, le=2, strict=True)

    @field_validator('specs')
    @classmethod
    def paths(cls, values):
        if len(set(values)) != len(values) or any(not re.fullmatch(r'[A-Za-z0-9_./-]+\.(?:ts|js|tsx|jsx|mjs|cjs)', value) or value.startswith(('/', '-')) or '..' in value.split('/') for value in values):
            raise ValueError('Use distinct exact relative spec paths')
        return values

    @model_validator(mode='after')
    def valid(self):
        if len(set(self.expectedTests)) != len(self.expectedTests) or any(not re.fullmatch(r'[a-f0-9]{64}', value) for value in self.expectedTests):
            raise ValueError('Expected test IDs must be unique SHA-256 values')
        if self.projectPath != '.' and (not re.fullmatch(r'[A-Za-z0-9_./-]+', self.projectPath) or self.projectPath.startswith('/') or '..' in self.projectPath.split('/')):
            raise ValueError('Project path must be confined')
        if any(not item or len(item) > 100 or item.startswith('-') for item in self.projects) or (self.framework == 'cypress' and self.projects):
            raise ValueError('Invalid framework projects')
        if bool(self.datasetProfileHash) != bool(self.datasetOrigin):
            raise ValueError('Dataset hash and origin must be configured together')
        if any((self.targetOrigin, self.targetRevision, self.revisionProbe)):
            if not all((self.targetOrigin, self.targetRevision, self.revisionProbe)):
                raise ValueError('Target origin, revision and probe must be configured together')
            parsed = urlsplit(self.targetOrigin)
            if parsed.scheme != 'https' or not parsed.hostname or parsed.username or parsed.password or parsed.path or parsed.query or parsed.fragment:
                raise ValueError('Configured HTTPS target origin required')
            if self.datasetOrigin and self.datasetOrigin != self.targetOrigin:
                raise ValueError('Dataset and tested application must share the approved origin')
        if bool(self.caseArtifact) != bool(self.caseLinks) or any(link.testId not in self.expectedTests for link in self.caseLinks) or len({(link.testId, link.caseId) for link in self.caseLinks}) != len(self.caseLinks):
            raise ValueError('Case links require a pinned artifact and unique links to expected tests')
        if len(set(self.allowedRepairPaths)) != len(self.allowedRepairPaths) or any(path.startswith('/') or '..' in path.split('/') for path in self.allowedRepairPaths):
            raise ValueError('Allowed repair paths must be distinct, relative and confined to the project')
        if self.network in ('host', 'bridge', 'default') or self.network not in json.loads(os.getenv('AUTONOMY_REPOSITORY_NETWORKS', '["none"]')):
            raise ValueError('Runner network is not deployment-approved')
        return self


def load_profile(profile_hash):
    paths = json.loads(os.getenv('AUTONOMY_REPOSITORY_PROFILE_PATHS', '{}'))
    file = Path(paths[profile_hash])
    if not file.is_absolute() or not file.is_file():
        raise ValueError('Configured repository profile required')
    with file.open('rb') as source:
        raw = source.read(32001)
    if len(raw) > 32000 or hashlib.sha256(raw).hexdigest() != profile_hash:
        raise ValueError('Repository profile hash mismatch')
    return RepositoryProfile.model_validate_json(raw)


def public_profile(profile):
    return profile.model_dump(mode='json', include={'projectId', 'environment', 'repositoryId', 'revision', 'framework', 'frameworkVersion', 'expectedTests', 'datasetProfileHash', 'datasetOrigin', 'targetOrigin', 'targetRevision', 'caseArtifact', 'caseLinks', 'allowedRepairPaths'}, exclude_none=True)


def bounded_command(args, timeout=15, limit=131072, cwd=None, stdout_path=None):
    # Disk and time bounds apply even when project files cause large git output.
    with tempfile.TemporaryFile() as output:
        process = subprocess.Popen(args, cwd=cwd, stdout=output, stderr=subprocess.DEVNULL, start_new_session=True)
        deadline = time.monotonic() + timeout
        try:
            while process.poll() is None:
                if time.monotonic() >= deadline or os.fstat(output.fileno()).st_size > limit:
                    raise ValueError('Command exceeded its budget')
                time.sleep(0.1)
            if os.fstat(output.fileno()).st_size > limit:
                raise ValueError('Command output exceeded its budget')
            output.seek(0)
            if stdout_path:
                with open(stdout_path, 'wb') as destination:
                    while chunk := output.read(65536):
                        destination.write(chunk)
                data = b''
            else:
                data = output.read(limit + 1)
            return process.returncode, data
        finally:
            if process.poll() is None:
                os.killpg(process.pid, signal.SIGKILL)
            process.wait()


def prepare_checkout(profile, destination):
    roots = json.loads(os.getenv('AUTONOMY_REPOSITORIES', '{}'))
    root = Path(roots[profile.repositoryId]).resolve(strict=True)
    code, actual = bounded_command(['git', '-C', str(root), 'rev-parse', '--verify', profile.revision + '^{commit}'])
    if code or actual.decode().strip() != profile.revision:
        raise ValueError('Pinned repository commit unavailable')
    archive = destination / 'checkout.tar'
    code, _ = bounded_command(['git', '-C', str(root), 'archive', '--format=tar', profile.revision], timeout=25, limit=67108864, stdout_path=archive)
    if code:
        raise ValueError('Repository archive failed')
    checkout = destination / 'checkout'
    checkout.mkdir()
    count = total = 0
    with tarfile.open(archive) as source:
        for item in source:
            count += 1
            path = Path(item.name)
            total += item.size
            if count > 10000 or total > 67108864 or path.is_absolute() or '..' in path.parts or any(part in ('.git', '.gitmodules', 'node_modules') for part in path.parts) or not (item.isdir() or item.isfile()):
                raise ValueError('Checkout requires regular files without submodules, links or dependencies')
            target = checkout / path
            if item.isdir():
                target.mkdir(parents=True, exist_ok=True)
            else:
                target.parent.mkdir(parents=True, exist_ok=True)
                with source.extractfile(item) as incoming, target.open('wb') as outgoing:
                    while chunk := incoming.read(65536):
                        outgoing.write(chunk)
                target.chmod(0o755 if item.mode & 0o111 else 0o644)
    archive.unlink()
    project = checkout / profile.projectPath
    if not project.is_dir() or not (project / 'package-lock.json').is_file() or not (project / 'package.json').is_file() or any(not (project / spec).is_file() for spec in profile.specs):
        raise ValueError('Project requires an npm lockfile and every configured spec')
    return checkout


def apply_repair_patch(checkout, profile, patch):
    """Apply one reviewed, single-file unified diff to an otherwise pristine checkout."""
    patch = RepairPatch.model_validate(patch)
    if patch.path not in profile.allowedRepairPaths:
        raise ValueError('Repair path is not approved for this repository profile')
    if hashlib.sha256(patch.diff.encode()).hexdigest() != patch.diffHash:
        raise ValueError('Repair patch content does not match its pinned digest')
    root = checkout.resolve()
    target = (root / patch.path).resolve()
    if root not in target.parents or not target.is_file():
        raise ValueError('Repair target is missing from the pinned checkout')
    if hashlib.sha256(target.read_bytes()).hexdigest() != patch.baseContentHash:
        raise ValueError('Repair patch no longer matches the pinned file content')
    patch_file = checkout.parent / 'repair.patch'
    patch_file.write_text(patch.diff)
    try:
        code, _ = bounded_command(['git', 'apply', '--unsafe-paths', '--whitespace=nowarn', str(patch_file)], cwd=str(checkout))
        if code:
            raise ValueError('Repair patch did not apply cleanly to the pinned checkout')
    finally:
        patch_file.unlink(missing_ok=True)
    return patch.diffHash


class RepositoryJournal(Journal):
    def __init__(self, directory):
        super().__init__(Path(directory).resolve())
        self.database.execute('CREATE TABLE IF NOT EXISTS repository_jobs (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, token TEXT NOT NULL, profile_hash TEXT NOT NULL, container TEXT NOT NULL, dataset TEXT NOT NULL, reported INTEGER NOT NULL DEFAULT 0)')
        columns = {row[1] for row in self.database.execute('PRAGMA table_info(repository_jobs)')}
        if 'completion_json' not in columns:
            self.database.execute('ALTER TABLE repository_jobs ADD COLUMN completion_json TEXT')
        if 'completion_sent' not in columns:
            self.database.execute('ALTER TABLE repository_jobs ADD COLUMN completion_sent INTEGER NOT NULL DEFAULT 0')
        if 'kind' not in columns:
            self.database.execute("ALTER TABLE repository_jobs ADD COLUMN kind TEXT NOT NULL DEFAULT 'repository'")
        self.database.commit()

    def register(self, job, profile_hash, kind='repository'):
        with self.database:
            self.database.execute('INSERT INTO repository_jobs (id,project_id,token,profile_hash,container,dataset,kind) VALUES (?,?,?,?,?,?,?)', (job['id'], job['projectId'], job['token'], profile_hash, 'pending' if kind == 'repository' else 'not_started', 'pending' if job.get('dataset') else 'not_started', kind))

    def receipt(self, job_id, container, dataset, reported=False):
        with self.database:
            self.database.execute('UPDATE repository_jobs SET container=?,dataset=?,reported=? WHERE id=?', (container, dataset, int(reported), job_id))

    def unfinished(self):
        return self.database.execute("SELECT id,project_id,token,profile_hash,container,dataset,completion_json,kind FROM repository_jobs WHERE reported=0 OR container='pending' OR dataset='pending' OR (completion_json IS NOT NULL AND completion_sent=0)").fetchall()

    def save_completion(self, job, result, field='repositoryObservations'):
        payload = json.dumps({'token': job['token'], 'observations': [], field: [result]})
        with self.database:
            self.database.execute('UPDATE repository_jobs SET completion_json=? WHERE id=? AND completion_json IS NULL', (payload, job['id']))

    def completion_sent(self, job_id):
        with self.database:
            self.database.execute('UPDATE repository_jobs SET completion_sent=1 WHERE id=?', (job_id,))


def container_name(job_id):
    return 'superqa-suite-' + str(UUID(job_id))


def namespace_for(job_id):
    return 'sq-' + hashlib.sha256(job_id.encode()).hexdigest()[:32]


def remove_container(job_id):
    name = container_name(job_id)
    try:
        code, listing = bounded_command(['docker', 'ps', '-a', '--filter', 'name=^/' + name + '$', '--format', '{{.Names}}'])
        if code:
            return False
        if not listing.strip():
            return True
        code, _ = bounded_command(['docker', 'rm', '-f', name])
        return code == 0
    except (OSError, ValueError):
        return False


def remove_checkout(job_id, journal):
    directory = journal.directory / ('checkout-' + str(UUID(job_id)))
    try:
        if directory.exists() or directory.is_symlink():
            if directory.is_symlink():
                return False
            shutil.rmtree(directory)
        return True
    except OSError:
        return False


def dataset_profile(profile):
    paths = json.loads(os.getenv('AUTONOMY_DATASET_PROFILE_PATHS', '{}'))
    value, actual = load_dataset_profile(paths[profile.datasetProfileHash])
    if actual != profile.datasetProfileHash or value.environment != profile.environment or value.origin != profile.datasetOrigin:
        raise ValueError('Dataset profile changed')
    return value


def acquire_dataset(profile, plan, job_id, journal):
    blueprint = dataset_profile(profile)
    plan = DatasetPlan.model_validate(plan)
    records = generate_values(blueprint, profile.datasetProfileHash, plan.seed)
    if plan.profile_hash != profile.datasetProfileHash or plan.environment != profile.environment or plan.records != records or plan.fixture_hash != digest(records):
        raise ValueError('Fixture plan does not reproduce from the approved blueprint')
    namespace = namespace_for(job_id)
    journal.prepare(namespace, profile.datasetProfileHash)
    transport = Transport(blueprint.origin)
    metadata = {'namespace': namespace, 'ttlSeconds': 600, 'blueprintHash': profile.datasetProfileHash, 'fixtureHash': plan.fixture_hash}
    path = blueprint.lease_path.replace('{namespace}', namespace)
    response = transport.request('PUT', path, json.dumps({**metadata, 'records': records}).encode(), {'content-type': 'application/json'})
    if response['status'] != 201 or json.loads(base64.b64decode(response['body'], validate=True)) != metadata:
        raise ValueError('Dataset acquisition is uncertain; cleanup is required')
    confirmation = transport.request('GET', path)
    if confirmation['status'] != 200 or json.loads(base64.b64decode(confirmation['body'], validate=True)) != metadata:
        raise ValueError('Dataset lease could not be confirmed')
    return namespace


def release_dataset(profile, job_id, journal):
    try:
        blueprint = dataset_profile(profile)
        return cleanup({'leasePath': blueprint.lease_path}, namespace_for(job_id), Transport(blueprint.origin), journal)
    except Exception:
        return False


def invoke_runner(profile, checkout, directory, job_id, namespace, active):
    config = profile.model_dump(mode='json')
    config['namespace'] = namespace
    config_file = directory / 'profile.json'
    config_file.write_text(json.dumps(config))
    config_file.chmod(0o644)
    adapter = Path(__file__).with_name('repository_runner').resolve()
    name = container_name(job_id)
    args = ['docker', 'run', '-d', '--pull=never', '--log-driver', 'none', '--name', name, '--init', '--network', profile.network,
        '--read-only', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', '--user', '1000:1000',
        '--pids-limit', '256', '--memory', '2g', '--memory-swap', '2g', '--cpus', '2', '--shm-size', '256m',
        '--tmpfs', '/tmp:rw,nosuid,nodev,size=512m,mode=1777', '--tmpfs', '/work:rw,nosuid,nodev,size=768m,uid=1000,gid=1000',
        '--tmpfs', '/qa-results:rw,nosuid,nodev,noexec,size=32m,uid=1000,gid=1000',
        '--mount', 'type=bind,src=' + str(checkout) + ',dst=/qa-input,readonly',
        '--mount', 'type=bind,src=' + str(config_file) + ',dst=/qa-profile.json,readonly',
        '--mount', 'type=bind,src=' + str(adapter) + ',dst=/qa-adapter,readonly',
        '--entrypoint', 'node', profile.image, '/qa-adapter/run.cjs']
    code, _ = bounded_command(args, timeout=20)
    if code:
        raise ValueError('Runner container did not start')
    deadline = time.monotonic() + profile.timeoutSeconds
    while True:
        if not active():
            raise InterruptedError('Run is no longer active')
        if time.monotonic() >= deadline:
            raise TimeoutError('Framework deadline reached')
        code, raw = bounded_command(['docker', 'inspect', '--format', '{{json .State}}', name])
        if code:
            raise ValueError('Runner state unavailable')
        state = json.loads(raw)
        if not state['Running']:
            exit_code = state['ExitCode']
            if state.get('OOMKilled') or state.get('Error'):
                raise ValueError('Runner terminated without complete evidence')
            break
        time.sleep(0.5)
    code, raw = bounded_command(['docker', 'cp', name + ':/qa-results/report.json', '-'], limit=131072)
    if code:
        raise ValueError('Framework report missing')
    with tarfile.open(fileobj=io.BytesIO(raw)) as archive:
        members = archive.getmembers()
        if len(members) != 1 or not members[0].isfile() or members[0].size > 64000:
            raise ValueError('Invalid framework report artifact')
        payload = archive.extractfile(members[0]).read(64001)
    return exit_code, payload


def ingest_report(raw, profile):
    report = json.loads(raw)
    if set(report) != {'schemaVersion', 'framework', 'frameworkVersion', 'revision', 'runnerStatus', 'tests'} or report['schemaVersion'] != 1 or report['framework'] != profile.framework or report['frameworkVersion'] != profile.frameworkVersion or report['revision'] != profile.revision or report['runnerStatus'] not in ('passed', 'failed', 'timedout', 'interrupted'):
        raise ValueError('Framework report metadata is incomplete')
    tests = report['tests']
    if not isinstance(tests, list) or len(tests) > 100 or any(not isinstance(test, dict) or not isinstance(test.get('id'), str) or not re.fullmatch(r'[a-f0-9]{64}', test['id']) for test in tests) or len({test['id'] for test in tests}) != len(tests):
        raise ValueError('Discovered inventory exceeds the report contract')
    for test in tests:
        if set(test) != {'id', 'attempts'} or not isinstance(test['attempts'], list) or not 0 <= len(test['attempts']) <= 3:
            raise ValueError('Invalid attempt history')
        for index, attempt in enumerate(test['attempts']):
            if set(attempt) != {'retry', 'status', 'durationMs'} or type(attempt['retry']) is not int or attempt['retry'] != index or attempt['status'] not in ('passed', 'failed', 'timedOut', 'skipped', 'interrupted') or type(attempt['durationMs']) is not int or not 0 <= attempt['durationMs'] <= 300000:
                raise ValueError('Invalid execution attempt')
    return report


def execute(check, job, active, api):
    result = {'checkId': check['id'], 'profileHash': check['profileHash'], 'revision': '', 'frameworkVersion': '',
        'error': 'policy_error', 'cleanup': 'not_started', 'datasetCleanup': 'not_started', 'artifactHash': '', 'exitCode': -1, 'tests': [], 'repairPatchHash': ''}
    journal = None
    profile = None
    registered = False
    try:
        profile = load_profile(check['profileHash'])
        if str(profile.projectId) != job['projectId'] or bool(profile.datasetProfileHash) != bool(job.get('dataset')) or not active():
            return result
        journal = RepositoryJournal(os.environ['AUTONOMY_REPOSITORY_STATE'])
        if journal.unfinished() or journal.pending():
            return result
        journal.register(job, check['profileHash'])
        registered = True
        result.update(cleanup='pending', datasetCleanup='pending' if job.get('dataset') else 'not_started', error='execution_error')
        api.request('POST', '/runs/' + job['id'] + '/cleanup', {'token': job['token'], 'container': result['cleanup'], 'dataset': result['datasetCleanup']})
        directory = journal.directory / ('checkout-' + str(UUID(job['id'])))
        directory.mkdir(mode=0o700)
        checkout = prepare_checkout(profile, directory)
        if not active():
            raise InterruptedError()
        if job.get('repairPatch'):
            result['error'] = 'repair_error'
            result['repairPatchHash'] = apply_repair_patch(checkout, profile, job['repairPatch'])
            result['error'] = 'execution_error'
        if profile.revisionProbe:
            result['error'] = 'revision_error'
            result['revisionBefore'] = read_revision(profile.revisionProbe, Transport(profile.targetOrigin))
            if result['revisionBefore'] != profile.targetRevision:
                raise ValueError('Target revision mismatch')
            result['error'] = 'execution_error'
        namespace = acquire_dataset(profile, job['dataset']['plan'], job['id'], journal) if job.get('dataset') else None
        if not active():
            raise InterruptedError()
        result['exitCode'], raw = invoke_runner(profile, checkout, directory, job['id'], namespace, active)
        result['error'] = 'report_error'
        artifact_hash = hashlib.sha256(raw).hexdigest()
        artifact = journal.directory / (artifact_hash + '.json')
        if not artifact.exists():
            descriptor = os.open(artifact, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
            with os.fdopen(descriptor, 'wb') as destination:
                destination.write(raw)
                destination.flush()
                os.fsync(destination.fileno())
        result['artifactHash'] = artifact_hash
        report = ingest_report(raw, profile)
        result.update(error='' if report['runnerStatus'] in ('passed', 'failed') else 'execution_error', revision=report['revision'], frameworkVersion=report['frameworkVersion'], tests=report['tests'], artifactHash=artifact_hash)
        if profile.revisionProbe:
            prior_error = result['error']
            result['error'] = 'revision_error'
            if not active(): raise InterruptedError()
            result['revisionAfter'] = read_revision(profile.revisionProbe, Transport(profile.targetOrigin))
            if result['revisionAfter'] != profile.targetRevision:
                raise ValueError('Target revision changed')
            result['error'] = prior_error
    except InterruptedError:
        result['error'] = 'cancelled'
    except TimeoutError:
        result['error'] = 'timeout'
    except Exception:
        pass  # No private paths, project output or credentials enter the observation.
    finally:
        if registered:
            result['cleanup'] = 'clean' if remove_container(job['id']) and remove_checkout(job['id'], journal) else 'pending'
            if job.get('dataset'):
                result['datasetCleanup'] = 'clean' if release_dataset(profile, job['id'], journal) else 'pending'
            if 'pending' in (result['cleanup'], result['datasetCleanup']):
                result['error'] = 'cleanup_error'
            journal.receipt(job['id'], result['cleanup'], result['datasetCleanup'])
            journal.save_completion(job, result)
            try:
                api.request('POST', '/runs/' + job['id'] + '/cleanup', {'token': job['token'], 'container': result['cleanup'], 'dataset': result['datasetCleanup']})
                journal.receipt(job['id'], result['cleanup'], result['datasetCleanup'], True)
            except Exception:
                pass
        if journal:
            journal.close()
    return result


def recover(api, directory=None):
    """Remove orphan containers and release leases; never replay a test or PUT."""
    directory = directory or os.getenv('AUTONOMY_REPOSITORY_STATE')
    if not directory:
        return True
    journal = RepositoryJournal(directory)
    try:
        for job_id, project_id, token, profile_hash, container, dataset, completion_json, kind in journal.unfinished():
            try:
                job = api.request('GET', '/runs/' + job_id)
                if job['projectId'] != project_id:
                    return False
                if kind == 'repository':
                    container = 'clean' if remove_container(job_id) and remove_checkout(job_id, journal) else 'pending'
                    profile_loader = load_profile
                elif kind == 'api_flow':
                    from .api_flow import load_profile as profile_loader
                    container = 'not_started'
                else:
                    return False
                if dataset == 'pending':
                    dataset = 'clean' if release_dataset(profile_loader(profile_hash), job_id, journal) else 'pending'
                journal.receipt(job_id, container, dataset)
                api.request('POST', '/runs/' + job_id + '/cleanup', {'token': token, 'container': container, 'dataset': dataset})
                journal.receipt(job_id, container, dataset, True)
                if completion_json:
                    if job['status'] == 'running':
                        api.request('POST', '/runs/' + job_id + '/complete', json.loads(completion_json))
                    journal.completion_sent(job_id)
            except Exception:
                return False
        return not journal.unfinished() and not journal.pending()
    finally:
        journal.close()


def main():
    import argparse
    import httpx
    from urllib.parse import urlsplit
    from .autonomy import AutonomyClient
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest='command', required=True)
    profile_command = commands.add_parser('profile')
    profile_command.add_argument('path', type=Path)
    commands.add_parser('recover')
    args = parser.parse_args()
    if args.command == 'profile':
        with args.path.open('rb') as source:
            raw = source.read(32001)
        if len(raw) > 32000:
            raise ValueError('Profile exceeds its budget')
        profile = RepositoryProfile.model_validate_json(raw)
        print(json.dumps({hashlib.sha256(raw).hexdigest(): public_profile(profile)}, indent=2))
        return 0
    base = os.getenv('BACKEND_API_URL', 'http://localhost:4000/api').rstrip('/') + '/'
    endpoint = urlsplit(base)
    if endpoint.scheme != 'https' and not (endpoint.scheme == 'http' and endpoint.hostname in ('localhost', '127.0.0.1', '::1')):
        raise ValueError('Control plane credentials require HTTPS except on loopback')
    with httpx.Client(base_url=base, timeout=20, follow_redirects=False, trust_env=False) as client:
        success = recover(AutonomyClient(client, os.getenv('AUTONOMY_PROJECT_KEY', '')))
    print(json.dumps({'cleanupRecovered': success}))
    return 0 if success else 1


if __name__ == '__main__':
    try:
        raise SystemExit(main())
    except Exception:
        print('Repository worker configuration or recovery failed; no passing result is claimed.')
        raise SystemExit(1)
