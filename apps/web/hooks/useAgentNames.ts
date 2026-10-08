'use client';

import { useEffect, useState } from 'react';
import { chatRequest, type ChatAgent, type Directory } from '@/lib/chat';

export type AgentNameProfile = { name: string; avatar: string | null };
export type AgentNameProfiles = Record<'qae' | 'aue', AgentNameProfile>;

const DEFAULT_PROFILES: AgentNameProfiles = {
  qae: { name: 'QAE', avatar: null },
  aue: { name: 'AUE', avatar: null },
};

// Module-scoped so every mounted consumer shares one /directory fetch and stays in
// sync: a rename on the Agents page dispatches 'agent-profile-updated', which updates
// this cache immediately, so surfaces that mount later (new page, new modal) never
// read a stale pre-rename name back out of an already-resolved fetch.
let cachedProfiles: AgentNameProfiles = DEFAULT_PROFILES;
let directoryPromise: Promise<void> | null = null;
const listeners = new Set<(profiles: AgentNameProfiles) => void>();

function applyAgent(agent: ChatAgent) {
  if (agent.kind !== 'qae' && agent.kind !== 'aue') return;
  cachedProfiles = { ...cachedProfiles, [agent.kind]: { name: agent.name, avatar: agent.avatar } };
  listeners.forEach(listener => listener(cachedProfiles));
}

function ensureDirectoryLoaded(): Promise<void> {
  if (!directoryPromise) {
    directoryPromise = chatRequest<Directory>('/directory')
      .then(directory => { directory.agents.forEach(applyAgent); })
      .catch(() => { directoryPromise = null; });
  }
  return directoryPromise;
}

if (typeof window !== 'undefined') {
  window.addEventListener('agent-profile-updated', event => applyAgent((event as CustomEvent<ChatAgent>).detail));
}

/** The user can rename their QAE/AUE agent (see Agents.tsx's rename UI); every
 * surface that mentions the agent by name should show that custom name instead of
 * the generic "QAE"/"AUE" label. Falls back to the generic label until the
 * directory loads or if the agent was never renamed. */
export function useAgentNames(): AgentNameProfiles {
  const [profiles, setProfiles] = useState(cachedProfiles);
  useEffect(() => {
    listeners.add(setProfiles);
    void ensureDirectoryLoaded();
    return () => { listeners.delete(setProfiles); };
  }, []);
  return profiles;
}
