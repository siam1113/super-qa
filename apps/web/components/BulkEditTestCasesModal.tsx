'use client';

import { useState } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@/lib/utils';
import { useAppStore } from '@/lib/store';
import type { TestCase } from '@/lib/types';
import {
  PRIORITIES, AUTOMATION_TYPES, RISK_LEVELS, STATUSES, CATEGORIES, TECHNIQUES, SEVERITIES, PLATFORMS,
  labelFor, saveTestCase, type SaveOverrides,
} from '@/lib/testCaseFields';
import { X, AlertTriangle, CheckCircle2 } from 'lucide-react';

type FieldKey = 'reviewStatus' | 'owner' | 'flow' | 'priority' | 'automation' | 'risk' | 'category' | 'technique' | 'severity' | 'platform';

type FieldConfig = {
  key: FieldKey;
  label: string;
  kind: 'text' | 'select';
  options?: readonly string[];
  emptyLabel?: string;
  capitalize?: boolean;
};

const FIELDS: FieldConfig[] = [
  { key: 'reviewStatus', label: 'Review Status', kind: 'select', options: STATUSES, capitalize: true },
  { key: 'owner', label: 'Owner', kind: 'text' },
  { key: 'flow', label: 'Flow', kind: 'text' },
  { key: 'priority', label: 'Priority', kind: 'select', options: PRIORITIES },
  { key: 'automation', label: 'Automation / Test type', kind: 'select', options: AUTOMATION_TYPES, capitalize: true },
  { key: 'risk', label: 'Risk', kind: 'select', options: RISK_LEVELS, emptyLabel: 'Unscored', capitalize: true },
  { key: 'category', label: 'Test category', kind: 'select', options: CATEGORIES, emptyLabel: 'Not set' },
  { key: 'technique', label: 'Technique', kind: 'select', options: TECHNIQUES, emptyLabel: 'Not set' },
  { key: 'severity', label: 'Severity', kind: 'select', options: SEVERITIES, emptyLabel: 'Not set', capitalize: true },
  { key: 'platform', label: 'Platform', kind: 'select', options: PLATFORMS, emptyLabel: 'Not set', capitalize: true },
];

type Result = { id: string; title: string; ok: boolean; message?: string };

export function BulkEditTestCasesModal({ testCases, onClose }: { testCases: TestCase[]; onClose: () => void }) {
  const updateTestCases = useAppStore(state => state.updateTestCases);
  const [enabled, setEnabled] = useState<Partial<Record<FieldKey, boolean>>>({});
  const [values, setValues] = useState<Partial<Record<FieldKey, string>>>({});
  const [applying, setApplying] = useState(false);
  const [results, setResults] = useState<Result[] | null>(null);

  const toggleField = (key: FieldKey) => setEnabled(prev => ({ ...prev, [key]: !prev[key] }));
  const setValue = (key: FieldKey, value: string) => setValues(prev => ({ ...prev, [key]: value }));

  const selectedFieldCount = FIELDS.filter(field => enabled[field.key]).length;

  const apply = async () => {
    const overrides: SaveOverrides = {};
    if (enabled.reviewStatus) overrides.reviewStatus = (values.reviewStatus || 'draft') as TestCase['reviewStatus'];
    if (enabled.owner) overrides.owner = values.owner || '';
    if (enabled.flow) overrides.flow = values.flow || '';
    if (enabled.priority) overrides.priority = (values.priority || 'P2') as TestCase['priority'];
    if (enabled.automation) overrides.automation = (values.automation || 'manual') as TestCase['automation'];
    if (enabled.risk) overrides.risk = (values.risk || 'unknown') as TestCase['risk'];
    if (enabled.category) overrides.category = (values.category || null) as TestCase['category'];
    if (enabled.technique) overrides.technique = (values.technique || null) as TestCase['technique'];
    if (enabled.severity) overrides.severity = (values.severity || null) as TestCase['severity'];
    if (enabled.platform) overrides.platform = (values.platform || null) as TestCase['platform'];

    setApplying(true);
    setResults(null);
    const outcomes = await Promise.allSettled(testCases.map(testCase => saveTestCase(testCase, overrides)));
    const updated: TestCase[] = [];
    const settled: Result[] = outcomes.map((outcome, idx) => {
      const testCase = testCases[idx];
      if (outcome.status === 'fulfilled') {
        updated.push(outcome.value);
        return { id: testCase.id, title: testCase.title, ok: true };
      }
      return { id: testCase.id, title: testCase.title, ok: false, message: outcome.reason instanceof Error ? outcome.reason.message : 'Failed to save' };
    });
    if (updated.length) updateTestCases(updated);
    setResults(settled);
    setApplying(false);
  };

  const failureCount = results ? results.filter(result => !result.ok).length : 0;

  return createPortal(
    <div className="fixed inset-0 ui-backdrop z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Bulk edit test cases"
        onClick={(event) => event.stopPropagation()}
        className="ui-dialog-panel w-[640px] max-w-[94vw] max-h-[88vh] overflow-hidden flex flex-col"
      >
        <div className="flex shrink-0 items-start justify-between p-6 border-b border-border">
          <div>
            <h2 className="text-xl font-semibold mb-1">Bulk edit properties</h2>
            <p className="text-sm text-text-secondary">Applying changes to <span className="font-semibold text-text-primary">{testCases.length}</span> selected case{testCases.length === 1 ? '' : 's'}.</p>
          </div>
          <button onClick={onClose} className="text-text-secondary hover:text-text-primary transition-colors">
            <X size={22} />
          </button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto p-6 space-y-3">
          <p className="text-xs text-text-secondary">Turn on the properties you want to overwrite, set a value, then apply. Unchecked properties are left untouched.</p>

          {FIELDS.map(field => (
            <div key={field.key} className={cn('flex items-center gap-3 rounded-lg border p-3', enabled[field.key] ? 'border-accent-blue/40 bg-accent-blue/5' : 'border-border bg-elevated')}>
              <input
                type="checkbox"
                checked={!!enabled[field.key]}
                onChange={() => toggleField(field.key)}
                aria-label={`Apply ${field.label}`}
                className="rounded border-border"
              />
              <span className="w-44 shrink-0 text-sm font-medium">{field.label}</span>
              {field.kind === 'text' ? (
                <input
                  value={values[field.key] || ''}
                  onChange={event => setValue(field.key, event.target.value)}
                  disabled={!enabled[field.key]}
                  placeholder={`New ${field.label.toLowerCase()}`}
                  className="flex-1 rounded-md border border-border bg-canvas px-3 py-1.5 text-sm outline-none focus:border-accent-blue disabled:opacity-50"
                />
              ) : (
                <select
                  value={values[field.key] || ''}
                  onChange={event => setValue(field.key, event.target.value)}
                  disabled={!enabled[field.key]}
                  className={cn('flex-1 rounded-md border border-border bg-canvas px-3 py-1.5 text-sm outline-none focus:border-accent-blue disabled:opacity-50', field.capitalize && 'capitalize')}
                >
                  {field.emptyLabel && <option value="">{field.emptyLabel}</option>}
                  {field.options!.map(value => <option key={value} value={value} className={field.capitalize ? 'capitalize' : undefined}>{field.key === 'category' || field.key === 'technique' ? labelFor(value) : value}</option>)}
                </select>
              )}
            </div>
          ))}

          {results && (
            <div className="space-y-2 pt-2">
              {failureCount === 0 ? (
                <div className="flex items-center gap-2 rounded-lg border border-success/20 bg-success/10 p-3 text-sm text-success"><CheckCircle2 size={15} />All {results.length} cases updated.</div>
              ) : (
                <div className="flex items-start gap-2 rounded-lg border border-danger/20 bg-danger/10 p-3 text-sm text-danger">
                  <AlertTriangle size={15} className="mt-0.5 shrink-0" />
                  <div>
                    <p>{results.length - failureCount} updated, {failureCount} failed.</p>
                    <ul className="mt-1 space-y-0.5 text-xs">
                      {results.filter(result => !result.ok).map(result => <li key={result.id}>{result.title}: {result.message}</li>)}
                    </ul>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="flex shrink-0 items-center justify-end gap-2 p-6 border-t border-border">
          <button type="button" onClick={onClose} className="px-4 py-2 text-sm font-medium rounded-lg hover:bg-elevated">Close</button>
          <button
            type="button"
            onClick={apply}
            disabled={applying || selectedFieldCount === 0}
            className="px-4 py-2 text-sm font-medium rounded-lg bg-accent-blue text-white disabled:opacity-40"
          >
            {applying ? 'Applying…' : `Apply to ${testCases.length} case${testCases.length === 1 ? '' : 's'}`}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
