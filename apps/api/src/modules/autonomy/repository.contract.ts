import { BadRequestException } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { WorkflowArtifact } from './workflow-artifact.entity';
import { AutonomousCheck, QaProject } from './autonomy.entity';

type RepositoryObservationDto = {
  error: string | null;
  profileHash: string;
  revision: string;
  revisionBefore?: string; revisionAfter?: string;
  frameworkVersion: string;
  artifactHash: string;
  cleanup: string;
  datasetCleanup?: string;
  exitCode: number;
  tests: Array<{
    id: string;
    attempts: Array<{ retry: number; status: string }>;
  }>;
  repairPatchHash?: string;
};

export type RepairPatch = { path: string; diff: string; baseContentHash: string; diffHash: string };

export type RepositoryProfile = {
  projectId: string; environment: string; repositoryId: string; revision: string;
  framework: 'playwright' | 'cypress'; frameworkVersion: string; expectedTests: string[];
  datasetProfileHash?: string; datasetOrigin?: string;
  targetOrigin?: string; targetRevision?: string;
  caseArtifact?: { requestId: string; contentHash: string; snapshotHash: string };
  caseLinks?: Array<{ testId: string; caseId: string; caseRevision: number }>;
  allowedRepairPaths?: string[];
};

export function repositoryProfile(check: AutonomousCheck, project: QaProject): RepositoryProfile {
  let registry: Record<string, RepositoryProfile>;
  try { registry = JSON.parse(process.env.AUTONOMY_REPOSITORY_PROFILES || '{}'); } catch { throw new BadRequestException('Invalid repository profile registry'); }
  const profile = registry?.[check.profileHash || ''];
  if (!profile || profile.projectId !== project.id || profile.environment !== project.environment || !['test', 'staging'].includes(project.environment) || !/^[a-f0-9]{40}$/.test(profile.revision) || !['playwright', 'cypress'].includes(profile.framework) || !/^[\w.-]{1,50}$/.test(profile.frameworkVersion) || !/^[\w-]{1,100}$/.test(profile.repositoryId) || !Array.isArray(profile.expectedTests) || !profile.expectedTests.length || profile.expectedTests.length > 100 || new Set(profile.expectedTests).size !== profile.expectedTests.length || profile.expectedTests.some(id => !/^[a-f0-9]{64}$/.test(id)) || (profile.datasetProfileHash !== undefined && (!/^[a-f0-9]{64}$/.test(profile.datasetProfileHash) || !project.origins.includes(profile.datasetOrigin || '')))) throw new BadRequestException('Repository profile is not deployment-approved for this app');
  if (profile.allowedRepairPaths !== undefined && (!Array.isArray(profile.allowedRepairPaths) || !profile.allowedRepairPaths.length || profile.allowedRepairPaths.length > 20 || new Set(profile.allowedRepairPaths).size !== profile.allowedRepairPaths.length || profile.allowedRepairPaths.some(path => !/^[A-Za-z0-9_./-]+\.(?:ts|js|tsx|jsx|mjs|cjs)$/.test(path) || path.startsWith('/') || path.split('/').includes('..')))) throw new BadRequestException('Invalid allowed repair paths');
  if (profile.targetOrigin !== undefined || profile.targetRevision !== undefined) {
    if (!project.origins.includes(profile.targetOrigin || '') || typeof profile.targetRevision !== 'string' || !profile.targetRevision.length || profile.targetRevision.length > 200 || profile.datasetOrigin && profile.datasetOrigin !== profile.targetOrigin) throw new BadRequestException('Repository app revision is not deployment-approved');
  }
  const links = profile.caseLinks || [];
  const pin = profile.caseArtifact;
  if (!Array.isArray(links) || links.length > 500 || Boolean(pin) !== Boolean(links.length) || pin && (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(pin.requestId) || !/^[a-f0-9]{64}$/.test(pin.contentHash) || !/^[a-f0-9]{64}$/.test(pin.snapshotHash)) || links.some(link => !link || !profile.expectedTests.includes(link.testId) || typeof link.caseId !== 'string' || !link.caseId.length || link.caseId.length > 150 || !Number.isInteger(link.caseRevision) || link.caseRevision < 1) || new Set(links.map(link => JSON.stringify([link.testId, link.caseId]))).size !== links.length) throw new BadRequestException('Invalid pinned case-to-test mapping');
  return profile;
}

export async function validateRepositoryCases(manager: EntityManager, project: QaProject, profile: RepositoryProfile) {
  const pin = profile.caseArtifact;
  if (!pin) return;
  const artifact = await manager.findOneBy(WorkflowArtifact, { projectId: project.id, requestId: pin.requestId, contentHash: pin.contentHash, agentType: 'qae', skill: 'design_test_cases', status: 'completed' });
  if (!artifact) throw new BadRequestException('Published case artifact is unavailable in this app');
  const data: { input_provenance?: { snapshot_hash?: string }; cases?: unknown } | null = JSON.parse(artifact.resultJson).data;
  const candidates: unknown[] = Array.isArray(data?.cases) ? data.cases : [];
  const cases = candidates.filter((item): item is { id: string; revision: number } => Boolean(item && typeof item === 'object' && 'id' in item && typeof item.id === 'string' && 'revision' in item && typeof item.revision === 'number' && Number.isInteger(item.revision) && item.revision >= 1));
  if (data?.input_provenance?.snapshot_hash !== pin.snapshotHash || !cases.length || cases.length !== candidates.length || cases.length > 500 || new Set(cases.map(item => item.id)).size !== cases.length || profile.caseLinks!.some(link => !cases.some(item => item.id === link.caseId && item.revision === link.caseRevision))) throw new BadRequestException('Case mapping has stale or missing case revisions');
}

export function repositoryResult(check: AutonomousCheck, profile: RepositoryProfile, observation: RepositoryObservationDto, hasDataset: boolean, repairPatch?: RepairPatch) {
  const expected = new Set(profile.expectedTests);
  const tests = observation.tests;
  const revisionVerified = Boolean(profile.targetRevision) && observation.revisionBefore === profile.targetRevision && observation.revisionAfter === profile.targetRevision;
  const repairVerified = !repairPatch || observation.repairPatchHash === repairPatch.diffHash;
  const complete = (!profile.targetRevision || revisionVerified) && repairVerified && !observation.error && observation.profileHash === check.profileHash && observation.revision === profile.revision && observation.frameworkVersion === profile.frameworkVersion && /^[a-f0-9]{64}$/.test(observation.artifactHash) && observation.cleanup === 'clean' && (!hasDataset || observation.datasetCleanup === 'clean') && tests.length === expected.size && new Set(tests.map(test => test.id)).size === expected.size && tests.every(test => expected.has(test.id) && test.attempts.length > 0 && test.attempts.every((attempt, index) => attempt.retry === index));
  const incomplete = tests.some(test => test.attempts.some(attempt => ['skipped', 'interrupted'].includes(attempt.status)));
  const flaky = tests.some(test => test.attempts.at(-1)?.status === 'passed' && test.attempts.some(attempt => attempt.status !== 'passed'));
  const failed = tests.some(test => ['failed', 'timedOut'].includes(test.attempts.at(-1)?.status || ''));
  const allPassed = tests.every(test => test.attempts.at(-1)?.status === 'passed');
  const status = !complete || incomplete ? 'error' : failed ? 'failed' : flaky || !allPassed || observation.exitCode !== 0 ? 'error' : 'passed';
  return { checkId: check.id, status, flaky, targetRevision: profile.targetRevision || null, targetOrigin: profile.targetOrigin || null, revisionEvidence: revisionVerified ? 'configured_origin_observed_before_and_after' : 'unavailable_or_mismatch',
    repair: repairPatch ? { path: repairPatch.path, diffHash: repairPatch.diffHash, applied: repairVerified } : null,
    traceability: { caseArtifact: profile.caseArtifact || null, semanticBasis: 'operator_declared_mapping', links: (profile.caseLinks || []).map(link => ({ ...link, identityObserved: complete && tests.some(test => test.id === link.testId), attempts: tests.find(test => test.id === link.testId)?.attempts || [] })) }, expected: expected.size, discovered: tests.length,
    executed: tests.filter(test => test.attempts.some(attempt => !['skipped', 'interrupted'].includes(attempt.status))).length,
    observation, classification: !complete || incomplete ? 'infrastructure_or_missing_evidence' : flaky ? 'mixed_attempts' : status === 'failed' ? 'assertion_mismatch' : status === 'passed' ? 'verified' : 'runner_error' };
}
