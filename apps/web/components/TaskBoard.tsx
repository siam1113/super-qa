'use client';

import { useState } from 'react';
import { cn } from '@/lib/utils';
import type { AgentTask, TaskStatus, TaskPriority, AgentType } from '@/lib/types';
import {
  Plus,
  MoreHorizontal,
  Clock,
  AlertCircle,
  CheckCircle2,
  XCircle,
  Ban,
  GripVertical,
  MessageSquare,
  Calendar,
  Tag,
  ChevronRight,
  Trash2,
  Play,
  Pause,
} from 'lucide-react';

const API_BASE = 'http://localhost:4000';

type Column = {
  id: TaskStatus;
  title: string;
  icon: React.ReactNode;
  color: string;
  bgColor: string;
};

const COLUMNS: Column[] = [
  {
    id: 'todo',
    title: 'To Do',
    icon: <Clock size={14} />,
    color: 'text-text-secondary',
    bgColor: 'bg-surface',
  },
  {
    id: 'in_progress',
    title: 'In Progress',
    icon: <Play size={14} />,
    color: 'text-info',
    bgColor: 'bg-info/5',
  },
  {
    id: 'blocked',
    title: 'Blocked',
    icon: <Ban size={14} />,
    color: 'text-warning',
    bgColor: 'bg-warning/5',
  },
  {
    id: 'done',
    title: 'Done',
    icon: <CheckCircle2 size={14} />,
    color: 'text-success',
    bgColor: 'bg-success/5',
  },
  {
    id: 'cancelled',
    title: 'Cancelled',
    icon: <XCircle size={14} />,
    color: 'text-text-secondary',
    bgColor: 'bg-surface',
  },
];

const PRIORITY_CONFIG: Record<TaskPriority, { label: string; color: string; bgColor: string }> = {
  urgent: { label: 'Urgent', color: 'text-danger', bgColor: 'bg-danger/10' },
  high: { label: 'High', color: 'text-warning', bgColor: 'bg-warning/10' },
  medium: { label: 'Medium', color: 'text-info', bgColor: 'bg-info/10' },
  low: { label: 'Low', color: 'text-text-secondary', bgColor: 'bg-elevated' },
};

interface TaskCardProps {
  task: AgentTask;
  onUpdate: (taskId: string, updates: Partial<AgentTask>) => void;
  onDelete: (taskId: string) => void;
  onStart: (taskId: string) => void;
  onClick: (task: AgentTask) => void;
}

function TaskCard({ task, onUpdate, onDelete, onStart, onClick }: TaskCardProps) {
  const [showMenu, setShowMenu] = useState(false);
  const priority = PRIORITY_CONFIG[task.priority];

  return (
    <div
      className="bg-base border border-border rounded-lg p-3 cursor-pointer hover:border-accent-blue/50 transition-colors group"
      onClick={() => onClick(task)}
    >
      <div className="flex items-start justify-between gap-2 mb-2">
        <h4 className="text-sm font-medium line-clamp-2">{task.title}</h4>
        <div className="relative">
          <button
            onClick={(e) => {
              e.stopPropagation();
              setShowMenu(!showMenu);
            }}
            className="p-1 hover:bg-elevated rounded opacity-0 group-hover:opacity-100 transition-opacity"
          >
            <MoreHorizontal size={14} className="text-text-secondary" />
          </button>
          {showMenu && (
            <>
              <div
                className="fixed inset-0 z-10"
                onClick={(e) => {
                  e.stopPropagation();
                  setShowMenu(false);
                }}
              />
              <div className="absolute right-0 top-full mt-1 w-36 bg-elevated border border-border rounded-lg shadow-lg z-20 py-1">
                {task.status === 'todo' && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onStart(task.id);
                      setShowMenu(false);
                    }}
                    className="w-full flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-border text-left"
                  >
                    <Play size={12} />
                    Start Task
                  </button>
                )}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onDelete(task.id);
                    setShowMenu(false);
                  }}
                  className="w-full flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-border text-danger text-left"
                >
                  <Trash2 size={12} />
                  Delete
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      {task.description && (
        <p className="text-xs text-text-secondary line-clamp-2 mb-3">{task.description}</p>
      )}

      {task.blockedReason && task.status === 'blocked' && (
        <div className="flex items-start gap-1.5 text-xs text-warning bg-warning/10 rounded px-2 py-1.5 mb-3">
          <AlertCircle size={12} className="mt-0.5 flex-shrink-0" />
          <span className="line-clamp-2">{task.blockedReason}</span>
        </div>
      )}

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className={cn('text-xs px-1.5 py-0.5 rounded', priority.bgColor, priority.color)}>
            {priority.label}
          </span>
          {task.labels.length > 0 && (
            <div className="flex items-center gap-1">
              <Tag size={10} className="text-text-secondary" />
              <span className="text-xs text-text-secondary">{task.labels.length}</span>
            </div>
          )}
        </div>
        {task.sessionId && (
          <div className="flex items-center gap-1 text-xs text-text-secondary">
            <MessageSquare size={10} />
          </div>
        )}
      </div>
    </div>
  );
}

interface TaskColumnProps {
  column: Column;
  tasks: AgentTask[];
  onUpdate: (taskId: string, updates: Partial<AgentTask>) => void;
  onDelete: (taskId: string) => void;
  onStart: (taskId: string) => void;
  onTaskClick: (task: AgentTask) => void;
  onAddTask: (status: TaskStatus) => void;
}

function TaskColumn({
  column,
  tasks,
  onUpdate,
  onDelete,
  onStart,
  onTaskClick,
  onAddTask,
}: TaskColumnProps) {
  return (
    <div className="flex flex-col min-w-[280px] max-w-[320px]">
      <div className={cn('flex items-center justify-between px-3 py-2 rounded-t-lg', column.bgColor)}>
        <div className="flex items-center gap-2">
          <span className={column.color}>{column.icon}</span>
          <span className="text-sm font-medium">{column.title}</span>
          <span className="text-xs text-text-secondary bg-elevated px-1.5 py-0.5 rounded-full">
            {tasks.length}
          </span>
        </div>
        {column.id === 'todo' && (
          <button
            onClick={() => onAddTask(column.id)}
            className="p-1 hover:bg-border rounded transition-colors"
          >
            <Plus size={14} className="text-text-secondary" />
          </button>
        )}
      </div>

      <div className={cn('flex-1 p-2 space-y-2 rounded-b-lg min-h-[200px]', column.bgColor)}>
        {tasks.map((task) => (
          <TaskCard
            key={task.id}
            task={task}
            onUpdate={onUpdate}
            onDelete={onDelete}
            onStart={onStart}
            onClick={onTaskClick}
          />
        ))}
        {tasks.length === 0 && (
          <div className="text-center py-8 text-text-secondary text-sm">
            No tasks
          </div>
        )}
      </div>
    </div>
  );
}

interface TaskBoardProps {
  agentType: AgentType;
  tasks: AgentTask[];
  onTasksChange: () => void;
  onAddTask: () => void;
  onTaskClick: (task: AgentTask) => void;
}

export function TaskBoard({
  agentType,
  tasks,
  onTasksChange,
  onAddTask,
  onTaskClick,
}: TaskBoardProps) {
  const handleUpdate = async (taskId: string, updates: Partial<AgentTask>) => {
    try {
      await fetch(`${API_BASE}/api/agents/tasks/${taskId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      });
      onTasksChange();
    } catch (error) {
      console.error('Failed to update task:', error);
    }
  };

  const handleDelete = async (taskId: string) => {
    if (!confirm('Are you sure you want to delete this task?')) return;
    try {
      await fetch(`${API_BASE}/api/agents/tasks/${taskId}`, {
        method: 'DELETE',
      });
      onTasksChange();
    } catch (error) {
      console.error('Failed to delete task:', error);
    }
  };

  const handleStart = async (taskId: string) => {
    try {
      await fetch(`${API_BASE}/api/agents/tasks/${taskId}/start`, {
        method: 'POST',
      });
      onTasksChange();
    } catch (error) {
      console.error('Failed to start task:', error);
    }
  };

  const tasksByStatus = COLUMNS.reduce(
    (acc, column) => {
      acc[column.id] = tasks.filter((task) => task.status === column.id);
      return acc;
    },
    {} as Record<TaskStatus, AgentTask[]>
  );

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <div className="flex items-center gap-4">
          <h2 className="font-medium">Tasks</h2>
          <span className="text-sm text-text-secondary">{tasks.length} total</span>
        </div>
        <button
          onClick={onAddTask}
          className="flex items-center gap-2 px-3 py-1.5 bg-accent-blue text-white rounded-lg text-sm hover:bg-accent-blue/90 transition-colors"
        >
          <Plus size={14} />
          Assign Task
        </button>
      </div>

      {/* Board */}
      <div className="flex-1 overflow-x-auto p-4">
        <div className="flex gap-4 min-w-max">
          {COLUMNS.map((column) => (
            <TaskColumn
              key={column.id}
              column={column}
              tasks={tasksByStatus[column.id] || []}
              onUpdate={handleUpdate}
              onDelete={handleDelete}
              onStart={handleStart}
              onTaskClick={onTaskClick}
              onAddTask={onAddTask}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
