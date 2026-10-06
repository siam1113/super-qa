'use client';

import { useEffect, useState } from 'react';
import { cn, formatMs } from '@/lib/utils';
import { useLiveExecution, cancelExecution, type LiveStepState } from '@/lib/live-execution';
import {
  X,
  Clock,
  Loader2,
  CheckCircle2,
  XCircle,
  Ban,
  Radio,
  ChevronRight,
  Square,
} from 'lucide-react';

const STEP_ICON: Record<string, { icon: React.ReactNode; tone: string }> = {
  pending: { icon: <Clock size={14} />, tone: 'text-text-secondary' },
  running: { icon: <Loader2 size={14} className="animate-spin" />, tone: 'text-info' },
  passed: { icon: <CheckCircle2 size={14} />, tone: 'text-success' },
  failed: { icon: <XCircle size={14} />, tone: 'text-danger' },
  error: { icon: <XCircle size={14} />, tone: 'text-danger' },
  skipped: { icon: <Ban size={14} />, tone: 'text-text-secondary' },
};

const STATUS_TONE: Record<string, string> = {
  running: 'bg-info/10 text-info',
  passed: 'bg-success/10 text-success',
  failed: 'bg-danger/10 text-danger',
  error: 'bg-danger/10 text-danger',
  cancelled: 'bg-elevated text-text-secondary',
};

function useElapsed(active: boolean) {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    if (!active) return;
    const start = Date.now();
    const interval = setInterval(() => setSeconds(Math.floor((Date.now() - start) / 1000)), 1000);
    return () => clearInterval(interval);
  }, [active]);
  return seconds;
}

function StepRow({ step }: { step: LiveStepState }) {
  const visual = STEP_ICON[step.status] || STEP_ICON.pending;
  const hasActions = step.actions?.length > 0;
  const [expanded, setExpanded] = useState(step.status === 'running');
  useEffect(() => { if (step.status === 'running') setExpanded(true); }, [step.status]);

  return (
    <div
      onClick={() => hasActions && setExpanded(value => !value)}
      className={cn('rounded-none border-l-2 px-2.5 py-2 text-xs', hasActions && 'cursor-pointer', step.status === 'running' ? 'border-l-info bg-info/5' : 'border-l-transparent bg-surface')}
    >
      <div className="flex items-center gap-2">
        <span className={visual.tone}>{visual.icon}</span>
        <span className="flex-1 truncate font-medium text-text-primary">{step.stepNumber}. {step.description}</span>
        {hasActions && <ChevronRight size={12} className={cn('flex-none text-text-secondary transition-transform', expanded && 'rotate-90')} />}
      </div>
      {hasActions && expanded && (
        <div className="mt-1.5 space-y-1 border-l border-border pl-3">
          {step.actions.map(action => (
            <div key={action.actionId} className="flex items-center gap-1.5 text-[11px] text-text-secondary">
              <span className={action.status === 'success' ? 'text-success' : action.status === 'pending' ? 'text-text-secondary' : 'text-danger'}>●</span>
              <span className="truncate">{action.actionType}{action.selector ? ` · ${action.selector}` : ''}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

type BottomTab = 'logs' | 'console' | 'network';

export function LiveExecutionViewer({ runId, testName, onClose, variant = 'modal' }: { runId: string; testName?: string; onClose: () => void; variant?: 'modal' | 'page' }) {
  const live = useLiveExecution(runId);
  const [tab, setTab] = useState<BottomTab>('logs');
  const elapsed = useElapsed(live.status === 'running');
  const [cancelling, setCancelling] = useState(false);
  const [cancelError, setCancelError] = useState('');

  const handleCancel = async () => {
    setCancelling(true);
    setCancelError('');
    try {
      await cancelExecution(runId);
    } catch (error) {
      setCancelError(error instanceof Error ? error.message : 'Could not cancel execution');
      setCancelling(false);
    }
  };

  const logLines = live.steps.flatMap(step =>
    step.actions.map(action => ({
      key: action.actionId,
      text: `${step.stepNumber}. ${step.description} → ${action.actionType}${action.selector ? ` (${action.selector})` : ''} — ${action.status}${action.durationMs ? ` · ${formatMs(action.durationMs)}` : ''}`,
      tone: action.status === 'success' ? 'text-text-secondary' : action.status === 'pending' ? 'text-text-secondary' : 'text-danger',
    })),
  );

  const body = (
    <div
      role={variant === 'modal' ? 'dialog' : undefined}
      aria-modal={variant === 'modal' ? true : undefined}
      aria-label={variant === 'modal' ? 'Live execution' : undefined}
      className={variant === 'page' ? 'flex h-full min-h-0 flex-col overflow-hidden bg-canvas' : 'ui-dialog-panel relative flex h-[92vh] w-[96vw] max-w-7xl flex-col overflow-hidden'}
    >
      {variant === 'page' && (
        <nav aria-label="Breadcrumb" className="flex flex-none items-center gap-2 border-b border-border bg-surface px-5 py-3.5 text-sm">
          <button type="button" onClick={onClose} className="text-text-secondary transition-colors hover:text-text-primary hover:underline">Executions</button>
          <ChevronRight size={14} className="text-text-secondary" />
          <span className="font-semibold text-text-primary">{testName || live.testName || 'Live execution'}</span>
        </nav>
      )}
      <div className="flex flex-none items-center justify-between gap-3 border-b border-border px-4 py-2.5">
        <div className="flex items-center gap-2.5 text-sm">
          <Radio size={14} className={live.connection === 'open' ? 'text-success' : 'text-text-secondary'} />
          {variant === 'modal' && <span className="font-semibold text-text-primary">{testName || live.testName || 'Live execution'}</span>}
          <span className="rounded-full bg-elevated px-2 py-0.5 text-[11px] text-text-secondary">{runId}</span>
          <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-medium capitalize', STATUS_TONE[live.status] || 'bg-elevated text-text-secondary')}>{live.status}</span>
          {live.status === 'running' && <span className="text-[11px] text-text-secondary">{String(Math.floor(elapsed / 60)).padStart(2, '0')}:{String(elapsed % 60).padStart(2, '0')}</span>}
          {cancelError && <span className="text-[11px] text-danger">{cancelError}</span>}
        </div>
        <div className="flex items-center gap-2">
          {live.status === 'running' && (
            <button
              type="button"
              onClick={handleCancel}
              disabled={cancelling}
              className="inline-flex items-center gap-1.5 rounded-lg border border-danger/30 px-2.5 py-1 text-xs font-medium text-danger hover:bg-danger/10 disabled:opacity-50"
            >
              <Square size={12} />
              {cancelling ? 'Cancelling…' : 'Cancel'}
            </button>
          )}
          <button type="button" onClick={onClose} aria-label="Close live execution" className="rounded-lg p-1.5 text-text-secondary hover:bg-elevated hover:text-text-primary">
            <X size={16} />
          </button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        <div className="flex w-[26rem] flex-none flex-col gap-2 overflow-y-auto border-r border-border p-3">
          {live.steps.length === 0 && <p className="text-xs text-text-secondary">Waiting for steps…</p>}
          {live.steps.map(step => <StepRow key={step.stepId} step={step} />)}
        </div>

        <div className="flex min-w-0 flex-1 items-center justify-center bg-black/80">
          {live.connection === 'not-found' ? (
            <p className="text-sm text-text-secondary">This execution is no longer live.</p>
          ) : live.latestFrame ? (
            <img src={live.latestFrame} alt="Live browser view" className="max-h-full max-w-full object-contain" />
          ) : (
            <p className="text-sm text-white/60">Connecting to browser view…</p>
          )}
        </div>
      </div>

      <div className="flex h-56 flex-none flex-col border-t border-border">
        <div className="flex flex-none gap-1 border-b border-border px-3 pt-2">
          {(['logs', 'console', 'network'] as BottomTab[]).map(name => (
            <button
              key={name}
              type="button"
              onClick={() => setTab(name)}
              className={cn('rounded-t-lg px-3 py-1.5 text-xs font-medium capitalize', tab === name ? 'bg-elevated text-text-primary' : 'text-text-secondary hover:text-text-primary')}
            >
              {name}
              {name === 'console' && live.consoleLogs.length > 0 && <span className="ml-1.5 text-text-secondary">{live.consoleLogs.length}</span>}
              {name === 'network' && live.networkRequests.length > 0 && <span className="ml-1.5 text-text-secondary">{live.networkRequests.length}</span>}
            </button>
          ))}
        </div>
        <div className="flex-1 overflow-y-auto px-3 py-2 font-mono text-[11px] leading-5">
          {tab === 'logs' && (logLines.length ? logLines.map(line => <p key={line.key} className={line.tone}>{line.text}</p>) : <p className="text-text-secondary">No actions yet.</p>)}
          {tab === 'console' && (live.consoleLogs.length ? live.consoleLogs.map((log, index) => (
            <p key={index} className={log.level === 'error' ? 'text-danger' : log.level === 'warning' || log.level === 'warn' ? 'text-warning' : 'text-text-secondary'}>
              [{log.level}] {log.message}
            </p>
          )) : <p className="text-text-secondary">No console output yet.</p>)}
          {tab === 'network' && (live.networkRequests.length ? live.networkRequests.map((request, index) => (
            <p key={index} className="text-text-secondary">
              <span className="text-text-primary">{request.method}</span> {request.status ?? '…'} — {request.url}
            </p>
          )) : <p className="text-text-secondary">No network activity yet.</p>)}
        </div>
      </div>
    </div>
  );

  if (variant === 'page') return body;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="ui-backdrop absolute inset-0" onClick={onClose} />
      {body}
    </div>
  );
}
