'use client';

import { useState } from 'react';
import { createPortal } from 'react-dom';
import { Search, X, ListPlus } from 'lucide-react';
import { cn, getPriorityColor, getRiskColor } from '@/lib/utils';

type Candidate = { id: string; title: string; flow: string; priority: string; risk?: string | null; reviewStatus: string };

export function AddTestCasesModal({
  candidates,
  initialSelected,
  onClose,
  onConfirm,
}: {
  candidates: Candidate[];
  initialSelected: string[];
  onClose: () => void;
  onConfirm: (ids: string[]) => void;
}) {
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<string[]>(initialSelected);
  const filtered = candidates.filter(test => `${test.title} ${test.flow}`.toLowerCase().includes(query.toLowerCase()));
  const added = selected.filter(id => !initialSelected.includes(id)).length;
  const removed = initialSelected.filter(id => !selected.includes(id)).length;

  if (typeof document === 'undefined') return null;

  return createPortal(
    <div className="ui-backdrop fixed inset-0 z-50 flex items-center justify-center p-4 motion-safe:animate-fade-in" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Add test cases"
        onClick={event => event.stopPropagation()}
        className="ui-dialog-panel relative flex h-[760px] w-[720px] max-w-[94vw] max-h-[90vh] flex-col overflow-hidden motion-safe:animate-modal-in"
      >
        <div className="flex shrink-0 items-start gap-3 border-b border-border p-4">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent-blue/10 text-accent-blue"><ListPlus size={17}/></span>
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-semibold">Add test cases</h2>
            <p className="mt-0.5 text-xs text-text-secondary">Search approved cases and select the ones this plan should run.</p>
          </div>
          <button onClick={onClose} aria-label="Close" className="ui-icon-button"><X size={18}/></button>
        </div>

        <div className="shrink-0 border-b border-border p-3">
          <label className="relative block">
            <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-secondary"/>
            <input autoFocus value={query} onChange={event => setQuery(event.target.value)} placeholder="Search by title or flow…" className="ui-field w-full text-sm" style={{ paddingLeft: '2.25rem', paddingRight: query ? '2.25rem' : undefined }}/>
            {query && <button type="button" aria-label="Clear search" onClick={() => setQuery('')} className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-text-secondary hover:bg-elevated hover:text-text-primary"><X size={13}/></button>}
          </label>
        </div>

        <div className="min-h-0 flex-1 divide-y divide-border overflow-y-auto">
          {filtered.map((test, idx) => {
            const checked = selected.includes(test.id);
            return (
              <label
                key={test.id}
                style={{ animationDelay: `${Math.min(idx, 14) * 18}ms` }}
                className={cn(
                  'flex cursor-pointer items-start gap-3 border-l-2 px-4 py-3 transition motion-safe:animate-row-in hover:translate-x-0.5',
                  checked ? 'border-l-accent-blue bg-accent-blue/5' : 'border-l-transparent hover:bg-elevated/55',
                )}
              >
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={checked}
                  onChange={() => setSelected(ids => (checked ? ids.filter(id => id !== test.id) : [...ids, test.id]))}
                />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium">{test.title}</span>
                  <span className="mt-1.5 flex flex-wrap items-center gap-2 text-[11px] text-text-secondary">
                    <span>{test.flow || 'General'}</span>
                    <span className={cn('inline-flex min-w-7 justify-center rounded border px-1 py-0.5 font-mono text-[10px] font-semibold', getPriorityColor(test.priority))}>{test.priority}</span>
                    {test.risk && <span className={cn('capitalize', getRiskColor(test.risk))}>{test.risk} risk</span>}
                  </span>
                </span>
              </label>
            );
          })}
          {!filtered.length && (
            <p className="p-8 text-center text-sm text-text-secondary">{candidates.length ? 'No cases match this search.' : 'Approve cases in Test Cases to add them here.'}</p>
          )}
        </div>

        <div className="flex shrink-0 items-center justify-between gap-3 border-t border-border p-4">
          <span className="text-xs text-text-secondary">
            {selected.length} selected
            {(added > 0 || removed > 0) && <span className="ml-1.5 text-text-secondary/70">({added > 0 ? `+${added}` : ''}{added > 0 && removed > 0 ? ' ' : ''}{removed > 0 ? `−${removed}` : ''})</span>}
          </span>
          <div className="flex gap-2">
            <button type="button" onClick={onClose} className="ui-button-secondary text-xs">Cancel</button>
            <button type="button" onClick={() => onConfirm(selected)} className="ui-button-primary text-xs">Save selection</button>
          </div>
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
