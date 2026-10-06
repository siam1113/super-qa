export type ChatAgent = { id: string; kind: 'qae' | 'aue'; name: string; avatar: string | null; aliases: string[]; enabled: boolean };
export type AgentMemoryCategory = 'preference' | 'decision' | 'workflow' | 'constraint';
export type AgentMemory = { id: string; category: AgentMemoryCategory; content: string; importance: number; status: 'active' | 'archived'; version: number; expiresAt: string | null; lastUsedAt: string | null; createdAt: string; updatedAt: string };
export type AgentMemoryContext = { memories: Array<Pick<AgentMemory, 'id' | 'category' | 'content' | 'importance' | 'version'>> };
export type AgentMemoryRevision = { id: string; version: number; change: 'created' | 'updated' | 'archived' | 'restored'; category: AgentMemoryCategory; content: string; importance: number; actor: string; createdAt: string };
export type PromptScenario = 'conversation' | 'meeting';
export type Prompt = { id: string; name: string; content: string; createdAt: string; updatedAt: string };
export type PromptInstall = { agentId: string; scenario: PromptScenario; promptId: string };
export type ChatMember = { id: string; email: string };
export type Directory = { me: ChatMember & { role: string }; members: ChatMember[]; agents: ChatAgent[]; modelConfigured: boolean };
export type AgentModelSelection = { provider: 'openai' | 'anthropic' | 'ollama'; model: string };
export type AgentRuntimeSettings = {
  agentType: string;
  skills: Array<{ name: string; description: string; modelPolicy: string; toolNames: string[] }>;
  tools: Array<{ name: string; description: string; access: 'agent' | 'workflow'; usedBy: string[] }>;
  defaultModel: AgentModelSelection;
  effectiveModel: AgentModelSelection;
  modelSelection: AgentModelSelection | null;
  providers: Array<{ id: AgentModelSelection['provider']; models: string[]; error: string | null }>;
  defaultMaxIterations: number;
  minMaxIterations: number;
  maxMaxIterations: number;
  maxIterations: number | null;
  effectiveMaxIterations: number;
  defaultTemperature: number;
  minTemperature: number;
  maxTemperature: number;
  temperature: number | null;
  effectiveTemperature: number;
};
export type Conversation = { id: string; title: string; kind: 'direct' | 'group' | 'external'; memberIds: string[]; agentId: string | null; agentIds?: string[]; agentInstructions?: Record<string, string>; provider?: 'slack' | 'teams' | null; createdBy: string; instructions: string; archived: boolean; updatedAt: string };
export type Message = { id: string; sequence: number; authorId: string; authorName: string; authorKind: string; text: string; replyToId: string | null; meetingContextId: string | null; status: string; error: string | null; createdAt: string; content: { summary: string; details: string[]; task: { title: string; description: string } | null } | null };
export type ChatTask = { id: string; messageId: string; title: string; description: string; status: string };
export type ConversationDetail = { conversation: Conversation; messages: Message[]; tasks: ChatTask[]; hasMore: boolean; deliveries: { messageId: string; status: string }[] };
export type Installation = { id: string; name: string; provider: 'slack' | 'teams'; providerId: string; botId: string; agentId: string | null; agentIds: string[]; accessMode: 'read_only' | 'read_reply'; enabled: boolean; createdAt: string; webhookPath: string; channels: { externalId: string; name: string; enabled?: boolean }[] };

export class ChatError extends Error { constructor(public status: number, message: string) { super(message); } }
async function chatCall<Value>(path: string, method: string, body?: unknown, signal?: AbortSignal): Promise<Value> {
  let response: Response;
  try { response = await fetch('/api/chat' + path, { method, headers: body === undefined ? undefined : { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body), credentials: 'same-origin', cache: 'no-store', signal }); }
  catch (failure) { if (signal?.aborted) throw failure; throw new ChatError(0, chatConnectionError(path)); }
  const service = chatRequestService(path);
  const responseText = await response.text();
  let data: unknown;
  try { data = responseText ? JSON.parse(responseText) as unknown : null; }
  catch { throw new ChatError(response.status, `${service} returned an unreadable response (HTTP ${response.status}). Check your connection and try again.`); }
  const message = data && typeof data === 'object' && 'message' in data ? (data as { message?: unknown }).message : undefined;
  if (!response.ok) throw new ChatError(response.status, response.status === 401 ? 'Sign in with an app account to continue.' : Array.isArray(message) ? message.join('. ') : typeof message === 'string' ? message : service + ' request failed');
  if (data === null) throw new ChatError(response.status, service + ' returned an empty response. Check the web and API services.');
  return data as Value;
}
export function chatRequest<Value>(path: string, body?: unknown, signal?: AbortSignal): Promise<Value> { return chatCall<Value>(path, body === undefined ? 'GET' : 'POST', body, signal); }
export function chatMutation<Value>(path: string, method: 'PATCH' | 'DELETE' | 'POST', body?: unknown): Promise<Value> { return chatCall<Value>(path, method, body); }

// One line per server-sent event from an agent streaming chat turn. "token" chunks
// arrive as real per-token deltas when the underlying model supports streaming, or as
// a single chunk with the whole reply when it doesn't; callers should append either way.
export type ChatStreamEvent =
  | { type: 'tool_call'; id: string; name: string; args: Record<string, unknown> }
  | { type: 'tool_result'; id: string; name: string | null; content: string; status: 'completed' | 'error' }
  | { type: 'token'; content: string }
  // A short "what's happening now" narration from a graph node or skill subgraph step.
  // Transient — callers should overwrite rather than append, and clear it once real
  // content or the next tool call arrives.
  | { type: 'status'; label: string; skill?: string; node?: string }
  | { type: 'done'; sessionId: string; messageId: string; response: string; toolCalls?: unknown }
  | { type: 'error'; message: string }
  // Dispatched by a browser-driving tool (e.g. execute_test_case) the moment its
  // execution starts, well before the tool call itself resolves. Not tied to a
  // specific tool_call id, so callers match it to the most recent running browser tool.
  | { type: 'live_run_started'; runId: string; testId: string; testName: string };

export async function chatStream(path: string, body: unknown, onEvent: (event: ChatStreamEvent) => void, signal?: AbortSignal): Promise<void> {
  let response: Response;
  try { response = await fetch('/api/chat' + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), credentials: 'same-origin', cache: 'no-store', signal }); }
  catch (failure) { if (signal?.aborted) throw failure; throw new ChatError(0, chatConnectionError(path)); }
  const service = chatRequestService(path);
  if (!response.ok || !response.body) {
    let message: unknown;
    try { message = (JSON.parse(await response.text()) as { message?: unknown }).message; } catch { /* non-JSON error body */ }
    throw new ChatError(response.status, response.status === 401 ? 'Sign in with an app account to continue.' : Array.isArray(message) ? message.join('. ') : typeof message === 'string' ? message : service + ' request failed');
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let boundary: number;
      while ((boundary = buffer.indexOf('\n\n')) !== -1) {
        const line = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        if (!line.startsWith('data: ')) continue;
        let event: ChatStreamEvent;
        try { event = JSON.parse(line.slice(6)) as ChatStreamEvent; } catch { continue; /* skip a malformed event */ }
        onEvent(event);
      }
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
}
import { chatConnectionError, chatRequestService } from './chat-errors';
