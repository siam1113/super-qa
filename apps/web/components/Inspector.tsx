'use client';

import { cn, getStatusBgColor, getRiskColor, formatDuration } from '@/lib/utils';
import { useAppStore } from '@/lib/store';
import type { TestCase, Execution, HealingSuggestion, Flow, Fact } from '@/lib/types';
import { X, ExternalLink, Copy, Check, AlertTriangle, Clock, User, Tag } from 'lucide-react';
import { useState } from 'react';
import { TestCaseDetailModal } from './TestCaseDetailModal';

function TestCaseInspector({ data, onOpenDetail }: { data: TestCase; onOpenDetail: (tab?: string) => void }) {
  const [activeTab, setActiveTab] = useState('overview');

  const tabs = ['Overview', 'Steps'];

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex shrink-0 gap-2 px-4 border-b border-border overflow-x-auto">
        {tabs.map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab.toLowerCase())}
            className={cn(
              'px-3 py-2 text-sm whitespace-nowrap transition-colors',
              activeTab === tab.toLowerCase()
                ? 'text-accent-blue border-b-2 border-accent-blue'
                : 'text-text-secondary hover:text-text-primary'
            )}
          >
            {tab}
          </button>
        ))}
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-4">
        {activeTab === 'steps' && (
          <>
            <button
              type="button"
              onClick={() => onOpenDetail('script')}
              className="w-full rounded-md border border-dashed border-border px-3 py-2 text-xs font-medium text-accent-blue hover:bg-accent-blue/5"
            >
              Edit script in detailed view →
            </button>
            {data.preconditions && data.preconditions.length > 0 && (
              <div>
                <h4 className="text-sm font-medium text-text-secondary mb-2">Preconditions</h4>
                <ul className="space-y-1.5">
                  {data.preconditions.map((item, idx) => (
                    <li key={idx} className="flex items-start gap-2 text-sm rounded-md bg-elevated px-2.5 py-2">
                      <span className="text-accent-blue mt-0.5">•</span>
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {data.steps && data.steps.length > 0 ? (
              <div>
                <h4 className="text-sm font-medium text-text-secondary mb-2">Steps</h4>
                <div className="space-y-2">
                  {data.steps.map((step, idx) => (
                    <div key={idx} className="rounded-md bg-elevated px-2.5 py-2">
                      <div className="flex items-start gap-2">
                        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent-blue/10 text-accent-blue text-[10px] font-semibold">{idx + 1}</span>
                        <div className="flex-1 min-w-0 space-y-1 text-sm">
                          <p><span className="text-text-secondary">Action: </span>{step.action}</p>
                          <p><span className="text-text-secondary">Expected: </span>{step.expected}</p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : <p className="text-sm text-text-secondary">No steps recorded yet.</p>}
          </>
        )}
        {activeTab === 'overview' && (
          <>
            <div>
              <h4 className="text-sm font-medium text-text-secondary mb-2">Details</h4>
              <div className="space-y-2">
                <div className="flex justify-between">
                  <span className="text-text-secondary text-sm">Priority</span>
                  <span className={cn('text-sm font-medium', data.priority === 'P0' ? 'text-danger' : data.priority === 'P1' ? 'text-warning' : 'text-text-primary')}>
                    {data.priority}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-text-secondary text-sm">Status</span>
                  <span className={cn('text-sm', getStatusBgColor(data.automation), 'px-2 py-0.5 rounded')}>
                    {data.automation}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-text-secondary text-sm">Risk</span>
                  <span className={cn('text-sm', getRiskColor(data.risk))}>{data.risk}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-text-secondary text-sm">Pass Rate</span>
                  <span className="text-sm">{data.passRate == null ? 'Not run' : `${data.passRate}%`}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-text-secondary text-sm">AI Score</span>
                  <span className="text-sm text-accent-purple">{data.aiScore ?? 'Not measured'}</span>
                </div>
              </div>
            </div>

            <div>
              <h4 className="text-sm font-medium text-text-secondary mb-2">Flow</h4>
              <p className="text-sm">{data.flow}</p>
            </div>

            <div>
              <h4 className="text-sm font-medium text-text-secondary mb-2">Owner</h4>
              <div className="flex items-center gap-2">
                <User size={14} className="text-text-secondary" />
                <span className="text-sm">{data.owner}</span>
              </div>
            </div>

            <div>
              <h4 className="text-sm font-medium text-text-secondary mb-2">Tags</h4>
              <div className="flex flex-wrap gap-1">
                {data.tags.map((tag) => (
                  <span key={tag} className="px-2 py-0.5 text-xs bg-elevated rounded-full text-text-secondary">
                    {tag}
                  </span>
                ))}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function ExecutionInspector({ data }: { data: Execution }) {
  const [activeTab, setActiveTab] = useState('overview');

  const tabs = ['Overview'];

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex shrink-0 gap-2 px-4 border-b border-border overflow-x-auto">
        {tabs.map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab.toLowerCase().replace(' ', '-'))}
            className={cn(
              'px-3 py-2 text-sm whitespace-nowrap transition-colors',
              activeTab === tab.toLowerCase().replace(' ', '-')
                ? 'text-accent-blue border-b-2 border-accent-blue'
                : 'text-text-secondary hover:text-text-primary'
            )}
          >
            {tab}
          </button>
        ))}
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-4">
        {activeTab === 'overview' && (
          <>
            <div className={cn('p-3 rounded-lg', getStatusBgColor(data.status))}>
              <div className="flex items-center gap-2">
                {data.status === 'failed' && <AlertTriangle size={16} />}
                {data.status === 'passed' && <Check size={16} />}
                <span className="font-medium capitalize">{data.status}</span>
              </div>
            </div>

            <div>
              <h4 className="text-sm font-medium text-text-secondary mb-2">Details</h4>
              <div className="space-y-2">
                <div className="flex justify-between">
                  <span className="text-text-secondary text-sm">Duration</span>
                  <span className="text-sm">{data.duration == null ? 'Not measured' : formatDuration(data.duration)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-text-secondary text-sm">Browser</span>
                  <span className="text-sm">{data.browser}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-text-secondary text-sm">Environment</span>
                  <span className="text-sm">{data.environment}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-text-secondary text-sm">AI Confidence</span>
                  <span className="text-sm text-accent-purple">{data.aiConfidence == null ? 'Not measured' : `${data.aiConfidence}%`}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-text-secondary text-sm">Retries</span>
                  <span className="text-sm">{data.retry}</span>
                </div>
              </div>
            </div>

            {data.errorMessage && (
              <div>
                <h4 className="text-sm font-medium text-text-secondary mb-2">Error</h4>
                <div className="p-3 bg-danger/10 rounded-lg border border-danger/20">
                  <p className="text-sm text-danger font-mono">{data.errorMessage}</p>
                </div>
              </div>
            )}

            {data.stackTrace && (
              <div>
                <h4 className="text-sm font-medium text-text-secondary mb-2">Stack Trace</h4>
                <pre className="p-3 bg-elevated rounded-lg text-xs font-mono overflow-x-auto">
                  {data.stackTrace}
                </pre>
              </div>
            )}
            {data.result && <div>
              <h4 className="text-sm font-medium mb-2">Human-reported observations</h4>
              <pre className="text-xs whitespace-pre-wrap">{JSON.stringify(data.result, null, 2)}</pre>
            </div>}
          </>
        )}

      </div>
    </div>
  );
}

function HealingInspector({ data }: { data: HealingSuggestion }) {
  const setData = useAppStore(state => state.setData);
  const openInspector = useAppStore(state => state.openInspector);
  const [reviewer, setReviewer] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  async function review(decision: 'approve' | 'reject') {
    setBusy(true);
    try {
      const base = `${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000'}/api/qa`;
      const response = await fetch(`${base}/healing/${data.id}/${decision}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reviewer }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message || 'Review failed');
      openInspector('healing', result);
      setMessage('Decision recorded. No code changes applied.');
      const workspace = await fetch(`${base}/workspace`);
      if (!workspace.ok) throw new Error('Decision saved, but workspace refresh failed');
      setData(await workspace.json());
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Review failed'); }
    finally { setBusy(false); }
  }
  return (
    <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-4">
      {message && <p role="status" className="text-sm">{message}</p>}
      <div className={cn('p-3 rounded-lg', getStatusBgColor(data.status))}>
        <div className="flex items-center justify-between">
          <span className="font-medium capitalize">{data.status}</span>
          <span className="text-sm">Confidence: {data.confidence == null ? 'Not measured' : `${data.confidence}%`}</span>
        </div>
      </div>

      <div>
        <h4 className="text-sm font-medium text-text-secondary mb-2">Issue</h4>
        <p className="text-sm">{data.issue}</p>
      </div>

      <div>
        <h4 className="text-sm font-medium text-text-secondary mb-2">Current Locator</h4>
        <code className="block p-2 bg-danger/10 text-danger text-sm rounded font-mono">
          {data.currentLocator}
        </code>
      </div>

      <div>
        <h4 className="text-sm font-medium text-text-secondary mb-2">Suggested Locator</h4>
        <code className="block p-2 bg-success/10 text-success text-sm rounded font-mono">
          {data.suggestedLocator}
        </code>
      </div>

      <div>
        <h4 className="text-sm font-medium text-text-secondary mb-2">Root Cause</h4>
        <p className="text-sm text-text-secondary">{data.rootCause}</p>
      </div>

      <div>
        <h4 className="text-sm font-medium text-text-secondary mb-2">Affected Tests</h4>
        <div className="flex flex-wrap gap-1">
          {data.affectedTests.map((test) => (
            <span key={test} className="px-2 py-0.5 text-xs bg-elevated rounded text-text-secondary">
              {test}
            </span>
          ))}
        </div>
      </div>

      {data.status === 'pending' && (
        <div className="flex gap-2 pt-4 border-t border-border">
          <input aria-label="Healing reviewer" value={reviewer} onChange={event => setReviewer(event.target.value)} placeholder="Reviewer name" className="w-32 bg-elevated rounded p-2 text-sm" />
          <button disabled={busy || !reviewer || !data.id} onClick={() => review('approve')} className="flex-1 px-4 py-2 bg-success text-white rounded-lg text-sm font-medium disabled:opacity-40">
            Approve
          </button>
          <button disabled={busy || !reviewer || !data.id} onClick={() => review('reject')} className="flex-1 px-4 py-2 bg-elevated text-text-primary rounded-lg text-sm font-medium disabled:opacity-40">
            Reject
          </button>
        </div>
      )}
    </div>
  );
}

export function Inspector() {
  const inspectorOpen = useAppStore(state => state.inspectorOpen);
  const inspectorType = useAppStore(state => state.inspectorType);
  const inspectorData = useAppStore(state => state.inspectorData);
  const closeInspector = useAppStore(state => state.closeInspector);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailInitialTab, setDetailInitialTab] = useState<string | undefined>(undefined);

  const openDetail = (tab?: string) => { setDetailInitialTab(tab); setDetailOpen(true); };

  if (!inspectorOpen || !inspectorType || !inspectorData) return null;

  const typeLabels: Record<string, string> = {
    testCase: 'Test Case',
    execution: 'Execution',
    healing: 'Healing Suggestion',
    flow: 'Flow',
    fact: 'Fact',
    action: 'Action',
    dom: 'DOM',
  };

  const getTitle = () => {
    switch (inspectorType) {
      case 'testCase':
        return (inspectorData as TestCase).title;
      case 'execution':
        return (inspectorData as Execution).testName || (inspectorData as Execution).testId;
      case 'healing':
        return 'Healing Suggestion';
      case 'flow':
        return (inspectorData as Flow).name;
      case 'fact':
        return 'Fact';
      default:
        return 'Details';
    }
  };

  const getSubtitle = () => {
    switch (inspectorType) {
      case 'testCase':
        return (inspectorData as TestCase).id;
      case 'execution':
        return (inspectorData as Execution).testId;
      default:
        return null;
    }
  };

  const renderContent = () => {
    switch (inspectorType) {
      case 'testCase':
        return <TestCaseInspector data={inspectorData as TestCase} onOpenDetail={openDetail} />;
      case 'execution':
        return <ExecutionInspector data={inspectorData as Execution} />;
      case 'healing':
        return <HealingInspector data={inspectorData as HealingSuggestion} />;
      default:
        return (
          <div className="p-4">
            <pre className="text-sm font-mono overflow-auto">
              {JSON.stringify(inspectorData, null, 2)}
            </pre>
          </div>
        );
    }
  };

  return (
    <aside className="w-[380px] h-full min-h-0 shrink-0 bg-surface border-l border-border flex flex-col overflow-hidden animate-slide-in">
      {/* Header */}
      <div className="min-h-14 shrink-0 flex items-center justify-between gap-2 px-4 py-2.5 border-b border-border">
        <div className="min-w-0">
          <span className="text-xs text-text-secondary uppercase tracking-wider">{typeLabels[inspectorType] || inspectorType}</span>
          <h3 className="font-medium truncate" title={getTitle()}>{getTitle()}</h3>
          {getSubtitle() && <p className="truncate font-mono text-[10px] text-text-secondary">{getSubtitle()}</p>}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button className="p-1.5 hover:bg-elevated rounded transition-colors">
            <Copy size={16} className="text-text-secondary" />
          </button>
          {inspectorType === 'testCase' && (
            <button
              onClick={() => openDetail()}
              aria-label="Open detailed view"
              title="Open detailed view"
              className="p-1.5 hover:bg-elevated rounded transition-colors"
            >
              <ExternalLink size={16} className="text-text-secondary" />
            </button>
          )}
          <button
            onClick={closeInspector}
            className="p-1.5 hover:bg-elevated rounded transition-colors"
          >
            <X size={16} className="text-text-secondary" />
          </button>
        </div>
      </div>

      {/* Content */}
      {renderContent()}

      {detailOpen && inspectorType === 'testCase' && (
        <TestCaseDetailModal testCase={inspectorData as TestCase} initialTab={detailInitialTab} onClose={() => setDetailOpen(false)} />
      )}
    </aside>
  );
}
