import type { TestCase } from './types';

const API_BASE = `${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000'}/api/qa`;

export const PRIORITIES = ['P0', 'P1', 'P2', 'P3'] as const;
export const AUTOMATION_TYPES = ['automated', 'partial', 'manual'] as const;
export const RISK_LEVELS = ['low', 'medium', 'high', 'critical'] as const;
export const STATUSES = ['draft', 'ready', 'approved', 'rejected'] as const;
export const CATEGORIES = ['smoke', 'regression', 'sanity', 'functional', 'integration', 'exploratory', 'performance', 'security', 'acceptance'] as const;
export const TECHNIQUES = ['boundary-value', 'equivalence-partitioning', 'decision-table', 'state-transition', 'exploratory', 'error-guessing', 'pairwise', 'use-case'] as const;
export const SEVERITIES = ['blocker', 'critical', 'major', 'minor', 'trivial'] as const;
export const PLATFORMS = ['web', 'mobile', 'desktop', 'api', 'backend'] as const;

export function labelFor(value: string) {
  return value.split('-').map(part => part[0].toUpperCase() + part.slice(1)).join(' ');
}

export type SaveOverrides = Partial<Pick<TestCase,
  'title' | 'priority' | 'owner' | 'flow' | 'risk' | 'automation' | 'tags' | 'steps' | 'preconditions' |
  'reviewStatus' | 'category' | 'technique' | 'severity' | 'platform' | 'baseUrl'
>>;

export async function saveTestCase(testCase: TestCase, overrides: SaveOverrides): Promise<TestCase> {
  const risk = overrides.risk !== undefined ? overrides.risk : testCase.risk;
  const payload: Record<string, unknown> = {
    title: overrides.title ?? testCase.title,
    priority: overrides.priority ?? testCase.priority,
    owner: overrides.owner ?? testCase.owner,
    flow: overrides.flow ?? testCase.flow,
    automation: overrides.automation ?? testCase.automation,
    tags: overrides.tags ?? testCase.tags,
    steps: overrides.steps ?? testCase.steps ?? [],
    preconditions: overrides.preconditions ?? testCase.preconditions ?? [],
    reviewStatus: overrides.reviewStatus !== undefined ? overrides.reviewStatus : testCase.reviewStatus,
    category: overrides.category !== undefined ? overrides.category : testCase.category,
    technique: overrides.technique !== undefined ? overrides.technique : testCase.technique,
    severity: overrides.severity !== undefined ? overrides.severity : testCase.severity,
    platform: overrides.platform !== undefined ? overrides.platform : testCase.platform,
    baseUrl: overrides.baseUrl !== undefined ? overrides.baseUrl : testCase.baseUrl,
    revision: testCase.revision ?? 1,
  };
  if (risk && risk !== 'unknown') payload.risk = risk;

  const url = `${API_BASE}/test-cases/${testCase.id}/update`;
  const startedAt = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  let response: Response;
  try {
    // POST, not PUT: some browser extensions/security proxies intercept or silently stall PUT requests.
    console.debug('[saveTestCase] →', { url, payload });
    response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    console.debug('[saveTestCase] ←', { url, status: response.status, elapsedMs: Date.now() - startedAt });
  } catch (error) {
    const elapsedMs = Date.now() - startedAt;
    console.error('[saveTestCase] fetch failed', { url, elapsedMs, error });
    if (error instanceof DOMException && error.name === 'AbortError') throw new Error(`Save timed out after ${elapsedMs}ms (POST ${url})`);
    const detail = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    throw new Error(`Network error after ${elapsedMs}ms calling POST ${url} — ${detail}`);
  } finally {
    clearTimeout(timeout);
  }
  const result = await response.json();
  if (!response.ok) throw new Error(result.message || 'Failed to save changes');
  return { ...testCase, ...result, risk: result.risk || testCase.risk || 'unknown' };
}
