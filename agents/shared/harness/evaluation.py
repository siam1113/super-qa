"""Evaluate a complete, human-labeled corpus; absent results never count as passes."""
import argparse
import json
from pathlib import Path


def evaluate(corpus, results):
    if not isinstance(corpus, list) or not corpus:
        raise ValueError('Nonempty labeled corpus required')
    labels = {}
    for item in corpus:
        if not isinstance(item.get('id'), str) or item['id'] in labels or type(item.get('defective')) is not bool:
            raise ValueError('Unique IDs and boolean defect labels required')
        labels[item['id']] = item['defective']
    observations = {}
    for item in results:
        if item.get('id') not in labels or item['id'] in observations or item.get('status') not in ('passed', 'failed', 'error', 'blocked', 'interrupted', 'cancelled') or type(item.get('modelCostNanoUsd')) is not int or item['modelCostNanoUsd'] < 0:
            raise ValueError('Invalid, duplicate or unlabeled result')
        observations[item['id']] = item
    defective = sum(labels.values())
    healthy = len(labels) - defective
    false_passes = sum(label and observations.get(identity, {}).get('status') == 'passed' for identity, label in labels.items())
    detected = sum(label and observations.get(identity, {}).get('status') == 'failed' for identity, label in labels.items())
    false_failures = sum(not label and observations.get(identity, {}).get('status') == 'failed' for identity, label in labels.items())
    abstentions = sum(observations.get(identity, {}).get('status') not in ('passed', 'failed') for identity in labels)
    return {'samples': len(labels), 'defective': defective, 'healthy': healthy, 'detectedDefects': detected,
            'falsePasses': false_passes, 'missedDefects': defective - detected, 'falseFailures': false_failures,
            'abstentions': abstentions, 'missingResults': len(labels) - len(observations),
            'defectRecall': detected / defective if defective else None,
            'falseFailureRate': false_failures / healthy if healthy else None,
            'completionRate': (len(labels) - abstentions) / len(labels),
            'modelCostNanoUsd': sum(item['modelCostNanoUsd'] for item in observations.values()),
            'modelCostComplete': len(labels) == len(observations), 'infrastructureCostMeasured': False,
            'gatePassed': bool(defective and healthy and not false_passes and detected == defective and not false_failures and not abstentions)}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('corpus', type=Path)
    parser.add_argument('results', type=Path)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    report = evaluate(json.loads(args.corpus.read_text()), json.loads(args.results.read_text()))
    args.output.write_text(json.dumps(report, indent=2) + '\n')
    return 0 if report['gatePassed'] else 1


if __name__ == '__main__':
    raise SystemExit(main())
