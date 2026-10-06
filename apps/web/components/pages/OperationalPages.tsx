'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { Activity, AlertTriangle, ArrowDownToLine, CheckCircle2, ChevronDown, ChevronRight, Clock3, Eye, FileBarChart2, Filter, ListChecks, LockKeyhole, Play, Plus, RefreshCw, Save, Search, ShieldCheck, SlidersHorizontal, Target, Trash2, X } from 'lucide-react';
import { EnvironmentsPage } from './Environments';
import { LiveExecutionViewer } from '../execution/LiveExecutionViewer';
import { AddTestCasesModal } from '../execution/AddTestCasesModal';
import { ExecutionWizardModal } from '../execution/ExecutionWizardModal';
import { ExecutionDetailPage, type ExecutionRecord } from '../execution/ExecutionDetailPage';
import { ReportDetailPage } from '../execution/ReportDetailPage';
import { formatDuration } from '@/lib/utils';

const API = `${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000'}/api`;
type Case = { id: string; title: string; priority: string; automation: string; reviewStatus: string; flow: string; risk: string; lastRun?: string | null; passRate?: number | null; evidence?: { businessItemId: string } | null };
type Plan = { id: string; name: string; description: string; testIds: string[]; environment: string; browser: string; updatedAt: string };
type Execution = ExecutionRecord;
type LiveRun = { runId: string; testId: string; testName: string; status: string; startedAt: string };
const panel = 'rounded-xl border border-border bg-surface';
const input = 'rounded-lg border border-border bg-canvas px-3 py-2.5 text-sm text-text-primary outline-none transition placeholder:text-text-secondary/70 focus:border-accent-blue focus:ring-2 focus:ring-accent-blue/15';
const button = 'inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-accent-blue px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-accent-blue/90 disabled:opacity-45';
const secondaryButton = 'inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-border bg-elevated/55 px-3 py-2 text-sm font-medium text-text-secondary transition hover:border-border-strong hover:bg-elevated hover:text-text-primary';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API}${path}`, { ...init, headers: { 'Content-Type': 'application/json', ...init?.headers } });
  if (!response.ok) { const detail = await response.json().catch(() => null); throw new Error(detail?.message || `Request failed (${response.status})`); }
  if (response.status === 204) return undefined as T;
  return response.json();
}

function useQaData() {
  const [cases, setCases] = useState<Case[]>([]);
  const [executions, setExecutions] = useState<Execution[]>([]);
  const [error, setError] = useState('');
  const refresh = useCallback(async () => {
    try {
      const [nextCases, nextExecutions] = await Promise.all([request<Case[]>('/qa/test-cases'), request<Execution[]>('/qa/executions')]);
      setCases(nextCases); setExecutions(nextExecutions); setError('');
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not load QA data'); }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);
  return { cases, executions, error, refresh };
}

function PageHeader({ title, subtitle, onRefresh, action }: { title: string; subtitle: string; onRefresh?: () => void; action?: React.ReactNode }) {
  return <header className="relative isolate flex-none overflow-x-clip bg-surface/60 px-6 py-6 md:px-8 md:py-7">
    <div aria-hidden="true" className="pointer-events-none absolute -right-24 -top-40 -z-10 h-80 w-80 rounded-full bg-accent-blue/10 blur-3xl" />
    <div aria-hidden="true" className="pointer-events-none absolute right-[18%] top-0 -z-10 h-px w-56 bg-gradient-to-r from-transparent via-accent-blue/55 to-transparent" />
    <div className="flex flex-wrap items-end justify-between gap-5"><div className="min-w-0">
      <div className="min-w-0"><h1 className="text-xl font-semibold tracking-tight text-text-primary">{title}</h1><p className="mt-1 max-w-2xl text-sm leading-5 text-text-secondary">{subtitle}</p></div>
    </div><div className="flex items-center gap-2">{action}{onRefresh && <button aria-label="Refresh page data" className={secondaryButton} onClick={onRefresh}><RefreshCw size={14}/>Refresh</button>}</div></div>
  </header>;
}

function StatusPill({ status }: { status: string }) {
  const tone = ['passed', 'approved', 'completed', 'covered'].includes(status) ? 'bg-success/10 text-success ring-success/15' : ['failed', 'rejected', 'error'].includes(status) ? 'bg-danger/10 text-danger ring-danger/15' : ['running', 'queued', 'pending', 'no result'].includes(status) ? 'bg-warning/10 text-warning ring-warning/15' : 'bg-elevated text-text-secondary ring-border';
  return <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold capitalize ring-1 ring-inset ${tone}`}><span className={`h-1.5 w-1.5 rounded-full ${['passed','approved','completed','covered'].includes(status) ? 'bg-success' : ['failed','rejected','error'].includes(status) ? 'bg-danger' : ['running','queued','pending','no result'].includes(status) ? 'bg-warning' : 'bg-text-secondary'}`}/>{status.replaceAll('_', ' ')}</span>;
}

function FilterInput({ value, onChange, placeholder }: { value: string; onChange: (value: string) => void; placeholder: string }) {
  return <label className="relative block min-w-[190px] flex-1"><Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-secondary"/><input className={`${input} w-full pl-9`} value={value} onChange={event => onChange(event.target.value)} placeholder={placeholder}/></label>;
}

function ModeBadge({ mode }: { mode: string }) {
  const isAgent = mode === 'agent';
  return <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium capitalize ${isAgent ? 'bg-info/10 text-info' : 'bg-elevated text-text-secondary'}`}><span className={`h-1.5 w-1.5 rounded-full ${isAgent ? 'bg-info' : 'bg-text-secondary'}`}/>{mode}</span>;
}

export function ExecutionPlansPage() {
  const { cases, error, refresh } = useQaData();
  const [plans, setPlans] = useState<Plan[]>([]); const [name, setName] = useState(''); const [description, setDescription] = useState('');
  const [environment, setEnvironment] = useState('manual'); const [browser, setBrowser] = useState('manual'); const [testIds, setTestIds] = useState<string[]>([]);
  const [editingId, setEditingId] = useState(''); const [busy, setBusy] = useState(false); const [message, setMessage] = useState(''); const [addModalOpen, setAddModalOpen] = useState(false);
  const load = useCallback(async () => { try { setPlans(await request<Plan[]>('/qa/plans')); setMessage(''); } catch (e) { setMessage(e instanceof Error ? e.message : 'Could not load plans'); } }, []);
  useEffect(() => { void load(); }, [load]);
  const clearForm = () => { setEditingId(''); setName(''); setDescription(''); setEnvironment('manual'); setBrowser('manual'); setTestIds([]); };
  const edit = (plan: Plan) => { setEditingId(plan.id); setName(plan.name); setDescription(plan.description); setEnvironment(plan.environment); setBrowser(plan.browser); setTestIds(plan.testIds); };
  const save = async () => { setBusy(true); try { await request(`/qa/plans${editingId ? `/${editingId}` : ''}`, { method: editingId ? 'PUT' : 'POST', body: JSON.stringify({ name, description, environment, browser, testIds }) }); clearForm(); await load(); } catch (e) { setMessage(e instanceof Error ? e.message : 'Could not save plan'); } finally { setBusy(false); } };
  const run = async (id: string) => { setBusy(true); try { const result = await request<{ testsQueued: number }>('/qa/plans/' + id + '/run', { method: 'POST' }); setMessage(`Run created with ${result.testsQueued} test${result.testsQueued === 1 ? '' : 's'}. Record results from Executions.`); } catch (e) { setMessage(e instanceof Error ? e.message : 'Could not run plan'); } finally { setBusy(false); } };
  const remove = async (id: string) => { try { await request(`/qa/plans/${id}`, { method: 'DELETE' }); await load(); } catch (e) { setMessage(e instanceof Error ? e.message : 'Could not delete plan'); } };
  const eligible = cases.filter(test => test.reviewStatus === 'approved');
  const planCases = (plan: Plan) => plan.testIds.map(id => cases.find(test => test.id === id)?.title).filter(Boolean);
  return <div className="flex h-full min-h-0 flex-col overflow-auto bg-canvas">
    <PageHeader title="Execution Plans" subtitle="Build repeatable suites for a target environment and browser." onRefresh={() => { void load(); void refresh(); }} action={<span className="hidden rounded-full border border-border bg-canvas/70 px-3 py-2 text-xs text-text-secondary sm:inline-flex"><span className="mr-2 h-1.5 w-1.5 self-center rounded-full bg-success"/>{plans.length} saved plans</span>}/>
    <div className="grid min-h-0 gap-5 p-5 md:p-7 xl:grid-cols-[minmax(360px,.85fr)_minmax(480px,1.3fr)]">
      <section className={`${panel} overflow-hidden`}>
        <div className="border-b border-border px-5 py-4"><div className="flex items-center justify-between gap-2"><div><p className="text-[10px] font-semibold uppercase tracking-[.18em] text-accent-blue">{editingId ? 'Plan editor' : 'New plan'}</p><h2 className="mt-1 text-lg font-semibold">{editingId ? 'Update suite details' : 'Configure a test suite'}</h2></div>{editingId && <button aria-label="Cancel editing" className={secondaryButton} onClick={clearForm}><X size={15}/></button>}</div></div>
        <div className="space-y-4 p-5">
          <label className="block text-xs font-semibold text-text-secondary">PLAN NAME <span className="text-danger">*</span><input className={`${input} mt-1.5 w-full`} value={name} onChange={e => setName(e.target.value)} maxLength={200} placeholder="e.g. Checkout smoke · staging"/></label>
          <label className="block text-xs font-semibold text-text-secondary">PURPOSE / NOTES<textarea className={`${input} mt-1.5 w-full resize-y`} value={description} onChange={e => setDescription(e.target.value)} rows={2} maxLength={4000} placeholder="What should this run validate? Add context for the team."/></label>
          <div className="grid grid-cols-2 gap-3"><label className="block text-xs font-semibold text-text-secondary">TARGET ENVIRONMENT<select className={`${input} mt-1.5 w-full`} value={environment} onChange={e => setEnvironment(e.target.value)}><option value="manual">Manual / local</option><option value="development">Development</option><option value="staging">Staging</option><option value="production">Production</option></select></label><label className="block text-xs font-semibold text-text-secondary">BROWSER<select className={`${input} mt-1.5 w-full`} value={browser} onChange={e => setBrowser(e.target.value)}><option value="manual">Manual</option><option value="chromium">Chromium</option><option value="firefox">Firefox</option><option value="webkit">WebKit</option></select></label></div>
          <div className="overflow-hidden rounded-xl border border-border bg-canvas/70">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-3">
              <div><p className="text-sm font-semibold">Test selection</p><p className="mt-0.5 text-xs text-text-secondary">Only reviewed and approved cases can run.</p></div>
              <button type="button" className="ui-button-secondary text-xs" onClick={() => setAddModalOpen(true)}><Plus size={14}/>Add tests</button>
            </div>
            <div className="max-h-64 overflow-auto p-3">
              {testIds.length ? <div className="flex flex-wrap gap-2">{testIds.map(id => {
                const test = cases.find(item => item.id === id);
                return <span key={id} className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-accent-blue/20 bg-accent-blue/5 px-2.5 py-1.5 text-xs text-accent-blue">
                  <span className="max-w-[220px] truncate">{test?.title || id}</span>
                  <button type="button" aria-label={`Remove ${test?.title || id}`} onClick={() => setTestIds(ids => ids.filter(existing => existing !== id))} className="text-accent-blue/70 hover:text-accent-blue"><X size={12}/></button>
                </span>;
              })}</div> : <div className="flex flex-col items-center gap-2 px-4 py-6 text-center">
                <span className="flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-canvas text-text-secondary"><ListChecks size={16}/></span>
                <p className="text-sm font-medium">No cases added yet</p>
                <p className="max-w-xs text-xs leading-5 text-text-secondary">Use "Add tests" above to search approved cases and build this plan.</p>
              </div>}
            </div>
          </div>
          <div className="flex items-center justify-between gap-3 border-t border-border pt-4"><p className="text-xs text-text-secondary">{testIds.length} case{testIds.length === 1 ? '' : 's'} · {environment} · {browser}</p><button className={button} disabled={busy || !name.trim() || !testIds.length} onClick={() => void save()}><Save size={15}/>{busy ? 'Saving…' : editingId ? 'Save changes' : 'Save execution plan'}</button></div>
          {(error || message) && <p role="alert" className="rounded-lg border border-danger/20 bg-danger/5 px-3 py-2 text-sm text-danger">{error || message}</p>}
        </div>
      </section>
      <section className={`${panel} min-w-0 overflow-hidden`}><div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4"><div><p className="text-[10px] font-semibold uppercase tracking-[.18em] text-text-secondary">Plan library</p><h2 className="mt-1 text-lg font-semibold">Saved execution plans</h2></div><span className="rounded-full bg-elevated px-3 py-1 text-xs text-text-secondary">{plans.length} total</span></div>
        {plans.length ? <div className="overflow-x-auto"><table className="w-full min-w-[640px] text-left text-sm"><thead className="bg-canvas/65 text-[10px] font-semibold uppercase tracking-[.15em] text-text-secondary"><tr><th className="px-5 py-3">Plan</th><th className="px-3 py-3">Cases</th><th className="px-3 py-3">Target</th><th className="px-3 py-3">Updated</th><th className="px-4 py-3 text-right">Actions</th></tr></thead><tbody className="divide-y divide-border">{plans.map((plan, index) => <tr key={plan.id} className="group transition-colors hover:bg-elevated/35"><td className="px-5 py-4"><div className="flex items-start gap-3"><span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-accent-blue/15 bg-accent-blue/5 font-mono text-xs text-accent-blue">{String(index + 1).padStart(2, '0')}</span><span className="min-w-0"><span className="block font-semibold text-text-primary">{plan.name}</span><span className="mt-1 block max-w-[280px] truncate text-xs text-text-secondary">{plan.description || planCases(plan).slice(0, 2).join(' · ') || 'No description provided'}</span></span></div></td><td className="px-3 py-4"><span className="font-mono text-sm">{plan.testIds.length}</span><span className="ml-1 text-xs text-text-secondary">cases</span></td><td className="px-3 py-4"><span className="block capitalize">{plan.environment}</span><span className="mt-1 block text-xs capitalize text-text-secondary">{plan.browser}</span></td><td className="px-3 py-4 text-xs text-text-secondary">{new Date(plan.updatedAt).toLocaleDateString()}</td><td className="px-4 py-4"><div className="flex justify-end gap-1"><button className="ui-icon-button text-accent-blue" aria-label={`Run ${plan.name}`} title="Run plan" disabled={busy} onClick={() => void run(plan.id)}><Play size={15}/></button><button className="ui-icon-button" aria-label={`Edit ${plan.name}`} title="Edit plan" onClick={() => edit(plan)}><SlidersHorizontal size={15}/></button><button className="ui-icon-button hover:!text-danger" aria-label={`Delete ${plan.name}`} title="Delete plan" onClick={() => void remove(plan.id)}><Trash2 size={15}/></button></div></td></tr>)}</tbody></table></div> : <div className="grid min-h-72 place-content-center justify-items-center px-8 text-center"><span className="flex h-12 w-12 items-center justify-center rounded-2xl border border-border bg-canvas text-text-secondary"><ListChecks size={21}/></span><h3 className="mt-4 font-semibold">Your plan library is empty</h3><p className="mt-1 max-w-sm text-sm leading-6 text-text-secondary">Create a suite from approved test cases. Saved plans keep the target and browser settings ready for the next run.</p></div>}
      </section>
    </div>
    {addModalOpen && <AddTestCasesModal candidates={eligible} initialSelected={testIds} onClose={() => setAddModalOpen(false)} onConfirm={ids => { setTestIds(ids); setAddModalOpen(false); }}/>}
  </div>;
}

const ROW_STATUS_ACCENT: Record<string, string> = {
  passed: 'border-l-success', failed: 'border-l-danger', error: 'border-l-danger',
  running: 'border-l-info', pending: 'border-l-warning', cancelled: 'border-l-border',
};

const STATUS_RANK: Record<string, number> = { error: 0, failed: 1, running: 2, pending: 3, cancelled: 4, passed: 5 };
const worstStatus = (statuses: string[]) => statuses.slice().sort((a, b) => (STATUS_RANK[a] ?? 9) - (STATUS_RANK[b] ?? 9))[0];

type ExecTab = 'all' | 'test' | 'suite';

export function ExecutionsPage() {
  const reduceMotion = useReducedMotion();
  const { cases, executions, error, refresh } = useQaData();
  const [liveRuns, setLiveRuns] = useState<LiveRun[]>([]);
  const [message, setMessage] = useState('');
  const [viewing, setViewing] = useState<{ runId: string; testName: string } | null>(null);
  const [detail, setDetail] = useState<Execution | null>(null);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [execTab, setExecTab] = useState<ExecTab>('all');
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [environmentFilter, setEnvironmentFilter] = useState('all');
  const [modeFilter, setModeFilter] = useState('all');
  const eligible = cases.filter(test => test.reviewStatus === 'approved');

  const pollLive = useCallback(async () => {
    try { setLiveRuns(await request<LiveRun[]>('/agents/executions/live')); } catch { /* agent runtime may be offline */ }
  }, []);
  useEffect(() => { void pollLive(); const interval = setInterval(pollLive, 3000); return () => clearInterval(interval); }, [pollLive]);

  const agentRunIds = new Set(executions.map(execution => execution.agentRunId).filter(Boolean));
  const untrackedLiveRuns = liveRuns.filter(run => run.status === 'running' && !agentRunIds.has(run.runId));

  const statusOptions = [...new Set(executions.map(item => item.status))];
  const environmentOptions = [...new Set(executions.map(item => item.environment).filter(Boolean))];
  const modeOptions = [...new Set(executions.map(item => item.mode || 'manual'))];
  const anyFilterActive = query.trim() !== '' || statusFilter !== 'all' || environmentFilter !== 'all' || modeFilter !== 'all';
  const clearFilters = () => { setQuery(''); setStatusFilter('all'); setEnvironmentFilter('all'); setModeFilter('all'); };
  const matchesFilters = (execution: Execution) =>
    (statusFilter === 'all' || execution.status === statusFilter) &&
    (environmentFilter === 'all' || execution.environment === environmentFilter) &&
    (modeFilter === 'all' || (execution.mode || 'manual') === modeFilter) &&
    (!query.trim() || execution.testName.toLowerCase().includes(query.trim().toLowerCase()));
  const filteredExecutions = executions.filter(matchesFilters);
  // Live runs don't carry environment/mode yet, so an active environment/mode filter can't
  // confirm a match — hide them rather than show a row that might not actually qualify.
  const filteredLiveRuns = untrackedLiveRuns.filter(run =>
    (statusFilter === 'all' || run.status === statusFilter) &&
    environmentFilter === 'all' && modeFilter === 'all' &&
    (!query.trim() || run.testName.toLowerCase().includes(query.trim().toLowerCase())));

  const runGroups = new Map<string, Execution[]>();
  filteredExecutions.forEach(execution => { const list = runGroups.get(execution.runId) || []; list.push(execution); runGroups.set(execution.runId, list); });
  const suiteRunIds = new Set([...runGroups.entries()].filter(([, list]) => list.length > 1).map(([runId]) => runId));
  const suites = [...runGroups.entries()].filter(([, list]) => list.length > 1).map(([runId, list]) => ({
    runId,
    lead: list[0],
    count: list.length,
    status: worstStatus(list.map(item => item.status)),
    createdAt: list.reduce((latest, item) => item.createdAt > latest ? item.createdAt : latest, list[0].createdAt),
  }));
  const standaloneExecutions = filteredExecutions.filter(execution => !suiteRunIds.has(execution.runId));
  const visibleExecutions = execTab === 'test' ? standaloneExecutions : execTab === 'suite' ? [] : filteredExecutions;
  const visibleLiveRuns = execTab === 'suite' ? [] : filteredLiveRuns;

  const handleRunStarted = (run: { runId: string; testName: string }) => {
    setMessage(`Run started: ${run.runId}`);
    setViewing(run);
    setWizardOpen(false);
    void refresh();
    void pollLive();
  };

  if (viewing) {
    return <LiveExecutionViewer runId={viewing.runId} testName={viewing.testName} onClose={() => setViewing(null)} variant="page"/>;
  }

  if (detail) {
    return <ExecutionDetailPage execution={detail} allExecutions={executions} onExit={() => setDetail(null)}/>;
  }

  return <div className="flex h-full min-h-0 flex-col overflow-auto bg-canvas">
    <PageHeader title="Executions" subtitle="Watch agent-driven runs live and review execution history." onRefresh={() => { void refresh(); void pollLive(); }}
      action={<div className="flex items-center gap-2">
        {untrackedLiveRuns.length + executions.filter(e => e.status === 'running').length > 0 &&
          <span className="inline-flex items-center gap-2 rounded-full border border-info/20 bg-info/5 px-3 py-2 text-xs text-info"><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-info"/>{untrackedLiveRuns.length + executions.filter(e => e.status === 'running').length} running</span>}
        <button type="button" onClick={() => setWizardOpen(true)} className={button}><Play size={14}/>Execute</button>
      </div>}/>

    <div className="p-5 md:p-7">
      {(error || message) && <p role="status" className={`${panel} mb-5 px-4 py-3 text-sm text-text-secondary`}>{error || message}</p>}

      <section className={`${panel} min-w-0 overflow-hidden`}>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 pt-4">
          <div className="flex gap-5">
            {([
              { id: 'all' as const, label: `All${filteredExecutions.length + filteredLiveRuns.length ? ` · ${filteredExecutions.length + filteredLiveRuns.length}` : ''}` },
              { id: 'test' as const, label: `Test${standaloneExecutions.length ? ` · ${standaloneExecutions.length}` : ''}` },
              { id: 'suite' as const, label: `Suite${suites.length ? ` · ${suites.length}` : ''}` },
            ]).map(tab => (
              <button key={tab.id} onClick={() => setExecTab(tab.id)} className={`relative pb-3 text-sm font-medium capitalize transition-colors ${execTab === tab.id ? 'text-accent-blue' : 'text-text-secondary hover:text-text-primary'}`}>
                {tab.label}
                {execTab === tab.id && <motion.span layoutId="executions-tab-indicator" transition={reduceMotion ? { duration: 0 } : { type: 'spring', stiffness: 500, damping: 40 }} className="absolute inset-x-0 bottom-0 h-0.5 rounded-full bg-accent-blue"/>}
              </button>
            ))}
          </div>
          <span className="pb-3 text-xs text-text-secondary">{execTab === 'all' ? `${filteredExecutions.length + filteredLiveRuns.length} total` : execTab === 'test' ? `${standaloneExecutions.length} standalone` : `${suites.length} suites`}</span>
        </div>

        <div className="flex flex-wrap items-center gap-2 border-b border-border bg-canvas/30 px-5 py-3">
          <FilterInput value={query} onChange={setQuery} placeholder="Search by test name…"/>
          <select aria-label="Filter by status" className={input} value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
            <option value="all">All statuses</option>
            {statusOptions.map(item => <option key={item} value={item} className="capitalize">{item}</option>)}
          </select>
          <select aria-label="Filter by environment" className={input} value={environmentFilter} onChange={e => setEnvironmentFilter(e.target.value)}>
            <option value="all">All environments</option>
            {environmentOptions.map(item => <option key={item} value={item} className="capitalize">{item}</option>)}
          </select>
          <select aria-label="Filter by mode" className={input} value={modeFilter} onChange={e => setModeFilter(e.target.value)}>
            <option value="all">All modes</option>
            {modeOptions.map(item => <option key={item} value={item} className="capitalize">{item}</option>)}
          </select>
          {anyFilterActive && <button type="button" onClick={clearFilters} className="inline-flex items-center gap-1 text-xs font-medium text-text-secondary transition-colors hover:text-text-primary"><X size={13}/>Clear filters</button>}
        </div>

        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={execTab}
            initial={reduceMotion ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={reduceMotion ? {} : { opacity: 0 }}
            transition={{ duration: 0.12 }}
            className="overflow-x-auto"
          >
            <table className="w-full min-w-[880px] text-left text-sm"><thead className="bg-canvas/65 text-[10px] font-semibold uppercase tracking-[.15em] text-text-secondary"><tr><th className="px-5 py-3">Test</th><th className="px-3 py-3">{execTab === 'suite' ? 'Tests' : 'Mode'}</th><th className="px-3 py-3">Status</th><th className="px-3 py-3">Environment</th><th className="px-3 py-3">Browser</th><th className="px-3 py-3">Started</th><th className="px-4 py-3 text-right">{execTab === 'suite' ? '' : 'Duration'}</th></tr></thead>
              <tbody className="divide-y divide-border">
                {execTab === 'suite' ? <>
                  {suites.map((suite, index) => <motion.tr
                    key={suite.runId}
                    initial={reduceMotion ? false : { opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.2, delay: reduceMotion ? 0 : Math.min(index, 14) * 0.03 }}
                    className={`group cursor-pointer border-l-2 ${ROW_STATUS_ACCENT[suite.status] || 'border-l-border'} transition-colors hover:bg-elevated/35`}
                    onClick={() => setDetail(suite.lead)}
                  >
                    <td className="px-5 py-4 font-medium">{suite.lead.testName}<span className="ml-1.5 text-text-secondary">+{suite.count - 1} more</span></td>
                    <td className="px-3 py-4 tabular-nums text-text-secondary">{suite.count}</td>
                    <td className="px-3 py-4"><StatusPill status={suite.status}/></td>
                    <td className="px-3 py-4 capitalize text-text-secondary">{suite.lead.environment}</td>
                    <td className="px-3 py-4 capitalize text-text-secondary">{suite.lead.browser}</td>
                    <td className="px-3 py-4 text-xs text-text-secondary">{new Date(suite.createdAt).toLocaleDateString()}</td>
                    <td className="px-4 py-4 text-right"><ChevronRight size={13} className="ml-auto text-text-secondary transition-colors group-hover:text-text-primary"/></td>
                  </motion.tr>)}
                  {!suites.length && <tr><td colSpan={7} className="px-5 py-10 text-center text-sm text-text-secondary">No multi-test suite runs yet. Suites appear here when a plan with more than one test case runs.</td></tr>}
                </> : <>
                {visibleLiveRuns.map((run, index) => <motion.tr key={run.runId} initial={reduceMotion ? false : { opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2, delay: reduceMotion ? 0 : Math.min(index, 14) * 0.03 }} className="border-l-2 border-l-info transition-colors hover:bg-elevated/35"><td className="px-5 py-4 font-medium">{run.testName}</td><td className="px-3 py-4"><ModeBadge mode="agent"/></td><td className="px-3 py-4"><StatusPill status={run.status}/></td><td className="px-3 py-4 text-text-secondary">—</td><td className="px-3 py-4 text-text-secondary">—</td><td className="px-3 py-4 text-xs text-text-secondary">{new Date(run.startedAt).toLocaleTimeString()}</td><td className="px-4 py-4 text-right"><button className={secondaryButton} onClick={() => setViewing({ runId: run.runId, testName: run.testName })}><Eye size={14}/>View Live Execution</button></td></motion.tr>)}
                {visibleExecutions.map((execution, index) => {
                  const isLive = execution.agentRunId && execution.status === 'running';
                  const accent = ROW_STATUS_ACCENT[execution.status] || 'border-l-border';
                  return <motion.tr
                    key={execution.id}
                    initial={reduceMotion ? false : { opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.2, delay: reduceMotion ? 0 : Math.min(visibleLiveRuns.length + index, 14) * 0.03 }}
                    className={`group cursor-pointer border-l-2 ${accent} transition-colors hover:bg-elevated/35`}
                    onClick={() => isLive ? setViewing({ runId: execution.agentRunId!, testName: execution.testName }) : setDetail(execution)}
                  >
                    <td className="px-5 py-4 font-medium">{execution.testName}</td>
                    <td className="px-3 py-4"><ModeBadge mode={execution.mode || 'manual'}/></td>
                    <td className="px-3 py-4"><StatusPill status={execution.status}/></td>
                    <td className="px-3 py-4 capitalize text-text-secondary">{execution.environment}</td>
                    <td className="px-3 py-4 capitalize text-text-secondary">{execution.browser}</td>
                    <td className="px-3 py-4 text-xs text-text-secondary">{new Date(execution.createdAt).toLocaleDateString()}</td>
                    <td className="px-4 py-4 text-right">{isLive ? <button className={secondaryButton} onClick={event => { event.stopPropagation(); setViewing({ runId: execution.agentRunId!, testName: execution.testName }); }}><Eye size={14}/>View Live Execution</button> : <span className="inline-flex items-center gap-2 text-xs text-text-secondary"><span className="tabular-nums">{execution.duration != null ? formatDuration(execution.duration) : '—'}</span><ChevronRight size={13} className="text-text-secondary transition-colors group-hover:text-text-primary"/></span>}</td>
                  </motion.tr>;
                })}
                {!visibleExecutions.length && !visibleLiveRuns.length && <tr><td colSpan={7} className="px-5 py-10 text-center text-sm text-text-secondary">{anyFilterActive ? 'No executions match these filters.' : execTab === 'test' ? 'No standalone test executions yet.' : 'No executions yet. Click Execute to run an approved case.'}</td></tr>}
                </>}
              </tbody>
            </table>
          </motion.div>
        </AnimatePresence>
      </section>
    </div>

    {wizardOpen && <ExecutionWizardModal candidates={eligible} onRunStarted={handleRunStarted} onClose={() => setWizardOpen(false)}/>}
  </div>;
}

export function AutomatedTestsPage() {
  const { cases, executions, error, refresh } = useQaData();
  const [selected, setSelected] = useState<string[]>([]); const [environment, setEnvironment] = useState('staging'); const [browser, setBrowser] = useState('chromium'); const [message, setMessage] = useState(''); const [query, setQuery] = useState(''); const [priority, setPriority] = useState('all'); const [runTab, setRunTab] = useState<'cases'|'runs'>('cases'); const [busy, setBusy] = useState(false);
  const candidates = cases.filter(test => test.reviewStatus === 'approved');
  const filtered = candidates.filter(test => (`${test.title} ${test.flow} ${test.priority}`).toLowerCase().includes(query.toLowerCase()) && (priority === 'all' || test.priority === priority));
  const running = executions.filter(item => ['pending','running'].includes(item.status)); const complete = executions.filter(item => ['passed','failed'].includes(item.status));
  const launch = async () => { setBusy(true); setMessage(''); try { const run = await request<{ testsQueued: number }>('/qa/runs', { method: 'POST', body: JSON.stringify({ testIds: selected, environment, browser }) }); setMessage(`${run.testsQueued} test(s) queued for ${environment} · ${browser}. Results will appear as the runner submits evidence.`); setSelected([]); await refresh(); setRunTab('runs'); } catch (e) { setMessage(e instanceof Error ? e.message : 'Could not queue tests'); } finally { setBusy(false); } };
  const toggleAll = () => setSelected(filtered.length && filtered.every(test => selected.includes(test.id)) ? selected.filter(id => !filtered.some(test => test.id === id)) : [...new Set([...selected, ...filtered.map(test => test.id)])]);
  return <div className="flex h-full min-h-0 flex-col overflow-auto bg-canvas"><PageHeader title="Automated Tests" subtitle="Select approved test cases and dispatch a run configuration." onRefresh={() => void refresh()} action={<span className="inline-flex items-center gap-2 rounded-full border border-success/20 bg-success/5 px-3 py-2 text-xs text-success"><span className="h-1.5 w-1.5 rounded-full bg-success"/>Runner queue ready</span>}/>
    <div className="space-y-5 p-5 md:p-7"><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><Metric label="Approved to run" value={candidates.length}/><Metric label="Awaiting runner" value={running.length}/><Metric label="Completed" value={complete.length}/><Metric label="Latest pass rate" value={complete.length ? `${Math.round(complete.filter(e => e.status === 'passed').length / complete.length * 100)}%` : '—'}/></div>
      <section className={`${panel} overflow-hidden`}><div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 pt-4"><div className="flex gap-5">{(['cases','runs'] as const).map(tab => <button key={tab} onClick={() => setRunTab(tab)} className={`relative pb-3 text-sm font-medium capitalize transition-colors ${runTab === tab ? 'text-accent-blue' : 'text-text-secondary hover:text-text-primary'}`}>{tab === 'cases' ? 'Runnable cases' : `Recent runs${executions.length ? ` · ${executions.length}` : ''}`}{runTab === tab && <span className="absolute inset-x-0 bottom-0 h-0.5 rounded-full bg-accent-blue"/>}</button>)}</div><span className="pb-3 text-xs text-text-secondary">{runTab === 'cases' ? `${filtered.length} cases shown` : `${executions.length} execution records`}</span></div>
        {runTab === 'cases' ? <><div className="flex flex-wrap items-center gap-3 border-b border-border bg-canvas/35 p-4"><FilterInput value={query} onChange={setQuery} placeholder="Search title, flow, priority…"/><label className="relative"><Filter size={13} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-secondary"/><select aria-label="Filter by priority" value={priority} onChange={e => setPriority(e.target.value)} className={`${input} appearance-none pl-8 pr-8`}><option value="all">All priorities</option>{['P0','P1','P2','P3'].map(item => <option key={item}>{item}</option>)}</select><ChevronDown size={13} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-text-secondary"/></label><label className="text-xs text-text-secondary">TARGET<select aria-label="Target environment" className={`${input} ml-2 min-w-32`} value={environment} onChange={e => setEnvironment(e.target.value)}><option value="development">Development</option><option value="staging">Staging</option><option value="production">Production</option><option value="manual">Manual / local</option></select></label><label className="text-xs text-text-secondary">BROWSER<select aria-label="Browser" className={`${input} ml-2 min-w-32`} value={browser} onChange={e => setBrowser(e.target.value)}><option value="chromium">Chromium</option><option value="firefox">Firefox</option><option value="webkit">WebKit</option><option value="manual">Manual</option></select></label></div>
          <div className="overflow-x-auto"><table className="w-full min-w-[760px] text-left text-sm"><thead className="bg-canvas/70 text-[10px] font-semibold uppercase tracking-[.14em] text-text-secondary"><tr><th className="w-12 px-5 py-3"><input aria-label="Select all visible test cases" type="checkbox" checked={filtered.length > 0 && filtered.every(test => selected.includes(test.id))} onChange={toggleAll}/></th><th className="px-3 py-3">Test case</th><th className="px-3 py-3">Priority / risk</th><th className="px-3 py-3">Flow</th><th className="px-3 py-3">Latest result</th><th className="px-5 py-3">Review</th></tr></thead><tbody className="divide-y divide-border">{filtered.map(test => <tr key={test.id} className={`transition hover:bg-elevated/35 ${selected.includes(test.id) ? 'bg-accent-blue/[.045]' : ''}`}><td className="px-5 py-4"><input aria-label={`Select ${test.title}`} type="checkbox" checked={selected.includes(test.id)} onChange={e => setSelected(ids => e.target.checked ? [...ids, test.id] : ids.filter(id => id !== test.id))}/></td><td className="px-3 py-4"><span className="block font-medium">{test.title}</span><span className="mt-1 block max-w-md truncate text-xs text-text-secondary">{test.flow || 'General test'} · {test.id.slice(0,8)}</span></td><td className="px-3 py-4"><span className="font-mono text-xs">{test.priority}</span><span className="ml-2 text-xs text-text-secondary">{test.risk || 'risk unscored'}</span></td><td className="px-3 py-4 text-text-secondary">{test.flow || '—'}</td><td className="px-3 py-4">{test.passRate == null ? <span className="text-xs text-text-secondary">No history</span> : <span className="text-xs"><span className={test.passRate < 70 ? 'text-warning' : 'text-success'}>{test.passRate}%</span><span className="text-text-secondary"> pass</span></span>}</td><td className="px-5 py-4"><StatusPill status={test.reviewStatus}/></td></tr>)}</tbody></table>{!filtered.length && <div className="p-10 text-center"><Search size={20} className="mx-auto text-text-secondary"/><p className="mt-3 text-sm font-medium">No matching approved tests</p><p className="mt-1 text-xs text-text-secondary">Clear the filters or approve test cases before running them.</p></div>}</div>
          <div className="sticky bottom-0 flex flex-wrap items-center justify-between gap-3 border-t border-border bg-surface/95 px-5 py-3 backdrop-blur"><p className="text-xs text-text-secondary">{selected.length ? <><span className="font-semibold text-text-primary">{selected.length} selected</span> · results require runner evidence</> : 'Select one or more approved cases to configure a run.'}</p><button className={button} disabled={!selected.length || busy} onClick={() => void launch()}><Play size={14}/>{busy ? 'Dispatching…' : `Run selected · ${selected.length}`}</button></div>
        </> : <div className="overflow-x-auto"><table className="w-full min-w-[680px] text-left text-sm"><thead className="bg-canvas/65 text-[10px] font-semibold uppercase tracking-[.14em] text-text-secondary"><tr><th className="px-5 py-3">Test</th><th className="px-3 py-3">Target</th><th className="px-3 py-3">Browser</th><th className="px-3 py-3">Created</th><th className="px-5 py-3">Status</th></tr></thead><tbody className="divide-y divide-border">{executions.slice(0,30).map(item => <tr key={item.id} className="hover:bg-elevated/30"><td className="px-5 py-3.5 font-medium">{item.testName}</td><td className="px-3 py-3.5 capitalize text-text-secondary">{item.environment}</td><td className="px-3 py-3.5 capitalize text-text-secondary">{item.browser}</td><td className="px-3 py-3.5 text-xs text-text-secondary">{new Date(item.createdAt).toLocaleString()}</td><td className="px-5 py-3.5"><StatusPill status={item.status}/></td></tr>)}</tbody></table>{!executions.length && <p className="p-10 text-center text-sm text-text-secondary">Runs will appear here after dispatch.</p>}</div>}
      </section>{(error || message) && <p role={error ? 'alert' : 'status'} className={`rounded-xl border px-4 py-3 text-sm ${error ? 'border-danger/20 bg-danger/5 text-danger' : 'border-info/20 bg-info/5 text-info'}`}>{message || error}</p>}
      <p className="flex items-start gap-2 text-xs leading-5 text-text-secondary"><Activity size={14} className="mt-0.5 shrink-0 text-info"/>Execution records stay pending until a runner submits actual observations and evidence for every step.</p>
    </div>
  </div>;
}

function Metric({ label, value, icon, hint, accent = 'blue' }: { label: string; value: React.ReactNode; icon?: React.ReactNode; hint?: string; accent?: 'blue'|'green'|'amber'|'purple' }) {
  const tone = { blue: 'text-accent-blue bg-accent-blue/10', green: 'text-success bg-success/10', amber: 'text-warning bg-warning/10', purple: 'text-accent-purple bg-accent-purple/10' }[accent];
  return <div className={`${panel} relative overflow-hidden p-4`}><div className="absolute right-0 top-0 h-16 w-16 rounded-full bg-white/[.02] blur-xl"/><div className="flex items-center justify-between gap-3"><p className="text-xs font-medium text-text-secondary">{label}</p>{icon && <span className={`flex h-8 w-8 items-center justify-center rounded-lg ${tone}`}>{icon}</span>}</div><p className="mt-3 text-2xl font-semibold tracking-tight">{value}</p>{hint && <p className="mt-1 text-[11px] text-text-secondary">{hint}</p>}</div>;
}

export function TestCredentialsPage() { return <div className="flex h-full min-h-0 flex-col overflow-auto bg-canvas"><PageHeader title="Test Credentials" subtitle="Organize endpoint configuration and credential references by test environment." action={<span className="inline-flex items-center gap-2 rounded-full border border-warning/20 bg-warning/5 px-3 py-2 text-xs text-warning">Secret values masked</span>}/><div className="min-h-0 flex-1 overflow-hidden p-4 md:p-6"><div className="flex h-full min-h-0 flex-col overflow-hidden rounded-xl border border-border bg-surface"><div className="border-b border-border bg-canvas/35 px-5 py-4"><div className="flex items-start gap-3"><span className="mt-0.5 text-accent-purple"><ShieldCheck size={18}/></span><p className="max-w-3xl text-xs leading-5 text-text-secondary">Create separate profiles for development, staging, and production. Mark sensitive values as secrets; saved values remain masked in this workspace and can be replaced without revealing them.</p></div></div><div className="min-h-0 flex-1 overflow-auto"><EnvironmentsPage embedded/></div></div></div></div>; }

function ReportCard({ execution, index, reduceMotion, onView }: { execution: Execution; index: number; reduceMotion: boolean; onView: () => void }) {
  const accent = ROW_STATUS_ACCENT[execution.status] || 'border-l-border';
  return (
    <motion.div
      initial={reduceMotion ? false : { opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2, delay: reduceMotion ? 0 : Math.min(index, 14) * 0.03 }}
      className={`group flex flex-col justify-between rounded-xl border border-border border-l-[3px] ${accent} bg-surface p-4 transition-colors hover:border-border-strong`}
    >
      <div>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-text-primary">{execution.testName}</p>
            <p className="mt-1 font-mono text-[10px] text-text-secondary">{execution.id.slice(0, 8)} · {new Date(execution.createdAt).toLocaleString()}</p>
          </div>
          <StatusPill status={execution.status} />
        </div>
        <div className="mt-4 grid grid-cols-3 gap-2 border-t border-border/70 pt-3 text-xs">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wide text-text-secondary">Duration</p>
            <p className="mt-1 flex items-center gap-1.5 font-mono tabular-nums text-text-primary"><Clock3 size={12} className="text-text-secondary" />{execution.duration != null ? formatDuration(execution.duration) : '—'}</p>
          </div>
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wide text-text-secondary">Environment</p>
            <p className="mt-1 truncate capitalize text-text-primary">{execution.environment}</p>
          </div>
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wide text-text-secondary">Browser</p>
            <p className="mt-1 truncate capitalize text-text-primary">{execution.browser}</p>
          </div>
        </div>
      </div>
      <div className="mt-4 flex items-center justify-between gap-2 border-t border-border/70 pt-3">
        <ModeBadge mode={execution.mode || 'manual'} />
        <button type="button" onClick={onView} className="inline-flex items-center gap-1.5 text-xs font-semibold text-accent-blue transition-colors hover:text-accent-blue/80">
          View report<ChevronRight size={13} />
        </button>
      </div>
    </motion.div>
  );
}

export function ReportsPage() {
  const reduceMotion = useReducedMotion();
  const { cases, executions, error, refresh } = useQaData();
  const [query, setQuery] = useState(''); const [status, setStatus] = useState('all'); const [environment, setEnvironment] = useState('all'); const [mode, setMode] = useState('all'); const [period, setPeriod] = useState('30');
  const [detail, setDetail] = useState<Execution | null>(null);
  const since = period === 'all' ? 0 : Date.now() - Number(period) * 86400000;
  const filtered = executions.filter(item => new Date(item.createdAt).getTime() >= since && (status === 'all' || item.status === status) && (environment === 'all' || item.environment === environment) && (mode === 'all' || (item.mode || 'manual') === mode) && `${item.testName} ${item.browser}`.toLowerCase().includes(query.toLowerCase()));
  const passed = filtered.filter(e => e.status === 'passed').length; const failed = filtered.filter(e => e.status === 'failed').length; const finished = passed + failed;
  const exportCsv = () => { const rows = [['Test','Status','Environment','Browser','Duration seconds','Created'], ...filtered.map(e => [e.testName,e.status,e.environment,e.browser,String(e.duration ?? ''),e.createdAt])]; const csv = rows.map(row => row.map(cell => `"${String(cell).replaceAll('"','""')}"`).join(',')).join('\r\n'); const link = document.createElement('a'); link.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); link.download = 'qa-execution-report.csv'; link.click(); URL.revokeObjectURL(link.href); };
  const environments = [...new Set(executions.map(item => item.environment))];
  const modeOptions = [...new Set(executions.map(item => item.mode || 'manual'))];
  const anyFilterActive = query.trim() !== '' || status !== 'all' || environment !== 'all' || mode !== 'all';
  const clearFilters = () => { setQuery(''); setStatus('all'); setEnvironment('all'); setMode('all'); };

  if (detail) return <ReportDetailPage execution={detail} onExit={() => setDetail(null)}/>;

  return <div className="flex h-full min-h-0 flex-col overflow-auto bg-canvas"><PageHeader title="Reports" subtitle="Review execution outcomes, track quality trends, and export filtered results." onRefresh={() => void refresh()} action={<button className={secondaryButton} disabled={!filtered.length} onClick={exportCsv}><ArrowDownToLine size={15}/>Export report</button>}/>
    <div className="space-y-5 p-5 md:p-7"><div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-[10px] font-semibold uppercase tracking-[.18em] text-text-secondary">Quality snapshot</p><p className="mt-1 text-xs text-text-secondary">Metrics update with the filters below.</p></div><label className="text-xs text-text-secondary">REPORT WINDOW<select className={`${input} ml-2`} value={period} onChange={e => setPeriod(e.target.value)}><option value="7">Last 7 days</option><option value="30">Last 30 days</option><option value="90">Last 90 days</option><option value="all">All time</option></select></label></div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><Metric label="Executions in view" value={filtered.length} icon={<Activity size={16}/>} hint={`${cases.length} cases in library`} accent="blue"/><Metric label="Passed" value={passed} icon={<CheckCircle2 size={16}/>} hint={finished ? `${Math.round(passed / finished * 100)}% of completed` : 'No completed runs in range'} accent="green"/><Metric label="Failed" value={failed} icon={<AlertTriangle size={16}/>} hint={filtered.filter(e => ['pending','running'].includes(e.status)).length + ' awaiting result'} accent="amber"/><Metric label="Pass rate" value={finished ? `${Math.round(passed / finished * 100)}%` : '—'} icon={<FileBarChart2 size={16}/>} hint={`${filtered.reduce((total, e) => total + (e.duration || 0), 0)}s total duration`} accent="purple"/></div>
      <section className={`${panel} overflow-hidden`}>
        <div className="flex flex-wrap items-end justify-between gap-3 border-b border-border px-5 pt-4"><div><h2 className="font-semibold">Execution history</h2><p className="mt-1 text-xs text-text-secondary">{filtered.length} in view · {failed} failed · {filtered.filter(e => ['pending','running'].includes(e.status)).length} pending</p></div></div>
        <div className="flex flex-wrap items-center gap-2 border-b border-border bg-canvas/30 px-5 py-3">
          <FilterInput value={query} onChange={setQuery} placeholder="Search test or browser…"/>
          <select aria-label="Filter by status" className={input} value={status} onChange={e => setStatus(e.target.value)}><option value="all">All statuses</option>{['passed','failed','pending','running','cancelled'].map(item => <option key={item} value={item}>{item}</option>)}</select>
          <select aria-label="Filter by environment" className={input} value={environment} onChange={e => setEnvironment(e.target.value)}><option value="all">All environments</option>{environments.map(item => <option key={item}>{item}</option>)}</select>
          <select aria-label="Filter by mode" className={input} value={mode} onChange={e => setMode(e.target.value)}><option value="all">All modes</option>{modeOptions.map(item => <option key={item} value={item} className="capitalize">{item}</option>)}</select>
          {anyFilterActive && <button type="button" onClick={clearFilters} className="inline-flex items-center gap-1 text-xs font-medium text-text-secondary transition-colors hover:text-text-primary"><X size={13}/>Clear filters</button>}
        </div>
        <div className="p-5">
          {filtered.length ? (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {filtered.map((item, index) => <ReportCard key={item.id} execution={item} index={index} reduceMotion={!!reduceMotion} onView={() => setDetail(item)}/>)}
            </div>
          ) : (
            <div className="py-10 text-center"><FileBarChart2 size={20} className="mx-auto text-text-secondary"/><p className="mt-3 text-sm font-medium">No executions match this report</p><p className="mt-1 text-xs text-text-secondary">Try a wider date range or clear filters.</p></div>
          )}
        </div>
      </section>{error && <p role="alert" className="rounded-lg border border-danger/20 bg-danger/5 p-3 text-sm text-danger">{error}</p>}
    </div>
  </div>;
}

export function CoveragePage() {
  const { cases, executions, error, refresh } = useQaData();
  const [requirements, setRequirements] = useState<Array<{ id: string; name: string; linkedTestIds: string[] }>>([]);
  const [requirementsError, setRequirementsError] = useState('');
  const [showGaps, setShowGaps] = useState(false); const [priorityFilter, setPriorityFilter] = useState('all');
  useEffect(() => {
    let active = true;
    void request<{ items: Array<{ id: string; name: string }> }>('/business/items?type=requirement&limit=100')
      .then(async result => Promise.all(result.items.map(async requirement => {
        const links = await request<Array<{ fromItem: { id: string; type: string } | null; toItem: { id: string; type: string } | null }>>(`/business/items/${requirement.id}/relationships`);
        const linkedTestIds = links.map(link => link.fromItem?.id === requirement.id ? link.toItem : link.fromItem)
          .filter(item => item?.type === 'test_case').map(item => item!.id);
        return { ...requirement, linkedTestIds };
      })))
      .then(result => { if (active) { setRequirements(result); setRequirementsError(''); } })
      .catch(reason => { if (active) setRequirementsError(reason instanceof Error ? reason.message : 'Requirement links unavailable'); });
    return () => { active = false; };
  }, []);
  const tested = useMemo(() => new Set(executions.filter(e => ['passed','failed'].includes(e.status)).map(e => e.testId)), [executions]);
  const covered = cases.filter(test => tested.has(test.id)); const untested = cases.filter(test => !tested.has(test.id)); const rate = cases.length ? Math.round(covered.length / cases.length * 100) : 0;
  const requirementCovered = requirements.filter(requirement => requirement.linkedTestIds.some(id => cases.some(test => test.evidence?.businessItemId === id && tested.has(test.id))));
  const requirementRows = requirements.map(requirement => { const linkedCases = cases.filter(test => requirement.linkedTestIds.includes(test.evidence?.businessItemId || '')); const completed = linkedCases.some(test => tested.has(test.id)); return { requirement, linkedCases, completed }; });
  const visibleRequirements = requirementRows.filter(row => (!showGaps || !row.completed) && (priorityFilter === 'all' || row.linkedCases.some(test => test.priority === priorityFilter)));
  const visibleUntested = untested.filter(test => priorityFilter === 'all' || test.priority === priorityFilter);
  const reqRate = requirements.length ? Math.round(requirementCovered.length / requirements.length * 100) : 0;
  return <div className="flex h-full min-h-0 flex-col overflow-auto bg-canvas"><PageHeader title="Coverage" subtitle="See which requirements are tested, where coverage is missing, and what needs attention." onRefresh={() => void refresh()} action={<label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-border bg-canvas/70 px-3 py-2 text-xs font-medium text-text-secondary"><input type="checkbox" checked={showGaps} onChange={event => setShowGaps(event.target.checked)}/>Gaps only</label>}/>
    <div className="space-y-5 p-5 md:p-7"><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><Metric label="Test cases with results" value={`${covered.length} / ${cases.length}`} icon={<CheckCircle2 size={16}/>} hint={`${rate}% execution coverage`} accent="blue"/><Metric label="Requirements covered" value={`${requirementCovered.length} / ${requirements.length}`} icon={<Target size={16}/>} hint={`${reqRate}% linked and tested`} accent="green"/><Metric label="Cases without results" value={untested.length} icon={<Clock3 size={16}/>} hint="No completed run result" accent="amber"/><Metric label="Unlinked requirements" value={requirementRows.filter(row => !row.linkedCases.length).length} icon={<AlertTriangle size={16}/>} hint="No imported test case linked" accent="purple"/></div>
      <div className={`${panel} grid gap-5 p-5 lg:grid-cols-[1fr_1.2fr]`}><div className="flex items-center gap-5"><div className="relative flex h-28 w-28 shrink-0 items-center justify-center rounded-full" style={{ background: `conic-gradient(var(--accent-blue) ${rate}%, color-mix(in srgb,var(--bg-elevated) 90%,transparent) 0)` }}><div className="flex h-[5.3rem] w-[5.3rem] flex-col items-center justify-center rounded-full bg-surface"><span className="text-2xl font-semibold tracking-tight">{rate}%</span><span className="text-[9px] uppercase tracking-widest text-text-secondary">test rate</span></div></div><div><p className="text-[10px] font-semibold uppercase tracking-[.18em] text-accent-blue">Observed execution</p><h2 className="mt-1 text-lg font-semibold">Test case coverage</h2><p className="mt-1 max-w-sm text-sm leading-5 text-text-secondary">{covered.length} of {cases.length} cases have a completed result recorded against a test snapshot.</p></div></div><div className="flex items-center gap-5 border-t border-border pt-5 lg:border-l lg:border-t-0 lg:pl-6 lg:pt-0"><div className="relative flex h-28 w-28 shrink-0 items-center justify-center rounded-full" style={{ background: `conic-gradient(var(--success) ${reqRate}%, color-mix(in srgb,var(--bg-elevated) 90%,transparent) 0)` }}><div className="flex h-[5.3rem] w-[5.3rem] flex-col items-center justify-center rounded-full bg-surface"><span className="text-2xl font-semibold tracking-tight">{reqRate}%</span><span className="text-[9px] uppercase tracking-widest text-text-secondary">req rate</span></div></div><div><p className="text-[10px] font-semibold uppercase tracking-[.18em] text-success">Requirement traceability</p><h2 className="mt-1 text-lg font-semibold">{requirementCovered.length} requirements covered</h2><p className="mt-1 max-w-sm text-sm leading-5 text-text-secondary">A requirement counts when it links to an imported test case that has a completed result.</p></div></div></div>
      <section className={`${panel} overflow-hidden`}><div className="flex flex-wrap items-center justify-between gap-3 border-b border-border p-4 md:px-5"><div><h2 className="font-semibold">Requirement matrix</h2><p className="mt-1 text-xs text-text-secondary">Links are based on saved traceability relationships, never title similarity.</p></div><label className="text-xs text-text-secondary">TEST PRIORITY<select className={`${input} ml-2`} value={priorityFilter} onChange={event => setPriorityFilter(event.target.value)}><option value="all">All priorities</option>{['P0','P1','P2','P3'].map(item => <option key={item}>{item}</option>)}</select></label></div>
        <div className="overflow-x-auto"><table className="w-full min-w-[680px] text-left text-sm"><thead className="bg-canvas/65 text-[10px] font-semibold uppercase tracking-[.14em] text-text-secondary"><tr><th className="px-5 py-3">Requirement</th><th className="px-3 py-3">Linked tests</th><th className="px-3 py-3">Priority mix</th><th className="px-5 py-3">Coverage</th></tr></thead><tbody className="divide-y divide-border">{visibleRequirements.map(({ requirement, linkedCases, completed }) => <tr key={requirement.id} className="hover:bg-elevated/30"><td className="px-5 py-4"><span className="block font-medium">{requirement.name}</span><span className="mt-1 block max-w-lg truncate text-xs text-text-secondary">{requirement.id.slice(0,8)} · {linkedCases.length ? `${linkedCases.length} test link${linkedCases.length === 1 ? '' : 's'}` : 'Needs traceability link'}</span></td><td className="px-3 py-4"><span className="font-mono">{linkedCases.length}</span></td><td className="px-3 py-4"><div className="flex gap-1">{['P0','P1','P2','P3'].filter(priority => linkedCases.some(test => test.priority === priority)).map(priority => <span key={priority} className="rounded bg-elevated px-1.5 py-1 font-mono text-[10px] text-text-secondary">{priority}</span>)}{!linkedCases.length && <span className="text-xs text-text-secondary">—</span>}</div></td><td className="px-5 py-4"><StatusPill status={completed ? 'covered' : linkedCases.length ? 'no result' : 'unlinked'}/></td></tr>)}</tbody></table>{!visibleRequirements.length && <p className="p-10 text-center text-sm text-text-secondary">No requirements match the selected filters.</p>}</div>{requirementsError && <p role="alert" className="m-4 rounded-lg bg-danger/5 p-3 text-xs text-danger">{requirementsError}</p>}</section>
      <section className={`${panel} overflow-hidden`}><div className="flex items-center justify-between border-b border-border px-5 py-4"><div><h2 className="font-semibold">Test cases needing execution</h2><p className="mt-1 text-xs text-text-secondary">Approved and draft cases without any completed result.</p></div><span className="rounded-full bg-warning/10 px-2.5 py-1 text-xs font-semibold text-warning">{visibleUntested.length} gaps</span></div><div className="divide-y divide-border">{visibleUntested.slice(0,10).map(test => <div key={test.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3"><div className="min-w-0"><p className="truncate text-sm font-medium">{test.title}</p><p className="mt-1 text-xs text-text-secondary">{test.flow || 'General'} · {test.priority}</p></div><StatusPill status={test.reviewStatus}/></div>)}{!visibleUntested.length && <p className="p-8 text-center text-sm text-text-secondary">No case execution gaps for this filter.</p>}</div></section>
      {error && <p role="alert" className="rounded-lg border border-danger/20 bg-danger/5 p-3 text-sm text-danger">{error}</p>}
    </div>
  </div>;
}
