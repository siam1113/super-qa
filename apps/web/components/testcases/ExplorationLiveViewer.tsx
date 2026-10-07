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
      <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto">
        {live.steps.length === 0 && (
          <p className="flex items-center gap-2 text-xs text-text-secondary"><Loader2 size={12} className="animate-spin" />Waiting for the first page…</p>
        )}
        {live.steps.map(step => (
          <div key={step.stepId} className="rounded-lg border border-border bg-elevated/40 px-2.5 py-1.5 text-left text-xs">
            <p className="truncate font-medium text-text-primary">{step.stepNumber}. {step.description}</p>
            {step.actualResult && <p className="mt-0.5 line-clamp-2 text-[11px] text-text-secondary">{step.actualResult}</p>}
          </div>
        ))}
      </div>
    </div>
  );
}
