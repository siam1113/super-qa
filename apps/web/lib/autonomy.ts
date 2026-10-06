export type ProjectSettings = {
  project: { id: string; name: string; workspaceId: string; applicationId: string; environment: string; paused: boolean; dailyRunLimit: number; origins: string[]; targets: string[]; requirements: string[] };
  identity: { id: string; role: string; expiresAt: string };
  credentials: Array<{ id: string; role: string; label: string; expiresAt: string; revoked: boolean }>;
  liveProfiles: Array<{ hash: string; origin: string; environment: string; assertions: string[] }>;
};

export type ScopedSuite = { id: string; name: string; manifestHash: string; approvedBy: string | null; checks: Array<Record<string, unknown>> };
export type BenchmarkSummary = { id: string; name: string; kind: string; approvedBy: string | null; paused: boolean };
export type Benchmark = Omit<BenchmarkSummary, 'name' | 'kind'> & {
  status: string;
  corpus: { name: string; kind: string; samples: Array<Record<string, unknown>> };
  corpusHash: string;
  report: { samples: number; completed: number; falsePasses: number; missedDefects: number; falseFailures: number; abstentions: number; gatePassed: boolean; rolloutGatePassed: boolean; unstableSamples: string[]; limitations: string[] };
  trials: Array<{ sampleId: string; repetition: number; run: { id: string; status: string } | null }>;
};

export class ScopedError extends Error {
  constructor(public status: number) {
    super(status === 401 ? 'Credential expired, revoked or invalid. Reconnect with a valid app key.' : status === 403 ? 'Your role cannot perform this action.' : status === 409 ? 'Action blocked. Check approvals, app pause and daily quota before retrying.' : status === 400 ? 'Invalid input or unapproved policy. Check the reviewed manifest and required fields.' : 'Control-plane request failed. No success is assumed; refresh before retrying.');
  }
}

export async function scopedRequest<Value>(key: string, path: string, body?: unknown, signal?: AbortSignal): Promise<Value> {
  const response = await fetch('/api/autonomy' + path, { method: body === undefined ? 'GET' : 'POST', headers: { ...(key ? { Authorization: 'Bearer ' + key } : {}), 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body), cache: 'no-store', credentials: 'same-origin', signal });
  if (!response.ok) throw new ScopedError(response.status);
  const result = await response.json();
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  return result;
}
