'use client';

import { useEffect, useState } from 'react';
import { CheckCircle2, ExternalLink, History, ListTodo, Loader2, Play, Plus, RotateCcw, XCircle } from 'lucide-react';
import { cn } from '@/lib/utils';

const API_BASE = `${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000'}/api/agents`;

type AutonomyLevel = 'observer' | 'suggest' | 'act';
type ApprovalStatus = 'not_required' | 'pending' | 'approved' | 'rejected';
type Trigger = { type: 'schedule'; cron: string } | { type: 'event'; event: string };
type Activity = {
  id: string; key: string; source: 'built_in' | 'custom'; name: string; description: string;
  skill: string; triggers: Trigger[]; autonomyLevel: AutonomyLevel; enabled: boolean;
};
type Run = {
  id: string; triggeredBy: string; status: 'queued' | 'running' | 'succeeded' | 'failed' | 'skipped';
  autonomyLevel: AutonomyLevel; resultSummary: string | null; error: string | null; createdAt: string;
  artifactRequestId: string | null; sessionId: string | null; approvalStatus: ApprovalStatus;
};
type RecentRun = Run & { activityName: string; activityKey: string; activitySource: string };

async function api<Value>(path: string, options?: RequestInit): Promise<Value> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...options?.headers },
    cache: 'no-store', credentials: 'same-origin',
  });
  if (!response.ok) throw new Error(`Outpost request failed (${response.status})`);
  return response.json();
}

function describeTrigger(trigger: Trigger): string {
  return trigger.type === 'schedule' ? `Schedule: ${trigger.cron}` : `Event: ${trigger.event}`;
}

const autonomyCopy: Record<AutonomyLevel, string> = {
  observer: 'Observer — notices & reports',
  suggest: 'Suggest — drafts a reviewable result',
  act: 'Act — takes the pre-approved action',
};

function RunHistory({ agentId, activityId }: { agentId: string; activityId: string }) {
  const [runs, setRuns] = useState<Run[] | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    setRuns(null); setError('');
    api<Run[]>(`/${agentId}/outpost/activities/${activityId}/runs`)
      .then(value => { if (!controller.signal.aborted) setRuns(value); })
      .catch(failure => { if (!controller.signal.aborted) setError((failure as Error).message); });
    return () => controller.abort();
  }, [agentId, activityId]);
  if (error) return <p role="alert" className="mt-2 text-xs text-danger">{error}</p>;
  if (!runs) return <p role="status" className="mt-2 text-xs text-text-secondary">Loading run history…</p>;
  if (!runs.length) return <p className="mt-2 text-xs text-text-secondary">No runs yet.</p>;
  return <ul className="mt-2 space-y-1.5">
    {runs.map(run => <li key={run.id} className="flex flex-wrap items-center gap-2 text-xs">
      <span className={cn('rounded-full border px-2 py-0.5 capitalize',
        run.status === 'succeeded' ? 'border-success/40 bg-success/10 text-success' :
        run.status === 'failed' ? 'border-danger/40 bg-danger/10 text-danger' :
        run.status === 'skipped' ? 'border-border text-text-secondary' :
        'border-accent-blue/40 bg-accent-blue/10 text-accent-blue')}>{run.status}</span>
      <span className="text-text-secondary">{run.triggeredBy}</span>
      <span className="text-text-secondary">{new Date(run.createdAt).toLocaleString()}</span>
      {(run.resultSummary || run.error) && <span className="w-full text-text-secondary">{run.error || run.resultSummary}</span>}
    </li>)}
  </ul>;
}

const statusBadgeClass: Record<Run['status'], string> = {
  succeeded: 'border-success/40 bg-success/10 text-success',
  failed: 'border-danger/40 bg-danger/10 text-danger',
  skipped: 'border-border text-text-secondary',
  running: 'border-accent-blue/40 bg-accent-blue/10 text-accent-blue',
  queued: 'border-accent-blue/40 bg-accent-blue/10 text-accent-blue',
};

function RecentActivityCard({ agentId, run, onOpenSession, onChanged }: { agentId: string; run: RecentRun; onOpenSession?: (sessionId: string) => void; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);

  const decide = async (approved: boolean) => {
    setBusy(true);
    try { await api(`/${agentId}/outpost/runs/${run.id}/approval`, { method: 'PATCH', body: JSON.stringify({ approved }) }); onChanged(); }
    finally { setBusy(false); }
  };

  return <article className="rounded-xl border border-border bg-surface p-4">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <h4 className="font-medium">{run.activityName}</h4>
          <span className={cn('rounded-full border px-2 py-0.5 text-[11px] font-medium capitalize', statusBadgeClass[run.status])}>{run.status}</span>
          <span className={cn('rounded-full border px-2 py-0.5 text-[11px] font-medium',
            run.activitySource === 'built_in' ? 'border-accent-blue/40 bg-accent-blue/10 text-accent-blue' : 'border-border text-text-secondary')}>
            {run.activitySource === 'built_in' ? 'Built-in' : 'Custom'}
          </span>
        </div>
        <p className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-text-secondary">
          <span>Triggered: {run.triggeredBy}</span>
          <span>·</span>
          <span className="capitalize">Autonomy: {run.autonomyLevel}</span>
          <span>·</span>
          <time dateTime={run.createdAt}>{new Date(run.createdAt).toLocaleString()}</time>
          <span>·</span>
          <span>{run.artifactRequestId ? 'Report available (see Results)' : 'No report produced'}</span>
        </p>
        {(run.resultSummary || run.error) && <p className="mt-2 text-sm">{run.error || run.resultSummary}</p>}
      </div>
      <div className="flex shrink-0 flex-col items-end gap-2">
        {run.sessionId && onOpenSession && <button type="button" onClick={() => onOpenSession(run.sessionId!)} className="inline-flex items-center gap-1 rounded-lg border border-border px-2 py-1 text-xs hover:bg-elevated"><ExternalLink size={12} />Open Console session</button>}
        {run.approvalStatus === 'pending' && <div className="flex items-center gap-1.5">
          <span className="rounded-full border border-warning/40 bg-warning/10 px-2 py-0.5 text-[11px] font-medium text-warning">Needs approval</span>
          <button type="button" disabled={busy} onClick={() => void decide(true)} title="Approve" className="rounded-lg border border-border p-1 hover:bg-elevated disabled:opacity-50"><CheckCircle2 size={14} className="text-success" /></button>
          <button type="button" disabled={busy} onClick={() => void decide(false)} title="Reject" className="rounded-lg border border-border p-1 hover:bg-elevated disabled:opacity-50"><XCircle size={14} className="text-danger" /></button>
        </div>}
        {run.approvalStatus === 'approved' && <span className="rounded-full border border-success/40 bg-success/10 px-2 py-0.5 text-[11px] font-medium text-success">Approved</span>}
        {run.approvalStatus === 'rejected' && <span className="rounded-full border border-danger/40 bg-danger/10 px-2 py-0.5 text-[11px] font-medium text-danger">Rejected</span>}
      </div>
    </div>
  </article>;
}

function RecentActivities({ agentId, onOpenSession, revision }: { agentId: string; onOpenSession?: (sessionId: string) => void; revision: number }) {
  const [runs, setRuns] = useState<RecentRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [localRevision, setLocalRevision] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError('');
    api<RecentRun[]>(`/${agentId}/outpost/runs`)
      .then(value => { if (!controller.signal.aborted) setRuns(value); })
      .catch(failure => { if (!controller.signal.aborted) setError((failure as Error).message); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [agentId, revision, localRevision]);

  return <section aria-label="Recent Activities">
    <h3 className="text-xl font-semibold tracking-tight">Recent Activities</h3>
    <p className="mt-1 text-sm text-text-secondary">What this agent noticed on its own, most recent first. Open a run's Console session to keep the conversation going.</p>
    {loading ? <p role="status" className="mt-4 flex items-center gap-2 text-sm text-text-secondary"><Loader2 size={14} className="animate-spin" />Loading recent activity…</p>
      : error ? <p role="alert" className="mt-4 text-sm text-danger">{error}</p>
      : !runs.length ? <p className="mt-4 text-sm text-text-secondary">No proactive runs yet.</p>
      : <div className="mt-4 space-y-3">{runs.map(run => <RecentActivityCard key={run.id} agentId={agentId} run={run} onOpenSession={onOpenSession} onChanged={() => setLocalRevision(value => value + 1)} />)}</div>}
  </section>;
}

function ActivityCard({ agentId, activity, onChanged }: { agentId: string; activity: Activity; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const base = `/${agentId}/outpost/activities/${activity.id}`;

  const setEnabled = async (enabled: boolean) => {
    setBusy(true);
    try { await api(`${base}/enabled`, { method: 'PATCH', body: JSON.stringify({ enabled }) }); onChanged(); }
    finally { setBusy(false); }
  };
  const setAutonomy = async (autonomyLevel: AutonomyLevel) => {
    setBusy(true);
    try { await api(`${base}/autonomy`, { method: 'PATCH', body: JSON.stringify({ autonomyLevel }) }); onChanged(); }
    finally { setBusy(false); }
  };
  const runNow = async () => {
    setBusy(true);
    try { await api(`${base}/run`, { method: 'POST' }); setExpanded(true); }
    finally { setBusy(false); }
  };

  return <article className="rounded-xl border border-border bg-surface p-4">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <h4 className="font-medium">{activity.name}</h4>
          <span className={cn('rounded-full border px-2 py-0.5 text-[11px] font-medium',
            activity.source === 'built_in' ? 'border-accent-blue/40 bg-accent-blue/10 text-accent-blue' : 'border-border text-text-secondary')}>
            {activity.source === 'built_in' ? 'Built-in' : 'Custom'}
          </span>
        </div>
        <p className="mt-1 text-sm text-text-secondary">{activity.description}</p>
        <p className="mt-1.5 flex flex-wrap gap-2 text-xs text-text-secondary">
          {activity.triggers.map((trigger, index) => <span key={index} className="rounded-full bg-elevated px-2 py-0.5">{describeTrigger(trigger)}</span>)}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <button type="button" disabled={busy} onClick={runNow} title="Run now" className="inline-flex items-center gap-1 rounded-lg border border-border px-2 py-1 text-xs hover:bg-elevated disabled:opacity-50"><Play size={12} />Run now</button>
        <label className="inline-flex items-center gap-1.5 text-xs">
          <input type="checkbox" checked={activity.enabled} disabled={busy} onChange={event => void setEnabled(event.target.checked)} />
          Enabled
        </label>
      </div>
    </div>
    <div className="mt-3 flex flex-wrap items-center gap-3">
      <label className="text-xs text-text-secondary">Autonomy</label>
      <select value={activity.autonomyLevel} disabled={busy} onChange={event => void setAutonomy(event.target.value as AutonomyLevel)}
        className="rounded-lg border border-border bg-surface px-2 py-1 text-xs">
        {(['observer', 'suggest', 'act'] as AutonomyLevel[]).map(level => <option key={level} value={level}>{autonomyCopy[level]}</option>)}
      </select>
      <button type="button" onClick={() => setExpanded(value => !value)} className="text-xs text-accent-blue">{expanded ? 'Hide run history' : 'Show run history'}</button>
    </div>
    {expanded && <RunHistory agentId={agentId} activityId={activity.id} />}
  </article>;
}

function AddActivityForm({ agentId, onCreated, onCancel }: { agentId: string; onCreated: () => void; onCancel: () => void }) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [skill, setSkill] = useState('');
  const [instructions, setInstructions] = useState('');
  const [triggerType, setTriggerType] = useState<'schedule' | 'event'>('schedule');
  const [triggerValue, setTriggerValue] = useState('0 7 * * *');
  const [autonomyLevel, setAutonomyLevel] = useState<AutonomyLevel>('observer');
  const [createdBy, setCreatedBy] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true); setError('');
    try {
      await api(`/${agentId}/outpost/activities`, {
        method: 'POST',
        body: JSON.stringify({
          name, description, skill, instructions: instructions || undefined, autonomyLevel, createdBy,
          triggers: [triggerType === 'schedule' ? { type: 'schedule', cron: triggerValue } : { type: 'event', event: triggerValue }],
        }),
      });
      onCreated();
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return <div className="rounded-xl border border-dashed border-border p-4">
    <h4 className="font-medium">Add a custom Activity</h4>
    <div className="mt-3 grid gap-2 sm:grid-cols-2">
      <input value={name} onChange={event => setName(event.target.value)} placeholder="Name" className="rounded-lg border border-border bg-surface px-2 py-1.5 text-sm" />
      <input value={skill} onChange={event => setSkill(event.target.value)} placeholder="Skill name (e.g. analyze_coverage)" className="rounded-lg border border-border bg-surface px-2 py-1.5 text-sm" />
      <input value={description} onChange={event => setDescription(event.target.value)} placeholder="Description" className="rounded-lg border border-border bg-surface px-2 py-1.5 text-sm sm:col-span-2" />
      <select value={triggerType} onChange={event => setTriggerType(event.target.value as 'schedule' | 'event')} className="rounded-lg border border-border bg-surface px-2 py-1.5 text-sm">
        <option value="schedule">Schedule (cron)</option>
        <option value="event">Event</option>
      </select>
      <input value={triggerValue} onChange={event => setTriggerValue(event.target.value)} placeholder={triggerType === 'schedule' ? 'Cron expression' : 'Event name'} className="rounded-lg border border-border bg-surface px-2 py-1.5 text-sm" />
      <select value={autonomyLevel} onChange={event => setAutonomyLevel(event.target.value as AutonomyLevel)} className="rounded-lg border border-border bg-surface px-2 py-1.5 text-sm">
        {(['observer', 'suggest', 'act'] as AutonomyLevel[]).map(level => <option key={level} value={level}>{autonomyCopy[level]}</option>)}
      </select>
      <input value={createdBy} onChange={event => setCreatedBy(event.target.value)} placeholder="Your member ID" className="rounded-lg border border-border bg-surface px-2 py-1.5 text-sm" />
      <textarea value={instructions} onChange={event => setInstructions(event.target.value)} placeholder="Instructions for this activity (optional, plain text)" rows={3} className="rounded-lg border border-border bg-surface px-2 py-1.5 text-sm sm:col-span-2" />
    </div>
    {error && <p role="alert" className="mt-2 text-xs text-danger">{error}</p>}
    <div className="mt-3 flex gap-2">
      <button type="button" disabled={busy || !name || !skill} onClick={submit} className="rounded-lg bg-accent-blue px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50">Create</button>
      <button type="button" onClick={onCancel} className="rounded-lg border border-border px-3 py-1.5 text-xs">Cancel</button>
    </div>
  </div>;
}

type OutpostSection = 'recents' | 'management';

export function OutpostPanel({ agentId, onOpenSession }: { agentId: string; onOpenSession?: (sessionId: string) => void }) {
  const [section, setSection] = useState<OutpostSection>('recents');
  const [activities, setActivities] = useState<Activity[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError('');
    api<Activity[]>(`/${agentId}/outpost/activities`)
      .then(value => { if (!controller.signal.aborted) setActivities(value); })
      .catch(failure => { if (!controller.signal.aborted) setError((failure as Error).message); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [agentId, revision]);

  return <div className="flex min-h-0 flex-col gap-5 lg:flex-row lg:items-start">
    <nav aria-label="Outpost sections" className="flex w-36 shrink-0 flex-col gap-1 border-r border-border/70 pb-2 pr-3 lg:py-1 md:w-44">
      {([{ id: 'recents', title: 'Recents', icon: History }, { id: 'management', title: 'Management', icon: ListTodo }] as const).map(item =>
        <button key={item.id} type="button" onClick={() => setSection(item.id)} aria-current={section === item.id ? 'page' : undefined}
          className={cn('inline-flex min-h-10 items-center gap-2 rounded-lg px-3 text-left text-sm font-medium transition-colors',
            section === item.id ? 'bg-accent-blue/10 text-accent-blue' : 'text-text-secondary hover:bg-elevated hover:text-text-primary')}>
          <item.icon size={15} className="shrink-0" />{item.title}
        </button>)}
    </nav>

    <div className="min-w-0 flex-1">
      {section === 'recents' && <RecentActivities agentId={agentId} onOpenSession={onOpenSession} revision={revision} />}

      {section === 'management' && <section aria-label="Activity Management">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h3 className="text-xl font-semibold tracking-tight">Activity Management</h3>
            <p className="mt-1 text-sm text-text-secondary">Configure what this Outpost watches for — enable or disable built-ins, set each one's autonomy level, or add your own.</p>
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={() => setAdding(value => !value)} className="inline-flex items-center gap-1 rounded-lg border border-border px-2 py-1 text-xs hover:bg-elevated"><Plus size={12} />Add</button>
            <button type="button" onClick={() => setRevision(value => value + 1)} disabled={loading} className="inline-flex items-center gap-1 rounded-lg border border-border px-2 py-1 text-xs hover:bg-elevated disabled:opacity-50"><RotateCcw size={12} />Refresh</button>
          </div>
        </div>

        {adding && <div className="mt-4"><AddActivityForm agentId={agentId} onCreated={() => { setAdding(false); setRevision(value => value + 1); }} onCancel={() => setAdding(false)} /></div>}

        {loading ? <p role="status" className="mt-4 flex items-center gap-2 text-sm text-text-secondary"><Loader2 size={14} className="animate-spin" />Loading activities…</p>
          : error ? <p role="alert" className="mt-4 text-sm text-danger">{error}</p>
          : !activities.length ? <p className="mt-4 text-sm text-text-secondary">No activities configured yet.</p>
          : <div className="mt-4 space-y-3">{activities.map(activity => <ActivityCard key={activity.id} agentId={agentId} activity={activity} onChanged={() => setRevision(value => value + 1)} />)}</div>}
      </section>}
    </div>
  </div>;
}
