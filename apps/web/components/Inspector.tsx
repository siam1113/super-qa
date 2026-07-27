'use client';

import { cn, getStatusBgColor, getRiskColor, formatDuration } from '@/lib/utils';
import { useAppStore } from '@/lib/store';
import type { TestCase, Execution, HealingSuggestion, Flow, Fact } from '@/lib/types';
import { X, ExternalLink, Copy, Check, AlertTriangle, Clock, User, Tag } from 'lucide-react';
import { useState } from 'react';

function TestCaseInspector({ data }: { data: TestCase }) {
  const [activeTab, setActiveTab] = useState('overview');

  const tabs = ['Overview', 'Steps', 'Executions', 'Facts', 'Coverage'];

  return (
    <div className="flex flex-col h-full">
      <div className="flex gap-2 px-4 border-b border-border overflow-x-auto">
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

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
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
                  <span className="text-sm">{data.passRate}%</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-text-secondary text-sm">AI Score</span>
                  <span className="text-sm text-accent-purple">{data.aiScore}</span>
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

  const tabs = ['Overview', 'Logs', 'AI Analysis', 'Screenshots', 'Network'];

  return (
    <div className="flex flex-col h-full">
      <div className="flex gap-2 px-4 border-b border-border overflow-x-auto">
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

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
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
                  <span className="text-sm">{formatDuration(data.duration)}</span>
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
                  <span className="text-sm text-accent-purple">{data.aiConfidence}%</span>
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
          </>
        )}

        {activeTab === 'ai-analysis' && (
          <div className="p-4 bg-accent-purple/10 rounded-lg border border-accent-purple/20">
            <h4 className="text-sm font-medium text-accent-purple mb-2">AI Analysis</h4>
            <p className="text-sm text-text-secondary">
              The test failed due to a missing element. The button with testid &quot;pay-now&quot; was not found in the DOM.
              This is likely due to a recent UI change. Consider using a more stable locator strategy.
            </p>
            <div className="mt-3 pt-3 border-t border-accent-purple/20">
              <p className="text-xs text-text-secondary">Confidence: {data.aiConfidence}%</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function HealingInspector({ data }: { data: HealingSuggestion }) {
  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-4">
      <div className={cn('p-3 rounded-lg', getStatusBgColor(data.status))}>
        <div className="flex items-center justify-between">
          <span className="font-medium capitalize">{data.status}</span>
          <span className="text-sm">Confidence: {data.confidence}%</span>
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
          <button className="flex-1 px-4 py-2 bg-success text-white rounded-lg text-sm font-medium hover:bg-success/90 transition-colors">
            Approve
          </button>
          <button className="flex-1 px-4 py-2 bg-elevated text-text-primary rounded-lg text-sm font-medium hover:bg-border transition-colors">
            Reject
          </button>
        </div>
      )}
    </div>
  );
}

export function Inspector() {
  const { inspectorOpen, inspectorType, inspectorData, closeInspector } = useAppStore();

  if (!inspectorOpen || !inspectorType || !inspectorData) return null;

  const getTitle = () => {
    switch (inspectorType) {
      case 'testCase':
        return (inspectorData as TestCase).id;
      case 'execution':
        return (inspectorData as Execution).testId;
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

  const renderContent = () => {
    switch (inspectorType) {
      case 'testCase':
        return <TestCaseInspector data={inspectorData as TestCase} />;
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
    <aside className="w-[380px] h-full bg-surface border-l border-border flex flex-col animate-slide-in">
      {/* Header */}
      <div className="h-14 flex items-center justify-between px-4 border-b border-border">
        <div>
          <span className="text-xs text-text-secondary uppercase tracking-wider">{inspectorType}</span>
          <h3 className="font-medium">{getTitle()}</h3>
        </div>
        <div className="flex items-center gap-2">
          <button className="p-1.5 hover:bg-elevated rounded transition-colors">
            <Copy size={16} className="text-text-secondary" />
          </button>
          <button className="p-1.5 hover:bg-elevated rounded transition-colors">
            <ExternalLink size={16} className="text-text-secondary" />
          </button>
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
    </aside>
  );
}
