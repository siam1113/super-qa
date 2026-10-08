'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Radio, Loader2, MessageCircleQuestion } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useLiveExecution, answerLiveQuestion } from '@/lib/live-execution';
import { useAgentNames } from '@/hooks/useAgentNames';

const QUESTION_TIMEOUT_SECONDS = 30;

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

export function ExplorationLiveViewer({ runId }: { runId: string }) {
  const live = useLiveExecution(runId);
  const { qae } = useAgentNames();

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
            {live.connection === 'open' && (live.steps.length === 0 ? 'Starting…' : `Visited ${live.steps.length} page${live.steps.length === 1 ? '' : 's'} so far`)}
            {live.connection === 'closed' && 'Reconnecting…'}
            {live.connection === 'not-found' && 'Exploration finished; designing test cases…'}
          </span>
        </div>

        <div className="flex min-h-0 flex-1">
          <div className="flex w-[26rem] flex-none flex-col gap-2 overflow-y-auto border-r border-border p-3">
            <p className="flex-none text-xs font-semibold text-text-secondary">WHAT {qae.name.toUpperCase()} IS DOING</p>
            {live.pendingQuestion && (
              <QuestionPanel runId={runId} questionId={live.pendingQuestion.questionId} prompt={live.pendingQuestion.prompt}/>
            )}
            {live.steps.length === 0 && !live.pendingQuestion && (
              <p className="flex items-center gap-2 text-xs text-text-secondary"><Loader2 size={12} className="animate-spin"/>Waiting for the first page…</p>
            )}
            {live.steps.map(step => (
              <div key={step.stepId} className="flex-none rounded-lg border border-border bg-elevated/40 px-2.5 py-1.5 text-left text-xs">
                <p className="truncate font-medium text-text-primary">{step.stepNumber}. {step.description}</p>
                {step.actualResult && <p className="mt-0.5 line-clamp-2 text-[11px] text-text-secondary">{step.actualResult}</p>}
              </div>
            ))}
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
