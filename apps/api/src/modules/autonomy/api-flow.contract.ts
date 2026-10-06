import { BadRequestException } from '@nestjs/common';
import { AutonomousCheck, QaProject } from './autonomy.entity';
import { ApiFlowObservationDto } from './autonomy.dto';

type Shape = { type: string; properties?: Record<string, Shape>; required?: string[]; additionalProperties?: boolean; items?: Shape; minItems?: number; maxItems?: number; minLength?: number; maxLength?: number };
type Assertion = { id: string; pointer?: string; expected?: unknown; schema?: Shape };
type Step = { id: string; expectedStatus: number; assertions: Assertion[] };
export type ApiProfile = { projectId: string; environment: string; origin: string; targetRevision: string; datasetProfileHash?: string | null; datasetOrigin?: string | null; steps: Step[] };
const own = (object: object, key: string) => Object.prototype.hasOwnProperty.call(object, key);
const object = (value: unknown): value is Record<string, any> => !!value && typeof value === 'object' && !Array.isArray(value);
const identity = (value: unknown) => typeof value === 'string' && /^[A-Za-z0-9_-]{1,60}$/.test(value);

function jsonEqual(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (Array.isArray(left) && Array.isArray(right)) return left.length === right.length && left.every((item, index) => jsonEqual(item, right[index]));
  if (object(left) && object(right)) return Object.keys(left).length === Object.keys(right).length && Object.keys(left).every(key => own(right, key) && jsonEqual(left[key], right[key]));
  return false;
}
function boundedJson(value: unknown, depth = 0): boolean {
  if (depth > 12) return false;
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return true;
  if (typeof value === 'number') return Number.isFinite(value) && Math.abs(value) <= Number.MAX_SAFE_INTEGER;
  if (Array.isArray(value)) return value.every(item => boundedJson(item, depth + 1));
  return object(value) && Object.values(value).every(item => boundedJson(item, depth + 1));
}
function validShape(shape: unknown, depth = 0): shape is Shape {
  if (depth > 6 || !object(shape) || !['object', 'array', 'string', 'number', 'integer', 'boolean', 'null'].includes(shape.type) || Object.keys(shape).some(key => !['type', 'properties', 'required', 'additionalProperties', 'items', 'minItems', 'maxItems', 'minLength', 'maxLength'].includes(key))) return false;
  if (shape.properties !== undefined && (!object(shape.properties) || Object.keys(shape.properties).length > 30 || !Object.values(shape.properties).every(child => validShape(child, depth + 1)))) return false;
  if (shape.required !== undefined && (!Array.isArray(shape.required) || shape.required.length > 30 || new Set(shape.required).size !== shape.required.length || shape.required.some(key => typeof key !== 'string' || !own(shape.properties || {}, key)))) return false;
  if (shape.additionalProperties !== undefined && typeof shape.additionalProperties !== 'boolean' || shape.items !== undefined && shape.items !== null && !validShape(shape.items, depth + 1)) return false;
  for (const [min, max, limit] of [['minItems', 'maxItems', 1000], ['minLength', 'maxLength', 2000]] as const) {
    for (const key of [min, max]) if (shape[key] !== undefined && (!Number.isInteger(shape[key]) || shape[key] < 0 || shape[key] > limit)) return false;
    if ((shape[min] ?? 0) > (shape[max] ?? limit)) return false;
  }
  return true;
}
function matches(value: unknown, shape: Shape): boolean {
  switch (shape.type) {
    case 'object': return object(value) && (shape.required || []).every(key => own(value, key)) && (shape.additionalProperties !== false || Object.keys(value).every(key => own(shape.properties || {}, key))) && Object.entries(shape.properties || {}).every(([key, child]) => !own(value, key) || matches(value[key], child));
    case 'array': return Array.isArray(value) && value.length >= (shape.minItems ?? 0) && value.length <= (shape.maxItems ?? 1000) && (!shape.items || value.every(item => matches(item, shape.items!)));
    case 'string': return typeof value === 'string' && Array.from(value).length >= (shape.minLength ?? 0) && Array.from(value).length <= (shape.maxLength ?? 2000);
    case 'number': return typeof value === 'number' && Number.isFinite(value);
    case 'integer': return typeof value === 'number' && Number.isSafeInteger(value);
    case 'boolean': return typeof value === 'boolean';
    case 'null': return value === null;
    default: return false;
  }
}
export function apiProfile(check: AutonomousCheck, project: QaProject): ApiProfile {
  let profile: ApiProfile;
  try { profile = JSON.parse(process.env.AUTONOMY_API_PROFILES || '{}')[check.profileHash || '']; } catch { throw new BadRequestException('Invalid API profile registry'); }
  const invalid = () => { throw new BadRequestException('API profile is not deployment-approved for this app'); };
  if (!profile || profile.projectId !== project.id || profile.environment !== project.environment || !['test', 'staging'].includes(project.environment) || !project.origins.includes(profile.origin) || typeof profile.targetRevision !== 'string' || !profile.targetRevision.length || profile.targetRevision.length > 200 || Boolean(profile.datasetProfileHash) !== Boolean(profile.datasetOrigin) || profile.datasetProfileHash && (!/^[a-f0-9]{64}$/.test(profile.datasetProfileHash) || profile.datasetOrigin !== profile.origin) || !Array.isArray(profile.steps) || !profile.steps.length || profile.steps.length > 6 || Buffer.byteLength(JSON.stringify(profile)) > 24000) return invalid();
  if (new Set(profile.steps.map(step => step?.id)).size !== profile.steps.length) return invalid();
  for (const step of profile.steps) {
    if (!step || !identity(step.id) || !Number.isInteger(step.expectedStatus) || step.expectedStatus < 200 || step.expectedStatus > 599 || step.expectedStatus >= 300 && step.expectedStatus < 400 || !Array.isArray(step.assertions) || step.assertions.length > 4 || new Set(step.assertions.map(item => item?.id)).size !== step.assertions.length) return invalid();
    for (const item of step.assertions) {
      if (!item || !identity(item.id) || typeof (item.pointer ?? '') !== 'string' || (item.pointer || '').length > 300 || item.pointer && !/^\/(?:[^~]|~[01])*$/.test(item.pointer) || own(item, 'expected') === Boolean(item.schema)) return invalid();
      if (item.schema ? !validShape(item.schema) : !boundedJson(item.expected) || Buffer.byteLength(JSON.stringify(item.expected)) > 2048) return invalid();
    }
  }
  return profile;
}

export function apiFlowResult(check: AutonomousCheck, profile: ApiProfile, observation: ApiFlowObservationDto, hasDataset: boolean) {
  const steps: Array<Record<string, unknown>> = [];
  let stopped = false;
  let invalid = observation.profileHash !== check.profileHash || observation.revisionBefore !== profile.targetRevision || observation.revisionAfter !== profile.targetRevision || Boolean(observation.error) || !/^[a-f0-9]{64}$/.test(observation.artifactHash) || hasDataset && observation.datasetCleanup !== 'clean' || observation.steps.length !== profile.steps.length;
  for (const [index, expected] of profile.steps.entries()) {
    const actual = observation.steps[index];
    if (!actual || actual.id !== expected.id) { invalid = true; continue; }
    if (stopped) {
      if (actual.error !== 'not_run' || actual.status !== 0 || actual.assertions.length) invalid = true;
      steps.push({ id: expected.id, status: 'not_run', assertions: [] });
      continue;
    }
    if (actual.error) { invalid = true; stopped = true; steps.push({ id: expected.id, status: 'error', assertions: [] }); continue; }
    if (actual.status < 200 || actual.status >= 300 && actual.status < 400 || actual.assertions.length !== expected.assertions.length) invalid = true;
    const assertions = expected.assertions.map((assertion, assertionIndex) => {
      const value = actual.assertions[assertionIndex];
      if (!value || value.id !== assertion.id || !boundedJson(value.actual) || Buffer.byteLength(JSON.stringify(value.actual)) > 2048) { invalid = true; return { id: assertion.id, passed: false }; }
      return { id: assertion.id, passed: value.present && (assertion.schema ? matches(value.actual, assertion.schema) : jsonEqual(value.actual, assertion.expected)), pointer: assertion.pointer || '', expectation: assertion.schema ? { schema: assertion.schema } : { expected: assertion.expected } };
    });
    const passed = actual.status === expected.expectedStatus && assertions.every(item => item.passed);
    stopped = !passed;
    steps.push({ id: expected.id, status: passed ? 'passed' : 'failed', expectedStatus: expected.expectedStatus, actualStatus: actual.status, assertions });
  }
  const status = invalid ? 'error' : steps.some(step => step.status === 'failed') ? 'failed' : 'passed';
  return { checkId: check.id, status, steps, observation, targetRevision: profile.targetRevision, classification: status === 'error' ? 'infrastructure_or_missing_evidence' : status === 'failed' ? 'assertion_mismatch' : 'verified' };
}
