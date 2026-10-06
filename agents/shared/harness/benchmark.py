"""Execute reviewed project cohorts and score persisted, revision-bound evidence."""
import argparse
import hashlib
import json
import math
import os
from pathlib import Path
import tempfile
import time
from urllib.parse import urlsplit
from uuid import UUID, uuid5, NAMESPACE_URL

import httpx

from shared.harness.autonomy import AutonomyClient
from shared.harness.evaluation import evaluate


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(',', ':')).encode()).hexdigest()


def interval(successes, total):
    if not total:
        return None
    quantile = 1.96
    proportion = successes / total
    denominator = 1 + quantile ** 2 / total
    center = (proportion + quantile ** 2 / (2 * total)) / denominator
    width = quantile * math.sqrt(proportion * (1 - proportion) / total + quantile ** 2 / (4 * total ** 2)) / denominator
    return [max(0, center - width), min(1, center + width)]


def validate(corpus, overview):
    if set(corpus) != {'name', 'kind', 'projectId', 'repetitions', 'samples'} or corpus['kind'] not in ('synthetic', 'real_project') or corpus['projectId'] != overview['project']['id'] or type(corpus['repetitions']) is not int or not 1 <= corpus['repetitions'] <= 5 or not isinstance(corpus['samples'], list) or not 2 <= len(corpus['samples']) <= 50:
        raise ValueError('Invalid or cross-project cohort')
    ids = set()
    cases = set()
    suites = {suite['id']: suite for suite in overview['suites']}
    for sample in corpus['samples']:
        if set(sample) != {'id', 'defective', 'suiteId', 'manifestHash', 'revision', 'revisionCheckId', 'targetCheckId', 'reviewedBy', 'labelEvidence'} or not isinstance(sample['id'], str) or not sample['id'] or sample['id'] in ids or type(sample['defective']) is not bool:
            raise ValueError('Invalid labeled sample')
        ids.add(sample['id'])
        case = (sample['suiteId'], sample['revision'], sample['targetCheckId'])
        if case in cases:
            raise ValueError('Duplicate suite/revision/target is a repetition, not a new sample')
        cases.add(case)
        UUID(sample['suiteId'])
        if any(not isinstance(sample[field], str) or not sample[field].strip() or len(sample[field]) > 1000 for field in ('revision', 'reviewedBy', 'labelEvidence')):
            raise ValueError('Revision and independent label review required')
        suite = suites.get(sample['suiteId'])
        if not suite or not suite['approvedBy'] or suite['manifestHash'] != sample['manifestHash']:
            raise ValueError('Approved immutable suite mismatch')
        checks = {check['id']: check for check in suite['checks']}
        revision = checks.get(sample['revisionCheckId'], {})
        if revision.get('kind') != 'api' or revision.get('expected') != sample['revision'] or sample['targetCheckId'] not in checks or sample['targetCheckId'] == sample['revisionCheckId']:
            raise ValueError('Separate executable revision oracle and target check required')
    if {sample['defective'] for sample in corpus['samples']} != {True, False}:
        raise ValueError('Both healthy and defective labels required')


def measured_status(sample, run):
    if run.get('suiteId') != sample['suiteId'] or run.get('snapshot', {}).get('manifestHash') != sample['manifestHash'] or run.get('status') not in ('passed', 'failed'):
        return 'error'
    results = {result['checkId']: result for result in (run.get('results') or [])}
    revision = results.get(sample['revisionCheckId'], {})
    if revision.get('status') != 'passed' or revision.get('observation', {}).get('actual') != sample['revision'] or any(item.get('flaky') or item.get('status') not in ('passed', 'failed') for item in results.values()):
        return 'error'
    return results.get(sample['targetCheckId'], {}).get('status', 'error')


def collect(api, corpus, output, timeout=330):
    validate(corpus, api.request('GET', ''))
    cohort_hash = digest(corpus)
    labels = []
    outcomes = []
    evidence = []
    for sample in corpus['samples']:
        for repetition in range(corpus['repetitions']):
            identity = sample['id'] + ':' + str(repetition)
            labels.append({'id': identity, 'defective': sample['defective']})
    for sample in corpus['samples']:
        for repetition in range(corpus['repetitions']):
            identity = sample['id'] + ':' + str(repetition)
            request_id = str(uuid5(NAMESPACE_URL, 'superqa:' + cohort_hash + ':' + identity))
            run = api.request('POST', '/runs', {'suiteId': sample['suiteId'], 'requestId': request_id})
            deadline = time.monotonic() + timeout
            while run['status'] in ('queued', 'running') and time.monotonic() < deadline:
                time.sleep(1)
                run = api.request('GET', '/runs/' + run['id'])
            status = measured_status(sample, run)
            outcomes.append({'id': identity, 'status': status, 'modelCostNanoUsd': run['modelCostNanoUsd']})
            evidence.append({'sampleId': sample['id'], 'repetition': repetition, 'runId': run['id'], 'requestId': request_id, 'status': status, 'run': run})
            report = evaluate(labels, outcomes)
            stable = []
            unstable = []
            for labeled in corpus['samples']:
                observed = [item['status'] for item in evidence if item['sampleId'] == labeled['id']]
                if len(set(observed)) > 1:
                    unstable.append(labeled['id'])
                expected = 'failed' if labeled['defective'] else 'passed'
                if len(observed) == corpus['repetitions'] and all(status == expected for status in observed):
                    stable.append(labeled['id'])
            defects = sum(item['defective'] for item in corpus['samples'])
            healthy = len(corpus['samples']) - defects
            detected = sum(item['defective'] and item['id'] in stable for item in corpus['samples'])
            clean = sum(not item['defective'] and item['id'] in stable for item in corpus['samples'])
            report.update(cohortHash=cohort_hash, corpusKind=corpus['kind'], distinctSamples=len(corpus['samples']), repetitions=corpus['repetitions'], unstableSamples=unstable,
                          stableDefectRecall95=interval(detected, defects), stableHealthySuccess95=interval(clean, healthy),
                          declaredRealProjectCorpus=corpus['kind'] == 'real_project',
                          rolloutGatePassed=bool(corpus['kind'] == 'real_project' and report['gatePassed'] and defects >= 20 and healthy >= 20 and corpus['repetitions'] >= 3 and not unstable),
                          limitations=['Labels, cohort independence and revision endpoint semantics require independent human review.', 'Repeated runs are correlated; confidence intervals use labeled samples, not repetitions.', 'Model proposal quality and infrastructure cost are not measured.'])
            payload = {'corpus': corpus, 'report': report, 'evidence': evidence, 'evidenceHash': digest(evidence)}
            with tempfile.NamedTemporaryFile(mode='w', dir=output.parent, prefix=output.name + '.', delete=False) as temporary:
                json.dump(payload, temporary, indent=2)
                temporary.write('\n')
                temporary.flush()
                os.fsync(temporary.fileno())
            Path(temporary.name).replace(output)
            if run['status'] in ('queued', 'running'):
                return payload
    return payload


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('corpus', type=Path)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    base = os.getenv('BACKEND_API_URL', 'http://localhost:4000/api').rstrip('/') + '/'
    endpoint = urlsplit(base)
    if endpoint.scheme != 'https' and not (endpoint.scheme == 'http' and endpoint.hostname in ('localhost', '127.0.0.1', '::1')):
        parser.error('HTTPS required except loopback')
    with httpx.Client(base_url=base, timeout=20, follow_redirects=False, trust_env=False) as client:
        report = collect(AutonomyClient(client, os.environ['AUTONOMY_PROJECT_KEY']), json.loads(args.corpus.read_text()), args.output)
    print(json.dumps(report['report'], indent=2))
    return 0 if report['report']['rolloutGatePassed'] else 1


if __name__ == '__main__':
    raise SystemExit(main())
