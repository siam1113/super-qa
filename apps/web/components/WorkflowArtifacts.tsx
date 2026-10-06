'use client';

import { useEffect, useState } from 'react';
import { Loader2, RotateCcw, X } from 'lucide-react';
import { chatRequest } from '@/lib/chat';
import { useAppStore } from '@/lib/store';
import { cn } from '@/lib/utils';
import { DataView } from './ArtifactDataView';

const qaBase = `${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000'}/api/qa`;

type Artifact = { id: string; requestId: string; skill: string; status: string; summary: string; producedAt: string };
type Check = { name: string; status: string; message: string };
type Result = { skill: string; status: string; summary: string; data: Record<string, unknown>; warnings?: string[]; jobs?: Array<{ job_id: string; state: string; verdict: string | null }> };
type Finding = { id: string; origin: string; kind: string; message: string; question: string; citations: Array<{ field: string; quote: string }> };

type SuiteJob = { id: string; status: string; deadline: string; cleanupReceipt: { container: string; dataset: string } | null; results: Array<{ checkId: string; status: string; expected?: number; discovered?: number; executed?: number; flaky?: boolean; targetRevision?: string; traceability?: { links: Array<{ testId: string; caseId: string; caseRevision: number; identityObserved: boolean }> }; steps?: Array<{ id: string; status: string; expectedStatus?: number; actualStatus?: number; assertions: Array<{ id: string; passed: boolean }> }>; observation?: { revisionBefore?: string; revisionAfter?: string; error?: string; tests?: Array<{ id: string; attempts: Array<{ retry: number; status: string; durationMs: number }> }> } }> | null };

function SuiteProgress({ agentId, requestId }: { agentId: string; requestId: string }) {
  const [job, setJob] = useState<SuiteJob | null>(null);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const refresh = async () => {
      try {
        const value = await chatRequest<SuiteJob>(`/agents/${agentId}/workflow-artifacts/${requestId}/job`, undefined, controller.signal);
        if (controller.signal.aborted) return;
        setJob(value); setError('');
        if (['queued', 'running'].includes(value.status) || value.cleanupReceipt?.container === 'pending' || value.cleanupReceipt?.dataset === 'pending') timer = setTimeout(refresh, 5000);
      } catch (failure) { if (!controller.signal.aborted) setError((failure as Error).message); }
    };
    void refresh();
    return () => { controller.abort(); if (timer) clearTimeout(timer); };
  }, [agentId, requestId, revision]);
  return <div className="space-y-3 rounded-lg border border-border p-3">
    <div className="flex items-center justify-between gap-2"><h5 className="text-sm font-medium">Current suite execution</h5><button type="button" className="text-xs text-accent-blue" onClick={() => setRevision(value => value + 1)}>Refresh</button></div>
    {error && <p role="alert" className="text-sm text-danger">{error}</p>}
    {!job && !error && <p role="status" className="text-sm text-text-secondary">Loading job…</p>}
    {job && <>
      <p className="text-sm">{job.status}<span className="block break-all font-mono text-xs text-text-secondary">{job.id}</span></p>
      {job.cleanupReceipt && <p className="text-xs text-text-secondary">Runner cleanup: {job.cleanupReceipt.container} · Dataset cleanup: {job.cleanupReceipt.dataset}</p>}
      {job.results?.map(result => <div key={result.checkId} className="space-y-2 border-t border-border pt-2">
        <p className="text-sm">{result.checkId}: {result.status}{result.flaky ? ' · mixed attempts' : ''}</p>
        {result.expected !== undefined && <p className="text-xs text-text-secondary">Expected {result.expected} · Discovered {result.discovered} · Executed {result.executed}</p>}
        {result.targetRevision && <p className="break-all text-xs text-text-secondary">Target revision: {result.targetRevision}<br />Observed before: {result.observation?.revisionBefore || 'Unavailable'} · After: {result.observation?.revisionAfter || 'Unavailable'}</p>}
        {result.observation?.error && <p className="text-xs text-warning">{result.observation.error.replaceAll('_', ' ')}</p>}
        {result.steps && <ul className="space-y-2">{result.steps.map(step => <li key={step.id} className="rounded-lg bg-elevated p-2 text-xs"><p>{step.id}: {step.status.replaceAll('_', ' ')}{step.expectedStatus !== undefined ? ` · HTTP ${step.actualStatus} / expected ${step.expectedStatus}` : ''}</p>{step.assertions.map(assertion => <span key={assertion.id} className="mr-3 mt-1 inline-block text-text-secondary">{assertion.id}: {assertion.passed ? 'passed' : 'failed'}</span>)}</li>)}</ul>}
        {!!result.traceability?.links.length && <details><summary className="cursor-pointer text-xs text-accent-blue">Case-to-test links</summary><ul className="mt-2 space-y-2">{result.traceability.links.map(link => <li key={link.testId + link.caseId} className="break-all text-xs"><span>{link.caseId} · revision {link.caseRevision}</span><span className="block font-mono text-text-secondary">{link.testId}</span><span className="text-text-secondary">{link.identityObserved ? 'Test identity observed in complete report' : 'Declared mapping; complete execution evidence unavailable'}</span></li>)}</ul><p className="mt-2 text-xs text-text-secondary">The mapping is operator-declared; matching identities does not establish semantic coverage.</p></details>}
        {result.observation?.tests && <details><summary className="cursor-pointer text-xs text-accent-blue">Test attempts</summary><ul className="mt-2 space-y-2">{result.observation.tests.map(test => <li key={test.id} className="text-xs"><span className="block break-all font-mono text-text-secondary">{test.id}</span>{test.attempts.length ? test.attempts.map(attempt => <span key={attempt.retry} className="mr-3 inline-block">Attempt {attempt.retry + 1}: {attempt.status} ({attempt.durationMs} ms)</span>) : 'Not executed'}</li>)}</ul></details>}
      </div>)}
    </>}
  </div>;
}

type SelectedSuite = { suite_profile_id: string; tests: Array<{ test_id: string; case_ids: string[]; reasons: string[] }> };
function RegressionSelection({ data }: { data: Record<string, unknown> }) {
  const suites = (value: unknown): SelectedSuite[] => Array.isArray(value) ? value.filter((item): item is SelectedSuite => Boolean(item && typeof item.suite_profile_id === 'string' && Array.isArray(item.tests))) : [];
  return <div className="space-y-3 rounded-lg border border-border p-3">
    <p className="text-sm font-medium">Regression selection: {String(data.state).replaceAll('_', ' ')}</p>
    <p className="text-sm text-text-secondary">{String(data.summary || '')}</p>
    <p className="text-xs">Selected {String(data.selected_test_count)} of {String(data.inventory_test_count)} test invocations · Budget {String(data.max_tests)}</p>
    {data.conservative_fallback === true && <p className="text-xs text-warning">Incomplete impact or case mappings: all configured suites were retained.</p>}
    {data.budget_exceeded === true && <p className="text-xs text-warning">Required scope exceeds the budget. Review the budget or scope before scheduling; no tests were silently removed.</p>}
    {(['selected_suites', 'omitted_suites'] as const).map(key => <details key={key} open={key === 'selected_suites'}><summary className="cursor-pointer text-xs text-accent-blue">{key === 'selected_suites' ? 'Selected' : 'Omitted'} suites ({suites(data[key]).length})</summary><div className="mt-2 space-y-2">{suites(data[key]).map(suite => <details key={suite.suite_profile_id} className="rounded-lg bg-elevated p-2"><summary className="cursor-pointer text-xs">{suite.suite_profile_id} · {suite.tests.length} tests</summary><ul className="mt-2 space-y-2">{suite.tests.map(test => <li key={test.test_id} className="break-all text-xs"><span className="font-mono">{test.test_id}</span><span className="block text-text-secondary">Cases: {test.case_ids.join(', ') || 'Unmapped'}</span><span className="block text-text-secondary">{test.reasons.map(reason => reason.replaceAll('_', ' ')).join(' · ')}</span></li>)}</ul></details>)}</div></details>)}
    <p className="text-xs text-text-secondary">Recommendation only. Execute each selected approved suite with its pinned repository/app revision and required fixture.</p>
  </div>;
}

function RequirementReview({ data }: { data: Record<string, unknown> }) {
  const findings = Array.isArray(data.findings) ? data.findings.filter((item): item is Finding => Boolean(item && typeof item.id === 'string' && typeof item.question === 'string' && Array.isArray(item.citations))) : [];
  return <div className="space-y-3">
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm"><span className="font-medium">Review: {String(data.review_state).replaceAll('_', ' ')}</span><span className="text-text-secondary">Semantic review: {String(data.semantic_status).replaceAll('_', ' ')}</span></div>
    <p className="text-xs text-text-secondary">{data.provenance === 'configured_snapshot' ? 'Configured snapshot checked when this report was produced. Its revision is rechecked when another workflow uses it.' : 'Supplied snapshot only. The current upstream revision has not been verified.'} Findings are review items; this report does not approve requirements.</p>
    {data.findings_truncated === true && <p className="text-sm text-warning">Showing a bounded subset of {String(data.finding_count)} findings. Split the requirements into smaller reviews to inspect every finding.</p>}
    {!findings.length && <p className="text-sm text-text-secondary">No findings recorded. This does not establish complete acceptance coverage.</p>}
    <ul className="space-y-3">{findings.map(item => <li key={item.id} className="space-y-2 rounded-lg border border-border p-3">
      <div className="flex flex-wrap justify-between gap-2 text-xs"><span>{item.kind.replaceAll('_', ' ')}</span><span className="text-text-secondary">{item.origin === 'model_proposal' ? 'Model proposal · needs review' : 'Structural observation'}</span></div>
      <p className="text-sm">{item.message}</p><p className="text-sm font-medium">{item.question}</p>
      {item.citations.map((cite, index) => <blockquote key={index} className="border-l-2 border-border pl-3"><p className="whitespace-pre-wrap break-words text-sm text-text-secondary">{cite.quote}</p><p className="mt-1 break-all font-mono text-xs text-text-tertiary">{cite.field}</p></blockquote>)}
    </li>)}</ul>
    <p className="break-all font-mono text-xs text-text-secondary">Snapshot: {String(data.snapshot_hash)}</p>
    <details><summary className="cursor-pointer text-sm text-accent-blue">Full review and source revisions</summary><pre className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-elevated p-3 text-xs">{JSON.stringify(data, null, 2)}</pre></details>
  </div>;
}

type DesignedCase = { id: string; title: string; steps: Array<{ action: string; expected: string }>; preconditions: string[]; origin: string };
type ImportResult = { createdCount: number; alreadyImported: number; invalid: number };

function DesignedCases({ artifactId, data }: { artifactId: string; data: Record<string, unknown> }) {
  const setData = useAppStore(state => state.setData);
  const [importing, setImporting] = useState(false);
  const [imported, setImported] = useState<ImportResult | null>(null);
  const [error, setError] = useState('');
  const cases = Array.isArray(data.cases) ? data.cases.filter((item): item is DesignedCase =>
    Boolean(item && typeof item.id === 'string' && typeof item.title === 'string' && Array.isArray(item.steps))) : [];

  async function importCases() {
    setImporting(true); setError('');
    try {
      const response = await fetch(`${qaBase}/test-cases/import-artifact`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ artifactId }) });
      const result = await response.json();
      if (!response.ok) throw new Error(Array.isArray(result.message) ? result.message.join('; ') : result.message || 'Import failed');
      setImported({ createdCount: result.createdCount, alreadyImported: result.alreadyImported, invalid: result.invalid });
      const workspace = await fetch(`${qaBase}/workspace`).then(response => response.json());
      setData(workspace);
    } catch (failure) { setError((failure as Error).message); }
    finally { setImporting(false); }
  }

  return <div className="space-y-3">
    <p className="text-sm text-text-secondary">{String(data.coverage_basis || '')}</p>
    <ul className="space-y-2">{cases.map(item => <li key={item.id} className="rounded-lg border border-border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2"><span className="break-all font-mono text-xs">{item.id}</span><span className="text-xs text-text-secondary">{item.origin === 'model_proposal' ? 'Model proposal' : 'Supplied steps'}</span></div>
      <p className="mt-1 text-sm">{item.title}</p>
      <p className="mt-1 text-xs text-text-secondary">{item.steps.length} step{item.steps.length === 1 ? '' : 's'}{item.preconditions.length ? ` · ${item.preconditions.length} precondition${item.preconditions.length === 1 ? '' : 's'}` : ''}</p>
    </li>)}</ul>
    {!cases.length && <p className="text-sm text-text-secondary">No cases in this report.</p>}
    <div className="flex items-center gap-3">
      <button type="button" onClick={importCases} disabled={importing || !cases.length} className="rounded-lg bg-accent-blue px-4 py-2.5 text-sm font-medium text-white disabled:opacity-40">{importing ? 'Importing…' : 'Import to Test Cases'}</button>
      {imported && <p role="status" className="text-sm text-success">{imported.createdCount} added{imported.alreadyImported ? `, ${imported.alreadyImported} already in Test Cases` : ''}{imported.invalid ? `, ${imported.invalid} skipped (malformed)` : ''}.</p>}
    </div>
    {error && <p role="alert" className="text-sm text-danger">{error}</p>}
    <p className="text-xs text-text-secondary">Imported cases land in Plan → Test Cases as drafts for review; nothing here is a test result.</p>
  </div>;
}

type ExplorePage = {
  id?: string; url?: string; path?: string; depth?: number;
  snapshot?: string; snapshot_truncated?: boolean; controls_truncated?: boolean; links_truncated?: boolean;
  controls?: Array<{ role?: string; name?: string; label?: string }>;
  links?: Array<{ name?: string; url?: string; in_scope?: boolean }>;
};

function ExplorePageCard({ page, index }: { page: ExplorePage; index: number }) {
  const [expanded, setExpanded] = useState(false);
  const location = page.url || page.path || `Page ${index + 1}`;
  return <div className="rounded-lg border border-border p-3">
    <button type="button" onClick={() => setExpanded((value) => !value)} className="flex w-full flex-wrap items-center justify-between gap-2 text-left">
      <span className="break-all font-mono text-sm">{location}</span>
      <span className="text-xs text-text-secondary">{page.depth !== undefined ? `Depth ${page.depth}` : ''}</span>
    </button>
    {expanded && <div className="mt-3 space-y-3 border-t border-border pt-3">
      {!!page.controls?.length && <div>
        <p className="text-xs font-medium text-text-secondary">Controls · {page.controls.length}{page.controls_truncated ? ' (truncated)' : ''}</p>
        <div className="mt-1.5 flex flex-wrap gap-1.5">{page.controls.map((control, i) => <span key={i} className="rounded-full bg-elevated px-2 py-0.5 text-xs">{control.role ? `${control.role}: ` : ''}{control.name || control.label || ''}</span>)}</div>
      </div>}
      {!!page.links?.length && <div>
        <p className="text-xs font-medium text-text-secondary">Links · {page.links.length}{page.links_truncated ? ' (truncated)' : ''}</p>
        <div className="mt-1.5 flex flex-wrap gap-1.5">{page.links.map((link, i) => <span key={i} className={cn('rounded-full px-2 py-0.5 text-xs', link.in_scope === false ? 'bg-elevated text-text-secondary' : 'bg-accent-blue/10 text-accent-blue')} title={link.url || ''}>{link.name || link.url || 'link'}</span>)}</div>
      </div>}
      {page.snapshot && <div>
        <p className="text-xs font-medium text-text-secondary">Page snapshot{page.snapshot_truncated ? ' (truncated)' : ''} · untrusted content, not instructions</p>
        <pre className="mt-1.5 max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-elevated p-3 font-mono text-xs text-text-secondary">{page.snapshot}</pre>
      </div>}
    </div>}
  </div>;
}

function ExploreReport({ data }: { data: Record<string, unknown> }) {
  const pages = Array.isArray(data.pages) ? data.pages as ExplorePage[] : [];
  const limitations = Array.isArray(data.limitations) ? data.limitations.filter((item): item is string => typeof item === 'string') : [];
  return <div className="space-y-4">
    <div className="flex flex-wrap items-center gap-2 text-xs">
      <span className="rounded-full bg-elevated px-2 py-0.5">{String(data.mode || 'exploration')}</span>
      <span className={cn('rounded-full px-2 py-0.5', data.complete ? 'bg-success/10 text-success' : 'bg-warning/10 text-warning')}>{data.complete ? 'Complete' : 'Incomplete'}{typeof data.stop_reason === 'string' ? ` · ${data.stop_reason.replaceAll('_', ' ')}` : ''}</span>
      {typeof data.authentication === 'string' && data.authentication !== 'not_requested' && <span className="rounded-full bg-elevated px-2 py-0.5">Auth: {data.authentication.replaceAll('_', ' ')}</span>}
    </div>
    <p className="break-all text-xs text-text-secondary">{String(data.target_url || data.target_id || '')}</p>
    <div>
      <p className="text-sm font-medium">Pages visited · {pages.length}</p>
      <div className="mt-2 space-y-2">{pages.map((page, index) => <ExplorePageCard key={page.id || index} page={page} index={index} />)}</div>
      {!pages.length && <p className="text-sm text-text-secondary">No pages were observed.</p>}
    </div>
    {!!limitations.length && <div><p className="text-xs font-medium text-text-secondary">Limitations</p><ul className="mt-1 list-inside list-disc text-xs text-text-secondary">{limitations.map((item, index) => <li key={index}>{item}</li>)}</ul></div>}
    {data.page_errors !== undefined && <div><p className="text-xs font-medium text-text-secondary">Page errors</p><DataView value={data.page_errors} /></div>}
    <p className="text-xs text-text-secondary">{[data.commands !== undefined && `${data.commands} browser commands`, data.pending_pages !== undefined && `${data.pending_pages} pages not yet visited`, data.remaining_actions !== undefined && `${data.remaining_actions} actions not completed`].filter(Boolean).join(' · ')}</p>
  </div>;
}

function readinessChecks(data: Record<string, unknown>): Check[] {
  if (!Array.isArray(data.checks)) return [];
  return data.checks.filter((item): item is Check => Boolean(item && typeof item === 'object' && typeof item.name === 'string' && typeof item.status === 'string' && typeof item.message === 'string'));
}

function ArtifactModal({ agentId, item, onClose }: { agentId: string; item: Artifact; onClose: () => void }) {
  const [detail, setDetail] = useState<Result | null>(null);
  const [opening, setOpening] = useState(true);
  const [detailError, setDetailError] = useState('');
  const [viewMode, setViewMode] = useState<'pretty' | 'json'>('pretty');

  useEffect(() => {
    const controller = new AbortController();
    setDetail(null); setDetailError(''); setOpening(true);
    chatRequest<{ result: Result }>(`/agents/${agentId}/workflow-artifacts/${item.requestId}`, undefined, controller.signal)
      .then(value => { if (!controller.signal.aborted) setDetail(value.result); })
      .catch(failure => { if (!controller.signal.aborted) setDetailError((failure as Error).message); })
      .finally(() => { if (!controller.signal.aborted) setOpening(false); });
    return () => controller.abort();
  }, [agentId, item.requestId]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  return <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
    <div className="ui-backdrop absolute inset-0" onClick={onClose} />
    <div role="dialog" aria-modal="true" aria-labelledby="artifact-modal-title" className="ui-dialog-panel relative flex w-full max-w-3xl flex-col overflow-hidden" style={{ maxHeight: '90vh' }}>
      <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-4">
        <div className="min-w-0">
          <h2 id="artifact-modal-title" className="break-all font-mono text-sm font-semibold">{item.skill}</h2>
          <p className="mt-0.5 text-xs text-text-secondary">{item.status} · {new Date(item.producedAt).toLocaleString()}</p>
        </div>
        <button type="button" onClick={onClose} aria-label="Close" className="shrink-0 rounded-lg p-2 text-text-secondary hover:bg-elevated hover:text-text-primary"><X size={18} /></button>
      </div>
      <div className="flex items-center gap-2 border-b border-border px-5 py-2.5">
        <div role="tablist" aria-label="View" className="inline-flex rounded-lg border border-border p-0.5">
          <button type="button" role="tab" aria-selected={viewMode === 'pretty'} onClick={() => setViewMode('pretty')} className={cn('rounded-md px-3 py-1 text-xs font-medium transition-colors', viewMode === 'pretty' ? 'bg-accent-blue/10 text-accent-blue' : 'text-text-secondary hover:text-text-primary')}>Pretty</button>
          <button type="button" role="tab" aria-selected={viewMode === 'json'} onClick={() => setViewMode('json')} className={cn('rounded-md px-3 py-1 text-xs font-medium transition-colors', viewMode === 'json' ? 'bg-accent-blue/10 text-accent-blue' : 'text-text-secondary hover:text-text-primary')}>JSON</button>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
        {opening && <p role="status" className="flex items-center gap-2 text-sm text-text-secondary"><Loader2 size={14} className="animate-spin" />Loading report…</p>}
        {detailError && <p role="alert" className="text-sm text-danger">{detailError}</p>}
        {detail && <div className="space-y-3">
          <p className="text-sm">{detail.summary}</p>
          {['run_automation_suite', 'test_api', 'investigate_defect'].includes(detail.skill) && !!detail.jobs?.length && <SuiteProgress agentId={agentId} requestId={item.requestId} />}
          {viewMode === 'json' ? <pre className="whitespace-pre-wrap break-words rounded-lg bg-elevated p-3 font-mono text-xs">{JSON.stringify(detail.data, null, 2)}</pre> : (
            detail.skill === 'select_regression_tests' && typeof detail.data.state === 'string' ? <RegressionSelection data={detail.data} />
            : detail.skill === 'investigate_defect' && typeof detail.data.state === 'string' ? <div className="space-y-2 rounded-lg border border-border p-3"><p className="text-sm font-medium">Investigation: {detail.data.state.replaceAll('_', ' ')}</p><p className="text-sm text-text-secondary">{String(detail.data.summary || '')}</p><p className="text-xs text-text-secondary">Root cause: unproven. This report does not publish a defect.</p>{Array.isArray(detail.data.blockers) && <ul className="list-inside list-disc text-xs text-warning">{detail.data.blockers.map((blocker, index) => <li key={index}>{String(blocker)}</li>)}</ul>}</div>
            : detail.skill === 'prepare_test_data' && detail.data.state === 'prepared' ? <p className="text-sm">Synthetic fixture prepared. No live dataset exists yet; the suite worker acquires and cleans up its lease during execution.</p>
            : detail.skill === 'check_test_readiness' && detail.data.readiness ? <>
              <p className="text-sm font-medium">Readiness snapshot: {String(detail.data.readiness)}{typeof detail.data.expires_at === 'string' && Date.parse(detail.data.expires_at) <= Date.now() ? ' · expired' : ''}</p>
              {typeof detail.data.expires_at === 'string' && <p className="text-xs text-text-secondary">Snapshot expires: {new Date(detail.data.expires_at).toLocaleString()}. Recheck before execution.</p>}
              <ul className="space-y-2">{readinessChecks(detail.data).map(check => <li key={check.name} className="rounded-lg bg-elevated p-3"><div className="flex flex-wrap justify-between gap-2 text-sm"><span className="font-mono">{check.name}</span><span>{check.status}</span></div><p className="mt-1 text-sm text-text-secondary">{check.message}</p></li>)}</ul>
            </>
            : detail.skill === 'review_requirements' && typeof detail.data.snapshot_hash === 'string' ? <RequirementReview data={detail.data} />
            : detail.skill === 'design_test_cases' && Array.isArray(detail.data.cases) ? <DesignedCases artifactId={item.id} data={detail.data} />
            : detail.skill === 'explore_app' && Array.isArray(detail.data.pages) ? <ExploreReport data={detail.data} />
            : <DataView value={detail.data} />
          )}
          {!!detail.jobs?.length && <div className="space-y-2">{detail.jobs.map(job => <p key={job.job_id} className="break-all text-sm">Execution {job.job_id}: {job.state}{job.verdict ? ` · ${job.verdict}` : ''}<span className="block text-xs text-text-secondary">State at report creation; request current job status for updates.</span></p>)}</div>}
          {detail.warnings?.map((warning, index) => <p key={index} className="text-sm text-text-secondary">{warning}</p>)}
          <p className="break-all text-xs text-text-secondary">Request: {item.requestId}</p>
        </div>}
      </div>
    </div>
  </div>;
}

export function WorkflowArtifacts({ agentId, standalone = false }: { agentId: string; standalone?: boolean }) {
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);
  const [openItem, setOpenItem] = useState<Artifact | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError(''); setArtifacts([]); setOpenItem(null);
    chatRequest<{ artifacts: Artifact[] }>(`/agents/${agentId}/workflow-artifacts`, undefined, controller.signal)
      .then(value => { if (!controller.signal.aborted) setArtifacts(value.artifacts); })
      .catch(failure => { if (!controller.signal.aborted) setError((failure as Error).message); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [agentId, revision]);

  return <section className={standalone ? '' : 'mt-8 border-t border-border pt-6'} aria-label="Recent workflow results">
    <div className="flex items-center justify-between gap-3">
      <h4 className={standalone ? 'text-xl font-semibold tracking-tight' : 'font-medium'}>Results</h4>
      <button type="button" onClick={() => setRevision(value => value + 1)} disabled={loading} className="inline-flex items-center gap-1 rounded-lg border border-border px-2 py-1 text-xs hover:bg-elevated disabled:opacity-50"><RotateCcw size={12} />Refresh</button>
    </div>
    <p className="mt-1 text-sm text-text-secondary">Latest 30 results saved to this app. Workflow completion means a report was produced; execution outcomes are shown separately.</p>
    {loading ? <p role="status" className="mt-4 flex items-center gap-2 text-sm text-text-secondary"><Loader2 size={14} className="animate-spin" />Loading results…</p> : error ? <p role="alert" className="mt-4 text-sm text-danger">{error}</p> : !artifacts.length ? <p className="mt-4 text-sm text-text-secondary">No shared workflow results yet. Results appear here after publication.</p> : <div className="mt-4 overflow-hidden rounded-xl border border-border divide-y divide-border">{artifacts.map(item => <button key={item.id} type="button" onClick={() => setOpenItem(item)} className="flex w-full flex-wrap items-center justify-between gap-2 p-3 text-left hover:bg-elevated focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent-blue">
      <span className="break-all font-mono text-sm">{item.skill}</span><span className="text-xs text-text-secondary">Workflow: {item.status}</span><time className="w-full text-xs text-text-secondary" dateTime={item.producedAt}>{new Date(item.producedAt).toLocaleString()}</time>
    </button>)}</div>}
    {openItem && <ArtifactModal agentId={agentId} item={openItem} onClose={() => setOpenItem(null)} />}
  </section>;
}
