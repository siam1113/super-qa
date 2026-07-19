import type { WorkspaceSeed } from './types';
import { seedWorkspace } from './seed-data';
import { apiGet } from './api-client';
type WorkspaceEnvelope = { data: Partial<WorkspaceSeed>; meta: { requestId:string; generatedAt:string; workspaceId:string; permissions:string[] } };
export async function loadWorkspace(): Promise<WorkspaceSeed & { source: 'api' | 'seed' }> {
  try {
    const envelope = await apiGet<WorkspaceEnvelope>('/qa/workspace');
    return { ...seedWorkspace, ...envelope.data, source: 'api' };
  } catch {
    return { ...seedWorkspace, source: 'seed' };
  }
}
