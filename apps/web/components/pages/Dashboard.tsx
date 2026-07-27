'use client';

import { cn, getStatusColor } from '@/lib/utils';
import { useAppStore } from '@/lib/store';
import {
  TrendingUp,
  TrendingDown,
  Play,
  AlertTriangle,
  Clock,
  Sparkles,
  Wrench,
  Activity,
} from 'lucide-react';

function KPICard({
  label,
  value,
  change,
  trend,
  color,
  icon,
}: {
  label: string;
  value: string | number;
  change?: number;
  trend?: 'up' | 'down';
  color?: string;
  icon?: React.ReactNode;
}) {
  return (
    <div className="bg-surface border border-border rounded-xl p-4">
      <div className="flex items-start justify-between mb-2">
        <span className="text-sm text-text-secondary">{label}</span>
        {icon && <span className={cn('text-text-secondary', color)}>{icon}</span>}
      </div>
      <div className="flex items-end justify-between">
        <span className={cn('text-2xl font-semibold', color)}>{value}</span>
        {change !== undefined && (
          <div className={cn('flex items-center gap-1 text-sm', trend === 'up' ? 'text-success' : 'text-danger')}>
            {trend === 'up' ? <TrendingUp size={14} /> : <TrendingDown size={14} />}
            <span>{Math.abs(change)}%</span>
          </div>
        )}
      </div>
    </div>
  );
}

function RecentExecutionRow({ execution }: { execution: { testName: string; status: string; duration: number; environment: string } }) {
  return (
    <div className="flex items-center justify-between py-2 border-b border-border last:border-0">
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate">{execution.testName}</p>
        <p className="text-xs text-text-secondary">{execution.environment}</p>
      </div>
      <div className="flex items-center gap-3">
        <span className="text-xs text-text-secondary">{execution.duration}s</span>
        <span className={cn('px-2 py-0.5 text-xs rounded-full capitalize',
          execution.status === 'passed' ? 'bg-success/10 text-success' :
          execution.status === 'failed' ? 'bg-danger/10 text-danger' :
          execution.status === 'running' ? 'bg-info/10 text-info' :
          'bg-warning/10 text-warning'
        )}>
          {execution.status}
        </span>
      </div>
    </div>
  );
}

export function Dashboard() {
  const { stats, executions, healingSuggestions, setCurrentPage, openInspector } = useAppStore();

  const recentExecutions = executions.slice(0, 5);
  const pendingHealing = healingSuggestions.filter((h) => h.status === 'pending');

  return (
    <div className="p-6 space-y-6 overflow-y-auto h-full">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Quality Command Center</h1>
          <p className="text-text-secondary">Production, staging, and agent intelligence across your QA estate</p>
        </div>
        <div className="flex gap-2">
          <button className="px-4 py-2 bg-accent-blue text-white rounded-lg text-sm font-medium hover:bg-accent-blue/90 transition-colors flex items-center gap-2">
            <Play size={16} fill="currentColor" />
            Run Suite
          </button>
          <button className="px-4 py-2 bg-elevated text-text-primary rounded-lg text-sm font-medium hover:bg-border transition-colors">
            Import Context
          </button>
          <button className="px-4 py-2 bg-accent-purple/10 text-accent-purple rounded-lg text-sm font-medium hover:bg-accent-purple/20 transition-colors flex items-center gap-2">
            <Sparkles size={16} />
            Generate Tests
          </button>
        </div>
      </div>

      {/* KPI Row */}
      <div className="grid grid-cols-8 gap-4">
        <KPICard
          label="Passed"
          value={stats?.passed ?? 0}
          change={stats?.passedChange}
          trend="up"
          color="text-success"
        />
        <KPICard
          label="Failed"
          value={stats?.failed ?? 0}
          change={Math.abs(stats?.failedChange ?? 0)}
          trend="down"
          color="text-danger"
        />
        <KPICard
          label="Blocked"
          value={stats?.blocked ?? 0}
          color="text-warning"
          icon={<AlertTriangle size={16} />}
        />
        <KPICard
          label="Running"
          value={stats?.running ?? 0}
          color="text-info"
          icon={<Activity size={16} />}
        />
        <KPICard
          label="Skipped"
          value={stats?.skipped ?? 0}
          color="text-text-secondary"
        />
        <KPICard
          label="Duration"
          value={stats?.duration ?? '-'}
          icon={<Clock size={16} />}
        />
        <KPICard
          label="AI Confidence"
          value={`${stats?.aiConfidence ?? 0}%`}
          change={stats?.aiConfidenceChange}
          trend="up"
          color="text-accent-purple"
          icon={<Sparkles size={16} />}
        />
        <KPICard
          label="Healing"
          value={stats?.healingCount ?? 0}
          color="text-warning"
          icon={<Wrench size={16} />}
        />
      </div>

      {/* Main Content Grid */}
      <div className="grid grid-cols-3 gap-6">
        {/* Recent Activity */}
        <div className="bg-surface border border-border rounded-xl p-4">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-medium">Recent Activity</h3>
          </div>
          <div className="space-y-1">
            {recentExecutions.map((exec, i) => (
              <RecentExecutionRow key={i} execution={exec} />
            ))}
            {recentExecutions.length === 0 && (
              <p className="text-sm text-text-secondary text-center py-4">No recent activity</p>
            )}
          </div>
        </div>

        {/* Agent Activity */}
        <div className="bg-surface border border-border rounded-xl p-4">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-medium">Agent Activity</h3>
          </div>
          <div className="space-y-3">
            <div className="flex items-center gap-3 p-2 bg-elevated rounded-lg">
              <div className="w-8 h-8 rounded-full bg-success/10 flex items-center justify-center">
                <Play size={14} className="text-success" />
              </div>
              <div className="flex-1">
                <p className="text-sm font-medium">Executor</p>
                <p className="text-xs text-text-secondary">Running 14 tests</p>
              </div>
              <span className="w-2 h-2 bg-success rounded-full animate-pulse" />
            </div>
            <div className="flex items-center gap-3 p-2 bg-elevated rounded-lg">
              <div className="w-8 h-8 rounded-full bg-warning/10 flex items-center justify-center">
                <Wrench size={14} className="text-warning" />
              </div>
              <div className="flex-1">
                <p className="text-sm font-medium">Healer</p>
                <p className="text-xs text-text-secondary">{pendingHealing.length} suggestions pending</p>
              </div>
            </div>
            <div className="flex items-center gap-3 p-2 bg-elevated rounded-lg">
              <div className="w-8 h-8 rounded-full bg-accent-purple/10 flex items-center justify-center">
                <Sparkles size={14} className="text-accent-purple" />
              </div>
              <div className="flex-1">
                <p className="text-sm font-medium">Context Manager</p>
                <p className="text-xs text-text-secondary">Syncing sources</p>
              </div>
            </div>
          </div>
        </div>

        {/* AI Insights */}
        <div className="bg-surface border border-border rounded-xl p-4">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-medium">AI Insights</h3>
            <Sparkles size={16} className="text-accent-purple" />
          </div>
          <div className="space-y-3">
            <div className="p-3 bg-danger/5 border border-danger/20 rounded-lg">
              <p className="text-sm font-medium text-danger">High Risk</p>
              <p className="text-sm text-text-secondary mt-1">
                Payment flow has 3 failing tests. Locator changes detected in recent deploy.
              </p>
            </div>
            <div className="p-3 bg-warning/5 border border-warning/20 rounded-lg">
              <p className="text-sm font-medium text-warning">Flaky Tests</p>
              <p className="text-sm text-text-secondary mt-1">
                2 tests showing intermittent failures. Consider adding retry logic.
              </p>
            </div>
            <div className="p-3 bg-success/5 border border-success/20 rounded-lg">
              <p className="text-sm font-medium text-success">Coverage Improved</p>
              <p className="text-sm text-text-secondary mt-1">
                Login flow coverage increased to 95% after recent test additions.
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Bottom Grid */}
      <div className="grid grid-cols-2 gap-6">
        {/* Pending Healing */}
        <div className="bg-surface border border-border rounded-xl p-4">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-medium">Pending Healing Suggestions</h3>
          </div>
          <div className="space-y-2">
            {pendingHealing.slice(0, 3).map((suggestion, i) => (
              <div
                key={i}
                onClick={() => openInspector('healing', suggestion)}
                className="p-3 bg-elevated rounded-lg cursor-pointer hover:bg-border transition-colors"
              >
                <div className="flex items-center justify-between mb-1">
                  <p className="text-sm font-medium">{suggestion.issue}</p>
                  <span className="text-xs text-accent-purple">{suggestion.confidence}%</span>
                </div>
                <p className="text-xs text-text-secondary">{suggestion.affectedTests.length} tests affected</p>
              </div>
            ))}
            {pendingHealing.length === 0 && (
              <p className="text-sm text-text-secondary text-center py-4">No pending suggestions</p>
            )}
          </div>
        </div>

        {/* Top Risks */}
        <div className="bg-surface border border-border rounded-xl p-4">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-medium">Top Risks</h3>
            <button
              onClick={() => setCurrentPage('test-cases')}
              className="text-sm text-accent-blue hover:underline"
            >
              View all
            </button>
          </div>
          <div className="space-y-2">
            {[
              { name: 'Checkout / Payment', risk: 'critical', coverage: 78 },
              { name: 'Authentication / SSO', risk: 'high', coverage: 85 },
              { name: 'Order Management', risk: 'high', coverage: 72 },
            ].map((item, i) => (
              <div key={i} className="flex items-center justify-between p-3 bg-elevated rounded-lg">
                <div>
                  <p className="text-sm font-medium">{item.name}</p>
                  <p className={cn('text-xs capitalize', item.risk === 'critical' ? 'text-danger' : 'text-warning')}>
                    {item.risk} risk
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-sm font-medium">{item.coverage}%</p>
                  <p className="text-xs text-text-secondary">coverage</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
