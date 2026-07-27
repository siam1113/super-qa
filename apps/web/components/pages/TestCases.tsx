'use client';

import { useState } from 'react';
import { cn, getStatusBgColor, getRiskColor, getPriorityColor, formatRelativeTime } from '@/lib/utils';
import { useAppStore } from '@/lib/store';
import type { TestCase } from '@/lib/types';
import {
  Search,
  Filter,
  Plus,
  Download,
  Upload,
  Sparkles,
  ChevronDown,
  MoreHorizontal,
} from 'lucide-react';

function PriorityBadge({ priority }: { priority: string }) {
  return (
    <span className={cn('text-xs font-medium', getPriorityColor(priority))}>
      {priority}
    </span>
  );
}

function AutomationBadge({ automation }: { automation: string }) {
  return (
    <span className={cn('px-2 py-0.5 text-xs rounded-full capitalize', getStatusBgColor(automation))}>
      {automation}
    </span>
  );
}

export function TestCases() {
  const { testCases, openInspector } = useAppStore();
  const [searchQuery, setSearchQuery] = useState('');
  const [priorityFilter, setPriorityFilter] = useState<string>('all');
  const [automationFilter, setAutomationFilter] = useState<string>('all');
  const [selectedRows, setSelectedRows] = useState<Set<string>>(new Set());

  const filteredTestCases = testCases.filter((tc) => {
    if (searchQuery && !tc.title.toLowerCase().includes(searchQuery.toLowerCase()) && !tc.id.toLowerCase().includes(searchQuery.toLowerCase())) {
      return false;
    }
    if (priorityFilter !== 'all' && tc.priority !== priorityFilter) {
      return false;
    }
    if (automationFilter !== 'all' && tc.automation !== automationFilter) {
      return false;
    }
    return true;
  });

  const handleRowClick = (testCase: TestCase) => {
    openInspector('testCase', testCase);
  };

  const toggleRowSelection = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const newSelected = new Set(selectedRows);
    if (newSelected.has(id)) {
      newSelected.delete(id);
    } else {
      newSelected.add(id);
    }
    setSelectedRows(newSelected);
  };

  const toggleAllRows = () => {
    if (selectedRows.size === filteredTestCases.length) {
      setSelectedRows(new Set());
    } else {
      setSelectedRows(new Set(filteredTestCases.map((tc) => tc.id)));
    }
  };

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="p-6 border-b border-border">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-2xl font-semibold">Test Cases</h1>
            <p className="text-text-secondary">Manage and organize your test library</p>
          </div>
          <div className="flex gap-2">
            <button className="px-4 py-2 bg-accent-blue text-white rounded-lg text-sm font-medium hover:bg-accent-blue/90 transition-colors flex items-center gap-2">
              <Plus size={16} />
              New Test
            </button>
            <button className="px-4 py-2 bg-accent-purple/10 text-accent-purple rounded-lg text-sm font-medium hover:bg-accent-purple/20 transition-colors flex items-center gap-2">
              <Sparkles size={16} />
              Generate
            </button>
            <button className="px-4 py-2 bg-elevated text-text-primary rounded-lg text-sm font-medium hover:bg-border transition-colors flex items-center gap-2">
              <Upload size={16} />
              Import
            </button>
            <button className="px-4 py-2 bg-elevated text-text-primary rounded-lg text-sm font-medium hover:bg-border transition-colors flex items-center gap-2">
              <Download size={16} />
              Export
            </button>
          </div>
        </div>

        {/* Filters */}
        <div className="flex items-center gap-3">
          <div className="relative flex-1 max-w-md">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-secondary" />
            <input
              type="text"
              placeholder="Search test cases..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-4 py-2 bg-elevated border border-border rounded-lg text-sm outline-none focus:border-accent-blue transition-colors"
            />
          </div>

          <div className="relative">
            <select
              value={priorityFilter}
              onChange={(e) => setPriorityFilter(e.target.value)}
              className="appearance-none px-4 py-2 pr-8 bg-elevated border border-border rounded-lg text-sm outline-none cursor-pointer"
            >
              <option value="all">All Priorities</option>
              <option value="P0">P0</option>
              <option value="P1">P1</option>
              <option value="P2">P2</option>
              <option value="P3">P3</option>
            </select>
            <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-text-secondary pointer-events-none" />
          </div>

          <div className="relative">
            <select
              value={automationFilter}
              onChange={(e) => setAutomationFilter(e.target.value)}
              className="appearance-none px-4 py-2 pr-8 bg-elevated border border-border rounded-lg text-sm outline-none cursor-pointer"
            >
              <option value="all">All Automation</option>
              <option value="automated">Automated</option>
              <option value="manual">Manual</option>
              <option value="partial">Partial</option>
            </select>
            <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-text-secondary pointer-events-none" />
          </div>

          <button className="flex items-center gap-2 px-4 py-2 bg-elevated border border-border rounded-lg text-sm hover:bg-border transition-colors">
            <Filter size={16} />
            More Filters
          </button>

          {selectedRows.size > 0 && (
            <div className="flex items-center gap-2 ml-auto">
              <span className="text-sm text-text-secondary">{selectedRows.size} selected</span>
              <button className="px-3 py-1.5 bg-elevated rounded-lg text-sm hover:bg-border transition-colors">
                Bulk Edit
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto">
        <table className="w-full">
          <thead className="sticky top-0 bg-surface border-b border-border">
            <tr className="text-left text-xs text-text-secondary uppercase tracking-wider">
              <th className="px-6 py-3 w-10">
                <input
                  type="checkbox"
                  checked={selectedRows.size === filteredTestCases.length && filteredTestCases.length > 0}
                  onChange={toggleAllRows}
                  className="rounded border-border"
                />
              </th>
              <th className="px-6 py-3 font-medium">ID</th>
              <th className="px-6 py-3 font-medium">Title</th>
              <th className="px-6 py-3 font-medium">Priority</th>
              <th className="px-6 py-3 font-medium">Automation</th>
              <th className="px-6 py-3 font-medium">Owner</th>
              <th className="px-6 py-3 font-medium">Flow</th>
              <th className="px-6 py-3 font-medium">Pass Rate</th>
              <th className="px-6 py-3 font-medium">Risk</th>
              <th className="px-6 py-3 font-medium">AI Score</th>
              <th className="px-6 py-3 font-medium w-10"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {filteredTestCases.map((testCase) => (
              <tr
                key={testCase.id}
                onClick={() => handleRowClick(testCase)}
                className={cn(
                  'hover:bg-elevated cursor-pointer transition-colors',
                  selectedRows.has(testCase.id) && 'bg-accent-blue/5'
                )}
              >
                <td className="px-6 py-4">
                  <input
                    type="checkbox"
                    checked={selectedRows.has(testCase.id)}
                    onClick={(e) => toggleRowSelection(testCase.id, e)}
                    onChange={() => {}}
                    className="rounded border-border"
                  />
                </td>
                <td className="px-6 py-4 text-sm font-mono text-accent-blue">{testCase.id}</td>
                <td className="px-6 py-4">
                  <p className="text-sm font-medium truncate max-w-xs">{testCase.title}</p>
                </td>
                <td className="px-6 py-4">
                  <PriorityBadge priority={testCase.priority} />
                </td>
                <td className="px-6 py-4">
                  <AutomationBadge automation={testCase.automation} />
                </td>
                <td className="px-6 py-4 text-sm text-text-secondary">{testCase.owner}</td>
                <td className="px-6 py-4 text-sm text-text-secondary truncate max-w-xs">{testCase.flow}</td>
                <td className="px-6 py-4">
                  <div className="flex items-center gap-2">
                    <div className="w-16 h-1.5 bg-elevated rounded-full overflow-hidden">
                      <div
                        className={cn('h-full rounded-full', testCase.passRate >= 90 ? 'bg-success' : testCase.passRate >= 70 ? 'bg-warning' : 'bg-danger')}
                        style={{ width: `${testCase.passRate}%` }}
                      />
                    </div>
                    <span className="text-xs text-text-secondary">{testCase.passRate}%</span>
                  </div>
                </td>
                <td className="px-6 py-4">
                  <span className={cn('text-sm capitalize', getRiskColor(testCase.risk))}>
                    {testCase.risk}
                  </span>
                </td>
                <td className="px-6 py-4">
                  <span className="text-sm text-accent-purple">{testCase.aiScore}</span>
                </td>
                <td className="px-6 py-4">
                  <button className="p-1 hover:bg-border rounded transition-colors">
                    <MoreHorizontal size={16} className="text-text-secondary" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {filteredTestCases.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16">
            <p className="text-text-secondary mb-2">No test cases found</p>
            <p className="text-sm text-text-secondary">Try adjusting your filters or create a new test</p>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="px-6 py-3 border-t border-border flex items-center justify-between text-sm text-text-secondary">
        <span>{filteredTestCases.length} test cases</span>
        <div className="flex items-center gap-2">
          <span>Showing 1-{Math.min(filteredTestCases.length, 50)} of {filteredTestCases.length}</span>
        </div>
      </div>
    </div>
  );
}
