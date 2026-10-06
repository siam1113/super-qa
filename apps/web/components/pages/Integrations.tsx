'use client';

import { useCallback, useEffect, useState } from 'react';
import { Check, ChevronDown, ChevronRight, Eye, Laptop, MessageSquareReply, Pencil, Plug, Plus, ShieldCheck, Trash2, Workflow } from 'lucide-react';
import { motion, useReducedMotion } from 'framer-motion';
import { Directory, Installation, chatRequest } from '@/lib/chat';
import { ChannelPickerModal, ConnectionSetup } from '@/components/chat/ChatSetup';
import { AddFilesModal, AddSourceModal, EditSourceModal, ProjectPickerModal, RepositoryPickerModal, SpacePickerModal } from './Sources';
import type { Source } from '@/lib/types';

const providers = [
  { id: 'slack', name: 'Slack', type: 'Messaging', description: 'Read selected conversations and optionally reply as your agent.', capabilities: ['Read messages', 'Reply (optional)'] },
  { id: 'teams', name: 'Microsoft Teams', type: 'Messaging', description: 'Read selected conversations and optionally reply as your agent.', capabilities: ['Read messages', 'Reply (optional)'] },
  { id: 'github', name: 'GitHub', type: 'Code', description: 'Connect repositories and sync issues and pull requests.', capabilities: ['Read repository data'] },
  { id: 'jira', name: 'Jira', type: 'Issues', description: 'Connect a Jira site and sync project issues.', capabilities: ['Read issues'] },
  { id: 'confluence', name: 'Confluence', type: 'Pages', description: 'Connect a Confluence site and sync pages.', capabilities: ['Read pages'] },
  { id: 'upload', name: 'Computer', type: 'Files', description: 'Upload text, PDF, or Word files from your computer for the pipeline to analyze.', capabilities: ['Read uploaded files'] },
] as const;
type SourceProvider = Exclude<(typeof providers)[number]['id'], 'slack' | 'teams'>;

const groupNoun = (type: string) => type === 'jira' ? 'project' : type === 'confluence' ? 'space' : 'repository';
const groupItemLabel = (source: Source) => source.project || source.spaceKey || source.repository || source.name;

function ProviderIcon({ provider, size = 18 }: { provider: string; size?: number }) {
  if (provider === 'upload') return <Laptop size={size} aria-hidden="true" />;
  if (provider === 'teams') return <img src="/provider-icons/teams.svg" width={size} height={size} className="object-contain" alt="" aria-hidden="true" />;
  if (['slack', 'github', 'jira', 'confluence'].includes(provider)) {
    const color = { slack: '#611f69', github: '#24292f', jira: '#1868db', confluence: '#1868db' }[provider as 'slack' | 'github' | 'jira' | 'confluence'];
    return <span aria-hidden="true" className="inline-block shrink-0" style={{ width: size, height: size, backgroundColor: color, maskImage: `url(/provider-icons/${provider}.svg)`, WebkitMaskImage: `url(/provider-icons/${provider}.svg)`, maskRepeat: 'no-repeat', WebkitMaskRepeat: 'no-repeat', maskPosition: 'center', WebkitMaskPosition: 'center', maskSize: 'contain', WebkitMaskSize: 'contain' }} />;
  }
  return <Workflow size={size} aria-hidden="true" />;
}

function PermissionIcon({ permission, size = 12 }: { permission: string; size?: number }) {
  const label = permission.toLowerCase();
  if (label.includes('write')) return <Pencil size={size} aria-hidden="true" />;
  if (label.includes('reply')) return <MessageSquareReply size={size} aria-hidden="true" />;
  return <Eye size={size} aria-hidden="true" />;
}

export function IntegrationsPage({ embedded = false }: { embedded?: boolean }) {
  const reduceMotion = useReducedMotion();
  const [integrationTab, setIntegrationTab] = useState<'active' | 'explore'>('active');
  const [directory, setDirectory] = useState<Directory | null>(null);
  const [directoryLoaded, setDirectoryLoaded] = useState(false);
  const [installations, setInstallations] = useState<Installation[]>([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [open, setOpen] = useState<'slack' | 'teams' | null>(null);
  const [sources, setSources] = useState<Source[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [showSourceModal, setShowSourceModal] = useState(false);
  const [selectedProvider, setSelectedProvider] = useState<SourceProvider | null>(null);
  const [filesModal, setFilesModal] = useState<{ id: string; name: string } | null>(null);
  const [editingSource, setEditingSource] = useState<Source | null>(null);
  const [oauthConfigStatus, setOauthConfigStatus] = useState<Record<string, boolean>>({});
  const [repoPicker, setRepoPicker] = useState<{ sourceId: string; sourceName: string; mode: 'initial' | 'add' } | null>(null);
  const [projectPicker, setProjectPicker] = useState<{ sourceId: string; sourceName: string; mode: 'initial' | 'add' } | null>(null);
  const [spacePicker, setSpacePicker] = useState<{ sourceId: string; sourceName: string; mode: 'initial' | 'add' } | null>(null);
  const [channelPicker, setChannelPicker] = useState<Installation | null>(null);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const toggleGroup = (key: string) => setExpandedGroups(current => { const next = new Set(current); if (next.has(key)) next.delete(key); else next.add(key); return next; });
  const refreshInstallations = useCallback(async () => { setInstallations(await chatRequest<Installation[]>('/installations')); }, []);

  useEffect(() => {
    let active = true;
    chatRequest<Directory>('/directory').then(value => {
      if (!active) return;
      setDirectory(value);
      if (value.me.role === 'owner') void chatRequest<Installation[]>('/installations').then(items => { if (active) setInstallations(items); }).catch(failure => { if (active) setError((failure as Error).message); });
    }).catch(failure => { if (active) setError((failure as Error).message); }).finally(() => { if (active) setDirectoryLoaded(true); });
    return () => { active = false; };
  }, []);

  const refreshSources = useCallback(async () => {
    const response = await fetch('/api/sources', { credentials: 'same-origin', cache: 'no-store' });
    if (!response.ok) { const body = await response.json().catch(() => ({})); throw new Error(body.message || `Unable to load knowledge integrations (HTTP ${response.status}).`); }
    setSources(await response.json());
  }, []);

  useEffect(() => {
    void refreshSources().catch(failure => setError((failure as Error).message));
    fetch('/api/sources/oauth/config/status', { credentials: 'same-origin', cache: 'no-store' }).then(response => response.ok ? response.json() : {}).then(setOauthConfigStatus).catch(() => setOauthConfigStatus({}));
    const params = new URLSearchParams(window.location.search);
    if (params.get('oauth_success') === 'true') {
      const sourceId = params.get('source_id');
      const sourceName = params.get('source_name') || 'this connection';
      void refreshSources().then(async () => {
        if (!sourceId) return;
        const response = await fetch(`/api/sources/${sourceId}`, { credentials: 'same-origin', cache: 'no-store' });
        if (!response.ok) return;
        const details = await response.json();
        if (details.type === 'github' && !details.config?.repository) {
          setRepoPicker({ sourceId, sourceName, mode: 'initial' });
        } else if (details.type === 'jira' && !details.config?.project) {
          setProjectPicker({ sourceId, sourceName, mode: 'initial' });
        } else if (details.type === 'confluence' && !details.config?.spaceKey) {
          setSpacePicker({ sourceId, sourceName, mode: 'initial' });
        }
      }).catch(failure => setError((failure as Error).message));
      window.history.replaceState({}, '', window.location.pathname);
    }
    else if (params.get('error')) { setError(decodeURIComponent(params.get('error') || 'OAuth connection failed')); window.history.replaceState({}, '', window.location.pathname); }
    else if (params.get('installation_connected')) {
      const provider = params.get('installation_connected');
      setNotice((provider === 'slack' ? 'Slack' : provider === 'teams' ? 'Microsoft Teams' : provider || 'The connection') + ' was connected.');
      void refreshInstallations().catch(failure => setError((failure as Error).message));
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, [refreshSources, refreshInstallations]);

  const createSource = async (data: { name: string; type: string; config: Record<string, unknown> }) => {
    const response = await fetch('/api/sources', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify(data) });
    if (!response.ok) { const body = await response.json().catch(() => ({})); throw new Error(body.message || 'Unable to add this integration.'); }
    const created = await response.json();
    await refreshSources();
    return created as { id: string; name: string; type: string };
  };
  const updateSource = async (id: string, data: { syncMode: 'auto' | 'manual'; config?: Record<string, unknown> }) => {
    const response = await fetch(`/api/sources/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify(data) });
    if (!response.ok) throw new Error('Unable to update this integration.');
    await refreshSources();
  };
  const testSource = async (id: string) => {
    const response = await fetch(`/api/sources/${id}/test`, { method: 'POST', credentials: 'same-origin' }); const result = await response.json();
    if (!response.ok || !result.success) throw new Error(result.message || 'Connection verification failed.');
    await refreshSources();
  };
  const removeSource = async (source: Source) => {
    if (!window.confirm(`Remove ${source.name}? Its synced documents will also be removed.`)) return;
    const response = await fetch(`/api/sources/${source.id}`, { method: 'DELETE', credentials: 'same-origin' });
    if (!response.ok) { setError('Unable to remove this integration.'); return; }
    await refreshSources();
  };
  const removeSourceGroup = async (group: Source[], siteLabel: string) => {
    const noun = groupNoun(group[0]?.type || '');
    if (!window.confirm(`Remove ${siteLabel}? All ${group.length} connected ${noun}s and their synced documents will be removed.`)) return;
    const results = await Promise.all(group.map(source => fetch(`/api/sources/${source.id}`, { method: 'DELETE', credentials: 'same-origin' })));
    if (results.some(response => !response.ok)) setError('Some connections could not be removed.');
    await refreshSources();
  };
  const removeInstallation = async (installation: Installation) => {
    if (!window.confirm(`Remove ${installation.name}? The bot will be disconnected and its conversations archived.`)) return;
    await chatRequest('/installations/' + installation.id + '/disconnect', {});
    await refreshInstallations();
  };

  const connectProvider = (provider: (typeof providers)[number]['id']) => {
    setPickerOpen(false);
    if (provider === 'slack' || provider === 'teams') setOpen(provider);
    else { setSelectedProvider(provider); setShowSourceModal(true); }
  };

  // GitHub repos, Jira projects, and Confluence spaces each get their own Source row
  // (so they can sync independently), but rows added under the same connection share
  // one set of credentials. Group those rows into a single card instead of showing one
  // "connection" per repo/project/space. Jira/Confluence share a baseUrl; GitHub has no
  // equivalent site field, so its rows are grouped by a credential fingerprint instead.
  const SOURCE_STATUS_RANK: Record<string, number> = { error: 0, disconnected: 1, syncing: 2, connected: 3 };
  const worstSourceStatus = (statuses: string[]) => statuses.slice().sort((a, b) => (SOURCE_STATUS_RANK[a] ?? 9) - (SOURCE_STATUS_RANK[b] ?? 9))[0];
  const groupKeyFor = (source: Source): string | null => {
    if (['jira', 'confluence'].includes(source.type) && source.baseUrl) return source.type + ':' + source.baseUrl;
    if (source.type === 'github' && source.credentialKey) return 'github:' + source.credentialKey;
    return null;
  };
  const siteGroups = new Map<string, Source[]>();
  sources.forEach(source => {
    const key = groupKeyFor(source);
    if (!key) return;
    siteGroups.set(key, [...(siteGroups.get(key) || []), source]);
  });
  // Group even a single repo/project/space under its own connection card (not only when there
  // are several) so every GitHub/Jira/Confluence connection gets the same expand-to-see-what's-
  // connected affordance, instead of only appearing once a second item is added.
  const groupedSourceIds = new Set<string>();
  siteGroups.forEach(list => list.forEach(source => groupedSourceIds.add(source.id)));

  const connections = [
    ...sources.filter(source => !groupedSourceIds.has(source.id)).map(source => ({ kind: 'source' as const, id: source.id, provider: source.type, name: source.name, status: source.status, access: ['Read', ...(source.permissions || []).some(permission => /write|admin|manage/i.test(permission)) ? ['Provider token has write scope'] : []], source })),
    ...[...siteGroups.entries()].map(([key, list]) => {
      const site = list[0].baseUrl ? list[0].baseUrl.replace(/^https?:\/\//, '') : list[0].repository ? list[0].repository.split('/')[0] : providers.find(provider => provider.id === list[0].type)?.name || list[0].type;
      return { kind: 'source-group' as const, id: key, provider: list[0].type, name: site, status: worstSourceStatus(list.map(source => source.status)), sources: list, primary: list[0] };
    }),
    ...installations.map(installation => ({ kind: 'installation' as const, id: installation.id, provider: installation.provider, name: installation.name, status: installation.enabled ? 'connected' : 'disconnected', access: installation.accessMode === 'read_reply' ? ['Read', 'Reply'] : ['Read only'], installation })),
  ];
  const activeConnectionCount = connections.filter(connection => connection.status === 'connected').length;

  return <div className="h-full overflow-hidden bg-canvas text-text-primary">
    <div className="mx-auto flex h-full max-w-[1440px]">
      <nav aria-label="Integration sections" className="flex w-36 shrink-0 flex-col gap-1 border-r border-border/70 px-3 py-5 md:w-44 md:px-4 md:py-6">
        {([{ id: 'active', label: 'Active' }, { id: 'explore', label: 'Explore' }] as const).map(item => <button key={item.id} type="button" onClick={() => setIntegrationTab(item.id)} aria-current={integrationTab === item.id ? 'page' : undefined} className={`flex min-h-10 w-full items-center rounded-lg px-3 text-left text-sm font-medium transition-colors ${integrationTab === item.id ? 'bg-accent-blue/10 text-accent-blue' : 'text-text-secondary hover:bg-elevated hover:text-text-primary'}`}>{item.label}</button>)}
      </nav>
      <div className="min-w-0 flex-1 overflow-y-auto py-7 pl-3 pr-5 md:py-8 md:pl-4 md:pr-8">
       <div className="max-w-6xl">
      {!embedded && <header className="mb-6 flex flex-wrap items-start justify-between gap-4 border-b border-border pb-5">
        <div><h1 className="text-xl font-semibold tracking-tight">Integrations</h1><p className="mt-1 text-sm leading-5 text-text-secondary">Manage connected tools and access.</p></div>
        <div className="flex items-center gap-3"><span className="text-xs text-text-secondary">{activeConnectionCount} connected</span><button onClick={() => setPickerOpen(true)} disabled={!directory || directory.me.role !== 'owner'} className="inline-flex items-center gap-2 rounded-lg bg-accent-blue px-3.5 py-2 text-sm font-semibold text-white shadow-sm transition hover:shadow-md disabled:opacity-40"><Plus size={16} />Connect integration</button></div>
      </header>}
      {error && <div role="alert" className="mt-5 rounded-xl border border-danger/20 bg-danger/5 p-3 text-sm text-danger">{error}{error.includes('Sign in') && <a href="/login" className="ml-2 underline">Sign in</a>}</div>}
      {notice && <div role="status" className="mt-5 rounded-xl border border-success/20 bg-success/5 p-3 text-sm text-success">{notice}</div>}
      {!directoryLoaded ? <p role="status" className="py-8 text-sm text-text-secondary">Loading integration access…</p> : !directory ? <p role="alert" className="mt-5 rounded-xl border border-warning/20 bg-warning/5 p-4 text-sm text-text-secondary">Integration access could not be loaded. {error || 'Check your app sign-in and try refreshing the page.'}</p> : directory.me.role !== 'owner' && <p role="alert" className="mt-5 rounded-xl border border-warning/20 bg-warning/5 p-4 text-sm text-text-secondary">An app owner can configure connections.</p>}
      {integrationTab === 'active' && <section className="pt-1 pb-7">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="text-lg font-semibold tracking-tight">Active Integrations</h2>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-success/10 px-2.5 py-1 text-xs font-medium text-success"><span className="h-1.5 w-1.5 rounded-full bg-current" />{activeConnectionCount} connected</span>
          </div>
          {embedded && <button onClick={() => setPickerOpen(true)} disabled={!directory || directory.me.role !== 'owner'} className="inline-flex items-center gap-2 rounded-lg bg-accent-blue px-3.5 py-2 text-sm font-semibold text-white shadow-sm transition hover:shadow-md disabled:opacity-40"><Plus size={16} />Connect integration</button>}
        </div>
        {connections.length ? <div className="overflow-hidden rounded-2xl border border-border bg-surface shadow-sm">{connections.map(connection => {
          const providerDetails = providers.find(provider => provider.id === connection.provider);
          const noun = connection.kind === 'source-group' ? groupNoun(connection.provider) : null;
          const connectedChannels = connection.kind === 'installation' ? connection.installation.channels.filter(channel => channel.enabled).length : 0;
          const expandable = connection.kind === 'source-group' || connection.kind === 'installation';
          const expanded = expandable && expandedGroups.has(connection.id);
          return <div key={connection.id} className="border-b border-border last:border-0">
            <div className="group flex flex-col gap-4 px-4 py-4 transition-colors hover:bg-elevated/40 sm:flex-row sm:items-center sm:justify-between sm:px-5">
              <div className="flex min-w-0 items-center gap-3">
                {expandable && <button type="button" onClick={() => toggleGroup(connection.id)} aria-expanded={expanded} aria-label={expanded ? 'Collapse' : 'Expand'} className="flex-none text-text-secondary transition-colors hover:text-text-primary">{expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}</button>}
                <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-accent-blue/10 bg-accent-blue/10 text-accent-blue"><ProviderIcon provider={connection.provider} size={20} /></span>
                <div className="min-w-0"><p className="truncate text-sm font-semibold">{providerDetails?.name || connection.provider}</p><p className="mt-0.5 truncate text-xs text-text-secondary">{connection.name}<span className="mx-1.5 text-border">·</span>{connection.kind === 'source-group' ? `${connection.sources.length} ${noun}${connection.sources.length === 1 ? '' : 's'}` : connection.kind === 'installation' ? `${connectedChannels} channel${connectedChannels === 1 ? '' : 's'}` : providerDetails?.type || 'Integration'}</p></div>
              </div>
              <div className="flex flex-wrap items-center gap-1.5 sm:justify-end">
                {connection.kind !== 'source-group' && connection.access.map(tag => <span key={tag} className={'inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-medium ' + (tag.includes('write') ? 'bg-warning/10 text-warning' : 'bg-canvas text-text-secondary')}><PermissionIcon permission={tag} />{tag}</span>)}
                <span className={'ml-1 inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold capitalize ' + (connection.status === 'connected' ? 'bg-success/10 text-success' : connection.status === 'error' ? 'bg-danger/10 text-danger' : 'bg-elevated text-text-secondary')}><span className="h-1.5 w-1.5 rounded-full bg-current" />{connection.status}</span>
                <span className="mx-1 hidden h-6 w-px bg-border sm:block" />
                {connection.kind === 'source' ? <>
                  {connection.provider === 'github' && connection.status === 'connected' && <button onClick={() => setRepoPicker({ sourceId: connection.source.id, sourceName: connection.name, mode: 'add' })} title="Add repository" aria-label={`Add a repository to ${connection.name}`} className="rounded-lg p-2 text-text-secondary transition hover:bg-canvas hover:text-text-primary"><Plus size={15} /></button>}
                  {connection.provider === 'jira' && connection.status === 'connected' && <button onClick={() => setProjectPicker({ sourceId: connection.source.id, sourceName: connection.name, mode: 'add' })} title="Add project" aria-label={`Add a project to ${connection.name}`} className="rounded-lg p-2 text-text-secondary transition hover:bg-canvas hover:text-text-primary"><Plus size={15} /></button>}
                  {connection.provider === 'confluence' && connection.status === 'connected' && <button onClick={() => setSpacePicker({ sourceId: connection.source.id, sourceName: connection.name, mode: 'add' })} title="Add space" aria-label={`Add a space to ${connection.name}`} className="rounded-lg p-2 text-text-secondary transition hover:bg-canvas hover:text-text-primary"><Plus size={15} /></button>}
                  {connection.provider === 'upload' && <button onClick={() => setFilesModal({ id: connection.source.id, name: connection.name })} title="Add files" aria-label={`Add files to ${connection.name}`} className="rounded-lg p-2 text-text-secondary transition hover:bg-canvas hover:text-text-primary"><Plus size={15} /></button>}
                  <button onClick={() => setEditingSource(connection.source)} title="Edit connection" aria-label={`Edit ${connection.name}`} className="rounded-lg p-2 text-text-secondary transition hover:bg-canvas hover:text-text-primary"><Pencil size={15} /></button>
                  <button onClick={() => void testSource(connection.source.id).catch(failure => setError((failure as Error).message))} title="Test connection" aria-label={`Test ${connection.name}`} className="rounded-lg p-2 text-text-secondary transition hover:bg-canvas hover:text-text-primary"><Check size={15} /></button>
                  <button onClick={() => void removeSource(connection.source).catch(failure => setError((failure as Error).message))} title="Remove connection" aria-label={`Remove ${connection.name}`} className="rounded-lg p-2 text-text-secondary transition hover:bg-danger/10 hover:text-danger"><Trash2 size={15} /></button>
                </> : connection.kind === 'source-group' ? <>
                  {connection.status === 'connected' && <button onClick={() => connection.provider === 'jira' ? setProjectPicker({ sourceId: connection.primary.id, sourceName: connection.name, mode: 'add' }) : connection.provider === 'confluence' ? setSpacePicker({ sourceId: connection.primary.id, sourceName: connection.name, mode: 'add' }) : setRepoPicker({ sourceId: connection.primary.id, sourceName: connection.name, mode: 'add' })} title={`Add ${noun}`} aria-label={`Add a ${noun} to ${connection.name}`} className="rounded-lg p-2 text-text-secondary transition hover:bg-canvas hover:text-text-primary"><Plus size={15} /></button>}
                  <button onClick={() => setEditingSource(connection.primary)} title="Edit connection" aria-label={`Edit ${connection.name}`} className="rounded-lg p-2 text-text-secondary transition hover:bg-canvas hover:text-text-primary"><Pencil size={15} /></button>
                  <button onClick={() => void testSource(connection.primary.id).catch(failure => setError((failure as Error).message))} title="Test connection" aria-label={`Test ${connection.name}`} className="rounded-lg p-2 text-text-secondary transition hover:bg-canvas hover:text-text-primary"><Check size={15} /></button>
                  <button onClick={() => void removeSourceGroup(connection.sources, connection.name).catch(failure => setError((failure as Error).message))} title="Remove connection" aria-label={`Remove ${connection.name}`} className="rounded-lg p-2 text-text-secondary transition hover:bg-danger/10 hover:text-danger"><Trash2 size={15} /></button>
                </> : <>
                  {(connection.provider === 'slack' || connection.provider === 'teams') && connection.installation.enabled && <button onClick={() => setChannelPicker(connection.installation)} title="Add channel" aria-label={`Add a channel to ${connection.name}`} className="rounded-lg p-2 text-text-secondary transition hover:bg-canvas hover:text-text-primary"><Plus size={15} /></button>}
                  <button onClick={() => setOpen(connection.installation.provider)} title="Edit connection" aria-label={`Edit ${connection.name}`} className="rounded-lg p-2 text-text-secondary transition hover:bg-canvas hover:text-text-primary"><Pencil size={15} /></button>
                  <button onClick={() => void removeInstallation(connection.installation).catch(failure => setError((failure as Error).message))} title="Remove connection" aria-label={`Remove ${connection.name}`} className="rounded-lg p-2 text-text-secondary transition hover:bg-danger/10 hover:text-danger"><Trash2 size={15} /></button>
                </>}
              </div>
            </div>
            {connection.kind === 'source-group' && expanded && <div className="divide-y divide-border border-t border-border bg-canvas/40 pl-14">
              {connection.sources.map(source => <div key={source.id} className="flex items-center justify-between gap-3 py-2.5 pr-5 text-sm">
                <span className="min-w-0 truncate text-text-secondary"><span className="font-medium text-text-primary">{groupItemLabel(source)}</span><span className="mx-1.5 text-border">·</span>{source.itemsCount.toLocaleString()} items</span>
                <span className="flex flex-none items-center gap-1.5">
                  <span className={'inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold capitalize ' + (source.status === 'connected' ? 'bg-success/10 text-success' : source.status === 'error' ? 'bg-danger/10 text-danger' : 'bg-elevated text-text-secondary')}><span className="h-1.5 w-1.5 rounded-full bg-current" />{source.status}</span>
                  <button onClick={() => void removeSource(source).catch(failure => setError((failure as Error).message))} title={`Remove ${groupItemLabel(source)}`} aria-label={`Remove ${groupItemLabel(source)}`} className="rounded-lg p-1.5 text-text-secondary transition hover:bg-danger/10 hover:text-danger"><Trash2 size={13} /></button>
                </span>
              </div>)}
            </div>}
            {connection.kind === 'installation' && expanded && <div className="divide-y divide-border border-t border-border bg-canvas/40 pl-14">
              {connectedChannels ? connection.installation.channels.filter(channel => channel.enabled).map(channel => <div key={channel.externalId} className="flex items-center justify-between gap-3 py-2.5 pr-5 text-sm">
                <span className="min-w-0 truncate font-medium text-text-primary">{channel.name || 'Untitled conversation'}</span>
              </div>) : <p className="py-2.5 pr-5 text-sm text-text-secondary">No channels connected yet. Mention the bot in Teams or Slack, then use &ldquo;Add channel&rdquo; above.</p>}
            </div>}
          </div>; })}</div> : <div className="rounded-2xl border border-dashed border-border bg-surface/50 px-6 py-12 text-center"><span className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-accent-blue/10 text-accent-blue"><Plug size={21} /></span><p className="mt-4 text-sm font-semibold">Your workspace is ready to connect</p><p className="mx-auto mt-1 max-w-sm text-sm text-text-secondary">Connect a tool to give your agents the context and capabilities your team needs.</p><button onClick={() => setPickerOpen(true)} className="mt-5 inline-flex items-center gap-2 rounded-lg border border-border bg-surface px-3 py-2 text-sm font-medium transition hover:bg-elevated"><Plus size={15} />Browse integrations</button></div>}
      </section>}
      {integrationTab === 'explore' && <section className="pb-8">
        <div className="mb-5"><p className="text-xs font-semibold uppercase tracking-[0.16em] text-accent-blue">Explore</p><h2 className="mt-1 text-xl font-semibold tracking-tight">Integration catalog</h2><p className="mt-1 text-sm text-text-secondary">One catalog for every tool. The available actions depend on the access you grant.</p></div>
        {(() => { const unconnected = providers.filter(provider => provider.id === 'slack' || provider.id === 'teams' ? !installations.some(item => item.provider === provider.id && item.enabled) : !sources.some(source => source.type === provider.id && source.status === 'connected')); return unconnected.length ? <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{unconnected.map((provider, index) => <motion.article key={provider.id} initial={reduceMotion ? false : { opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.24, delay: reduceMotion ? 0 : index * 0.045 }} whileHover={reduceMotion ? undefined : { y: -3 }} className="group flex min-h-52 flex-col rounded-2xl border border-border bg-surface p-5 shadow-sm transition-shadow hover:shadow-md">
          <div className="flex items-start justify-between gap-3"><div className="flex min-w-0 items-center gap-3"><span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-accent-blue/10 bg-accent-blue/10 text-accent-blue transition duration-200 group-hover:scale-105"><ProviderIcon provider={provider.id} size={21} /></span><div className="min-w-0"><h3 className="truncate text-sm font-semibold">{provider.name}</h3><p className="mt-0.5 text-xs text-text-secondary">{provider.type}</p></div></div><span className="shrink-0 rounded-full bg-canvas px-2.5 py-1 text-[11px] font-medium text-text-secondary">Ready to connect</span></div>
          <div className="mt-4"><p className="min-h-10 text-sm leading-5 text-text-secondary">{provider.description}</p></div>
          <div className="mt-4 flex flex-wrap gap-1.5">{provider.capabilities.map(capability => <span key={capability} className="inline-flex items-center gap-1.5 rounded-full border border-border bg-canvas/70 px-2.5 py-1 text-[11px] text-text-secondary"><PermissionIcon permission={capability} />{capability}</span>)}</div>
          <button onClick={() => connectProvider(provider.id)} disabled={!directory || directory.me.role !== 'owner'} className="mt-5 inline-flex items-center justify-between rounded-lg border border-border px-3 py-2 text-xs font-semibold transition hover:border-accent-blue/30 hover:bg-accent-blue/5 hover:text-accent-blue disabled:opacity-40">Connect<Plus size={14} /></button>
        </motion.article>)}</div> : <div className="rounded-2xl border border-dashed border-border bg-surface/50 px-6 py-12 text-center"><span className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-success/10 text-success"><Check size={21} /></span><p className="mt-4 text-sm font-semibold">Every available integration is already connected</p><p className="mx-auto mt-1 max-w-sm text-sm text-text-secondary">Manage existing connections from the Active tab.</p></div>; })()}
      </section>}
      <p className="flex items-start gap-2 border-t border-border py-5 text-xs leading-5 text-text-secondary"><ShieldCheck size={14} className="mt-0.5 shrink-0 text-success" />Content integrations have read access. Chat integrations can be read-only or allow agent replies.</p>
       </div>
      </div>
    </div>
    {pickerOpen && <div className="fixed inset-0 z-40 flex items-center justify-center p-4" role="presentation">
      <button aria-label="Close integration chooser" className="ui-backdrop absolute inset-0 cursor-default" onClick={() => setPickerOpen(false)} />
      <motion.section role="dialog" aria-modal="true" aria-labelledby="integration-picker-title" initial={reduceMotion ? false : { opacity: 0, y: 8, scale: 0.99 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ duration: 0.18 }} className="ui-dialog-panel relative w-full max-w-3xl overflow-hidden">
        <div className="flex items-start justify-between border-b border-border px-6 py-5 md:px-7"><div><p className="text-xs font-semibold uppercase tracking-[0.16em] text-accent-blue">Connect a service</p><h2 id="integration-picker-title" className="mt-1 text-xl font-semibold tracking-tight">What would you like to connect?</h2><p className="mt-1 text-sm text-text-secondary">Select a provider to review its access and finish setup.</p></div><button onClick={() => setPickerOpen(false)} aria-label="Close integration chooser" className="rounded-lg p-2 text-text-secondary transition hover:bg-elevated hover:text-text-primary"><span aria-hidden="true" className="text-xl leading-none">×</span></button></div>
        <div className="grid gap-3 p-5 sm:grid-cols-2 md:p-7">{providers.map(provider => <button key={provider.id} onClick={() => connectProvider(provider.id)} className="group flex min-w-0 items-center gap-4 rounded-xl border border-border bg-canvas/50 p-4 text-left transition hover:-translate-y-0.5 hover:border-accent-blue/40 hover:bg-accent-blue/5 hover:shadow-sm">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-accent-blue/10 bg-accent-blue/10 text-accent-blue transition group-hover:scale-105"><ProviderIcon provider={provider.id} size={21} /></span><span className="min-w-0 flex-1"><span className="flex items-center justify-between gap-2"><span className="font-semibold">{provider.name}</span><Plus size={15} className="text-text-secondary transition group-hover:text-accent-blue" /></span><span className="mt-1 block text-xs leading-5 text-text-secondary">{provider.description}</span><span className="mt-2 flex flex-wrap gap-1">{provider.capabilities.map(capability => <span key={capability} className="inline-flex items-center gap-1 rounded-full bg-surface px-2 py-0.5 text-[10px] text-text-secondary"><PermissionIcon permission={capability} size={10} />{capability}</span>)}</span></span>
        </button>)}</div>
        <div className="flex items-center gap-2 border-t border-border bg-canvas/40 px-6 py-3 text-xs text-text-secondary"><ShieldCheck size={14} className="shrink-0 text-success" />You can review connection access before granting it.</div>
      </motion.section>
    </div>}
  {open && directory && <ConnectionSetup directory={directory} provider={open} installation={installations.find(item => item.provider === open)} onClose={() => setOpen(null)} onSaved={(close = true) => { if (close) setOpen(null); void refreshInstallations().catch(failure => setError((failure as Error).message)); }} />}
  <AddSourceModal isOpen={showSourceModal} initialType={selectedProvider || undefined} onClose={() => { setShowSourceModal(false); setSelectedProvider(null); }} onSubmit={data => { void createSource(data).then(created => {
    setShowSourceModal(false); setSelectedProvider(null);
    if (data.type === 'jira' && !data.config.project) setProjectPicker({ sourceId: created.id, sourceName: created.name, mode: 'initial' });
    else if (data.type === 'confluence' && !data.config.spaceKey) setSpacePicker({ sourceId: created.id, sourceName: created.name, mode: 'initial' });
    else if (data.type === 'upload') setFilesModal({ id: created.id, name: created.name });
  }).catch(failure => setError((failure as Error).message)); }} oauthConfigStatus={oauthConfigStatus} />
  <EditSourceModal isOpen={!!editingSource} source={editingSource} onClose={() => setEditingSource(null)} onSubmit={(id, data) => { void updateSource(id, data).then(() => setEditingSource(null)).catch(failure => setError((failure as Error).message)); }} />
  <RepositoryPickerModal
    isOpen={!!repoPicker}
    sourceId={repoPicker?.sourceId || null}
    sourceName={repoPicker?.sourceName}
    mode={repoPicker?.mode || 'add'}
    existingRepositories={sources.filter(source => source.type === 'github' && source.repository && source.credentialKey === sources.find(item => item.id === repoPicker?.sourceId)?.credentialKey).map(source => source.repository as string)}
    onClose={() => setRepoPicker(null)}
    onDone={() => { setRepoPicker(null); void refreshSources().catch(failure => setError((failure as Error).message)); }}
  />
  <ProjectPickerModal
    isOpen={!!projectPicker}
    sourceId={projectPicker?.sourceId || null}
    sourceName={projectPicker?.sourceName}
    mode={projectPicker?.mode || 'add'}
    existingProjects={sources.filter(source => source.type === 'jira' && source.project && source.baseUrl === sources.find(item => item.id === projectPicker?.sourceId)?.baseUrl).map(source => source.project as string)}
    onClose={() => setProjectPicker(null)}
    onDone={() => { setProjectPicker(null); void refreshSources().catch(failure => setError((failure as Error).message)); }}
  />
  <SpacePickerModal
    isOpen={!!spacePicker}
    sourceId={spacePicker?.sourceId || null}
    sourceName={spacePicker?.sourceName}
    mode={spacePicker?.mode || 'add'}
    existingSpaces={sources.filter(source => source.type === 'confluence' && source.spaceKey && source.baseUrl === sources.find(item => item.id === spacePicker?.sourceId)?.baseUrl).map(source => source.spaceKey as string)}
    onClose={() => setSpacePicker(null)}
    onDone={() => { setSpacePicker(null); void refreshSources().catch(failure => setError((failure as Error).message)); }}
  />
  {channelPicker && directory && <ChannelPickerModal
    directory={directory}
    installation={channelPicker}
    onClose={() => setChannelPicker(null)}
    onDone={() => { setChannelPicker(null); void refreshInstallations().catch(failure => setError((failure as Error).message)); }}
  />}
  {filesModal && <AddFilesModal
    isOpen={!!filesModal}
    sourceId={filesModal.id}
    sourceName={filesModal.name}
    onClose={() => setFilesModal(null)}
    onDone={() => { const name = filesModal.name; setFilesModal(null); setNotice(`${name} is connected. The pipeline is analyzing the uploaded files.`); void refreshSources().catch(failure => setError((failure as Error).message)); }}
  />}
  </div>;
}
