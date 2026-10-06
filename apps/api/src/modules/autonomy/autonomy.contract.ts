import { apiProfile } from './api-flow.contract';
import { BadRequestException } from '@nestjs/common';
import { createHash } from 'crypto';
import { AutonomousCheck, QaProject } from './autonomy.entity';
import { repositoryProfile } from './repository.contract';

export function hashManifest(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

export function scalar(value: unknown): boolean {
  return value === null || typeof value === 'boolean' || (typeof value === 'number' && Number.isSafeInteger(value)) || (typeof value === 'string' && value.length <= 1000);
}

export function liveProfile(check: AutonomousCheck, project: QaProject) {
  let profiles: Record<string, { origin: string; environment: string; assertions: string[] }>;
  try { profiles = JSON.parse(process.env.AUTONOMY_LIVE_PROFILES || '{}'); } catch { throw new BadRequestException('Invalid live profile registry'); }
  const profile = profiles?.[check.profileHash || ''];
  if (!profile || !['test', 'staging'].includes(project.environment) || profile.environment !== project.environment || !project.origins.includes(profile.origin) || check.origin !== profile.origin || JSON.stringify(check.assertions) !== JSON.stringify(profile.assertions)) throw new BadRequestException('Live profile is not deployment-approved');
}

export function validateChecks(checks: Array<Record<string, unknown>>, project: QaProject): AutonomousCheck[] {
  if (checks.some(check => ['repository', 'api_flow'].includes(String(check.kind))) && checks.length !== 1) throw new BadRequestException('Repository and API flow suites require exactly one check');
  const ids = new Set<string>();
  for (const check of checks) {
    const allowed = ['repository', 'api_flow'].includes(String(check.kind)) ? ['id', 'requirement', 'kind', 'profileHash'] : check.kind === 'live' ? ['id', 'requirement', 'kind', 'origin', 'profileHash', 'assertions'] : check.kind === 'api' ? ['id', 'requirement', 'kind', 'origin', 'path', 'expectedStatus', 'pointer', 'expected'] : ['id', 'requirement', 'kind', 'proposalRunId', 'targetId', 'bindings'];
    if (Object.keys(check).some(key => !allowed.includes(key)) || typeof check.id !== 'string' || !/^[\w-]{1,100}$/.test(check.id) || ['__proto__', 'constructor', 'prototype'].includes(check.id) || ids.has(check.id) || typeof check.requirement !== 'string' || !project.requirements.includes(check.requirement)) throw new BadRequestException('Invalid check identity or requirement');
    ids.add(check.id);
    if (check.kind === 'api') {
      if (typeof check.origin !== 'string' || !project.origins.includes(check.origin) || typeof check.path !== 'string' || !/^\/(?!\/)[^\\\s?#]*$/.test(check.path) || check.path.length > 2000 || typeof check.expectedStatus !== 'number' || !Number.isInteger(check.expectedStatus) || check.expectedStatus < 200 || check.expectedStatus > 299 || typeof check.pointer !== 'string' || check.pointer.length > 500 || (check.pointer !== '' && !/^\/(?:[^~]|~[01])*$/.test(check.pointer)) || !scalar(check.expected)) throw new BadRequestException('Invalid read-only API oracle');
    } else if (check.kind === 'live') {
      if (typeof check.profileHash !== 'string' || !/^[a-f0-9]{64}$/.test(check.profileHash) || !Array.isArray(check.assertions) || !check.assertions.length || check.assertions.length > 20 || check.assertions.some(value => typeof value !== 'string' || !value.length || value.length > 1000)) throw new BadRequestException('Invalid live workflow');
      liveProfile(check as unknown as AutonomousCheck, project);
    } else if (check.kind === 'api_flow') {
      if (typeof check.profileHash !== 'string' || !/^[a-f0-9]{64}$/.test(check.profileHash)) throw new BadRequestException('Pinned API profile required');
      apiProfile(check as unknown as AutonomousCheck, project);
    } else if (check.kind === 'repository') {
      if (typeof check.profileHash !== 'string' || !/^[a-f0-9]{64}$/.test(check.profileHash)) throw new BadRequestException('Pinned repository profile required');
      repositoryProfile(check as unknown as AutonomousCheck, project);
    } else if (check.kind === 'browser') {
      if (typeof check.proposalRunId !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(check.proposalRunId) || typeof check.targetId !== 'string' || !project.targets.includes(check.targetId) || !Array.isArray(check.bindings) || !check.bindings.length || check.bindings.length > 20) throw new BadRequestException('Invalid browser check');
      for (const binding of check.bindings) {
        if (!binding || typeof binding !== 'object' || Object.keys(binding).some(key => !['operation', 'value'].includes(key)) || !['click', 'fill', 'check'].includes(binding.operation) || (binding.operation === 'fill' ? typeof binding.value !== 'string' || binding.value.length > 1000 : binding.value !== undefined)) throw new BadRequestException('Invalid browser binding');
      }
    } else throw new BadRequestException('Unsupported check kind');
  }
  return checks as unknown as AutonomousCheck[];
}

export function validateMaintenance(previous: AutonomousCheck[], next: AutonomousCheck[]) {
  for (const prior of previous) {
    const check = next.find(item => item.id === prior.id);
    if (!check || check.kind !== prior.kind || check.requirement !== prior.requirement || (['repository', 'api_flow'].includes(prior.kind) ? check.profileHash !== prior.profileHash : prior.kind === 'live' ? check.profileHash !== prior.profileHash || JSON.stringify(check.assertions) !== JSON.stringify(prior.assertions) : prior.kind === 'api' ? check.expected !== prior.expected || check.expectedStatus !== prior.expectedStatus || check.pointer !== prior.pointer : check.proposalRunId !== prior.proposalRunId)) throw new BadRequestException('Maintenance cannot remove checks or replace approved oracles; changed requirements need a separate reviewed suite');
  }
}
