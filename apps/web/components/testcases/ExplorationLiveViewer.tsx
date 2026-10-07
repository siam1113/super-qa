'use client';

import { useLiveExecution } from '@/lib/live-execution';
import { Radio, Loader2 } from 'lucide-react';

export function ExplorationLiveViewer({ runId }: { runId: string }) {
  const live = useLiveExecution(runId);

  return (
    <div className="flex h-full min-h-0 w-full flex-col">
      <div className="flex flex-none items-center gap-2 px-1 pb-2 text-xs text-text-secondary">
        <Radio size={12} className={live.connection === 'open' ? 'text-success' : 'text-text-secondary'} />
        {live.connection === 'connecting' && 'Connecting to live exploration…'}
        {live.connection === 'open' && (live.steps.length === 0 ? 'Exploring…' : `Visited ${live.steps.length} page${live.steps.length === 1 ? '' : 's'} so far`)}
        {live.connection === 'closed' && 'Reconnecting…'}
        {live.connection === 'not-found' && 'Exploration finished; designing test cases…'}
      </div>

      <div className="flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-lg bg-black/85">
        {live.latestFrame ? (
          <img src={live.latestFrame} alt="Live browser view" className="max-h-full max-w-full object-contain" />
        ) : (
          <p className="flex items-center gap-2 text-xs text-white/60"><Loader2 size={12} className="animate-spin" />Waiting for the first page…</p>
        )}
      </div>

      <div className="mt-2 max-h-24 flex-none space-y-1 overflow-y-auto">
        {live.steps.map(step => (
          <p key={step.stepId} className="truncate text-left text-[11px] text-text-secondary">
            {step.stepNumber}. {step.description}
          </p>
        ))}
      </div>
    </div>
  );
}
