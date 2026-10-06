'use client';

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Activity, AlertCircle, CheckCircle2, Clock3, Database, ExternalLink, FileText, Loader2, RefreshCw, Workflow, X } from 'lucide-react';
import type { Source, SyncJob } from '@/lib/types';
import { cn } from '@/lib/utils';
import { SyncJobsPage } from './SyncJobs';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';
type PipelineTab = 'jobs' | 'sources' | 'stats';
type SyncedDocument = { id?: string; externalId: string; type: string; title: string; url?: string; updatedAt?: string };
type SourceTab = 'jobs' | 'content' | 'activity';

const relativeTime = (value?: string | null) => {
  if (!value) return 'Never';
  const elapsed = Math.max(0, Date.now() - new Date(value).getTime());
  const minutes = Math.floor(elapsed / 60000);
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
};

export function PipelinesPage({ onOpenIntegrations, embedded = false }: { onOpenIntegrations: () => void; embedded?: boolean }) {
  const [tab, setTab] = useState<PipelineTab>('jobs');
  const [refreshKey, setRefreshKey] = useState(0);
  return <div className="mx-auto flex h-full min-h-0 w-full max-w-[1440px] flex-col bg-canvas text-text-primary">
    {!embedded && <header className="flex shrink-0 flex-wrap items-start justify-between gap-4 border-b border-border px-6 py-6 md:px-8">
      <div><h1 className="text-xl font-semibold tracking-tight">Pipelines</h1><p className="mt-1 text-sm leading-5 text-text-secondary">Monitor connected sources, sync activity, and indexed content.</p></div>
      <button onClick={() => setRefreshKey(value => value + 1)} className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm hover:bg-elevated"><RefreshCw size={15} />Refresh</button>
    </header>}
    <div className="flex min-h-0 flex-1">
      <nav aria-label="Pipeline sections" className="flex w-36 shrink-0 flex-col gap-1 border-r border-border/70 px-3 py-5 md:w-44 md:px-4 md:py-6">
        {(['jobs', 'sources', 'stats'] as const).map(item => <button key={item} type="button" onClick={() => setTab(item)} aria-current={tab === item ? 'page' : undefined} className={cn('flex min-h-10 w-full items-center rounded-lg px-3 text-left text-sm font-medium capitalize transition-colors', tab === item ? 'bg-accent-blue/10 text-accent-blue' : 'text-text-secondary hover:bg-elevated hover:text-text-primary')}>{item}</button>)}
      </nav>
      <div className="min-h-0 min-w-0 flex-1 overflow-auto" key={`${tab}-${refreshKey}`}>
        {tab === 'jobs' && <div className="h-full py-7 pl-3 pr-5 md:py-8 md:pl-4 md:pr-8"><div className="h-full max-w-6xl"><SyncJobsPage embedded /></div></div>}
        {tab === 'sources' && <PipelineSources onOpenIntegrations={onOpenIntegrations} />}
        {tab === 'stats' && <PipelineStats />}
      </div>
    </div>
  </div>;
}

function PipelineSources({ onOpenIntegrations }: { onOpenIntegrations: () => void }) {
  const [sources, setSources] = useState<Source[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<Source | null>(null);
  const load = useCallback(async () => {
    setLoading(true);
    try { const response = await fetch(`${API_BASE}/api/sources`); if (response.ok) setSources(await response.json()); }
    catch (error) { console.error('Failed to load pipeline sources', error); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const visible = sources.filter(source => `${source.name} ${source.type}`.toLowerCase().includes(query.toLowerCase()));
  return <div className="max-w-6xl py-7 pl-3 pr-5 md:py-8 md:pl-4 md:pr-8">
    <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
      <div><h2 className="font-medium">Connected sources <span className="ml-1 text-sm font-normal text-text-secondary">{sources.length}</span></h2><p className="mt-1 text-sm text-text-secondary">Open a source to inspect its sync history, indexed content, and activity.</p></div>
      <div className="flex gap-2"><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Filter sources…" className="w-52 rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-accent-blue" /><button onClick={onOpenIntegrations} className="rounded-lg bg-accent-blue px-3 py-2 text-sm font-medium text-white hover:opacity-90">Manage integrations</button></div>
    </div>
    {loading ? <div className="flex justify-center py-16"><Loader2 className="animate-spin text-accent-blue" /></div> : visible.length ? <div className="overflow-hidden rounded-xl border border-border bg-surface">
      <div className="hidden grid-cols-[minmax(0,1.7fr)_minmax(100px,.7fr)_minmax(100px,.7fr)_minmax(100px,.7fr)] gap-4 border-b border-border bg-elevated/60 px-5 py-3 text-xs font-medium uppercase tracking-wide text-text-secondary md:grid"><span>Source</span><span>Status</span><span>Synced items</span><span>Last sync</span></div>
      {visible.map(source => <button key={source.id} onClick={() => setSelected(source)} className="grid w-full grid-cols-1 gap-2 border-b border-border px-5 py-4 text-left last:border-0 hover:bg-elevated/60 md:grid-cols-[minmax(0,1.7fr)_minmax(100px,.7fr)_minmax(100px,.7fr)_minmax(100px,.7fr)] md:items-center md:gap-4">
        <span className="flex min-w-0 items-center gap-3"><span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent-blue/10 text-accent-blue"><Database size={17} /></span><span className="min-w-0"><span className="block truncate text-sm font-medium">{source.name}</span><span className="block text-xs capitalize text-text-secondary">{source.type}</span></span></span>
        <span><span className={cn('inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs capitalize', source.status === 'connected' ? 'bg-success/10 text-success' : source.status === 'error' ? 'bg-danger/10 text-danger' : source.status === 'syncing' ? 'bg-info/10 text-info' : 'bg-elevated text-text-secondary')}>{source.status === 'error' && <AlertCircle size={12} />}{source.status}</span></span>
        <span className="text-sm text-text-secondary">{(source.itemsCount || 0).toLocaleString()}</span><span className="text-sm text-text-secondary">{relativeTime(source.lastSync)}</span>
      </button>)}
    </div> : <div className="rounded-xl border border-dashed border-border py-16 text-center"><Database size={26} className="mx-auto text-text-secondary" /><h3 className="mt-3 font-medium">No connected sources</h3><p className="mt-1 text-sm text-text-secondary">Connect a knowledge source to start its sync pipeline.</p><button onClick={onOpenIntegrations} className="mt-4 rounded-lg bg-accent-blue px-4 py-2 text-sm font-medium text-white">Browse integrations</button></div>}
    {selected && <SourceDetailsModal source={selected} onClose={() => setSelected(null)} onRefresh={load} />}
  </div>;
}

function SourceDetailsModal({ source, onClose, onRefresh }: { source: Source; onClose: () => void; onRefresh: () => void }) {
  const [tab, setTab] = useState<SourceTab>('jobs');
  const [jobs, setJobs] = useState<SyncJob[]>([]);
  const [documents, setDocuments] = useState<SyncedDocument[]>([]);
  const [documentTotal, setDocumentTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const [jobResponse, docsResponse] = await Promise.all([fetch(`${API_BASE}/api/sources/${source.id}/jobs?limit=50`), fetch(`${API_BASE}/api/documents?sourceId=${source.id}&limit=100`)]);
      if (!jobResponse.ok || !docsResponse.ok) throw new Error('Could not load source details.');
      const [jobData, docData] = await Promise.all([jobResponse.json(), docsResponse.json()]);
      setJobs(jobData.jobs || []); setDocuments(docData.documents || []); setDocumentTotal(docData.total || 0);
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Could not load source details.'); }
    finally { setLoading(false); }
  }, [source.id]);
  useEffect(() => { void load(); }, [load]);
  const runSync = async () => {
    setSyncing(true); setError('');
    try { const response = await fetch(`${API_BASE}/api/sources/${source.id}/sync`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode: 'incremental' }) }); if (!response.ok) throw new Error('Unable to start source sync.'); await load(); onRefresh(); setTab('jobs'); }
    catch (failure) { setError(failure instanceof Error ? failure.message : 'Unable to start source sync.'); }
    finally { setSyncing(false); }
  };
  const tabs: SourceTab[] = ['jobs', 'content', 'activity'];
  const activity = useMemo(() => jobs.flatMap(job => [
    { id: `${job.id}-created`, title: `Sync ${job.status}`, detail: `${job.trigger} · ${job.itemsProcessed.toLocaleString()} items processed`, time: job.completedAt || job.startedAt || job.createdAt, status: job.status },
  ]).sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime()), [jobs]);
  return <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="presentation">
    <button aria-label="Close source details" className="ui-backdrop absolute inset-0" onClick={onClose} />
    <section role="dialog" aria-modal="true" aria-label={`${source.name} source details`} className="ui-dialog-panel relative flex max-h-[88vh] w-full max-w-3xl flex-col overflow-hidden">
      <header className="flex items-start justify-between border-b border-border p-5"><div className="flex items-center gap-3"><span className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent-blue/10 text-accent-blue"><Database size={18} /></span><div><h2 className="font-semibold">{source.name}</h2><p className="mt-1 text-xs capitalize text-text-secondary">{source.type} · {source.status} · {source.itemsCount.toLocaleString()} items</p></div></div><div className="flex items-center gap-2"><button onClick={() => void runSync()} disabled={syncing || source.status === 'error'} className="inline-flex items-center gap-2 rounded-lg bg-accent-blue px-3 py-2 text-sm font-medium text-white disabled:opacity-50"><RefreshCw size={14} className={syncing ? 'animate-spin' : ''} />Sync now</button><button onClick={onClose} aria-label="Close" className="rounded-lg p-2 text-text-secondary hover:bg-elevated"><X size={18} /></button></div></header>
      <nav className="flex gap-5 border-b border-border px-5">{tabs.map(item => <button key={item} onClick={() => setTab(item)} className={cn('border-b-2 py-3 text-sm capitalize', tab === item ? 'border-accent-blue text-accent-blue' : 'border-transparent text-text-secondary')}>{item === 'content' ? `Content synced${documentTotal ? ` (${documentTotal})` : ''}` : item}</button>)}</nav>
      {error && <p role="alert" className="mx-5 mt-4 rounded-lg bg-danger/10 p-3 text-sm text-danger">{error}</p>}
      <div className="min-h-64 flex-1 overflow-auto p-5">
        {loading ? <div className="flex justify-center py-12"><Loader2 className="animate-spin text-accent-blue" /></div> : tab === 'jobs' ? jobs.length ? <div className="divide-y divide-border">{jobs.map(job => <div key={job.id} className="flex items-center justify-between gap-4 py-3 first:pt-0"><div className="flex min-w-0 items-center gap-3"><span className={cn('h-2 w-2 rounded-full', job.status === 'completed' ? 'bg-success' : job.status === 'failed' ? 'bg-danger' : job.status === 'running' ? 'bg-info' : 'bg-text-secondary')} /><div className="min-w-0"><p className="truncate text-sm font-medium">{job.trigger} sync <span className="font-normal capitalize text-text-secondary">· {job.status}</span></p><p className="mt-1 text-xs text-text-secondary">{job.itemsProcessed.toLocaleString()} / {job.itemsTotal.toLocaleString()} items · {relativeTime(job.createdAt)}</p></div></div>{job.errorMessage && <span title={job.errorMessage} className="max-w-[40%] truncate text-xs text-danger">{job.errorMessage}</span>}</div>)}</div> : <Empty icon={<Workflow size={20} />} text="No sync jobs yet." /> : tab === 'content' ? documents.length ? <><p className="mb-2 text-xs text-text-secondary">Showing {documents.length.toLocaleString()} of {documentTotal.toLocaleString()} indexed documents.</p><div className="divide-y divide-border">{documents.map(document => <div key={document.id || document.externalId} className="flex items-center justify-between gap-4 py-3 first:pt-0"><div className="flex min-w-0 items-center gap-3"><FileText size={16} className="shrink-0 text-text-secondary" /><div className="min-w-0"><p className="truncate text-sm font-medium">{document.title || document.externalId}</p><p className="mt-1 text-xs text-text-secondary">{document.type}{document.updatedAt ? ` · Updated ${relativeTime(document.updatedAt)}` : ''}</p></div></div>{document.url && <a href={document.url} target="_blank" rel="noreferrer" aria-label={`Open ${document.title}`} className="shrink-0 rounded p-2 text-text-secondary hover:bg-elevated"><ExternalLink size={15} /></a>}</div>)}</div></> : <Empty icon={<FileText size={20} />} text="No synced content found for this source." /> : activity.length ? <div className="relative ml-2 border-l border-border pl-6">{activity.map(item => <div key={item.id} className="relative pb-6 last:pb-0"><span className="absolute -left-[30px] top-1 flex h-4 w-4 items-center justify-center rounded-full bg-surface text-accent-blue"><Activity size={13} /></span><p className="text-sm font-medium capitalize">{item.title}</p><p className="mt-1 text-xs text-text-secondary">{item.detail}</p><p className="mt-1 text-xs text-text-secondary">{relativeTime(item.time)}</p></div>)}</div> : <Empty icon={<Clock3 size={20} />} text="Activity will appear after the first sync." />}
      </div>
      <footer className="flex items-center justify-between border-t border-border px-5 py-3 text-xs text-text-secondary"><span>Last successful sync: {relativeTime(source.lastSync)}</span><button onClick={() => void load()} className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 hover:bg-elevated"><RefreshCw size={12} />Refresh details</button></footer>
    </section>
  </div>;
}

function Empty({ icon, text }: { icon: ReactNode; text: string }) { return <div className="py-12 text-center text-text-secondary">{icon}<p className="mt-2 text-sm">{text}</p></div>; }

function PipelineStats() {
  const [sources, setSources] = useState<Source[]>([]);
  const [jobs, setJobs] = useState<SyncJob[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => { let active = true; Promise.all([fetch(`${API_BASE}/api/sources`), fetch(`${API_BASE}/api/sources/jobs/all?limit=100`)]).then(async ([sourceResponse, jobResponse]) => { if (!sourceResponse.ok || !jobResponse.ok) throw new Error('Could not load pipeline statistics.'); const [sourceData, jobData] = await Promise.all([sourceResponse.json(), jobResponse.json()]); if (active) { setSources(sourceData); setJobs(jobData.jobs || []); } }).catch(error => console.error('Failed to load pipeline stats', error)).finally(() => { if (active) setLoading(false); }); return () => { active = false; }; }, []);
  const metrics = [{ label: 'Connected sources', value: sources.filter(source => source.status === 'connected').length, detail: `${sources.length} configured`, icon: <Database size={18} /> }, { label: 'Items indexed', value: sources.reduce((total, source) => total + (source.itemsCount || 0), 0).toLocaleString(), detail: 'Across all connected sources', icon: <FileText size={18} /> }, { label: 'Jobs running', value: jobs.filter(job => job.status === 'running' || job.status === 'queued').length, detail: 'Active or waiting', icon: <Activity size={18} /> }, { label: 'Failed jobs', value: jobs.filter(job => job.status === 'failed').length, detail: `${jobs.filter(job => job.status === 'completed').length} completed in recent jobs`, icon: <AlertCircle size={18} /> }];
  if (loading) return <div className="flex justify-center py-16"><Loader2 className="animate-spin text-accent-blue" /></div>;
  return <div className="max-w-6xl py-7 pl-3 pr-5 md:py-8 md:pl-4 md:pr-8"><div className="mb-5"><h2 className="font-medium">Pipeline health</h2><p className="mt-1 text-sm text-text-secondary">Live totals from connected sources and the latest 100 sync jobs.</p></div><div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{metrics.map(metric => <section key={metric.label} className="rounded-xl border border-border bg-surface p-5"><div className="flex items-center justify-between text-text-secondary"><span className="text-sm">{metric.label}</span>{metric.icon}</div><p className="mt-5 text-3xl font-semibold tracking-tight">{metric.value}</p><p className="mt-1 text-xs text-text-secondary">{metric.detail}</p></section>)}</div><section className="mt-6 rounded-xl border border-border bg-surface p-5"><h3 className="font-medium">Source health</h3><div className="mt-4 divide-y divide-border">{sources.length ? sources.map(source => <div key={source.id} className="flex items-center justify-between gap-4 py-3 first:pt-0"><span className="truncate text-sm">{source.name}</span><span className="flex shrink-0 items-center gap-2 text-xs capitalize text-text-secondary">{source.status === 'connected' ? <CheckCircle2 size={14} className="text-success" /> : <AlertCircle size={14} className={source.status === 'error' ? 'text-danger' : ''} />}{source.status}<span className="hidden sm:inline">· {relativeTime(source.lastSync)}</span></span></div>) : <p className="py-6 text-center text-sm text-text-secondary">No sources configured.</p>}</div></section></div>;
}
