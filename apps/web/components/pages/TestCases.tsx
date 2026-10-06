'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { cn, getStatusBgColor, getRiskColor, getPriorityColor } from '@/lib/utils';
import { useAppStore } from '@/lib/store';
import type { TestCase } from '@/lib/types';
import {
  Search, Check, ChevronDown, X, ListChecks,
  ShieldAlert, Workflow, ArrowUpRight, Sparkles, Wand2,
} from 'lucide-react';
import { BulkEditTestCasesModal } from '../BulkEditTestCasesModal';
import { GenerateTestCasesWizardModal } from '../testcases/GenerateTestCasesWizardModal';
import { RefineTestCaseWizardModal } from '../testcases/RefineTestCaseWizardModal';

type ReviewState = TestCase & { reviewStatus?: string };

function PriorityBadge({ priority }: { priority: string }) {
  return <span className={cn('inline-flex min-w-8 justify-center rounded-md border px-1.5 py-1 font-mono text-[11px] font-semibold', getPriorityColor(priority))}>{priority}</span>;
}

function AutomationBadge({ automation }: { automation: string }) {
  const labels: Record<string, string> = { automated: 'Automated', partial: 'Partial', manual: 'Manual' };
  return <span className={cn('inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium capitalize', getStatusBgColor(automation))}><span className="h-1.5 w-1.5 rounded-full bg-current"/>{labels[automation] || automation}</span>;
}

function ReviewStatusBadge({ status }: { status?: string }) {
  const value = status || 'draft';
  return <span className={cn('inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium capitalize', getStatusBgColor(value))}><span className="h-1.5 w-1.5 rounded-full bg-current"/>{value}</span>;
}

export function TestCases() {
  const testCases = useAppStore(state => state.testCases);
  const openInspector = useAppStore(state => state.openInspector);
  const setData = useAppStore(state => state.setData);
  const updateTestCase = useAppStore(state => state.updateTestCase);
  const [searchQuery, setSearchQuery] = useState('');
  const [priorityFilter, setPriorityFilter] = useState('all');
  const [automationFilter, setAutomationFilter] = useState('all');
  const [riskFilter, setRiskFilter] = useState('all');
  const [reviewFilter, setReviewFilter] = useState('all');
  const [selectedRows, setSelectedRows] = useState<Set<string>>(new Set());
  const [bulkEditOpen, setBulkEditOpen] = useState(false);
  const [generateOpen, setGenerateOpen] = useState(false);
  const [refineOpen, setRefineOpen] = useState(false);

  const handleGenerated = (created: ReviewState[]) => setData({ testCases: [...testCases, ...created] });
  const handleRefined = (result: ReviewState) => {
    if (testCases.some(testCase => testCase.id === result.id)) updateTestCase(result);
    else setData({ testCases: [...testCases, result] });
  };

  const reviewedCases = testCases as ReviewState[];
  const filteredTestCases = useMemo(() => reviewedCases.filter(testCase => {
    const searchable = `${testCase.title} ${testCase.id} ${testCase.owner} ${testCase.flow} ${testCase.tags.join(' ')}`.toLowerCase();
    return (!searchQuery || searchable.includes(searchQuery.toLowerCase()))
      && (priorityFilter === 'all' || testCase.priority === priorityFilter)
      && (automationFilter === 'all' || testCase.automation === automationFilter)
      && (riskFilter === 'all' || testCase.risk === riskFilter)
      && (reviewFilter === 'all' || testCase.reviewStatus === reviewFilter);
  }), [reviewedCases, searchQuery, priorityFilter, automationFilter, riskFilter, reviewFilter]);

  const activeFilters = [searchQuery, priorityFilter, automationFilter, riskFilter, reviewFilter].filter(value => value && value !== 'all').length;
  const clearFilters = () => { setSearchQuery(''); setPriorityFilter('all'); setAutomationFilter('all'); setRiskFilter('all'); setReviewFilter('all'); };
  const allVisibleSelected = filteredTestCases.length > 0 && filteredTestCases.every(testCase => selectedRows.has(testCase.id));
  const { automatedCount, priorityCases, elevatedRiskCount } = useMemo(() => ({
    automatedCount: testCases.filter(testCase => testCase.automation === 'automated').length,
    priorityCases: testCases.filter(testCase => testCase.priority === 'P0' || testCase.priority === 'P1').length,
    elevatedRiskCount: testCases.filter(testCase => testCase.risk === 'critical' || testCase.risk === 'high').length,
  }), [testCases]);

  const priorityOptions = useMemo(() => ['all', 'P0', 'P1', 'P2', 'P3'].map(value => ({ value, label: value === 'all' ? 'Any priority' : value, count: value === 'all' ? testCases.length : testCases.filter(item => item.priority === value).length })), [testCases]);
  const automationOptions = useMemo(() => [
    { value: 'all', label: 'Any automation', count: testCases.length },
    ...(['automated', 'partial', 'manual'] as const).map(value => ({ value, label: value[0].toUpperCase() + value.slice(1), count: testCases.filter(item => item.automation === value).length })),
  ], [testCases]);
  const riskOptions = useMemo(() => [
    { value: 'all', label: 'Any risk', count: testCases.length },
    ...(['critical', 'high', 'medium', 'low', 'unknown'] as const).map(value => ({ value, label: value === 'unknown' ? 'Unscored' : value[0].toUpperCase() + value.slice(1), count: testCases.filter(item => item.risk === value).length })),
  ], [testCases]);
  const reviewOptions = useMemo(() => [
    { value: 'all', label: 'Any status', count: testCases.length },
    ...(['draft', 'ready', 'approved', 'rejected'] as const).map(value => ({ value, label: value[0].toUpperCase() + value.slice(1), count: reviewedCases.filter(item => item.reviewStatus === value).length })),
  ], [testCases, reviewedCases]);

  const toggleRowSelection = (id: string, event: React.MouseEvent) => {
    event.stopPropagation();
    setSelectedRows(previous => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleAllRows = () => setSelectedRows(previous => {
    const next = new Set(previous);
    if (allVisibleSelected) filteredTestCases.forEach(testCase => next.delete(testCase.id));
    else filteredTestCases.forEach(testCase => next.add(testCase.id));
    return next;
  });

  return <>
    <div className="flex h-full flex-col overflow-y-auto bg-canvas">
    <div className="mx-auto w-full max-w-[1680px] space-y-5 px-4 py-6 sm:px-6 lg:px-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Test cases</h1>
          <p className="mt-1 max-w-xl text-sm leading-5 text-text-secondary">A working library of checks, ownership, and observed outcomes.</p>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => setRefineOpen(true)} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border bg-canvas px-3 text-sm font-medium transition-colors hover:border-border-strong hover:bg-elevated"><Wand2 size={15}/>Refine</button>
          <button type="button" onClick={() => setGenerateOpen(true)} className="ui-button-primary inline-flex h-9 items-center gap-1.5 px-3 text-sm"><Sparkles size={15}/>Generate</button>
        </div>
      </header>

      <section aria-label="Test case overview" className="grid grid-cols-2 overflow-hidden rounded-xl border border-border bg-surface sm:grid-cols-4">
        <OverviewMetric icon={<ListChecks size={16}/>} label="In library" value={testCases.length} hint="Total cases"/>
        <OverviewMetric icon={<Workflow size={16}/>} label="Automated" value={automatedCount} hint={testCases.length ? `${Math.round(automatedCount / testCases.length * 100)}% of library` : 'No cases yet'}/>
        <OverviewMetric icon={<ShieldAlert size={16}/>} label="P0 · P1" value={priorityCases} hint="Highest priority"/>
        <OverviewMetric icon={<ShieldAlert size={16}/>} label="Elevated risk" value={elevatedRiskCount} hint="Critical or high"/>
      </section>

      <section className="overflow-visible rounded-xl border border-border bg-surface">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3.5 sm:px-5">
          <div><h2 className="text-sm font-semibold">Browse library</h2><p className="mt-0.5 text-xs text-text-secondary">Find cases by title, owner, flow, or tag.</p></div>
          <div className="rounded-md bg-elevated px-2.5 py-1.5 text-xs text-text-secondary"><span className="font-semibold text-text-primary">{filteredTestCases.length}</span> of {testCases.length}</div>
        </div>

        <div className="space-y-3 p-4 sm:px-5">
          <div className="flex flex-wrap items-center gap-2.5">
            <div className="relative min-w-[220px] flex-1">
              <Search size={15} aria-hidden="true" className="absolute left-3 top-1/2 -translate-y-1/2 text-text-secondary"/>
              <input type="search" aria-label="Search test cases" placeholder="Search cases…" value={searchQuery} onChange={event => setSearchQuery(event.target.value)} className="h-10 w-full rounded-lg border border-border bg-canvas pl-9 pr-9 text-sm outline-none placeholder:text-text-secondary/70 focus:border-accent-blue focus:ring-2 focus:ring-accent-blue/15"/>
              {searchQuery && <button type="button" aria-label="Clear search" onClick={() => setSearchQuery('')} className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-text-secondary hover:bg-elevated hover:text-text-primary"><X size={13}/></button>}
            </div>
            <DropdownFilter label="Priority" value={priorityFilter} onChange={setPriorityFilter} options={priorityOptions}/>
            <DropdownFilter label="Automation" value={automationFilter} onChange={setAutomationFilter} options={automationOptions}/>
            <DropdownFilter label="Risk" value={riskFilter} onChange={setRiskFilter} options={riskOptions}/>
            <DropdownFilter label="Review" value={reviewFilter} onChange={setReviewFilter} options={reviewOptions}/>
          </div>
          {(activeFilters > 0 || selectedRows.size > 0) && <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
            {activeFilters > 0 ? <>
              <span className="text-xs text-text-secondary">Filters</span>
              {searchQuery && <FilterChip label={`“${searchQuery}”`} onClear={() => setSearchQuery('')}/>}
              {priorityFilter !== 'all' && <FilterChip label={priorityFilter} onClear={() => setPriorityFilter('all')}/>}
              {automationFilter !== 'all' && <FilterChip label={automationFilter} onClear={() => setAutomationFilter('all')}/>}
              {riskFilter !== 'all' && <FilterChip label={`${riskFilter} risk`} onClear={() => setRiskFilter('all')}/>}
              {reviewFilter !== 'all' && <FilterChip label={reviewFilter} onClear={() => setReviewFilter('all')}/>}
              <button type="button" onClick={clearFilters} className="ml-auto inline-flex items-center gap-1 rounded px-2 py-1 text-xs text-text-secondary hover:bg-elevated hover:text-text-primary">Reset filters <X size={12}/></button>
            </> : <><span className="text-xs font-medium text-text-primary">{selectedRows.size} selected</span><button type="button" onClick={() => setBulkEditOpen(true)} className="rounded-md border border-accent-blue/30 bg-accent-blue/5 px-2.5 py-1 text-xs font-medium text-accent-blue hover:bg-accent-blue/10">Bulk edit properties</button><button type="button" onClick={() => setSelectedRows(new Set())} className="text-xs text-text-secondary underline-offset-2 hover:text-text-primary hover:underline">Clear selection</button></>}</div>}
          <div className="sr-only" aria-live="polite">Showing {filteredTestCases.length} of {testCases.length} test cases. {activeFilters ? `${activeFilters} active filters.` : ''}</div>
        </div>

        <div className="overflow-x-auto border-t border-border">
          <table className="w-full min-w-[1040px] text-left">
            <thead className="bg-canvas/70">
              <tr className="text-[11px] font-medium text-text-secondary">
                <th className="w-10 px-4 py-3 sm:px-5"><input type="checkbox" aria-label="Select all visible test cases" checked={allVisibleSelected} onChange={toggleAllRows} className="rounded border-border"/></th>
                <th className="px-3 py-3 font-medium">Case</th><th className="px-3 py-3 font-medium">Priority</th><th className="px-3 py-3 font-medium">Automation</th><th className="px-3 py-3 font-medium">Review status</th><th className="px-3 py-3 font-medium">Owner</th><th className="px-3 py-3 font-medium">Flow</th><th className="px-3 py-3 font-medium">Pass rate</th><th className="px-3 py-3 font-medium">Risk</th><th className="px-5 py-3 text-right font-medium">AI score</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filteredTestCases.map(testCase => <tr key={testCase.id} onClick={() => openInspector('testCase', testCase)} className={cn('group cursor-pointer transition-colors hover:bg-elevated/55 focus-within:bg-elevated/55', selectedRows.has(testCase.id) && 'bg-accent-blue/5')}>
                <td className="px-4 py-3.5 sm:px-5"><input type="checkbox" aria-label={`Select ${testCase.title}`} checked={selectedRows.has(testCase.id)} onClick={event => toggleRowSelection(testCase.id, event)} onChange={() => {}} className="rounded border-border"/></td>
                <td className="max-w-[380px] px-3 py-3.5"><button type="button" onClick={event => { event.stopPropagation(); openInspector('testCase', testCase); }} className="block max-w-full text-left focus-visible:outline-none focus-visible:underline focus-visible:decoration-accent-blue"><span className="block truncate text-sm font-semibold text-text-primary">{testCase.title}</span><span className="mt-1 block font-mono text-[10px] text-text-secondary">{testCase.id.slice(0, 12)}</span></button></td>
                <td className="px-3 py-3.5"><PriorityBadge priority={testCase.priority}/></td>
                <td className="px-3 py-3.5"><AutomationBadge automation={testCase.automation}/></td>
                <td className="px-3 py-3.5"><ReviewStatusBadge status={testCase.reviewStatus}/></td>
                <td className="max-w-[150px] truncate px-3 py-3.5 text-xs text-text-secondary">{testCase.owner || 'Unassigned'}</td>
                <td className="max-w-[180px] truncate px-3 py-3.5 text-xs text-text-secondary">{testCase.flow || 'General'}</td>
                <td className="px-3 py-3.5"><PassRate value={testCase.passRate}/></td>
                <td className="px-3 py-3.5"><span className={cn('text-xs font-medium capitalize', getRiskColor(testCase.risk))}>{testCase.risk === 'unknown' ? 'Unscored' : testCase.risk}</span></td>
                <td className="px-5 py-3.5 text-right"><span className="inline-flex items-center gap-1 text-xs font-medium text-text-secondary">{testCase.aiScore ?? '—'}<ArrowUpRight size={12} className="text-text-secondary/60 opacity-0 transition-opacity group-hover:opacity-100"/></span></td>
              </tr>)}
            </tbody>
          </table>
          {filteredTestCases.length === 0 && <div className="flex flex-col items-center px-5 py-14 text-center">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-elevated text-text-secondary"><Search size={17}/></div>
            <p className="mt-3 text-sm font-semibold">{testCases.length ? 'No matching cases' : 'Your test library is empty'}</p>
            <p className="mt-1 max-w-sm text-xs leading-5 text-text-secondary">{testCases.length ? 'Try a different search or clear your filters.' : 'Add a case to start organizing checks and reviewing their results.'}</p>
            {testCases.length > 0 && activeFilters > 0 && <button type="button" onClick={clearFilters} className="mt-3 rounded-md px-3 py-1.5 text-xs font-medium text-accent-blue hover:bg-accent-blue/10">Reset filters</button>}
          </div>}
        </div>
        <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-border bg-canvas/40 px-4 py-3 text-xs text-text-secondary sm:px-5">
          <span>{selectedRows.size > 0 ? `${selectedRows.size} selected` : `${filteredTestCases.length} cases`}</span>
          <span>{filteredTestCases.length ? `Showing 1–${filteredTestCases.length}` : 'No rows to show'}</span>
        </footer>
      </section>
    </div>
    </div>
    {bulkEditOpen && (
      <BulkEditTestCasesModal
        testCases={testCases.filter(testCase => selectedRows.has(testCase.id))}
        onClose={() => setBulkEditOpen(false)}
      />
    )}
    {generateOpen && (
      <GenerateTestCasesWizardModal
        onClose={() => setGenerateOpen(false)}
        onCreated={handleGenerated}
      />
    )}
    {refineOpen && (
      <RefineTestCaseWizardModal
        testCases={testCases}
        onClose={() => setRefineOpen(false)}
        onApplied={handleRefined}
      />
    )}
  </>;
}

function OverviewMetric({ icon, label, value, hint }: { icon: React.ReactNode; label: string; value: number; hint: string }) {
  return <div className="flex min-w-0 items-center gap-3 border-b border-r border-border px-4 py-4 last:border-r-0 sm:border-b-0 sm:px-5">
    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent-blue/10 text-accent-blue">{icon}</span>
    <div className="min-w-0"><p className="text-xs text-text-secondary">{label}</p><div className="mt-0.5 flex items-baseline gap-2"><span className="text-lg font-semibold leading-5 tracking-tight">{value}</span><span className="truncate text-[10px] text-text-secondary">{hint}</span></div></div>
  </div>;
}

function PassRate({ value }: { value: number | null }) {
  const color = value == null ? 'bg-border' : value >= 90 ? 'bg-success' : value >= 70 ? 'bg-warning' : 'bg-danger';
  return <div className="flex min-w-[112px] items-center gap-2"><div className="h-1.5 w-14 overflow-hidden rounded-full bg-elevated"><div className={cn('h-full rounded-full', color)} style={{ width: `${value ?? 0}%` }}/></div><span className="whitespace-nowrap text-xs text-text-secondary">{value == null ? 'Not run' : `${value}%`}</span></div>;
}

type DropdownOption = { value: string; label: string; count: number };

function DropdownFilter({ label, value, onChange, options }: { label: string; value: string; onChange: (value: string) => void; options: DropdownOption[] }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const selectedOption = options.find(option => option.value === value) || options[0];

  useEffect(() => {
    if (!open) return;
    const closeOnOutside = (event: MouseEvent) => { if (event.target instanceof Node && !rootRef.current?.contains(event.target)) setOpen(false); };
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', closeOnOutside);
    document.addEventListener('keydown', closeOnEscape);
    return () => { document.removeEventListener('mousedown', closeOnOutside); document.removeEventListener('keydown', closeOnEscape); };
  }, [open]);

  return <div ref={rootRef} className="relative">
    <button type="button" aria-label={`${label}: ${selectedOption.label}`} aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen(current => !current)} className={cn('inline-flex h-10 min-w-[142px] items-center justify-between gap-3 rounded-lg border px-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-blue/40', value !== 'all' ? 'border-accent-blue/35 bg-accent-blue/5' : 'border-border bg-canvas hover:bg-elevated')}>
      <span className="min-w-0"><span className="block text-[10px] leading-3 text-text-secondary">{label}</span><span className={cn('block truncate text-xs font-medium leading-4', value !== 'all' ? 'text-accent-blue' : 'text-text-primary')}>{selectedOption.label}</span></span><ChevronDown size={14} className={cn('shrink-0 text-text-secondary transition-transform', open && 'rotate-180')}/>
    </button>
    {open && <div role="listbox" aria-label={`${label} options`} className="absolute left-0 top-full z-30 mt-1.5 w-56 overflow-hidden rounded-lg border border-border bg-surface shadow-xl">
      <div className="border-b border-border px-3 py-2 text-[11px] font-medium text-text-secondary">{label}</div>
      <div className="max-h-64 overflow-y-auto p-1">{options.map(option => <button key={option.value} type="button" role="option" aria-selected={value === option.value} onClick={() => { onChange(option.value); setOpen(false); }} className={cn('flex min-h-9 w-full items-center gap-2 rounded-md px-2 text-left text-xs transition-colors hover:bg-elevated focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-blue/40', value === option.value ? 'text-accent-blue' : 'text-text-primary')}><span className="flex w-4 justify-center">{value === option.value && <Check size={13}/>}</span><span className="min-w-0 flex-1 truncate">{option.label}</span><span className="font-mono text-[10px] text-text-secondary">{option.count}</span></button>)}</div>
    </div>}
  </div>;
}

function FilterChip({ label, onClear }: { label: string; onClear: () => void }) {
  return <button type="button" onClick={onClear} className="inline-flex max-w-[240px] items-center gap-1.5 rounded-md border border-accent-blue/20 bg-accent-blue/5 px-2 py-1 text-xs text-accent-blue transition-colors hover:bg-accent-blue/10"><span className="truncate">{label}</span><X size={11} className="shrink-0"/></button>;
}
