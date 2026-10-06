import { createHmac } from 'crypto';
import { AgentsService } from './agents.service';
import { ChatService } from '../chat/chat.service';

describe('agent workflow scope handoff', () => {
  const originalEnv = { ...process.env };
  afterEach(() => { jest.restoreAllMocks(); process.env = { ...originalEnv }; });

  it('signs scope together with the message and does not replace scope failures with fallback text', async () => {
    process.env.AGENT_MEMORY_SIGNING_KEY = 's'.repeat(32);
    const service = new AgentsService({} as never, {} as never);
    const scope = { projectId: 'project', canExecute: false };
    const fetcher = jest.spyOn(global, 'fetch').mockResolvedValue({ ok: true, json: async () => ({ response: 'done' }) } as Response);
    await service.chatWithMemories('qae', { message: 'Plan tests' }, [], scope);
    const request = fetcher.mock.calls[0][1]!;
    const body = JSON.parse(request.body as string);
    expect(body.workflowScope).toEqual(scope);
    const payload = { agentType: 'qae', sessionId: null, message: 'Plan tests', memories: [], workflowScope: scope };
    expect((request.headers as Record<string, string>)['X-Agent-Memory-Signature']).toBe(createHmac('sha256', 's'.repeat(32)).update(JSON.stringify(payload)).digest('hex'));
    fetcher.mockResolvedValue({ ok: false, status: 403 } as Response);
    await expect(service.chatWithMemories('qae', { message: 'Plan tests' }, [], scope)).rejects.toThrow('Start a new agent session');
  });

  it('requires a signing key even when the scoped request has no memories', async () => {
    delete process.env.AGENT_MEMORY_SIGNING_KEY;
    const service = new AgentsService({} as never, {} as never);
    await expect(service.chatWithMemories('qae', { message: 'Hello' }, [], { projectId: 'p', canExecute: true })).rejects.toThrow('signing');
  });

  it.each(['member', 'admin', 'owner'])('derives browser permission from the authenticated %s assignment', async role => {
    const agents = { chatWithMemories: jest.fn().mockResolvedValue({ response: 'done' }) };
    const chat = new ChatService({} as never, {} as never, agents as never, {} as never);
    const manager = { findOneBy: jest.fn().mockResolvedValue({ kind: 'qae' }) };
    jest.spyOn(chat, 'scopedRead').mockImplementation(async (_actor, action) => action(manager as never, {} as never, { role } as never));
    jest.spyOn(chat as any, 'selectAgentMemoryContext').mockResolvedValue([]);
    await chat.runAgentChat({ projectId: 'trusted-project', memberId: 'member', keyId: 'key' }, 'agent', { message: ' Plan tests ' });
    expect(agents.chatWithMemories).toHaveBeenCalledWith('qae', { message: 'Plan tests', sessionId: undefined }, [],
      { projectId: 'trusted-project', canExecute: role !== 'member' });
  });
});
