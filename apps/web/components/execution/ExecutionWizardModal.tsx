'use client';

import { useState } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { Search, X, Rocket, ChevronLeft, Bot, Terminal, CheckCircle2 } from 'lucide-react';
import { cn, getPriorityColor, getRiskColor } from '@/lib/utils';

const API = `${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000'}/api/qa`;

type Candidate = { id: string; title: string; flow: string; priority: string; risk?: string | null; automation: string };

export function ExecutionWizardModal({
  candidates,
  onClose,
  onRunStarted,
}: {
  candidates: Candidate[];
  onClose: () => void;
  onRunStarted: (run: { runId: string; testName: string }) => void;
}) {
  const reduceMotion = useReducedMotion();
  const [step, setStep] = useState<1 | 2>(1);
  const [query, setQuery] = useState('');
  const [priority, setPriority] = useState('all');
  const [selected, setSelected] = useState<Candidate | null>(null);
  const [environment, setEnvironment] = useState('staging');
  const [browser, setBrowser] = useState('chromium');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const filtered = candidates.filter(test =>
    `${test.title} ${test.flow}`.toLowerCase().includes(query.toLowerCase()) && (priority === 'all' || test.priority === priority),
  );
  const groups = filtered.reduce<Array<{ flow: string; tests: Candidate[] }>>((acc, test) => {
    const flow = test.flow || 'General';
    const group = acc.find(item => item.flow === flow);
    if (group) group.tests.push(test); else acc.push({ flow, tests: [test] });
    return acc;
  }, []).sort((a, b) => a.flow.localeCompare(b.flow));

  const choose = (test: Candidate) => { setSelected(test); setError(''); setStep(2); };
  const back = () => { setStep(1); setError(''); };

  const launch = async () => {
    if (!selected) return;
    setBusy(true);
    setError('');
    try {
      const response = await fetch(`${API}/test-cases/${selected.id}/run-with-agent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ environment, browser }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || 'Could not start run');
      onRunStarted({ runId: data.runId, testName: selected.title });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not start run');
    } finally {
      setBusy(false);
    }
  };

  if (typeof document === 'undefined') return null;

  return createPortal(
    <div className="ui-backdrop fixed inset-0 z-50 flex items-center justify-center p-4 motion-safe:animate-fade-in" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Execution wizard"
        onClick={event => event.stopPropagation()}
        className="ui-dialog-panel relative flex h-[620px] w-[560px] max-w-[94vw] max-h-[90vh] flex-col overflow-hidden motion-safe:animate-modal-in"
      >
        <div className="flex shrink-0 items-start gap-3 border-b border-border p-4">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent-blue/10 text-accent-blue"><Rocket size={17}/></span>
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-semibold">Execution wizard</h2>
            <p className="mt-0.5 text-xs text-text-secondary">{step === 1 ? 'Choose an approved case to run.' : 'Configure the run and launch the agent.'}</p>
          </div>
          <button onClick={onClose} aria-label="Close" className="ui-icon-button"><X size={18}/></button>
        </div>

        <div className="flex shrink-0 gap-1.5 px-4 pt-3">
          <span className={cn('h-1 flex-1 rounded-full transition-colors', step >= 1 ? 'bg-accent-blue' : 'bg-elevated')} />
          <span className={cn('h-1 flex-1 rounded-full transition-colors', step >= 2 ? 'bg-accent-blue' : 'bg-elevated')} />
        </div>

        <div className="relative min-h-0 flex-1 overflow-hidden">
          <AnimatePresence mode="wait" initial={false}>
            {step === 1 ? (
              <motion.div
                key="step-1"
                initial={reduceMotion ? false : { opacity: 0, x: -16 }}
                animate={{ opacity: 1, x: 0 }}
                exit={reduceMotion ? {} : { opacity: 0, x: -16 }}
                transition={{ duration: 0.2 }}
                className="flex h-full flex-col"
              >
                <div className="shrink-0 space-y-2.5 border-b border-border p-3">
                  <label className="relative block">
                    <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-secondary"/>
                    <input
                      autoFocus
                      value={query}
                      onChange={event => setQuery(event.target.value)}
                      placeholder="Search approved cases…"
                      className="ui-field w-full text-sm"
                      style={{ paddingLeft: '2.25rem', paddingRight: query ? '2.25rem' : undefined }}
                    />
                    {query && <button type="button" aria-label="Clear search" onClick={() => setQuery('')} className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-text-secondary hover:bg-elevated hover:text-text-primary"><X size={13}/></button>}
                  </label>
                  <div className="flex flex-wrap gap-1.5">
                    {['all', 'P0', 'P1', 'P2', 'P3'].map(value => (
                      <button
                        key={value}
                        type="button"
                        onClick={() => setPriority(value)}
                        className={cn(
                          'rounded-full border px-2.5 py-1 text-[11px] font-semibold transition-colors',
                          priority === value ? 'border-accent-blue/40 bg-accent-blue/10 text-accent-blue' : 'border-border text-text-secondary hover:border-border-strong hover:text-text-primary',
                        )}
                      >
                        {value === 'all' ? 'All priorities' : value}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto">
                  {groups.map(group => (
                    <div key={group.flow}>
                      <div className="sticky top-0 z-10 flex items-center gap-2 border-b border-border bg-canvas/90 px-4 py-1.5 backdrop-blur-sm">
                        <span className="text-[10px] font-semibold uppercase tracking-wide text-text-secondary">{group.flow}</span>
                        <span className="tabular-nums text-[10px] text-text-secondary">{group.tests.length}</span>
                      </div>
                      <div className="divide-y divide-border">
                        {group.tests.map((test, idx) => (
                          <button
                            key={test.id}
                            type="button"
                            onClick={() => choose(test)}
                            style={{ animationDelay: `${Math.min(idx, 14) * 18}ms` }}
                            className="flex w-full items-start gap-3 border-l-2 border-l-transparent px-4 py-3 text-left transition motion-safe:animate-row-in hover:translate-x-0.5 hover:border-l-accent-blue hover:bg-elevated/55"
                          >
                            <span className="min-w-0 flex-1">
                              <span className="block text-sm font-medium">{test.title}</span>
                              <span className="mt-1.5 flex flex-wrap items-center gap-2 text-[11px] text-text-secondary">
                                <span className={cn('inline-flex min-w-7 justify-center rounded border px-1 py-0.5 font-mono text-[10px] font-semibold', getPriorityColor(test.priority))}>{test.priority}</span>
                                {test.risk && <span className={cn('capitalize', getRiskColor(test.risk))}>{test.risk} risk</span>}
                              </span>
                            </span>
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                  {!filtered.length && (
                    <p className="p-8 text-center text-sm text-text-secondary">{candidates.length ? 'No cases match these filters.' : 'Approve a case in Test Cases before running it.'}</p>
                  )}
                </div>
              </motion.div>
            ) : (
              <motion.div
                key="step-2"
                initial={reduceMotion ? false : { opacity: 0, x: 16 }}
                animate={{ opacity: 1, x: 0 }}
                exit={reduceMotion ? {} : { opacity: 0, x: 16 }}
                transition={{ duration: 0.2 }}
                className="flex h-full flex-col overflow-y-auto p-5"
              >
                <button type="button" onClick={back} className="mb-3 flex w-fit items-center gap-1 text-xs text-text-secondary transition-colors hover:text-text-primary"><ChevronLeft size={14}/>Choose a different case</button>

                <div className="rounded-xl border border-l-2 border-border border-l-accent-blue bg-accent-blue/5 p-3.5">
                  <p className="flex items-center gap-1.5 text-sm font-medium text-text-primary"><CheckCircle2 size={14} className="text-accent-blue"/>{selected?.title}</p>
                  <p className="mt-1 text-xs text-text-secondary">{selected?.flow || 'General'}</p>
                </div>

                <div className="mt-5 grid grid-cols-2 gap-3">
                  <label className="block text-xs font-semibold text-text-secondary">ENVIRONMENT
                    <select className="ui-field mt-1.5 w-full text-sm" value={environment} onChange={event => setEnvironment(event.target.value)}>
                      <option value="staging">Staging</option>
                      <option value="development">Development</option>
                      <option value="production">Production</option>
                    </select>
                  </label>
                  <label className="block text-xs font-semibold text-text-secondary">BROWSER
                    <select className="ui-field mt-1.5 w-full text-sm" value={browser} onChange={event => setBrowser(event.target.value)}>
                      <option value="chromium">Chromium</option>
                      <option value="firefox">Firefox</option>
                      <option value="webkit">WebKit</option>
                    </select>
                  </label>
                </div>

                <div className="mt-5 space-y-1.5">
                  <button type="button" disabled={busy} onClick={() => void launch()} className="ui-button-primary flex w-full items-center justify-center gap-2 text-sm disabled:opacity-45">
                    <Bot size={15}/>{busy ? 'Starting…' : 'Run with Agent'}
                  </button>
                  {selected?.automation === 'automated' && (
                    <button type="button" disabled title="Script execution is coming soon" className="flex w-full cursor-not-allowed items-center justify-center gap-2 rounded-lg border border-border bg-elevated/40 px-3 py-2.5 text-sm font-medium text-text-secondary opacity-60">
                      <Terminal size={15}/>Run Script
                      <span className="rounded-full bg-elevated px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide">Soon</span>
                    </button>
                  )}
                </div>

                {error && <p role="alert" className="mt-3 text-xs text-danger">{error}</p>}
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 z-20 opacity-[0.035] mix-blend-overlay"
          style={{
            backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='120'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")",
            backgroundSize: '140px 140px',
          }}
        />
      </div>
    </div>,
    document.body,
  );
}
