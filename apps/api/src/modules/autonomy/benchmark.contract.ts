import { BadRequestException } from '@nestjs/common';
import { isUUID } from 'class-validator';
import { AutonomousRun, AutonomousSuite } from './autonomy.entity';
import { BenchmarkCorpus, BenchmarkSample } from './benchmark.entity';

export function validateCorpus(input: Record<string, unknown>, projectId: string, suites: AutonomousSuite[]): BenchmarkCorpus {
  if (Object.keys(input).sort().join() !== ['name', 'kind', 'projectId', 'repetitions', 'samples'].sort().join() || typeof input.name !== 'string' || !input.name.trim() || input.name.length > 100 || !['synthetic', 'real_project'].includes(String(input.kind)) || input.projectId !== projectId || !Number.isInteger(input.repetitions) || Number(input.repetitions) < 1 || Number(input.repetitions) > 5 || !Array.isArray(input.samples) || input.samples.length < 2 || input.samples.length > 50) throw new BadRequestException('Invalid or cross-project corpus');
  const ids = new Set<string>();
  const cases = new Set<string>();
  for (const sample of input.samples) {
    if (!sample || typeof sample !== 'object' || Object.keys(sample).sort().join() !== ['id', 'defective', 'suiteId', 'manifestHash', 'revision', 'revisionCheckId', 'targetCheckId', 'reviewedBy', 'labelEvidence'].sort().join() || typeof sample.id !== 'string' || !/^[\w-]{1,100}$/.test(sample.id) || ids.has(sample.id) || typeof sample.defective !== 'boolean' || !isUUID(sample.suiteId) || typeof sample.manifestHash !== 'string' || !/^[a-f0-9]{64}$/.test(sample.manifestHash) || ['revision', 'revisionCheckId', 'targetCheckId', 'reviewedBy', 'labelEvidence'].some(field => typeof sample[field] !== 'string' || !sample[field].trim() || sample[field].length > 1000)) throw new BadRequestException('Unique reviewed labels and immutable suite identities required');
    ids.add(sample.id);
    const identity = JSON.stringify([sample.suiteId, sample.revision, sample.targetCheckId]);
    if (cases.has(identity)) throw new BadRequestException('Duplicate target is a repetition, not a new sample');
    cases.add(identity);
    const suite = suites.find(item => item.id === sample.suiteId);
    const revision = suite?.checks.find(check => check.id === sample.revisionCheckId);
    if (!suite?.approvedBy || suite.manifestHash !== sample.manifestHash || revision?.kind !== 'api' || revision.expected !== sample.revision || sample.targetCheckId === sample.revisionCheckId || !suite.checks.some(check => check.id === sample.targetCheckId)) throw new BadRequestException('Approved scoped suite and a separate executable revision check required');
  }
  if (new Set(input.samples.map(sample => sample.defective)).size !== 2) throw new BadRequestException('Both healthy and defective samples required');
  return input as unknown as BenchmarkCorpus;
}

export function measuredStatus(sample: BenchmarkSample, run?: AutonomousRun): string {
  if (!run || run.suiteId !== sample.suiteId || run.snapshot.manifestHash !== sample.manifestHash || !['passed', 'failed'].includes(run.status)) return 'error';
  const results = run.results || [];
  const revision = results.find(item => item.checkId === sample.revisionCheckId);
  if (revision?.status !== 'passed' || (revision.observation as { actual?: unknown })?.actual !== sample.revision || results.some(item => item.flaky || !['passed', 'failed'].includes(String(item.status)))) return 'error';
  return String(results.find(item => item.checkId === sample.targetCheckId)?.status || 'error');
}

function interval(successes: number, total: number) {
  if (!total) return null;
  const quantile = 1.96;
  const proportion = successes / total;
  const denominator = 1 + quantile ** 2 / total;
  const center = (proportion + quantile ** 2 / (2 * total)) / denominator;
  const width = quantile * Math.sqrt(proportion * (1 - proportion) / total + quantile ** 2 / (4 * total ** 2)) / denominator;
  return [Math.max(0, center - width), Math.min(1, center + width)];
}

export function scoreBenchmark(corpus: BenchmarkCorpus, runs: Array<AutonomousRun | undefined>) {
  const outcomes = corpus.samples.flatMap(sample => Array.from({ length: corpus.repetitions }, (_, repetition) => ({ sample, repetition })));
  const statuses = outcomes.map((trial, index) => measuredStatus(trial.sample, runs[index]));
  const defective = outcomes.filter(trial => trial.sample.defective).length;
  const healthy = outcomes.length - defective;
  const detectedDefects = outcomes.filter((trial, index) => trial.sample.defective && statuses[index] === 'failed').length;
  const falsePasses = outcomes.filter((trial, index) => trial.sample.defective && statuses[index] === 'passed').length;
  const falseFailures = outcomes.filter((trial, index) => !trial.sample.defective && statuses[index] === 'failed').length;
  const abstentions = statuses.filter(status => !['passed', 'failed'].includes(status)).length;
  const completed = outcomes.filter((_, index) => runs[index] && !['queued', 'running'].includes(runs[index]!.status)).length;
  const distinctDefective = corpus.samples.filter(sample => sample.defective).length;
  const stable = corpus.samples.filter((sample, sampleIndex) => statuses.slice(sampleIndex * corpus.repetitions, (sampleIndex + 1) * corpus.repetitions).every(status => status === (sample.defective ? 'failed' : 'passed')));
  const unstableSamples = corpus.samples.filter((_, sampleIndex) => new Set(statuses.slice(sampleIndex * corpus.repetitions, (sampleIndex + 1) * corpus.repetitions).filter((_, repetition) => runs[sampleIndex * corpus.repetitions + repetition] && !['queued', 'running'].includes(runs[sampleIndex * corpus.repetitions + repetition]!.status))).size > 1).map(sample => sample.id);
  const gatePassed = Boolean(defective && healthy && !falsePasses && detectedDefects === defective && !falseFailures && !abstentions);
  return { samples: outcomes.length, distinctSamples: corpus.samples.length, repetitions: corpus.repetitions, completed, defective, healthy, detectedDefects, falsePasses, missedDefects: defective - detectedDefects, falseFailures, abstentions, missingResults: outcomes.length - completed,
    defectRecall: defective ? detectedDefects / defective : null, falseFailureRate: healthy ? falseFailures / healthy : null, completionRate: (outcomes.length - abstentions) / outcomes.length,
    stableDefectRecall95: interval(stable.filter(sample => sample.defective).length, distinctDefective), stableHealthySuccess95: interval(stable.filter(sample => !sample.defective).length, corpus.samples.length - distinctDefective), unstableSamples, gatePassed,
    rolloutGatePassed: Boolean(corpus.kind === 'real_project' && gatePassed && distinctDefective >= 20 && corpus.samples.length - distinctDefective >= 20 && corpus.repetitions >= 3 && !unstableSamples.length),
    modelCostNanoUsd: 0, modelCostComplete: completed === outcomes.length, infrastructureCostMeasured: false,
    limitations: ['Labels and sample independence require independent human review.', 'Repetitions are correlated, not additional independent samples.', 'Execution model cost excludes proposal generation and infrastructure.'] };
}
