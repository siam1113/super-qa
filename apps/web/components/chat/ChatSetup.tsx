'use client';

import { FormEvent, useState } from 'react';
import { CheckCircle2, CircleHelp, Eye, LockKeyhole, MessageSquareReply, Search, ShieldCheck, X } from 'lucide-react';
import { Conversation, Directory, Installation, chatMutation, chatRequest } from '@/lib/chat';
import { ChatDialog, Field, FieldSection, SecretField, fieldClass, primaryClass, secondaryClass } from './ChatDialog';

export function ConversationSetup({ directory, conversation, onSaved, onClose }: { directory: Directory; conversation?: Conversation; onSaved: (conversation: Conversation) => void; onClose: () => void }) {
  const [kind, setKind] = useState(conversation?.kind || 'direct');
  const [title, setTitle] = useState(conversation?.title || '');
  const [members, setMembers] = useState<string[]>(conversation?.memberIds || [directory.me.id]);
  const [memberSearch, setMemberSearch] = useState('');
  const [agentIds, setAgentIds] = useState<string[]>(conversation?.agentIds?.length ? conversation.agentIds : conversation?.agentId ? [conversation.agentId] : []);
  const [instructions, setInstructions] = useState(conversation?.instructions || '');
  const [agentInstructions, setAgentInstructions] = useState<Record<string, string>>(conversation?.agentInstructions || {});
  const [sameAsPrimary, setSameAsPrimary] = useState<Record<string, boolean>>({});
  const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  const fixedMembers = Boolean(conversation && kind === 'direct');
  const availableMembers = directory.members
    .filter(member => member.id !== directory.me.id && !members.includes(member.id))
    .filter(member => member.email.toLowerCase().includes(memberSearch.trim().toLowerCase()));
  const initial = (email: string) => email.slice(0, 1).toUpperCase();
  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError('');
    try {
      const selectedAgentIds = [...new Set(kind === 'group' ? agentIds : agentIds.slice(0, 1))];
      const autoTitle = (title.trim() || (selectedAgentIds.length ? directory.agents.find(agent => agent.id === selectedAgentIds[0])?.name : directory.members.find(member => member.id === members.find(id => id !== directory.me.id))?.email) || 'New conversation').slice(0, 100);
      const memberIds = [...new Set([directory.me.id, ...members])].slice(0, 50);
      const sharedInstructions = typeof instructions === 'string' ? instructions : '';
      const perAgentInstructions = Object.fromEntries(Object.entries(agentInstructions).filter(([id, value]) => selectedAgentIds.includes(id) && typeof value === 'string'));
      const payload = conversation
        ? { memberIds, agentId: selectedAgentIds[0] || null, agentIds: selectedAgentIds, instructions: sharedInstructions, agentInstructions: perAgentInstructions }
        : { kind: kind === 'group' ? 'group' as const : 'direct' as const, title: autoTitle, memberIds, agentId: selectedAgentIds[0] || null, agentIds: selectedAgentIds, instructions: sharedInstructions, agentInstructions: perAgentInstructions };
      const result = await chatRequest<Conversation>(conversation ? '/conversations/' + conversation.id + '/policy' : '/conversations', payload);
      onSaved(result);
    } catch (failure) { setError((failure as Error).message); } finally { setBusy(false); }
  }
  return <ChatDialog title={conversation ? 'Conversation settings' : 'Start a conversation'} onClose={onClose}><form onSubmit={submit} className="space-y-5">
    {!conversation && <div className="flex rounded-lg bg-canvas p-1">{['direct', 'group'].map(option => <button type="button" key={option} onClick={() => setKind(option as 'direct' | 'group')} className={'flex-1 rounded-md py-2 text-sm transition-colors duration-150 ' + (kind === option ? 'bg-elevated font-semibold shadow-sm' : 'text-text-secondary')}>{option === 'direct' ? 'Personal' : 'Group'}</button>)}</div>}
    {!conversation && kind === 'group' && <Field label="Group name"><input required maxLength={100} className={fieldClass} value={title} onChange={event => setTitle(event.target.value)} placeholder="e.g. Release quality" /></Field>}
    {kind === 'group' ? <fieldset disabled={fixedMembers} className="space-y-2"><legend className="mb-2 text-sm font-medium">People in your app</legend>
      <div className="relative">
        <div className="flex min-h-12 flex-wrap items-center gap-2 rounded-xl border border-border bg-canvas p-2 focus-within:border-accent-blue focus-within:ring-2 focus-within:ring-accent-blue/20">
          {members.map(id => { const member = directory.members.find(value => value.id === id); return member && <span key={id} className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-accent-blue/20 bg-accent-blue/10 py-1 pl-1 pr-1 text-xs"><span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent-blue/15 text-[10px] font-medium text-accent-blue">{initial(member.email)}</span><span className="truncate">{member.email}{id === directory.me.id ? ' (you)' : ''}</span><button type="button" disabled={id === directory.me.id} aria-label={id === directory.me.id ? 'You must remain in the conversation' : 'Remove ' + member.email} onClick={() => setMembers(current => current.filter(value => value !== id))} className="shrink-0 rounded-full p-1 text-text-secondary hover:bg-accent-blue/10 hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-40"><X size={12} /></button></span>; })}
          <div className="flex min-w-[180px] flex-1 items-center gap-2 px-1"><Search size={15} className="shrink-0 text-text-secondary" /><input aria-label="Search team members" aria-autocomplete="list" aria-controls="group-chat-member-options" aria-expanded={Boolean(memberSearch.trim())} className="min-w-0 flex-1 bg-transparent py-1 text-sm outline-none placeholder:text-text-secondary" value={memberSearch} onChange={event => setMemberSearch(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && memberSearch.trim()) { event.preventDefault(); if (availableMembers.length) { setMembers(current => [...current, availableMembers[0].id]); setMemberSearch(''); } } }} placeholder="Search team members…" /></div>
        </div>
        {memberSearch.trim() && <div id="group-chat-member-options" role="listbox" aria-label="Matching team members" className="absolute z-20 mt-2 max-h-56 w-full overflow-y-auto rounded-xl border border-border bg-surface p-2 shadow-xl">{availableMembers.length ? availableMembers.map(member => <button type="button" role="option" aria-selected="false" key={member.id} onClick={() => { setMembers(current => [...current, member.id]); setMemberSearch(''); }} className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm hover:bg-elevated focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent-blue"><span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent-blue/10 text-xs text-accent-blue">{initial(member.email)}</span><span className="min-w-0 flex-1 truncate">{member.email}</span></button>) : <p className="px-3 py-2 text-sm text-text-secondary">No matching teammates found.</p>}</div>}
      </div>
      {directory.members.length < 2 && <p className="text-sm text-text-secondary">Invite teammates in Settings → Access, or start a chat with an agent.</p>}
    </fieldset> : <fieldset disabled={fixedMembers} className="space-y-2"><legend className="mb-2 text-sm font-medium">People in your app</legend><div className="max-h-40 space-y-1 overflow-auto rounded-lg border border-border bg-canvas p-2">{directory.members.filter(member => member.id !== directory.me.id).map(member => { const selected = members.includes(member.id); return <label key={member.id} className={'flex cursor-pointer items-center gap-3 rounded-lg p-2 text-sm transition-colors ' + (selected ? 'bg-accent-blue/10 ring-1 ring-accent-blue/25' : 'hover:bg-elevated')}><input type="checkbox" className="accent-accent-blue" checked={selected} onChange={event => setMembers(event.target.checked ? kind === 'direct' ? [directory.me.id, member.id] : [...members, member.id] : members.filter(id => id !== member.id))} /><span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent-blue/10 text-xs text-accent-blue">{initial(member.email)}</span><span className="min-w-0 flex-1 truncate">{member.email}</span></label>; })}{directory.members.length < 2 && <p className="p-2 text-sm text-text-secondary">Invite teammates in Settings → Access, or start a chat with an agent.</p>}</div></fieldset>}
    <p className="text-xs text-text-secondary">Everyone added can read this conversation’s history.</p>
    {kind === 'group' ? <fieldset className="space-y-2"><legend className="mb-2 text-sm font-medium">Agents in this chat</legend><div className="space-y-1 rounded-lg border border-border bg-canvas p-2">{directory.agents.filter(agent => agent.enabled || agentIds.includes(agent.id)).map(agent => <label key={agent.id} className="flex cursor-pointer items-center gap-3 rounded-lg p-2 text-sm hover:bg-elevated"><input type="checkbox" checked={agentIds.includes(agent.id)} onChange={event => setAgentIds(current => event.target.checked ? [...current, agent.id] : current.filter(id => id !== agent.id))} /><span className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent-purple/10 text-xs font-medium text-accent-purple">{agent.kind.toUpperCase()}</span><span className="min-w-0 flex-1">{agent.name}</span>{!agent.enabled && <span className="text-xs text-text-secondary">Disabled</span>}</label>)}{!directory.agents.some(agent => agent.enabled) && !agentIds.length && <p className="p-2 text-sm text-text-secondary">No enabled agents are available.</p>}</div><p className="text-xs text-text-secondary">Mention an agent by name in the chat to get its reply.</p></fieldset> : <fieldset disabled={fixedMembers || kind === 'external'} className="space-y-2"><legend className="mb-2 text-sm font-medium">Agent (optional)</legend><div className="space-y-1 rounded-lg border border-border bg-canvas p-2">{directory.agents.filter(agent => agent.enabled || agentIds.includes(agent.id)).map(agent => { const selected = agentIds[0] === agent.id; return <button type="button" key={agent.id} onClick={() => { const next = selected ? [] : [agent.id]; setAgentIds(next); if (next.length) setMembers([directory.me.id]); }} className={'flex w-full items-center gap-3 rounded-lg p-2 text-left text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-60 ' + (selected ? 'bg-accent-blue/10 ring-1 ring-accent-blue/25' : 'hover:bg-elevated')}><span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent-purple/10 text-xs font-medium text-accent-purple">{agent.kind.toUpperCase()}</span><span className="min-w-0 flex-1 truncate">{agent.name}</span>{!agent.enabled && <span className="text-xs text-text-secondary">Disabled</span>}{selected && <CheckCircle2 size={16} className="shrink-0 text-accent-blue" />}</button>; })}{!directory.agents.some(agent => agent.enabled) && !agentIds.length && <p className="p-2 text-sm text-text-secondary">No enabled agents are available.</p>}</div></fieldset>}
    {agentIds.length > 0 && (kind === 'group' ? <section className="space-y-3" aria-label="Agent instructions"><h3 className="text-sm font-medium">Instructions for agents</h3>{agentIds.map((id, index) => { const agent = directory.agents.find(value => value.id === id); if (!agent) return null; const primary = index === 0; const usesShared = !primary && (sameAsPrimary[id] ?? !Object.prototype.hasOwnProperty.call(agentInstructions, id)); return <div key={id} className="space-y-2 rounded-xl border border-border bg-canvas p-3">{primary ? <Field label={'Instructions for ' + agent.name}><textarea rows={3} maxLength={4000} className={fieldClass} value={instructions} onChange={event => setInstructions(event.target.value)} placeholder="Track release risks, review test coverage, and suggest follow-up tasks." /></Field> : <><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={usesShared} onChange={event => { const checked = event.target.checked; setSameAsPrimary(current => ({ ...current, [id]: checked })); if (checked) setAgentInstructions(current => { const next = { ...current }; delete next[id]; return next; }); else setAgentInstructions(current => ({ ...current, [id]: current[id] ?? instructions })); }} />Same instructions as {directory.agents.find(value => value.id === agentIds[0])?.name || 'the first agent'}</label>{!usesShared && <Field label={'Instructions for ' + agent.name}><textarea rows={3} maxLength={4000} className={fieldClass} value={agentInstructions[id] || ''} onChange={event => setAgentInstructions(current => ({ ...current, [id]: event.target.value }))} placeholder={'What should ' + agent.name + ' focus on?'} /></Field>}</>}</div>; })}</section> : <Field label="What should the agent do in this chat?"><textarea rows={4} maxLength={4000} className={fieldClass} value={instructions} onChange={event => setInstructions(event.target.value)} placeholder="Track release risks, help review test coverage, and suggest follow-up tasks." /></Field>)}
    {error && <div role="alert" className="flex items-start gap-2 rounded-xl border border-danger/20 bg-danger/5 p-3 text-sm text-danger"><CircleHelp size={16} className="mt-0.5 shrink-0" />{error}</div>}
    <div className="flex justify-end gap-3"><button type="button" onClick={onClose} className={secondaryClass}>Cancel</button><button className={primaryClass} disabled={busy}>{busy ? 'Saving…' : conversation ? 'Save settings' : 'Start conversation'}</button></div>
  </form></ChatDialog>;
}

export function ConnectionSetup({ directory, provider, installation, onSaved, onClose }: { directory: Directory; provider: 'slack' | 'teams'; installation?: Installation; onSaved: (close?: boolean) => void; onClose: () => void }) {
  const editing = Boolean(installation);
  const [mode, setMode] = useState<'install' | 'credentials'>(!editing ? 'install' : 'credentials');
  const [accessMode, setAccessMode] = useState<'read_only' | 'read_reply'>(installation?.accessMode || 'read_reply');
  const [providerId, setProviderId] = useState(installation?.providerId || ''); const [botId, setBotId] = useState(installation?.botId || ''); const [token, setToken] = useState(''); const [secret, setSecret] = useState('');
  const [error, setError] = useState(''); const [busy, setBusy] = useState(false); const [notice, setNotice] = useState('');
  const providerName = provider === 'slack' ? 'Slack' : 'Microsoft Teams';
  const revealToken = async () => { const result = await chatRequest<{ token: string; signingSecret: string | null }>('/installations/' + installation!.id + '/secret'); if (provider === 'slack' && result.signingSecret) setSecret(result.signingSecret); return result.token; };
  const revealSecret = async () => { const result = await chatRequest<{ token: string; signingSecret: string | null }>('/installations/' + installation!.id + '/secret'); if (result.token) setToken(result.token); return result.signingSecret || ''; };
  async function connect(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError('');
    try { await chatRequest('/installations', { provider, accessMode, providerId, botId, token, ...(provider === 'slack' ? { signingSecret: secret } : {}) }); setToken(''); setSecret(''); setNotice(editing ? 'Connection updated.' : 'Connected. Add the bot to a conversation and mention it once to discover that conversation.'); onSaved(false); }
    catch (failure) { setError((failure as Error).message); } finally { setBusy(false); }
  }
  if (provider === 'teams' && !editing && mode === 'install') return <TeamsConnectSetup onClose={onClose} onUseCredentials={() => setMode('credentials')} />;
  if (provider === 'slack' && !editing && mode === 'install') return <SlackInstallSetup onClose={onClose} onUseCredentials={() => setMode('credentials')} />;
  return <ChatDialog title={editing ? `Edit ${providerName} connection` : `Connect ${providerName}`} onClose={onClose} compact>
    <form onSubmit={connect} className="space-y-4">
      {error && <div role="alert" className="flex items-start gap-2 rounded-xl border border-danger/20 bg-danger/5 p-3 text-sm text-danger"><CircleHelp size={17} className="mt-0.5 shrink-0" />{error}</div>}
      {notice && <div role="status" className="flex items-start gap-2 rounded-xl border border-success/20 bg-success/5 p-3 text-sm text-success"><CheckCircle2 size={17} className="mt-0.5 shrink-0" />{notice}</div>}
      {!editing && <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border bg-canvas p-3 text-sm"><span className="text-text-secondary">{provider === 'slack' ? 'Prefer not to enter Slack app credentials yourself?' : 'Prefer not to enter Azure Bot credentials yourself?'}</span><button type="button" onClick={() => setMode('install')} className="font-medium text-accent-blue hover:underline">Install to your organization instead</button></div>}
      <FieldSection icon={<LockKeyhole size={15} className="text-success" />} label="Provider credentials" hint={<><ShieldCheck size={14} className="mt-0.5 shrink-0 text-success" />Credentials are verified with {providerName} and stored encrypted.</>}>
        <Field label={provider === 'slack' ? 'Workspace ID' : 'Tenant ID'}><input required autoComplete="off" autoCapitalize="none" autoCorrect="off" spellCheck={false} className={fieldClass} value={providerId} onChange={event => setProviderId(event.target.value)} placeholder={provider === 'slack' ? 'T0123ABC456' : 'Tenant UUID'} /></Field>
        <Field label={provider === 'slack' ? 'Bot user ID' : 'Microsoft app ID'}><input required autoComplete="off" autoCapitalize="none" autoCorrect="off" spellCheck={false} className={fieldClass} value={botId} onChange={event => setBotId(event.target.value)} placeholder={provider === 'slack' ? 'U0123ABC456' : 'Application UUID'} /></Field>
        <Field label={provider === 'slack' ? 'Bot token' : 'Client secret'}><SecretField required={!editing} autoComplete="new-password" value={token} onChange={setToken} placeholder={provider === 'slack' ? 'xoxb-…' : 'Paste secret'} onReveal={editing ? revealToken : undefined} /></Field>
        {provider === 'slack' && <Field label="Signing secret"><SecretField required={!editing} autoComplete="new-password" value={secret} onChange={setSecret} placeholder="Paste signing secret" onReveal={editing ? revealSecret : undefined} /></Field>}
      </FieldSection>
      <fieldset className="space-y-2"><legend className="mb-2 text-sm font-medium text-text-primary">Agent access</legend><label className={'flex cursor-pointer gap-3 rounded-xl border p-3 transition-colors ' + (accessMode === 'read_only' ? 'border-accent-blue bg-accent-blue/5' : 'border-border hover:bg-elevated')}><input type="radio" name="accessMode" checked={accessMode === 'read_only'} onChange={() => setAccessMode('read_only')} className="mt-1 accent-accent-blue" /><span><span className="flex flex-wrap items-center gap-2 text-sm font-medium text-text-primary">Read conversations <span className="rounded-full bg-accent-blue/10 px-2 py-0.5 text-[10px] font-semibold text-accent-blue">Read only</span></span><span className="mt-1 block text-xs leading-5 text-text-secondary">The agent can read enabled channels and retain the conversation in this workspace. It will not send replies.</span></span></label><label className={'flex cursor-pointer gap-3 rounded-xl border p-3 transition-colors ' + (accessMode === 'read_reply' ? 'border-accent-blue bg-accent-blue/5' : 'border-border hover:bg-elevated')}><input type="radio" name="accessMode" checked={accessMode === 'read_reply'} onChange={() => setAccessMode('read_reply')} className="mt-1 accent-accent-blue" /><span><span className="flex flex-wrap items-center gap-2 text-sm font-medium text-text-primary">Read and reply <span className="rounded-full bg-success/10 px-2 py-0.5 text-[10px] font-semibold text-success">Recommended</span></span><span className="mt-1 block text-xs leading-5 text-text-secondary">The agent can read enabled channels and send replies when mentioned or otherwise triggered by its chat policy.</span></span></label><p className="text-xs leading-5 text-text-secondary">This controls Super QA behavior. Your provider bot token may still have send permission; in read-only mode the app will not deliver agent replies.</p></fieldset>
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4"><p className="text-xs text-text-secondary">Only enabled conversations are read; replies follow the selected access level.</p><div className="flex gap-2"><button type="button" onClick={onClose} className={secondaryClass}>Cancel</button><button className={primaryClass} disabled={busy}>{busy ? 'Saving…' : editing ? 'Save changes' : 'Connect'}</button></div></div>
    </form>
  </ChatDialog>;
}

/**
 * The recommended way to connect Teams: one shared, multi-tenant Azure Bot app serves every
 * client org, so there are no Azure Bot credentials to enter here — the admin is sent to
 * Microsoft's own admin-consent screen, and the connection is created the moment they grant it.
 * See ChatConnectors.createTeamsConnectUrl/completeTeamsConsent and
 * docs/chat-and-text-integrations.md.
 */
function TeamsConnectSetup({ onClose, onUseCredentials }: { onClose: () => void; onUseCredentials: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function install() {
    setBusy(true); setError('');
    try { const { url } = await chatRequest<{ url: string }>('/installations/teams/connect-url'); window.location.href = url; }
    catch (failure) { setError((failure as Error).message); setBusy(false); }
  }

  return <ChatDialog title="Connect Microsoft Teams" onClose={onClose} compact>
    <div className="space-y-4">
      {error && <div role="alert" className="flex items-start gap-2 rounded-xl border border-danger/20 bg-danger/5 p-3 text-sm text-danger"><CircleHelp size={17} className="mt-0.5 shrink-0" />{error}</div>}
      <FieldSection icon={<LockKeyhole size={15} className="text-success" />} label="How this connects" hint={<><ShieldCheck size={14} className="mt-0.5 shrink-0 text-success" />Super QA never sees or stores your organization&rsquo;s admin credentials — Microsoft handles the grant directly.</>}>
        <ol className="col-span-2 space-y-2 text-sm leading-5 text-text-secondary">
          <li className="flex gap-2.5"><span className="font-semibold text-text-primary">1.</span>You&rsquo;re sent to Microsoft to sign in as a Teams or Global admin for your organization.</li>
          <li className="flex gap-2.5"><span className="font-semibold text-text-primary">2.</span>Microsoft shows the exact permissions below; you review them and grant org-wide admin consent.</li>
          <li className="flex gap-2.5"><span className="font-semibold text-text-primary">3.</span>You&rsquo;re returned here with the connection already made — no tenant ID, app ID, or secret to copy.</li>
        </ol>
      </FieldSection>
      <fieldset className="space-y-2"><legend className="mb-2 text-sm font-medium text-text-primary">What the bot can do</legend>
        <div className="flex flex-wrap gap-1.5 rounded-xl border border-border bg-canvas p-3">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface px-2.5 py-1 text-[11px] text-text-secondary"><Eye size={12} />Read conversations you enable afterward</span>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface px-2.5 py-1 text-[11px] text-text-secondary"><MessageSquareReply size={12} />Reply as your assigned agent (optional)</span>
        </div>
        <p className="text-xs leading-5 text-text-secondary">Nothing is read until you enable a specific conversation. It cannot access Teams admin settings or any other organization&rsquo;s tenant.</p>
      </fieldset>
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
        <button type="button" onClick={onUseCredentials} className="text-xs font-medium text-text-secondary hover:text-text-primary hover:underline">Have your own Azure Bot credentials instead?</button>
        <div className="flex gap-2">
          <button type="button" onClick={onClose} className={secondaryClass}>Cancel</button>
          <button type="button" onClick={() => void install()} disabled={busy} className={primaryClass}>{busy ? 'Redirecting…' : 'Install App'}</button>
        </div>
      </div>
    </div>
  </ChatDialog>;
}

/**
 * The recommended way to connect Slack: one shared, multi-tenant Slack app serves every client
 * org, so there is no bot token to create or paste in — the admin is sent to Slack's own "Add to
 * Slack" OAuth screen, and the connection is created the moment they approve it. See
 * ChatConnectors.createSlackInstallUrl/completeSlackInstall and docs/chat-and-text-integrations.md.
 */
function SlackInstallSetup({ onClose, onUseCredentials }: { onClose: () => void; onUseCredentials: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function install() {
    setBusy(true); setError('');
    try { const { url } = await chatRequest<{ url: string }>('/installations/slack/install-url'); window.location.href = url; }
    catch (failure) { setError((failure as Error).message); setBusy(false); }
  }

  return <ChatDialog title="Connect Slack" onClose={onClose} compact>
    <div className="space-y-4">
      {error && <div role="alert" className="flex items-start gap-2 rounded-xl border border-danger/20 bg-danger/5 p-3 text-sm text-danger"><CircleHelp size={17} className="mt-0.5 shrink-0" />{error}</div>}
      <FieldSection icon={<LockKeyhole size={15} className="text-success" />} label="How this connects" hint={<><ShieldCheck size={14} className="mt-0.5 shrink-0 text-success" />Super QA never sees or stores your workspace&rsquo;s Slack password — Slack handles the approval directly.</>}>
        <ol className="col-span-2 space-y-2 text-sm leading-5 text-text-secondary">
          <li className="flex gap-2.5"><span className="font-semibold text-text-primary">1.</span>You&rsquo;re sent to Slack to sign in and choose the workspace to install into.</li>
          <li className="flex gap-2.5"><span className="font-semibold text-text-primary">2.</span>Slack shows the exact permissions below; you review them and approve the install.</li>
          <li className="flex gap-2.5"><span className="font-semibold text-text-primary">3.</span>You&rsquo;re returned here with the connection already made — no workspace ID, bot token, or signing secret to copy.</li>
        </ol>
      </FieldSection>
      <fieldset className="space-y-2"><legend className="mb-2 text-sm font-medium text-text-primary">What the bot can do</legend>
        <div className="flex flex-wrap gap-1.5 rounded-xl border border-border bg-canvas p-3">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface px-2.5 py-1 text-[11px] text-text-secondary"><Eye size={12} />Read channels, DMs, and group DMs you enable afterward</span>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface px-2.5 py-1 text-[11px] text-text-secondary"><MessageSquareReply size={12} />Reply as your assigned agent (optional)</span>
        </div>
        <p className="text-xs leading-5 text-text-secondary">Nothing is read until you enable a specific conversation. It cannot access workspace admin settings or any other Slack workspace.</p>
      </fieldset>
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
        <button type="button" onClick={onUseCredentials} className="text-xs font-medium text-text-secondary hover:text-text-primary hover:underline">Have your own Slack app credentials instead?</button>
        <div className="flex gap-2">
          <button type="button" onClick={onClose} className={secondaryClass}>Cancel</button>
          <button type="button" onClick={() => void install()} disabled={busy} className={primaryClass}>{busy ? 'Redirecting…' : 'Install App'}</button>
        </div>
      </div>
    </div>
  </ChatDialog>;
}

/**
 * Lightweight "+" entry point for Slack and Teams, opened straight from the Integrations
 * list instead of the full connection dialog: pick one already-discovered channel (the bot
 * must have been mentioned there at least once) and who in the app should see it.
 */
export function ChannelPickerModal({ directory, installation, onClose, onDone }: { directory: Directory; installation: Installation; onClose: () => void; onDone: () => void }) {
  const [channel, setChannel] = useState<{ externalId: string; name: string } | null>(null);
  const [memberIds, setMemberIds] = useState<string[]>([directory.me.id]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const unbound = installation.channels.filter(item => !item.enabled);

  async function confirm() {
    if (!channel) return;
    setBusy(true); setError('');
    try {
      await chatRequest('/installations/' + installation.id + '/conversations', { title: channel.name.trim().slice(0, 100) || 'Untitled conversation', externalId: channel.externalId, memberIds, instructions: 'Help with quality questions. Suggest tasks for review.' });
      onDone();
    } catch (failure) { setError((failure as Error).message); } finally { setBusy(false); }
  }

  return <ChatDialog title={'Add a ' + (installation.provider === 'slack' ? 'Slack' : 'Microsoft Teams') + ' channel'} onClose={onClose}>
    <div className="space-y-4">
      {error && <div role="alert" className="flex items-start gap-2 rounded-xl border border-danger/20 bg-danger/5 p-3 text-sm text-danger"><CircleHelp size={16} className="mt-0.5 shrink-0" />{error}</div>}
      <fieldset className="space-y-2"><legend className="mb-2 text-sm font-medium">Discovered channels</legend>
        {!unbound.length ? <p className="rounded-lg border border-dashed border-border bg-canvas p-3 text-sm text-text-secondary">No new channels yet. Mention the bot in a channel, then reopen this.</p> : <div className="max-h-48 space-y-1 overflow-auto rounded-lg border border-border bg-canvas p-2">{unbound.map(item => <button type="button" key={item.externalId} onClick={() => setChannel(item)} className={'flex w-full items-center justify-between gap-2 rounded-lg p-2 text-left text-sm transition-colors ' + (channel?.externalId === item.externalId ? 'bg-accent-blue/10 ring-1 ring-accent-blue/25' : 'hover:bg-elevated')}><span className="min-w-0 truncate">{item.name || 'Untitled conversation'}</span>{channel?.externalId === item.externalId && <CheckCircle2 size={15} className="shrink-0 text-accent-blue" />}</button>)}</div>}
      </fieldset>
      {channel && <fieldset className="space-y-2"><legend className="mb-2 text-sm font-medium">Who in your app should see this?</legend><div className="max-h-36 space-y-1 overflow-auto rounded-lg border border-border bg-canvas p-2">{directory.members.map(member => { const selected = memberIds.includes(member.id); const isMe = member.id === directory.me.id; return <label key={member.id} className={'flex cursor-pointer items-center gap-2.5 rounded-lg p-2 text-sm transition-colors ' + (selected ? 'bg-accent-blue/10' : 'hover:bg-elevated')}><input type="checkbox" checked={selected} disabled={isMe} onChange={event => setMemberIds(current => event.target.checked ? [...current, member.id] : current.filter(id => id !== member.id))} /><span className="min-w-0 flex-1 truncate">{member.email}{isMe ? ' (you)' : ''}</span></label>; })}{directory.members.length < 2 && <p className="p-2 text-xs text-text-secondary">Invite teammates in Settings → Access to share access later.</p>}</div></fieldset>}
      <div className="flex justify-end gap-3"><button type="button" onClick={onClose} className={secondaryClass}>Cancel</button><button type="button" disabled={!channel || busy} onClick={() => void confirm()} className={primaryClass}>{busy ? 'Adding…' : 'Add channel'}</button></div>
    </div>
  </ChatDialog>;
}
