'use client';

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { cn } from '@/lib/utils';
import type { AgentType, AgentStatus, AgentMessage, AgentSession, AgentToolCall, AgentTask } from '@/lib/types';
import { OPENAI_LIVE_VOICES, OPENAI_LIVE_VOICE_GENDER } from '@/lib/live-voice';
import {
  Send,
  RotateCcw,
  Settings,
  Loader2,
  Bot,
  Brain,
  Wrench,
  CheckCircle,
  XCircle,
  ChevronDown,
  Menu,
  Search,
  Code,
  FileText,
  TestTube,
  Bug,
  Sparkles,
  Copy,
  Check,
  ListTodo,
  History,
  Plus,
  Info,
  X,
  Zap,
  PlayCircle,
  FileBarChart,
  BookOpen,
  Wand2,
  UserRound,
  AudioLines,
  Terminal,
  Cpu,
  Gauge,
  MessageSquare,
  Users,
  HelpCircle,
  Flag,
  ShieldAlert,
} from 'lucide-react';
import { TaskBoard } from '@/components/TaskBoard';
import { TaskModal } from '@/components/TaskModal';
import { AgentRuntimeSettings } from '@/components/AgentRuntimeSettings';
import { WorkflowArtifacts } from '@/components/WorkflowArtifacts';
import { OutpostPanel } from '@/components/OutpostPanel';
import { AgentMemory, AgentMemoryCategory, AgentMemoryRevision, ChatAgent, ChatStreamEvent, Directory, Prompt, PromptInstall, PromptScenario, chatMutation, chatRequest, chatStream } from '@/lib/chat';
import { AGENT_AVATARS, getAgentAvatar, type AgentAvatar } from '@/lib/agent-avatars';
import { Meeting, MeetingDetail, estimateTokenCount } from '@/lib/meetings';
import { MeetingFeed, MeetingTiming } from '@/lib/calendar';
import { MeetingAttachmentChip } from '@/components/chat/MeetingAttachmentChip';
import { MeetingDetailsModal, dateTime, durationLabel } from './MeetingHistory';
import { MarkdownOutput, ToolCallDisplay } from '@/components/chat/MarkdownOutput';
import { LiveExecutionViewer } from '@/components/execution/LiveExecutionViewer';

const API_BASE = 'http://localhost:4000';

function isMemoryExpired(memory: AgentMemory) {
  return Boolean(memory.expiresAt && new Date(memory.expiresAt).getTime() <= Date.now());
}

// Agent configurations
const AGENT_CONFIGS: Record<AgentType, {
  name: string;
  shortName: string;
  tagline: string;
  description: string;
  icon: React.ReactNode;
  color: string;
  bgColor: string;
  placeholder: string;
  capabilities: Array<{ label: string; icon: React.ReactNode; description: string }>;
}> = {
  qae: {
    name: 'QA Engineer',
    shortName: 'QAE',
    tagline: 'Your intelligent QA companion',
    description: 'Comprehensive test planning, execution, and analysis powered by AI',
    icon: <TestTube size={20} />,
    color: 'text-accent-blue',
    bgColor: 'bg-accent-blue',
    placeholder: 'Ask me to write test cases, analyze bugs, or review user stories...',
    capabilities: [
      { label: 'Write Test Cases', icon: <FileText size={16} />, description: 'Generate comprehensive test cases from requirements and user stories' },
      { label: 'Execute Test Cases', icon: <PlayCircle size={16} />, description: 'Run individual test cases and record results' },
      { label: 'Execute Test Suite', icon: <Zap size={16} />, description: 'Run complete test suites with progress tracking' },
      { label: 'Generate Reports', icon: <FileBarChart size={16} />, description: 'Create detailed test execution and coverage reports' },
      { label: 'Bug Analysis', icon: <Bug size={16} />, description: 'Analyze bugs, identify root causes, and suggest fixes' },
      { label: 'Test User Stories', icon: <BookOpen size={16} />, description: 'Review and test user stories and tickets' },
    ],
  },
  aue: {
    name: 'Automation Engineer',
    shortName: 'AUE',
    tagline: 'Your automation expert',
    description: 'Script generation, test execution, and self-healing capabilities powered by AI',
    icon: <Bot size={20} />,
    color: 'text-accent-purple',
    bgColor: 'bg-accent-purple',
    placeholder: 'Ask me to generate scripts, run automation tests, or heal failing locators...',
    capabilities: [
      { label: 'Generate Test Scripts', icon: <Code size={16} />, description: 'Create automation scripts in Playwright, Cypress, or Selenium' },
      { label: 'Run Automation Tests', icon: <PlayCircle size={16} />, description: 'Execute automated test suites with real-time monitoring' },
      { label: 'Report Analysis', icon: <FileBarChart size={16} />, description: 'Analyze test results and identify failure patterns' },
      { label: 'Healer', icon: <Wand2 size={16} />, description: 'Auto-heal broken locators and fix flaky tests' },
    ],
  },
  superqa: {
    name: 'Super QA',
    shortName: 'SQA',
    tagline: 'Your all-powerful platform assistant',
    description: 'Manage tasks, trigger agents, sync sources, and control environments',
    icon: <Sparkles size={20} />,
    color: 'text-warning',
    bgColor: 'bg-warning',
    placeholder: 'Ask me anything - I can control the entire platform...',
    capabilities: [
      { label: 'Manage Tasks', icon: <ListTodo size={16} />, description: 'Create and manage tasks for QAE and AUE agents' },
      { label: 'Trigger Agents', icon: <Zap size={16} />, description: 'Start QAE or AUE agents for specific tasks' },
      { label: 'Sync Sources', icon: <RotateCcw size={16} />, description: 'Start and monitor source sync jobs' },
      { label: 'Manage Environments', icon: <Settings size={16} />, description: 'Configure environments and variables' },
      { label: 'Search Knowledge', icon: <Search size={16} />, description: 'Search the business knowledge base' },
      { label: 'Platform Stats', icon: <FileBarChart size={16} />, description: 'View platform statistics and metrics' },
    ],
  },
};

// ToolCallDisplay, MarkdownOutput and friends moved to components/chat/MarkdownOutput.tsx for reuse

function MessageBubble({ message, onOpenMeeting, onWatchLive }: { message: AgentMessage; onOpenMeeting?: (id: string) => void; onWatchLive?: (runId: string, testName: string) => void }) {
  const [copied, setCopied] = useState(false);
  const isUser = message.role === 'user';
  const isSystem = message.role === 'system';

  const handleCopy = () => {
    navigator.clipboard.writeText(message.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (isSystem) {
    return (
      <div className="mx-auto my-3 w-full max-w-4xl border-l-2 border-danger bg-danger/5 px-4 py-3 font-mono text-xs leading-6 text-danger">
        <span className="mr-2">stderr</span>{message.content}
      </div>
    );
  }

  return (
    <article className="mx-auto w-full max-w-4xl border-b border-border py-4 last:border-b-0">
      <div className="mb-2 flex items-center gap-2 font-mono text-[11px]">
        <span className={isUser ? 'text-success' : 'text-info'}>{isUser ? 'instruction' : message.role === 'tool' ? 'tool output' : 'stdout'}</span>
        <time className="text-text-secondary">{new Date(message.timestamp).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</time>
        {!isUser && <button onClick={handleCopy} className="ml-auto rounded px-1.5 py-1 text-text-secondary hover:bg-elevated hover:text-text-primary" title="Copy output">{copied ? <Check size={12} className="text-success" /> : <Copy size={12} />}</button>}
      </div>
      <div className={cn('break-words font-mono text-[13px] leading-6', isUser ? 'text-text-primary' : 'border-l border-border pl-3 text-text-primary')}>
        {isUser && <span className="mr-2 text-success">›</span>}
        {isUser ? (
          <span className="whitespace-pre-wrap">{message.content}</span>
        ) : (
          <>
            {message.timeline && message.timeline.length > 0
              ? message.timeline.map((entry, index) => {
                  if (entry.kind === 'tool') {
                    const toolCall = message.toolCalls?.find((tc) => tc.id === entry.id);
                    return toolCall ? <ToolCallDisplay key={entry.id} toolCall={toolCall} onWatchLive={onWatchLive} /> : null;
                  }
                  const isActive = !message.content && index === message.timeline!.length - 1;
                  return (
                    <p key={entry.id} className="mb-1 flex items-center gap-1.5 text-[12px] text-text-secondary">
                      {isActive ? <Loader2 size={11} className="animate-spin" /> : <span className="inline-block h-1 w-1 rounded-full bg-text-secondary/50" />}
                      {entry.label}
                    </p>
                  );
                })
              : message.toolCalls?.map((tc) => <ToolCallDisplay key={tc.id} toolCall={tc} onWatchLive={onWatchLive} />)}
            <MarkdownOutput content={message.content} />
          </>
        )}
      </div>
      {message.meetingAttachment && <div className="mt-2"><MeetingAttachmentChip title={message.meetingAttachment.title} wordCount={message.meetingAttachment.wordCount} tokenCount={message.meetingAttachment.tokenCount} onOpen={() => onOpenMeeting?.(message.meetingAttachment!.meetingId)} /></div>}
    </article>
  );
}

function QuickAction({ label, command, icon, active = false, id, onClick }: { label: string; command: string; icon: React.ReactNode; active?: boolean; id?: string; onClick: () => void }) {
  return (
    <button
      id={id}
      role="option"
      aria-selected={active}
      onClick={onClick}
      title={'Insert ' + label + ' command'}
      className={cn('flex w-full items-center gap-3 rounded-md px-3 py-2 text-left font-mono text-xs text-text-primary transition-colors hover:bg-elevated/50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent-blue', active && 'bg-elevated/50')}
    >
      <span className="text-success">$</span>
      <span className="min-w-0 flex-1 truncate text-accent-blue">{command}</span>
      <span className="truncate font-sans text-text-secondary">{label}</span>
      <span className="text-accent-purple">{icon}</span>
    </button>
  );
}

function SettingsModal({
  isOpen,
  onClose,
  config,
  agentType,
  onAgentSaved,
}: {
  isOpen: boolean;
  onClose: () => void;
  config: typeof AGENT_CONFIGS[AgentType];
  agentType: AgentType;
  onAgentSaved: (agent: ChatAgent) => void;
}) {
  const sections = [
    { id: 'profile', label: 'Profile', icon: <UserRound size={17} /> },
    { id: 'memory', label: 'Memory', icon: <Brain size={17} /> },
    { id: 'voice', label: 'Voice', icon: <AudioLines size={17} /> },
    { id: 'prompts', label: 'Prompts', icon: <FileText size={17} /> },
    { id: 'skills', label: 'Skills', icon: <Sparkles size={17} /> },
    { id: 'tools', label: 'Tools', icon: <Wrench size={17} /> },
    { id: 'model', label: 'Model', icon: <Cpu size={17} /> },
    { id: 'budget', label: 'Reasoning Budget', icon: <Gauge size={17} /> },
  ];
  const [section, setSection] = useState('profile');
  const [directory, setDirectory] = useState<Directory | null>(null);
  const [name, setName] = useState('');
  const [avatar, setAvatar] = useState<AgentAvatar | null>(null);
  const [aliases, setAliases] = useState<string[]>([]);
  const [aliasInput, setAliasInput] = useState('');
  const [voiceName, setVoiceName] = useState('marin');
  const [selectedVoice, setSelectedVoice] = useState('marin');
  const [voicePreviewBusy, setVoicePreviewBusy] = useState(false);
  const [voicePlaying, setVoicePlaying] = useState(false);
  const voicePreviewAudioRef = useRef<HTMLAudioElement | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [memories, setMemories] = useState<AgentMemory[]>([]);
  const [memoryLoading, setMemoryLoading] = useState(false);
  const [memoryBusy, setMemoryBusy] = useState(false);
  const [memoryCategory, setMemoryCategory] = useState<AgentMemoryCategory>('preference');
  const [memoryContent, setMemoryContent] = useState('');
  const [memoryImportance, setMemoryImportance] = useState(3);
  const [memoryExpiry, setMemoryExpiry] = useState('');
  const [editingMemoryId, setEditingMemoryId] = useState<string | null>(null);
  const [showArchivedMemories, setShowArchivedMemories] = useState(false);
  const [historyMemoryId, setHistoryMemoryId] = useState<string | null>(null);
  const [memoryRevisions, setMemoryRevisions] = useState<AgentMemoryRevision[]>([]);
  const [prompts, setPrompts] = useState<Prompt[]>([]);
  const [promptInstalls, setPromptInstalls] = useState<PromptInstall[]>([]);
  const [promptsLoading, setPromptsLoading] = useState(false);
  const [promptBusy, setPromptBusy] = useState(false);
  const [promptName, setPromptName] = useState('');
  const [promptContent, setPromptContent] = useState('');
  const [editingPromptId, setEditingPromptId] = useState<string | null>(null);
  const agent = directory?.agents.find(item => item.kind === agentType);

  useEffect(() => {
    if (!isOpen) return;
    let active = true;
    setError(''); setNotice(''); setSection('profile');
    chatRequest<Directory>('/directory').then(value => {
      if (!active) return;
      setDirectory(value);
      const selected = value.agents.find(item => item.kind === agentType);
      if (selected) {
        setName(selected.name);
        setAvatar((selected.avatar as AgentAvatar | null) || null);
        setAliases(selected.aliases || []); setAliasInput('');
        setMemoryLoading(true);
        chatRequest<{ memories: AgentMemory[] }>('/agents/' + selected.id + '/memories?includeArchived=true').then(result => {
          if (active) setMemories(result.memories);
        }).catch(failure => {
          if (active) setError((failure as Error).message);
        }).finally(() => { if (active) setMemoryLoading(false); });
      } else {
        setMemories([]);
      }
      try {
        const storedVoice = window.localStorage.getItem('agent-voice-' + agentType) || '';
        const resolved = OPENAI_LIVE_VOICES.includes(storedVoice as typeof OPENAI_LIVE_VOICES[number]) ? storedVoice : 'marin';
        setVoiceName(resolved); setSelectedVoice(resolved);
      } catch { setVoiceName('marin'); setSelectedVoice('marin'); }
      setPromptsLoading(true);
      chatRequest<{ prompts: Prompt[]; installs: PromptInstall[] }>('/prompts').then(result => {
        if (!active) return;
        setPrompts(result.prompts); setPromptInstalls(result.installs);
      }).catch(failure => {
        if (active) setError((failure as Error).message);
      }).finally(() => { if (active) setPromptsLoading(false); });
    }).catch(failure => { if (active) setError((failure as Error).message); });
    return () => { active = false; };
  }, [isOpen, agentType]);

  async function saveName(event: React.FormEvent) {
    event.preventDefault();
    if (!agent) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const saved = await chatRequest<ChatAgent>('/agents/' + agent.id, { name, avatar, aliases });
      setDirectory(previous => previous ? { ...previous, agents: previous.agents.map(item => item.id === saved.id ? saved : item) } : previous);
      onAgentSaved(saved);
      window.dispatchEvent(new CustomEvent<ChatAgent>('agent-profile-updated', { detail: saved }));
      setNotice('Agent profile saved.');
    } catch (failure) { setError((failure as Error).message); } finally { setBusy(false); }
  }

  function addAlias() {
    const value = aliasInput.trim();
    if (value && !aliases.some(alias => alias.toLowerCase() === value.toLowerCase())) setAliases(current => [...current, value]);
    setAliasInput('');
  }

  function saveVoice() {
    try { window.localStorage.setItem('agent-voice-' + agentType, selectedVoice); setVoiceName(selectedVoice); setNotice('Voice preference saved in this browser.'); setError(''); }
    catch { setError('This browser could not save the voice preference.'); }
  }

  useEffect(() => { if (!isOpen) voicePreviewAudioRef.current?.pause(); }, [isOpen]);
  useEffect(() => () => { voicePreviewAudioRef.current?.pause(); }, []);

  async function playVoicePreview() {
    if (!agent || voicePreviewBusy) return;
    voicePreviewAudioRef.current?.pause();
    setVoicePreviewBusy(true); setError('');
    try {
      const result = await chatRequest<{ audio: string; mimeType: string }>('/agents/' + agent.id + '/voice-preview', { voice: selectedVoice });
      const bytes = Uint8Array.from(atob(result.audio), char => char.charCodeAt(0));
      const url = URL.createObjectURL(new Blob([bytes], { type: result.mimeType }));
      const player = new Audio(url);
      voicePreviewAudioRef.current = player;
      player.addEventListener('ended', () => { URL.revokeObjectURL(url); setVoicePlaying(false); });
      player.addEventListener('pause', () => setVoicePlaying(false));
      setVoicePlaying(true);
      await player.play();
    } catch (failure) { setError((failure as Error).message); setVoicePlaying(false); } finally { setVoicePreviewBusy(false); }
  }

  function resetMemoryForm() {
    setEditingMemoryId(null); setMemoryCategory('preference'); setMemoryContent(''); setMemoryImportance(3); setMemoryExpiry('');
  }

  async function saveMemory(event: React.FormEvent) {
    event.preventDefault();
    if (!agent || directory?.me.role !== 'owner') return;
    setMemoryBusy(true); setError(''); setNotice('');
    try {
      const payload = { category: memoryCategory, content: memoryContent, importance: memoryImportance, expiresAt: memoryExpiry ? new Date(memoryExpiry).toISOString() : null };
      if (editingMemoryId) {
        const saved = await chatMutation<AgentMemory>('/agents/' + agent.id + '/memories/' + editingMemoryId, 'PATCH', payload);
        setMemories(previous => previous.map(memory => memory.id === saved.id ? saved : memory));
        setNotice('Memory updated.');
      } else {
        const saved = await chatMutation<AgentMemory>('/agents/' + agent.id + '/memories', 'POST', payload);
        setMemories(previous => [saved, ...previous]);
        setNotice('Memory saved for this agent.');
      }
      resetMemoryForm();
    } catch (failure) { setError((failure as Error).message); } finally { setMemoryBusy(false); }
  }

  async function archiveMemory(memoryId: string) {
    if (!agent) return;
    setMemoryBusy(true); setError(''); setNotice('');
    try {
      const saved = await chatMutation<AgentMemory>('/agents/' + agent.id + '/memories/' + memoryId, 'DELETE');
      setMemories(previous => previous.map(memory => memory.id === saved.id ? saved : memory));
      if (editingMemoryId === memoryId) resetMemoryForm();
      setNotice('Memory archived. Archived memories are no longer used by the agent.');
    } catch (failure) { setError((failure as Error).message); } finally { setMemoryBusy(false); }
  }

  async function restoreMemory(memoryId: string) {
    if (!agent) return;
    setMemoryBusy(true); setError(''); setNotice('');
    try {
      const saved = await chatMutation<AgentMemory>('/agents/' + agent.id + '/memories/' + memoryId + '/restore', 'POST');
      setMemories(previous => previous.map(memory => memory.id === saved.id ? saved : memory));
      setNotice('Memory restored.');
    } catch (failure) { setError((failure as Error).message); } finally { setMemoryBusy(false); }
  }

  async function permanentlyDeleteMemory(memoryId: string) {
    if (!agent || !window.confirm('Permanently delete this memory and its revision history? This cannot be undone.')) return;
    setMemoryBusy(true); setError(''); setNotice('');
    try {
      await chatMutation<{ id: string; deleted: boolean }>('/agents/' + agent.id + '/memories/' + memoryId + '/permanent', 'DELETE');
      setMemories(previous => previous.filter(memory => memory.id !== memoryId));
      if (historyMemoryId === memoryId) { setHistoryMemoryId(null); setMemoryRevisions([]); }
      setNotice('Memory and its revision history were permanently deleted.');
    } catch (failure) { setError((failure as Error).message); } finally { setMemoryBusy(false); }
  }

  async function showMemoryHistory(memoryId: string) {
    if (!agent) return;
    if (historyMemoryId === memoryId) { setHistoryMemoryId(null); setMemoryRevisions([]); return; }
    setHistoryMemoryId(memoryId); setMemoryRevisions([]); setError('');
    try {
      const result = await chatRequest<{ revisions: AgentMemoryRevision[] }>('/agents/' + agent.id + '/memories/' + memoryId + '/revisions');
      setMemoryRevisions(result.revisions);
    } catch (failure) { setError((failure as Error).message); }
  }

  function editMemory(memory: AgentMemory) {
    setEditingMemoryId(memory.id); setMemoryCategory(memory.category); setMemoryContent(memory.content);
    setMemoryImportance(memory.importance);
    setMemoryExpiry(memory.expiresAt ? new Date(memory.expiresAt).toISOString().slice(0, 16) : '');
    setError(''); setNotice('');
  }

  function resetPromptForm() {
    setEditingPromptId(null); setPromptName(''); setPromptContent('');
  }

  function editPrompt(prompt: Prompt) {
    setEditingPromptId(prompt.id); setPromptName(prompt.name); setPromptContent(prompt.content);
    setError(''); setNotice('');
  }

  async function savePrompt(event: React.FormEvent) {
    event.preventDefault();
    if (directory?.me.role !== 'owner') return;
    setPromptBusy(true); setError(''); setNotice('');
    try {
      const payload = { name: promptName, content: promptContent };
      if (editingPromptId) {
        const saved = await chatMutation<Prompt>('/prompts/' + editingPromptId, 'PATCH', payload);
        setPrompts(previous => previous.map(item => item.id === saved.id ? saved : item).sort((first, second) => first.name.localeCompare(second.name)));
        setNotice('Prompt updated.');
      } else {
        const saved = await chatMutation<Prompt>('/prompts', 'POST', payload);
        setPrompts(previous => [...previous, saved].sort((first, second) => first.name.localeCompare(second.name)));
        setNotice('Prompt added to the library.');
      }
      resetPromptForm();
    } catch (failure) { setError((failure as Error).message); } finally { setPromptBusy(false); }
  }

  async function deletePrompt(promptId: string) {
    if (!window.confirm('Permanently delete this prompt? Agents using it will fall back to the default.')) return;
    setPromptBusy(true); setError(''); setNotice('');
    try {
      await chatMutation<{ id: string; deleted: boolean }>('/prompts/' + promptId, 'DELETE');
      setPrompts(previous => previous.filter(item => item.id !== promptId));
      setPromptInstalls(previous => previous.filter(item => item.promptId !== promptId));
      if (editingPromptId === promptId) resetPromptForm();
      setNotice('Prompt deleted.');
    } catch (failure) { setError((failure as Error).message); } finally { setPromptBusy(false); }
  }

  async function installPrompt(scenario: PromptScenario, promptId: string) {
    if (!agent) return;
    setPromptBusy(true); setError(''); setNotice('');
    try {
      await chatMutation('/agents/' + agent.id + '/prompts/install', 'POST', { scenario, promptId: promptId || null });
      setPromptInstalls(previous => [...previous.filter(item => !(item.agentId === agent.id && item.scenario === scenario)), ...(promptId ? [{ agentId: agent.id, scenario, promptId }] : [])]);
      setNotice(promptId ? 'Prompt installed.' : 'Reverted to the built-in default prompt.');
    } catch (failure) { setError((failure as Error).message); } finally { setPromptBusy(false); }
  }

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6" role="presentation">
      <button aria-label="Close settings" className="ui-backdrop absolute inset-0" onClick={onClose} />
      <div role="dialog" aria-modal="true" aria-label={`${config.shortName} settings`} className="ui-dialog-panel relative flex h-[min(88vh,860px)] w-full max-w-5xl overflow-hidden">
        <aside className="flex w-14 flex-none flex-col border-r border-border bg-canvas/70 p-1.5 sm:w-60 sm:p-4" aria-label="Agent settings">
          <div className="flex items-center justify-center gap-3 border-b border-border px-0 pb-4 pt-2 sm:justify-start sm:px-2"><span className={cn('flex h-9 w-9 items-center justify-center rounded-xl text-white', config.bgColor)}>{getAgentAvatar(avatar)?.emoji || <Bot size={19} />}</span><div className="hidden min-w-0 sm:block"><h2 className="truncate text-sm font-semibold">{name || config.shortName}</h2><p className="text-xs text-text-secondary">Agent settings</p></div></div>
          <nav className="mt-4 space-y-1">{sections.map(item => <button key={item.id} title={item.label} onClick={() => { setSection(item.id); setError(''); setNotice(''); }} aria-current={section === item.id ? 'page' : undefined} className={'flex w-full items-center justify-center gap-3 rounded-lg px-0 py-2.5 text-sm transition-colors sm:justify-start sm:px-3 ' + (section === item.id ? 'bg-accent-blue/10 font-medium text-accent-blue' : 'text-text-secondary hover:bg-elevated hover:text-text-primary')}>{item.icon}<span className="hidden sm:inline">{item.label}</span></button>)}</nav>
          <div className="mt-auto hidden border-t border-border px-2 pt-4 text-xs leading-5 text-text-secondary sm:block">{section === 'voice' ? 'Changes apply to this browser where supported.' : section === 'prompts' ? 'The prompt library is shared workspace-wide; installs apply to this agent only.' : 'Changes apply to this agent where supported.'}</div>
        </aside>
        <section className="flex min-w-0 flex-1 flex-col">
          <header className="flex items-center justify-between border-b border-border px-5 py-4 sm:px-8"><div><h3 className="text-lg font-semibold">{sections.find(item => item.id === section)?.label}</h3><p className="mt-1 text-xs text-text-secondary">Configure {name || config.shortName} for your workspace.</p></div><button onClick={onClose} className="rounded-lg p-2 text-text-secondary hover:bg-elevated hover:text-text-primary" aria-label="Close settings"><X size={18} /></button></header>
          <div className="flex-1 overflow-y-auto px-5 py-6 sm:px-8">
            {section === 'profile' && <div className="max-w-xl space-y-5"><div><h4 className="font-medium">Name and role</h4><p className="mt-1 text-sm leading-6 text-text-secondary">Choose how teammates address this agent. Its engineering role stays fixed.</p></div>{directory?.me.role === 'owner' ? <form onSubmit={saveName} className="space-y-5">
              <label className="block text-sm font-medium">Agent name<input required maxLength={60} value={name} onChange={event => setName(event.target.value)} className="mt-2 w-full rounded-lg border border-border bg-canvas px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-accent-blue" placeholder={config.shortName} /></label>
              <fieldset>
                <legend className="text-sm font-medium">Agent avatar</legend>
                <p className="mt-1 text-xs leading-5 text-text-secondary">Choose an avatar for the sidebar. Leave Robot selected to use the default icon.</p>
                <div role="radiogroup" aria-label="Agent avatar" className="mt-3 flex flex-wrap gap-2">
                  <button type="button" role="radio" aria-checked={avatar === null} aria-label="Robot avatar" title="Robot" onClick={() => setAvatar(null)} className={cn('flex h-11 w-11 items-center justify-center rounded-xl border text-text-secondary transition-colors hover:bg-elevated', avatar === null ? 'border-accent-blue bg-accent-blue/10 text-accent-blue ring-2 ring-accent-blue/20' : 'border-border bg-canvas')}><Bot size={20} /></button>
                  {AGENT_AVATARS.map(option => <button key={option.id} type="button" role="radio" aria-checked={avatar === option.id} aria-label={`${option.label} avatar`} title={option.label} onClick={() => setAvatar(option.id)} className={cn('flex h-11 w-11 items-center justify-center rounded-xl border text-xl transition-colors hover:bg-elevated', option.color, avatar === option.id ? 'border-accent-blue ring-2 ring-accent-blue/20' : 'border-border')}><span aria-hidden="true">{option.emoji}</span></button>)}
                </div>
              </fieldset>
              <fieldset>
                <legend className="text-sm font-medium">Aliases</legend>
                <p className="mt-1 text-xs leading-5 text-text-secondary">Other names that call this agent — in Teams or Slack, mentioning any of these (or its name) routes the message to it.</p>
                <div className="mt-2 flex min-h-11 flex-wrap items-center gap-2 rounded-lg border border-border bg-canvas p-2">
                  {aliases.map(alias => <span key={alias} className="inline-flex items-center gap-1.5 rounded-full border border-accent-blue/20 bg-accent-blue/10 py-1 pl-3 pr-1 text-xs"><span>{alias}</span><button type="button" aria-label={'Remove alias ' + alias} onClick={() => setAliases(current => current.filter(value => value !== alias))} className="rounded-full p-1 text-text-secondary hover:bg-accent-blue/10 hover:text-text-primary"><X size={12} /></button></span>)}
                  <input value={aliasInput} onChange={event => setAliasInput(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' || event.key === ',') { event.preventDefault(); addAlias(); } }} onBlur={addAlias} maxLength={60} placeholder={aliases.length ? 'Add another…' : 'e.g. QA bot'} className="min-w-[120px] flex-1 bg-transparent px-1 py-1 text-sm outline-none placeholder:text-text-secondary" />
                </div>
              </fieldset>
              <p className="text-xs leading-5 text-text-secondary">Mention this name in a group to call the agent. Its QAE or AUE role name also works.</p>
              <button disabled={busy || !agent} className={cn('rounded-lg px-4 py-2.5 text-sm font-medium text-white disabled:opacity-40', config.bgColor)}>{busy ? 'Saving…' : 'Save profile'}</button>
            </form> : <p className="rounded-xl border border-border p-4 text-sm text-text-secondary">An app owner can change the agent name and avatar.</p>}</div>}
            {section === 'memory' && <div className="max-w-3xl space-y-5">
              <div><h4 className="font-medium">Agent memory</h4><p className="mt-1 text-sm leading-6 text-text-secondary">Saved memories are workspace-wide for this agent and are retrieved when their content matches a new request. Conversation history stays with its conversation; workspace reference material lives in Knowledge.</p></div>
              <div className="rounded-xl border border-border bg-canvas p-4"><div className="flex items-center gap-3"><span className="flex h-9 w-9 flex-none items-center justify-center rounded-lg bg-accent-blue/10 text-accent-blue"><Brain size={18} /></span><div><p className="text-sm font-medium">{memories.filter(memory => memory.status === 'active' && (!memory.expiresAt || new Date(memory.expiresAt).getTime() > Date.now())).length} usable memories</p><p className="mt-1 text-xs leading-5 text-text-secondary">Memories are versioned, can expire, and are archived rather than removed from normal history. Only workspace owners can change them. Credentials and API keys are blocked.</p></div></div></div>
              {directory?.me.role === 'owner' ? <form onSubmit={saveMemory} className="space-y-3 rounded-xl border border-border p-4">
                <div className="flex items-center justify-between"><h5 className="text-sm font-medium">{editingMemoryId ? 'Edit memory' : 'Add a memory'}</h5>{editingMemoryId && <button type="button" onClick={resetMemoryForm} className="text-xs text-text-secondary hover:text-text-primary">Cancel edit</button>}</div>
                <div className="grid gap-3 sm:grid-cols-3">
                  <label className="text-xs font-medium text-text-secondary">Category<select value={memoryCategory} onChange={event => setMemoryCategory(event.target.value as AgentMemoryCategory)} className="mt-1.5 w-full rounded-lg border border-border bg-canvas px-3 py-2 text-sm text-text-primary"><option value="preference">Preference</option><option value="decision">Decision</option><option value="workflow">Workflow</option><option value="constraint">Constraint</option></select></label>
                  <label className="text-xs font-medium text-text-secondary">Importance<select value={memoryImportance} onChange={event => setMemoryImportance(Number(event.target.value))} className="mt-1.5 w-full rounded-lg border border-border bg-canvas px-3 py-2 text-sm text-text-primary"><option value={1}>Low</option><option value={2}>Below normal</option><option value={3}>Normal</option><option value={4}>High</option><option value={5}>Critical</option></select></label>
                  <label className="text-xs font-medium text-text-secondary">Expires (optional)<input type="datetime-local" value={memoryExpiry} onChange={event => setMemoryExpiry(event.target.value)} className="mt-1.5 w-full rounded-lg border border-border bg-canvas px-3 py-2 text-sm text-text-primary" /></label>
                </div>
                <label className="block text-xs font-medium text-text-secondary">Memory<textarea required maxLength={2000} value={memoryContent} onChange={event => setMemoryContent(event.target.value)} rows={3} placeholder="For example: Prefer test plans that cover keyboard-only navigation." className="mt-1.5 w-full resize-y rounded-lg border border-border bg-canvas px-3 py-2.5 text-sm text-text-primary outline-none focus:ring-2 focus:ring-accent-blue" /></label>
                <div className="flex items-center justify-between gap-3"><p className="text-xs text-text-secondary">{memoryContent.length}/2,000 characters. Avoid personal or secret information.</p><button disabled={memoryBusy || !agent} className={cn('rounded-lg px-4 py-2 text-sm font-medium text-white disabled:opacity-40', config.bgColor)}>{memoryBusy ? 'Saving…' : editingMemoryId ? 'Save changes' : 'Save memory'}</button></div>
              </form> : <p className="rounded-xl border border-border p-4 text-sm text-text-secondary">Only a workspace owner can add, edit, archive, or restore agent memories.</p>}
              <div className="flex items-center justify-between"><h5 className="text-sm font-medium">Saved memories</h5><button type="button" onClick={() => setShowArchivedMemories(value => !value)} className="text-xs font-medium text-accent-blue hover:underline">{showArchivedMemories ? 'Show active' : 'Show archived'}</button></div>
              {memoryLoading ? <p className="rounded-xl border border-border p-5 text-sm text-text-secondary">Loading memories…</p> : memories.filter(memory => memory.status === (showArchivedMemories ? 'archived' : 'active')).length === 0 ? <p className="rounded-xl border border-dashed border-border p-5 text-sm text-text-secondary">{showArchivedMemories ? 'No archived memories.' : 'No saved memories yet. Add one above to give this agent durable, workspace-specific guidance.'}</p> : <div className="divide-y divide-border rounded-xl border border-border">{memories.filter(memory => memory.status === (showArchivedMemories ? 'archived' : 'active')).map(memory => <article key={memory.id} className="p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><span className="rounded-full bg-elevated px-2 py-0.5 text-[11px] font-medium capitalize text-text-secondary">{memory.category}</span><span className="text-[11px] text-text-secondary">Importance {memory.importance}/5</span>{memory.expiresAt && <span className={cn('text-[11px]', isMemoryExpired(memory) ? 'text-warning' : 'text-text-secondary')}>{isMemoryExpired(memory) ? 'Expired' : 'Expires ' + new Date(memory.expiresAt).toLocaleDateString()}</span>}</div><p className="mt-2 whitespace-pre-wrap text-sm leading-6">{memory.content}</p><p className="mt-2 text-[11px] text-text-secondary">Version {memory.version} · Updated {new Date(memory.updatedAt).toLocaleString()}{memory.lastUsedAt ? ` · Used ${new Date(memory.lastUsedAt).toLocaleDateString()}` : ''}</p></div><div className="flex flex-none items-center gap-1">{directory?.me.role === 'owner' && (memory.status === 'active' ? <><button type="button" disabled={memoryBusy} onClick={() => editMemory(memory)} className="rounded-md px-2 py-1 text-xs text-text-secondary hover:bg-elevated hover:text-text-primary">Edit</button><button type="button" disabled={memoryBusy} onClick={() => void archiveMemory(memory.id)} className="rounded-md px-2 py-1 text-xs text-text-secondary hover:bg-elevated hover:text-text-primary">Archive</button></> : <><button type="button" disabled={memoryBusy} onClick={() => void restoreMemory(memory.id)} className="rounded-md px-2 py-1 text-xs text-accent-blue hover:bg-accent-blue/10">Restore</button><button type="button" disabled={memoryBusy} onClick={() => void permanentlyDeleteMemory(memory.id)} className="rounded-md px-2 py-1 text-xs text-danger hover:bg-danger/10">Delete forever</button></>)}<button type="button" onClick={() => void showMemoryHistory(memory.id)} className="rounded-md px-2 py-1 text-xs text-text-secondary hover:bg-elevated hover:text-text-primary">{historyMemoryId === memory.id ? 'Hide history' : 'History'}</button></div></div>{historyMemoryId === memory.id && <div className="mt-4 border-l-2 border-border pl-3"><p className="mb-2 text-xs font-medium text-text-secondary">Recent revisions</p>{memoryRevisions.length ? <ol className="space-y-3">{memoryRevisions.map(revision => <li key={revision.id} className="text-xs"><div className="flex flex-wrap gap-x-2 text-text-secondary"><span>v{revision.version} · {revision.change}</span><span>{revision.actor}</span><time>{new Date(revision.createdAt).toLocaleString()}</time></div><p className="mt-1 whitespace-pre-wrap leading-5">{revision.content}</p></li>)}</ol> : <p className="text-xs text-text-secondary">Loading history…</p>}</div>}</article>)}</div>}
            </div>}
            {section === 'voice' && <div className="max-w-xl space-y-5">
              <div><h4 className="font-medium">OpenAI live voice</h4><p className="mt-1 text-sm leading-6 text-text-secondary">Choose one of OpenAI’s built-in Live voices. This preference is saved in this browser and used when this agent leads a new native live call.</p></div>
              {(['female', 'male'] as const).map(gender => (
                <div key={gender}>
                  <p className="mb-2 text-xs font-medium uppercase tracking-wide text-text-secondary">{gender === 'female' ? 'Female' : 'Male'} voices</p>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                    {OPENAI_LIVE_VOICES.filter(voice => OPENAI_LIVE_VOICE_GENDER[voice] === gender).map(voice => {
                      const recommended = voice === 'marin' || voice === 'cedar';
                      const active = selectedVoice === voice;
                      return (
                        <button key={voice} type="button" onClick={() => setSelectedVoice(voice)} aria-pressed={active} className={cn('flex items-center justify-between gap-2 rounded-lg border px-3 py-2.5 text-left text-sm font-medium capitalize transition-colors active:translate-y-px', active ? 'border-accent-blue bg-accent-blue/10 text-accent-blue' : 'border-border text-text-secondary hover:bg-elevated hover:text-text-primary')}>
                          {voice}
                          {recommended && <span className={cn('rounded-full px-1.5 py-0.5 text-[10px] font-medium', active ? 'bg-accent-blue/20 text-accent-blue' : 'bg-elevated text-text-secondary')}>Best</span>}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
              <div className="flex items-center gap-3">
                <button type="button" onClick={() => void playVoicePreview()} disabled={voicePreviewBusy || !agent} className="flex items-center gap-2 rounded-lg border border-border px-3 py-2.5 text-sm font-medium text-text-secondary transition-colors hover:bg-elevated hover:text-text-primary active:translate-y-px disabled:opacity-60">{voicePreviewBusy ? <Loader2 size={16} className="animate-spin" /> : <PlayCircle size={16} />}Listen to {selectedVoice}</button>
                {voicePlaying && <span className="flex items-center gap-1.5 text-xs text-text-secondary"><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent-blue" />Playing</span>}
              </div>
              <div className="flex items-center gap-3 border-t border-border pt-5">
                <button type="button" onClick={saveVoice} disabled={selectedVoice === voiceName} className="rounded-lg bg-accent-blue px-4 py-2.5 text-sm font-medium text-white transition active:translate-y-px disabled:opacity-40">Save voice</button>
                {selectedVoice !== voiceName && <span className="text-xs text-text-secondary">Unsaved selection: {selectedVoice}</span>}
              </div>
              <p className="text-xs leading-5 text-text-secondary">OpenAI recommends marin or cedar for voice quality. Changes apply to new live calls.</p>
            </div>}
            {section === 'prompts' && <div className="max-w-xl space-y-6">
              <div>
                <h4 className="font-medium">Scenario prompts</h4>
                <p className="mt-1 text-sm leading-6 text-text-secondary">Install a saved prompt to control how {name || config.shortName} behaves in each scenario. Prompts are shared across agents; leave a scenario on Default to use the built-in behavior.</p>
              </div>
              <div className="divide-y divide-border rounded-xl border border-border bg-canvas">
                {([['conversation', 'Conversation chat', MessageSquare], ['meeting', 'Meetings', Users]] as [PromptScenario, string, typeof MessageSquare][]).map(([scenario, label, Icon]) => {
                  const installed = promptInstalls.find(item => item.agentId === agent?.id && item.scenario === scenario);
                  return (
                    <div key={scenario} className="flex flex-wrap items-center justify-between gap-3 p-4">
                      <span className="flex items-center gap-2 text-sm font-medium"><Icon size={15} className="shrink-0 text-text-secondary" />{label}</span>
                      <div className="flex items-center gap-2">
                        <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-medium', installed ? 'bg-accent-blue/10 text-accent-blue' : 'bg-elevated text-text-secondary')}>{installed ? 'Custom' : 'Default'}</span>
                        <select value={installed?.promptId || ''} onChange={event => void installPrompt(scenario, event.target.value)} disabled={promptBusy || !agent} className="w-48 rounded-lg border border-border bg-canvas px-3 py-2 text-sm outline-none transition-colors hover:bg-elevated focus:ring-2 focus:ring-accent-blue disabled:opacity-60">
                          <option value="">Default (built-in)</option>
                          {prompts.map(prompt => <option key={prompt.id} value={prompt.id}>{prompt.name}</option>)}
                        </select>
                      </div>
                    </div>
                  );
                })}
              </div>
              {directory?.me.role === 'owner' ? <form onSubmit={savePrompt} className="space-y-3 rounded-xl border border-border bg-canvas p-4">
                <h5 className="text-sm font-medium">{editingPromptId ? 'Edit prompt' : 'New prompt'}</h5>
                <input value={promptName} onChange={event => setPromptName(event.target.value)} placeholder="Name, e.g. Blunt QA reviewer" maxLength={60} required className="w-full rounded-lg border border-border bg-canvas px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-accent-blue" />
                <div>
                  <textarea value={promptContent} onChange={event => setPromptContent(event.target.value)} placeholder="Describe how the agent should behave…" maxLength={4000} required rows={5} className="w-full rounded-lg border border-border bg-canvas px-3 py-2 text-sm leading-6 outline-none focus:ring-2 focus:ring-accent-blue" />
                  <p className="mt-1 text-right text-[11px] tabular-nums text-text-secondary">{promptContent.length}/4000</p>
                </div>
                <div className="flex items-center gap-2">
                  <button type="submit" disabled={promptBusy} className="rounded-lg bg-accent-blue px-4 py-2 text-sm font-medium text-white transition active:translate-y-px disabled:opacity-60">{editingPromptId ? 'Save changes' : 'Add prompt'}</button>
                  {editingPromptId && <button type="button" onClick={resetPromptForm} className="rounded-lg border border-border px-4 py-2 text-sm font-medium transition-colors hover:bg-elevated active:translate-y-px">Cancel</button>}
                </div>
              </form> : <p className="rounded-xl border border-border p-4 text-sm text-text-secondary">Only a workspace owner can add, edit, or delete prompts.</p>}
              <div>
                <h5 className="mb-2 text-sm font-medium">Prompt library</h5>
                {promptsLoading ? <p className="rounded-xl border border-border p-5 text-sm text-text-secondary">Loading prompts…</p> : prompts.length === 0 ? <div className="rounded-xl border border-dashed border-border p-6 text-center"><FileText size={20} className="mx-auto text-text-secondary" /><p className="mt-2 text-sm text-text-secondary">No saved prompts yet. Add one above to reuse it across agents and scenarios.</p></div> : <div className="divide-y divide-border rounded-xl border border-border">
                  {prompts.map(prompt => {
                    const installedAt = promptInstalls.filter(item => item.promptId === prompt.id).map(item => ({ ...item, agentName: directory?.agents.find(candidate => candidate.id === item.agentId)?.name || 'Agent' }));
                    return <article key={prompt.id} className="p-4 transition-colors hover:bg-elevated/60">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium">{prompt.name}</p>
                          <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-text-secondary">{prompt.content}</p>
                          <div className="mt-2 flex flex-wrap items-center gap-2">
                            <p className="text-[11px] text-text-secondary">Updated {new Date(prompt.updatedAt).toLocaleString()}</p>
                            {installedAt.map(install => <span key={install.agentId + install.scenario} className="inline-flex items-center gap-1 rounded-full bg-accent-blue/10 px-2 py-0.5 text-[11px] font-medium text-accent-blue"><CheckCircle size={11} />{install.agentName} · {install.scenario === 'conversation' ? 'Conversation' : 'Meetings'}</span>)}
                          </div>
                        </div>
                        {directory?.me.role === 'owner' && <div className="flex flex-none items-center gap-1">
                          <button type="button" disabled={promptBusy} onClick={() => editPrompt(prompt)} className="rounded-md px-2 py-1 text-xs text-text-secondary transition-colors hover:bg-elevated hover:text-text-primary">Edit</button>
                          <button type="button" disabled={promptBusy} onClick={() => void deletePrompt(prompt.id)} className="rounded-md px-2 py-1 text-xs text-danger transition-colors hover:bg-danger/10">Delete</button>
                        </div>}
                      </div>
                    </article>;
                  })}
                </div>}
              </div>
            </div>}
            {(section === 'skills' || section === 'tools' || section === 'model' || section === 'budget') && <AgentRuntimeSettings key={agentType} agentId={agent?.id} section={section} onSectionChange={setSection} canEdit={directory?.me.role === 'owner'} />}
            {error && <p role="alert" className="mt-5 text-sm text-danger">{error}</p>}{notice && <p role="status" className="mt-5 text-sm text-success">{notice}</p>}
          </div>
          <footer className="flex justify-end border-t border-border bg-elevated/40 px-5 py-3 sm:px-8"><button onClick={onClose} className="rounded-lg border border-border px-4 py-2 text-sm font-medium hover:bg-elevated">Done</button></footer>
        </section>
      </div>
    </div>
  );
}

type TabType = 'console' | 'tasks' | 'outpost';
type RecentAgentSession = Pick<AgentSession, 'id' | 'agentType' | 'status' | 'createdAt' | 'updatedAt'> & { messageCount?: number; preview?: string; needsHelpReason?: string | null; needsApproval?: boolean };

const SESSION_BUCKET_ORDER = ['Today', 'This week', 'This month', 'This year', 'Older'] as const;
function sessionBucket(dateInput: string): typeof SESSION_BUCKET_ORDER[number] {
  const date = new Date(dateInput);
  const now = new Date();
  const startOfDay = (value: Date) => new Date(value.getFullYear(), value.getMonth(), value.getDate());
  const diffDays = Math.floor((startOfDay(now).getTime() - startOfDay(date).getTime()) / 86400000);
  if (diffDays <= 0) return 'Today';
  if (diffDays <= 7) return 'This week';
  if (diffDays <= 30) return 'This month';
  if (date.getFullYear() === now.getFullYear()) return 'This year';
  return 'Older';
}

export function AgentPage({ agentType }: { agentType: AgentType }) {
  const baseConfig = AGENT_CONFIGS[agentType];
  const [agentName, setAgentName] = useState('');
  const [chatAgentId, setChatAgentId] = useState<string | null>(null);
  const [consoleDirectory, setConsoleDirectory] = useState<Directory | null>(null);
  const [allMeetings, setAllMeetings] = useState<Meeting[] | null>(null);
  const [meetingTimings, setMeetingTimings] = useState<Record<string, MeetingTiming>>({});
  const [meetingResults, setMeetingResults] = useState<Meeting[] | null>(null);
  const [meetingResultIndex, setMeetingResultIndex] = useState(0);
  const [meetingContext, setMeetingContext] = useState<{ meeting: Meeting; wordCount: number; tokenCount: number } | null>(null);
  const [meetingModalId, setMeetingModalId] = useState<string | null>(null);
  const [watchingLive, setWatchingLive] = useState<{ runId: string; testName: string } | null>(null);
  const config = useMemo(() => ({ ...baseConfig, name: agentName || baseConfig.name }), [baseConfig, agentName]);
  const [activeTab, setActiveTab] = useState<TabType>('console');
  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const [input, setInput] = useState('');
  const [commandSuggestionIndex, setCommandSuggestionIndex] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [recentSessions, setRecentSessions] = useState<RecentAgentSession[]>([]);
  const [railSearch, setRailSearch] = useState('');
  const [sessionsRailCollapsed, setSessionsRailCollapsed] = useState(true);
  const [resultsRailCollapsed, setResultsRailCollapsed] = useState(true);
  const [sessionsLoading, setSessionsLoading] = useState(true);
  const [sessionsError, setSessionsError] = useState('');
  const [sessionBusy, setSessionBusy] = useState(false);
  const [tasks, setTasks] = useState<AgentTask[]>([]);
  const [isTaskModalOpen, setIsTaskModalOpen] = useState(false);
  const [selectedTask, setSelectedTask] = useState<AgentTask | null>(null);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    let active = true;
    chatRequest<Directory>('/directory').then(directory => {
      if (!active) return;
      setConsoleDirectory(directory);
      const current = directory.agents.find(item => item.kind === agentType);
      if (current) { setAgentName(current.name); setChatAgentId(current.id); }
    }).catch(() => { /* Keep the role name when chat settings are unavailable. */ });
    return () => { active = false; };
  }, [agentType]);

  // Fetch tasks
  const fetchTasks = useCallback(async () => {
    try {
      const response = await fetch(`${API_BASE}/api/agents/${agentType}/tasks`);
      if (response.ok) {
        const data = await response.json();
        setTasks(data);
      }
    } catch (error) {
      console.error('Failed to fetch tasks:', error);
    }
  }, [agentType]);

  useEffect(() => {
    fetchTasks();
    const events = new EventSource(`${API_BASE}/api/agents/${agentType}/tasks/events`);
    events.addEventListener('connected', fetchTasks);
    events.addEventListener('change', fetchTasks);
    window.addEventListener('focus', fetchTasks);
    return () => { events.close(); window.removeEventListener('focus', fetchTasks); };
  }, [fetchTasks]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const refreshRecentSessions = useCallback(async () => {
    setSessionsLoading(true);
    try {
      const response = await fetch(`${API_BASE}/api/agents/${agentType}/sessions`, { credentials: 'include' });
      if (!response.ok) throw new Error('Recent sessions could not be loaded.');
      const data = await response.json() as RecentAgentSession[];
      setRecentSessions(data);
      setSessionsError('');
    } catch (failure) {
      setSessionsError((failure as Error).message);
    } finally {
      setSessionsLoading(false);
    }
  }, [agentType]);

  useEffect(() => { void refreshRecentSessions(); }, [refreshRecentSessions]);

  const startNewSession = useCallback(async () => {
    setMessages([]);
    setSessionId(null);
    setInput('');
    setActiveTab('console');
    setSessionsError('');
    setSessionBusy(true);
    try {
      const response = await fetch(`${API_BASE}/api/agents/${agentType}/sessions`, { method: 'POST', credentials: 'include' });
      if (!response.ok) throw new Error('A new session could not be started.');
      const session = await response.json() as RecentAgentSession;
      setSessionId(session.id);
      await refreshRecentSessions();
    } catch (failure) {
      setSessionsError((failure as Error).message);
    } finally {
      setSessionBusy(false);
    }
  }, [agentType, refreshRecentSessions]);

  const openSession = async (id: string) => {
    setSessionBusy(true);
    setSessionsError('');
    try {
      const response = await fetch(`${API_BASE}/api/agents/sessions/${id}`, { credentials: 'include' });
      if (!response.ok) throw new Error('This session could not be opened.');
      const session = await response.json() as AgentSession;
      setMessages(session.messages || []);
      setSessionId(session.id);
      setInput('');
      setActiveTab('console');
    } catch (failure) {
      setSessionsError((failure as Error).message);
    } finally {
      setSessionBusy(false);
    }
  };

  // Resume the most recently active session once, on first load (covers reopening the
  // tab/browser entirely — in-app navigation is already handled by AppShell keeping this
  // component mounted). Skipped once the user has a session open or has started typing,
  // so it never clobbers an explicit "New session" or a turn already in progress.
  const autoResumedRef = useRef(false);
  useEffect(() => {
    if (autoResumedRef.current || sessionsLoading || sessionId || messages.length) return;
    const latest = recentSessions[0];
    if (!latest || !latest.messageCount) return;
    autoResumedRef.current = true;
    void openSession(latest.id);
  }, [recentSessions, sessionsLoading, sessionId, messages.length]);

  const sendMessage = async () => {
    if (!input.trim() || isLoading || sessionBusy) return;

    const typedInstruction = input.trim();
    if (/^\/meetings(?:\s|$)/i.test(typedInstruction)) return;
    const commandAction = quickActions[agentType].find(action => typedInstruction === action.command || typedInstruction.startsWith(action.command + ' '));
    const commandTarget = commandAction ? typedInstruction.slice(commandAction.command.length).trim() : '';
    if (typedInstruction.startsWith('/') && !commandAction) {
      const commandName = typedInstruction.split(/\s+/, 1)[0];
      setMessages(previous => [...previous, { id: Date.now().toString(), role: 'system', content: `Unknown command: ${commandName}. Available commands: ${quickActions[agentType].map(action => action.command).join(', ')}`, timestamp: new Date().toISOString() }]);
      setInput('');
      return;
    }
    const instruction = commandAction ? commandAction.prompt + (commandTarget ? (commandAction.prompt.endsWith(' ') ? '' : ' ') + commandTarget : '') : typedInstruction;
    const userMessage: AgentMessage = {
      id: Date.now().toString(),
      role: 'user',
      content: instruction,
      timestamp: new Date().toISOString(),
      ...(meetingContext ? { meetingAttachment: { meetingId: meetingContext.meeting.id, title: meetingContext.meeting.title, wordCount: meetingContext.wordCount, tokenCount: meetingContext.tokenCount } } : {}),
    };

    setMessages((prev) => [...prev, userMessage]);
    setInput('');
    setIsLoading(true);

    const assistantId = userMessage.id + '-a';
    let statusSeq = 0;
    const nextStatusId = () => `${assistantId}-status-${statusSeq++}`;
    setMessages((prev) => [...prev, { id: assistantId, role: 'assistant', content: '', timestamp: new Date().toISOString(), toolCalls: [], timeline: [] }]);

    const updateAssistant = (update: (message: AgentMessage) => AgentMessage) =>
      setMessages((prev) => prev.map((message) => (message.id === assistantId ? update(message) : message)));

    try {
      if (!chatAgentId) throw new Error('Agent is not available in this workspace yet.');
      await chatStream(`/agents/${chatAgentId}/runtime-chat/stream`, { message: userMessage.content, sessionId, ...(meetingContext ? { meetingContextId: meetingContext.meeting.id } : {}) }, (event: ChatStreamEvent) => {
        if (event.type === 'tool_call') {
          updateAssistant((message) => ({
            ...message,
            toolCalls: [...(message.toolCalls || []), { id: event.id, name: event.name, arguments: event.args, status: 'running' }],
            timeline: [...(message.timeline || []), { kind: 'tool', id: event.id }],
          }));
        } else if (event.type === 'tool_result') {
          updateAssistant((message) => ({ ...message, toolCalls: (message.toolCalls || []).map((tc) => (tc.id === event.id ? { ...tc, result: event.content, status: event.status } : tc)) }));
        } else if (event.type === 'live_run_started') {
          // Not tied to a tool_call id (it's dispatched from deep inside the tool, before
          // LangGraph assigns one back to us) — attach to the most recent running browser
          // tool call instead, which covers the realistic case of one at a time.
          updateAssistant((message) => {
            const toolCalls = message.toolCalls || [];
            const index = toolCalls.map((tc) => tc.status === 'running' && ['execute_test_case', 'execute_test_suite'].includes(tc.name)).lastIndexOf(true);
            if (index === -1) return message;
            const next = [...toolCalls];
            next[index] = { ...next[index], liveRunId: event.runId, liveTestName: event.testName };
            return { ...message, toolCalls: next };
          });
        } else if (event.type === 'token') {
          updateAssistant((message) => ({ ...message, content: message.content + event.content }));
        } else if (event.type === 'status') {
          updateAssistant((message) => ({ ...message, timeline: [...(message.timeline || []), { kind: 'status', id: nextStatusId(), label: event.label }] }));
        } else if (event.type === 'done') {
          setSessionId(event.sessionId);
          updateAssistant((message) => ({ ...message, id: event.messageId || message.id, content: event.response, toolCalls: (event.toolCalls as AgentToolCall[] | undefined) ?? message.toolCalls }));
          void refreshRecentSessions();
        } else if (event.type === 'error') {
          throw new Error(event.message);
        }
      });
    } catch (error) {
      setMessages((prev) => prev.filter((message) => message.id !== assistantId || message.content || message.toolCalls?.length));
      const systemMessage: AgentMessage = {
        id: Date.now().toString(), role: 'system',
        content: `The agent could not respond: ${(error as Error).message}. Your message is still here; try again when the agent service is available.`,
        timestamp: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, systemMessage]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (meetingResults && meetingResults.length) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setMeetingResultIndex(index => (index + 1) % meetingResults.length); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); setMeetingResultIndex(index => (index - 1 + meetingResults.length) % meetingResults.length); return; }
      if (e.key === 'Escape') { e.preventDefault(); setMeetingResults(null); return; }
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void selectMeetingResult(meetingResults[meetingResultIndex]); return; }
    }
    if (meetingsMatch && e.key === 'Escape') { e.preventDefault(); setMeetingResults(null); setInput(''); return; }
    if (commandSuggestions.length && e.key === 'ArrowDown') {
      e.preventDefault();
      setCommandSuggestionIndex(index => (index + 1) % commandSuggestions.length);
      return;
    }
    if (commandSuggestions.length && e.key === 'ArrowUp') {
      e.preventDefault();
      setCommandSuggestionIndex(index => (index - 1 + commandSuggestions.length) % commandSuggestions.length);
      return;
    }
    if (commandSuggestions.length && e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleQuickAction(commandSuggestions[commandSuggestionIndex].command);
      return;
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const handleQuickAction = (command: string) => {
    setInput(command + ' ');
    setCommandSuggestionIndex(0);
    inputRef.current?.focus();
  };

  const quickActions: Record<AgentType, Array<{ label: string; command: string; prompt: string; icon: React.ReactNode }>> = {
    qae: [
      { label: 'Design test cases', command: '/test-cases', prompt: 'Design test cases for ', icon: <TestTube size={14} /> },
      { label: 'Find edge cases', command: '/edge-cases', prompt: 'What are the edge cases for ', icon: <Search size={14} /> },
      { label: 'Analyze bug', command: '/analyze-bug', prompt: 'Analyze this bug: ', icon: <Bug size={14} /> },
      { label: 'Review quality', command: '/review-quality', prompt: 'Review the quality of ', icon: <Sparkles size={14} /> },
      { label: 'Meetings', command: '/meetings', prompt: '', icon: <History size={14} /> },
      { label: 'Command help', command: '/help', prompt: 'List the available QA commands and explain when to use each one.', icon: <Info size={14} /> },
    ],
    aue: [
      { label: 'Generate script', command: '/generate-script', prompt: 'Generate a test script for ', icon: <Code size={14} /> },
      { label: 'Fix locator', command: '/fix-locator', prompt: 'Create a robust locator for ', icon: <Search size={14} /> },
      { label: 'Debug test', command: '/debug-test', prompt: 'Help me debug this failing test: ', icon: <Bug size={14} /> },
      { label: 'Setup framework', command: '/setup-framework', prompt: 'How do I set up ', icon: <FileText size={14} /> },
      { label: 'Meetings', command: '/meetings', prompt: '', icon: <History size={14} /> },
      { label: 'Command help', command: '/help', prompt: 'List the available automation commands and explain when to use each one.', icon: <Info size={14} /> },
    ],
    superqa: [
      { label: 'Create task', command: '/create-task', prompt: 'Create a task for ', icon: <FileText size={14} /> },
      { label: 'Start sync', command: '/start-sync', prompt: 'Start a sync job for ', icon: <Sparkles size={14} /> },
      { label: 'Platform stats', command: '/platform-stats', prompt: 'Show me the platform statistics', icon: <Search size={14} /> },
      { label: 'Meetings', command: '/meetings', prompt: '', icon: <History size={14} /> },
      { label: 'Get help', command: '/help', prompt: 'What can you help me with?', icon: <Bug size={14} /> },
    ],
  };

  const partialCommand = input.match(/^\/\S*$/)?.[0].toLowerCase();
  const commandSuggestions = partialCommand ? quickActions[agentType].filter(action => action.command.startsWith(partialCommand)) : [];
  const meetingsMatch = /^\/meetings(?:\s+(.*))?$/i.exec(input.trim());

  useEffect(() => {
    if (!meetingsMatch) { setMeetingResults(null); return; }
    let active = true;
    (async () => {
      let list = allMeetings;
      if (!list) {
        try {
          const feed = await chatRequest<MeetingFeed>('/meetings/feed');
          list = feed.meetings.filter(item => item.agentId === chatAgentId || item.agentParticipants?.some(participant => participant.agentId === chatAgentId));
          if (active) { setAllMeetings(list); setMeetingTimings(feed.meetingTimings); }
        } catch { if (active) setMeetingResults([]); return; }
      }
      if (!active) return;
      const term = (meetingsMatch[1] || '').trim().toLowerCase();
      setMeetingResults(list.filter(item => item.title.toLowerCase().includes(term)));
      setMeetingResultIndex(0);
    })();
    return () => { active = false; };
  }, [meetingsMatch?.[0], chatAgentId]);

  async function selectMeetingResult(meeting: Meeting) {
    setInput('');
    setMeetingResults(null);
    try {
      const detail = await chatRequest<MeetingDetail>('/meetings/' + meeting.id);
      const words = detail.entries.reduce((sum, entry) => sum + (entry.text.trim() ? entry.text.trim().split(/\s+/).length : 0), 0);
      const tokens = detail.entries.reduce((sum, entry) => sum + estimateTokenCount(entry.text), 0);
      setMeetingContext({ meeting: detail.meeting, wordCount: words, tokenCount: tokens });
    } catch { /* Attachment failed silently; the user can retry via /meetings. */ }
    inputRef.current?.focus();
  }

  const handleTaskClick = (task: AgentTask) => {
    setSelectedTask(task);
    setIsTaskModalOpen(true);
  };

  const handleAddTask = () => {
    setSelectedTask(null);
    setIsTaskModalOpen(true);
  };

  const handleTaskModalClose = () => {
    setIsTaskModalOpen(false);
    setSelectedTask(null);
  };

  const handleTaskSave = () => {
    fetchTasks();
  };

  const sessionStatusIcon = (status: AgentStatus, title: string) => {
    if (status === 'needs_help') return <HelpCircle size={13} className="shrink-0 text-warning" aria-label={`${title}: needs help`} />;
    if (status === 'running') return <span className="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-success" aria-label={`${title}: active`} />;
    return <span className="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-text-secondary" aria-label={`${title}: inactive`} />;
  };

  return (
    <div className="relative flex h-full flex-col overflow-hidden bg-canvas">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-56 bg-gradient-to-b from-accent-blue/[0.06] via-accent-purple/[0.025] to-transparent" />
      {/* Header */}
      <div className="relative flex items-center justify-between border-b border-border/80 bg-surface/85 px-5 py-4 backdrop-blur-xl md:px-7">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold tracking-tight">{config.name}</h1>
          <p className={cn('mt-1 text-sm leading-5', config.color)}>{config.tagline}</p>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setIsSettingsOpen(true)}
            className="rounded-xl p-2.5 text-text-secondary transition hover:bg-elevated hover:text-text-primary"
            title="Settings"
          >
            <Settings size={18} className="text-text-secondary" />
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="relative flex items-center gap-2 border-b border-border/80 bg-surface/50 px-4 py-2 md:px-7">
        <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto" role="tablist" aria-label="Agent workspace">
        <button
          onClick={() => setActiveTab('console')}
          role="tab"
          aria-selected={activeTab === 'console'}
          className={cn(
            'flex shrink-0 items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors',
            activeTab === 'console'
              ? 'bg-accent-blue/10 text-accent-blue'
              : 'text-text-secondary hover:text-text-primary hover:bg-elevated'
          )}
        >
          <Terminal size={16} />
          Console
        </button>
        <button
          onClick={() => setActiveTab('tasks')}
          role="tab"
          aria-selected={activeTab === 'tasks'}
          className={cn(
            'flex shrink-0 items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors',
            activeTab === 'tasks'
              ? 'bg-accent-blue/10 text-accent-blue'
              : 'text-text-secondary hover:text-text-primary hover:bg-elevated'
          )}
        >
          <ListTodo size={16} />
          Tasks
          {tasks.length > 0 && (
            <span className={cn(
              'px-1.5 py-0.5 rounded-full text-xs',
              activeTab === 'tasks' ? 'bg-accent-blue/20' : 'bg-elevated'
            )}>
              {tasks.length}
            </span>
          )}
        </button>
        <button
          onClick={() => setActiveTab('outpost')}
          role="tab"
          aria-selected={activeTab === 'outpost'}
          className={cn('flex shrink-0 items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors', activeTab === 'outpost' ? 'bg-accent-blue/10 text-accent-blue' : 'text-text-secondary hover:bg-elevated hover:text-text-primary')}
        >
          <Flag size={16} />
          Outpost
        </button>
        </div>
        <button onClick={startNewSession} className="inline-flex shrink-0 items-center gap-2 rounded-lg bg-accent-blue px-3 py-2 text-sm font-medium text-white transition hover:opacity-90" title="Start a new session"><Plus size={16} /><span>New session</span></button>
      </div>

      {/* Content */}
      {activeTab === 'tasks' ? (
        <div className="flex min-h-0 flex-1" role="tabpanel" aria-label="Tasks"><TaskBoard
          agentType={agentType}
          tasks={tasks}
          onTasksChange={fetchTasks}
          onAddTask={handleAddTask}
          onTaskClick={handleTaskClick}
        /></div>
      ) : activeTab === 'outpost' ? (
        <section className="min-h-0 flex-1 overflow-y-auto px-5 py-6 md:px-8" role="tabpanel" aria-label="Outpost">
          <div className="mx-auto max-w-5xl">
            {chatAgentId ? <OutpostPanel key={chatAgentId} agentId={chatAgentId} onOpenSession={openSession} /> : <p className="text-sm text-text-secondary">Agent is not available in this workspace yet.</p>}
          </div>
        </section>
      ) : (
        <section className="flex min-h-0 flex-1 flex-col md:flex-row" role="tabpanel" aria-label="Console">
          <aside className={cn('flex flex-none flex-col border-b border-border bg-surface/70 transition-[width,max-height] md:border-b-0 md:border-r', sessionsRailCollapsed ? 'max-h-12 md:w-14' : 'max-h-96 md:max-h-none md:w-96')} aria-label="Recent sessions quick list">
            <div className={cn('flex items-center border-b border-border px-3 py-3', sessionsRailCollapsed ? 'justify-center' : 'justify-between')}>
              {!sessionsRailCollapsed && <div className="flex items-center gap-2 text-sm font-medium"><History size={15} className="text-text-secondary" />Recent sessions<span className="ml-1 text-xs font-normal text-text-secondary">{recentSessions.length}</span></div>}
              <button type="button" onClick={() => setSessionsRailCollapsed(value => !value)} aria-label={sessionsRailCollapsed ? 'Expand recent sessions panel' : 'Collapse recent sessions panel'} title={sessionsRailCollapsed ? 'Expand sessions' : 'Collapse sessions'} className="rounded-md p-1.5 text-text-secondary hover:bg-elevated hover:text-text-primary"><Menu size={16} /></button>
            </div>
            {!sessionsRailCollapsed && <div className="border-b border-border p-2">
              <label className="flex items-center gap-2 rounded-lg border border-border bg-surface px-2.5 py-1.5"><Search size={13} className="shrink-0 text-text-secondary" /><input value={railSearch} onChange={event => setRailSearch(event.target.value)} placeholder="Search sessions" aria-label="Search recent sessions" className="min-w-0 flex-1 bg-transparent text-xs outline-none placeholder:text-text-secondary" /></label>
            </div>}
            {!sessionsRailCollapsed && <div className="min-h-0 flex-1 overflow-y-auto p-2">
              {sessionsLoading ? <p role="status" className="px-3 py-5 text-xs text-text-secondary">Loading sessions…</p> : recentSessions.length === 0 ? <p className="px-3 py-5 text-xs leading-5 text-text-secondary">Your work sessions will appear here.</p> : (() => {
                const visible = recentSessions.filter(session => (session.preview?.trim() || `Session · ${new Date(session.createdAt).toLocaleDateString()}`).toLowerCase().includes(railSearch.toLowerCase()));
                const groups = SESSION_BUCKET_ORDER.map(bucket => ({ bucket, sessions: visible.filter(session => sessionBucket(session.updatedAt || session.createdAt) === bucket) })).filter(group => group.sessions.length);
                if (!groups.length) return <p className="px-3 py-5 text-xs leading-5 text-text-secondary">No sessions match "{railSearch}".</p>;
                return <div className="space-y-4">{groups.map(group => <div key={group.bucket}>
                  <h4 className="px-3 pb-1.5 text-[11px] font-semibold uppercase tracking-wide text-text-secondary">{group.bucket}</h4>
                  <div className="space-y-1">{group.sessions.map(session => {
                    const selected = session.id === sessionId;
                    const title = session.preview?.trim() || `Session · ${new Date(session.createdAt).toLocaleDateString()}`;
                    return <button key={session.id} onClick={() => void openSession(session.id)} disabled={sessionBusy} aria-current={selected ? 'page' : undefined} className={'block w-full rounded-lg px-3 py-2.5 text-left transition-colors disabled:opacity-50 ' + (selected ? 'bg-accent-blue/10 text-accent-blue' : 'text-text-primary hover:bg-elevated')}>
                      <span className="flex items-center gap-1.5 truncate text-sm font-medium">
                        {sessionStatusIcon(session.status, title)}
                        {session.needsApproval && <ShieldAlert size={13} className="shrink-0 text-warning" aria-label={`${title}: needs approval`} />}
                        <span className="truncate">{title}</span>
                      </span>
                      <span className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-text-secondary">
                        <span>{new Date(session.updatedAt || session.createdAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}{session.messageCount ? ` · ${session.messageCount} entries` : ''}</span>
                        {session.status === 'needs_help' && <span className="rounded-full border border-warning/40 bg-warning/10 px-1.5 py-0.5 text-warning">Needs help</span>}
                        {session.needsApproval && <span className="rounded-full border border-warning/40 bg-warning/10 px-1.5 py-0.5 text-warning">Needs approval</span>}
                      </span>
                    </button>;
                  })}</div>
                </div>)}</div>;
              })()}
              {sessionsError && <p role="alert" className="px-3 py-2 text-xs text-danger">{sessionsError}</p>}
            </div>}
          </aside>
          <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-canvas text-text-primary">
          {/* Session activity */}
          <div className="relative flex-1 overflow-y-auto bg-canvas px-5 py-6 md:px-8" role="log" aria-live="polite" aria-label="Console output">
            {messages.length === 0 ? (
              <div className="mx-auto flex min-h-full max-w-3xl flex-col justify-center py-10 font-mono text-sm leading-7">
                <p className="text-success">{config.shortName.toLowerCase()} console · session environment</p>
                <p className="mt-2 text-text-primary">Ready for a QA instruction.</p>
                <p className="text-text-secondary">Type / to browse commands, or describe the outcome you need.</p>
                <p className="mt-5 text-info">Tip: command starters expand into a plain-language instruction before they run.</p>
              </div>
            ) : (
              <>
                {messages.map((msg) => (
                  <MessageBubble key={msg.id} message={msg} onOpenMeeting={setMeetingModalId} onWatchLive={(runId, testName) => setWatchingLive({ runId, testName })} />
                ))}
                <div ref={messagesEndRef} />
              </>
            )}
          </div>

          {/* Instruction composer */}
          <div className="relative bg-transparent px-5 py-4 md:px-8">
            <div className="mx-auto max-w-4xl">
              <div className="overflow-hidden rounded-lg border border-border bg-transparent focus-within:border-accent-blue/60">
                {meetingResults && <div className="p-1">
                  <p className="px-2 py-1 font-mono text-[10px] text-text-secondary">MEETINGS · ENTER to attach</p>
                  <div role="listbox" aria-label="Matching meetings" className="max-h-56 overflow-y-auto">
                    {meetingResults.length ? meetingResults.map((item, index) => <button type="button" key={item.id} role="option" aria-selected={index === meetingResultIndex} onMouseDown={event => { event.preventDefault(); void selectMeetingResult(item); }} className={'flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-left text-sm ' + (index === meetingResultIndex ? 'bg-accent-blue/10 text-text-primary' : 'text-text-primary hover:bg-elevated')}><History size={14} className="shrink-0 text-accent-blue" /><span className="min-w-0 flex-1"><span className="block truncate">{item.title}</span><span className="mt-1 flex items-center gap-1.5"><span className="meeting-meta-chip meeting-meta-chip--blue">{dateTime(meetingTimings[item.id]?.startedAt || item.scheduledStart || item.createdAt)}</span><span className="meeting-meta-chip meeting-meta-chip--purple">{durationLabel(meetingTimings[item.id]?.durationSeconds)}</span></span></span></button>) : <p className="px-3 py-2 text-sm text-text-secondary">No matching meetings found.</p>}
                  </div>
                </div>}
                {!meetingResults && commandSuggestions.length > 0 && <div className="p-1">
                  <div className="flex items-center justify-between px-2 py-1">
                    <p className="font-mono text-[10px] text-text-secondary">COMMANDS · ENTER to insert</p>
                    <div className="flex items-center gap-1">
                      <button type="button" aria-label="Previous command" title="Previous command" onMouseDown={event => event.preventDefault()} onClick={() => { setCommandSuggestionIndex(index => (index - 1 + commandSuggestions.length) % commandSuggestions.length); inputRef.current?.focus(); }} className="rounded p-1 text-text-secondary hover:bg-elevated hover:text-text-primary"><ChevronDown size={14} className="rotate-180" /></button>
                      <button type="button" aria-label="Next command" title="Next command" onMouseDown={event => event.preventDefault()} onClick={() => { setCommandSuggestionIndex(index => (index + 1) % commandSuggestions.length); inputRef.current?.focus(); }} className="rounded p-1 text-text-secondary hover:bg-elevated hover:text-text-primary"><ChevronDown size={14} /></button>
                    </div>
                  </div>
                  <div id="console-command-suggestions" role="listbox" aria-label="Console commands">
                    {commandSuggestions.map((action, index) => <QuickAction key={action.command} id={'console-command-' + index} label={action.label} command={action.command} icon={action.icon} active={index === commandSuggestionIndex} onClick={() => handleQuickAction(action.command)} />)}
                  </div>
                </div>}
                {meetingContext && <div className="flex items-center gap-2 border-t border-border px-4 py-2 text-xs"><MeetingAttachmentChip title={meetingContext.meeting.title} wordCount={meetingContext.wordCount} tokenCount={meetingContext.tokenCount} onOpen={() => setMeetingModalId(meetingContext.meeting.id)} onRemove={() => setMeetingContext(null)} /></div>}
                <div className="relative px-4 py-3">
                  <span aria-hidden="true" className="pointer-events-none absolute left-4 top-5 select-none font-mono text-sm font-semibold text-success">$</span>
                  <textarea
                    ref={inputRef}
                    value={input}
                    onChange={(e) => {
                      setInput(e.target.value);
                      setCommandSuggestionIndex(0);
                    }}
                    onKeyDown={handleKeyDown}
                    disabled={sessionBusy}
                    aria-label="Console instruction"
                    aria-autocomplete="list"
                    aria-expanded={commandSuggestions.length > 0}
                    aria-controls={commandSuggestions.length ? 'console-command-suggestions' : undefined}
                    aria-activedescendant={commandSuggestions.length ? 'console-command-' + commandSuggestionIndex : undefined}
                    placeholder="/test-cases checkout flow   or   review the password reset flow for high-risk gaps"
                    rows={2}
                    style={{ outline: 'none' }}
                    className="min-h-16 w-full resize-none bg-transparent py-2 pl-9 pr-20 font-mono text-[13px] leading-6 text-text-primary caret-accent-blue outline-none placeholder:text-text-secondary"
                  />
                  <button onClick={sendMessage} disabled={!input.trim() || isLoading || sessionBusy} aria-label="Send instruction" title="Send instruction" className="absolute bottom-4 right-4 inline-flex h-9 w-9 items-center justify-center rounded-md bg-accent-blue text-white transition-colors hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-45">
                    {sessionBusy || isLoading ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
                  </button>
                </div>
              </div>
            </div>
          </div>
          </div>
          <aside className={cn('flex flex-none flex-col border-t border-border bg-surface/70 transition-[width,max-height] md:border-t-0 md:border-l', resultsRailCollapsed ? 'max-h-12 md:w-14' : 'max-h-96 md:max-h-none md:w-96')} aria-label="Results quick list">
            <div className={cn('flex items-center border-b border-border px-3 py-3', resultsRailCollapsed ? 'justify-center' : 'justify-between')}>
              {!resultsRailCollapsed && <div className="flex items-center gap-2 text-sm font-medium"><FileBarChart size={15} className="text-text-secondary" />Results</div>}
              <button type="button" onClick={() => setResultsRailCollapsed(value => !value)} aria-label={resultsRailCollapsed ? 'Expand results panel' : 'Collapse results panel'} title={resultsRailCollapsed ? 'Expand results' : 'Collapse results'} className="rounded-md p-1.5 text-text-secondary hover:bg-elevated hover:text-text-primary"><Menu size={16} /></button>
            </div>
            {!resultsRailCollapsed && <div className="min-h-0 flex-1 overflow-y-auto p-3">
              {chatAgentId ? <WorkflowArtifacts key={chatAgentId} agentId={chatAgentId} standalone /> : <p className="px-1 py-5 text-xs leading-5 text-text-secondary">Agent is not available in this workspace yet.</p>}
            </div>}
          </aside>
        </section>
      )}

      {/* Meeting Details Modal */}
      {meetingModalId && consoleDirectory && <MeetingDetailsModal meetingId={meetingModalId} directory={consoleDirectory} onClose={() => setMeetingModalId(null)} />}

      {/* Live Execution Viewer */}
      {watchingLive && <LiveExecutionViewer runId={watchingLive.runId} testName={watchingLive.testName} onClose={() => setWatchingLive(null)} />}

      {/* Task Modal */}
      <TaskModal
        isOpen={isTaskModalOpen}
        onClose={handleTaskModalClose}
        onSave={handleTaskSave}
        agentType={agentType}
        task={selectedTask}
      />

      {/* Settings Modal */}
      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        config={config}
        agentType={agentType}
        onAgentSaved={agent => setAgentName(agent.name)}
      />
    </div>
  );
}

// Individual page exports
export function QAEngineerPage() {
  return <AgentPage agentType="qae" />;
}

export function AutomationEngineerPage() {
  return <AgentPage agentType="aue" />;
}
