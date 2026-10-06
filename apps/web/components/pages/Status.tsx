'use client';

import { useEffect, useState } from 'react';
import { Activity, AlertTriangle, Check, Clock3, LoaderCircle, RefreshCw, X } from 'lucide-react';

type ServiceStatus = 'healthy' | 'unhealthy';
type Service = { id: string; name: string; status: ServiceStatus; detail: string; checkedAt: string };
type Incident = { id: string; service: string; status: string; message: string; startedAt: string; resolvedAt: string | null };
type StatusPayload = { checkedAt: string; services: Service[]; timeline: Incident[] };
type Props = { open: boolean; onClose: () => void };

const serviceNames: Record<string, string> = { chat: 'Chat', pipelines: 'Pipelines', agents: 'Agents' };

function badge(status: ServiceStatus) {
  return status === 'healthy'
    ? { label: 'Operational', icon: <Check size={14} />, classes: 'border-success/25 bg-success/10 text-success' }
    : { label: 'Service issue', icon: <AlertTriangle size={14} />, classes: 'border-danger/25 bg-danger/10 text-danger' };
}

export function StatusPanel({ open, onClose }: Props) {
  const [tab, setTab] = useState<'overview' | 'timeline'>('overview');
  const [payload, setPayload] = useState<StatusPayload | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const refresh = async () => {
    setBusy(true);
    try {
      const response = await fetch('/api/status', { credentials: 'same-origin', cache: 'no-store' });
      if (response.status === 401) throw new Error('Sign in to view your service status.');
      if (!response.ok) throw new Error('Your service status is temporarily unavailable. Try again shortly.');
      setPayload(await response.json() as StatusPayload);
      setError('');
    } catch (failure) {
      setError((failure as Error).message || 'Your service status is temporarily unavailable.');
      setPayload(null);
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (!open) return;
    void refresh();
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  if (!open) return null;
  const services = payload?.services || [];
  const incidents = payload?.timeline || [];
  const hasIssues = services.some(service => service.status === 'unhealthy');

  return <div className="fixed inset-0 ui-backdrop z-[80] flex justify-end" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <section role="dialog" aria-modal="true" aria-labelledby="client-status-title" className="flex h-full w-full max-w-xl flex-col border-l border-border bg-surface shadow-2xl">
      <header className="flex items-start justify-between gap-4 border-b border-border px-5 py-4 sm:px-6">
        <div><h2 id="client-status-title" className="text-lg font-semibold">Service status</h2><p className="mt-1 text-xs text-text-secondary">Status for your Super QA deployment</p></div>
        <button onClick={onClose} className="rounded-lg p-2 text-text-secondary hover:bg-elevated hover:text-text-primary" aria-label="Close service status"><X size={18} /></button>
      </header>

      <div className="flex items-center justify-between border-b border-border px-5 sm:px-6">
        <div className="flex gap-5" role="tablist" aria-label="Service status views">
          <button role="tab" aria-selected={tab === 'overview'} onClick={() => setTab('overview')} className={'border-b-2 py-3 text-sm ' + (tab === 'overview' ? 'border-accent-blue font-medium text-text-primary' : 'border-transparent text-text-secondary hover:text-text-primary')}>Current status</button>
          <button role="tab" aria-selected={tab === 'timeline'} onClick={() => setTab('timeline')} className={'border-b-2 py-3 text-sm ' + (tab === 'timeline' ? 'border-accent-blue font-medium text-text-primary' : 'border-transparent text-text-secondary hover:text-text-primary')}>Timeline</button>
        </div>
        <button type="button" onClick={() => void refresh()} disabled={busy} className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs text-text-secondary hover:bg-elevated hover:text-text-primary disabled:opacity-60"><RefreshCw size={13} className={busy ? 'animate-spin' : ''} />Refresh</button>
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-5 sm:px-6">
        {error && <p role="alert" className="mb-4 rounded-xl border border-warning/25 bg-warning/10 px-4 py-3 text-sm text-warning">{error}</p>}
        {!payload && busy && <div className="flex items-center gap-2 py-8 text-sm text-text-secondary"><LoaderCircle size={16} className="animate-spin" />Checking your services…</div>}
        {payload && tab === 'overview' && <>
          <div className={'rounded-xl border p-4 ' + (hasIssues ? 'border-danger/25 bg-danger/5' : 'border-success/25 bg-success/5')}>
            <div className="flex items-center gap-3"><span className={'flex h-9 w-9 items-center justify-center rounded-full ' + (hasIssues ? 'bg-danger/10 text-danger' : 'bg-success/10 text-success')}>{hasIssues ? <AlertTriangle size={18} /> : <Check size={18} />}</span><div><h3 className="text-sm font-semibold">{hasIssues ? 'Some services need attention' : 'All services are operational'}</h3><p className="mt-1 text-xs text-text-secondary">Last checked {new Date(payload.checkedAt).toLocaleString()}</p></div></div>
          </div>
          <div className="mt-5 divide-y divide-border">
            {services.map(service => {
              const state = badge(service.status);
              return <article key={service.id} className="flex items-start gap-3 py-4 first:pt-1">
                <span className="mt-0.5 flex h-9 w-9 flex-none items-center justify-center rounded-lg bg-elevated text-text-secondary"><Activity size={17} /></span>
                <div className="min-w-0 flex-1"><div className="flex flex-wrap items-center justify-between gap-2"><h4 className="text-sm font-medium">{service.name}</h4><span className={'inline-flex items-center gap-1.5 rounded-full border px-2 py-1 text-[11px] font-medium ' + state.classes}>{state.icon}{state.label}</span></div><p className="mt-1.5 text-xs leading-5 text-text-secondary">{service.detail}</p></div>
              </article>;
            })}
          </div>
        </>}
        {payload && tab === 'timeline' && <>
          <h3 className="text-sm font-semibold">Recent service history</h3>
          <p className="mt-1 text-xs text-text-secondary">Service issues and recovery times recorded for the last 30 days.</p>
          {incidents.length === 0
            ? <div className="mt-8 rounded-xl border border-border bg-elevated/40 px-4 py-6 text-center"><span className="mx-auto flex h-9 w-9 items-center justify-center rounded-full bg-success/10 text-success"><Check size={17} /></span><p className="mt-3 text-sm font-medium">No service issues recorded</p><p className="mt-1 text-xs text-text-secondary">Your service timeline is clear for the last 30 days.</p></div>
            : <ol className="mt-5 space-y-0">{incidents.map(incident => <li key={incident.id} className="relative flex gap-3 pb-6 last:pb-0"><span className="relative mt-1 flex h-8 w-8 flex-none items-center justify-center rounded-full bg-danger/10 text-danger"><AlertTriangle size={15} />{incident.resolvedAt && <span className="absolute -bottom-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-success text-white"><Check size={10} /></span>}</span><div className="min-w-0 flex-1 rounded-xl border border-border bg-elevated/40 p-3"><div className="flex flex-wrap items-center justify-between gap-2"><h4 className="text-sm font-medium">{serviceNames[incident.service] || 'Service'} issue</h4><span className="text-[11px] text-text-secondary">{incident.resolvedAt ? 'Resolved' : 'Ongoing'}</span></div><p className="mt-1 text-xs text-text-secondary">{incident.message}</p><p className="mt-2 flex items-center gap-1.5 text-[11px] text-text-secondary"><Clock3 size={12} />Started {new Date(incident.startedAt).toLocaleString()}</p>{incident.resolvedAt && <p className="mt-1 text-[11px] text-text-secondary">Recovered {new Date(incident.resolvedAt).toLocaleString()}</p>}</div></li>)}</ol>}
        </>}
      </div>
    </section>
  </div>;
}
