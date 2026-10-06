'use client';

import { useEffect, useRef, useState } from 'react';
import {
  ChevronLeft, Loader2, AlertTriangle, CheckCircle2, Clock,
} from 'lucide-react';
import { cn, getPriorityColor, getRiskColor } from '@/lib/utils';
import { saveTestCase } from '@/lib/testCaseFields';
import type { TestCase } from '@/lib/types';

const ROOT = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

type RunKind = 'generate' | 'refine';
type RunStatus = 'pending' | 'running' | 'completed' | 'failed';
type GenerateProposal = { title: string; steps: Array<{ action: string; expected: string }>; priority: string; risk: string; flow: string; tags: string[] };
type RefinedCase = { title: string; steps: Array<{ action: string; expected: string }>; preconditions: string[] };

type GenerationRun = {
  id: string;
  kind: RunKind;
  status: RunStatus;
  label: string;
  input: Record<string, unknown>;
  result: ({ proposals?: GenerateProposal[] } & Partial<RefinedCase>) | null;
  error: string | null;
  applied: boolean;
  createdAt: string;
  updatedAt: string;
};

async function readJson(response: Response) {
  try { return await response.json(); } catch { return {}; }
}

function timeAgo(iso: string) {
  const seconds = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

function StatusBadge({ run }: { run: GenerationRun }) {
  if (run.status === 'pending' || run.status === 'running') return <span className="inline-flex items-center gap-1 rounded-full bg-accent-blue/10 px-2 py-0.5 text-[11px] font-medium text-accent-blue"><Loader2 size={11} className="animate-spin"/>{run.status === 'pending' ? 'Queued' : 'Running'}</span>;
  if (run.status === 'failed') return <span className="inline-flex items-center gap-1 rounded-full bg-danger/10 px-2 py-0.5 text-[11px] font-medium text-danger"><AlertTriangle size={11}/>Failed</span>;
  if (!run.applied) return <span className="inline-flex items-center gap-1 rounded-full bg-success/10 px-2 py-0.5 text-[11px] font-medium text-success"><CheckCircle2 size={11}/>Ready to review</span>;
  const label = run.kind === 'generate' ? 'Added' : run.input.testCaseId ? 'Saved' : 'Added';
  return <span className="inline-flex items-center gap-1 rounded-full bg-elevated px-2 py-0.5 text-[11px] font-medium text-text-secondary"><CheckCircle2 size={11}/>{label}</span>;
}

/**
 * The shared list + detail + apply content for background generate/refine runs. Rendered
 * inline inside a host wizard's own modal shell (no portal/backdrop of its own), scoped to
 * one kind so Generate and Refine each only see their own runs.
 */
export function RunsPanel({
  kind,
  onCreated,
  onApplied,
}: {
  kind: RunKind;
  onCreated: (cases: TestCase[]) => void;
  onApplied: (testCase: TestCase) => void;
}) {
  const [runs, setRuns] = useState<GenerationRun[] | null>(null);
  const [listError, setListError] = useState('');
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [selectedIdx, setSelectedIdx] = useState<Set<number>>(new Set());
  const [acting, setActing] = useState(false);
  const [actionError, setActionError] = useState('');
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchRuns = () => fetch(`${ROOT}/api/qa/test-cases/generation-runs`)
    .then(async response => { if (!response.ok) throw new Error('Could not load runs'); return response.json(); })
    .then((data: GenerationRun[]) => { setRuns(data.filter(run => run.kind === kind)); setListError(''); })
    .catch(() => setListError('Could not load runs.'));

  useEffect(() => { void fetchRuns(); }, []);

  useEffect(() => {
    const hasActive = (runs || []).some(run => run.status === 'pending' || run.status === 'running');
    if (!hasActive) { if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; } return; }
    if (pollRef.current) return;
    pollRef.current = setInterval(() => { void fetchRuns(); }, 4000);
    return () => { if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; } };
  }, [runs]);

  const openRun = (run: GenerationRun) => {
    setSelectedRunId(run.id);
    setActionError('');
    setSelectedIdx(new Set((run.result?.proposals || []).map((_, index) => index)));
  };
  const backToList = () => { setSelectedRunId(null); setActionError(''); };

  const selectedRun = (runs || []).find(run => run.id === selectedRunId) || null;

  const toggleProposal = (index: number) => setSelectedIdx(previous => {
    const next = new Set(previous);
    if (next.has(index)) next.delete(index); else next.add(index);
    return next;
  });

  const markApplied = async (runId: string) => {
    await fetch(`${ROOT}/api/qa/test-cases/generation-runs/${runId}/applied`, { method: 'POST' }).catch(() => {});
    setRuns(previous => (previous || []).map(run => (run.id === runId ? { ...run, applied: true } : run)));
  };

  const addProposalsToLibrary = async () => {
    if (!selectedRun?.result?.proposals) return;
    setActing(true);
    setActionError('');
    try {
      const chosen = selectedRun.result.proposals.filter((_, index) => selectedIdx.has(index));
      const created: TestCase[] = [];
      for (const proposal of chosen) {
        const response = await fetch(`${ROOT}/api/qa/test-cases`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: proposal.title, steps: proposal.steps, priority: proposal.priority, risk: proposal.risk,
            flow: proposal.flow || undefined, tags: proposal.tags,
          }),
        });
        const data = await readJson(response);
        if (!response.ok) throw new Error(data.message || `Could not add "${proposal.title}"`);
        created.push(data as TestCase);
      }
      onCreated(created);
      await markApplied(selectedRun.id);
    } catch (reason) {
      setActionError(reason instanceof Error ? reason.message : 'Could not add the selected cases');
    } finally {
      setActing(false);
    }
  };

  const applyRefinement = async () => {
    if (!selectedRun?.result) return;
    const refined = selectedRun.result as RefinedCase;
    setActing(true);
    setActionError('');
    try {
      const testCaseId = selectedRun.input.testCaseId as string | undefined;
      if (testCaseId) {
        const response = await fetch(`${ROOT}/api/qa/test-cases/${testCaseId}`);
        const current = await readJson(response);
        if (!response.ok) throw new Error(current.message || 'The original test case could not be found');
        const updated = await saveTestCase(current as TestCase, { title: refined.title, steps: refined.steps, preconditions: refined.preconditions });
        onApplied(updated);
      } else {
        const response = await fetch(`${ROOT}/api/qa/test-cases`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: refined.title, steps: refined.steps, preconditions: refined.preconditions, tags: [] }),
        });
        const data = await readJson(response);
        if (!response.ok) throw new Error(data.message || 'Could not add the refined case');
        onApplied(data as TestCase);
      }
      await markApplied(selectedRun.id);
    } catch (reason) {
      setActionError(reason instanceof Error ? reason.message : 'Could not apply the refined case');
    } finally {
      setActing(false);
    }
  };

  if (!selectedRun) {
    return <div className="motion-safe:animate-fade-in">
      {listError && <div className="m-4 flex items-start gap-2 rounded-lg bg-danger/10 p-3 text-sm text-danger"><AlertTriangle size={15} className="mt-0.5 shrink-0"/>{listError}</div>}
      {!listError && runs === null && <div className="flex flex-col items-center gap-2 py-16 text-center text-text-secondary"><Loader2 size={20} className="animate-spin"/><p className="text-sm">Loading runs…</p></div>}
      {!listError && runs !== null && runs.length === 0 && (
        <div className="flex flex-col items-center gap-2 py-16 text-center text-text-secondary">
          <Clock size={22}/>
          <p className="text-sm font-medium text-text-primary">No background runs yet</p>
          <p className="max-w-xs text-xs">Use "Run in background" to queue one, then check back here.</p>
        </div>
      )}
      {!listError && runs !== null && runs.length > 0 && (
        <div className="divide-y divide-border">
          {runs.map(run => (
            <button key={run.id} type="button" onClick={() => openRun(run)} className="flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-elevated/55">
              <span className="min-w-0 flex-1">
                <span className="truncate text-sm font-medium">{run.label}</span>
                <span className="mt-1 flex items-center gap-2 text-[11px] text-text-secondary">
                  <StatusBadge run={run}/>
                  <span>{timeAgo(run.createdAt)}</span>
                </span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>;
  }

  return <div className="motion-safe:animate-fade-in flex h-full flex-col">
    <div className="shrink-0 border-b border-border p-4">
      <button type="button" onClick={backToList} className="mb-2 flex w-fit items-center gap-1 text-xs text-text-secondary transition-colors hover:text-text-primary"><ChevronLeft size={14}/>All runs</button>
      <div className="flex items-center gap-2"><StatusBadge run={selectedRun}/><span className="text-sm font-medium">{selectedRun.label}</span></div>
    </div>

    {(selectedRun.status === 'pending' || selectedRun.status === 'running') && (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center text-text-secondary">
        <Loader2 size={24} className="animate-spin"/>
        <p className="text-sm">Still working — this updates automatically.</p>
      </div>
    )}

    {selectedRun.status === 'failed' && (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
        <AlertTriangle size={24} className="text-danger"/>
        <p className="max-w-sm text-sm text-text-secondary">{selectedRun.error || 'This run failed.'}</p>
      </div>
    )}

    {selectedRun.status === 'completed' && selectedRun.kind === 'generate' && (
      <>
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          <div className="space-y-2">
            {(selectedRun.result?.proposals || []).map((proposal, index) => (
              <label key={index} className={cn('flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors', selectedIdx.has(index) ? 'border-accent-blue/35 bg-accent-blue/5' : 'border-border hover:bg-elevated/40')}>
                <input type="checkbox" checked={selectedIdx.has(index)} onChange={() => toggleProposal(index)} disabled={selectedRun.applied} className="mt-1 rounded border-border"/>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium">{proposal.title}</span>
                  <span className="mt-1.5 flex flex-wrap items-center gap-2 text-[11px] text-text-secondary">
                    <span className={cn('inline-flex min-w-7 justify-center rounded border px-1 py-0.5 font-mono text-[10px] font-semibold', getPriorityColor(proposal.priority))}>{proposal.priority}</span>
                    <span className={cn('capitalize', getRiskColor(proposal.risk))}>{proposal.risk} risk</span>
                    {proposal.flow && <span>{proposal.flow}</span>}
                    <span>{proposal.steps.length} step{proposal.steps.length === 1 ? '' : 's'}</span>
                  </span>
                </span>
              </label>
            ))}
          </div>
        </div>
        <div className="shrink-0 border-t border-border p-4">
          {actionError && <p role="alert" className="mb-2 text-xs text-danger">{actionError}</p>}
          <button type="button" disabled={acting || selectedIdx.size === 0 || selectedRun.applied} onClick={() => void addProposalsToLibrary()} className="ui-button-primary w-full disabled:opacity-45">
            {selectedRun.applied ? 'Added ✓' : acting ? 'Adding…' : `Add ${selectedIdx.size} to library`}
          </button>
        </div>
      </>
    )}

    {selectedRun.status === 'completed' && selectedRun.kind === 'refine' && selectedRun.result && (
      <>
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          <p className="text-sm font-semibold">{(selectedRun.result as RefinedCase).title}</p>
          {(selectedRun.result as RefinedCase).preconditions?.length > 0 && (
            <div className="mt-3">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-text-secondary">Preconditions</p>
              <ul className="mt-1 space-y-1 text-sm text-text-secondary">{(selectedRun.result as RefinedCase).preconditions.map((item, index) => <li key={index}>- {item}</li>)}</ul>
            </div>
          )}
          <div className="mt-3">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-text-secondary">Steps</p>
            <ol className="mt-1.5 space-y-2">
              {(selectedRun.result as RefinedCase).steps.map((step, index) => (
                <li key={index} className="rounded-lg border border-border p-2.5 text-sm">
                  <p><span className="font-medium">{index + 1}.</span> {step.action}</p>
                  <p className="mt-1 text-xs text-text-secondary">Expect: {step.expected}</p>
                </li>
              ))}
            </ol>
          </div>
        </div>
        <div className="shrink-0 border-t border-border p-4">
          {actionError && <p role="alert" className="mb-2 text-xs text-danger">{actionError}</p>}
          <button type="button" disabled={acting || selectedRun.applied} onClick={() => void applyRefinement()} className="ui-button-primary w-full disabled:opacity-45">
            {selectedRun.applied ? 'Applied ✓' : acting ? 'Applying…' : selectedRun.input.testCaseId ? 'Save refined case' : 'Add to library'}
          </button>
        </div>
      </>
    )}
  </div>;
}

export function useUnreviewedRunCount(kind: RunKind) {
  const [count, setCount] = useState(0);
  useEffect(() => {
    const check = () => fetch(`${ROOT}/api/qa/test-cases/generation-runs`)
      .then(response => (response.ok ? response.json() : []))
      .then((data: GenerationRun[]) => setCount(data.filter(run => run.kind === kind && run.status === 'completed' && !run.applied).length))
      .catch(() => {});
    void check();
    const interval = setInterval(check, 5000);
    return () => clearInterval(interval);
  }, [kind]);
  return count;
}
