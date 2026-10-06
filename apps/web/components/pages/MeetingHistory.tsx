'use client';

import { useCallback, useEffect, useState } from 'react';
import { ArrowUpRight, CheckSquare, Clock, RefreshCw, Search, Sparkles, Users, Video } from 'lucide-react';
import { MeetingFeed } from '@/lib/calendar';
import { Directory, chatRequest } from '@/lib/chat';
import { MeetingDetail } from '@/lib/meetings';
import { ChatDialog, fieldClass, primaryClass, secondaryClass } from '../chat/ChatDialog';

export const dateTime = (value: string) => new Date(value).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
const time = (value: string) => new Date(value).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
export const durationLabel = (seconds: number | null | undefined) => {
  if (seconds == null) return 'Duration unavailable';
  const minutes = Math.round(seconds / 60);
  return minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
};
function MeetingProviderIcon({ provider }: { provider: string }) {
  if (provider === 'teams') return <img src="/provider-icons/teams.svg" width="20" height="20" className="object-contain" alt="" aria-hidden="true" />;
  if (provider === 'google_meet') return <img src="/provider-icons/meet.svg" width="20" height="20" className="object-contain" alt="" aria-hidden="true" />;
  return <Video size={17} />;
}
const meetingDuration = (detail: MeetingDetail) => {
  const seconds = (detail.voices || []).reduce((sum, voice) => sum + voice.seconds, 0) || (detail.meeting.scheduledStart && detail.meeting.scheduledEnd
    ? Math.max(0, (Date.parse(detail.meeting.scheduledEnd) - Date.parse(detail.meeting.scheduledStart)) / 1000)
    : detail.entries.length > 1 ? Math.max(0, (Date.parse(detail.entries.at(-1)!.createdAt) - Date.parse(detail.entries[0].createdAt)) / 1000) : 0);
  if (!seconds) return '—';
  const minutes = Math.round(seconds / 60);
  return minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
};

export function MeetingHistoryPage({ conversationId, agentRole, agentIds, embedded = false, selectContextMode = false, onlyGroup = false, onUseAsContext, initialSearch = '' }: { conversationId?: string; agentRole?: 'qae' | 'aue' | 'superqa'; agentIds?: string[]; embedded?: boolean; selectContextMode?: boolean; onlyGroup?: boolean; onUseAsContext?: (id: string) => void; initialSearch?: string }) {
  const [directory, setDirectory] = useState<Directory | null>(null); const [feed, setFeed] = useState<MeetingFeed | null>(null);
  const [error, setError] = useState(''); const [busy, setBusy] = useState(false); const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState(initialSearch);
  const [meetingId, setMeetingId] = useState('');
  const refresh = useCallback(async (signal?: AbortSignal) => {
    const [people, data] = await Promise.all([chatRequest<Directory>('/directory', undefined, signal), chatRequest<MeetingFeed>('/meetings/feed', undefined, signal)]);
    if (signal?.aborted) return; setDirectory(people); setFeed(data); setError('');
  }, []);
  useEffect(() => {
    const abort = new AbortController(); let polling = false;
    const poll = async () => { if (polling || abort.signal.aborted) return; polling = true; try { await refresh(abort.signal); } catch (failure) { if (!abort.signal.aborted) { setError((failure as Error).message); setFeed(null); setDirectory(null); } } finally { polling = false; if (!abort.signal.aborted) setLoading(false); } };
    void poll(); const events = new EventSource('/api/chat/events', { withCredentials: true }); events.addEventListener('change', poll); events.addEventListener('connected', poll);
    return () => { abort.abort(); events.close(); };
  }, [refresh]);
  const act = async (work: () => Promise<unknown>) => { setBusy(true); setError(''); try { await work(); await refresh(); } catch (failure) { setError((failure as Error).message); } finally { setBusy(false); } };
  const roles = directory?.agents.filter(agent => (!agentRole || agent.kind === agentRole) && (!agentIds?.length || agentIds.includes(agent.id))) || [];
  const agents = new Set(roles.map(agent => agent.id));
  const meetings = feed?.meetings.filter(item => (conversationId ? item.conversationId === conversationId : agents.has(item.agentId) || item.agentParticipants?.some(person => agents.has(person.agentId))) && (!onlyGroup || feed.conversations.find(conversation => conversation.id === item.conversationId)?.kind === 'group') && (!selectContextMode || item.shareTranscriptWithAgents) && item.title.toLowerCase().includes(search.toLowerCase())) || [];
  const selected = feed?.meetings.find(item => item.id === meetingId);

  if (loading) return <div role="status" className="p-8 text-text-secondary">Loading meetings…</div>;
  return <div className={(embedded ? 'h-full min-h-0 ' : 'h-full ') + 'overflow-y-auto bg-canvas p-4 text-text-primary md:p-7'}>
    {!embedded && <header className="mb-6 flex flex-wrap items-center justify-between gap-4"><div><h1 className="text-xl font-semibold tracking-tight">Meetings</h1><p className="mt-1 max-w-xl text-sm leading-5 text-text-secondary">Every conversation, decision, and follow-up—together with its meeting evidence.</p></div><button className={secondaryClass} aria-label="Refresh meeting views" onClick={() => act(() => refresh())} disabled={busy}><RefreshCw size={16} /></button></header>}
    {!directory || !feed ? <a href="/login" className={primaryClass}>Sign in to your app</a> : <>
      <div className="mx-auto w-full max-w-5xl space-y-5 pb-8">
        {selectContextMode && <div className="flex items-start gap-3 rounded-xl border border-accent-blue/20 bg-accent-blue/5 px-4 py-3 text-sm"><Sparkles size={16} className="mt-0.5 shrink-0 text-accent-blue" /><p className="text-text-secondary">Choose a meeting to inspect its notes, then add it to this chat as context.</p></div>}
        <div className="flex flex-wrap items-center justify-between gap-3"><label className="relative block w-full max-w-md"><Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-secondary" /><input aria-label="Search meeting titles" className={fieldClass} style={{ paddingLeft: '2.25rem' }} placeholder="Search meeting titles…" value={search} onChange={change => setSearch(change.target.value)} /></label><span className="text-xs text-text-secondary">{meetings.length} {meetings.length === 1 ? 'meeting' : 'meetings'} · Times shown in {Intl.DateTimeFormat().resolvedOptions().timeZone}</span></div>
        {!meetings.length ? <section className="rounded-2xl border border-dashed border-border bg-surface/60 px-6 py-16 text-center"><span className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-accent-blue/10 text-accent-blue"><Video size={22} /></span><h3 className="mt-4 font-medium">{search ? 'No meetings match your search' : 'No meeting history yet'}</h3><p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-text-secondary">{search ? 'Try another title or clear your search.' : 'Meetings with this agent will appear here with notes and transcript details.'}</p></section> : <section aria-label="Meeting history" className="grid gap-3 lg:grid-cols-2">{meetings.map(item => {
          const agentNames = (item.agentParticipants || []).map(person => directory.agents.find(agent => agent.id === person.agentId)?.name).filter((name): name is string => Boolean(name));
          const leadAgent = directory.agents.find(agent => agent.id === item.agentId)?.name;
          const participantCount = item.attendees.length || item.participantMemberIds?.length || feed.conversations.find(conversation => conversation.id === item.conversationId)?.memberIds.length || 0;
          const timing = feed.meetingTimings?.[item.id];
          const startedAt = timing?.startedAt || item.scheduledStart || item.createdAt;
          const endedAt = timing?.endedAt || item.scheduledEnd;
          const highlights = feed.meetingHighlights?.[item.id] || [];
          return <button key={item.id} onClick={() => setMeetingId(item.id)} className="group rounded-2xl border border-border bg-surface p-4 text-left shadow-[var(--shadow-panel)] transition duration-200 hover:-translate-y-0.5 hover:border-accent-blue/35 hover:bg-elevated focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-blue/50">
            <div className="flex items-start gap-3"><span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-accent-blue/10 text-accent-blue transition-colors group-hover:bg-accent-blue/15"><MeetingProviderIcon provider={item.provider} /></span><div className="min-w-0 flex-1"><h3 className="truncate font-semibold tracking-tight">{item.title || 'Untitled meeting'}</h3><p className="mt-1 text-xs text-text-secondary">{dateTime(startedAt)}</p></div><span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-border bg-canvas px-2.5 py-1 text-[10px] font-medium capitalize text-text-secondary"><span className={'h-1.5 w-1.5 rounded-full ' + (item.status === 'ended' ? 'bg-success' : 'bg-accent-blue')} />{item.status.replaceAll('_', ' ')}</span></div>
            <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg bg-canvas/70 px-3 py-2 text-[11px] tabular-nums text-text-secondary"><span>Start <strong className="font-medium text-text-primary">{time(startedAt)}</strong></span><span aria-hidden="true" className="text-border-strong">·</span><span>End <strong className="font-medium text-text-primary">{endedAt ? time(endedAt) : item.stopped ? 'Unavailable' : 'In progress'}</strong></span><span aria-hidden="true" className="text-border-strong">·</span><span>{durationLabel(timing?.durationSeconds)}</span></div>
            <div className="mt-3"><p className="text-[10px] font-semibold uppercase tracking-[.14em] text-text-secondary">Highlights</p>{highlights.length ? <ul className="mt-2 list-disc space-y-1 pl-4 text-xs leading-5 text-text-secondary">{highlights.map((highlight, index) => <li key={index}>{highlight}</li>)}</ul> : <p className="mt-1 text-xs text-text-secondary">Meeting highlights aren’t available yet.</p>}</div>
            <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-border/70 pt-3 text-xs text-text-secondary"><span className="inline-flex items-center gap-1.5"><Users size={13} />{participantCount} participants</span><span className="inline-flex min-w-0 items-center gap-1.5"><Sparkles size={13} className="shrink-0 text-accent-purple" /><span className="truncate">{agentNames.join(', ') || leadAgent || 'Agent meeting'}</span></span><ArrowUpRight size={15} className="ml-auto text-text-secondary transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-accent-blue" /></div>
          </button>;
        })}</section>}
        {!feed.configured.meetingBot && <p className="flex items-start gap-2 rounded-xl border border-warning/25 bg-warning/5 p-3 text-xs leading-5 text-warning"><span className="mt-0.5">⚠</span><span>Automatic meeting joins need meeting-bot setup.</span></p>}
      </div>
      {selected && <MeetingDetailsModal key={selected.id} meetingId={selected.id} directory={directory} onClose={() => setMeetingId('')} onUseAsContext={onUseAsContext} />}
    </>}
  </div>;
}

export function MeetingDetailsModal({ meetingId, directory, onClose, onUseAsContext }: { meetingId: string; directory: Directory; onClose: () => void; onUseAsContext?: (id: string) => void }) {
  const [detail, setDetail] = useState<MeetingDetail | null>(null);
  const [tab, setTab] = useState<'summary' | 'actions' | 'participants' | 'transcript'>('summary');
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    let polling = false;
    const load = async () => {
      if (polling) return; polling = true;
      try { const next = await chatRequest<MeetingDetail>('/meetings/' + meetingId); if (active) { setDetail(next); setError(''); } }
      catch (failure) { if (active) setError((failure as Error).message); }
      finally { polling = false; }
    };
    void load();
    const events = new EventSource('/api/chat/events', { withCredentials: true }); events.addEventListener('change', load); events.addEventListener('connected', load);
    return () => { active = false; events.close(); };
  }, [meetingId]);
  const meeting = detail?.meeting;
  const participants = meeting?.attendees.length || meeting?.participantMemberIds?.length || 0;
  const tabs = [
    { id: 'summary' as const, label: 'Summary' },
    { id: 'actions' as const, label: 'Action Items' },
    { id: 'participants' as const, label: 'Participants' },
    { id: 'transcript' as const, label: 'Transcript' },
  ];
  const notes = detail?.runs.filter(run => run.kind === 'notes' && run.result) || [];
  const actions = notes.flatMap(run => run.result?.items.filter(item => item.kind === 'action') || []);
  const memberIds = meeting?.participantMemberIds || [];
  const agentParticipants = meeting?.agentParticipants || [{ agentId: meeting?.agentId || '', role: '' }];

  return <ChatDialog title={meeting?.title || 'Meeting details'} onClose={onClose} wide>
    {!detail ? <div role={error ? 'alert' : 'status'} className="py-12 text-center text-sm text-text-secondary">{error || 'Loading meeting…'}</div> : <>
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-2xl border border-border bg-canvas/70 px-5 py-4 text-sm">
        <span className="inline-flex items-center gap-2 text-text-secondary"><Clock size={15} className="text-accent-blue" />{meetingDuration(detail)}</span>
        <span className="inline-flex items-center gap-2 text-text-secondary"><Users size={15} className="text-accent-blue" />{participants} participants</span>
        <span className="text-text-secondary">{dateTime(meeting?.scheduledStart || meeting?.createdAt || '')}</span>
      </div>
      <div role="tablist" aria-label="Meeting details" className="flex gap-1 overflow-x-auto border-b border-border">
        {tabs.map(item => <button key={item.id} role="tab" aria-selected={tab === item.id} onClick={() => setTab(item.id)} className={'shrink-0 border-b-2 px-4 py-3 text-sm font-medium transition ' + (tab === item.id ? 'border-accent-blue text-accent-blue' : 'border-transparent text-text-secondary hover:text-text-primary')}>{item.label}</button>)}
      </div>
      <div role="tabpanel" className="min-h-64 max-h-[55vh] overflow-y-auto py-2">
        {tab === 'summary' && <div className="space-y-5">{notes.length ? notes.map(run => <article key={run.id} className="rounded-2xl border border-border bg-canvas/60 p-5"><p className="whitespace-pre-wrap text-sm leading-7">{run.result?.summary}</p></article>) : <p className="py-10 text-center text-sm text-text-secondary">No meeting summary has been compiled yet.</p>}</div>}
        {tab === 'actions' && <div className="space-y-3">{actions.length ? actions.map((item, index) => <article key={index} className="flex gap-3 rounded-xl border border-border bg-canvas/60 p-4"><CheckSquare size={17} className="mt-0.5 shrink-0 text-accent-blue" /><div className="min-w-0"><p className="text-sm leading-6">{item.text}</p>{item.evidence.length > 0 && <p className="mt-2 text-xs text-text-secondary">Transcript references: {item.evidence.length}</p>}</div></article>) : <p className="py-10 text-center text-sm text-text-secondary">No action items have been identified yet.</p>}</div>}
        {tab === 'participants' && <div className="space-y-2">{meeting?.attendees.length ? meeting.attendees.map((person, index) => <div key={person.email + index} className="flex items-center gap-3 rounded-xl border border-border bg-canvas/60 px-4 py-3"><span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent-blue/10 text-sm font-medium text-accent-blue">{(person.name || person.email).slice(0, 1).toUpperCase()}</span><span className="min-w-0 flex-1 truncate text-sm">{person.name || person.email}<small className="block truncate text-xs text-text-secondary">{person.email}</small></span><span className="text-xs capitalize text-text-secondary">{person.response || 'Invited'}</span></div>) : memberIds.map(id => { const person = directory.members.find(value => value.id === id); return <div key={id} className="flex items-center gap-3 rounded-xl border border-border bg-canvas/60 px-4 py-3"><span className="flex h-9 w-9 items-center justify-center rounded-full bg-accent-blue/10 text-sm font-medium text-accent-blue">{(person?.email || 'M').slice(0, 1).toUpperCase()}</span><span className="text-sm">{person?.email || 'App member'}</span></div>; })}{agentParticipants.map(person => { const agent = directory.agents.find(value => value.id === person.agentId); return agent && <div key={person.agentId} className="flex items-center gap-3 rounded-xl border border-accent-purple/20 bg-accent-purple/5 px-4 py-3"><span className="flex h-9 w-9 items-center justify-center rounded-full bg-accent-purple/10 text-sm font-medium text-accent-purple">{agent.name.slice(0, 1)}</span><span className="text-sm">{agent.name}<small className="block text-xs text-text-secondary">AI participant</small></span></div>; })}</div>}
        {tab === 'transcript' && <div className="space-y-4">{detail.entries.length ? detail.entries.map((entry, index) => <article key={entry.id} className={'flex ' + (index % 2 ? 'justify-end' : 'justify-start')}><div className={'max-w-[85%] rounded-2xl px-4 py-3 ' + (index % 2 ? 'rounded-tr-sm bg-accent-blue/10' : 'rounded-tl-sm bg-elevated')}><p className="mb-1 text-xs font-semibold text-accent-blue">{entry.speaker}</p><p className="whitespace-pre-wrap text-sm leading-6">{entry.text}</p><time className="mt-2 block text-right text-[11px] text-text-secondary">{time(entry.createdAt)}</time></div></article>) : <p className="py-10 text-center text-sm text-text-secondary">No transcript is available for this meeting.</p>}</div>}
      </div>
      {onUseAsContext && <div className="flex justify-end border-t border-border pt-4"><button className={primaryClass} disabled={!meeting?.shareTranscriptWithAgents} onClick={() => onUseAsContext(meetingId)}>Use these notes in agent chat</button></div>}
    </>}
  </ChatDialog>;
}
