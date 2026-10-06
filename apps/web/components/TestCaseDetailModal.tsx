'use client';

import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { cn, getPriorityColor, getRiskColor, getStatusBgColor, formatDuration } from '@/lib/utils';
import { useAppStore } from '@/lib/store';
import type { TestCase, Execution } from '@/lib/types';
import {
  X, User, Workflow, Tag, ListChecks, ShieldCheck, History,
  GitCommit, CheckCircle2, XCircle, FileClock, Database, Sparkles,
  Pencil, Plus, Trash2, AlertTriangle, PlayCircle,
} from 'lucide-react';
import { ExecuteMenu } from './execution/ExecuteMenu';
import { LiveExecutionViewer } from './execution/LiveExecutionViewer';
import {
  PRIORITIES, AUTOMATION_TYPES, RISK_LEVELS, STATUSES, CATEGORIES, TECHNIQUES, SEVERITIES, PLATFORMS,
  labelFor, saveTestCase,
} from '@/lib/testCaseFields';

type Tab = 'properties' | 'script' | 'activity' | 'executions';
const TABS: { id: Tab; label: string }[] = [
  { id: 'properties', label: 'Properties' },
  { id: 'script', label: 'Test Script' },
  { id: 'activity', label: 'Activity' },
  { id: 'executions', label: 'Executions' },
];

function SectionHeading({ icon, title }: { icon: React.ReactNode; title: string }) {
  return (
    <h3 className="flex items-center gap-2 text-sm font-medium mb-3 text-text-secondary">
      {icon}
      {title}
    </h3>
  );
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 py-2 border-b border-border/60 last:border-b-0">
      <span className="text-xs text-text-secondary">{label}</span>
      <span className="text-sm text-right truncate max-w-[60%]">{value}</span>
    </div>
  );
}

function formatDate(value?: string | null) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleString();
}

function buildActivity(testCase: TestCase) {
  const entries: Array<{ icon: React.ReactNode; label: string; detail?: string; at: string | null }> = [];
  const created = formatDate(testCase.createdAt);
  if (created) entries.push({ icon: <GitCommit size={14} className="text-accent-blue" />, label: 'Case created', at: created });

  const revision = testCase.revision ?? 1;
  const updated = formatDate(testCase.updatedAt);
  if (revision > 1 && updated) entries.push({ icon: <History size={14} className="text-text-secondary" />, label: `Revised to v${revision}`, at: updated });

  if (testCase.reviewStatus && testCase.reviewStatus !== 'draft') {
    const icons: Record<string, React.ReactNode> = {
      approved: <CheckCircle2 size={14} className="text-success" />,
      rejected: <XCircle size={14} className="text-danger" />,
      ready: <ShieldCheck size={14} className="text-info" />,
    };
    const labels: Record<string, string> = { approved: 'Approved', rejected: 'Rejected', ready: 'Marked ready for review' };
    entries.push({
      icon: icons[testCase.reviewStatus] || <History size={14} className="text-text-secondary" />,
      label: labels[testCase.reviewStatus] || testCase.reviewStatus,
      detail: testCase.reviewedBy ? `by ${testCase.reviewedBy}` : undefined,
      at: updated,
    });
  }

  if (testCase.evidence) entries.push({ icon: <Database size={14} className="text-accent-purple" />, label: 'Grounded to source evidence', detail: testCase.evidence.documentId, at: created });

  return entries.sort((a, b) => (a.at && b.at ? new Date(a.at).getTime() - new Date(b.at).getTime() : 0));
}

function PropertiesTab({ testCase, onSaved }: { testCase: TestCase; onSaved: (testCase: TestCase) => void }) {
  const [editing, setEditing] = useState(false);
  const [owner, setOwner] = useState(testCase.owner || '');
  const [flow, setFlow] = useState(testCase.flow || '');
  const [baseUrl, setBaseUrl] = useState(testCase.baseUrl || '');
  const [priority, setPriority] = useState<TestCase['priority']>(testCase.priority);
  const [automation, setAutomation] = useState<TestCase['automation']>(testCase.automation);
  const [risk, setRisk] = useState<TestCase['risk']>(testCase.risk);
  const [reviewStatus, setReviewStatus] = useState<TestCase['reviewStatus']>(testCase.reviewStatus || 'draft');
  const [category, setCategory] = useState<TestCase['category']>(testCase.category ?? null);
  const [technique, setTechnique] = useState<TestCase['technique']>(testCase.technique ?? null);
  const [severity, setSeverity] = useState<TestCase['severity']>(testCase.severity ?? null);
  const [platform, setPlatform] = useState<TestCase['platform']>(testCase.platform ?? null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const startEditing = () => {
    setOwner(testCase.owner || '');
    setFlow(testCase.flow || '');
    setBaseUrl(testCase.baseUrl || '');
    setPriority(testCase.priority);
    setAutomation(testCase.automation);
    setRisk(testCase.risk);
    setReviewStatus(testCase.reviewStatus || 'draft');
    setCategory(testCase.category ?? null);
    setTechnique(testCase.technique ?? null);
    setSeverity(testCase.severity ?? null);
    setPlatform(testCase.platform ?? null);
    setError('');
    setEditing(true);
  };

  const cancel = () => { setEditing(false); setError(''); };

  const save = async () => {
    setSaving(true);
    setError('');
    try {
      const updated = await saveTestCase(testCase, { owner: owner.trim(), flow: flow.trim(), baseUrl: baseUrl.trim() || null, priority, automation, risk, reviewStatus, category, technique, severity, platform });
      onSaved(updated);
      setEditing(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save changes');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className={cn('px-3 py-1.5 text-sm rounded-full border border-border bg-elevated font-mono font-semibold', getPriorityColor(testCase.priority))}>{testCase.priority}</span>
          <span className={cn('px-3 py-1.5 text-sm rounded-full capitalize', getStatusBgColor(testCase.automation))}>{testCase.automation}</span>
          <span className={cn('px-3 py-1.5 text-sm rounded-full capitalize bg-elevated border border-border', getRiskColor(testCase.risk))}>{testCase.risk === 'unknown' ? 'Unscored risk' : `${testCase.risk} risk`}</span>
          <span className={cn('px-3 py-1.5 text-sm rounded-full capitalize', getStatusBgColor(testCase.reviewStatus || 'draft'))}>{testCase.reviewStatus || 'draft'}</span>
        </div>
        {!editing && (
          <button type="button" onClick={startEditing} className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:bg-elevated">
            <Pencil size={13} /> Edit
          </button>
        )}
      </div>

      {error && <div className="flex items-start gap-2 rounded-lg border border-danger/20 bg-danger/10 p-3 text-sm text-danger"><AlertTriangle size={15} className="mt-0.5 shrink-0" />{error}</div>}

      <div>
        <SectionHeading icon={<Sparkles size={14} />} title="Properties" />
        {!editing ? (
          <div className="bg-elevated border border-border rounded-lg p-4">
            <Field label="Review Status" value={<span className="capitalize">{testCase.reviewStatus || 'draft'}</span>} />
            <Field label="Owner" value={testCase.owner || 'Unassigned'} />
            <Field label="Flow" value={testCase.flow || 'General'} />
            <Field label="Base URL" value={testCase.baseUrl || 'Uses environment default'} />
            <Field label="Priority" value={testCase.priority} />
            <Field label="Automation / Test type" value={<span className="capitalize">{testCase.automation}</span>} />
            <Field label="Risk" value={<span className="capitalize">{testCase.risk === 'unknown' ? 'Unscored' : testCase.risk}</span>} />
            <Field label="Test category" value={testCase.category ? <span className="capitalize">{labelFor(testCase.category)}</span> : 'Not set'} />
            <Field label="Technique" value={testCase.technique ? labelFor(testCase.technique) : 'Not set'} />
            <Field label="Severity" value={testCase.severity ? <span className="capitalize">{testCase.severity}</span> : 'Not set'} />
            <Field label="Platform" value={testCase.platform ? <span className="capitalize">{testCase.platform}</span> : 'Not set'} />
            <Field label="Pass rate" value={testCase.passRate == null ? 'Not run' : `${testCase.passRate}%`} />
            <Field label="Coverage" value={testCase.coverage == null ? 'Not measured' : `${testCase.coverage}%`} />
            <Field label="AI score" value={testCase.aiScore ?? 'Not measured'} />
            <Field label="Last run" value={testCase.lastRun ? formatDate(testCase.lastRun) : 'Never'} />
            <Field label="Revision" value={`v${testCase.revision ?? 1}`} />
            {testCase.reviewedBy && <Field label="Reviewed by" value={testCase.reviewedBy} />}
            {testCase.sourceCaseId && <Field label="Source case" value={testCase.sourceCaseId} />}
            {testCase.workflowArtifactId && <Field label="Workflow artifact" value={testCase.workflowArtifactId} />}
          </div>
        ) : (
          <div className="bg-elevated border border-border rounded-lg p-4 space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-xs text-text-secondary">Review Status</label>
                <select value={reviewStatus} onChange={event => setReviewStatus(event.target.value as TestCase['reviewStatus'])} className="mt-1 w-full rounded-md border border-border bg-canvas px-3 py-2 text-sm capitalize outline-none focus:border-accent-blue">
                  {STATUSES.map(value => <option key={value} value={value} className="capitalize">{value}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs text-text-secondary">Owner</label>
                <input value={owner} onChange={event => setOwner(event.target.value)} placeholder="Unassigned" className="mt-1 w-full rounded-md border border-border bg-canvas px-3 py-2 text-sm outline-none focus:border-accent-blue" />
              </div>
              <div>
                <label className="text-xs text-text-secondary">Flow</label>
                <input value={flow} onChange={event => setFlow(event.target.value)} placeholder="General" className="mt-1 w-full rounded-md border border-border bg-canvas px-3 py-2 text-sm outline-none focus:border-accent-blue" />
              </div>
              <div>
                <label className="text-xs text-text-secondary">Base URL (overrides environment default)</label>
                <input value={baseUrl} onChange={event => setBaseUrl(event.target.value)} placeholder="https://staging.example.com" className="mt-1 w-full rounded-md border border-border bg-canvas px-3 py-2 text-sm font-mono outline-none focus:border-accent-blue" />
              </div>
              <div>
                <label className="text-xs text-text-secondary">Priority</label>
                <select value={priority} onChange={event => setPriority(event.target.value as TestCase['priority'])} className="mt-1 w-full rounded-md border border-border bg-canvas px-3 py-2 text-sm outline-none focus:border-accent-blue">
                  {PRIORITIES.map(value => <option key={value} value={value}>{value}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs text-text-secondary">Automation / Test type</label>
                <select value={automation} onChange={event => setAutomation(event.target.value as TestCase['automation'])} className="mt-1 w-full rounded-md border border-border bg-canvas px-3 py-2 text-sm capitalize outline-none focus:border-accent-blue">
                  {AUTOMATION_TYPES.map(value => <option key={value} value={value} className="capitalize">{value}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs text-text-secondary">Risk</label>
                <select value={risk === 'unknown' ? '' : risk} onChange={event => setRisk((event.target.value || 'unknown') as TestCase['risk'])} className="mt-1 w-full rounded-md border border-border bg-canvas px-3 py-2 text-sm capitalize outline-none focus:border-accent-blue">
                  <option value="">Unscored</option>
                  {RISK_LEVELS.map(value => <option key={value} value={value} className="capitalize">{value}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs text-text-secondary">Test category</label>
                <select value={category || ''} onChange={event => setCategory((event.target.value || null) as TestCase['category'])} className="mt-1 w-full rounded-md border border-border bg-canvas px-3 py-2 text-sm outline-none focus:border-accent-blue">
                  <option value="">Not set</option>
                  {CATEGORIES.map(value => <option key={value} value={value}>{labelFor(value)}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs text-text-secondary">Technique</label>
                <select value={technique || ''} onChange={event => setTechnique((event.target.value || null) as TestCase['technique'])} className="mt-1 w-full rounded-md border border-border bg-canvas px-3 py-2 text-sm outline-none focus:border-accent-blue">
                  <option value="">Not set</option>
                  {TECHNIQUES.map(value => <option key={value} value={value}>{labelFor(value)}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs text-text-secondary">Severity</label>
                <select value={severity || ''} onChange={event => setSeverity((event.target.value || null) as TestCase['severity'])} className="mt-1 w-full rounded-md border border-border bg-canvas px-3 py-2 text-sm capitalize outline-none focus:border-accent-blue">
                  <option value="">Not set</option>
                  {SEVERITIES.map(value => <option key={value} value={value} className="capitalize">{value}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs text-text-secondary">Platform</label>
                <select value={platform || ''} onChange={event => setPlatform((event.target.value || null) as TestCase['platform'])} className="mt-1 w-full rounded-md border border-border bg-canvas px-3 py-2 text-sm capitalize outline-none focus:border-accent-blue">
                  <option value="">Not set</option>
                  {PLATFORMS.map(value => <option key={value} value={value} className="capitalize">{value}</option>)}
                </select>
              </div>
            </div>
          </div>
        )}
      </div>

      {testCase.tags && testCase.tags.length > 0 && (
        <div>
          <SectionHeading icon={<Tag size={14} />} title="Tags" />
          <div className="flex flex-wrap gap-2">
            {testCase.tags.map((tag) => (
              <span key={tag} className="px-3 py-1 text-sm rounded-full bg-elevated border border-border">{tag}</span>
            ))}
          </div>
        </div>
      )}

      {editing && (
        <div className="flex items-center justify-end gap-2 pt-2 border-t border-border">
          <button type="button" onClick={cancel} disabled={saving} className="px-4 py-2 text-sm font-medium rounded-lg hover:bg-elevated disabled:opacity-40">Cancel</button>
          <button type="button" onClick={save} disabled={saving} className="px-4 py-2 text-sm font-medium rounded-lg bg-accent-blue text-white disabled:opacity-40">{saving ? 'Saving…' : 'Save changes'}</button>
        </div>
      )}
    </div>
  );
}

type DraftStep = { action: string; expected: string };

function TestScriptTab({ testCase, onSaved }: { testCase: TestCase; onSaved: (testCase: TestCase) => void }) {
  const [editing, setEditing] = useState(false);
  const [preconditions, setPreconditions] = useState<string[]>(testCase.preconditions || []);
  const [steps, setSteps] = useState<DraftStep[]>(testCase.steps && testCase.steps.length ? testCase.steps : [{ action: '', expected: '' }]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const startEditing = () => {
    setPreconditions(testCase.preconditions && testCase.preconditions.length ? [...testCase.preconditions] : []);
    setSteps(testCase.steps && testCase.steps.length ? testCase.steps.map(step => ({ ...step })) : [{ action: '', expected: '' }]);
    setError('');
    setEditing(true);
  };

  const cancel = () => { setEditing(false); setError(''); };

  const save = async () => {
    const cleanedSteps = steps.map(step => ({ action: step.action.trim(), expected: step.expected.trim() })).filter(step => step.action || step.expected);
    const cleanedPreconditions = preconditions.map(item => item.trim()).filter(Boolean);
    if (!cleanedSteps.length) { setError('At least one step is required.'); return; }
    if (cleanedSteps.some(step => !step.action || !step.expected)) { setError('Every step needs both an action and an expected result.'); return; }

    setSaving(true);
    setError('');
    try {
      const updated = await saveTestCase(testCase, { steps: cleanedSteps, preconditions: cleanedPreconditions });
      onSaved(updated);
      setEditing(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save changes');
    } finally {
      setSaving(false);
    }
  };

  if (!editing) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <p className="text-xs text-text-secondary">Preconditions and steps that make up this case's script.</p>
          <button type="button" onClick={startEditing} className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:bg-elevated">
            <Pencil size={13} /> Edit
          </button>
        </div>

        <div>
          <SectionHeading icon={<ShieldCheck size={14} />} title="Preconditions" />
          {testCase.preconditions && testCase.preconditions.length > 0 ? (
            <ul className="space-y-2">
              {testCase.preconditions.map((item, idx) => (
                <li key={idx} className="flex items-start gap-2 text-sm bg-elevated border border-border rounded-lg p-3">
                  <span className="text-accent-blue mt-0.5">•</span>
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          ) : <p className="text-sm text-text-secondary">No preconditions recorded.</p>}
        </div>

        <div>
          <SectionHeading icon={<ListChecks size={14} />} title="Steps" />
          {testCase.steps && testCase.steps.length > 0 ? (
            <div className="space-y-2">
              {testCase.steps.map((step, idx) => (
                <div key={idx} className="bg-elevated border border-border rounded-lg p-3">
                  <div className="flex items-start gap-3">
                    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent-blue/10 text-accent-blue text-[11px] font-semibold">{idx + 1}</span>
                    <div className="flex-1 min-w-0 space-y-1.5">
                      <div><span className="text-xs text-text-secondary">Action: </span><span className="text-sm">{step.action}</span></div>
                      <div><span className="text-xs text-text-secondary">Expected: </span><span className="text-sm">{step.expected}</span></div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : <p className="text-sm text-text-secondary">No steps recorded.</p>}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {error && <div className="flex items-start gap-2 rounded-lg border border-danger/20 bg-danger/10 p-3 text-sm text-danger"><AlertTriangle size={15} className="mt-0.5 shrink-0" />{error}</div>}
      {testCase.evidence && <div className="flex items-start gap-2 rounded-lg border border-warning/20 bg-warning/10 p-3 text-xs text-warning"><AlertTriangle size={15} className="mt-0.5 shrink-0" />This case is grounded to source evidence. Changing its steps or preconditions may be rejected unless the evidence is re-imported.</div>}

      <div>
        <div className="flex items-center justify-between mb-3">
          <SectionHeading icon={<ShieldCheck size={14} />} title="Preconditions" />
          <button type="button" onClick={() => setPreconditions(prev => [...prev, ''])} className="inline-flex items-center gap-1 text-xs font-medium text-accent-blue hover:underline"><Plus size={13} /> Add precondition</button>
        </div>
        <div className="space-y-2">
          {preconditions.length === 0 && <p className="text-sm text-text-secondary">No preconditions yet.</p>}
          {preconditions.map((item, idx) => (
            <div key={idx} className="flex items-start gap-2">
              <input
                value={item}
                onChange={event => setPreconditions(prev => prev.map((value, i) => (i === idx ? event.target.value : value)))}
                placeholder="e.g. User is logged in"
                className="flex-1 rounded-md border border-border bg-canvas px-3 py-2 text-sm outline-none focus:border-accent-blue"
              />
              <button type="button" onClick={() => setPreconditions(prev => prev.filter((_, i) => i !== idx))} aria-label="Remove precondition" className="p-2 text-text-secondary hover:text-danger"><Trash2 size={15} /></button>
            </div>
          ))}
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between mb-3">
          <SectionHeading icon={<ListChecks size={14} />} title="Steps" />
          <button type="button" onClick={() => setSteps(prev => [...prev, { action: '', expected: '' }])} className="inline-flex items-center gap-1 text-xs font-medium text-accent-blue hover:underline"><Plus size={13} /> Add step</button>
        </div>
        <div className="space-y-3">
          {steps.map((step, idx) => (
            <div key={idx} className="bg-elevated border border-border rounded-lg p-3">
              <div className="flex items-start gap-3">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent-blue/10 text-accent-blue text-[11px] font-semibold mt-1.5">{idx + 1}</span>
                <div className="flex-1 min-w-0 space-y-2">
                  <div>
                    <label className="text-xs text-text-secondary">Action</label>
                    <textarea
                      value={step.action}
                      onChange={event => setSteps(prev => prev.map((value, i) => (i === idx ? { ...value, action: event.target.value } : value)))}
                      rows={1}
                      placeholder="What does the tester do?"
                      className="mt-1 w-full resize-y rounded-md border border-border bg-canvas px-3 py-2 text-sm outline-none focus:border-accent-blue"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-text-secondary">Expected</label>
                    <textarea
                      value={step.expected}
                      onChange={event => setSteps(prev => prev.map((value, i) => (i === idx ? { ...value, expected: event.target.value } : value)))}
                      rows={1}
                      placeholder="What should happen?"
                      className="mt-1 w-full resize-y rounded-md border border-border bg-canvas px-3 py-2 text-sm outline-none focus:border-accent-blue"
                    />
                  </div>
                </div>
                <button type="button" onClick={() => setSteps(prev => prev.filter((_, i) => i !== idx))} aria-label="Remove step" className="p-2 text-text-secondary hover:text-danger"><Trash2 size={15} /></button>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="flex items-center justify-end gap-2 pt-2 border-t border-border">
        <button type="button" onClick={cancel} disabled={saving} className="px-4 py-2 text-sm font-medium rounded-lg hover:bg-elevated disabled:opacity-40">Cancel</button>
        <button type="button" onClick={save} disabled={saving} className="px-4 py-2 text-sm font-medium rounded-lg bg-accent-blue text-white disabled:opacity-40">{saving ? 'Saving…' : 'Save changes'}</button>
      </div>
    </div>
  );
}

function ExecutionsTab({ testCase, onOpenExecution }: { testCase: TestCase; onOpenExecution: (execution: Execution) => void }) {
  const executions = useAppStore(state => state.executions).filter(execution => execution.testId === testCase.id);

  if (!executions.length) return <p className="text-sm text-text-secondary">No executions recorded for this case yet.</p>;

  return (
    <div className="space-y-2">
      {executions.map((execution, idx) => (
        <button
          type="button"
          key={idx}
          onClick={() => onOpenExecution(execution)}
          className="w-full flex items-center justify-between gap-3 rounded-lg border border-border bg-elevated p-3 text-left hover:border-accent-blue/40"
        >
          <div className="flex items-center gap-3 min-w-0">
            <span className={cn('inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium capitalize', getStatusBgColor(execution.status))}><PlayCircle size={12} />{execution.status}</span>
            <div className="min-w-0">
              <p className="text-sm truncate">{execution.browser} · {execution.environment}</p>
              <p className="text-xs text-text-secondary">{execution.startedAt ? formatDate(execution.startedAt) : 'Not started'}</p>
            </div>
          </div>
          <span className="text-xs text-text-secondary whitespace-nowrap">{execution.duration == null ? 'Not measured' : formatDuration(execution.duration)}</span>
        </button>
      ))}
    </div>
  );
}

export function TestCaseDetailModal({ testCase: initialTestCase, initialTab, onClose }: { testCase: TestCase; initialTab?: string; onClose: () => void }) {
  const [testCase, setTestCase] = useState(initialTestCase);
  const [activeTab, setActiveTab] = useState<Tab>((initialTab as Tab) && TABS.some(tab => tab.id === initialTab) ? (initialTab as Tab) : 'properties');
  const [viewingRun, setViewingRun] = useState<{ runId: string; testName: string } | null>(null);
  const updateTestCase = useAppStore(state => state.updateTestCase);
  const openInspector = useAppStore(state => state.openInspector);
  const activity = useMemo(() => buildActivity(testCase), [testCase]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const handleSaved = (updated: TestCase) => {
    setTestCase(updated);
    updateTestCase(updated);
  };

  const openExecution = (execution: Execution) => {
    onClose();
    openInspector('execution', execution);
  };

  if (typeof document === 'undefined') return null;

  const modal = createPortal(
    <div className="fixed inset-0 ui-backdrop z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={testCase.title}
        onClick={(event) => event.stopPropagation()}
        className="ui-dialog-panel w-[1100px] max-w-[96vw] h-[820px] max-h-[94vh] overflow-hidden flex flex-col"
      >
        <div className="flex shrink-0 items-start justify-between p-6 border-b border-border">
          <div className="flex-1 min-w-0">
            <h2 className="text-2xl font-semibold mb-1">{testCase.title}</h2>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-text-secondary">
              <span className="font-mono text-xs">{testCase.id}</span>
              {testCase.flow && (
                <span className="inline-flex items-center gap-1">
                  <Workflow size={13} />
                  {testCase.flow}
                </span>
              )}
              {testCase.owner && (
                <span className="inline-flex items-center gap-1">
                  <User size={13} />
                  {testCase.owner}
                </span>
              )}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-3 ml-4">
            <ExecuteMenu testCase={testCase} onRunStarted={run => setViewingRun(run)} />
            <button onClick={onClose} className="text-text-secondary hover:text-text-primary transition-colors">
              <X size={24} />
            </button>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-1 px-6 border-b border-border overflow-x-auto">
          {TABS.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                'px-3 py-2.5 text-sm whitespace-nowrap transition-colors border-b-2 -mb-px',
                activeTab === tab.id ? 'text-accent-blue border-accent-blue' : 'border-transparent text-text-secondary hover:text-text-primary',
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto p-6">
          {activeTab === 'properties' && <PropertiesTab testCase={testCase} onSaved={handleSaved} />}

          {activeTab === 'script' && <TestScriptTab testCase={testCase} onSaved={handleSaved} />}

          {activeTab === 'activity' && (
            <div>
              <SectionHeading icon={<FileClock size={14} />} title="Activity" />
              {activity.length === 0 ? (
                <p className="text-sm text-text-secondary">No recorded activity yet.</p>
              ) : (
                <div className="space-y-3">
                  {activity.map((entry, idx) => (
                    <div key={idx} className="flex items-start gap-3 text-sm">
                      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-elevated border border-border">{entry.icon}</span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-baseline justify-between gap-2">
                          <span>{entry.label}{entry.detail ? ` ${entry.detail}` : ''}</span>
                          {entry.at && <span className="text-xs text-text-secondary whitespace-nowrap">{entry.at}</span>}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {activeTab === 'executions' && <ExecutionsTab testCase={testCase} onOpenExecution={openExecution} />}
        </div>
      </div>
    </div>,
    document.body,
  );

  return (
    <>
      {modal}
      {viewingRun && <LiveExecutionViewer runId={viewingRun.runId} testName={viewingRun.testName} onClose={() => setViewingRun(null)} />}
    </>
  );
}
