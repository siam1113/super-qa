'use client';

import { useState, useEffect, useCallback } from 'react';
import { cn } from '@/lib/utils';
import type { AgentTask, AgentType, TaskStatus, TaskPriority } from '@/lib/types';
import {
  LayoutDashboard,
  ListTodo,
  MessageSquare,
  Activity,
  Settings,
  TrendingUp,
  TrendingDown,
  Clock,
  CheckCircle2,
  XCircle,
  Ban,
  Play,
  AlertTriangle,
  ArrowUp,
  ArrowRight,
  ArrowDown,
  Search,
  Filter,
  Bot,
  Users,
  Zap,
  Target,
  Calendar,
  MoreHorizontal,
  ChevronRight,
  ExternalLink,
  RefreshCw,
  Plus,
} from 'lucide-react';
import { TaskModal } from '@/components/TaskModal';

const API_BASE = 'http://localhost:4000';

type TabType = 'dashboard' | 'tasks' | 'sessions' | 'activity' | 'analytics';

// Dashboard Stats Component
function StatCard({
  title,
  value,
  change,
  changeLabel,
  icon,
  color,
}: {
  title: string;
  value: string | number;
  change?: number;
  changeLabel?: string;
  icon: React.ReactNode;
  color: string;
}) {
  return (
    <div className="bg-base border border-border rounded-xl p-4">
      <div className="flex items-start justify-between mb-3">
        <div className={cn('p-2 rounded-lg', color)}>
          {icon}
        </div>
        {change !== undefined && (
          <div className={cn(
            'flex items-center gap-1 text-xs',
            change >= 0 ? 'text-success' : 'text-danger'
          )}>
            {change >= 0 ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
            {Math.abs(change)}%
          </div>
        )}
      </div>
      <div className="text-2xl font-semibold mb-1">{value}</div>
      <div className="text-sm text-text-secondary">{title}</div>
      {changeLabel && (
        <div className="text-xs text-text-secondary mt-1">{changeLabel}</div>
      )}
    </div>
  );
}

// Status Badge Component
function StatusBadge({ status }: { status: TaskStatus }) {
  const config: Record<TaskStatus, { label: string; color: string; bg: string }> = {
    todo: { label: 'To Do', color: 'text-text-secondary', bg: 'bg-elevated' },
    in_progress: { label: 'In Progress', color: 'text-info', bg: 'bg-info/10' },
    blocked: { label: 'Blocked', color: 'text-warning', bg: 'bg-warning/10' },
    done: { label: 'Done', color: 'text-success', bg: 'bg-success/10' },
    cancelled: { label: 'Cancelled', color: 'text-text-secondary', bg: 'bg-elevated' },
  };
  const { label, color, bg } = config[status];
  return (
    <span className={cn('px-2 py-0.5 rounded-full text-xs font-medium', color, bg)}>
      {label}
    </span>
  );
}

// Priority Badge Component
function PriorityBadge({ priority }: { priority: TaskPriority }) {
  const config: Record<TaskPriority, { label: string; icon: React.ReactNode; color: string }> = {
    urgent: { label: 'Urgent', icon: <AlertTriangle size={10} />, color: 'text-danger' },
    high: { label: 'High', icon: <ArrowUp size={10} />, color: 'text-warning' },
    medium: { label: 'Medium', icon: <ArrowRight size={10} />, color: 'text-info' },
    low: { label: 'Low', icon: <ArrowDown size={10} />, color: 'text-text-secondary' },
  };
  const { label, icon, color } = config[priority];
  return (
    <span className={cn('flex items-center gap-1 text-xs', color)}>
      {icon}
      {label}
    </span>
  );
}

// Agent Badge Component
function AgentBadge({ agentType }: { agentType: AgentType }) {
  const config: Record<AgentType, { label: string; color: string; bg: string }> = {
    qae: { label: 'QAE', color: 'text-accent-blue', bg: 'bg-accent-blue/10' },
    aue: { label: 'AUE', color: 'text-accent-purple', bg: 'bg-accent-purple/10' },
    superqa: { label: 'SQA', color: 'text-warning', bg: 'bg-warning/10' },
  };
  const { label, color, bg } = config[agentType];
  return (
    <span className={cn('px-2 py-0.5 rounded text-xs font-medium', color, bg)}>
      {label}
    </span>
  );
}

// Dashboard Tab
function DashboardTab({ tasks, sessions }: { tasks: AgentTask[]; sessions: any[] }) {
  const stats = {
    totalTasks: tasks.length,
    inProgress: tasks.filter(t => t.status === 'in_progress').length,
    completed: tasks.filter(t => t.status === 'done').length,
    blocked: tasks.filter(t => t.status === 'blocked').length,
    qaeeTasks: tasks.filter(t => t.agentType === 'qae').length,
    aueTasks: tasks.filter(t => t.agentType === 'aue').length,
  };

  const recentTasks = tasks
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
    .slice(0, 5);

  const completionRate = stats.totalTasks > 0
    ? Math.round((stats.completed / stats.totalTasks) * 100)
    : 0;

  return (
    <div className="p-6 space-y-6">
      {/* Stats Grid */}
      <div className="grid grid-cols-4 gap-4">
        <StatCard
          title="Total Tasks"
          value={stats.totalTasks}
          icon={<ListTodo size={18} className="text-accent-blue" />}
          color="bg-accent-blue/10"
        />
        <StatCard
          title="In Progress"
          value={stats.inProgress}
          icon={<Play size={18} className="text-info" />}
          color="bg-info/10"
        />
        <StatCard
          title="Completed"
          value={stats.completed}
          change={completionRate}
          changeLabel="completion rate"
          icon={<CheckCircle2 size={18} className="text-success" />}
          color="bg-success/10"
        />
        <StatCard
          title="Blocked"
          value={stats.blocked}
          icon={<Ban size={18} className="text-warning" />}
          color="bg-warning/10"
        />
      </div>

      {/* Two Column Layout */}
      <div className="grid grid-cols-2 gap-6">
        {/* Recent Tasks */}
        <div className="bg-base border border-border rounded-xl">
          <div className="flex items-center justify-between px-4 py-3 border-b border-border">
            <h3 className="font-medium">Recent Tasks</h3>
            <span className="text-xs text-text-secondary">{tasks.length} total</span>
          </div>
          <div className="divide-y divide-border">
            {recentTasks.length > 0 ? recentTasks.map((task) => (
              <div key={task.id} className="px-4 py-3 hover:bg-elevated transition-colors">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <AgentBadge agentType={task.agentType} />
                      <span className="text-sm font-medium truncate">{task.title}</span>
                    </div>
                    <div className="flex items-center gap-3 text-xs text-text-secondary">
                      <StatusBadge status={task.status} />
                      <PriorityBadge priority={task.priority} />
                    </div>
                  </div>
                  <span className="text-xs text-text-secondary whitespace-nowrap">
                    {new Date(task.updatedAt).toLocaleDateString()}
                  </span>
                </div>
              </div>
            )) : (
              <div className="px-4 py-8 text-center text-text-secondary text-sm">
                No tasks yet
              </div>
            )}
          </div>
        </div>

        {/* Agent Distribution */}
        <div className="bg-base border border-border rounded-xl">
          <div className="flex items-center justify-between px-4 py-3 border-b border-border">
            <h3 className="font-medium">Agent Workload</h3>
          </div>
          <div className="p-4 space-y-4">
            {/* QAE */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-lg bg-accent-blue/10 flex items-center justify-center">
                    <Search size={14} className="text-accent-blue" />
                  </div>
                  <div>
                    <div className="text-sm font-medium">QA Engineer</div>
                    <div className="text-xs text-text-secondary">{stats.qaeeTasks} tasks</div>
                  </div>
                </div>
                <span className="text-sm font-medium">
                  {stats.totalTasks > 0 ? Math.round((stats.qaeeTasks / stats.totalTasks) * 100) : 0}%
                </span>
              </div>
              <div className="h-2 bg-elevated rounded-full overflow-hidden">
                <div
                  className="h-full bg-accent-blue rounded-full transition-all"
                  style={{ width: `${stats.totalTasks > 0 ? (stats.qaeeTasks / stats.totalTasks) * 100 : 0}%` }}
                />
              </div>
            </div>

            {/* AUE */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-lg bg-accent-purple/10 flex items-center justify-center">
                    <Bot size={14} className="text-accent-purple" />
                  </div>
                  <div>
                    <div className="text-sm font-medium">Automation Engineer</div>
                    <div className="text-xs text-text-secondary">{stats.aueTasks} tasks</div>
                  </div>
                </div>
                <span className="text-sm font-medium">
                  {stats.totalTasks > 0 ? Math.round((stats.aueTasks / stats.totalTasks) * 100) : 0}%
                </span>
              </div>
              <div className="h-2 bg-elevated rounded-full overflow-hidden">
                <div
                  className="h-full bg-accent-purple rounded-full transition-all"
                  style={{ width: `${stats.totalTasks > 0 ? (stats.aueTasks / stats.totalTasks) * 100 : 0}%` }}
                />
              </div>
            </div>

            {/* Status Breakdown */}
            <div className="pt-4 border-t border-border">
              <div className="text-sm font-medium mb-3">Status Breakdown</div>
              <div className="grid grid-cols-2 gap-2">
                <div className="flex items-center justify-between px-3 py-2 bg-elevated rounded-lg">
                  <span className="text-xs text-text-secondary">To Do</span>
                  <span className="text-sm font-medium">{tasks.filter(t => t.status === 'todo').length}</span>
                </div>
                <div className="flex items-center justify-between px-3 py-2 bg-info/10 rounded-lg">
                  <span className="text-xs text-info">In Progress</span>
                  <span className="text-sm font-medium text-info">{stats.inProgress}</span>
                </div>
                <div className="flex items-center justify-between px-3 py-2 bg-success/10 rounded-lg">
                  <span className="text-xs text-success">Done</span>
                  <span className="text-sm font-medium text-success">{stats.completed}</span>
                </div>
                <div className="flex items-center justify-between px-3 py-2 bg-warning/10 rounded-lg">
                  <span className="text-xs text-warning">Blocked</span>
                  <span className="text-sm font-medium text-warning">{stats.blocked}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// Tasks Tab
function TasksTab({
  tasks,
  onRefresh,
  onTaskClick,
  onAddTask,
}: {
  tasks: AgentTask[];
  onRefresh: () => void;
  onTaskClick: (task: AgentTask) => void;
  onAddTask: () => void;
}) {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<TaskStatus | 'all'>('all');
  const [agentFilter, setAgentFilter] = useState<AgentType | 'all'>('all');
  const [priorityFilter, setPriorityFilter] = useState<TaskPriority | 'all'>('all');

  const filteredTasks = tasks.filter((task) => {
    if (search && !task.title.toLowerCase().includes(search.toLowerCase())) return false;
    if (statusFilter !== 'all' && task.status !== statusFilter) return false;
    if (agentFilter !== 'all' && task.agentType !== agentFilter) return false;
    if (priorityFilter !== 'all' && task.priority !== priorityFilter) return false;
    return true;
  });

  return (
    <div className="h-full flex flex-col">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <div className="flex items-center gap-3">
          {/* Search */}
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-secondary" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search tasks..."
              className="pl-9 pr-4 py-1.5 bg-elevated border border-border rounded-lg text-sm outline-none focus:border-accent-blue w-64"
            />
          </div>

          {/* Filters */}
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as TaskStatus | 'all')}
            className="px-3 py-1.5 bg-elevated border border-border rounded-lg text-sm outline-none"
          >
            <option value="all">All Status</option>
            <option value="todo">To Do</option>
            <option value="in_progress">In Progress</option>
            <option value="blocked">Blocked</option>
            <option value="done">Done</option>
            <option value="cancelled">Cancelled</option>
          </select>

          <select
            value={agentFilter}
            onChange={(e) => setAgentFilter(e.target.value as AgentType | 'all')}
            className="px-3 py-1.5 bg-elevated border border-border rounded-lg text-sm outline-none"
          >
            <option value="all">All Agents</option>
            <option value="qae">QA Engineer</option>
            <option value="aue">Automation Engineer</option>
          </select>

          <select
            value={priorityFilter}
            onChange={(e) => setPriorityFilter(e.target.value as TaskPriority | 'all')}
            className="px-3 py-1.5 bg-elevated border border-border rounded-lg text-sm outline-none"
          >
            <option value="all">All Priority</option>
            <option value="urgent">Urgent</option>
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
          </select>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={onRefresh}
            className="p-2 hover:bg-elevated rounded-lg transition-colors"
            title="Refresh"
          >
            <RefreshCw size={16} className="text-text-secondary" />
          </button>
          <button
            onClick={onAddTask}
            className="flex items-center gap-2 px-3 py-1.5 bg-accent-blue text-white rounded-lg text-sm hover:bg-accent-blue/90 transition-colors"
          >
            <Plus size={14} />
            New Task
          </button>
        </div>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto">
        <table className="w-full">
          <thead className="bg-elevated sticky top-0">
            <tr>
              <th className="text-left px-4 py-3 text-xs font-medium text-text-secondary">Task</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-text-secondary w-24">Agent</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-text-secondary w-28">Status</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-text-secondary w-24">Priority</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-text-secondary w-32">Created</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-text-secondary w-32">Updated</th>
              <th className="w-10"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {filteredTasks.map((task) => (
              <tr
                key={task.id}
                className="hover:bg-elevated/50 cursor-pointer transition-colors"
                onClick={() => onTaskClick(task)}
              >
                <td className="px-4 py-3">
                  <div className="font-medium text-sm">{task.title}</div>
                  {task.description && (
                    <div className="text-xs text-text-secondary truncate max-w-md">{task.description}</div>
                  )}
                  {task.labels.length > 0 && (
                    <div className="flex items-center gap-1 mt-1">
                      {task.labels.slice(0, 3).map((label) => (
                        <span key={label} className="px-1.5 py-0.5 bg-elevated rounded text-xs text-text-secondary">
                          {label}
                        </span>
                      ))}
                      {task.labels.length > 3 && (
                        <span className="text-xs text-text-secondary">+{task.labels.length - 3}</span>
                      )}
                    </div>
                  )}
                </td>
                <td className="px-4 py-3">
                  <AgentBadge agentType={task.agentType} />
                </td>
                <td className="px-4 py-3">
                  <StatusBadge status={task.status} />
                </td>
                <td className="px-4 py-3">
                  <PriorityBadge priority={task.priority} />
                </td>
                <td className="px-4 py-3 text-xs text-text-secondary">
                  {new Date(task.createdAt).toLocaleDateString()}
                </td>
                <td className="px-4 py-3 text-xs text-text-secondary">
                  {new Date(task.updatedAt).toLocaleDateString()}
                </td>
                <td className="px-4 py-3">
                  <button className="p-1 hover:bg-border rounded">
                    <MoreHorizontal size={14} className="text-text-secondary" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {filteredTasks.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 text-text-secondary">
            <ListTodo size={48} className="mb-4 opacity-50" />
            <p className="text-sm">No tasks found</p>
            <p className="text-xs">Try adjusting your filters or create a new task</p>
          </div>
        )}
      </div>
    </div>
  );
}

// Sessions Tab
function SessionsTab({ sessions, onRefresh }: { sessions: any[]; onRefresh: () => void }) {
  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <div className="flex items-center gap-3">
          <h3 className="font-medium">Agent Sessions</h3>
          <span className="text-sm text-text-secondary">{sessions.length} total</span>
        </div>
        <button
          onClick={onRefresh}
          className="p-2 hover:bg-elevated rounded-lg transition-colors"
        >
          <RefreshCw size={16} className="text-text-secondary" />
        </button>
      </div>

      <div className="flex-1 overflow-auto">
        {sessions.length > 0 ? (
          <div className="divide-y divide-border">
            {sessions.map((session) => (
              <div key={session.id} className="px-4 py-3 hover:bg-elevated transition-colors">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <AgentBadge agentType={session.agentType} />
                    <div>
                      <div className="text-sm font-medium">Session {session.id.slice(0, 8)}...</div>
                      <div className="text-xs text-text-secondary">
                        {session.messageCount || 0} messages
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-text-secondary">
                      {new Date(session.createdAt).toLocaleString()}
                    </span>
                    <ChevronRight size={14} className="text-text-secondary" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center py-16 text-text-secondary">
            <MessageSquare size={48} className="mb-4 opacity-50" />
            <p className="text-sm">No sessions yet</p>
            <p className="text-xs">Start chatting with an agent to create sessions</p>
          </div>
        )}
      </div>
    </div>
  );
}

// Activity Tab
function ActivityTab({ tasks }: { tasks: AgentTask[] }) {
  // Generate activity from tasks
  const activities = tasks
    .flatMap((task) => {
      const items = [];
      items.push({
        id: `${task.id}-created`,
        type: 'created',
        task,
        timestamp: task.createdAt,
        message: `Task "${task.title}" was created`,
      });
      if (task.startedAt) {
        items.push({
          id: `${task.id}-started`,
          type: 'started',
          task,
          timestamp: task.startedAt,
          message: `Task "${task.title}" was started`,
        });
      }
      if (task.completedAt) {
        items.push({
          id: `${task.id}-completed`,
          type: 'completed',
          task,
          timestamp: task.completedAt,
          message: `Task "${task.title}" was completed`,
        });
      }
      if (task.status === 'blocked' && task.blockedReason) {
        items.push({
          id: `${task.id}-blocked`,
          type: 'blocked',
          task,
          timestamp: task.updatedAt,
          message: `Task "${task.title}" was blocked: ${task.blockedReason}`,
        });
      }
      return items;
    })
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
    .slice(0, 50);

  const getActivityIcon = (type: string) => {
    switch (type) {
      case 'created': return <Plus size={14} className="text-accent-blue" />;
      case 'started': return <Play size={14} className="text-info" />;
      case 'completed': return <CheckCircle2 size={14} className="text-success" />;
      case 'blocked': return <Ban size={14} className="text-warning" />;
      default: return <Activity size={14} className="text-text-secondary" />;
    }
  };

  return (
    <div className="h-full overflow-auto">
      <div className="px-4 py-3 border-b border-border">
        <h3 className="font-medium">Activity Timeline</h3>
      </div>

      {activities.length > 0 ? (
        <div className="p-4">
          <div className="relative">
            {/* Timeline line */}
            <div className="absolute left-4 top-0 bottom-0 w-px bg-border" />

            {/* Activities */}
            <div className="space-y-4">
              {activities.map((activity) => (
                <div key={activity.id} className="relative flex items-start gap-4 pl-10">
                  {/* Icon */}
                  <div className="absolute left-0 w-8 h-8 rounded-full bg-base border border-border flex items-center justify-center">
                    {getActivityIcon(activity.type)}
                  </div>

                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="text-sm">{activity.message}</div>
                        <div className="flex items-center gap-2 mt-1">
                          <AgentBadge agentType={activity.task.agentType} />
                          <span className="text-xs text-text-secondary">
                            {new Date(activity.timestamp).toLocaleString()}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center py-16 text-text-secondary">
          <Activity size={48} className="mb-4 opacity-50" />
          <p className="text-sm">No activity yet</p>
          <p className="text-xs">Activity will appear here as tasks are created and updated</p>
        </div>
      )}
    </div>
  );
}

// Analytics Tab
function AnalyticsTab({ tasks }: { tasks: AgentTask[] }) {
  const completedTasks = tasks.filter(t => t.status === 'done');
  const avgCompletionTime = completedTasks.length > 0
    ? completedTasks.reduce((sum, t) => {
        if (t.startedAt && t.completedAt) {
          return sum + (new Date(t.completedAt).getTime() - new Date(t.startedAt).getTime());
        }
        return sum;
      }, 0) / completedTasks.filter(t => t.startedAt && t.completedAt).length
    : 0;

  const formatDuration = (ms: number) => {
    if (!ms || isNaN(ms)) return 'N/A';
    const hours = Math.floor(ms / (1000 * 60 * 60));
    const minutes = Math.floor((ms % (1000 * 60 * 60)) / (1000 * 60));
    if (hours > 0) return `${hours}h ${minutes}m`;
    return `${minutes}m`;
  };

  const priorityBreakdown = {
    urgent: tasks.filter(t => t.priority === 'urgent').length,
    high: tasks.filter(t => t.priority === 'high').length,
    medium: tasks.filter(t => t.priority === 'medium').length,
    low: tasks.filter(t => t.priority === 'low').length,
  };

  return (
    <div className="p-6 space-y-6">
      {/* Key Metrics */}
      <div className="grid grid-cols-4 gap-4">
        <StatCard
          title="Completion Rate"
          value={`${tasks.length > 0 ? Math.round((completedTasks.length / tasks.length) * 100) : 0}%`}
          icon={<Target size={18} className="text-success" />}
          color="bg-success/10"
        />
        <StatCard
          title="Avg Completion Time"
          value={formatDuration(avgCompletionTime)}
          icon={<Clock size={18} className="text-info" />}
          color="bg-info/10"
        />
        <StatCard
          title="Active Tasks"
          value={tasks.filter(t => t.status === 'in_progress').length}
          icon={<Zap size={18} className="text-warning" />}
          color="bg-warning/10"
        />
        <StatCard
          title="Total Sessions"
          value={tasks.filter(t => t.sessionId).length}
          icon={<MessageSquare size={18} className="text-accent-purple" />}
          color="bg-accent-purple/10"
        />
      </div>

      {/* Priority Distribution */}
      <div className="bg-base border border-border rounded-xl p-4">
        <h3 className="font-medium mb-4">Priority Distribution</h3>
        <div className="space-y-3">
          {Object.entries(priorityBreakdown).map(([priority, count]) => {
            const percentage = tasks.length > 0 ? (count / tasks.length) * 100 : 0;
            const colors: Record<string, string> = {
              urgent: 'bg-danger',
              high: 'bg-warning',
              medium: 'bg-info',
              low: 'bg-text-secondary',
            };
            return (
              <div key={priority}>
                <div className="flex items-center justify-between text-sm mb-1">
                  <span className="capitalize">{priority}</span>
                  <span>{count} ({Math.round(percentage)}%)</span>
                </div>
                <div className="h-2 bg-elevated rounded-full overflow-hidden">
                  <div
                    className={cn('h-full rounded-full transition-all', colors[priority])}
                    style={{ width: `${percentage}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// Main Component
export function CommandCenterPage() {
  const [activeTab, setActiveTab] = useState<TabType>('dashboard');
  const [tasks, setTasks] = useState<AgentTask[]>([]);
  const [sessions, setSessions] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isTaskModalOpen, setIsTaskModalOpen] = useState(false);
  const [selectedTask, setSelectedTask] = useState<AgentTask | null>(null);
  const [selectedAgentType, setSelectedAgentType] = useState<AgentType>('qae');

  const fetchData = useCallback(async () => {
    setIsLoading(true);
    try {
      // Fetch tasks from both agents
      const [qaeTasks, aueTasks, qaeSessions, aueSessions] = await Promise.all([
        fetch(`${API_BASE}/api/agents/qae/tasks`).then(r => r.ok ? r.json() : []),
        fetch(`${API_BASE}/api/agents/aue/tasks`).then(r => r.ok ? r.json() : []),
        fetch(`${API_BASE}/api/agents/qae/sessions`).then(r => r.ok ? r.json() : []),
        fetch(`${API_BASE}/api/agents/aue/sessions`).then(r => r.ok ? r.json() : []),
      ]);
      setTasks([...qaeTasks, ...aueTasks]);
      setSessions([...qaeSessions, ...aueSessions]);
    } catch (error) {
      console.error('Failed to fetch data:', error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleTaskClick = (task: AgentTask) => {
    setSelectedTask(task);
    setSelectedAgentType(task.agentType);
    setIsTaskModalOpen(true);
  };

  const handleAddTask = () => {
    setSelectedTask(null);
    setIsTaskModalOpen(true);
  };

  const tabs: { id: TabType; label: string; icon: React.ReactNode }[] = [
    { id: 'dashboard', label: 'Dashboard', icon: <LayoutDashboard size={16} /> },
    { id: 'tasks', label: 'Tasks', icon: <ListTodo size={16} /> },
    { id: 'sessions', label: 'Sessions', icon: <MessageSquare size={16} /> },
    { id: 'activity', label: 'Activity', icon: <Activity size={16} /> },
    { id: 'analytics', label: 'Analytics', icon: <TrendingUp size={16} /> },
  ];

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="px-6 py-4 border-b border-border">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold">Command Center</h1>
            <p className="text-sm text-text-secondary">Manage all agent tasks and sessions in one place</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={fetchData}
              disabled={isLoading}
              className="flex items-center gap-2 px-3 py-1.5 hover:bg-elevated rounded-lg transition-colors text-sm"
            >
              <RefreshCw size={14} className={cn('text-text-secondary', isLoading && 'animate-spin')} />
              Refresh
            </button>
            <button
              onClick={handleAddTask}
              className="flex items-center gap-2 px-3 py-1.5 bg-accent-blue text-white rounded-lg text-sm hover:bg-accent-blue/90 transition-colors"
            >
              <Plus size={14} />
              New Task
            </button>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 px-6 py-2 border-b border-border bg-surface">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={cn(
              'flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors',
              activeTab === tab.id
                ? 'bg-accent-blue/10 text-accent-blue'
                : 'text-text-secondary hover:text-text-primary hover:bg-elevated'
            )}
          >
            {tab.icon}
            {tab.label}
            {tab.id === 'tasks' && tasks.length > 0 && (
              <span className={cn(
                'px-1.5 py-0.5 rounded-full text-xs',
                activeTab === tab.id ? 'bg-accent-blue/20' : 'bg-elevated'
              )}>
                {tasks.length}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-hidden">
        {activeTab === 'dashboard' && <DashboardTab tasks={tasks} sessions={sessions} />}
        {activeTab === 'tasks' && (
          <TasksTab
            tasks={tasks}
            onRefresh={fetchData}
            onTaskClick={handleTaskClick}
            onAddTask={handleAddTask}
          />
        )}
        {activeTab === 'sessions' && <SessionsTab sessions={sessions} onRefresh={fetchData} />}
        {activeTab === 'activity' && <ActivityTab tasks={tasks} />}
        {activeTab === 'analytics' && <AnalyticsTab tasks={tasks} />}
      </div>

      {/* Task Modal */}
      <TaskModal
        isOpen={isTaskModalOpen}
        onClose={() => {
          setIsTaskModalOpen(false);
          setSelectedTask(null);
        }}
        onSave={fetchData}
        agentType={selectedAgentType}
        task={selectedTask}
      />
    </div>
  );
}
