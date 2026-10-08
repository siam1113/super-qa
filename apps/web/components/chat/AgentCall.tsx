'use client';

import { useEffect, useState } from 'react';
import { CallSkeleton, ChatDialog, secondaryClass } from './ChatDialog';
import { Meetings } from './Meetings';
import { Conversation, Directory, chatRequest } from '@/lib/chat';
import { useAgentNames } from '@/hooks/useAgentNames';

export function AgentCall({ kind, onClose }: { kind: 'qae' | 'aue' | 'superqa'; onClose: () => void }) {
  const [data, setData] = useState<{ directory: Directory; conversation: Conversation } | null>(null);
  const [error, setError] = useState('');
  const externalStart = kind === 'superqa';
  const agentNames = useAgentNames();
  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const [directory, conversations] = await Promise.all([chatRequest<Directory>('/directory'), chatRequest<Conversation[]>('/conversations')]);
        const agent = directory.agents.find(item => item.kind === kind && item.enabled);
        if (!agent) throw new Error(kind === 'superqa' ? 'Super QA is not enabled for your app.' : `This ${agentNames[kind].name} is not enabled for your app.`);
        const conversation = conversations.find(item => item.kind === 'direct' && item.agentId === agent.id) || await chatRequest<Conversation>('/conversations', { kind: 'direct', title: agent.name, memberIds: [], agentId: agent.id, instructions: '' });
        if (active) setData({ directory, conversation });
      } catch (failure) { if (active) setError((failure as Error).message); }
    })();
    return () => { active = false; };
  }, [kind, agentNames]);

  if (data) return <Meetings conversation={data.conversation} directory={data.directory} onClose={onClose} startImmediately={!externalStart} externalStart={externalStart} callOnly={!externalStart} />;
  return <ChatDialog title={kind === 'superqa' ? 'Join a call with Super QA' : `Call ${agentNames[kind].name}`} onClose={onClose}>
    {error ? <><p role="alert" className="text-sm text-danger">{error}</p><button className={secondaryClass} onClick={onClose}>Close</button></> : <CallSkeleton label="Opening your secure agent call…" />}
  </ChatDialog>;
}
