'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Sparkles, X, ChevronLeft, PenLine, Ticket, Compass, Loader2, AlertTriangle,
  Minus, Plus, ExternalLink, History,
} from 'lucide-react';
import { cn, getPriorityColor, getRiskColor } from '@/lib/utils';
import type { Environment, TestCase } from '@/lib/types';
import { RunsPanel, useUnreviewedRunCount } from './RunsPanel';
import { ExplorationLiveViewer } from './ExplorationLiveViewer';
import { useAgentNames } from '@/hooks/useAgentNames';

const ROOT = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

type Method = 'instruction' | 'ticket' | 'exploration';
type Phase = 'choose' | 'configure' | 'generating' | 'review';

type TicketDoc = { id: string; title: string; url: string | null; externalId: string };
type IntegrationSource = { id: string; name: string; type: string };
type Proposal = { title: string; steps: Array<{ action: string; expected: string }>; priority: string; risk: string; flow: string; tags: string[] };

async function readJson(response: Response) {
  try { return await response.json(); } catch { return {}; }
}

export function GenerateTestCasesWizardModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (cases: TestCase[]) => void;
}) {
  const [method, setMethod] = useState<Method | null>(null);
  const [phase, setPhase] = useState<Phase>('choose');
  const [viewingRuns, setViewingRuns] = useState(false);
  const unreviewedRuns = useUnreviewedRunCount('generate');
  const [count, setCount] = useState(3);
  const { qae } = useAgentNames();

  const [instructions, setInstructions] = useState('');

  const [sources, setSources] = useState<IntegrationSource[] | null>(null);
  const [sourcesLoading, setSourcesLoading] = useState(false);
  const [sourcesError, setSourcesError] = useState('');
  const [selectedSourceId, setSelectedSourceId] = useState<string | null>(null);
  const [tickets, setTickets] = useState<TicketDoc[] | null>(null);
  const [ticketsLoading, setTicketsLoading] = useState(false);
  const [ticketsError, setTicketsError] = useState('');
  const [ticketQuery, setTicketQuery] = useState('');
  const [selectedTicket, setSelectedTicket] = useState<TicketDoc | null>(null);

  const [environments, setEnvironments] = useState<Environment[] | null>(null);
  const [environmentsLoading, setEnvironmentsLoading] = useState(false);
  const [environmentsError, setEnvironmentsError] = useState('');
  const [selectedEnvironmentId, setSelectedEnvironmentId] = useState<string | null>(null);
  const [explorationRunId, setExplorationRunId] = useState<string | null>(null);
  const [explorationStartPath, setExplorationStartPath] = useState('');
  const [explorationFocus, setExplorationFocus] = useState('');
  const [explorationLevel, setExplorationLevel] = useState<'quick' | 'standard' | 'deep' | 'exhaustive'>('standard');
  const [explorationAutoCount, setExplorationAutoCount] = useState(true);

  const [generateError, setGenerateError] = useState('');
  const [proposals, setProposals] = useState<Proposal[] | null>(null);
  const [selectedIdx, setSelectedIdx] = useState<Set<number>>(new Set());
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState('');

  const [queueError, setQueueError] = useState('');
  const [queuing, setQueuing] = useState(false);

  useEffect(() => {
    if (method !== 'ticket' || sources !== null) return;
    setSourcesLoading(true);
    setSourcesError('');
    fetch(`${ROOT}/api/sources`)
      .then(async response => { if (!response.ok) throw new Error('Could not load integrations'); return response.json(); })
      .then((list: IntegrationSource[]) => setSources(list.filter(source => source.type === 'jira')))
      .catch(() => setSourcesError('Could not load connected integrations.'))
      .finally(() => setSourcesLoading(false));
  }, [method, sources]);

  useEffect(() => {
    if (method !== 'exploration' || environments !== null) return;
    setEnvironmentsLoading(true);
    setEnvironmentsError('');
    fetch(`${ROOT}/api/environments`)
      .then(async response => { if (!response.ok) throw new Error('Could not load environments'); return response.json(); })
      .then((list: Environment[]) => {
        setEnvironments(list);
        const withBaseUrl = list.find(environment => environment.isDefault && environment.baseUrl) || list.find(environment => environment.baseUrl);
        if (withBaseUrl) setSelectedEnvironmentId(withBaseUrl.id);
      })
      .catch(() => setEnvironmentsError('Could not load environments.'))
      .finally(() => setEnvironmentsLoading(false));
  }, [method, environments]);

  useEffect(() => {
    if (!selectedSourceId) return;
    setTickets(null);
    setTicketsError('');
    setTicketsLoading(true);
    fetch(`${ROOT}/api/documents?sourceId=${encodeURIComponent(selectedSourceId)}&type=issue&limit=50`)
      .then(async response => { if (!response.ok) throw new Error('Could not load tickets'); return response.json(); })
      .then(data => setTickets(data.documents || []))
      .catch(() => setTicketsError('Could not load tickets from this integration.'))
      .finally(() => setTicketsLoading(false));
  }, [selectedSourceId]);

  const chooseMethod = (value: Method) => { setMethod(value); setPhase('configure'); };
  const backToChoose = () => { setMethod(null); setPhase('choose'); setSelectedSourceId(null); setSelectedTicket(null); setSelectedEnvironmentId(null); setExplorationRunId(null); setExplorationStartPath(''); setExplorationFocus(''); setExplorationLevel('standard'); setExplorationAutoCount(true); setGenerateError(''); };
  const backToConfigure = () => { setPhase('configure'); setGenerateError(''); setProposals(null); setExplorationRunId(null); };

  const buildRequestBody = (runId?: string) => method === 'instruction'
    ? { mode: 'instruction', instructions: instructions.trim(), count }
    : method === 'ticket'
      ? { mode: 'ticket', documentId: selectedTicket?.id, count }
      : {
          mode: 'exploration', count: explorationAutoCount ? undefined : count, environmentId: selectedEnvironmentId || undefined,
          explorationRunId: runId, explorationStartPath: explorationStartPath.trim() || undefined,
          instructions: explorationFocus.trim() || undefined, explorationLevel,
        };

  const generate = async () => {
    setGenerateError('');
    setPhase('generating');
    // Generated up front (not read back from state) so the live viewer can open
    // its websocket using the same id passed to this request's explore_app run.
    const runId = method === 'exploration' ? crypto.randomUUID() : undefined;
    setExplorationRunId(runId || null);
    try {
      const response = await fetch(`${ROOT}/api/qa/test-cases/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildRequestBody(runId)),
      });
      const data = await readJson(response);
      if (!response.ok) throw new Error(data.message || `${qae.name} could not generate test cases`);
      const nextProposals = (data.proposals || []) as Proposal[];
      setProposals(nextProposals);
      setSelectedIdx(new Set(nextProposals.map((_, index) => index)));
      setPhase('review');
    } catch (reason) {
      setGenerateError(reason instanceof Error ? reason.message : `${qae.name} could not generate test cases`);
      setPhase('review');
    }
  };

  const runInBackground = async () => {
    setQueueError('');
    setQueuing(true);
    try {
      const response = await fetch(`${ROOT}/api/qa/test-cases/generate/runs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildRequestBody()),
      });
      const data = await readJson(response);
      if (!response.ok) throw new Error(data.message || 'Could not queue this run');
      setMethod(null);
      setPhase('choose');
      setViewingRuns(true);
    } catch (reason) {
      setQueueError(reason instanceof Error ? reason.message : 'Could not queue this run');
    } finally {
      setQueuing(false);
    }
  };

  const toggleProposal = (index: number) => setSelectedIdx(previous => {
    const next = new Set(previous);
    if (next.has(index)) next.delete(index); else next.add(index);
    return next;
  });

  const addSelected = async () => {
    if (!proposals) return;
    setCreating(true);
    setCreateError('');
    try {
      const chosen = proposals.filter((_, index) => selectedIdx.has(index));
      const created: TestCase[] = [];
      for (const proposal of chosen) {
        const response = await fetch(`${ROOT}/api/qa/test-cases`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: proposal.title,
            steps: proposal.steps,
            priority: proposal.priority,
            risk: proposal.risk,
            flow: proposal.flow || undefined,
            tags: proposal.tags,
          }),
        });
        const data = await readJson(response);
        if (!response.ok) throw new Error(data.message || `Could not add "${proposal.title}"`);
        created.push(data as TestCase);
      }
      onCreated(created);
      onClose();
    } catch (reason) {
      setCreateError(reason instanceof Error ? reason.message : 'Could not add the selected cases');
    } finally {
      setCreating(false);
    }
  };

  const filteredTickets = (tickets || []).filter(ticket => !ticketQuery || `${ticket.title} ${ticket.externalId}`.toLowerCase().includes(ticketQuery.toLowerCase()));

  if (typeof document === 'undefined') return null;

  return createPortal(
    <div className="ui-backdrop fixed inset-0 z-50 flex items-center justify-center p-4 motion-safe:animate-fade-in" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Generate test cases"
        onClick={event => event.stopPropagation()}
        className="ui-dialog-panel relative flex h-[640px] w-[600px] max-w-[94vw] max-h-[90vh] flex-col overflow-hidden motion-safe:animate-modal-in"
      >
        <div className="flex shrink-0 items-start gap-3 border-b border-border p-4">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent-purple/10 text-accent-purple"><Sparkles size={17}/></span>
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-semibold">Generate test cases</h2>
            <p className="mt-0.5 text-xs text-text-secondary">
              {viewingRuns && 'Background generate requests and their results.'}
              {!viewingRuns && phase === 'choose' && `Choose how ${qae.name} should design the cases.`}
              {!viewingRuns && phase === 'configure' && method === 'instruction' && 'Describe what to test, in your own words.'}
              {!viewingRuns && phase === 'configure' && method === 'ticket' && 'Pick a ticket to design cases from.'}
              {!viewingRuns && phase === 'configure' && method === 'exploration' && `Pick an environment for ${qae.name} to explore, then look for coverage gaps.`}
              {!viewingRuns && phase === 'generating' && `${qae.name} is designing test cases…`}
              {!viewingRuns && phase === 'review' && 'Review the proposals, then add the ones you want.'}
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
            <RunsPanel kind="generate" onCreated={onCreated} onApplied={() => {}}/>
          ) : (
          <>
            {phase === 'choose' && (
              <div className="motion-safe:animate-fade-in grid gap-3 p-5">
                <MethodCard icon={<PenLine size={18}/>} title="Plain instruction" description={`Tell ${qae.name} what to test in your own words.`} onClick={() => chooseMethod('instruction')}/>
                <MethodCard icon={<Ticket size={18}/>} title="From a ticket" description="Pick a synced Jira issue and design cases from its requirements." onClick={() => chooseMethod('ticket')}/>
                <MethodCard icon={<Compass size={18}/>} title="From exploration" description={`${qae.name} explores your catalogued flows and proposes cases for the weakest coverage.`} onClick={() => chooseMethod('exploration')}/>
              </div>
            )}

            {phase === 'configure' && method === 'instruction' && (
              <div className="motion-safe:animate-fade-in flex h-full flex-col p-5">
                <BackLink onClick={backToChoose}/>
                <label className="mt-2 block text-xs font-semibold text-text-secondary">WHAT SHOULD BE TESTED?
                  <textarea autoFocus value={instructions} onChange={event => setInstructions(event.target.value)} rows={8} placeholder="e.g. Verify that a user can reset their password via email, including expired and reused links." className="ui-field mt-1.5 w-full resize-none text-sm"/>
                </label>
                <CountStepper count={count} onChange={setCount}/>
                <div className="mt-auto space-y-1.5 pt-4">
                  <button type="button" disabled={!instructions.trim()} onClick={() => void generate()} className="ui-button-primary w-full disabled:opacity-45">Generate</button>
                  <RunInBackgroundButton disabled={!instructions.trim()} queuing={queuing} onClick={() => void runInBackground()}/>
                  {queueError && <p role="alert" className="text-xs text-danger">{queueError}</p>}
                </div>
              </div>
            )}

            {phase === 'configure' && method === 'ticket' && (
              <div className="motion-safe:animate-fade-in flex h-full flex-col">
                <div className="p-5 pb-0"><BackLink onClick={selectedSourceId ? () => { setSelectedSourceId(null); setSelectedTicket(null); } : backToChoose}/></div>
                {!selectedSourceId ? (
                  <div className="flex-1 overflow-y-auto px-5 pb-5">
                    {sourcesLoading && <CenteredSpinner label="Loading your integrations…"/>}
                    {!sourcesLoading && sourcesError && <ErrorNote message={sourcesError}/>}
                    {!sourcesLoading && !sourcesError && sources && sources.length === 0 && (
                      <EmptyNote title="No Jira project connected" detail="Connect Jira from Integrations to design cases straight from tickets."/>
                    )}
                    {!sourcesLoading && sources && sources.length > 0 && (
                      <div className="mt-2 space-y-1.5">
                        {sources.map(source => (
                          <button key={source.id} type="button" onClick={() => setSelectedSourceId(source.id)} className="flex w-full items-center justify-between rounded-lg border border-border px-3.5 py-2.5 text-left text-sm transition-colors hover:border-border-strong hover:bg-elevated/55">
                            <span className="font-medium">{source.name}</span>
                            <span className="text-[10px] uppercase tracking-wide text-text-secondary">{source.type}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                ) : !selectedTicket ? (
                  <div className="flex h-full flex-col">
                    <div className="shrink-0 px-5 pb-3">
                      <input autoFocus value={ticketQuery} onChange={event => setTicketQuery(event.target.value)} placeholder="Search tickets…" className="ui-field w-full text-sm"/>
                    </div>
                    <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-5">
                      {ticketsLoading && <CenteredSpinner label="Loading tickets…"/>}
                      {!ticketsLoading && ticketsError && <ErrorNote message={ticketsError}/>}
                      {!ticketsLoading && tickets && filteredTickets.length === 0 && <EmptyNote title="No tickets found" detail="Sync this integration, or try a different search."/>}
                      {!ticketsLoading && filteredTickets.length > 0 && (
                        <div className="divide-y divide-border">
                          {filteredTickets.map(ticket => (
                            <button key={ticket.id} type="button" onClick={() => setSelectedTicket(ticket)} className="flex w-full items-start gap-2 px-1 py-2.5 text-left transition-colors hover:bg-elevated/55">
                              <span className="min-w-0 flex-1">
                                <span className="block text-sm font-medium">{ticket.title}</span>
                                <span className="mt-0.5 block font-mono text-[10px] text-text-secondary">{ticket.externalId}</span>
                              </span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="flex h-full flex-col p-5 pt-0">
                    <button type="button" onClick={() => setSelectedTicket(null)} className="mb-3 flex w-fit items-center gap-1 text-xs text-text-secondary transition-colors hover:text-text-primary"><ChevronLeft size={14}/>Choose a different ticket</button>
                    <div className="rounded-xl border border-l-2 border-border border-l-accent-blue bg-accent-blue/5 p-3.5">
                      <p className="text-sm font-medium text-text-primary">{selectedTicket.title}</p>
                      <p className="mt-1 flex items-center gap-1 font-mono text-[11px] text-text-secondary">{selectedTicket.externalId}{selectedTicket.url && <a href={selectedTicket.url} target="_blank" rel="noreferrer" onClick={event => event.stopPropagation()} className="inline-flex items-center gap-0.5 text-accent-blue hover:underline"><ExternalLink size={10}/>Open</a>}</p>
                    </div>
                    <CountStepper count={count} onChange={setCount}/>
                    <div className="mt-auto space-y-1.5 pt-4">
                      <button type="button" onClick={() => void generate()} className="ui-button-primary w-full">Generate from this ticket</button>
                      <RunInBackgroundButton queuing={queuing} onClick={() => void runInBackground()}/>
                      {queueError && <p role="alert" className="text-xs text-danger">{queueError}</p>}
                    </div>
                  </div>
                )}
              </div>
            )}

            {phase === 'configure' && method === 'exploration' && (
              <div className="motion-safe:animate-fade-in flex h-full flex-col p-5">
                <BackLink onClick={backToChoose}/>
                <div className="mt-3 rounded-xl border border-border bg-elevated/50 p-4 text-sm text-text-secondary">
                  {qae.name} will explore the selected environment's live app, then propose cases for the areas with the weakest coverage.
                </div>
                <label className="mt-3 block text-xs font-semibold text-text-secondary">ENVIRONMENT TO EXPLORE
                  {environmentsLoading && <span className="mt-1.5 flex items-center gap-2 text-xs font-normal text-text-secondary"><Loader2 size={13} className="animate-spin"/>Loading environments…</span>}
                  {!environmentsLoading && environmentsError && <span className="mt-1.5 block text-xs font-normal text-danger">{environmentsError}</span>}
                  {!environmentsLoading && environments && environments.length === 0 && (
                    <span className="mt-1.5 block text-xs font-normal text-text-secondary">No environments configured. {qae.name} will fall back to catalogued coverage only — <a href="/environments" target="_blank" rel="noreferrer" className="text-accent-blue hover:underline">add one</a> to explore the real app.</span>
                  )}
                  {!environmentsLoading && environments && environments.length > 0 && (
                    <select value={selectedEnvironmentId || ''} onChange={event => setSelectedEnvironmentId(event.target.value || null)} className="ui-field mt-1.5 w-full text-sm">
                      <option value="">Coverage stats only (no live exploration)</option>
                      {environments.map(environment => (
                        <option key={environment.id} value={environment.id} disabled={!environment.baseUrl}>
                          {environment.name}{!environment.baseUrl ? ' (no base URL set)' : ''}
                        </option>
                      ))}
                    </select>
                  )}
                </label>
                <label className="mt-3 block text-xs font-semibold text-text-secondary">START PATH (OPTIONAL)
                  <input type="text" value={explorationStartPath} onChange={event => setExplorationStartPath(event.target.value)} placeholder="/checkout" className="ui-field mt-1.5 w-full text-sm"/>
                  <span className="mt-1 block text-xs font-normal text-text-secondary">Leave blank to start from the environment's base URL.</span>
                </label>
                <label className="mt-3 block text-xs font-semibold text-text-secondary">FOCUS (OPTIONAL)
                  <textarea value={explorationFocus} onChange={event => setExplorationFocus(event.target.value)} rows={2} placeholder="e.g. focus on the checkout and payment flow" className="ui-field mt-1.5 w-full resize-none text-sm"/>
                  <span className="mt-1 block text-xs font-normal text-text-secondary">Tell {qae.name} what to look for — a feature, tab, or flow — and it will navigate to and interact with that area specifically. Leave it blank and {qae.name} will tour the whole app broadly on its own, like a human tester doing a first pass — giving it direction usually finds more relevant issues.</span>
                </label>
                <div className="mt-3">
                  <span className="block text-xs font-semibold text-text-secondary">EXPLORATION DEPTH</span>
                  <div className="mt-1.5 grid grid-cols-4 gap-1 rounded-lg border border-border p-1">
                    {(['quick', 'standard', 'deep', 'exhaustive'] as const).map(level => (
                      <button
                        key={level} type="button" onClick={() => setExplorationLevel(level)}
                        className={cn('rounded-md px-2 py-1.5 text-xs font-medium capitalize transition-colors',
                          explorationLevel === level ? 'bg-accent text-white' : 'text-text-secondary hover:text-text-primary')}
                      >
                        {level}
                      </button>
                    ))}
                  </div>
                  <span className="mt-1 block text-xs font-normal text-text-secondary">
                    {{
                      quick: 'Fast skim — confirms the area exists without trying its controls. Best for a quick sanity pass.',
                      standard: 'Normal pass — opens the area and tries a couple of its key controls. Good default.',
                      deep: 'Thorough — works through sub-tabs, filters, and secondary panels before moving on.',
                      exhaustive: 'Max effort — tries every control it finds in the relevant area. Slowest option.',
                    }[explorationLevel]}
                  </span>
                </div>
                <div className="mt-3 flex items-center justify-between rounded-lg border border-border px-3.5 py-2.5">
                  <span className="text-xs font-semibold text-text-secondary">HOW MANY CASES</span>
                  <div className="flex items-center gap-2">
                    <button type="button" onClick={() => setExplorationAutoCount(true)}
                            className={cn('rounded px-2 py-1 text-xs font-medium', explorationAutoCount ? 'bg-accent-purple/15 text-accent-purple' : 'text-text-secondary hover:text-text-primary')}>
                      Let {qae.name} decide
                    </button>
                    {explorationAutoCount ? (
                      <button type="button" onClick={() => setExplorationAutoCount(false)} className="text-xs text-text-secondary hover:text-text-primary">Set a number</button>
                    ) : (
                      <div className="flex items-center gap-2">
                        <button type="button" aria-label="Fewer cases" disabled={count <= 1} onClick={() => setCount(Math.max(1, count - 1))} className="ui-icon-button disabled:opacity-30"><Minus size={14}/></button>
                        <span className="w-5 text-center text-sm font-semibold tabular-nums">{count}</span>
                        <button type="button" aria-label="More cases" disabled={count >= 8} onClick={() => setCount(Math.min(8, count + 1))} className="ui-icon-button disabled:opacity-30"><Plus size={14}/></button>
                      </div>
                    )}
                  </div>
                </div>
                <div className="mt-auto space-y-1.5 pt-4">
                  <button type="button" onClick={() => void generate()} className="ui-button-primary w-full">Explore & generate</button>
                  <RunInBackgroundButton queuing={queuing} onClick={() => void runInBackground()}/>
                  {queueError && <p role="alert" className="text-xs text-danger">{queueError}</p>}
                </div>
              </div>
            )}

            {phase === 'generating' && (
              method === 'exploration' && explorationRunId ? (
                <ExplorationLiveViewer runId={explorationRunId}/>
              ) : (
                <div className="motion-safe:animate-fade-in flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
                  <Loader2 size={28} className="animate-spin text-accent-purple"/>
                  <p className="text-sm font-medium">{qae.name} is designing test cases…</p>
                </div>
              )
            )}

            {phase === 'review' && (
              <div className="motion-safe:animate-fade-in flex h-full flex-col">
                {generateError ? (
                  <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
                    <AlertTriangle size={24} className="text-danger"/>
                    <p className="text-sm font-medium">{generateError}</p>
                    <button type="button" onClick={backToConfigure} className="ui-button-primary">Try again</button>
                  </div>
                ) : (
                  <>
                    <div className="min-h-0 flex-1 overflow-y-auto p-4">
                      <div className="space-y-2">
                        {proposals?.map((proposal, index) => (
                          <label key={index} className={cn('flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors', selectedIdx.has(index) ? 'border-accent-blue/35 bg-accent-blue/5' : 'border-border hover:bg-elevated/40')}>
                            <input type="checkbox" checked={selectedIdx.has(index)} onChange={() => toggleProposal(index)} className="mt-1 rounded border-border"/>
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
                      {createError && <p role="alert" className="mb-2 text-xs text-danger">{createError}</p>}
                      <button type="button" disabled={creating || selectedIdx.size === 0} onClick={() => void addSelected()} className="ui-button-primary w-full disabled:opacity-45">
                        {creating ? 'Adding…' : `Add ${selectedIdx.size} to library`}
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

function RunInBackgroundButton({ disabled, queuing, onClick }: { disabled?: boolean; queuing: boolean; onClick: () => void }) {
  return <button type="button" disabled={disabled || queuing} onClick={onClick} className="w-full rounded-lg border border-border px-3 py-2.5 text-sm font-medium text-text-secondary transition-colors hover:border-border-strong hover:bg-elevated disabled:opacity-45">{queuing ? 'Queuing…' : 'Run in background'}</button>;
}

function MethodCard({ icon, title, description, onClick }: { icon: React.ReactNode; title: string; description: string; onClick: () => void }) {
  return <button type="button" onClick={onClick} className="flex items-start gap-3 rounded-xl border border-border p-4 text-left transition-colors hover:border-accent-blue/40 hover:bg-elevated/55">
    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent-blue/10 text-accent-blue">{icon}</span>
    <span className="min-w-0"><span className="block text-sm font-semibold">{title}</span><span className="mt-0.5 block text-xs text-text-secondary">{description}</span></span>
  </button>;
}

function BackLink({ onClick }: { onClick: () => void }) {
  return <button type="button" onClick={onClick} className="flex w-fit items-center gap-1 text-xs text-text-secondary transition-colors hover:text-text-primary"><ChevronLeft size={14}/>Back</button>;
}

function CountStepper({ count, onChange }: { count: number; onChange: (value: number) => void }) {
  return <div className="mt-4 flex items-center justify-between rounded-lg border border-border px-3.5 py-2.5">
    <span className="text-xs font-semibold text-text-secondary">HOW MANY CASES</span>
    <div className="flex items-center gap-3">
      <button type="button" aria-label="Fewer cases" disabled={count <= 1} onClick={() => onChange(Math.max(1, count - 1))} className="ui-icon-button disabled:opacity-30"><Minus size={14}/></button>
      <span className="w-5 text-center text-sm font-semibold tabular-nums">{count}</span>
      <button type="button" aria-label="More cases" disabled={count >= 8} onClick={() => onChange(Math.min(8, count + 1))} className="ui-icon-button disabled:opacity-30"><Plus size={14}/></button>
    </div>
  </div>;
}

function CenteredSpinner({ label }: { label: string }) {
  return <div className="flex flex-col items-center gap-2 py-10 text-center text-text-secondary"><Loader2 size={20} className="animate-spin"/><p className="text-sm">{label}</p></div>;
}

function ErrorNote({ message }: { message: string }) {
  return <div className="flex items-start gap-2 rounded-lg bg-danger/10 p-3 text-sm text-danger"><AlertTriangle size={15} className="mt-0.5 shrink-0"/>{message}</div>;
}

function EmptyNote({ title, detail }: { title: string; detail: string }) {
  return <div className="rounded-lg border border-dashed border-border p-5 text-center"><p className="text-sm font-medium">{title}</p><p className="mt-1 text-xs text-text-secondary">{detail}</p></div>;
}
