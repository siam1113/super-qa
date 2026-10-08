'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Radio, Loader2, MessageCircleQuestion, Pause, Play, Square, ChevronDown, ChevronRight,
  Compass, MousePointerClick, Eye, CheckSquare, SquareMinus, ListChecks, ScanSearch, Brain, CheckCircle2,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useLiveExecution, answerLiveQuestion, stopExploration, pauseExploration } from '@/lib/live-execution';
import { useAgentNames } from '@/hooks/useAgentNames';

const QUESTION_TIMEOUT_SECONDS = 30;
// Below this many explored pages, warn that generating now may produce shallow
// cases — not a hard floor, just a heads-up before the user commits to stopping.
const THIN_EXPLORATION_PAGE_THRESHOLD = 2;

// Tool name (from the agentic loop's raw tool call) -> icon, falling back to phase
// for entries with no tool call (thinking/observation narration).
const ACTIVITY_TOOL_ICON: Record<string, typeof Compass> = {
  navigate: Compass, click: MousePointerClick, hover: Eye, check: CheckSquare, uncheck: SquareMinus,
  select: ListChecks, finish_exploration: CheckCircle2,
};
const ACTIVITY_PHASE_ICON: Record<string, typeof Brain> = { thinking: Brain, observation: ScanSearch };

function activityIcon(event: { phase: string; raw?: { tool: string; arguments: Record<string, unknown> } | null }) {
  return (event.raw && ACTIVITY_TOOL_ICON[event.raw.tool]) || ACTIVITY_PHASE_ICON[event.phase] || ScanSearch;
}

function QuestionPanel({ runId, questionId, prompt }: { runId: string; questionId: string; prompt: string }) {
  const [answer, setAnswer] = useState('');
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(QUESTION_TIMEOUT_SECONDS);
  const { qae } = useAgentNames();

  // Resets whenever a new question comes in (keyed by questionId at the call site).
  useEffect(() => {
    setSecondsLeft(QUESTION_TIMEOUT_SECONDS);
    const interval = setInterval(() => setSecondsLeft(value => Math.max(0, value - 1)), 1000);
    return () => clearInterval(interval);
  }, [questionId]);

  const submit = async () => {
    if (!answer.trim() || sending || sent) return;
    setSending(true);
    try {
      await answerLiveQuestion(runId, questionId, answer.trim());
      setSent(true);
    } catch {
      // Exploration's own 30s wait is the real timeout; a failed send here just
      // means the reply arrives late and is ignored server-side — not worth
      // surfacing as an error to the user over what's already a live stream.
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="flex-none rounded-lg border border-accent-purple/40 bg-accent-purple/5 p-3">
      <div className="flex items-center gap-2 text-xs font-semibold text-accent-purple">
        <MessageCircleQuestion size={14}/>
        {qae.name} needs guidance
        <span className="ml-auto font-mono text-[11px] font-normal text-text-secondary">
          {sent ? 'sent' : `${secondsLeft}s`}
        </span>
      </div>
      <p className="mt-1.5 text-xs text-text-primary">{prompt}</p>
      {!sent ? (
        <div className="mt-2 flex gap-1.5">
          <input
            type="text" value={answer} onChange={event => setAnswer(event.target.value)}
            onKeyDown={event => { if (event.key === 'Enter') void submit(); }}
            placeholder="Type your guidance…" autoFocus
            className="ui-field flex-1 text-xs"
          />
          <button type="button" onClick={() => void submit()} disabled={!answer.trim() || sending}
                  className="ui-button-primary px-3 text-xs disabled:opacity-45">
            {sending ? 'Sending…' : 'Send'}
          </button>
        </div>
      ) : (
        <p className="mt-1.5 text-[11px] text-text-secondary">Sent — continuing exploration.</p>
      )}
    </div>
  );
}

function StopConfirmPanel({
  pageCount, onConfirm, onCancel, stopping, stopError,
}: { pageCount: number; onConfirm: () => void; onCancel: () => void; stopping: boolean; stopError: string }) {
  const thin = pageCount < THIN_EXPLORATION_PAGE_THRESHOLD;
  return (
    <div className="flex-none rounded-lg border border-warning/40 bg-warning/5 p-3">
      <div className="flex items-center gap-2 text-xs font-semibold text-warning">
        <Square size={12}/>
        Stop exploring?
      </div>
      <p className="mt-1.5 text-xs text-text-primary">
        Generate test cases from the {pageCount} page{pageCount === 1 ? '' : 's'} explored so far?
      </p>
      {thin && (
        <p className="mt-1 text-[11px] text-warning">
          Only {pageCount} page{pageCount === 1 ? '' : 's'} explored — the generated cases may be shallow since so
          little of the app has been seen. Consider exploring further instead.
        </p>
      )}
      {stopError && <p className="mt-1 text-[11px] text-danger">{stopError}</p>}
      <div className="mt-2 flex gap-1.5">
        <button type="button" onClick={onConfirm} disabled={stopping}
                className="ui-button-primary px-3 text-xs disabled:opacity-45">
          {stopping ? 'Stopping…' : 'Generate from what I have'}
        </button>
        <button type="button" onClick={onCancel} disabled={stopping}
                className="ui-button-secondary px-3 text-xs disabled:opacity-45">
          Keep exploring
        </button>
      </div>
    </div>
  );
}

export function ExplorationLiveViewer({ runId }: { runId: string }) {
  const live = useLiveExecution(runId);
  const { qae } = useAgentNames();
  const [confirmingStop, setConfirmingStop] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [stopError, setStopError] = useState('');
  const [pausing, setPausing] = useState(false);
  const [pagesExpanded, setPagesExpanded] = useState(false);

  const confirmStop = async () => {
    setStopping(true);
    setStopError('');
    try {
      await stopExploration(runId);
      setConfirmingStop(false);
    } catch (reason) {
      setStopError(reason instanceof Error ? reason.message : 'Could not stop exploration');
    } finally {
      setStopping(false);
    }
  };

  const togglePause = async () => {
    setPausing(true);
    try {
      await pauseExploration(runId, !live.paused);
    } catch {
      // The pause button itself reflects live.paused once the 'control' event
      // round-trips back; a failed toggle just leaves that state unchanged.
    } finally {
      setPausing(false);
    }
  };

  const controlsDisabled = live.connection !== 'open' || live.stopRequested;

  if (typeof document === 'undefined') return null;

  return createPortal(
    <div className="ui-backdrop fixed inset-0 z-[60] flex items-center justify-center p-4 motion-safe:animate-fade-in">
      <div
        role="dialog" aria-modal="true" aria-label="Live exploration"
        className="ui-dialog-panel relative flex h-[92vh] w-[96vw] max-w-7xl flex-col overflow-hidden motion-safe:animate-modal-in"
      >
        <div className="flex flex-none items-center gap-2.5 border-b border-border px-4 py-2.5 text-sm">
          <Radio size={14} className={live.connection === 'open' ? 'text-success' : 'text-text-secondary'}/>
          <span className="font-semibold text-text-primary">{qae.name} is exploring the app</span>
          <span className="text-xs text-text-secondary">
            {live.connection === 'connecting' && 'Connecting…'}
            {live.connection === 'open' && (
              live.stopRequested ? 'Stopping — generating from what\'s been explored…'
              : live.paused ? `Paused — visited ${live.steps.length} page${live.steps.length === 1 ? '' : 's'}`
              : live.steps.length === 0 ? 'Starting…' : `Visited ${live.steps.length} page${live.steps.length === 1 ? '' : 's'} so far`
            )}
            {live.connection === 'closed' && 'Reconnecting…'}
            {live.connection === 'not-found' && 'Exploration finished; designing test cases…'}
          </span>
          {live.connection === 'open' && !live.stopRequested && (
            <div className="ml-auto flex flex-none items-center gap-1.5">
              <button
                type="button" onClick={() => void togglePause()} disabled={controlsDisabled || pausing}
                className="ui-button-secondary flex items-center gap-1.5 px-2.5 py-1 text-xs disabled:opacity-45"
              >
                {live.paused ? <Play size={12}/> : <Pause size={12}/>}
                {live.paused ? 'Resume' : 'Pause'}
              </button>
              <button
                type="button" onClick={() => setConfirmingStop(true)} disabled={controlsDisabled || confirmingStop}
                className="ui-button-secondary flex items-center gap-1.5 px-2.5 py-1 text-xs disabled:opacity-45"
              >
                <Square size={12}/>
                Stop
              </button>
            </div>
          )}
        </div>

        <div className="flex min-h-0 flex-1">
          <div className="flex w-[26rem] flex-none flex-col gap-2 overflow-y-auto border-r border-border p-3">
            <p className="flex-none text-xs font-semibold text-text-secondary">WHAT {qae.name.toUpperCase()} IS DOING</p>
            {confirmingStop && (
              <StopConfirmPanel
                pageCount={live.steps.length}
                onConfirm={() => void confirmStop()}
                onCancel={() => { setConfirmingStop(false); setStopError(''); }}
                stopping={stopping}
                stopError={stopError}
              />
            )}
            {live.pendingQuestion && !confirmingStop && (
              <QuestionPanel runId={runId} questionId={live.pendingQuestion.questionId} prompt={live.pendingQuestion.prompt}/>
            )}
            {live.steps.length === 0 && !live.pendingQuestion && !confirmingStop && (
              <p className="flex items-center gap-2 text-xs text-text-secondary"><Loader2 size={12} className="animate-spin"/>Waiting for the first page…</p>
            )}
            {live.agentLog.length > 0 && (
              <>
                <p className="flex-none text-xs font-semibold text-text-secondary">AGENT ACTIVITY</p>
                {live.agentLog.slice(-20).map((event, index) => {
                  const Icon = activityIcon(event);
                  return (
                    <div key={`activity-${index}`} className="flex-none rounded-lg border border-border/60 bg-elevated/20 px-2.5 py-1.5 text-left text-xs">
                      <p className={cn('flex items-center gap-1.5', event.phase === 'thinking' ? 'italic text-text-secondary' : 'text-text-primary')}>
                        <Icon size={12} className={cn('flex-none', event.phase === 'thinking' && 'animate-pulse')}/>
                        <span className="truncate">{event.detail}</span>
                      </p>
                      {event.raw && (
                        <p className="mt-0.5 truncate pl-[18px] font-mono text-[10px] text-text-secondary">
                          {event.raw.tool}({Object.entries(event.raw.arguments).map(([key, val]) => `${key}=${JSON.stringify(val)}`).join(', ')})
                        </p>
                      )}
                    </div>
                  );
                })}
              </>
            )}
            {live.steps.length > 0 && (
              <>
                <button
                  type="button" onClick={() => setPagesExpanded(value => !value)}
                  className="mt-1 flex flex-none items-center gap-1 text-xs font-semibold text-text-secondary hover:text-text-primary"
                >
                  {pagesExpanded ? <ChevronDown size={12}/> : <ChevronRight size={12}/>}
                  PAGES VISITED ({live.steps.length})
                </button>
                {pagesExpanded && live.steps.map(step => (
                  <div key={step.stepId} className="flex-none rounded-lg border border-border bg-elevated/40 px-2.5 py-1.5 text-left text-xs">
                    <p className="truncate font-medium text-text-primary">{step.stepNumber}. {step.description}</p>
                    {step.actualResult && <p className="mt-0.5 line-clamp-2 text-[11px] text-text-secondary">{step.actualResult}</p>}
                  </div>
                ))}
              </>
            )}
          </div>

          <div className="flex min-w-0 flex-1 flex-col">
            <p className={cn('flex-none px-3 pt-3 text-xs font-semibold text-text-secondary')}>BROWSER</p>
            <div className="m-3 flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-lg bg-black/85">
              {live.latestFrame ? (
                <img src={live.latestFrame} alt="Live browser view" className="max-h-full max-w-full object-contain"/>
              ) : (
                <p className="flex items-center gap-2 text-xs text-white/60"><Loader2 size={12} className="animate-spin"/>Waiting for the first page…</p>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
