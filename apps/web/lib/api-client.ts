const baseUrl = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:4000/api';
export async function apiGet<T>(path: string): Promise<T> {
  const response = await fetch(`${baseUrl}${path}`, { next: { revalidate: 30 } });
  if (!response.ok) throw new Error(`API request failed: ${response.status}`);
  return response.json() as Promise<T>;
}
export const apiPlaceholders = {
  dashboard: '/qa/dashboard', executions: '/qa/executions', testCases: '/qa/test-cases', flows: '/qa/flows', facts: '/qa/facts', actions: '/qa/actions', dom: '/qa/dom-snapshots', dataSetup: '/qa/data-setup', agents: '/agents', integrations: '/integrations'
};
