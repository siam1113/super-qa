'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { cn, formatDuration, formatMs } from '@/lib/utils';
import {
  ChevronRight,
  ChevronLeft,
  Clock,
  CheckCircle2,
  XCircle,
  Ban,
  AlertTriangle,
  Video,
  Activity,
  Images,
  History as HistoryIcon,
  Sparkles,
  ListChecks,
  Monitor,
  Globe2,
  FileQuestion,
  MousePointerClick,
  Layers,
  Terminal,
  X,
  Loader2,
  Table2,
  LayoutGrid,
  ChevronDown,
  ChevronUp,
  FileText,
  FileCode2,
  Image as ImageIcon,
  Film,
  Type as TypeIcon,
  ArrowLeftRight,
  File as FileIcon,
  Info,
  Copy,
  Check,
} from 'lucide-react';

const API = `${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000'}/api`;
const AGENTS_URL = process.env.NEXT_PUBLIC_AGENTS_URL || 'http://localhost:8010';

type TokensUsed = { input?: number | null; output?: number | null; total?: number | null };

type AgentAction = {
  actionId?: string;
  actionType?: string;
  selector?: string | null;
  status?: string;
  durationMs?: number;
  errorMessage?: string | null;
  screenshotBefore?: string | null;
  screenshotAfter?: string | null;
  input?: Record<string, unknown> | null;
  output?: Record<string, unknown> | null;
  tokensUsed?: TokensUsed | null;
};

type AgentStep = {
  stepId?: string;
  stepNumber?: number;
  description?: string;
  status?: string;
  expectedResult?: string | null;
  actualResult?: string | null;
  errorMessage?: string | null;
  durationMs?: number;
  startedAt?: string | null;
  completedAt?: string | null;
  actions?: AgentAction[];
};

type HumanStep = { actual: string; passed: boolean; evidence: string };

type NetworkRequestRecord = {
  url: string;
  method: string;
  resourceType?: string | null;
  status: number | null;
  timestamp: string;
  requestHeaders?: Record<string, string> | null;
  responseHeaders?: Record<string, string> | null;
  requestBody?: string | null;
  responseBody?: string | null;
  failureText?: string | null;
};

export type ExecutionRecord = {
  id: string;
  runId: string;
  testId: string;
  testName: string;
  status: string;
  environment: string;
  browser: string;
  duration: number | null;
  createdAt: string;
  completedAt?: string | null;
  mode?: string;
  agentRunId?: string | null;
  snapshot?: { steps?: Array<{ action: string; expected: string }> };
  result?: {
    steps?: Array<AgentStep | HumanStep>;
    errorMessage?: string | null;
    videoKey?: string | null;
    consoleLogs?: Array<{ level: string; message: string; timestamp: string }>;
    networkRequests?: Array<NetworkRequestRecord>;
    reporter?: string;
  } | Record<string, unknown> | null;
};

export type NormalizedStep = {
  number: number;
  description: string;
  expected?: string | null;
  actual?: string | null;
  status: string;
  errorMessage?: string | null;
  durationMs?: number;
  startedAt?: string | null;
  completedAt?: string | null;
  actions: AgentAction[];
};

const STATUS_TONE: Record<string, string> = {
  passed: 'bg-success/10 text-success ring-success/15',
  failed: 'bg-danger/10 text-danger ring-danger/15',
  error: 'bg-danger/10 text-danger ring-danger/15',
  running: 'bg-info/10 text-info ring-info/15',
  pending: 'bg-warning/10 text-warning ring-warning/15',
  cancelled: 'bg-elevated text-text-secondary ring-border',
};

export const STEP_ACCENT: Record<string, string> = {
  passed: 'border-l-success',
  failed: 'border-l-danger',
  error: 'border-l-danger',
  running: 'border-l-info',
  pending: 'border-l-border',
  skipped: 'border-l-border',
};

const STEP_ICON: Record<string, { icon: React.ReactNode; tone: string }> = {
  pending: { icon: <Clock size={13} />, tone: 'text-text-secondary' },
  running: { icon: <Clock size={13} className="animate-spin" />, tone: 'text-info' },
  passed: { icon: <CheckCircle2 size={13} />, tone: 'text-success' },
  failed: { icon: <XCircle size={13} />, tone: 'text-danger' },
  error: { icon: <XCircle size={13} />, tone: 'text-danger' },
  skipped: { icon: <Ban size={13} />, tone: 'text-text-secondary' },
};

export function StatusPill({ status }: { status: string }) {
  const tone = STATUS_TONE[status] || 'bg-elevated text-text-secondary ring-border';
  return <span className={cn('inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold capitalize ring-1 ring-inset', tone)}>{status.replaceAll('_', ' ')}</span>;
}

function EmptyNote({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2.5 rounded-none border border-dashed border-border px-4 py-10 text-center">
      <span className="grid h-10 w-10 place-items-center rounded-none bg-elevated text-text-secondary">{icon}</span>
      <p className="max-w-xs text-xs leading-5 text-text-secondary">{children}</p>
    </div>
  );
}

function isHumanStep(step: AgentStep | HumanStep): step is HumanStep {
  return typeof (step as HumanStep).passed === 'boolean' && typeof (step as HumanStep).actual === 'string';
}

export function normalizeSteps(execution: ExecutionRecord): { steps: NormalizedStep[]; hasTrace: boolean } {
  const result = execution.result as ExecutionRecord['result'];
  const snapshotSteps = execution.snapshot?.steps || [];
  const resultSteps = (result && Array.isArray((result as any).steps) ? (result as any).steps : null) as Array<AgentStep | HumanStep> | null;

  if (!resultSteps || !resultSteps.length) {
    return { steps: snapshotSteps.map((step, index) => ({ number: index + 1, description: step.action, expected: step.expected, status: 'pending', actions: [] })), hasTrace: false };
  }

  if (isHumanStep(resultSteps[0])) {
    return {
      hasTrace: false,
      steps: (resultSteps as HumanStep[]).map((step, index) => ({
        number: index + 1,
        description: snapshotSteps[index]?.action || `Step ${index + 1}`,
        expected: snapshotSteps[index]?.expected,
        actual: step.actual,
        status: step.passed ? 'passed' : 'failed',
        errorMessage: step.passed ? null : `${step.actual}${step.evidence ? ` (evidence: ${step.evidence})` : ''}`,
        actions: [],
      })),
    };
  }

  const steps = (resultSteps as AgentStep[]).map((step, index) => ({
    number: step.stepNumber ?? index + 1,
    description: step.description || snapshotSteps[index]?.action || `Step ${index + 1}`,
    expected: step.expectedResult ?? snapshotSteps[index]?.expected,
    actual: step.actualResult,
    status: step.status || 'pending',
    errorMessage: step.errorMessage,
    durationMs: step.durationMs,
    startedAt: step.startedAt,
    completedAt: step.completedAt,
    actions: step.actions || [],
  }));
  return { steps, hasTrace: steps.some(step => step.actions.length > 0) };
}

type TabId = 'script' | 'trace' | 'recording' | 'screenshots' | 'history' | 'analysis';

/** Best-effort summary of the "test data" a step acted on — the value typed/selected/
 * navigated to, falling back to the selector when an action has no value of its own. */
export function stepData(step: NormalizedStep): string {
  const parts: string[] = [];
  for (const action of step.actions) {
    const input = (action.input || {}) as Record<string, unknown>;
    const value = input.value ?? input.text ?? input.url ?? input.key ?? null;
    if (value != null && String(value).trim() !== '') parts.push(String(value));
    else if (action.selector) parts.push(action.selector);
  }
  const unique = [...new Set(parts)];
  return unique.length ? unique.join(', ') : '—';
}

type ScriptView = 'table' | 'grid';

function ScriptTableView({ steps }: { steps: NormalizedStep[] }) {
  return (
    <div className="overflow-x-auto rounded-none border border-border">
      <table className="w-full min-w-[820px] text-left text-sm">
        <thead className="bg-canvas/70 text-[10px] font-semibold uppercase tracking-[.12em] text-text-secondary">
          <tr>
            <th className="w-12 px-3 py-2.5">Step</th>
            <th className="px-3 py-2.5">Action</th>
            <th className="px-3 py-2.5">Data</th>
            <th className="px-3 py-2.5">Expected</th>
            <th className="px-3 py-2.5">Actual</th>
            <th className="px-3 py-2.5">Status</th>
            <th className="px-3 py-2.5 text-right">Duration</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {steps.map(step => (
            <tr key={step.number} className="align-top text-xs">
              <td className="px-3 py-3 tabular-nums text-text-secondary">{step.number}</td>
              <td className="max-w-[220px] px-3 py-3 font-medium text-text-primary">{step.description}</td>
              <td className="max-w-[200px] px-3 py-3 font-mono text-[11px] text-text-secondary">{stepData(step)}</td>
              <td className="max-w-[220px] px-3 py-3 text-text-secondary">{step.expected || '—'}</td>
              <td className="max-w-[220px] px-3 py-3 text-text-secondary">{step.actual || step.errorMessage || '—'}</td>
              <td className="px-3 py-3"><StatusPill status={step.status} /></td>
              <td className="px-3 py-3 text-right tabular-nums text-text-secondary">{step.durationMs != null ? formatMs(step.durationMs) : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ScriptGridRow({ label, value, mono }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div className="flex items-start gap-3 border-b border-border/60 py-2 last:border-b-0">
      <span className="w-20 flex-none pt-0.5 text-[10px] font-semibold uppercase tracking-wide text-text-secondary">{label}</span>
      <span className={cn('min-w-0 flex-1 whitespace-pre-wrap break-words leading-5', mono && 'font-mono text-[11px]')}>{value}</span>
    </div>
  );
}

function ScriptGridView({ steps }: { steps: NormalizedStep[] }) {
  return (
    <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(22rem, 1fr))' }}>
      {steps.map(step => (
        <div key={step.number} className="rounded-none border border-border bg-surface p-3.5 text-xs">
          <div className="mb-1.5 flex items-center gap-2">
            <span className="tabular-nums rounded bg-elevated px-1.5 py-0.5 text-[10px] text-text-secondary">step {step.number}</span>
            <StatusPill status={step.status} />
            <span className="ml-auto tabular-nums text-[10px] text-text-secondary">{step.durationMs != null ? formatMs(step.durationMs) : '—'}</span>
          </div>
          <ScriptGridRow label="Action" value={step.description} />
          <ScriptGridRow label="Data" value={stepData(step)} mono />
          <ScriptGridRow label="Expected" value={step.expected || '—'} />
          <ScriptGridRow label="Actual" value={step.actual || step.errorMessage || '—'} />
        </div>
      ))}
    </div>
  );
}

function ScriptTab({ steps }: { steps: NormalizedStep[] }) {
  const [view, setView] = useState<ScriptView>('table');
  if (!steps.length) return <EmptyNote icon={<ListChecks size={18} />}>No steps were recorded.</EmptyNote>;
  const VIEW_ICON: Record<ScriptView, React.ReactNode> = { table: <Table2 size={14} />, grid: <LayoutGrid size={14} /> };
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-end gap-1">
        {(['table', 'grid'] as ScriptView[]).map(option => (
          <button
            key={option}
            type="button"
            onClick={() => setView(option)}
            aria-label={`${option} view`}
            aria-pressed={view === option}
            title={`${option} view`}
            className={cn('rounded-none border p-1.5 transition-colors', view === option ? 'border-accent-blue text-accent-blue bg-accent-blue/5' : 'border-border text-text-secondary hover:text-text-primary')}
          >
            {VIEW_ICON[option]}
          </button>
        ))}
      </div>
      {view === 'table' ? <ScriptTableView steps={steps} /> : <ScriptGridView steps={steps} />}
    </div>
  );
}

function StepNavRow({ step, scoped, onDoubleClick, index }: { step: NormalizedStep; scoped: boolean; onDoubleClick: () => void; index: number }) {
  const reduceMotion = useReducedMotion();
  const visual = STEP_ICON[step.status] || STEP_ICON.pending;
  const accent = STEP_ACCENT[step.status] || STEP_ACCENT.pending;
  const hasActions = step.actions.length > 0;
  const [expanded, setExpanded] = useState(false);
  return (
    <motion.div
      onClick={() => hasActions && setExpanded(value => !value)}
      onDoubleClick={onDoubleClick}
      title={hasActions ? 'Click to expand/collapse sub-steps. Double-click to focus Trace, Recording and Screenshots on this step.' : 'Double-click to focus Trace, Recording and Screenshots on this step.'}
      initial={reduceMotion ? false : { opacity: 0, x: -6 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.2, delay: reduceMotion ? 0 : Math.min(index, 12) * 0.025 }}
      className={cn(
        'cursor-pointer select-none rounded-none border-l-2 px-2.5 py-2 text-xs transition-colors',
        accent,
        scoped ? 'bg-accent-blue/10' : 'bg-surface hover:bg-elevated/50',
      )}
    >
      <div className="flex items-center gap-2">
        <span className={visual.tone}>{visual.icon}</span>
        <span className="min-w-0 flex-1 truncate font-medium text-text-primary"><span className="tabular-nums text-text-secondary">{step.number}.</span> {step.description}</span>
        {step.durationMs != null && <span className="tabular-nums text-[10px] text-text-secondary">{formatMs(step.durationMs)}</span>}
        {hasActions && <ChevronRight size={12} className={cn('flex-none text-text-secondary transition-transform', expanded && 'rotate-90')} />}
      </div>
      {hasActions && expanded && (
        <div className="mt-2 space-y-1 border-t border-border/70 pl-5 pt-2">
          {step.actions.map((action, actionIndex) => {
            const actionFailed = action.status === 'failed' || action.status === 'error';
            return (
              <div key={action.actionId || actionIndex} className="flex items-center gap-1.5 text-[11px]">
                {actionFailed ? <XCircle size={11} className="flex-none text-danger" /> : <CheckCircle2 size={11} className="flex-none text-success" />}
                <span className="min-w-0 flex-1 truncate font-mono text-text-secondary">{action.actionType || 'action'}{action.selector ? ` · ${action.selector}` : ''}</span>
                {action.durationMs != null && <span className="tabular-nums text-text-secondary">{formatMs(action.durationMs)}</span>}
              </div>
            );
          })}
        </div>
      )}
    </motion.div>
  );
}

function StepNavRowCollapsed({ step, scoped, onDoubleClick }: { step: NormalizedStep; scoped: boolean; onDoubleClick: () => void }) {
  const visual = STEP_ICON[step.status] || STEP_ICON.pending;
  const accent = STEP_ACCENT[step.status] || STEP_ACCENT.pending;
  return (
    <div
      onDoubleClick={onDoubleClick}
      title={`${step.number}. ${step.description}`}
      className={cn('flex cursor-pointer items-center justify-center rounded-none border-l-2 py-2 transition-colors', accent, scoped ? 'bg-accent-blue/10' : 'hover:bg-elevated/50')}
    >
      <span className={visual.tone}>{visual.icon}</span>
    </div>
  );
}

// --- Timeline math shared by the Recording tab's marker strip and step-scoped log filtering ---

function toMs(value?: string | null): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

function useTimelineWindow(execution: ExecutionRecord, steps: NormalizedStep[]) {
  return useMemo(() => {
    const starts = steps.map(step => toMs(step.startedAt)).filter((value): value is number => value != null);
    const ends = steps.map(step => toMs(step.completedAt)).filter((value): value is number => value != null);
    const createdAt = toMs(execution.createdAt);
    const completedAt = toMs(execution.completedAt) ?? (createdAt != null && execution.duration != null ? createdAt + execution.duration * 1000 : null);
    const windowStart = Math.min(...(starts.length ? starts : createdAt != null ? [createdAt] : [0]));
    const windowEnd = Math.max(...(ends.length ? ends : completedAt != null ? [completedAt] : [windowStart + 1]));
    const span = Math.max(windowEnd - windowStart, 1);
    const pct = (value?: string | null) => {
      const ms = toMs(value);
      if (ms == null) return null;
      return Math.min(100, Math.max(0, ((ms - windowStart) / span) * 100));
    };
    return { windowStart, windowEnd, pct };
  }, [execution.createdAt, execution.completedAt, execution.duration, steps]);
}

function withinStep(timestamp: string, step: NormalizedStep): boolean {
  const ms = toMs(timestamp);
  const start = toMs(step.startedAt);
  const end = toMs(step.completedAt);
  if (ms == null || start == null || end == null) return false;
  return ms >= start && ms <= end;
}

/** Index of the log/request whose timestamp is nearest `hoverTs`, or null if there's
 * nothing to compare against — used to highlight the console/network row under the
 * timeline cursor while hovering. */
function nearestIndexByTime(entries: Array<{ timestamp: string }>, hoverTs: number | null): number | null {
  if (hoverTs == null || !entries.length) return null;
  let bestIndex: number | null = null;
  let bestDiff = Infinity;
  for (let index = 0; index < entries.length; index += 1) {
    const ms = toMs(entries[index].timestamp);
    if (ms == null) continue;
    const diff = Math.abs(ms - hoverTs);
    if (diff < bestDiff) {
      bestDiff = diff;
      bestIndex = index;
    }
  }
  return bestIndex;
}

function networkStatusColor(status: number | null): string {
  if (status == null) return 'text-text-secondary';
  if (status >= 500) return 'text-danger';
  if (status >= 400) return 'text-warning';
  if (status >= 300) return 'text-info';
  return 'text-success';
}

/** Tinted background+text pairing for a status/method badge chip — reuses the same
 * four semantic tones as the rest of the app (success/info/warning/danger) rather
 * than introducing new colors. */
function networkStatusBadgeClass(status: number | null, failed: boolean): string {
  if (failed || (status != null && status >= 500)) return 'bg-danger/10 text-danger';
  if (status == null) return 'bg-elevated text-text-secondary';
  if (status >= 400) return 'bg-warning/10 text-warning';
  if (status >= 300) return 'bg-info/10 text-info';
  return 'bg-success/10 text-success';
}

const METHOD_BADGE: Record<string, string> = {
  GET: 'bg-info/10 text-info',
  POST: 'bg-success/10 text-success',
  PUT: 'bg-warning/10 text-warning',
  PATCH: 'bg-warning/10 text-warning',
  DELETE: 'bg-danger/10 text-danger',
};
function methodBadgeClass(method: string): string {
  return METHOD_BADGE[method.toUpperCase()] || 'bg-elevated text-text-secondary';
}

/** Small icon per resource type so a long request list can be scanned by shape, not
 * just by reading the Type column text. */
function resourceTypeIcon(type?: string | null) {
  switch (type) {
    case 'document': return <FileText size={12} />;
    case 'stylesheet': return <FileCode2 size={12} />;
    case 'script': return <FileCode2 size={12} />;
    case 'image': return <ImageIcon size={12} />;
    case 'font': return <TypeIcon size={12} />;
    case 'media': return <Film size={12} />;
    case 'xhr':
    case 'fetch': return <ArrowLeftRight size={12} />;
    default: return <FileIcon size={12} />;
  }
}

const CONSOLE_LEVEL_VISUAL: Record<string, { icon: React.ReactNode; tone: string; badge: string }> = {
  error: { icon: <XCircle size={12} />, tone: 'text-danger', badge: 'bg-danger/10 text-danger' },
  warn: { icon: <AlertTriangle size={12} />, tone: 'text-warning', badge: 'bg-warning/10 text-warning' },
  warning: { icon: <AlertTriangle size={12} />, tone: 'text-warning', badge: 'bg-warning/10 text-warning' },
  info: { icon: <Info size={12} />, tone: 'text-info', badge: 'bg-info/10 text-info' },
};
function consoleLevelVisual(level: string) {
  return CONSOLE_LEVEL_VISUAL[level] || { icon: <Terminal size={12} />, tone: 'text-text-secondary', badge: 'bg-elevated text-text-secondary' };
}

/** The filename/path portion of a URL, the way browser devtools label network rows —
 * falls back to the full URL for anything that doesn't parse (data: URIs, etc). */
function requestName(url: string): string {
  try {
    const parsed = new URL(url);
    const segment = parsed.pathname.split('/').filter(Boolean).pop();
    return (segment || parsed.hostname) + parsed.search;
  } catch {
    return url;
  }
}

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() => { navigator.clipboard?.writeText(value); setCopied(true); setTimeout(() => setCopied(false), 1200); }}
      aria-label="Copy to clipboard"
      title="Copy"
      className="flex-none text-text-secondary transition-colors hover:text-text-primary"
    >
      {copied ? <Check size={11} className="text-success" /> : <Copy size={11} />}
    </button>
  );
}

function DetailRow({ label, value, tone }: { label: string; value: React.ReactNode; tone?: string }) {
  return (
    <div className="flex gap-2.5 py-0.5">
      <span className="w-16 flex-none text-text-secondary">{label}</span>
      <span className={cn('min-w-0 flex-1 break-all', tone || 'text-text-primary')}>{value}</span>
    </div>
  );
}

function HeadersList({ headers }: { headers?: Record<string, string> | null }) {
  const entries = headers ? Object.entries(headers) : [];
  if (!entries.length) return <p className="italic text-text-secondary">No headers captured.</p>;
  return (
    <div className="divide-y divide-border/60">
      {entries.map(([key, value]) => (
        <div key={key} className="flex gap-2.5 py-1">
          <span className="w-32 flex-none truncate text-accent-blue" title={key}>{key}</span>
          <span className="min-w-0 flex-1 break-all text-text-secondary">{value}</span>
        </div>
      ))}
    </div>
  );
}

type NetworkDetailTab = 'headers' | 'payload' | 'response';

function NetworkDetailPanel({ request, onClose, width, onResizeStart }: { request: NetworkRequestRecord; onClose: () => void; width: number; onResizeStart: (event: React.MouseEvent) => void }) {
  const [tab, setTab] = useState<NetworkDetailTab>('headers');
  const tabs: Array<{ id: NetworkDetailTab; label: string; present: boolean }> = [
    { id: 'headers', label: 'Headers', present: true },
    { id: 'payload', label: 'Payload', present: !!request.requestBody },
    { id: 'response', label: 'Response', present: !!request.responseBody },
  ];
  return (
    <div className="flex h-full min-w-0 flex-none" style={{ width }}>
      <div onMouseDown={onResizeStart} title="Drag to resize" className="w-1.5 flex-none cursor-col-resize bg-border hover:bg-accent-blue/40" />
      <div className="flex h-full min-w-0 flex-1 flex-col border-l border-border bg-canvas/40">
      <div className="flex-none border-b border-border px-3 py-2">
        <div className="flex items-center gap-2">
          <span className={cn('flex-none rounded-none px-1.5 py-0.5 text-[10px] font-semibold', methodBadgeClass(request.method))}>{request.method}</span>
          <span className="min-w-0 flex-1 truncate font-mono text-[11px] font-medium text-text-primary" title={request.url}>{requestName(request.url)}</span>
          <button type="button" onClick={onClose} aria-label="Close request details" className="flex-none text-text-secondary transition-colors hover:text-text-primary"><X size={14} /></button>
        </div>
        <div className="mt-1.5 flex items-center gap-1.5">
          <span className="min-w-0 flex-1 truncate font-mono text-[10px] text-text-secondary" title={request.url}>{request.url}</span>
          <CopyButton value={request.url} />
        </div>
      </div>
      <div className="flex flex-none gap-1 border-b border-border px-2 pt-1.5">
        {tabs.map(({ id, label, present }) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={cn('flex items-center gap-1.5 rounded-none px-2.5 py-1.5 text-[11px] font-medium transition-colors', tab === id ? 'border-b-2 border-accent-blue text-text-primary' : 'text-text-secondary hover:text-text-primary')}
          >
            {label}
            {id !== 'headers' && <span className={cn('h-1.5 w-1.5 rounded-full', present ? 'bg-accent-blue' : 'bg-border-strong')} />}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2.5 font-mono text-[11px] leading-5">
        {tab === 'headers' && (
          <div className="space-y-4">
            <div>
              <p className="mb-1.5 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-text-secondary"><Info size={11} />General</p>
              <div className="rounded-none bg-elevated/50 px-2.5 py-1.5">
                <DetailRow label="Method" value={request.method} />
                <DetailRow label="Status" value={request.status ?? '—'} tone={networkStatusColor(request.status)} />
                {request.resourceType && <DetailRow label="Type" value={request.resourceType} />}
                {request.failureText && <DetailRow label="Failed" value={request.failureText} tone="text-danger" />}
              </div>
            </div>
            <div>
              <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-text-secondary">Request headers</p>
              <HeadersList headers={request.requestHeaders} />
            </div>
            <div>
              <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-text-secondary">Response headers</p>
              <HeadersList headers={request.responseHeaders} />
            </div>
          </div>
        )}
        {tab === 'payload' && (request.requestBody
          ? <pre className="whitespace-pre-wrap break-all rounded-none bg-elevated/50 p-2.5 text-text-secondary">{request.requestBody}</pre>
          : <p className="italic text-text-secondary">No request payload for this call.</p>)}
        {tab === 'response' && (request.responseBody
          ? <pre className="whitespace-pre-wrap break-all rounded-none bg-elevated/50 p-2.5 text-text-secondary">{request.responseBody}</pre>
          : <p className="italic text-text-secondary">Response body wasn't captured for this resource type.</p>)}
      </div>
      </div>
    </div>
  );
}

function RecordingTab({ execution, steps, scopedStep }: { execution: ExecutionRecord; steps: NormalizedStep[]; scopedStep: NormalizedStep | null }) {
  const result = execution.result as ExecutionRecord['result'];
  const videoKey = (result as any)?.videoKey as string | null | undefined;
  const videoUrl = videoKey ? `${API}/storage/download?key=${encodeURIComponent(videoKey)}` : null;
  const allConsoleLogs = ((result as any)?.consoleLogs as Array<{ level: string; message: string; timestamp: string }> | undefined) || [];
  const allNetworkRequests = ((result as any)?.networkRequests as Array<NetworkRequestRecord> | undefined) || [];
  const consoleLogs = scopedStep ? allConsoleLogs.filter(log => withinStep(log.timestamp, scopedStep)) : allConsoleLogs;
  const networkRequests = scopedStep ? allNetworkRequests.filter(request => withinStep(request.timestamp, scopedStep)) : allNetworkRequests;
  const { windowStart, windowEnd, pct } = useTimelineWindow(execution, steps);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [duration, setDuration] = useState(0);
  const [hoverTs, setHoverTs] = useState<number | null>(null);
  const [logsTab, setLogsTab] = useState<'console' | 'network'>('console');
  const consoleRowRefs = useRef<Record<number, HTMLDivElement | null>>({});
  const networkRowRefs = useRef<Record<number, HTMLDivElement | null>>({});
  const [panelCollapsed, setPanelCollapsed] = useState(false);
  const [panelHeight, setPanelHeight] = useState(260);
  const [selectedNetworkIndex, setSelectedNetworkIndex] = useState<number | null>(null);
  const [detailWidth, setDetailWidth] = useState(384);
  const resizeRef = useRef<{ startY: number; startHeight: number } | null>(null);
  const detailResizeRef = useRef<{ startX: number; startWidth: number } | null>(null);

  const startResize = (event: React.MouseEvent) => {
    event.preventDefault();
    resizeRef.current = { startY: event.clientY, startHeight: panelHeight };
    const onMove = (moveEvent: MouseEvent) => {
      if (!resizeRef.current) return;
      const delta = resizeRef.current.startY - moveEvent.clientY;
      setPanelHeight(Math.min(600, Math.max(140, resizeRef.current.startHeight + delta)));
    };
    const onUp = () => {
      resizeRef.current = null;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  const startDetailResize = (event: React.MouseEvent) => {
    event.preventDefault();
    detailResizeRef.current = { startX: event.clientX, startWidth: detailWidth };
    const onMove = (moveEvent: MouseEvent) => {
      if (!detailResizeRef.current) return;
      // Dragging left (clientX decreasing) should widen the panel — it's anchored to
      // the right edge, so the handle moving left means "more width", not less.
      const delta = detailResizeRef.current.startX - moveEvent.clientX;
      setDetailWidth(Math.min(720, Math.max(280, detailResizeRef.current.startWidth + delta)));
    };
    const onUp = () => {
      detailResizeRef.current = null;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  const stepMarks = steps.map(step => ({ number: step.number, position: pct(step.startedAt) })).filter((mark): mark is { number: number; position: number } => mark.position != null);

  const consoleMarks = consoleLogs
    .map(log => ({ position: pct(log.timestamp), tone: log.level === 'error' ? 'bg-danger' : log.level === 'warn' || log.level === 'warning' ? 'bg-warning' : 'bg-info', title: `[console] ${log.message}` }))
    .filter((mark): mark is { position: number; tone: string; title: string } => mark.position != null);

  const networkMarks = networkRequests
    .map(request => ({ position: pct(request.timestamp), tone: request.status == null || request.status >= 400 ? 'bg-danger' : 'bg-text-secondary', title: `${request.method} ${request.status ?? '…'} ${request.url}` }))
    .filter((mark): mark is { position: number; tone: string; title: string } => mark.position != null);

  const scopedRange = scopedStep ? { start: pct(scopedStep.startedAt) ?? 0, end: pct(scopedStep.completedAt) ?? 100 } : null;

  useEffect(() => {
    if (!scopedRange || !duration || !videoRef.current) return;
    videoRef.current.currentTime = (scopedRange.start / 100) * duration;
  }, [scopedStep?.number, duration]); // eslint-disable-line react-hooks/exhaustive-deps

  const seekTo = (position: number) => {
    if (videoRef.current && duration) videoRef.current.currentTime = (position / 100) * duration;
  };

  const handleTimelineHover = (event: React.MouseEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const position = Math.min(100, Math.max(0, ((event.clientX - rect.left) / rect.width) * 100));
    seekTo(position);
    setHoverTs(windowStart + (position / 100) * (windowEnd - windowStart));
  };

  const nearestConsoleIndex = nearestIndexByTime(consoleLogs, hoverTs);
  const nearestNetworkIndex = nearestIndexByTime(networkRequests, hoverTs);

  useEffect(() => {
    if (logsTab === 'console' && nearestConsoleIndex != null) consoleRowRefs.current[nearestConsoleIndex]?.scrollIntoView({ block: 'nearest' });
  }, [nearestConsoleIndex, logsTab]);
  useEffect(() => {
    if (logsTab === 'network' && nearestNetworkIndex != null) networkRowRefs.current[nearestNetworkIndex]?.scrollIntoView({ block: 'nearest' });
  }, [nearestNetworkIndex, logsTab]);
  useEffect(() => { setSelectedNetworkIndex(null); }, [scopedStep?.number, logsTab]);
  const selectedNetworkRequest = selectedNetworkIndex != null ? networkRequests[selectedNetworkIndex] : null;

  if (!videoUrl) return <EmptyNote icon={<Video size={18} />}>No recording was captured for this execution.</EmptyNote>;

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <video ref={videoRef} controls className="max-h-[48vh] w-full rounded-none bg-black shadow-[var(--shadow-panel)]" src={videoUrl} onLoadedMetadata={event => setDuration(event.currentTarget.duration)} />
      {duration > 0 && (
        <div className="flex-none">
          <div className="flex items-stretch gap-2">
            <div className="flex w-16 flex-none flex-col justify-between py-px text-[9px] font-semibold uppercase tracking-wide text-text-secondary">
              <span>Step</span>
              <span>Console</span>
              <span>Network</span>
            </div>
            <div
              className="relative flex-1 cursor-pointer"
              onMouseMove={handleTimelineHover}
              onClick={handleTimelineHover}
            >
              {scopedRange && (
                <>
                  <div className="pointer-events-none absolute inset-y-0 left-0 z-10 bg-canvas/70" style={{ width: `${scopedRange.start}%` }} />
                  <div className="pointer-events-none absolute inset-y-0 right-0 z-10 bg-canvas/70" style={{ left: `${scopedRange.end}%` }} />
                </>
              )}
              {hoverTs != null && (
                <div className="pointer-events-none absolute inset-y-0 z-20 w-px bg-accent-blue" style={{ left: `${((hoverTs - windowStart) / Math.max(windowEnd - windowStart, 1)) * 100}%` }} />
              )}
              <div className="space-y-px">
                <div className="relative h-5 rounded-none bg-elevated">
                  {stepMarks.map(mark => <div key={mark.number} title={`Step ${mark.number}`} className="pointer-events-none absolute top-1/2 h-3 w-px -translate-y-1/2 bg-border-strong" style={{ left: `${mark.position}%` }} />)}
                </div>
                <div className="relative h-5 rounded-none bg-elevated">
                  {consoleMarks.map((mark, index) => <div key={`c-${index}`} title={mark.title} className={cn('pointer-events-none absolute top-1/2 h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full', mark.tone)} style={{ left: `${mark.position}%` }} />)}
                </div>
                <div className="relative h-5 rounded-none bg-elevated">
                  {networkMarks.map((mark, index) => <div key={`n-${index}`} title={mark.title} className={cn('pointer-events-none absolute top-1/2 h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full', mark.tone)} style={{ left: `${mark.position}%` }} />)}
                </div>
              </div>
            </div>
          </div>
          <div className="mt-1 flex items-center gap-4 text-[10px] text-text-secondary">
            <span className="flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full bg-info" />console</span>
            <span className="flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full bg-danger" />error / failed request</span>
            <span className="flex items-center gap-1"><span className="h-2 w-px bg-border-strong" />step boundary</span>
            <span>Click or hover a lane to scrub the video and jump to the matching entry below</span>
            {scopedStep && <span className="ml-auto">Scoped to step {scopedStep.number} — markers outside this step are hidden</span>}
          </div>
        </div>
      )}

      <div className="flex flex-none flex-col rounded-none border border-border" style={{ height: panelCollapsed ? undefined : panelHeight }}>
        {!panelCollapsed && (
          <div onMouseDown={startResize} title="Drag to resize" className="h-1.5 flex-none cursor-row-resize bg-border hover:bg-accent-blue/40" />
        )}
        <div className="flex flex-none items-center gap-1 border-b border-border px-2 py-1">
          <button type="button" onClick={() => setPanelCollapsed(value => !value)} aria-expanded={!panelCollapsed} aria-label={panelCollapsed ? 'Expand panel' : 'Collapse panel'} title={panelCollapsed ? 'Expand panel' : 'Collapse panel'} className="flex-none text-text-secondary transition-colors hover:text-text-primary">
            {panelCollapsed ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </button>
          {([
            { id: 'console' as const, label: 'Console', icon: <Terminal size={12} />, count: consoleLogs.length },
            { id: 'network' as const, label: 'Network', icon: <Globe2 size={12} />, count: networkRequests.length },
          ]).map(({ id, label, icon, count }) => (
            <button key={id} type="button" onClick={() => setLogsTab(id)} className={cn('flex items-center gap-1.5 rounded-none px-3 py-1.5 text-xs font-medium transition-colors', logsTab === id ? 'bg-elevated text-text-primary' : 'text-text-secondary hover:text-text-primary')}>
              {icon}{label}
              {count > 0 && <span className={cn('rounded-none px-1.5 py-0.5 text-[10px] tabular-nums', logsTab === id ? 'bg-canvas text-text-secondary' : 'bg-elevated text-text-secondary')}>{count}</span>}
            </button>
          ))}
        </div>
        {!panelCollapsed && (
          <div className="flex min-h-0 flex-1">
            {logsTab === 'console' && (
              <div className="min-h-0 flex-1 overflow-y-auto font-mono text-[11px] leading-5">
                {consoleLogs.length ? consoleLogs.map((log, index) => {
                  const visual = consoleLevelVisual(log.level);
                  return (
                    <div
                      key={index}
                      ref={element => { consoleRowRefs.current[index] = element; }}
                      className={cn(
                        'flex items-start gap-2 border-l-2 border-b border-border/40 px-2 py-1.5',
                        log.level === 'error' ? 'border-l-danger' : log.level === 'warn' || log.level === 'warning' ? 'border-l-warning' : 'border-l-transparent',
                        index === nearestConsoleIndex ? 'bg-accent-blue/10' : 'hover:bg-elevated/40',
                      )}
                    >
                      <span className={cn('mt-0.5 flex-none', visual.tone)}>{visual.icon}</span>
                      <span className="flex-none tabular-nums text-text-secondary">{new Date(log.timestamp).toLocaleTimeString()}</span>
                      <span className={cn('min-w-0 flex-1 whitespace-pre-wrap break-words', log.level === 'error' ? 'text-danger' : log.level === 'warn' || log.level === 'warning' ? 'text-warning' : 'text-text-secondary')}>{log.message}</span>
                    </div>
                  );
                }) : (
                  <div className="flex h-full flex-col items-center justify-center gap-2 py-10 text-text-secondary">
                    <Terminal size={18} className="opacity-50" />
                    <p>No console output was captured.</p>
                  </div>
                )}
              </div>
            )}
            {logsTab === 'network' && (
              <>
                <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto text-[11px]">
                  {networkRequests.length > 0 && (
                    <div className="sticky top-0 z-10 grid flex-none grid-cols-[1fr_4rem_3.5rem_4.5rem_5.5rem] gap-2 border-b border-border bg-canvas px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-text-secondary">
                      <span>Name</span><span>Method</span><span>Status</span><span>Type</span><span className="text-right">Time</span>
                    </div>
                  )}
                  {networkRequests.length ? networkRequests.map((request, index) => (
                    <div
                      key={index}
                      ref={element => { networkRowRefs.current[index] = element; }}
                      onClick={() => setSelectedNetworkIndex(index)}
                      className={cn(
                        'grid flex-none cursor-pointer grid-cols-[1fr_4rem_3.5rem_4.5rem_5.5rem] items-center gap-2 border-b border-border/40 px-2 py-1.5 font-mono transition-colors hover:bg-elevated/50',
                        selectedNetworkIndex === index && 'bg-accent-blue/10',
                        selectedNetworkIndex !== index && index === nearestNetworkIndex && 'bg-accent-blue/5',
                      )}
                    >
                      <span className="flex min-w-0 items-center gap-1.5 truncate text-text-primary" title={request.url}>
                        <span className="flex-none text-text-secondary">{resourceTypeIcon(request.resourceType)}</span>
                        <span className="min-w-0 truncate">{requestName(request.url)}</span>
                      </span>
                      <span className={cn('w-fit truncate rounded-none px-1.5 py-0.5 text-[10px] font-semibold', methodBadgeClass(request.method))}>{request.method}</span>
                      <span className={cn('w-fit truncate rounded-none px-1.5 py-0.5 text-[10px] font-semibold tabular-nums', networkStatusBadgeClass(request.status, !!request.failureText))}>{request.failureText ? 'failed' : request.status ?? '…'}</span>
                      <span className="truncate text-text-secondary">{request.resourceType || '—'}</span>
                      <span className="truncate text-right tabular-nums text-text-secondary">{new Date(request.timestamp).toLocaleTimeString()}</span>
                    </div>
                  )) : (
                    <div className="flex h-full flex-col items-center justify-center gap-2 py-10 text-text-secondary">
                      <Globe2 size={18} className="opacity-50" />
                      <p>No network activity was captured.</p>
                    </div>
                  )}
                </div>
                {selectedNetworkRequest && (
                  <NetworkDetailPanel
                    request={selectedNetworkRequest}
                    onClose={() => setSelectedNetworkIndex(null)}
                    width={detailWidth}
                    onResizeStart={startDetailResize}
                  />
                )}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function ScreenshotsTab({ steps, scopedStep, hasTrace }: { steps: NormalizedStep[]; scopedStep: NormalizedStep | null; hasTrace: boolean }) {
  if (!hasTrace) return <EmptyNote icon={<Images size={18} />}>No screenshots are available for this result.</EmptyNote>;
  const scoped = scopedStep ? [scopedStep] : steps;
  const flat = scoped.flatMap(step => step.actions.map(action => ({ ...action, stepNumber: step.number })).filter(action => action.screenshotBefore || action.screenshotAfter));
  if (!flat.length) return <EmptyNote icon={<Images size={18} />}>No before/after screenshots were captured for {scopedStep ? 'this step' : 'this execution'}.</EmptyNote>;
  return (
    <div className="space-y-4">
      {flat.map((action, index) => (
        <div key={action.actionId || index} className="rounded-none border border-border bg-surface p-3">
          <p className="mb-2 flex items-center gap-2 text-xs text-text-secondary">
            {!scopedStep && <span className="tabular-nums rounded bg-elevated px-1.5 py-0.5 text-[10px]">step {action.stepNumber}</span>}
            <span className="font-mono font-medium text-text-primary">{action.actionType}</span>
            {action.selector && <span className="truncate font-mono">{action.selector}</span>}
          </p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-text-secondary">Before</p>
              {action.screenshotBefore ? <img src={`data:image/png;base64,${action.screenshotBefore}`} alt={`Before ${action.actionType}`} className="w-full rounded-lg" /> : <div className="grid aspect-video place-items-center rounded-lg border border-dashed border-border text-[11px] text-text-secondary">Not captured</div>}
            </div>
            <div>
              <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-text-secondary">After</p>
              {action.screenshotAfter ? <img src={`data:image/png;base64,${action.screenshotAfter}`} alt={`After ${action.actionType}`} className="w-full rounded-lg" /> : <div className="grid aspect-video place-items-center rounded-lg border border-dashed border-border text-[11px] text-text-secondary">Not captured</div>}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function HistoryTab({ execution, allExecutions, onSelect }: { execution: ExecutionRecord; allExecutions: ExecutionRecord[]; onSelect: (execution: ExecutionRecord) => void }) {
  const history = allExecutions.filter(item => item.testId === execution.testId).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  if (history.length <= 1) return <EmptyNote icon={<HistoryIcon size={18} />}>No other executions of this test case yet.</EmptyNote>;
  return (
    <div className="divide-y divide-border rounded-lg border border-border bg-surface">
      {history.map(item => {
        const isCurrent = item.id === execution.id;
        return (
          <button
            key={item.id}
            type="button"
            disabled={isCurrent}
            onClick={() => onSelect(item)}
            className={cn('flex w-full items-center justify-between gap-3 px-3.5 py-2.5 text-left text-sm transition-colors', isCurrent ? 'bg-accent-blue/5' : 'hover:bg-elevated/40')}
          >
            <span className="flex items-center gap-2">
              {isCurrent && <span className="rounded-full bg-accent-blue/15 px-2 py-0.5 text-[10px] font-semibold text-accent-blue">Current</span>}
              <span className="tabular-nums text-xs text-text-secondary">{new Date(item.createdAt).toLocaleString()}</span>
            </span>
            <span className="flex items-center gap-3 text-xs text-text-secondary">
              <span className="capitalize">{item.environment}</span>
              <span className="tabular-nums">{item.duration != null ? formatDuration(item.duration) : '—'}</span>
              <StatusPill status={item.status} />
            </span>
          </button>
        );
      })}
    </div>
  );
}

type AnalysisState = { executionId: string; loading: boolean; text: string | null; error: string | null };

/** Fires the analysis request at most once per execution — called from a [activeTab,
 * execution.id] effect in SingleExecutionView (not from AnalysisTab itself), so the
 * request runs the first time the AI Analysis tab is actually clicked and is never
 * repeated just because the user switches tabs away and back. */
function requestAnalysis(
  execution: ExecutionRecord,
  failedStep: NormalizedStep | null,
  setAnalysis: (state: AnalysisState) => void,
) {
  const result = execution.result as ExecutionRecord['result'];
  const topLevelError = (result as any)?.errorMessage as string | null | undefined;
  const actions = (failedStep?.actions || []).map(action => ({ actionType: action.actionType, selector: action.selector, status: action.status, errorMessage: action.errorMessage }));
  setAnalysis({ executionId: execution.id, loading: true, text: null, error: null });
  fetch(`${AGENTS_URL}/executions/analyze`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      testName: execution.testName,
      status: execution.status,
      errorMessage: topLevelError || null,
      failedStep: failedStep ? { description: failedStep.description, expected: failedStep.expected, actual: failedStep.actual, errorMessage: failedStep.errorMessage } : null,
      actions,
    }),
  })
    .then(async response => { if (!response.ok) throw new Error('Analysis is unavailable right now'); return response.json(); })
    .then(data => setAnalysis({ executionId: execution.id, loading: false, text: data.analysis, error: null }))
    .catch(reason => setAnalysis({ executionId: execution.id, loading: false, text: null, error: reason instanceof Error ? reason.message : 'Analysis is unavailable right now' }));
}

function AnalysisTab({ analysis }: { analysis: AnalysisState | null }) {
  return (
    <div className="rounded-none border border-border bg-surface p-4">
      <p className="mb-3 flex items-center gap-1.5 text-xs font-semibold text-accent-purple"><Sparkles size={14} />AI analysis</p>
      {(!analysis || analysis.loading) && <p className="flex items-center gap-2 text-xs text-text-secondary"><Loader2 size={14} className="animate-spin" />Analyzing this failure…</p>}
      {analysis?.error && <p className="text-xs text-danger">{analysis.error}</p>}
      {analysis?.text && <p className="whitespace-pre-wrap text-sm leading-6 text-text-primary">{analysis.text}</p>}
    </div>
  );
}

function SingleExecutionView({ execution, allExecutions, onSelectExecution }: { execution: ExecutionRecord; allExecutions: ExecutionRecord[]; onSelectExecution: (execution: ExecutionRecord) => void }) {
  const reduceMotion = useReducedMotion();
  const { steps, hasTrace } = useMemo(() => normalizeSteps(execution), [execution]);
  const isFailure = ['failed', 'error'].includes(execution.status);
  const failedStep = steps.find(step => step.status === 'failed' || step.status === 'error') || null;
  // Some failures (e.g. an unsupported step) happen before any individual step runs, so
  // there's no failedStep to quote — fall back to the run-level error instead of a bare
  // "This execution failed." with no reason at all.
  const topLevelError = (execution.result as ExecutionRecord['result'])?.errorMessage || null;

  const [navCollapsed, setNavCollapsed] = useState(false);
  const [scopedStepNumber, setScopedStepNumber] = useState<number | null>(null);
  const [activeTab, setActiveTab] = useState<TabId>('script');
  const scopedStep = steps.find(step => step.number === scopedStepNumber) || null;
  const scopedSteps = scopedStep ? [scopedStep] : steps;
  const traceCount = scopedSteps.reduce((total, step) => total + step.actions.length, 0);

  const [analysis, setAnalysis] = useState<AnalysisState | null>(null);
  useEffect(() => {
    if (activeTab !== 'analysis' || !isFailure) return;
    if (analysis?.executionId === execution.id) return; // already fetched (or in flight) for this run
    requestAnalysis(execution, failedStep, setAnalysis);
  }, [activeTab, execution.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const tabs: Array<{ id: TabId; label: string; icon: React.ReactNode; count?: number }> = [
    { id: 'script', label: 'Script', icon: <ListChecks size={14} />, count: scopedSteps.length },
    { id: 'trace', label: 'Trace', icon: <Activity size={14} />, count: traceCount },
    { id: 'recording', label: 'Recording', icon: <Video size={14} /> },
    { id: 'screenshots', label: 'Screenshots', icon: <Images size={14} /> },
    { id: 'history', label: 'History', icon: <HistoryIcon size={14} /> },
    ...(isFailure ? [{ id: 'analysis' as TabId, label: 'AI Analysis', icon: <Sparkles size={14} /> }] : []),
  ];

  const toggleScope = (stepNumber: number) => setScopedStepNumber(current => current === stepNumber ? null : stepNumber);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-none flex-wrap items-center gap-x-5 gap-y-2 border-b border-border px-5 py-4">
        <h1 className="text-base font-semibold tracking-tight text-text-primary">{execution.testName}</h1>
        <StatusPill status={execution.status} />
        <span className="ml-auto flex flex-wrap items-center gap-4 text-xs text-text-secondary">
          <span className="flex items-center gap-1.5"><Clock size={13} /><span className="tabular-nums">{execution.duration != null ? formatDuration(execution.duration) : '—'}</span></span>
          <span className="flex items-center gap-1.5 capitalize"><Globe2 size={13} />{execution.environment}</span>
          <span className="flex items-center gap-1.5 capitalize"><Monitor size={13} />{execution.browser}</span>
          <span className="tabular-nums">{new Date(execution.createdAt).toLocaleString()}</span>
        </span>
      </div>

      {isFailure && (
        <div className="flex flex-none items-center gap-2 border-b border-border bg-danger/5 px-5 py-2 text-xs text-danger">
          <AlertTriangle size={14} className="flex-none" />
          <span className="min-w-0 flex-1 truncate">{failedStep ? `Step ${failedStep.number} failed — ${failedStep.errorMessage || 'see AI Analysis for details'}` : topLevelError ? `This execution failed — ${topLevelError}` : 'This execution failed.'}</span>
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        <motion.div
          animate={{ width: navCollapsed ? 56 : 440 }}
          transition={reduceMotion ? { duration: 0 } : { duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
          className="flex flex-none flex-col overflow-hidden border-r border-border bg-canvas/30"
        >
          <div className={cn('flex flex-none items-center gap-1.5 border-b border-border px-2.5 py-2', navCollapsed && 'justify-center px-0')}>
            {!navCollapsed && <span className="flex min-w-0 flex-1 items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-text-secondary"><Layers size={12} />Steps</span>}
            <button type="button" onClick={() => setNavCollapsed(value => !value)} aria-label={navCollapsed ? 'Expand steps' : 'Collapse steps'} title={navCollapsed ? 'Expand steps' : 'Collapse steps'} className="ui-icon-button h-6 w-6 min-h-0 min-w-0">
              {navCollapsed ? <ChevronRight size={13} /> : <ChevronLeft size={13} />}
            </button>
          </div>
          <div className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto p-2">
            {steps.length === 0 && !navCollapsed && <EmptyNote icon={<ListChecks size={16} />}>No steps were recorded.</EmptyNote>}
            {steps.map((step, index) => navCollapsed
              ? <StepNavRowCollapsed key={step.number} step={step} scoped={scopedStepNumber === step.number} onDoubleClick={() => toggleScope(step.number)} />
              : <StepNavRow key={step.number} step={step} index={index} scoped={scopedStepNumber === step.number} onDoubleClick={() => toggleScope(step.number)} />,
            )}
          </div>
          {!navCollapsed && <p className="flex-none border-t border-border px-2.5 py-2 text-[10px] leading-4 text-text-secondary">Double-click a step to focus Trace, Recording and Screenshots on it.</p>}
        </motion.div>

        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex flex-none items-center gap-1 border-b border-border px-3">
            {tabs.map(tab => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={cn('relative flex items-center gap-1.5 px-3 py-2.5 text-xs font-medium transition-colors', activeTab === tab.id ? 'text-text-primary' : 'text-text-secondary hover:text-text-primary')}
              >
                {tab.icon}{tab.label}
                {tab.count != null && tab.count > 0 && <span className="tabular-nums text-[10px] text-text-secondary">{tab.count}</span>}
                {activeTab === tab.id && <motion.span layoutId="exec-detail-tab" transition={reduceMotion ? { duration: 0 } : { duration: 0.2 }} className="absolute inset-x-2 bottom-0 h-0.5 rounded-full bg-accent-blue" />}
              </button>
            ))}
            {scopedStep && (
              <button type="button" onClick={() => setScopedStepNumber(null)} className="ml-auto flex items-center gap-1 rounded-full bg-accent-blue/10 px-2.5 py-1 text-[11px] font-medium text-accent-blue transition-colors hover:bg-accent-blue/15">
                Scoped to step {scopedStep.number}<X size={12} />
              </button>
            )}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-4">
            <AnimatePresence mode="wait">
              <motion.div
                key={`${activeTab}-${scopedStepNumber ?? 'all'}`}
                initial={reduceMotion ? false : { opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={reduceMotion ? {} : { opacity: 0 }}
                transition={{ duration: 0.16 }}
                className="h-full"
              >
                {activeTab === 'script' && <ScriptTab steps={scopedSteps} />}
                {activeTab === 'trace' && <TraceTabWithLogs execution={execution} steps={steps} scopedStep={scopedStep} hasTrace={hasTrace} />}
                {activeTab === 'recording' && <RecordingTab execution={execution} steps={steps} scopedStep={scopedStep} />}
                {activeTab === 'screenshots' && <ScreenshotsTab steps={steps} scopedStep={scopedStep} hasTrace={hasTrace} />}
                {activeTab === 'history' && <HistoryTab execution={execution} allExecutions={allExecutions} onSelect={onSelectExecution} />}
                {activeTab === 'analysis' && isFailure && <AnalysisTab analysis={analysis?.executionId === execution.id ? analysis : null} />}
              </motion.div>
            </AnimatePresence>
          </div>
        </div>
      </div>
    </div>
  );
}

function TraceActionDetail({ action }: { action: AgentAction & { stepNumber: number } }) {
  const hasInput = action.input && Object.keys(action.input).length > 0;
  const hasOutput = action.output && Object.keys(action.output).length > 0;
  const tokens = action.tokensUsed;
  if (!hasInput && !hasOutput && !tokens) return null;
  return (
    <div className="mt-2 space-y-2 border-t border-border pt-2 pl-5">
      {tokens && (tokens.input != null || tokens.output != null || tokens.total != null) && (
        <div className="flex items-center gap-3 text-[10px] text-text-secondary">
          <span className="font-semibold uppercase tracking-wide">Tokens</span>
          {tokens.input != null && <span className="tabular-nums">in {tokens.input}</span>}
          {tokens.output != null && <span className="tabular-nums">out {tokens.output}</span>}
          {tokens.total != null && <span className="tabular-nums font-medium text-text-primary">{tokens.total} total</span>}
        </div>
      )}
      {hasInput && (
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wide text-text-secondary">Input</p>
          <pre className="mt-1 max-h-32 overflow-auto rounded-md bg-elevated px-2 py-1.5 font-mono text-[10px] leading-4 text-text-secondary">{JSON.stringify(action.input, null, 2)}</pre>
        </div>
      )}
      {hasOutput && (
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wide text-text-secondary">Output</p>
          <pre className="mt-1 max-h-32 overflow-auto rounded-md bg-elevated px-2 py-1.5 font-mono text-[10px] leading-4 text-text-secondary">{JSON.stringify(action.output, null, 2)}</pre>
        </div>
      )}
    </div>
  );
}

function TraceTabWithLogs({ execution, steps, scopedStep, hasTrace }: { execution: ExecutionRecord; steps: NormalizedStep[]; scopedStep: NormalizedStep | null; hasTrace: boolean }) {
  const [logsOpen, setLogsOpen] = useState(false);
  const [expandedActions, setExpandedActions] = useState<Set<string>>(new Set());
  const toggleAction = (key: string) => setExpandedActions(current => { const next = new Set(current); if (next.has(key)) next.delete(key); else next.add(key); return next; });
  const [logsTab, setLogsTab] = useState<'console' | 'network'>('console');
  const result = execution.result as ExecutionRecord['result'];
  const allConsole = ((result as any)?.consoleLogs as Array<{ level: string; message: string; timestamp: string }> | undefined) || [];
  const allNetwork = ((result as any)?.networkRequests as Array<NetworkRequestRecord> | undefined) || [];
  const consoleLogs = scopedStep ? allConsole.filter(log => withinStep(log.timestamp, scopedStep)) : allConsole;
  const networkRequests = scopedStep ? allNetwork.filter(request => withinStep(request.timestamp, scopedStep)) : allNetwork;

  const scoped = scopedStep ? [scopedStep] : steps;
  const flat = scoped.flatMap(step => step.actions.map(action => ({ ...action, stepNumber: step.number })));

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto">
        {!hasTrace ? (
          <EmptyNote icon={<Activity size={18} />}>No technical action trace is available for this result.</EmptyNote>
        ) : !flat.length ? (
          <EmptyNote icon={<Activity size={18} />}>No actions were recorded for this step.</EmptyNote>
        ) : (
          <div className="space-y-1.5">
            {flat.map((action, index) => {
              const isError = action.status === 'failed' || action.status === 'error';
              const key = action.actionId || String(index);
              const hasDetail = (action.input && Object.keys(action.input).length > 0) || (action.output && Object.keys(action.output).length > 0) || action.tokensUsed;
              const expanded = expandedActions.has(key);
              return (
                <div key={key} className={cn('rounded-none border-l-2 bg-surface px-3 py-2.5 text-xs', isError ? 'border-l-danger' : 'border-l-success/60')}>
                  <div className="flex items-center gap-2">
                    <MousePointerClick size={13} className={isError ? 'text-danger' : 'text-text-secondary'} />
                    {!scopedStep && <span className="tabular-nums rounded bg-elevated px-1.5 py-0.5 text-[10px] text-text-secondary">step {action.stepNumber}</span>}
                    <span className="font-mono font-medium text-text-primary">{action.actionType || 'action'}</span>
                    {action.selector && <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-text-secondary">{action.selector}</span>}
                    {action.tokensUsed?.total != null && <span className="tabular-nums rounded bg-elevated px-1.5 py-0.5 text-[10px] text-text-secondary">{action.tokensUsed.total} tok</span>}
                    <span className="ml-auto tabular-nums text-[11px] text-text-secondary">{action.durationMs != null ? formatMs(action.durationMs) : ''}</span>
                    {hasDetail && <button type="button" onClick={() => toggleAction(key)} aria-expanded={expanded} aria-label={expanded ? 'Hide action details' : 'Show action details'} className="flex-none text-text-secondary transition-colors hover:text-text-primary"><ChevronRight size={13} className={cn('transition-transform', expanded && 'rotate-90')} /></button>}
                  </div>
                  {action.errorMessage && <p className="mt-1.5 pl-5 text-[11px] leading-5 text-danger">{action.errorMessage}</p>}
                  {expanded && <TraceActionDetail action={action} />}
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="mt-3 flex-none border-t border-border">
        <button type="button" onClick={() => setLogsOpen(open => !open)} aria-expanded={logsOpen} className="flex w-full items-center gap-2 py-2.5 text-left text-xs font-semibold text-text-primary transition-colors hover:text-accent-blue">
          <ChevronRight size={13} className={cn('text-text-secondary transition-transform duration-200', logsOpen && 'rotate-90')} />
          <Terminal size={13} className="text-text-secondary" />
          Console &amp; network
          <span className="tabular-nums text-[10px] font-normal text-text-secondary">({consoleLogs.length} · {networkRequests.length})</span>
          {scopedStep && <span className="text-[10px] font-normal text-text-secondary">— scoped to step {scopedStep.number}</span>}
        </button>
        {logsOpen && (
          <div className="flex h-44 flex-col border-t border-border">
            <div className="flex flex-none gap-1 pt-2">
              {(['console', 'network'] as const).map(name => (
                <button key={name} type="button" onClick={() => setLogsTab(name)} className={cn('rounded-t-lg px-3 py-1.5 text-xs font-medium capitalize transition-colors', logsTab === name ? 'bg-elevated text-text-primary' : 'text-text-secondary hover:text-text-primary')}>{name}</button>
              ))}
            </div>
            <div className="flex-1 overflow-y-auto px-1 py-2 font-mono text-[11px] leading-5">
              {logsTab === 'console' && (consoleLogs.length ? consoleLogs.map((log, index) => (
                <p key={index} className={log.level === 'error' ? 'text-danger' : log.level === 'warning' || log.level === 'warn' ? 'text-warning' : 'text-text-secondary'}>[{log.level}] {log.message}</p>
              )) : <p className="py-3 text-center text-text-secondary">No console output was captured.</p>)}
              {logsTab === 'network' && (networkRequests.length ? networkRequests.map((request, index) => (
                <p key={index} className="text-text-secondary"><span className="text-text-primary">{request.method}</span> {request.status ?? '…'} — {request.url}</p>
              )) : <p className="py-3 text-center text-text-secondary">No network activity was captured.</p>)}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function PlanExecutionList({ executions, onSelect }: { executions: ExecutionRecord[]; onSelect: (execution: ExecutionRecord) => void }) {
  const reduceMotion = useReducedMotion();
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-5">
      <div className="mb-3 flex items-center gap-2 text-xs text-text-secondary"><ListChecks size={14} /><span className="tabular-nums">{executions.length}</span> test cases in this suite</div>
      <div className="divide-y divide-border rounded-lg border border-border bg-surface">
        {executions.map((execution, index) => (
          <motion.button
            key={execution.id}
            type="button"
            initial={reduceMotion ? false : { opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.2, delay: reduceMotion ? 0 : Math.min(index, 14) * 0.025 }}
            whileHover={reduceMotion ? undefined : { x: 2 }}
            onClick={() => onSelect(execution)}
            className="group flex w-full items-center justify-between gap-3 border-l-2 border-l-transparent px-3.5 py-3 text-left text-sm transition-colors hover:border-l-accent-blue hover:bg-elevated/40"
          >
            <span className="min-w-0 truncate font-medium text-text-primary">{execution.testName}</span>
            <span className="flex flex-none items-center gap-3 text-xs text-text-secondary">
              <span className="capitalize">{execution.environment}</span>
              <span className="tabular-nums">{execution.duration != null ? formatDuration(execution.duration) : '—'}</span>
              <StatusPill status={execution.status} />
              <ChevronRight size={14} className="text-text-secondary opacity-0 transition-opacity group-hover:opacity-100" />
            </span>
          </motion.button>
        ))}
        {!executions.length && <EmptyNote icon={<FileQuestion size={18} />}>No test cases found for this run.</EmptyNote>}
      </div>
    </div>
  );
}

function Breadcrumbs({ crumbs }: { crumbs: Array<{ label: string; onClick?: () => void }> }) {
  return (
    <nav aria-label="Breadcrumb" className="flex flex-none items-center gap-2 border-b border-border bg-surface px-5 py-3.5 text-sm">
      {crumbs.map((crumb, index) => {
        const isLast = index === crumbs.length - 1;
        return (
          <span key={index} className="flex items-center gap-2">
            {index > 0 && <ChevronRight size={14} className="text-text-secondary" />}
            {crumb.onClick && !isLast ? (
              <button type="button" onClick={crumb.onClick} className="text-text-secondary transition-colors hover:text-text-primary hover:underline">{crumb.label}</button>
            ) : (
              <span className={isLast ? 'font-semibold text-text-primary' : 'text-text-secondary'}>{crumb.label}</span>
            )}
          </span>
        );
      })}
    </nav>
  );
}

export function ExecutionDetailPage({ execution, allExecutions, onExit }: { execution: ExecutionRecord; allExecutions: ExecutionRecord[]; onExit: () => void }) {
  const [selected, setSelected] = useState<ExecutionRecord>(execution);
  // Recomputed from `selected` (not a fixed prop) so jumping to a different run via the
  // History tab still shows the right Test Suite siblings for whichever execution is active.
  const siblings = useMemo(() => allExecutions.filter(item => item.runId === selected.runId), [allExecutions, selected.runId]);
  const isPlan = siblings.length > 1;
  const [showList, setShowList] = useState(isPlan);

  const crumbs = [
    { label: 'Executions', onClick: onExit },
    ...(isPlan ? [{ label: 'Test Suite', onClick: () => setShowList(true) }] : []),
    ...(!isPlan || !showList ? [{ label: selected.testName }] : []),
  ];

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-canvas">
      <Breadcrumbs crumbs={crumbs} />
      {isPlan && showList ? (
        <PlanExecutionList executions={siblings} onSelect={next => { setSelected(next); setShowList(false); }} />
      ) : (
        <SingleExecutionView key={selected.id} execution={selected} allExecutions={allExecutions} onSelectExecution={setSelected} />
      )}
    </div>
  );
}
