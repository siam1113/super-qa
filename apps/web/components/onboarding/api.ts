export const API = `${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000'}/api`;

export async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API}${path}`, { ...init, headers: { 'Content-Type': 'application/json', ...init?.headers } });
  if (!response.ok) { const detail = await response.json().catch(() => null); throw new Error(detail?.message || `Request failed (${response.status})`); }
  if (response.status === 204) return undefined as T;
  return response.json();
}

export type OnboardingTestCase = { id: string; title: string; revision: number; steps: { action: string; expected: string }[] };
export type OnboardingExecutionResult = { testCaseId: string; status: 'running' | 'passed' | 'failed' | 'error'; detail?: string };
