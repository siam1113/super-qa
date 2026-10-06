export const AGENT_AVATARS = [
  { id: 'fox', label: 'Fox', emoji: '🦊', color: 'bg-orange-500/15' },
  { id: 'panda', label: 'Panda', emoji: '🐼', color: 'bg-slate-500/15' },
  { id: 'koala', label: 'Koala', emoji: '🐨', color: 'bg-stone-500/15' },
  { id: 'frog', label: 'Frog', emoji: '🐸', color: 'bg-green-500/15' },
  { id: 'penguin', label: 'Penguin', emoji: '🐧', color: 'bg-sky-500/15' },
  { id: 'owl', label: 'Owl', emoji: '🦉', color: 'bg-amber-500/15' },
  { id: 'tiger', label: 'Tiger', emoji: '🐯', color: 'bg-orange-500/15' },
  { id: 'octopus', label: 'Octopus', emoji: '🐙', color: 'bg-fuchsia-500/15' },
  { id: 'whale', label: 'Whale', emoji: '🐳', color: 'bg-cyan-500/15' },
  { id: 'butterfly', label: 'Butterfly', emoji: '🦋', color: 'bg-violet-500/15' },
  { id: 'turtle', label: 'Turtle', emoji: '🐢', color: 'bg-emerald-500/15' },
  { id: 'unicorn', label: 'Unicorn', emoji: '🦄', color: 'bg-pink-500/15' },
] as const;

export type AgentAvatar = (typeof AGENT_AVATARS)[number]['id'];

export function getAgentAvatar(avatar: string | null | undefined) {
  return AGENT_AVATARS.find(option => option.id === avatar);
}
