'use client';

import { useState } from 'react';
import { ChevronLeft, Clock, Globe2, ListChecks, Video, CheckCircle2, XCircle, X } from 'lucide-react';
import { cn, formatDuration, formatMs } from '@/lib/utils';
import { type ExecutionRecord, normalizeSteps, stepData, StatusPill, STEP_ACCENT } from './ExecutionDetailPage';

const API = `${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000'}/api`;

function Lightbox({ src, onClose }: { src: string; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-6" onClick={onClose}>
      <img src={src} alt="Step screenshot, enlarged" className="max-h-full max-w-full rounded-lg" onClick={event => event.stopPropagation()} />
      <button type="button" onClick={onClose} aria-label="Close enlarged screenshot" className="absolute right-5 top-5 text-white/80 transition-colors hover:text-white"><X size={22} /></button>
    </div>
  );
}

function Thumb({ label, src, onOpen }: { label: 'Before' | 'After'; src?: string | null; onOpen: (src: string) => void }) {
  if (!src) return <div className="grid h-14 w-20 flex-none place-items-center rounded-md border border-dashed border-border text-[9px] text-text-secondary">—</div>;
  const url = `data:image/png;base64,${src}`;
  return (
    <button type="button" onClick={() => onOpen(url)} title={`${label} — click to enlarge`} className="group relative h-14 w-20 flex-none overflow-hidden rounded-md border border-border transition-colors hover:border-accent-blue">
      <img src={url} alt={`${label} screenshot`} className="h-full w-full object-cover" />
      <span className="absolute inset-x-0 bottom-0 bg-black/55 px-1 py-0.5 text-center text-[8px] font-semibold uppercase tracking-wide text-white">{label}</span>
    </button>
  );
}

function HighlightStat({ label, value, icon, tone }: { label: string; value: React.ReactNode; icon: React.ReactNode; tone?: 'green' | 'red' }) {
  const toneClass = tone === 'green' ? 'text-success bg-success/10' : tone === 'red' ? 'text-danger bg-danger/10' : 'text-accent-blue bg-accent-blue/10';
  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs font-medium text-text-secondary">{label}</p>
        <span className={cn('flex h-8 w-8 items-center justify-center rounded-lg', toneClass)}>{icon}</span>
      </div>
      <p className="mt-3 text-xl font-semibold tracking-tight text-text-primary">{value}</p>
    </div>
  );
}

export function ReportDetailPage({ execution, onExit }: { execution: ExecutionRecord; onExit: () => void }) {
  const { steps } = normalizeSteps(execution);
  const result = execution.result as ExecutionRecord['result'];
  const videoKey = (result as any)?.videoKey as string | null | undefined;
  const videoUrl = videoKey ? `${API}/storage/download?key=${encodeURIComponent(videoKey)}` : null;
  const [lightbox, setLightbox] = useState<string | null>(null);

  const passedCount = steps.filter(step => step.status === 'passed').length;
  const failedCount = steps.filter(step => step.status === 'failed' || step.status === 'error').length;

  return (
    <div className="flex h-full min-h-0 flex-col overflow-y-auto bg-canvas">
      <div className="flex flex-none items-center gap-3 border-b border-border bg-surface px-5 py-3.5">
        <button type="button" onClick={onExit} className="flex items-center gap-1.5 text-sm text-text-secondary transition-colors hover:text-text-primary">
          <ChevronLeft size={16} />Reports
        </button>
      </div>

      <div className="space-y-5 p-5 md:p-7">
        <div className="flex flex-wrap items-start justify-between gap-4 rounded-xl border border-border bg-surface p-5">
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-[.18em] text-accent-blue">Test report</p>
            <h1 className="mt-1 text-xl font-semibold tracking-tight text-text-primary">{execution.testName}</h1>
            <p className="mt-1 flex flex-wrap items-center gap-3 text-xs text-text-secondary">
              <span className="font-mono">{execution.id}</span>
              <span className="capitalize">{execution.environment} · {execution.browser}</span>
              <span className="tabular-nums">{new Date(execution.createdAt).toLocaleString()}</span>
            </p>
          </div>
          <StatusPill status={execution.status} />
        </div>

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <HighlightStat label="Duration" value={execution.duration != null ? formatDuration(execution.duration) : '—'} icon={<Clock size={15} />} />
          <HighlightStat label="Steps passed" value={`${passedCount} / ${steps.length}`} icon={<CheckCircle2 size={15} />} tone="green" />
          <HighlightStat label="Steps failed" value={failedCount} icon={<XCircle size={15} />} tone={failedCount ? 'red' : undefined} />
          <HighlightStat label="Environment" value={<span className="capitalize">{execution.environment} · {execution.browser}</span>} icon={<Globe2 size={15} />} />
        </div>

        <section className="overflow-hidden rounded-xl border border-border bg-surface">
          <div className="flex items-center gap-2 border-b border-border px-5 py-3.5">
            <ListChecks size={15} className="text-text-secondary" />
            <h2 className="text-sm font-semibold">Test steps</h2>
            <span className="ml-auto text-xs text-text-secondary">{steps.length} step{steps.length === 1 ? '' : 's'}</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[980px] text-left text-sm">
              <thead className="bg-canvas/65 text-[10px] font-semibold uppercase tracking-[.12em] text-text-secondary">
                <tr>
                  <th className="w-12 px-4 py-2.5">Step</th>
                  <th className="px-3 py-2.5">Action</th>
                  <th className="px-3 py-2.5">Data</th>
                  <th className="px-3 py-2.5">Expected</th>
                  <th className="px-3 py-2.5">Actual</th>
                  <th className="px-3 py-2.5">Status</th>
                  <th className="px-3 py-2.5">Before</th>
                  <th className="px-3 py-2.5">After</th>
                  <th className="px-4 py-2.5 text-right">Duration</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {steps.map(step => {
                  const before = step.actions.find(action => action.screenshotBefore)?.screenshotBefore;
                  const after = step.actions.slice().reverse().find(action => action.screenshotAfter)?.screenshotAfter;
                  const accent = STEP_ACCENT[step.status] || STEP_ACCENT.pending;
                  return (
                    <tr key={step.number} className={cn('border-l-2 align-top text-xs', accent)}>
                      <td className="px-4 py-3 tabular-nums text-text-secondary">{step.number}</td>
                      <td className="max-w-[200px] px-3 py-3 font-medium text-text-primary">{step.description}</td>
                      <td className="max-w-[160px] px-3 py-3 font-mono text-[11px] text-text-secondary">{stepData(step)}</td>
                      <td className="max-w-[200px] px-3 py-3 text-text-secondary">{step.expected || '—'}</td>
                      <td className="max-w-[200px] px-3 py-3 text-text-secondary">{step.actual || step.errorMessage || '—'}</td>
                      <td className="px-3 py-3"><StatusPill status={step.status} /></td>
                      <td className="px-3 py-3"><Thumb label="Before" src={before} onOpen={setLightbox} /></td>
                      <td className="px-3 py-3"><Thumb label="After" src={after} onOpen={setLightbox} /></td>
                      <td className="px-4 py-3 text-right tabular-nums text-text-secondary">{step.durationMs != null ? formatMs(step.durationMs) : '—'}</td>
                    </tr>
                  );
                })}
                {!steps.length && (
                  <tr><td colSpan={9} className="px-5 py-10 text-center text-sm text-text-secondary">No steps were recorded for this execution.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section className="overflow-hidden rounded-xl border border-border bg-surface">
          <div className="flex items-center gap-2 border-b border-border px-5 py-3.5">
            <Video size={15} className="text-text-secondary" />
            <h2 className="text-sm font-semibold">Recording</h2>
          </div>
          <div className="p-5">
            {videoUrl
              ? <video controls className="max-h-[60vh] w-full rounded-lg bg-black" src={videoUrl} />
              : <div className="flex flex-col items-center gap-2.5 rounded-lg border border-dashed border-border px-4 py-10 text-center text-xs text-text-secondary">
                  <Video size={18} />No recording was captured for this execution.
                </div>}
          </div>
        </section>
      </div>

      {lightbox && <Lightbox src={lightbox} onClose={() => setLightbox(null)} />}
    </div>
  );
}
