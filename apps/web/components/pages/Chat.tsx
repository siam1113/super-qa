'use client';

import { FormEvent, ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowUp, Bot, Check, CheckCheck, ClipboardList, Filter, Hash, History, LockKeyhole, MessageSquare, MoreHorizontal, Plus, Plug, Reply, Search, Sparkles, Users, Video, X } from 'lucide-react';
import { formatDistanceToNowStrict } from 'date-fns';
import { ChatError, Conversation, ConversationDetail, Directory, Message, chatRequest } from '@/lib/chat';
import { ConversationSetup } from '../chat/ChatSetup';
import { ChatDialog, fieldClass, primaryClass, secondaryClass } from '../chat/ChatDialog';
import { Meetings } from '../chat/Meetings';
import { MeetingAttachmentChip } from '../chat/MeetingAttachmentChip';
import { MeetingHistoryPage, dateTime, durationLabel } from './MeetingHistory';
import { Meeting, MeetingDetail, estimateTokenCount } from '@/lib/meetings';
import { MeetingFeed, MeetingTiming } from '@/lib/calendar';

type Draft = { text: string; requestId: string; replyToId?: string };
type MeetingContext = { meeting: Meeting; notes: { summary: string; items: { kind: string; text: string }[] } | null; wordCount: number; tokenCount: number };
const wordCount = (text: string) => text.trim() ? text.trim().split(/\s+/).length : 0;
type ChatSection = 'conversation' | 'members' | 'meetings' | 'tasks';
const initials = (name: string) => name.split(/[ @._-]+/).slice(0, 2).map(part => part[0]).join('').toUpperCase();
const agentCount = (item: Conversation) => item.agentIds?.length || (item.agentId ? 1 : 0);
const shortName = (email: string) => { const local = email.split('@')[0] || email; const first = local.split(/[._-]+/)[0] || local; return first.charAt(0).toUpperCase() + first.slice(1); };
const memberNamesLabel = (item: Conversation, directory: Directory) => {
  const names = item.memberIds
    .map(id => (id === directory.me.id ? directory.me.email : directory.members.find(member => member.id === id)?.email))
    .filter((email): email is string => Boolean(email))
    .map(shortName);
  const shown = names.slice(0, 3);
  const extra = names.length - shown.length;
  return shown.join(', ') + (extra > 0 ? ' & ' + extra + ' more' : '');
};

function Avatar({ name, agent = false }: { name: string; agent?: boolean }) { return <span className={'flex h-9 w-9 flex-none items-center justify-center rounded-xl text-xs font-semibold ' + (agent ? 'bg-accent-purple/15 text-accent-purple' : 'bg-accent-blue/10 text-accent-blue')}>{agent ? <Bot size={19} /> : initials(name)}</span>; }

type MentionCandidate = { id: string; label: string; hint: string };
function splitMentions(text: string, candidates: MentionCandidate[]): (string | { mention: string })[] {
  if (!candidates.length || !text) return [text];
  const names = [...new Set(candidates.map(item => item.label))].sort((a, b) => b.length - a.length).map(label => label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const pattern = new RegExp('@(?:' + names.join('|') + ')(?=\\s|$)', 'gi');
  const parts: (string | { mention: string })[] = [];
  let last = 0; let match: RegExpExecArray | null;
  while ((match = pattern.exec(text))) {
    if (match.index > last) parts.push(text.slice(last, match.index));
    parts.push({ mention: match[0] });
    last = match.index + match[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}
function MentionText({ text, candidates }: { text: string; candidates: MentionCandidate[] }) {
  return <>{splitMentions(text, candidates).map((part, index) => typeof part === 'string' ? part : <span key={index} className="font-medium text-accent-blue">{part.mention}</span>)}</>;
}

function ProviderGlyph({ provider }: { provider?: 'slack' | 'teams' | null }) {
  if (provider === 'slack') return <span aria-hidden="true" className="inline-block h-[13px] w-[13px] shrink-0 bg-current" style={{ maskImage: 'url(/provider-icons/slack.svg)', WebkitMaskImage: 'url(/provider-icons/slack.svg)', maskRepeat: 'no-repeat', WebkitMaskRepeat: 'no-repeat', maskPosition: 'center', WebkitMaskPosition: 'center', maskSize: 'contain', WebkitMaskSize: 'contain' }} />;
  if (provider === 'teams') return <img src="/provider-icons/teams.svg" width="14" height="14" className="shrink-0 object-contain" alt="" aria-hidden="true" />;
  return <Plug size={12} aria-hidden="true" />;
}

function MeetingProviderGlyph({ provider, size = 14 }: { provider: 'teams' | 'google_meet'; size?: number }) {
  return <img src={provider === 'teams' ? '/provider-icons/teams.svg' : '/provider-icons/meet.svg'} width={size} height={size} className="shrink-0 object-contain" alt="" aria-hidden="true" />;
}

const MEETING_ACTIVITY_LABEL: Record<string, (name: string) => string> = {
  human_joined: name => (name || 'Someone') + ' joined the call',
  human_left: name => (name || 'Someone') + ' left the call',
  agent_joined: name => (name || 'Agent') + ' connected',
  agent_left: name => (name || 'Agent') + ' disconnected',
  meeting_ended: name => (name ? name + ' ended the meeting' : 'Meeting ended'),
};


export function ChatPage({ joinMeeting, onMeetingOpened }: { joinMeeting?: { meeting: Meeting; conversation: Conversation } | null; onMeetingOpened?: () => void }) {
  const [directory, setDirectory] = useState<Directory | null>(null);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const selectedRef = useRef(''); selectedRef.current = selectedId;
  const [detail, setDetail] = useState<ConversationDetail | null>(null);
  const [meetingToOpen, setMeetingToOpen] = useState('');
  const [meetingConversation, setMeetingConversation] = useState<Conversation | null>(null);
  const [meetingContexts, setMeetingContexts] = useState<Record<string, MeetingContext>>({});
  const [meetingLookup, setMeetingLookup] = useState<Record<string, { title: string; wordCount: number; tokenCount: number }>>({});
  const [meetingSearchSeed, setMeetingSearchSeed] = useState({ term: '', token: 0 });
  const [sectionTab, setSectionTab] = useState<ChatSection>('conversation');
  const [meetingContextSelection, setMeetingContextSelection] = useState(false);
  const [error, setError] = useState(''); const [loading, setLoading] = useState(true); const [signedOut, setSignedOut] = useState(false);
  const [filter, setFilter] = useState(''); const [tab, setTab] = useState('all');
  const [memberQuery, setMemberQuery] = useState('');
  const [providerFilter, setProviderFilter] = useState<'all' | 'slack' | 'teams'>('all'); const [filterOpen, setFilterOpen] = useState(false);
  const [dialog, setDialog] = useState<'new' | 'settings' | 'meetings' | null>(null);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({}); const [sending, setSending] = useState<string | null>(null);
  const [actionBusy, setActionBusy] = useState(false); const [olderBusy, setOlderBusy] = useState(false);
  const scroll = useRef<HTMLDivElement>(null); const stickToBottom = useRef(true);
  const composer = useRef<HTMLTextAreaElement>(null);
  const composerHighlight = useRef<HTMLDivElement>(null);
  const [mention, setMention] = useState<{ start: number; query: string } | null>(null);
  const [mentionIndex, setMentionIndex] = useState(0);
  const displayTitle = (item: Conversation) => item.kind !== 'direct' ? item.title : item.agentId ? directory?.agents.find(person => person.id === item.agentId)?.name || item.title : directory?.members.find(person => person.id !== directory.me.id && item.memberIds.includes(person.id))?.email || item.title;
  const conversation = detail ? { ...detail.conversation, title: displayTitle(detail.conversation) } : undefined;
  const conversationAgentIds = conversation?.agentIds?.length ? conversation.agentIds : conversation?.agentId ? [conversation.agentId] : [];
  const conversationAgents = directory?.agents.filter(item => conversationAgentIds.includes(item.id)) || [];
  const agent = conversationAgents.find(item => item.id === conversation?.agentId) || conversationAgents[0];
  const tabIcons: [ChatSection, string, typeof MessageSquare][] = [
    ['conversation', 'Conversation', MessageSquare],
    ...(conversation?.kind === 'group' ? [['members', 'Members', Users] as [ChatSection, string, typeof MessageSquare]] : []),
    ['meetings', 'Meetings', Video],
    ['tasks', 'Tasks', ClipboardList],
  ];
  const draft = drafts[selectedId];
  const selectedMeetingContext = meetingContexts[selectedId];
  const slashMenuOpen = draft?.text.trim() === '/';
  const meetingsCommand = /^\/meetings(?:\s+(.*))?$/i.exec(draft?.text.trim() || '');
  const [allMeetings, setAllMeetings] = useState<Meeting[] | null>(null);
  const [meetingTimings, setMeetingTimings] = useState<Record<string, MeetingTiming>>({});
  const [meetingResults, setMeetingResults] = useState<Meeting[] | null>(null);
  const [meetingResultIndex, setMeetingResultIndex] = useState(0);
  const [meetingChatList, setMeetingChatList] = useState<Meeting[] | null>(null);
  const [meetingChatId, setMeetingChatId] = useState('');
  const [meetingChatDetail, setMeetingChatDetail] = useState<MeetingDetail | null>(null);
  const [meetingChatDraft, setMeetingChatDraft] = useState('');
  const [meetingChatBusy, setMeetingChatBusy] = useState(false);
  const meetingChatRef = useRef(''); meetingChatRef.current = meetingChatId;

  const failed = useCallback((failure: unknown) => {
    if (failure instanceof DOMException && failure.name === 'AbortError') return;
    setError((failure as Error).message);
    if (failure instanceof ChatError && failure.status === 401) { setSignedOut(true); setDirectory(null); setConversations([]); setDetail(null); setDrafts({}); }
  }, []);
  const refreshDirectory = useCallback(async () => { const data = await chatRequest<Directory>('/directory'); setDirectory(data); }, []);
  const refreshConversations = useCallback(async () => { const data = await chatRequest<Conversation[]>('/conversations'); setConversations(data); }, []);
  const refreshDetail = useCallback(async (id: string) => {
    const data = await chatRequest<ConversationDetail>('/conversations/' + id);
    if (selectedRef.current === id) setDetail(previous => {
      if (!previous || previous.conversation.id !== id) return data;
      const fetched = new Set(data.messages.map(message => message.id));
      const earlier = previous.messages.filter(message => !fetched.has(message.id) && message.sequence < (data.messages[0]?.sequence || 0));
      return { ...data, messages: [...earlier, ...data.messages], hasMore: earlier.length ? previous.hasMore : data.hasMore };
    });
  }, []);
  const refreshMeetingChat = useCallback(async () => {
    const id = meetingChatRef.current;
    if (!id) return;
    const data = await chatRequest<MeetingDetail>('/meetings/' + id);
    if (meetingChatRef.current === id) setMeetingChatDetail(data);
  }, []);

  useEffect(() => { let active = true; const controller = new AbortController();
    Promise.all([chatRequest<Directory>('/directory', undefined, controller.signal), chatRequest<Conversation[]>('/conversations', undefined, controller.signal)]).then(([people, chats]) => { if (active) { setDirectory(people); setConversations(chats); } }).catch(failed).finally(() => { if (active) setLoading(false); });
    return () => { active = false; controller.abort(); };
  }, [failed]);

  useEffect(() => {
    if (!directory || signedOut) return;
    let active = true; let inFlight = false;
    async function poll() {
      if (inFlight) return; inFlight = true;
      try {
        const [chats, data] = await Promise.all([chatRequest<Conversation[]>('/conversations'), selectedId ? chatRequest<ConversationDetail>('/conversations/' + selectedId) : Promise.resolve(null)]);
        if (!active) return;
        setConversations(chats);
        if (data && selectedRef.current === selectedId) setDetail(previous => {
          const fetched = new Set(data.messages.map(message => message.id));
          const earlier = previous?.conversation.id === selectedId ? previous.messages.filter(message => !fetched.has(message.id) && message.sequence < (data.messages[0]?.sequence || 0)) : [];
          return { ...data, messages: [...earlier, ...data.messages], hasMore: earlier.length ? previous!.hasMore : data.hasMore };
        });
      } catch (failure) { if (active) { failed(failure); if (failure instanceof ChatError && failure.status === 404) { setSelectedId(''); setDetail(null); } } }
      finally { inFlight = false; }
    }
    poll();
    const events = new EventSource('/api/chat/events', { withCredentials: true });
    events.addEventListener('change', poll);
    events.addEventListener('connected', poll);
    return () => { active = false; events.close(); };
  }, [selectedId, Boolean(directory), signedOut, failed]);

  useEffect(() => {
    if (tab !== 'meetings' || signedOut) return;
    let active = true;
    chatRequest<MeetingFeed>('/meetings/feed').then(feed => { if (active) setMeetingChatList(feed.meetings.filter(item => item.provider !== 'native')); }).catch(failure => { if (active) failed(failure); });
    return () => { active = false; };
  }, [tab, signedOut, failed]);

  useEffect(() => { setMeetingChatDetail(null); if (meetingChatId) void refreshMeetingChat().catch(failed); }, [meetingChatId, refreshMeetingChat, failed]);
  useEffect(() => {
    if (!meetingChatId || signedOut) return;
    let active = true; let polling = false;
    const poll = async () => { if (polling || !active) return; polling = true; try { await refreshMeetingChat(); } catch (failure) { if (active) failed(failure); } finally { polling = false; } };
    poll();
    const events = new EventSource('/api/chat/events', { withCredentials: true });
    events.addEventListener('change', poll);
    events.addEventListener('connected', poll);
    return () => { active = false; events.close(); };
  }, [meetingChatId, signedOut, refreshMeetingChat, failed]);

  useEffect(() => {
    if (!joinMeeting) return;
    selectedRef.current = joinMeeting.conversation.id;
    setSelectedId(joinMeeting.conversation.id);
    setSectionTab('conversation');
    setDetail(null);
    setMeetingConversation(joinMeeting.conversation);
    setMeetingToOpen(joinMeeting.meeting.id);
    setDialog('meetings');
    onMeetingOpened?.();
  }, [joinMeeting, onMeetingOpened]);


  useEffect(() => { if (stickToBottom.current && scroll.current) scroll.current.scrollTop = scroll.current.scrollHeight; }, [detail]);
  useEffect(() => {
    const ids = [...new Set((detail?.messages || []).map(message => message.meetingContextId).filter((id): id is string => Boolean(id) && !meetingLookup[id!]))];
    if (!ids.length) return;
    let active = true;
    Promise.all(ids.map(id => chatRequest<MeetingDetail>('/meetings/' + id).then(result => [id, { title: result.meeting.title, wordCount: result.entries.reduce((sum, entry) => sum + wordCount(entry.text), 0), tokenCount: result.entries.reduce((sum, entry) => sum + estimateTokenCount(entry.text), 0) }] as const).catch(() => null)))
      .then(results => { if (active) setMeetingLookup(previous => { const next = { ...previous }; for (const entry of results) if (entry) next[entry[0]] = entry[1]; return next; }); });
    return () => { active = false; };
  }, [detail?.messages]);
  function select(id: string) { selectedRef.current = id; setSelectedId(id); setDetail(null); setError(''); setSectionTab('conversation'); setMeetingContextSelection(false); setMemberQuery(''); setMention(null); setAllMeetings(null); setMeetingTimings({}); setMeetingResults(null); setMeetingChatId(''); setMeetingChatDetail(null); stickToBottom.current = true; }
  async function postMeetingChatActivity(text: string, replyToId?: string) {
    if (!meetingChatId) return;
    setMeetingChatBusy(true);
    try { await chatRequest('/meetings/' + meetingChatId + '/activity', { requestId: crypto.randomUUID(), text, replyToId }); await refreshMeetingChat(); }
    catch (failure) { failed(failure); } finally { setMeetingChatBusy(false); }
  }
  async function updateMembers(nextMemberIds: string[]) {
    if (!conversation) return;
    setActionBusy(true); setError('');
    try {
      await chatRequest<Conversation>('/conversations/' + conversation.id + '/policy', { memberIds: nextMemberIds, agentId: conversation.agentId, agentIds: conversationAgentIds, instructions: conversation.instructions, agentInstructions: conversation.agentInstructions || {} });
      await refreshDetail(conversation.id); await refreshConversations();
    } catch (failure) { failed(failure); } finally { setActionBusy(false); }
  }
  async function useMeetingAsContext(meetingId: string) {
    try {
      const detail = await chatRequest<MeetingDetail>('/meetings/' + meetingId);
      const notes = detail.runs.find(run => run.kind === 'notes' && run.status === 'done' && run.result)?.result || null;
      const entryWords = detail.entries.reduce((sum, entry) => sum + wordCount(entry.text), 0);
      const entryTokens = detail.entries.reduce((sum, entry) => sum + estimateTokenCount(entry.text), 0);
      setMeetingContexts(previous => ({ ...previous, [selectedId]: { meeting: detail.meeting, notes, wordCount: entryWords, tokenCount: entryTokens } }));
      setMeetingContextSelection(false); setSectionTab('conversation'); requestAnimationFrame(() => composer.current?.focus());
    } catch (failure) { failed(failure); }
  }
  async function selectMeetingResult(meeting: Meeting) {
    updateDraft('');
    setMeetingResults(null);
    await useMeetingAsContext(meeting.id);
  }
  useEffect(() => {
    if (!meetingsCommand) { setMeetingResults(null); return; }
    let active = true;
    (async () => {
      let list = allMeetings;
      if (!list) {
        try {
          const feed = await chatRequest<MeetingFeed>('/meetings/feed');
          list = feed.meetings.filter(item => item.conversationId === selectedId);
          if (active) { setAllMeetings(list); setMeetingTimings(feed.meetingTimings); }
        }
        catch (failure) { if (active) { failed(failure); setMeetingResults([]); } return; }
      }
      if (!active) return;
      const term = (meetingsCommand[1] || '').trim().toLowerCase();
      setMeetingResults(list.filter(item => item.title.toLowerCase().includes(term)));
      setMeetingResultIndex(0);
    })();
    return () => { active = false; };
  }, [meetingsCommand?.[0], selectedId]);
  function updateDraft(text: string, replyToId = draft?.replyToId) { setDrafts(previous => ({ ...previous, [selectedId]: { text, replyToId, requestId: crypto.randomUUID() } })); }
  function detectMention(text: string, cursor: number) {
    const before = text.slice(0, cursor);
    const at = before.lastIndexOf('@');
    if (at === -1 || (at > 0 && !/\s/.test(before[at - 1]))) return null;
    const query = before.slice(at + 1);
    if (/\s/.test(query)) return null;
    return { start: at, query };
  }
  const mentionCandidates = conversation ? [
    ...conversationAgents.map(item => ({ id: item.id, label: item.name, hint: 'Agent' })),
    ...(conversation.kind === 'group' ? conversation.memberIds.filter(id => id !== directory?.me.id).map(id => directory?.members.find(member => member.id === id)).filter((member): member is NonNullable<typeof member> => Boolean(member)).map(member => ({ id: member.id, label: member.email, hint: 'Member' })) : []),
  ] : [];
  const mentionMatches = mention ? mentionCandidates.filter(item => item.label.toLowerCase().includes(mention.query.toLowerCase())).slice(0, 6) : [];
  function selectMention(item: { id: string; label: string }) {
    if (!mention) return;
    const text = draft?.text || '';
    const end = mention.start + 1 + mention.query.length;
    const insert = '@' + item.label + ' ';
    updateDraft(text.slice(0, mention.start) + insert + text.slice(end));
    setMention(null);
    requestAnimationFrame(() => { const node = composer.current; if (!node) return; const pos = mention.start + insert.length; node.focus(); node.setSelectionRange(pos, pos); });
  }
  async function send(event?: FormEvent) {
    event?.preventDefault(); if (!draft?.text.trim() || sending || !conversation) return;
    const id = selectedId; const snapshot = draft; setSending(id); setError(''); stickToBottom.current = true; setMention(null);
    try {
      await chatRequest('/conversations/' + id + '/messages', { ...snapshot, meetingContextId: meetingContexts[id]?.meeting.id });
      setDrafts(previous => previous[id]?.requestId === snapshot.requestId ? { ...previous, [id]: { text: '', requestId: crypto.randomUUID() } } : previous);
      await refreshDetail(id); await refreshConversations(); composer.current?.focus();
    } catch (failure) { failed(failure); } finally { setSending(null); }
  }
  async function task(message: Message) {
    setActionBusy(true); setError('');
    if (!agent) { setError('Add an enabled agent to this conversation before creating a task from a message.'); setActionBusy(false); return; }
    try {
      stickToBottom.current = true;
      await chatRequest('/conversations/' + selectedId + '/messages', { requestId: crypto.randomUUID(), text: '@' + agent.name + ' create a task from this message', replyToId: message.id });
      await refreshDetail(selectedId); await refreshConversations();
    }
    catch (failure) { failed(failure); } finally { setActionBusy(false); }
  }
  async function older() {
    if (!detail?.messages[0]) return;
    const id = selectedId; setOlderBusy(true);
    try {
      const data = await chatRequest<ConversationDetail>('/conversations/' + id + '?before=' + detail.messages[0].id);
      if (selectedRef.current === id) { stickToBottom.current = false; setDetail(previous => previous ? { ...previous, hasMore: data.hasMore, messages: [...data.messages.filter(message => !previous.messages.some(existing => existing.id === message.id)), ...previous.messages] } : data); }
    } catch (failure) { failed(failure); } finally { setOlderBusy(false); }
  }

  const visible = conversations.map(item => ({ ...item, title: displayTitle(item) })).filter(item => item.title.toLowerCase().includes(filter.toLowerCase()) && (tab === 'all' || item.kind === tab) && (providerFilter === 'all' || item.provider === providerFilter));
  const conversationCounts = { all: conversations.length, direct: conversations.filter(item => item.kind === 'direct').length, group: conversations.filter(item => item.kind === 'group').length, meetings: meetingChatList?.length || 0 };
  const providerCounts = { slack: conversations.filter(item => item.provider === 'slack').length, teams: conversations.filter(item => item.provider === 'teams').length };
  const replyingTo = draft?.replyToId ? detail?.messages.find(message => message.id === draft.replyToId) : undefined;
  const canCreateTasks = Boolean(directory && ['owner', 'admin'].includes(directory.me.role));
  if (loading) return <div role="status" className="flex h-full items-center justify-center gap-3 text-text-secondary"><MessageSquare size={20} />Loading your conversations…</div>;
  if (!directory) return <div className="flex h-full flex-col items-center justify-center gap-4 px-6 text-center"><MessageSquare size={40} className="text-accent-blue" /><h1 className="text-xl font-semibold">Your team’s conversations</h1><p role="alert" className="text-sm text-text-secondary">{error || 'Chat is unavailable.'}</p><a className={primaryClass} href="/login">Sign in to your app</a></div>;

  return <div className="flex h-full min-h-0 flex-col bg-canvas text-text-primary">
    <div className="flex min-h-0 flex-1 bg-canvas text-text-primary">
    <aside className={(selectedId || meetingChatId ? 'hidden md:flex ' : 'flex ') + 'w-full flex-col border-r border-border bg-surface md:w-[400px] md:flex-none'} aria-label="Conversations">
      <div className="flex items-center gap-2 border-b border-border/80 px-4 py-4">
        <label className="flex min-w-0 flex-1 items-center gap-2.5 rounded-xl border border-border bg-canvas/80 px-3 py-2.5 transition-colors focus-within:border-accent-blue/50 focus-within:ring-2 focus-within:ring-accent-blue/10"><Search size={15} className="shrink-0 text-text-secondary" /><input aria-label="Search conversations" value={filter} onChange={event => setFilter(event.target.value)} placeholder="Search conversations" className="w-full bg-transparent text-sm outline-none placeholder:text-text-secondary/75" /></label>
        <button aria-label="New conversation" title="New conversation" onClick={() => setDialog('new')} className="group shrink-0 rounded-xl border border-accent-blue/25 bg-accent-blue/10 p-2.5 text-accent-blue shadow-sm transition duration-200 hover:-translate-y-0.5 hover:border-accent-blue/50 hover:bg-accent-blue/15 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent-blue"><Plus size={18} className="transition-transform duration-200 group-hover:rotate-90" /></button>
      </div>
      <nav className="flex items-center gap-1.5 overflow-x-auto border-b border-border/80 px-4 py-3" aria-label="Conversation filters">
        {([
          ['all', 'All', 'All conversations'],
          ['direct', 'Personal', 'Personal — one-to-one conversations'],
          ['group', 'Groups', 'Groups — group conversations'],
          ['meetings', 'Meeting Chat', 'Meeting Chat — chat threads for Teams & Google Meet calls you have joined'],
        ] as const).map(([value, label, hint]) => <button key={value} aria-pressed={tab === value} title={hint} onClick={() => { setTab(value); if (value === 'meetings') select(''); else setMeetingChatId(''); }} className={'inline-flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] font-medium transition-colors ' + (tab === value ? 'bg-elevated text-text-primary shadow-sm ring-1 ring-inset ring-border' : 'text-text-secondary hover:bg-elevated/70 hover:text-text-primary')}>
          <span>{label}</span>
          <span className={'text-[10px] ' + (tab === value ? 'text-accent-blue' : 'text-text-secondary/75')}>{conversationCounts[value]}</span>
        </button>)}
        <div className="relative ml-auto">
          <button type="button" aria-label="Filter conversations by provider" aria-expanded={filterOpen} aria-haspopup="true" title="Filter by provider" onClick={() => setFilterOpen(open => !open)} className={'grid h-8 w-8 place-items-center rounded-lg border transition-colors ' + (providerFilter !== 'all' ? 'border-accent-blue/30 bg-accent-blue/10 text-accent-blue' : 'border-transparent text-text-secondary hover:border-border hover:bg-elevated hover:text-text-primary')}><Filter size={15} /></button>
          {filterOpen && <div role="group" aria-label="Filter by provider" className="absolute right-0 top-10 z-20 w-48 rounded-xl border border-border bg-surface p-2 shadow-xl">
            <p className="px-2 pb-1.5 pt-1 text-[10px] font-semibold uppercase tracking-wider text-text-secondary">Provider</p>
            {([['all', 'All providers', conversations.length], ['slack', 'Slack', providerCounts.slack], ['teams', 'Teams', providerCounts.teams]] as const).map(([value, label, count]) => <button key={value} type="button" aria-pressed={providerFilter === value} onClick={() => { setProviderFilter(value); setFilterOpen(false); }} className={'flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-xs transition-colors ' + (providerFilter === value ? 'bg-accent-blue/10 text-text-primary' : 'text-text-secondary hover:bg-elevated hover:text-text-primary')}><span className="flex min-w-0 flex-1 items-center gap-2">{value === 'all' ? <Plug size={13} /> : <ProviderGlyph provider={value} />}{label}</span><span className="text-[10px] text-text-secondary">{count}</span></button>)}
          </div>}
        </div>
      </nav>
      <div className="flex-1 space-y-1 overflow-y-auto p-2.5">
        {tab === 'meetings' ? <>
          {(meetingChatList || []).filter(item => item.title.toLowerCase().includes(filter.toLowerCase())).map(item => <button key={item.id} onClick={() => setMeetingChatId(item.id)} aria-current={meetingChatId === item.id ? 'true' : undefined} className={'group relative flex w-full items-center gap-3 rounded-xl p-3 text-left transition duration-150 ' + (meetingChatId === item.id ? 'bg-accent-blue/10 shadow-sm ring-1 ring-inset ring-accent-blue/20' : 'hover:bg-elevated/80')}>
            {meetingChatId === item.id && <span className="absolute inset-y-3 left-0 w-0.5 rounded-full bg-accent-blue" />}
            <span className={'flex h-10 w-10 flex-none items-center justify-center rounded-xl border transition-colors ' + (meetingChatId === item.id ? 'border-accent-blue/20 bg-accent-blue/10 text-accent-blue' : 'border-border bg-canvas text-text-secondary group-hover:text-text-primary')}><MeetingProviderGlyph provider={item.provider as 'teams' | 'google_meet'} size={18} /></span>
            <span className="min-w-0 flex-1"><span className="flex items-center justify-between gap-2"><span className="truncate text-[13px] font-medium">{item.title}</span><time className="shrink-0 text-[10px] text-text-secondary/75" dateTime={item.createdAt} title={new Date(item.scheduledStart || item.createdAt).toLocaleString()}>{formatDistanceToNowStrict(new Date(item.scheduledStart || item.createdAt), { addSuffix: false })}</time></span><span className="mt-1 block truncate text-[11px] text-text-secondary">{item.provider === 'teams' ? 'Microsoft Teams' : 'Google Meet'} · {item.status}</span></span>
          </button>)}
          {meetingChatList !== null && !meetingChatList.length && <div className="px-4 py-10 text-center"><span className="mx-auto mb-3 grid h-10 w-10 place-items-center rounded-xl border border-border bg-canvas text-text-secondary"><Video size={16} /></span><p className="text-sm font-medium">No meeting chats yet</p><p className="mt-1 text-xs leading-5 text-text-secondary">Join a Teams or Google Meet call to see its chat here.</p></div>}
        </> : <>
        {visible.map(item => <button key={item.id} onClick={() => select(item.id)} aria-current={selectedId === item.id ? 'true' : undefined} className={'group relative flex w-full items-center gap-3 rounded-xl p-3 text-left transition duration-150 ' + (selectedId === item.id ? 'bg-accent-blue/10 shadow-sm ring-1 ring-inset ring-accent-blue/20' : 'hover:bg-elevated/80')}>
          {selectedId === item.id && <span className="absolute inset-y-3 left-0 w-0.5 rounded-full bg-accent-blue" />}
          <span className={'flex h-10 w-10 flex-none items-center justify-center rounded-xl border transition-colors ' + (selectedId === item.id ? 'border-accent-blue/20 bg-accent-blue/10 text-accent-blue' : 'border-border bg-canvas text-text-secondary group-hover:text-text-primary')}>{item.kind === 'group' ? <Users size={18} /> : item.kind === 'external' ? <ProviderGlyph provider={item.provider} /> : item.agentId ? <Bot size={18} /> : <span className="text-xs font-semibold">{initials(item.title)}</span>}</span>
          <span className="min-w-0 flex-1"><span className="flex items-center justify-between gap-2"><span className="flex min-w-0 items-center gap-1.5"><span className="truncate text-[13px] font-medium">{item.title}</span></span><time className="shrink-0 text-[10px] text-text-secondary/75" dateTime={item.updatedAt} title={new Date(item.updatedAt).toLocaleString()}>{formatDistanceToNowStrict(new Date(item.updatedAt), { addSuffix: false })}</time></span><span className="mt-1 block truncate text-[11px] text-text-secondary">{item.archived ? 'Disconnected' : item.kind === 'group' ? item.memberIds.length + (item.memberIds.length === 1 ? ' person' : ' people') + (agentCount(item) ? ', ' + agentCount(item) + (agentCount(item) === 1 ? ' agent' : ' agents') : '') : item.kind === 'external' ? 'Read-only conversation' : item.agentId ? 'Agent conversation' : 'Personal conversation'}</span></span>
        </button>)}
        {!visible.length && <div className="px-4 py-10 text-center"><span className="mx-auto mb-3 grid h-10 w-10 place-items-center rounded-xl border border-border bg-canvas text-text-secondary"><Search size={16} /></span><p className="text-sm font-medium">{filter ? 'No matches found' : 'Nothing here yet'}</p><p className="mt-1 text-xs leading-5 text-text-secondary">{filter ? 'Try another name or clear your search.' : 'Start a conversation to bring your team together.'}</p><button className="mt-3 text-xs font-medium text-accent-blue hover:underline" onClick={() => filter ? setFilter('') : setDialog('new')}>{filter ? 'Clear search' : 'Start a conversation'}</button></div>}
        </>}
      </div>
    </aside>

    <section className={(selectedId || meetingChatId ? 'flex ' : 'hidden md:flex ') + 'min-w-0 flex-1 flex-col'} aria-label="Current conversation">
      {!selectedId && !meetingChatId ? <div className="relative flex flex-1 flex-col items-center justify-center overflow-hidden px-6 py-10 text-center" style={{ backgroundImage: 'radial-gradient(ellipse at 50% 42%, color-mix(in srgb, var(--accent-blue) 10%, transparent), transparent 44%), radial-gradient(ellipse at 78% 18%, color-mix(in srgb, var(--accent-purple) 7%, transparent), transparent 34%)' }}>
        <div className="pointer-events-none absolute inset-0 opacity-[.035]" style={{ backgroundImage: 'radial-gradient(var(--text-secondary) .65px, transparent .65px)', backgroundSize: '16px 16px', maskImage: 'linear-gradient(to bottom, black, transparent 78%)' }} />
        <div className="relative w-full max-w-xl">
          <div className="relative mx-auto mb-7 grid h-[76px] w-[76px] place-items-center rounded-[25px] border border-accent-blue/25 bg-surface/85 text-accent-blue shadow-[0_16px_60px_color-mix(in_srgb,var(--accent-blue)_12%,transparent)] backdrop-blur"><div className="absolute inset-2 rounded-[18px] border border-white/5" /><MessageSquare size={31} strokeWidth={1.5} /><Sparkles size={14} className="absolute -right-2 -top-2 text-accent-purple" /></div>
          <p className="mb-3 text-[10px] font-semibold uppercase tracking-[.2em] text-accent-blue">Your team, in sync</p>
          <h2 className="text-3xl font-semibold tracking-[-.045em] sm:text-[38px]">Make room for good ideas.</h2>
          <p className="mx-auto mt-4 max-w-md text-sm leading-6 text-text-secondary">Start a one-to-one, bring a group together, or invite an AI teammate to help turn the conversation into action.</p>
          <button onClick={() => setDialog('new')} className="mt-7 inline-flex items-center rounded-xl bg-accent-blue px-4 py-2.5 text-sm font-medium text-white shadow-lg shadow-accent-blue/15 transition duration-200 hover:-translate-y-0.5 hover:shadow-xl hover:shadow-accent-blue/20"><Plus size={16} className="mr-2" />Start a conversation</button>
          <div className="mx-auto mt-12 grid max-w-lg grid-cols-3 border-t border-border/70 pt-5 text-left">
            {[['01', 'Personal', 'A quick one-to-one'], ['02', 'Groups', 'Bring everyone in'], ['03', 'AI teammates', 'Move work forward']].map(([number, title, description]) => <div key={number} className="px-3 first:pl-0 last:pr-0"><span className="text-[9px] font-medium tracking-wider text-accent-blue/80">{number}</span><p className="mt-1 text-xs font-medium">{title}</p><p className="mt-1 text-[10px] leading-4 text-text-secondary">{description}</p></div>)}
          </div>
        </div>
      </div> : meetingChatId ? (!meetingChatDetail ? <div role="status" className="m-auto flex items-center gap-3 rounded-xl border border-border bg-surface px-4 py-3 text-sm text-text-secondary"><span className="h-2 w-2 animate-pulse rounded-full bg-accent-blue" />Opening meeting chat…</div> : <>
        <header className="flex min-h-[60px] items-center gap-3 border-b border-border bg-surface px-4 md:px-7">
          <button className="rounded-lg p-2 md:hidden" aria-label="Back to meeting chats" onClick={() => setMeetingChatId('')}><ArrowLeft size={18} /></button>
          <span className="rounded-xl bg-elevated p-2.5 text-text-secondary"><MeetingProviderGlyph provider={meetingChatDetail.meeting.provider as 'teams' | 'google_meet'} size={20} /></span>
          <div className="min-w-0 flex-1"><h2 className="truncate font-semibold">{meetingChatDetail.meeting.title}</h2><p className="mt-1 truncate text-xs text-text-secondary">{meetingChatDetail.meeting.provider === 'teams' ? 'Microsoft Teams' : 'Google Meet'} · {new Date(meetingChatDetail.meeting.scheduledStart || meetingChatDetail.meeting.createdAt).toLocaleString()}</p></div>
          {meetingChatDetail.meeting.url && <a className={primaryClass} href={meetingChatDetail.meeting.url} target="_blank" rel="noreferrer">Open meeting</a>}
        </header>
        {error && <div role="alert" className="flex items-center gap-3 border-b border-danger/20 bg-danger/10 px-5 py-3 text-sm text-danger"><span className="flex-1">{error}</span><button aria-label="Dismiss error" onClick={() => setError('')}><X size={16} /></button></div>}
        <div className="flex-1 space-y-5 overflow-y-auto px-4 py-7 md:px-8" role="log" aria-label="Meeting chat">
          {!meetingChatDetail.activity?.length ? <div className="mx-auto mt-12 max-w-sm text-center"><Hash size={24} className="mx-auto mb-4 text-text-secondary" /><h3 className="font-medium">No activity yet</h3><p className="mt-2 text-sm text-text-secondary">Joins, leaves, and messages for this call will appear here.</p></div> : meetingChatDetail.activity.map(entry => entry.kind === 'message' ? <article key={entry.id} className="mx-auto flex w-full max-w-3xl gap-3"><Avatar name={entry.authorName || 'Someone'} agent={entry.authorKind === 'agent'} /><div className="min-w-0 flex-1"><div className="mb-1 flex flex-wrap items-center gap-2"><span className="text-sm font-semibold">{entry.authorName || 'Someone'}</span><time className="text-[11px] text-text-secondary" dateTime={entry.createdAt} title={new Date(entry.createdAt).toLocaleString()}>{new Date(entry.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time></div><p className="whitespace-pre-wrap break-words text-sm leading-6">{entry.text}</p></div></article> : <p key={entry.id} className="mx-auto w-full max-w-3xl text-center text-xs text-text-secondary">{(MEETING_ACTIVITY_LABEL[entry.kind]?.(entry.authorName || '') || entry.kind)} · {new Date(entry.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</p>)}
        </div>
        <form className="px-4 py-4 md:px-8" onSubmit={event => { event.preventDefault(); const text = meetingChatDraft.trim(); if (!text) return; setMeetingChatDraft(''); void postMeetingChatActivity(text); }}>
          <div className="mx-auto flex max-w-3xl items-center gap-2"><input aria-label="Write a message" className={fieldClass} maxLength={4000} value={meetingChatDraft} onChange={event => setMeetingChatDraft(event.target.value)} placeholder="Write a message…" disabled={meetingChatBusy} /><button aria-label="Send message" disabled={!meetingChatDraft.trim() || meetingChatBusy} className="rounded-lg bg-accent-blue p-2 text-white hover:opacity-90 disabled:opacity-40"><ArrowUp size={18} /></button></div>
        </form>
      </>) : !detail ? <div role="status" className="m-auto flex items-center gap-3 rounded-xl border border-border bg-surface px-4 py-3 text-sm text-text-secondary"><span className="h-2 w-2 animate-pulse rounded-full bg-accent-blue" />Opening conversation…</div> : <>
        <header className="flex min-h-[60px] items-center gap-3 border-b border-border bg-surface px-4 md:px-7">
          <button className="rounded-lg p-2 md:hidden" aria-label="Back to conversations" onClick={() => select('')}><ArrowLeft size={18} /></button>
          <span className="rounded-xl bg-elevated p-2.5 text-text-secondary">{conversation?.kind === 'group' ? <Users size={20} /> : conversation?.kind === 'external' ? <ProviderGlyph provider={conversation.provider} /> : agent ? <Bot size={20} /> : <MessageSquare size={20} />}</span>
          <div className="min-w-0 max-w-[280px]"><div className="flex min-w-0 items-center gap-2"><h2 className="truncate font-semibold">{conversation?.title}</h2></div>{conversation?.kind === 'group' && <p className="mt-1 truncate text-xs text-text-secondary">{memberNamesLabel(conversation, directory)}{conversationAgents.length ? ' · ' + conversationAgents.map(person => person.name).join(', ') : ''}</p>}{conversation?.kind === 'external' && <p className="mt-1 truncate text-xs text-text-secondary">{conversation.memberIds.length} {conversation.memberIds.length === 1 ? 'person' : 'people'}{conversationAgents.length ? ' · ' + conversationAgents.map(person => person.name).join(', ') : ''}</p>}</div>
          <nav role="tablist" aria-label="Conversation sections" className="flex max-w-[55vw] shrink-0 items-center gap-1 self-stretch overflow-x-auto">
            {tabIcons.map(([id, label, Icon]) => <button key={id} role="tab" aria-selected={sectionTab === id} onClick={() => { setSectionTab(id); if (id !== 'meetings') setMeetingContextSelection(false); }} className={'inline-flex h-full shrink-0 items-center gap-1.5 border-b-2 px-2.5 text-xs font-medium transition ' + (sectionTab === id ? 'border-accent-blue text-accent-blue' : 'border-transparent text-text-secondary hover:border-border hover:text-text-primary')}><Icon size={16} strokeWidth={1.8} className={'shrink-0 ' + (sectionTab === id ? 'text-accent-blue' : '')} /><span className="hidden sm:inline">{label}</span>{id === 'tasks' && <span className="text-[10px]">{detail.tasks.filter(item => item.status === 'open').length}</span>}{id === 'members' && <span className="text-[10px]">{conversation?.memberIds.length}</span>}</button>)}
          </nav>
          <div className="min-w-0 flex-1" />
          {((agent && conversation?.kind === 'direct') || conversation?.kind === 'group') && <button aria-label="Call" title="Call" className="inline-flex items-center gap-2 rounded-lg bg-accent-blue px-3 py-2 text-sm font-medium text-white hover:opacity-90" onClick={() => { setMeetingToOpen(''); setDialog('meetings'); }}><Video size={16} /><span className="hidden sm:inline">Call</span></button>}
          {conversation?.createdBy === directory.me.id && <button aria-label="Conversation settings" onClick={() => setDialog('settings')} className="rounded-lg p-2 text-text-secondary hover:bg-elevated"><MoreHorizontal size={20} /></button>}
        </header>
        {sectionTab === 'conversation' ? <>{conversation?.kind === 'external' && <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-5 py-2 text-xs text-text-secondary"><span>{conversationAgents.length ? directory.modelConfigured ? 'Mention any agent by name when you need a hand.' : 'Agent replies need a configured model.' : 'Your team conversation'}</span></div>}
        {error && <div role="alert" className="flex items-center gap-3 border-b border-danger/20 bg-danger/10 px-5 py-3 text-sm text-danger"><span className="flex-1">{error}</span><button aria-label="Dismiss error" onClick={() => setError('')}><X size={16} /></button></div>}
        <div ref={scroll} onScroll={() => { const element = scroll.current; if (element) stickToBottom.current = element.scrollHeight - element.scrollTop - element.clientHeight < 100; }} className="flex-1 space-y-6 overflow-y-auto px-4 py-7 md:px-8" role="log" aria-label="Messages" aria-live="polite" aria-relevant="additions text">
          {detail.hasMore && <div className="text-center"><button className={secondaryClass} disabled={olderBusy} onClick={older}>{olderBusy ? 'Loading…' : 'Load earlier messages'}</button></div>}
          {!detail.messages.length && <div className="mx-auto mt-12 max-w-sm text-center"><Hash size={24} className="mx-auto mb-4 text-text-secondary" /><h3 className="font-medium">The start of something useful</h3><p className="mt-2 text-sm text-text-secondary">Say hello, share a question, or outline what you’re working on.</p></div>}
          {detail.messages.map(message => {
            const isAgent = message.authorKind === 'agent'; const taskItem = detail.tasks.find(item => item.messageId === message.id); const quoted = detail.messages.find(item => item.id === message.replyToId); const delivery = detail.deliveries.find(item => item.messageId === message.id);
            const taskRequest = detail.messages.find(item => item.authorKind === 'member' && item.replyToId === message.id && /create a task from this message/i.test(item.text));
            const taskBusy = Boolean(taskRequest && detail.messages.some(item => item.authorKind === 'agent' && item.replyToId === taskRequest.id && ['queued', 'running'].includes(item.status)));
            return <article key={message.id} className="message-group group mx-auto flex w-full max-w-3xl gap-3" aria-label={'Message from ' + message.authorName}><Avatar name={message.authorName} agent={isAgent} /><div className="relative min-w-0 flex-1"><div className="message-actions absolute right-0 top-0 z-10 flex items-center gap-1 rounded-lg border border-border bg-surface/95 p-1 shadow-lg backdrop-blur">{message.status === 'sent' && conversation?.kind !== 'external' && <button aria-label={'Reply to ' + message.authorName} title="Reply" className="rounded-md p-1.5 text-text-secondary hover:bg-elevated hover:text-accent-blue" onClick={() => { updateDraft(draft?.text || '', message.id); composer.current?.focus(); }}><Reply size={14} /></button>}{message.status === 'sent' && canCreateTasks && agent && !taskItem && <button aria-label="Create task from message" title={taskBusy ? 'Agent is preparing the task' : 'Create task'} disabled={actionBusy || taskBusy} className="rounded-md p-1.5 text-text-secondary hover:bg-elevated hover:text-accent-blue disabled:opacity-40" onClick={() => task(message)}><ClipboardList size={14} /></button>}</div><div className="mb-2 flex flex-wrap items-center gap-2"><span className="text-sm font-semibold">{message.authorName}</span><time className="text-[11px] text-text-secondary" dateTime={message.createdAt} title={new Date(message.createdAt).toLocaleString()}>{new Date(message.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time>{message.authorId === directory.me.id && <CheckCheck size={12} aria-label="Sent" className="text-text-secondary" />}</div>
              {quoted && !isAgent && <blockquote className="mb-2 truncate border-l-2 border-accent-blue/40 pl-3 text-xs text-text-secondary">{quoted.authorName}: {quoted.text}</blockquote>}
              <div className={isAgent ? 'rounded-xl rounded-tl-sm border border-border bg-surface p-4 shadow-sm' : 'text-sm leading-7'}>
                {message.status === 'queued' || message.status === 'running' ? <p role="status" className="flex items-center gap-2 text-sm text-text-secondary"><span className="h-2 w-2 rounded-full bg-accent-purple motion-safe:animate-pulse" />{message.status === 'queued' ? 'Waiting to respond…' : 'Preparing a response…'}</p> : message.status === 'failed' ? <p className="text-sm text-danger">{message.error}</p> : message.content ? <><p className="whitespace-pre-wrap break-words text-sm leading-7"><MentionText text={message.content.summary} candidates={mentionCandidates} /></p>{message.content.details.length > 0 && <ul className="mt-3 list-disc space-y-2 pl-5 text-sm leading-6 text-text-secondary">{message.content.details.map((item, index) => <li className="whitespace-pre-wrap break-words" key={index}><MentionText text={item} candidates={mentionCandidates} /></li>)}</ul>}{message.content.task && <div className="mt-4 rounded-lg border border-border bg-canvas p-3"><p className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-accent-blue">Suggested task</p><p className="text-sm font-medium">{message.content.task.title}</p><p className="mt-1 whitespace-pre-wrap text-xs leading-5 text-text-secondary">{message.content.task.description}</p>{taskItem && <p className="mt-3 text-xs text-success"><Check size={12} className="mr-1 inline" />Task {taskItem.status === 'done' ? 'completed' : 'created'}</p>}</div>}</> : <p className="whitespace-pre-wrap break-words"><MentionText text={message.text} candidates={mentionCandidates} /></p>}
              </div>
              {taskItem && !message.content?.task && <div className="mt-3 rounded-lg border border-success/20 bg-success/5 p-3"><p className="flex items-center gap-1.5 text-xs font-medium text-success"><Check size={13} />Task created</p><p className="mt-1 text-sm font-medium">{taskItem.title}</p><p className="mt-1 whitespace-pre-wrap text-xs leading-5 text-text-secondary">{taskItem.description}</p></div>}
              {delivery && <div className="mt-2 text-[11px] text-text-secondary"><span className={delivery.status === 'uncertain' || delivery.status === 'failed' ? 'text-warning' : ''}>Provider delivery: {delivery.status}</span></div>}
              {message.meetingContextId && meetingLookup[message.meetingContextId] && <div className="mt-2"><MeetingAttachmentChip title={meetingLookup[message.meetingContextId].title} wordCount={meetingLookup[message.meetingContextId].wordCount} tokenCount={meetingLookup[message.meetingContextId].tokenCount} onOpen={() => { setMeetingToOpen(message.meetingContextId!); setDialog('meetings'); }} /></div>}
            </div></article>;
          })}
        </div>
        <div className="px-4 py-4 md:px-8">{conversation?.kind === 'external' || conversation?.archived ? <p className="mx-auto flex max-w-3xl flex-wrap items-center justify-center gap-2 text-center text-xs text-text-secondary">{conversation.archived ? <>{/* Keep disconnected conversations visibly unavailable. */}This connection is disconnected.</> : <><span className="inline-flex items-center gap-1 rounded-md border border-border bg-surface px-2 py-1 font-medium text-text-primary"><LockKeyhole size={12} />Read only</span><span>Continue in {conversation.provider === 'slack' ? 'Slack' : conversation.provider === 'teams' ? 'Teams' : 'the connected app'} to reply. Agent responses appear there too.</span></>}</p> : <form onSubmit={send} className="relative mx-auto max-w-3xl">{mention && mentionMatches.length > 0 && <div role="listbox" aria-label="Mention suggestions" className="absolute bottom-full left-0 z-20 mb-2 w-64 overflow-hidden rounded-xl border border-border bg-surface shadow-xl">{mentionMatches.map((item, index) => <button type="button" key={item.id} role="option" aria-selected={index === mentionIndex} onMouseDown={event => { event.preventDefault(); selectMention(item); }} className={'flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm ' + (index === mentionIndex ? 'bg-accent-blue/10 text-text-primary' : 'text-text-primary hover:bg-elevated')}>{item.hint === 'Agent' ? <span className="grid h-5 w-5 flex-none place-items-center rounded-md bg-accent-purple/15 text-accent-purple"><Bot size={12} /></span> : <span className="grid h-5 w-5 flex-none place-items-center rounded-md bg-accent-blue/10 text-[10px] font-semibold text-accent-blue">{initials(item.label)}</span>}<span className="min-w-0 flex-1 truncate">{item.label}</span><span className="shrink-0 text-[10px] text-text-secondary">{item.hint}</span></button>)}</div>}{slashMenuOpen && <div role="listbox" aria-label="Chat shortcuts" className="absolute bottom-full left-0 z-20 mb-2 w-72 overflow-hidden rounded-xl border border-border bg-surface shadow-xl"><button type="button" role="option" aria-selected="false" onMouseDown={event => { event.preventDefault(); updateDraft('/meetings '); }} className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm text-text-primary hover:bg-elevated"><History size={14} className="shrink-0 text-accent-blue" /><span className="min-w-0 flex-1"><span className="block font-medium">/meetings</span><span className="block text-xs text-text-secondary">Search past meetings to attach as context</span></span></button></div>}{meetingResults && <div role="listbox" aria-label="Matching meetings" className="absolute bottom-full left-0 z-20 mb-2 w-80 max-h-64 overflow-y-auto rounded-xl border border-border bg-surface shadow-xl">{meetingResults.length ? meetingResults.map((item, index) => <button type="button" key={item.id} role="option" aria-selected={index === meetingResultIndex} onMouseDown={event => { event.preventDefault(); void selectMeetingResult(item); }} className={'flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm ' + (index === meetingResultIndex ? 'bg-accent-blue/10 text-text-primary' : 'text-text-primary hover:bg-elevated')}><History size={14} className="shrink-0 text-accent-blue" /><span className="min-w-0 flex-1"><span className="block truncate">{item.title}</span><span className="mt-1 flex items-center gap-1.5"><span className="meeting-meta-chip meeting-meta-chip--blue">{dateTime(meetingTimings[item.id]?.startedAt || item.scheduledStart || item.createdAt)}</span><span className="meeting-meta-chip meeting-meta-chip--purple">{durationLabel(meetingTimings[item.id]?.durationSeconds)}</span></span></span></button>) : <p className="px-3 py-2 text-sm text-text-secondary">No matching meetings found.</p>}</div>}<div className="overflow-hidden rounded-xl border border-border bg-transparent focus-within:border-accent-blue/60">{draft?.replyToId && <div className="flex items-start gap-3 px-4 py-3"><Reply size={14} className="mt-0.5 shrink-0 text-accent-blue" /><div className="min-w-0 flex-1"><p className="text-xs font-medium text-text-primary">Replying to {replyingTo?.authorName || 'message'}</p><p className="mt-1 truncate text-xs text-text-secondary">{replyingTo?.content?.summary || replyingTo?.text || 'Original message unavailable'}</p></div><button type="button" aria-label="Cancel reply" onClick={() => setDrafts(previous => ({ ...previous, [selectedId]: { ...draft, replyToId: undefined, requestId: crypto.randomUUID() } }))} className="rounded-md p-1 text-text-secondary hover:bg-elevated hover:text-text-primary"><X size={14} /></button></div>}{selectedMeetingContext && <div className="flex items-center gap-2 px-4 py-2 text-xs"><MeetingAttachmentChip title={selectedMeetingContext.meeting.title} wordCount={selectedMeetingContext.wordCount} tokenCount={selectedMeetingContext.tokenCount} onOpen={() => { setMeetingToOpen(selectedMeetingContext.meeting.id); setDialog('meetings'); }} onRemove={() => setMeetingContexts(previous => { const next = { ...previous }; delete next[selectedId]; return next; })} /></div>}<div className="relative"><div ref={composerHighlight} aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden whitespace-pre-wrap break-words px-4 pt-3 text-sm leading-6 text-text-primary">{splitMentions(draft?.text || '', mentionCandidates).map((part, index) => typeof part === 'string' ? <span key={index}>{part}</span> : <span key={index} className="rounded-sm bg-accent-blue/15 font-medium text-accent-blue">{part.mention}</span>)}{(draft?.text || '').endsWith('\n') ? '​' : ''}</div><textarea ref={composer} aria-label="Message" rows={3} maxLength={8000} value={draft?.text || ''} onChange={event => { updateDraft(event.target.value); setMention(detectMention(event.target.value, event.target.selectionStart)); setMentionIndex(0); }} onScroll={event => { if (composerHighlight.current) composerHighlight.current.scrollTop = event.currentTarget.scrollTop; }} onKeyDown={event => { if (mention && mentionMatches.length) { if (event.key === 'ArrowDown') { event.preventDefault(); setMentionIndex(index => (index + 1) % mentionMatches.length); return; } if (event.key === 'ArrowUp') { event.preventDefault(); setMentionIndex(index => (index - 1 + mentionMatches.length) % mentionMatches.length); return; } if (event.key === 'Escape') { event.preventDefault(); setMention(null); return; } if ((event.key === 'Enter' || event.key === 'Tab') && !event.nativeEvent.isComposing) { event.preventDefault(); selectMention(mentionMatches[mentionIndex]); return; } } if (meetingResults && meetingResults.length) { if (event.key === 'ArrowDown') { event.preventDefault(); setMeetingResultIndex(index => (index + 1) % meetingResults.length); return; } if (event.key === 'ArrowUp') { event.preventDefault(); setMeetingResultIndex(index => (index - 1 + meetingResults.length) % meetingResults.length); return; } if (event.key === 'Escape') { event.preventDefault(); setMeetingResults(null); return; } if (event.key === 'Enter' && !event.nativeEvent.isComposing) { event.preventDefault(); void selectMeetingResult(meetingResults[meetingResultIndex]); return; } } if (slashMenuOpen && event.key === 'Enter' && !event.nativeEvent.isComposing) { event.preventDefault(); updateDraft('/meetings '); return; } if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); send(); } }} onBlur={() => setMention(null)} placeholder={agent ? 'Write a message… @' + agent.name + ' can help' : 'Write a message… type @ to mention someone'} style={{ color: 'transparent', caretColor: 'var(--text-primary)', outline: 'none' }} className="relative z-10 block w-full resize-none bg-transparent px-4 pt-3 text-sm leading-6 outline-none placeholder:text-text-secondary/75" /></div><div className="flex items-center justify-between px-3 pb-3"><span className="text-[10px] text-text-secondary">Enter to send · Shift + Enter for a new line</span><button aria-label="Send message" disabled={!draft?.text.trim() || Boolean(sending)} className="rounded-lg bg-accent-blue p-2 text-white hover:opacity-90 disabled:opacity-40"><ArrowUp size={18} /></button></div></div></form>}</div>
        </> : sectionTab === 'members' ? <div className="flex-1 space-y-6 overflow-y-auto bg-canvas p-4 text-text-primary md:p-7">{error && <p role="alert" className="rounded-xl border border-danger/30 bg-danger/5 p-3 text-sm text-danger">{error}</p>}{conversation && <>
          <div>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-text-secondary">{conversation.memberIds.length} {conversation.memberIds.length === 1 ? 'member' : 'members'}</h3>
            <div className="space-y-1.5">{conversation.memberIds.map(id => { const member = id === directory.me.id ? directory.me : directory.members.find(value => value.id === id); if (!member) return null; const isCreator = id === conversation.createdBy; return <div key={id} className="flex items-center gap-3 rounded-xl border border-border bg-surface p-3"><Avatar name={member.email} /><div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{member.email}{id === directory.me.id ? ' (you)' : ''}</p>{isCreator && <p className="text-xs text-text-secondary">Creator</p>}</div>{conversation.createdBy === directory.me.id && id !== directory.me.id && <button aria-label={'Remove ' + member.email} title={'Remove ' + member.email} disabled={actionBusy} className="rounded-lg p-2 text-text-secondary hover:bg-elevated hover:text-danger disabled:opacity-40" onClick={() => updateMembers(conversation.memberIds.filter(value => value !== id))}><X size={16} /></button>}</div>; })}</div>
          </div>
          {conversation.createdBy === directory.me.id && <div>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-text-secondary">Add people</h3>
            <div className="relative">
              <label className="flex items-center gap-2.5 rounded-xl border border-border bg-surface px-3 py-2.5 transition-colors focus-within:border-accent-blue/50 focus-within:ring-2 focus-within:ring-accent-blue/10"><Search size={15} className="shrink-0 text-text-secondary" /><input aria-label="Search team members to add" value={memberQuery} onChange={event => setMemberQuery(event.target.value)} placeholder="Search team members…" className="w-full bg-transparent text-sm outline-none placeholder:text-text-secondary/75" /></label>
              {memberQuery.trim() && (() => { const matches = directory.members.filter(member => !conversation.memberIds.includes(member.id) && member.email.toLowerCase().includes(memberQuery.trim().toLowerCase())); return <div role="listbox" aria-label="Matching team members" className="absolute z-20 mt-2 max-h-56 w-full overflow-y-auto rounded-xl border border-border bg-surface p-2 shadow-xl">{matches.length ? matches.map(member => <button type="button" role="option" key={member.id} disabled={actionBusy} onClick={() => { updateMembers([...conversation.memberIds, member.id]); setMemberQuery(''); }} className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm hover:bg-elevated disabled:opacity-40"><Avatar name={member.email} /><span className="min-w-0 flex-1 truncate">{member.email}</span></button>) : <p className="px-3 py-2 text-sm text-text-secondary">No matching teammates found.</p>}</div>; })()}
            </div>
          </div>}
        </>}</div> : sectionTab === 'tasks' ? <div className="flex-1 space-y-3 overflow-y-auto bg-canvas p-4 text-text-primary md:p-7">{error && <p role="alert" className="rounded-xl border border-danger/30 bg-danger/5 p-3 text-sm text-danger">{error}</p>}{!detail.tasks.length && <div className="rounded-xl border border-border py-16 text-center text-sm text-text-secondary"><ClipboardList className="mx-auto mb-3" size={28} />No tasks in this conversation yet.</div>}{detail.tasks.map(item => <article key={item.id} className="rounded-xl border border-border bg-surface p-4"><div className="flex items-start justify-between gap-4"><div className="min-w-0"><p className="font-medium">{item.title}</p><p className="mt-2 whitespace-pre-wrap text-sm text-text-secondary">{item.description}</p></div><span className="shrink-0 text-xs text-text-secondary">{item.status === 'done' ? 'Completed' : 'Open'}</span></div>{canCreateTasks && item.status === 'open' && <button disabled={actionBusy} className={secondaryClass + ' mt-3'} onClick={async () => { setActionBusy(true); try { await chatRequest('/conversations/' + selectedId + '/tasks/' + item.id + '/done', {}); await refreshDetail(selectedId); } catch (failure) { failed(failure); } finally { setActionBusy(false); } }}>Mark complete</button>}</article>)}</div> : sectionTab === 'meetings' ? <div className="min-h-0 flex-1 overflow-hidden">{error && <p role="alert" className="m-4 rounded-xl border border-danger/30 bg-danger/5 p-3 text-sm text-danger">{error}</p>}<MeetingHistoryPage key={'meetings-' + meetingSearchSeed.token} embedded conversationId={meetingContextSelection ? undefined : conversation?.id} agentIds={conversationAgentIds} selectContextMode={meetingContextSelection} onlyGroup={conversation?.kind === 'group'} onUseAsContext={useMeetingAsContext} initialSearch={meetingSearchSeed.term} /></div> : null}
      </>}
    </section>
    </div>
    {(dialog === 'new' || dialog === 'settings' && conversation) && <ConversationSetup key={dialog + selectedId} directory={directory} conversation={dialog === 'settings' ? conversation : undefined} onClose={() => setDialog(null)} onSaved={saved => { setDialog(null); select(saved.id); refreshConversations().catch(failed); }} />}
    {dialog === 'meetings' && (meetingToOpen ? meetingConversation || conversations.find(item => item.id === selectedId) : conversation) && <Meetings key={meetingToOpen || 'new'} conversation={(meetingToOpen ? meetingConversation || conversations.find(item => item.id === selectedId) : conversation)!} directory={directory} onClose={() => { setDialog(null); setMeetingToOpen(''); setMeetingConversation(null); }} initialMeetingId={meetingToOpen} callOnly={Boolean(meetingToOpen)} startImmediately={!meetingToOpen} />}
  </div>;
}
