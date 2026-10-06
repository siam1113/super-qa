import { BadRequestException } from '@nestjs/common';

export interface EvidenceScope { sourceIds: string[]; documentTypes?: string[] }

export function validateScope<Scope extends Partial<EvidenceScope>>(scope: Scope): asserts scope is Scope & EvidenceScope {
  const validList = (values: unknown): values is string[] => Array.isArray(values) && values.length > 0 && values.length <= 50 &&
    values.every(value => typeof value === 'string' && value.trim().length > 0 && value.length <= 200);
  if (!scope || !validList(scope.sourceIds) || (scope.documentTypes !== undefined && !validList(scope.documentTypes))) {
    throw new BadRequestException('Explicit nonempty sourceIds and valid optional documentTypes are required');
  }
}

export function validVector(vector: unknown): vector is number[] {
  return Array.isArray(vector) && vector.length > 0 && vector.length <= 32768 && vector.every(Number.isFinite) &&
    Number.isFinite(Math.hypot(...vector)) && Math.hypot(...vector) > 0;
}

export function cosineSimilarity(left: number[], right: number[]): number {
  if (!validVector(left) || !validVector(right) || left.length !== right.length) return -Infinity;
  const leftNorm = Math.hypot(...left);
  const rightNorm = Math.hypot(...right);
  return left.reduce((sum, value, index) => sum + (value / leftNorm) * (right[index] / rightNorm), 0);
}
