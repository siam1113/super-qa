'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Bot, ClipboardList, Video } from 'lucide-react';
import { Conversation, Directory, chatRequest } from '@/lib/chat';
import { Meeting, MeetingDetail } from '@/lib/meetings';
import { CallSkeleton, ChatDialog, fieldClass, primaryClass, secondaryClass } from './ChatDialog';
import { NativeCall } from './NativeCall';
import { MeetingSummary } from './MeetingSummary';

function detectExternalProvider(value: string): 'teams' | 'google_meet' | null {
  try {
    const url = new URL(value);
    if (url.hostname === 'meet.google.com' && /^\/[a-z]{3}-[a-z]{4}-[a-z]{3}$/.test(url.pathname)) return 'google_meet';
    if (['teams.microsoft.com', 'teams.live.com'].includes(url.hostname) && /^\/(l\/meetup-join|meet)\//.test(url.pathname)) return 'teams';
  } catch {}
  return null;
}

function ProviderIcon({ provider, size = 18 }: { provider: 'teams' | 'google_meet'; size?: number }) {
  return <img src={provider === 'teams' ? '/provider-icons/teams.svg' : '/provider-icons/meet.svg'} width={size} height={size} className="object-contain" alt="" aria-hidden="true" />;
}

export function Meetings({ conversation, directory, onClose, initialMeetingId = '', startImmediately = false, callOnly = false, externalStart = false }: { conversation: Conversation; directory: Directory; onClose: () => void; initialMeetingId?: string; startImmediately?: boolean; callOnly?: boolean; externalStart?: boolean }) {
  const [selected, setSelected] = useState(initialMeetingId); const [detail, setDetail] = useState<MeetingDetail | null>(null);
  const [mode, setMode] = useState<'active' | 'notes'>('active'); const participantMemberIds = conversation.memberIds;
  const callAgentIds = conversation.agentIds?.length ? conversation.agentIds : conversation.agentId ? [conversation.agentId] : [];
  const agentParticipants = callAgentIds.map(agentId => ({ agentId, role: 'Join as a helpful QA teammate. Listen, greet the team, and contribute concise quality guidance.' }));
  const shareTranscriptWithAgents = true; const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const [session, setSession] = useState<string | null>(null); const [entry, setEntry] = useState(''); const [prompt, setPrompt] = useState('');
  const [focusCall, setFocusCall] = useState(callOnly);
  const [showSummary, setShowSummary] = useState(false);
  const requestId = useRef(crypto.randomUUID()); const [pendingCreate, setPendingCreate] = useState<object | null>(null);
  const [externalUrl, setExternalUrl] = useState('');
  const canOperate = ['owner', 'admin'].includes(directory.me.role);
  const isGroup = conversation.kind === 'group';
  const initialStartHandled = useRef(false);
  const selectedRef = useRef(selected); selectedRef.current = selected;
  const refresh = useCallback(async () => {
    const id = selectedRef.current;
    if (id) { const next = await chatRequest<MeetingDetail>('/meetings/' + id); if (id === selectedRef.current) setDetail(next); }
  }, []);
  useEffect(() => { let active = true; let polling = false; const poll = async () => { if (polling || !active) return; polling = true; try { await refresh(); } catch (failure) { if (active) { setError((failure as Error).message); setDetail(null); } } finally { polling = false; } }; void poll(); const events = new EventSource('/api/chat/events', { withCredentials: true }); events.addEventListener('change', poll); events.addEventListener('connected', poll); return () => { active = false; events.close(); window.speechSynthesis?.cancel(); }; }, [refresh]);
  useEffect(() => { setDetail(null); setSession(null); if (selected) void refresh().catch(failure => setError(failure.message)); }, [selected, refresh]);
  const action = async (task: () => Promise<unknown>) => { setBusy(true); setError(''); try { await task(); await refresh(); } catch (failure) { setError((failure as Error).message); } finally { setBusy(false); } };
  const postActivity = (text: string, replyToId?: string) => chatRequest('/meetings/' + selected + '/activity', { requestId: crypto.randomUUID(), text, replyToId }).then(() => undefined);
  const meeting = detail?.meeting; const live = Boolean(meeting && !meeting.stopped && ['live', 'joining'].includes(meeting.status));
  const nativeInCall = Boolean(meeting?.provider === 'native' && live && session);
  const agent = directory.agents.find(value => value.id === meeting?.agentId);
  const liveVoiceStatus = detail?.voices?.some(voice => voice.status === 'live') ? 'live' : detail?.voices?.[0]?.status || 'Waiting for host';
  const create = () => action(async () => {
    const primaryAgent = agentParticipants[0]?.agentId || conversation.agentId || directory.agents[0]?.id;
    if (!primaryAgent) throw new Error('Add a QAE or AUE before starting an agent call.');
    const provider = externalStart ? detectExternalProvider(externalUrl) : 'native';
    if (externalStart && !provider) throw new Error('Enter a valid Teams or Google Meet meeting link.');
    const body = pendingCreate || { requestId: requestId.current, conversationId: conversation.id, agentId: primaryAgent, mode, provider, url: externalStart ? externalUrl : undefined, participantMemberIds: isGroup ? participantMemberIds : conversation.memberIds, agentParticipants: isGroup ? agentParticipants : primaryAgent ? [{ agentId: primaryAgent, role: 'Join as a helpful QA teammate. Listen, greet the caller, and contribute concise quality guidance.' }] : [], shareTranscriptWithAgents: isGroup ? shareTranscriptWithAgents : true, consent: true };
    setPendingCreate(body);
    const created = await chatRequest<Meeting>('/meetings', body); setPendingCreate(null); requestId.current = crypto.randomUUID(); setFocusCall(true); setSelected(created.id);
  });
  useEffect(() => {
    if (!startImmediately || initialStartHandled.current || externalStart) return;
    initialStartHandled.current = true;
    if (!directory.agents.length) { setError('Add a QA agent before starting a call.'); return; }
    void create();
  }, [startImmediately, directory.agents.length, externalStart]);
  const run = (kind: 'notes' | 'reply') => action(async () => { await chatRequest('/meetings/' + selected + '/runs', { requestId: crypto.randomUUID(), kind, prompt: kind === 'reply' ? prompt || 'What is the most useful QA clarification to ask now?' : '' }); setPrompt(''); });

  const dialingMembers = isGroup ? directory.members.filter(person => conversation.memberIds.includes(person.id) && person.id !== directory.me.id) : [];
  const visibleDialingMembers = dialingMembers.slice(0, 4);
  const extraDialingMembers = dialingMembers.length - visibleDialingMembers.length;
  const externalCard = meeting && <div className="meeting-external-card"><div className="flex items-start gap-3">{meeting.provider !== 'native' && <span className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-elevated"><ProviderIcon provider={meeting.provider} size={22} /></span>}<div><p className="call-eyebrow">External meeting</p><h3>{meeting.liveVoice ? 'Live AI participation' : 'Meeting assistant'}</h3><p>Admit the clearly labeled AI bot in the provider’s lobby. {meeting.liveVoice ? 'The bot listens and speaks through GPT-Live, with an AI participant card.' : 'Transcripts appear after admission.'} Host permissions and provider policies still apply.</p></div></div><div className="meeting-external-actions">{meeting.url && <a className={primaryClass} href={meeting.url} target="_blank" rel="noreferrer">Open meeting</a>}{meeting.createdBy === directory.me.id && <button disabled={busy} className={secondaryClass} onClick={() => action(() => chatRequest('/meetings/' + selected + '/sync', {}))}>Refresh provider status</button>}{focusCall && <button type="button" className={secondaryClass} onClick={onClose}>Close</button>}</div></div>;

  const detectedExternalProvider = externalStart ? detectExternalProvider(externalUrl) : null;

  return <ChatDialog title={!selected && externalStart ? 'Join call' : showSummary ? 'Meeting summary' : 'Join meeting'} onClose={onClose} wide={nativeInCall || showSummary} callSetup={Boolean(focusCall && meeting?.provider === 'native' && !nativeInCall && !showSummary)} compact={!nativeInCall && !showSummary && !(focusCall && meeting?.provider === 'native')} immersive={focusCall && nativeInCall} bare={focusCall && Boolean(meeting) && !showSummary}>
    {error && selected && <p role="alert" className="rounded-lg border border-warning/30 p-3 text-sm text-warning">{error}</p>}
    {!selected && externalStart ? <div className="space-y-4">
      <p className="text-sm text-text-secondary">Paste a Teams or Google Meet link to send Super QA into that call right now, instead of waiting for a scheduled invitation.</p>
      <div className="relative">
        <input aria-label="Meeting link" className={fieldClass + (detectedExternalProvider ? ' pr-10' : '')} value={externalUrl} onChange={event => setExternalUrl(event.target.value)} placeholder="https://teams.microsoft.com/l/meetup-join/…" />
        {detectedExternalProvider && <span className="absolute right-3 top-1/2 -translate-y-1/2" role="img" aria-label={detectedExternalProvider === 'teams' ? 'Microsoft Teams link detected' : 'Google Meet link detected'}><ProviderIcon provider={detectedExternalProvider} size={18} /></span>}
      </div>
      <fieldset className="space-y-2">
        <legend className="mb-1 text-sm font-medium text-text-primary">What should Super QA do in the call?</legend>
        <label className={'flex cursor-pointer gap-3 rounded-xl border p-3 transition-colors ' + (mode === 'active' ? 'border-accent-blue bg-accent-blue/5' : 'border-border hover:bg-elevated')}>
          <input type="radio" name="meetingMode" checked={mode === 'active'} onChange={() => setMode('active')} className="mt-1 accent-accent-blue" />
          <span><span className="block text-sm font-medium text-text-primary">Active participant</span><span className="mt-1 block text-xs leading-5 text-text-secondary">Listens, can be asked to reply, and contributes QA guidance in the meeting chat.</span></span>
        </label>
        <label className={'flex cursor-pointer gap-3 rounded-xl border p-3 transition-colors ' + (mode === 'notes' ? 'border-accent-blue bg-accent-blue/5' : 'border-border hover:bg-elevated')}>
          <input type="radio" name="meetingMode" checked={mode === 'notes'} onChange={() => setMode('notes')} className="mt-1 accent-accent-blue" />
          <span><span className="block text-sm font-medium text-text-primary">Silent note-taker</span><span className="mt-1 block text-xs leading-5 text-text-secondary">Only listens and compiles notes after the call. It will not reply or speak.</span></span>
        </label>
      </fieldset>
      {error && <p role="alert" className="text-sm text-warning">{error}</p>}
      <div className="flex justify-end gap-3"><button type="button" className={secondaryClass} onClick={onClose}>Cancel</button><button className={primaryClass} disabled={busy || !externalUrl.trim()} onClick={create}>{busy ? 'Joining…' : 'Join call'}</button></div>
    </div> : !selected ? <div className="call-dialing" role="status">
      <div className={'call-dialing-rings' + (error ? ' call-dialing-rings--error' : '')} aria-hidden="true"><span className="call-dialing-mark">{isGroup ? <Video size={26} /> : <Bot size={26} />}</span></div>
      <div>
        <p className="call-dialing-title">{conversation.title}</p>
        <p className="call-dialing-status">{error ? <span className="text-danger">{error}</span> : <><i aria-hidden="true" /> {isGroup ? 'Starting the group call…' : 'Calling…'}</>}</p>
      </div>
      {!error && dialingMembers.length > 0 && <div className="call-dialing-avatars" aria-label={dialingMembers.length + ' people being called'}>
        {visibleDialingMembers.map(person => <span key={person.id}>{person.email.slice(0, 1).toUpperCase()}</span>)}
        {extraDialingMembers > 0 && <span>+{extraDialingMembers}</span>}
      </div>}
      <div className="call-dialing-actions"><button type="button" className={secondaryClass} onClick={onClose}>Cancel</button>{error && <button className={primaryClass} disabled={busy} onClick={create}>{busy ? 'Retrying…' : 'Try again'}</button>}</div>
    </div> : showSummary && detail ? <MeetingSummary detail={detail} busy={busy} canOperate={canOperate} onBack={() => setShowSummary(false)} onCompile={() => run('notes')} onPublish={id => action(() => chatRequest('/meetings/' + selected + '/runs/' + id + '/publish', {}))} /> : focusCall ? meeting && detail ? meeting.provider === 'native' ? <NativeCall key={selected} title={meeting.title || conversation.title} transcript={detail.entries} notesOnly={meeting.mode === 'notes'} shareTranscript={meeting.shareTranscriptWithAgents !== false} meetingId={selected} live={live} onJoined={setSession} canEndMeeting={meeting.createdBy === directory.me.id && !meeting.stopped} onEndMeeting={async () => { await chatRequest('/meetings/' + selected + '/end', {}); await refresh(); }} onViewSummary={() => setShowSummary(true)} joinedPeers={detail.peers || []} userName={directory.me.email} activity={detail.activity || []} onPostActivity={postActivity} agents={(meeting.agentParticipants?.length ? meeting.agentParticipants : [{ agentId: meeting.agentId, role: '' }]).map(item => ({ id: item.agentId, name: directory.agents.find(value => value.id === item.agentId)?.name || 'QA agent', kind: directory.agents.find(value => value.id === item.agentId)?.kind, status: meeting.mode === 'notes' ? meeting.shareTranscriptWithAgents === false ? 'Transcript sharing off' : 'Selected note-taker' : undefined }))} liveVoice={meeting.liveVoice ? { name: agent?.name || 'QA agent', host: meeting.createdBy === directory.me.id, status: liveVoiceStatus } : undefined} voice={(() => { const spoken = detail.runs.filter(item => item.voiceAt && item.result?.reply).sort((first, second) => Date.parse(second.voiceAt!) - Date.parse(first.voiceAt!))[0]; return spoken ? { at: spoken.voiceAt!, text: spoken.result!.reply! } : undefined; })()} /> : externalCard : <CallSkeleton label="Loading call controls…" /> : <>
      <div className="flex flex-wrap items-center gap-3"><button className={secondaryClass} onClick={() => { window.speechSynthesis?.cancel(); setSelected(''); }}>Back to meetings</button><span className="flex flex-1 items-center gap-2 text-sm"><Bot size={17} className="text-accent-purple" />{agent?.name} · {meeting?.mode === 'notes' ? 'Silent note-taker' : 'Active participant'} · {meeting?.status}</span>{meeting?.createdBy === directory.me.id && !meeting.stopped && <button disabled={busy} className={secondaryClass} onClick={() => action(() => chatRequest('/meetings/' + selected + '/end', {}))}>End meeting / stop agent</button>}</div>
      {meeting && !nativeInCall && <section className="rounded-xl border border-border p-4"><h3 className="font-semibold">{meeting.title || conversation.title}</h3><p className="mt-2 text-sm text-text-secondary">{new Date(meeting.scheduledStart || meeting.createdAt).toLocaleString()}{meeting.scheduledEnd ? ' – ' + new Date(meeting.scheduledEnd).toLocaleTimeString() : ''} · {Intl.DateTimeFormat().resolvedOptions().timeZone} · {meeting.shareTranscriptWithAgents === false ? 'Transcript sharing off' : 'Transcript shared with agents'}</p><details className="mt-3 text-sm"><summary className="cursor-pointer text-accent-blue">{meeting.attendees?.length || meeting.participantMemberIds?.length || conversation.memberIds.length} {meeting.attendees?.length ? 'invitees & RSVP details' : 'selected participants'}</summary><p className="mt-2 text-xs text-text-secondary">Invitees and RSVP states are not proof of call attendance.</p><div className="mt-2 max-h-48 space-y-2 overflow-y-auto">{meeting.attendees?.length ? meeting.attendees.map((person, index) => <p key={person.email + index} className="break-all">{person.name || person.email} · {person.email} <span className="text-text-secondary">{person.response}</span></p>) : (meeting.participantMemberIds || conversation.memberIds).map(id => <p key={id}>{directory.members.find(member => member.id === id)?.email || 'App member'}</p>)}{(meeting.agentParticipants || []).map(participant => <p key={participant.agentId}><Bot size={14} className="mr-1 inline text-accent-purple" />{directory.agents.find(value => value.id === participant.agentId)?.name || 'Agent'} <span className="text-text-secondary">· {participant.role}</span></p>)}</div></details></section>}
      {!detail || !meeting ? <p role="status">Loading meeting…</p> : <div className="space-y-6">
        {meeting?.error && <p role="alert" className="text-sm text-warning">{meeting.error}</p>}
        {meeting?.provider === 'native' ? <NativeCall key={selected} title={meeting.title || conversation.title} transcript={detail.entries} notesOnly={meeting.mode === 'notes'} shareTranscript={meeting.shareTranscriptWithAgents !== false} meetingId={selected} live={live} onJoined={setSession} onViewSummary={() => setShowSummary(true)} joinedPeers={detail.peers || []} userName={directory.me.email} activity={detail.activity || []} onPostActivity={postActivity} agents={(meeting.agentParticipants?.length ? meeting.agentParticipants : [{ agentId: meeting.agentId, role: '' }]).map(item => ({ id: item.agentId, name: directory.agents.find(value => value.id === item.agentId)?.name || 'QA agent', kind: directory.agents.find(value => value.id === item.agentId)?.kind, status: meeting.mode === 'notes' ? meeting.shareTranscriptWithAgents === false ? 'Transcript sharing off' : 'Selected note-taker' : !meeting.liveVoice ? 'GPT-Live unavailable · check API configuration' : undefined }))} liveVoice={meeting.liveVoice ? { name: agent?.name || 'QA agent', host: meeting.createdBy === directory.me.id, status: liveVoiceStatus } : undefined} voice={(() => { const spoken = detail.runs.filter(item => item.voiceAt && item.result?.reply).sort((first, second) => Date.parse(second.voiceAt!) - Date.parse(first.voiceAt!))[0]; return spoken ? { at: spoken.voiceAt!, text: spoken.result!.reply! } : undefined; })()} /> : externalCard}
        {!nativeInCall && <div className="grid gap-6 lg:grid-cols-2">
        <section className="space-y-4">
          <div className="flex items-center justify-between"><h3 className="font-semibold">Transcript</h3><span className="text-xs text-text-secondary">{detail.entries.length} entries · {meeting.shareTranscriptWithAgents === false ? 'not shared with agents' : 'shared with agents'}</span></div>
          <div className="max-h-64 space-y-3 overflow-y-auto rounded-xl border border-border p-4" aria-label="Meeting transcript">{!detail.entries.length && <p className="text-sm text-text-secondary">No transcript yet. Enable your own browser captions or add a manual entry after joining.</p>}{detail.entries.map(item => <article key={item.id} id={'entry-' + item.id}><p className="text-xs text-text-secondary">{item.speaker} · {item.source.replace('_', ' ')}</p><p className="mt-1 whitespace-pre-wrap text-sm">{item.text}</p></article>)}</div>
          {session && live && <form className="flex gap-2" onSubmit={event => { event.preventDefault(); void action(async () => { await chatRequest('/meetings/' + selected + '/entries', { sessionId: session, requestId: crypto.randomUUID(), source: 'manual', text: entry }); setEntry(''); }); }}><input aria-label="Manual transcript entry" className={fieldClass} maxLength={2000} value={entry} onChange={event => setEntry(event.target.value)} placeholder="Add what you said or a written meeting note…" /><button className={secondaryClass} disabled={busy || !entry.trim()}>Add</button></form>}
        </section>
        <section className="space-y-4"><div className="flex items-center gap-2"><ClipboardList size={19} className="text-accent-blue" /><h3 className="flex-1 font-semibold">Notes & follow-ups</h3>{canOperate && <button className={primaryClass} disabled={busy || !detail.entries.length || meeting.shareTranscriptWithAgents === false} onClick={() => run('notes')}>Compile notes</button>}</div><p className="text-xs text-text-secondary">{meeting.shareTranscriptWithAgents === false ? 'Transcript sharing is off. Agents cannot process transcript-based notes or replies.' : 'Actions and context are proposals, not completed work or verified facts. Review cited transcript entries before publishing.'}</p>
          {meeting?.liveVoice && <div className="rounded-xl border border-accent-purple/30 p-4 text-sm"><p>Live AI participation · {liveVoiceStatus || 'Waiting for host audio'}</p><p className="mt-1 text-xs text-text-secondary">{Math.ceil((detail.voices || []).reduce((sum, voice) => sum + voice.seconds, 0))} seconds observed · {(detail.voices || []).every(voice => voice.finalized) ? 'usage finalized' : 'usage not finalized'}</p>{(detail.voices || []).filter(voice => voice.error).map(voice => <p key={voice.agentId} className="mt-2 text-warning">{directory.agents.find(value => value.id === voice.agentId)?.name || 'Agent'}: {voice.error}</p>)}</div>}
          {canOperate && meeting?.mode === 'active' && !meeting.liveVoice && live && <div className="space-y-2 rounded-xl border border-border p-4"><input aria-label="Request for meeting agent" className={fieldClass} value={prompt} onChange={event => setPrompt(event.target.value)} maxLength={1000} placeholder="Ask a question, or request a useful clarification…" /><button disabled={busy || !detail.entries.length || meeting.shareTranscriptWithAgents === false} className={secondaryClass} onClick={() => run('reply')}>Ask agent to participate</button><p className="text-xs text-text-secondary">{meeting.shareTranscriptWithAgents === false ? 'Enable transcript sharing in a new meeting to request transcript-based contributions.' : meeting.provider === 'native' ? 'Reply appears here; play it aloud only when appropriate.' : 'Reply is sent to everyone in the external meeting chat.'}</p></div>}
          {detail.runs.map(item => <article key={item.id} className="space-y-3 rounded-xl border border-border bg-canvas p-4"><div className="flex items-center justify-between text-xs text-text-secondary"><span>{item.kind === 'notes' ? 'Meeting notes' : 'Agent contribution'}</span><span>{item.status}{item.delivery ? ' · delivery ' + item.delivery : ''}</span></div>{item.error && <p className="text-sm text-warning">{item.error}</p>}{item.result && <><p className="whitespace-pre-wrap text-sm">{item.result.summary}</p>{item.result.reply && <div className="rounded-lg bg-accent-purple/10 p-3"><p className="text-sm">{item.result.reply}</p>{meeting?.provider === 'native' && session && live && <button className="mt-2 text-xs text-accent-purple" disabled={busy || !canOperate} onClick={() => action(() => chatRequest('/meetings/' + selected + '/runs/' + item.id + '/play', { sessionId: session }))}>Speak to native call</button>}</div>}{item.result.items.map((proposal, index) => <div key={index} className="border-l-2 border-accent-blue/40 pl-3"><p className="text-[10px] uppercase tracking-wide text-accent-blue">{proposal.kind}</p><p className="mt-1 text-sm">{proposal.text}</p><div className="mt-1 flex flex-wrap gap-2">{proposal.evidence.map((source, sourceIndex) => <a key={source} href={'#entry-' + source} className="text-xs text-text-secondary underline">Source {sourceIndex + 1}</a>)}</div></div>)}{canOperate && <button className={secondaryClass} disabled={busy || Boolean(item.publishedMessageId)} onClick={() => action(() => chatRequest('/meetings/' + selected + '/runs/' + item.id + '/publish', {}))}>{item.publishedMessageId ? 'Published to conversation' : 'Approve & publish notes'}</button>}</>}</article>)}
        </section>
        </div>}
      </div>}
    </>}
  </ChatDialog>;
}
