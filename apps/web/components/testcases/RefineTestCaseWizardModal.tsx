'use client';

import { useState } from 'react';
import { createPortal } from 'react-dom';
import { Wand2, X, ChevronLeft, Search, Loader2, AlertTriangle, Link2, LayoutList, ClipboardPaste, History } from 'lucide-react';
import { cn } from '@/lib/utils';
import { saveTestCase } from '@/lib/testCaseFields';
import type { TestCase } from '@/lib/types';
import { RunsPanel, useUnreviewedRunCount } from './RunsPanel';

const ROOT = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

type Origin = 'platform' | 'external';
type Phase = 'source' | 'pick' | 'details' | 'refining' | 'review';
type RefinedCase = { title: string; steps: Array<{ action: string; expected: string }>; preconditions: string[] };

async function readJson(response: Response) {
  try { return await response.json(); } catch { return {}; }
}

export function RefineTestCaseWizardModal({
  testCases,
  onClose,
  onApplied,
}: {
  testCases: TestCase[];
  onClose: () => void;
  onApplied: (testCase: TestCase) => void;
}) {
  const [origin, setOrigin] = useState<Origin | null>(null);
  const [phase, setPhase] = useState<Phase>('source');
  const [viewingRuns, setViewingRuns] = useState(false);
  const unreviewedRuns = useUnreviewedRunCount('refine');

  const [query, setQuery] = useState('');
  const [selectedCase, setSelectedCase] = useState<TestCase | null>(null);

  const [externalTool, setExternalTool] = useState('');
  const [externalTitle, setExternalTitle] = useState('');
  const [externalDescription, setExternalDescription] = useState('');

  const [instructions, setInstructions] = useState('');
  const [links, setLinks] = useState<string[]>([]);
  const [linkInput, setLinkInput] = useState('');

  const [refineError, setRefineError] = useState('');
  const [proposal, setProposal] = useState<RefinedCase | null>(null);
  const [applying, setApplying] = useState(false);
  const [applyError, setApplyError] = useState('');

  const [queueError, setQueueError] = useState('');
  const [queuing, setQueuing] = useState(false);

  const chooseOrigin = (value: Origin) => { setOrigin(value); setPhase('pick'); };
  const backToSource = () => { setOrigin(null); setPhase('source'); setSelectedCase(null); setExternalTitle(''); setExternalDescription(''); setExternalTool(''); };
  const backToPick = () => { setPhase('pick'); setRefineError(''); setProposal(null); };

  const pickPlatformCase = (testCase: TestCase) => { setSelectedCase(testCase); setPhase('details'); };
  const confirmExternal = () => { if (externalTitle.trim()) setPhase('details'); };

  const addLink = () => {
    const value = linkInput.trim();
    if (value && !links.includes(value)) setLinks(previous => [...previous, value]);
    setLinkInput('');
  };
  const removeLink = (value: string) => setLinks(previous => previous.filter(link => link !== value));

  const filteredCases = testCases.filter(testCase => !query || `${testCase.title} ${testCase.flow} ${testCase.id}`.toLowerCase().includes(query.toLowerCase()));

  const buildRequestBody = () => origin === 'platform'
    ? { testCaseId: selectedCase?.id, instructions: instructions.trim(), links: links.length ? links : undefined }
    : { externalTitle: externalTitle.trim(), externalDescription: externalDescription.trim() || undefined, instructions: instructions.trim(), links: links.length ? links : undefined };

  const refine = async () => {
    setRefineError('');
    setPhase('refining');
    try {
      const response = await fetch(`${ROOT}/api/qa/test-cases/refine`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildRequestBody()),
      });
      const data = await readJson(response);
      if (!response.ok) throw new Error(data.message || 'QAE could not refine this test case');
      setProposal(data as RefinedCase);
      setPhase('review');
    } catch (reason) {
      setRefineError(reason instanceof Error ? reason.message : 'QAE could not refine this test case');
      setPhase('review');
    }
  };

  const runInBackground = async () => {
    setQueueError('');
    setQueuing(true);
    try {
      const response = await fetch(`${ROOT}/api/qa/test-cases/refine/runs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildRequestBody()),
      });
      const data = await readJson(response);
      if (!response.ok) throw new Error(data.message || 'Could not queue this run');
      setOrigin(null);
      setPhase('source');
      setViewingRuns(true);
    } catch (reason) {
      setQueueError(reason instanceof Error ? reason.message : 'Could not queue this run');
    } finally {
      setQueuing(false);
    }
  };

  const apply = async () => {
    if (!proposal) return;
    setApplying(true);
    setApplyError('');
    try {
      if (origin === 'platform' && selectedCase) {
        const updated = await saveTestCase(selectedCase, { title: proposal.title, steps: proposal.steps, preconditions: proposal.preconditions });
        onApplied(updated);
      } else {
        const response = await fetch(`${ROOT}/api/qa/test-cases`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: proposal.title, steps: proposal.steps, preconditions: proposal.preconditions, tags: externalTool.trim() ? [externalTool.trim()] : [] }),
        });
        const data = await readJson(response);
        if (!response.ok) throw new Error(data.message || 'Could not add the refined case');
        onApplied(data as TestCase);
      }
      onClose();
    } catch (reason) {
      setApplyError(reason instanceof Error ? reason.message : 'Could not apply the refined case');
    } finally {
      setApplying(false);
    }
  };

  if (typeof document === 'undefined') return null;

  return createPortal(
    <div className="ui-backdrop fixed inset-0 z-50 flex items-center justify-center p-4 motion-safe:animate-fade-in" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Refine a test case"
        onClick={event => event.stopPropagation()}
        className="ui-dialog-panel relative flex h-[640px] w-[600px] max-w-[94vw] max-h-[90vh] flex-col overflow-hidden motion-safe:animate-modal-in"
      >
        <div className="flex shrink-0 items-start gap-3 border-b border-border p-4">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent-purple/10 text-accent-purple"><Wand2 size={17}/></span>
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-semibold">Refine a test case</h2>
            <p className="mt-0.5 text-xs text-text-secondary">
              {viewingRuns && 'Background refine requests and their results.'}
              {!viewingRuns && phase === 'source' && 'Where does the test you want to refine live?'}
              {!viewingRuns && phase === 'pick' && origin === 'platform' && 'Select the case to refine.'}
              {!viewingRuns && phase === 'pick' && origin === 'external' && 'Describe the test from the external tool.'}
              {!viewingRuns && phase === 'details' && 'What should change, and any references to use.'}
              {!viewingRuns && phase === 'refining' && 'QAE is refining the test case…'}
              {!viewingRuns && phase === 'review' && 'Review the refined case before applying it.'}
            </p>
          </div>
          <button onClick={onClose} aria-label="Close" className="ui-icon-button"><X size={18}/></button>
        </div>

        <div className="flex shrink-0 gap-1 border-b border-border p-2">
          <TabButton active={!viewingRuns} onClick={() => setViewingRuns(false)}>New</TabButton>
          <TabButton active={viewingRuns} onClick={() => setViewingRuns(true)} icon={<History size={13}/>} badge={unreviewedRuns}>Recent runs</TabButton>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {viewingRuns ? (
            <RunsPanel kind="refine" onCreated={() => {}} onApplied={onApplied}/>
          ) : (
          <>
            {phase === 'source' && (
              <div className="motion-safe:animate-fade-in grid gap-3 p-5">
                <button type="button" onClick={() => chooseOrigin('platform')} className="flex items-start gap-3 rounded-xl border border-border p-4 text-left transition-colors hover:border-accent-blue/40 hover:bg-elevated/55">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent-blue/10 text-accent-blue"><LayoutList size={18}/></span>
                  <span className="min-w-0"><span className="block text-sm font-semibold">From this platform</span><span className="mt-0.5 block text-xs text-text-secondary">Search your existing test library.</span></span>
                </button>
                <button type="button" onClick={() => chooseOrigin('external')} className="flex items-start gap-3 rounded-xl border border-border p-4 text-left transition-colors hover:border-accent-blue/40 hover:bg-elevated/55">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent-blue/10 text-accent-blue"><ClipboardPaste size={18}/></span>
                  <span className="min-w-0"><span className="block text-sm font-semibold">From a third-party tool</span><span className="mt-0.5 block text-xs text-text-secondary">Paste in details from TestRail, Zephyr, Xray, or anywhere else — no live connection needed.</span></span>
                </button>
              </div>
            )}

            {phase === 'pick' && origin === 'platform' && (
              <div className="motion-safe:animate-fade-in flex h-full flex-col">
                <div className="shrink-0 space-y-2 p-4 pb-3">
                  <BackLink onClick={backToSource}/>
                  <label className="relative block">
                    <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-secondary"/>
                    <input autoFocus value={query} onChange={event => setQuery(event.target.value)} placeholder="Search your test cases…" className="ui-field w-full text-sm" style={{ paddingLeft: '2.25rem' }}/>
                  </label>
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
                  <div className="divide-y divide-border">
                    {filteredCases.map(testCase => (
                      <button key={testCase.id} type="button" onClick={() => pickPlatformCase(testCase)} className="flex w-full items-start gap-2 px-1 py-2.5 text-left transition-colors hover:bg-elevated/55">
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm font-medium">{testCase.title}</span>
                          <span className="mt-0.5 block text-[11px] text-text-secondary">{testCase.flow || 'General'} · {(testCase.steps || []).length} step{(testCase.steps || []).length === 1 ? '' : 's'}</span>
                        </span>
                      </button>
                    ))}
                  </div>
                  {!filteredCases.length && <p className="p-8 text-center text-sm text-text-secondary">{testCases.length ? 'No cases match this search.' : 'Your test library is empty.'}</p>}
                </div>
              </div>
            )}

            {phase === 'pick' && origin === 'external' && (
              <div className="motion-safe:animate-fade-in flex h-full flex-col p-5">
                <BackLink onClick={backToSource}/>
                <label className="mt-3 block text-xs font-semibold text-text-secondary">TOOL (OPTIONAL)
                  <input value={externalTool} onChange={event => setExternalTool(event.target.value)} placeholder="e.g. TestRail, Zephyr, Xray" className="ui-field mt-1.5 w-full text-sm"/>
                </label>
                <label className="mt-3 block text-xs font-semibold text-text-secondary">TEST TITLE
                  <input autoFocus value={externalTitle} onChange={event => setExternalTitle(event.target.value)} placeholder="e.g. Checkout fails with expired coupon" className="ui-field mt-1.5 w-full text-sm"/>
                </label>
                <label className="mt-3 block text-xs font-semibold text-text-secondary">CURRENT STEPS OR DESCRIPTION
                  <textarea value={externalDescription} onChange={event => setExternalDescription(event.target.value)} rows={6} placeholder="Paste the steps or description as they exist today." className="ui-field mt-1.5 w-full resize-none text-sm"/>
                </label>
                <div className="mt-auto pt-4">
                  <button type="button" disabled={!externalTitle.trim()} onClick={confirmExternal} className="ui-button-primary w-full disabled:opacity-45">Continue</button>
                </div>
              </div>
            )}

            {phase === 'details' && (
              <div className="motion-safe:animate-fade-in flex h-full flex-col p-5">
                <BackLink onClick={backToPick}/>
                <div className="mt-2 rounded-xl border border-l-2 border-border border-l-accent-blue bg-accent-blue/5 p-3">
                  <p className="text-xs text-text-secondary">Refining</p>
                  <p className="text-sm font-medium">{origin === 'platform' ? selectedCase?.title : externalTitle}</p>
                </div>
                <label className="mt-3 block text-xs font-semibold text-text-secondary">WHAT SHOULD CHANGE?
                  <textarea autoFocus value={instructions} onChange={event => setInstructions(event.target.value)} rows={5} placeholder="e.g. Add a check for the error toast, and cover the case where the session expires mid-checkout." className="ui-field mt-1.5 w-full resize-none text-sm"/>
                </label>
                <label className="mt-3 block text-xs font-semibold text-text-secondary">REFERENCE LINKS (OPTIONAL)
                  <div className="mt-1.5 flex gap-2">
                    <input value={linkInput} onChange={event => setLinkInput(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); addLink(); } }} placeholder="Paste a link, press Enter" className="ui-field w-full text-sm"/>
                  </div>
                </label>
                {links.length > 0 && <div className="mt-2 flex flex-wrap gap-1.5">
                  {links.map(link => (
                    <span key={link} className="inline-flex max-w-full items-center gap-1.5 rounded-md border border-accent-blue/20 bg-accent-blue/5 px-2 py-1 text-xs text-accent-blue">
                      <Link2 size={11} className="shrink-0"/><span className="truncate">{link}</span>
                      <button type="button" onClick={() => removeLink(link)} aria-label={`Remove ${link}`} className="shrink-0 hover:text-text-primary"><X size={11}/></button>
                    </span>
                  ))}
                </div>}
                <div className="mt-auto space-y-1.5 pt-4">
                  <button type="button" disabled={!instructions.trim()} onClick={() => void refine()} className="ui-button-primary w-full disabled:opacity-45">Refine</button>
                  <button type="button" disabled={!instructions.trim() || queuing} onClick={() => void runInBackground()} className="w-full rounded-lg border border-border px-3 py-2.5 text-sm font-medium text-text-secondary transition-colors hover:border-border-strong hover:bg-elevated disabled:opacity-45">{queuing ? 'Queuing…' : 'Run in background'}</button>
                  {queueError && <p role="alert" className="text-xs text-danger">{queueError}</p>}
                </div>
              </div>
            )}

            {phase === 'refining' && (
              <div className="motion-safe:animate-fade-in flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
                <Loader2 size={28} className="animate-spin text-accent-purple"/>
                <p className="text-sm font-medium">QAE is refining the test case…</p>
              </div>
            )}

            {phase === 'review' && (
              <div className="motion-safe:animate-fade-in flex h-full flex-col">
                {refineError ? (
                  <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
                    <AlertTriangle size={24} className="text-danger"/>
                    <p className="text-sm font-medium">{refineError}</p>
                    <button type="button" onClick={() => setPhase('details')} className="ui-button-primary">Try again</button>
                  </div>
                ) : proposal && (
                  <>
                    <div className="min-h-0 flex-1 overflow-y-auto p-4">
                      <p className="text-sm font-semibold">{proposal.title}</p>
                      {proposal.preconditions.length > 0 && (
                        <div className="mt-3">
                          <p className="text-[11px] font-semibold uppercase tracking-wide text-text-secondary">Preconditions</p>
                          <ul className="mt-1 space-y-1 text-sm text-text-secondary">{proposal.preconditions.map((item, index) => <li key={index}>- {item}</li>)}</ul>
                        </div>
                      )}
                      <div className="mt-3">
                        <p className="text-[11px] font-semibold uppercase tracking-wide text-text-secondary">Steps</p>
                        <ol className="mt-1.5 space-y-2">
                          {proposal.steps.map((step, index) => (
                            <li key={index} className="rounded-lg border border-border p-2.5 text-sm">
                              <p><span className="font-medium">{index + 1}.</span> {step.action}</p>
                              <p className="mt-1 text-xs text-text-secondary">Expect: {step.expected}</p>
                            </li>
                          ))}
                        </ol>
                      </div>
                    </div>
                    <div className="shrink-0 border-t border-border p-4">
                      {applyError && <p role="alert" className="mb-2 text-xs text-danger">{applyError}</p>}
                      <button type="button" disabled={applying} onClick={() => void apply()} className="ui-button-primary w-full disabled:opacity-45">
                        {applying ? 'Applying…' : origin === 'platform' ? 'Save refined case' : 'Add to library'}
                      </button>
                    </div>
                  </>
                )}
              </div>
            )}
          </>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

function TabButton({ active, onClick, icon, badge, children }: { active: boolean; onClick: () => void; icon?: React.ReactNode; badge?: number; children: React.ReactNode }) {
  return <button type="button" onClick={onClick} className={cn('relative inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors', active ? 'bg-elevated text-text-primary' : 'text-text-secondary hover:bg-elevated/60 hover:text-text-primary')}>
    {icon}{children}
    {!!badge && <span className="ml-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-accent-blue px-1 text-[10px] font-semibold text-white">{badge}</span>}
  </button>;
}

function BackLink({ onClick }: { onClick: () => void }) {
  return <button type="button" onClick={onClick} className={cn('flex w-fit items-center gap-1 text-xs text-text-secondary transition-colors hover:text-text-primary')}><ChevronLeft size={14}/>Back</button>;
}
