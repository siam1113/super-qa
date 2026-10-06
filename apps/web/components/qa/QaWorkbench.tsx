'use client';

import { useEffect, useState } from 'react';
import { useAppStore } from '@/lib/store';

type CaseRecord = { id: string; title: string; revision: number; reviewStatus: string; preconditions: string[]; steps: Array<{ action: string; expected: string }> };
type ExecutionRecord = { id: string; testName: string; status: string; runId: string; snapshot: CaseRecord };
const base = `${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000'}/api/qa`;

async function api(path: string, body?: unknown, method = 'POST') {
  const response = await fetch(`${base}/${path}`, body === undefined ? undefined : { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await response.json();
  if (!response.ok) throw new Error(Array.isArray(data.message) ? data.message.join('; ') : data.message || 'Request failed');
  return data;
}

export function QaWorkbench() {
  const setData = useAppStore(state => state.setData);
  const [cases, setCases] = useState<CaseRecord[]>([]);
  const [executions, setExecutions] = useState<ExecutionRecord[]>([]);
  const [selected, setSelected] = useState('');
  const [executionId, setExecutionId] = useState('');
  const [title, setTitle] = useState('');
  const [steps, setSteps] = useState('[{"action":"","expected":""}]');
  const [reporter, setReporter] = useState('');
  const [businessId, setBusinessId] = useState('');
  const [observations, setObservations] = useState('[]');
  const [duration, setDuration] = useState('0');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const current = cases.find(item => item.id === selected);
  const execution = executions.find(item => item.id === executionId);

  async function refresh() {
    const workspace = await api('workspace');
    setCases(workspace.testCases);
    setExecutions(workspace.executions);
    setData(workspace);
  }

  useEffect(() => { refresh().catch(error => setMessage(error.message)); }, []);

  async function perform(operation: () => Promise<unknown>, success: string) {
    setBusy(true);
    try { await operation(); await refresh(); setMessage(success); }
    catch (error) { setMessage(error instanceof Error ? error.message : 'Operation failed'); }
    finally { setBusy(false); }
  }

  const fieldClass = 'ui-field w-full text-sm';
  const buttonClass = 'ui-button-secondary min-h-9 text-xs font-medium disabled:opacity-40';
  const cardClass = 'min-w-0 space-y-3 rounded-xl border border-border bg-canvas/55 p-4';
  const labelClass = 'block text-xs font-medium text-text-secondary';
  return <details id="qa-workbench" className="group border-b border-border bg-surface">
    <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-4 py-4 outline-none transition-colors hover:bg-elevated/40 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent-blue/40 sm:px-6 [&::-webkit-details-marker]:hidden">
      <span className="flex min-w-0 items-center gap-3"><span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent-blue/10 text-accent-blue"><ClipboardCheckIcon/></span><span className="min-w-0"><span className="block text-sm font-semibold">Manual QA workflow</span><span className="mt-0.5 block truncate text-xs text-text-secondary">Create a draft, record a review, and capture observed results.</span></span></span>
      <span className="flex shrink-0 items-center gap-2 text-xs font-medium text-text-secondary"><span className="hidden sm:inline">{busy ? 'Saving…' : 'Open workflow'}</span><span aria-hidden="true" className="text-base transition-transform group-open:rotate-180">⌄</span></span>
    </summary>
    <div className="space-y-4 border-t border-border px-4 py-4 sm:px-6 sm:py-5">
      <div className="flex flex-wrap items-center justify-between gap-2"><p className="max-w-2xl text-xs leading-5 text-text-secondary">Runs stay pending until a person records observations and evidence for each step.</p>{message && <p role="status" className="rounded-md border border-info/20 bg-info/5 px-2.5 py-1.5 text-xs text-info">{message}</p>}</div>
      <div className="grid gap-3 xl:grid-cols-3">
        <div className={cardClass}>
          <div><h3 className="text-sm font-semibold">Create or import</h3><p className="mt-1 text-xs text-text-secondary">New cases start as drafts.</p></div>
          <label className={labelClass}>Case title<input aria-label="Case title" className={`${fieldClass} mt-1.5`} value={title} onChange={event => setTitle(event.target.value)} placeholder="e.g. Sign in with a valid account"/></label>
          <label className={labelClass}>Steps in JSON<textarea aria-label="Case steps JSON" className={`${fieldClass} mt-1.5 min-h-24 font-mono text-xs`} value={steps} onChange={event => setSteps(event.target.value)}/></label>
          <button disabled={busy || !title.trim()} className={buttonClass} onClick={() => perform(async () => { const created = await api('test-cases', { title, steps: JSON.parse(steps) }); setSelected(created.id); }, 'Draft saved. Review is required before running.')}>Save draft</button>
          <div className="border-t border-border pt-3"><label className={labelClass}>Import a grounded proposal<input aria-label="Business proposal ID" className={`${fieldClass} mt-1.5`} value={businessId} onChange={event => setBusinessId(event.target.value)} placeholder="Proposal ID"/></label><button disabled={busy || !businessId} className={`${buttonClass} mt-2`} onClick={() => perform(async () => { const imported = await api(`test-cases/import/${encodeURIComponent(businessId)}`, {}); setSelected(imported.id); }, 'Proposal imported as a draft.')}>Import proposal</button></div>
        </div>

        <div className={cardClass}>
          <div><h3 className="text-sm font-semibold">Review and plan</h3><p className="mt-1 text-xs text-text-secondary">Only approved cases can be planned.</p></div>
          <label className={labelClass}>Test case<select aria-label="Review case" className={`${fieldClass} mt-1.5`} value={selected} onChange={event => setSelected(event.target.value)}><option value="">Select a case</option>{cases.map(item => <option key={item.id} value={item.id}>{item.title} · {item.reviewStatus}</option>)}</select></label>
          {current && <pre className="max-h-28 overflow-auto rounded-lg border border-border bg-surface p-3 text-[11px] leading-5 text-text-secondary">{JSON.stringify({ preconditions: current.preconditions, steps: current.steps }, null, 2)}</pre>}
          <label className={labelClass}>Reviewer<input aria-label="Reviewer or reporter name" className={`${fieldClass} mt-1.5`} value={reporter} onChange={event => setReporter(event.target.value)} placeholder="Name"/></label>
          <div className="flex flex-wrap gap-2">{(['approved', 'rejected'] as const).map(status => <button key={status} disabled={busy || !current || !reporter} className={buttonClass} onClick={() => perform(() => api(`test-cases/${selected}/review`, { status, revision: current!.revision, reviewer: reporter }), `Review recorded: ${status}`)}>{status === 'approved' ? 'Approve case' : 'Reject case'}</button>)}<button disabled={busy || current?.reviewStatus !== 'approved'} className={buttonClass} onClick={() => perform(async () => { const run = await api('runs', { requestId: crypto.randomUUID(), testIds: [selected] }); setExecutionId(run.executions[0].id); setObservations(JSON.stringify(current!.steps.map(() => ({ actual: '', passed: false, evidence: '' })), null, 2)); }, 'Manual run persisted; awaiting observed results.')}>Plan run</button></div>
        </div>

        <div className={cardClass}>
          <div><h3 className="text-sm font-semibold">Record outcome</h3><p className="mt-1 text-xs text-text-secondary">Add actual results after running the checks.</p></div>
          <label className={labelClass}>Pending execution<select aria-label="Pending execution" className={`${fieldClass} mt-1.5`} value={executionId} onChange={event => { setExecutionId(event.target.value); const selectedExecution = executions.find(item => item.id === event.target.value); setObservations(JSON.stringify(selectedExecution?.snapshot.steps.map(() => ({ actual: '', passed: false, evidence: '' })) || [], null, 2)); }}><option value="">Select an execution</option>{executions.filter(item => item.status === 'pending').map(item => <option key={item.id} value={item.id}>{item.testName} · {item.id.slice(0, 8)}</option>)}</select></label>
          {execution && <pre className="max-h-20 overflow-auto rounded-lg border border-border bg-surface p-3 text-[11px] leading-5 text-text-secondary">{JSON.stringify(execution.snapshot.steps, null, 2)}</pre>}
          <label className={labelClass}>Observed results in JSON<textarea aria-label="Observed results JSON" className={`${fieldClass} min-h-24 mt-1.5 font-mono text-xs`} value={observations} onChange={event => setObservations(event.target.value)}/></label>
          <div className="flex flex-wrap items-end gap-2"><label className={`${labelClass} min-w-28 flex-1`}>Duration in seconds<input aria-label="Observed duration seconds" type="number" min="0" className={`${fieldClass} mt-1.5`} value={duration} onChange={event => setDuration(event.target.value)}/></label><button disabled={busy || !executionId || !reporter} className={buttonClass} onClick={() => perform(() => api(`executions/${executionId}/result`, { reporter, duration: Number(duration), steps: JSON.parse(observations) }), 'Human-reported result persisted.')}>Record result</button></div>
          <button disabled={busy || !execution} className="text-xs text-text-secondary underline decoration-border underline-offset-2 hover:text-danger disabled:opacity-40" onClick={() => perform(() => api(`runs/${execution!.runId}/cancel`, {}), 'Pending execution cancelled.')}>Cancel pending run</button>
        </div>
      </div>
    </div>
  </details>;
}

function ClipboardCheckIcon() {
  return <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" className="h-[18px] w-[18px]"><path strokeLinecap="round" strokeLinejoin="round" d="M9 5.25h6m-6 0a1.5 1.5 0 0 1 1.5-1.5h3A1.5 1.5 0 0 1 15 5.25m-6 0H6.75A1.75 1.75 0 0 0 5 7v12.25C5 20.216 5.784 21 6.75 21h10.5c.966 0 1.75-.784 1.75-1.75V7a1.75 1.75 0 0 0-1.75-1.75H15m-5 8 1.75 1.75L15 11.5"/></svg>;
}
