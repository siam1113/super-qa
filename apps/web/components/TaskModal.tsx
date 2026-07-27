'use client';

import { useState, useEffect } from 'react';
import { cn } from '@/lib/utils';
import type { AgentTask, TaskStatus, TaskPriority, AgentType } from '@/lib/types';
import {
  X,
  AlertTriangle,
  ArrowUp,
  ArrowRight,
  ArrowDown,
  Tag,
  Plus,
  Loader2,
  Clock,
  Play,
  CheckCircle2,
  XCircle,
  Ban,
  Calendar,
  MessageSquare,
} from 'lucide-react';

const API_BASE = 'http://localhost:4000';

const PRIORITY_OPTIONS: { value: TaskPriority; label: string; icon: React.ReactNode; color: string }[] = [
  { value: 'urgent', label: 'Urgent', icon: <AlertTriangle size={14} />, color: 'text-danger' },
  { value: 'high', label: 'High', icon: <ArrowUp size={14} />, color: 'text-warning' },
  { value: 'medium', label: 'Medium', icon: <ArrowRight size={14} />, color: 'text-info' },
  { value: 'low', label: 'Low', icon: <ArrowDown size={14} />, color: 'text-text-secondary' },
];

const STATUS_OPTIONS: { value: TaskStatus; label: string; icon: React.ReactNode; color: string }[] = [
  { value: 'todo', label: 'To Do', icon: <Clock size={14} />, color: 'text-text-secondary' },
  { value: 'in_progress', label: 'In Progress', icon: <Play size={14} />, color: 'text-info' },
  { value: 'blocked', label: 'Blocked', icon: <Ban size={14} />, color: 'text-warning' },
  { value: 'done', label: 'Done', icon: <CheckCircle2 size={14} />, color: 'text-success' },
  { value: 'cancelled', label: 'Cancelled', icon: <XCircle size={14} />, color: 'text-text-secondary' },
];

const COMMON_LABELS = [
  'test-design',
  'automation',
  'regression',
  'smoke',
  'api',
  'ui',
  'performance',
  'security',
  'accessibility',
  'mobile',
  'critical-path',
  'flaky',
];

interface TaskModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: () => void;
  agentType: AgentType;
  task?: AgentTask | null;
}

export function TaskModal({ isOpen, onClose, onSave, agentType, task }: TaskModalProps) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState<TaskPriority>('medium');
  const [status, setStatus] = useState<TaskStatus>('todo');
  const [labels, setLabels] = useState<string[]>([]);
  const [newLabel, setNewLabel] = useState('');
  const [blockedReason, setBlockedReason] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showLabelInput, setShowLabelInput] = useState(false);

  const isEditing = !!task;

  useEffect(() => {
    if (task) {
      setTitle(task.title);
      setDescription(task.description || '');
      setPriority(task.priority);
      setStatus(task.status);
      setLabels(task.labels || []);
      setBlockedReason(task.blockedReason || '');
    } else {
      setTitle('');
      setDescription('');
      setPriority('medium');
      setStatus('todo');
      setLabels([]);
      setBlockedReason('');
    }
  }, [task, isOpen]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;

    setIsSubmitting(true);

    try {
      if (isEditing && task) {
        // Update existing task
        await fetch(`${API_BASE}/api/agents/tasks/${task.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: title.trim(),
            description: description.trim() || null,
            priority,
            status,
            labels,
            blockedReason: status === 'blocked' ? blockedReason : null,
          }),
        });
      } else {
        // Create new task
        await fetch(`${API_BASE}/api/agents/${agentType}/tasks`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: title.trim(),
            description: description.trim() || null,
            priority,
            labels,
          }),
        });
      }

      onSave();
      onClose();
    } catch (error) {
      console.error('Failed to save task:', error);
    } finally {
      setIsSubmitting(false);
    }
  };

  const addLabel = (label: string) => {
    if (label && !labels.includes(label)) {
      setLabels([...labels, label]);
    }
    setNewLabel('');
    setShowLabelInput(false);
  };

  const removeLabel = (label: string) => {
    setLabels(labels.filter((l) => l !== label));
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />

      {/* Modal */}
      <div className="relative bg-base border border-border rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <h2 className="text-lg font-semibold">
            {isEditing ? 'Edit Task' : 'Create Task'}
          </h2>
          <button
            onClick={onClose}
            className="p-2 hover:bg-elevated rounded-lg transition-colors"
          >
            <X size={18} className="text-text-secondary" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="overflow-y-auto max-h-[calc(90vh-140px)]">
          <div className="p-6 space-y-6">
            {/* Title */}
            <div>
              <label className="block text-sm font-medium mb-2">
                Task Title <span className="text-danger">*</span>
              </label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Enter task title..."
                className="w-full px-4 py-2.5 bg-elevated border border-border rounded-lg text-sm outline-none focus:border-accent-blue transition-colors"
                autoFocus
              />
            </div>

            {/* Description */}
            <div>
              <label className="block text-sm font-medium mb-2">Description</label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Add a description..."
                rows={4}
                className="w-full px-4 py-2.5 bg-elevated border border-border rounded-lg text-sm outline-none focus:border-accent-blue transition-colors resize-none"
              />
            </div>

            {/* Priority & Status Row */}
            <div className="grid grid-cols-2 gap-4">
              {/* Priority */}
              <div>
                <label className="block text-sm font-medium mb-2">Priority</label>
                <div className="grid grid-cols-2 gap-2">
                  {PRIORITY_OPTIONS.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => setPriority(option.value)}
                      className={cn(
                        'flex items-center gap-2 px-3 py-2 rounded-lg border text-sm transition-colors',
                        priority === option.value
                          ? 'border-accent-blue bg-accent-blue/10'
                          : 'border-border hover:border-accent-blue/50'
                      )}
                    >
                      <span className={option.color}>{option.icon}</span>
                      <span>{option.label}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Status (only for editing) */}
              {isEditing && (
                <div>
                  <label className="block text-sm font-medium mb-2">Status</label>
                  <select
                    value={status}
                    onChange={(e) => setStatus(e.target.value as TaskStatus)}
                    className="w-full px-4 py-2.5 bg-elevated border border-border rounded-lg text-sm outline-none focus:border-accent-blue transition-colors"
                  >
                    {STATUS_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>

            {/* Blocked Reason (only when status is blocked) */}
            {isEditing && status === 'blocked' && (
              <div>
                <label className="block text-sm font-medium mb-2">Blocked Reason</label>
                <input
                  type="text"
                  value={blockedReason}
                  onChange={(e) => setBlockedReason(e.target.value)}
                  placeholder="Why is this task blocked?"
                  className="w-full px-4 py-2.5 bg-elevated border border-border rounded-lg text-sm outline-none focus:border-accent-blue transition-colors"
                />
              </div>
            )}

            {/* Labels */}
            <div>
              <label className="block text-sm font-medium mb-2">Labels</label>
              <div className="flex flex-wrap gap-2 mb-3">
                {labels.map((label) => (
                  <span
                    key={label}
                    className="flex items-center gap-1 px-2 py-1 bg-elevated rounded-lg text-sm"
                  >
                    <Tag size={12} className="text-text-secondary" />
                    {label}
                    <button
                      type="button"
                      onClick={() => removeLabel(label)}
                      className="ml-1 hover:text-danger"
                    >
                      <X size={12} />
                    </button>
                  </span>
                ))}
                {showLabelInput ? (
                  <input
                    type="text"
                    value={newLabel}
                    onChange={(e) => setNewLabel(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        addLabel(newLabel);
                      }
                      if (e.key === 'Escape') {
                        setShowLabelInput(false);
                        setNewLabel('');
                      }
                    }}
                    onBlur={() => {
                      if (newLabel) addLabel(newLabel);
                      else setShowLabelInput(false);
                    }}
                    placeholder="Add label..."
                    className="px-2 py-1 bg-elevated border border-border rounded-lg text-sm outline-none focus:border-accent-blue w-32"
                    autoFocus
                  />
                ) : (
                  <button
                    type="button"
                    onClick={() => setShowLabelInput(true)}
                    className="flex items-center gap-1 px-2 py-1 border border-dashed border-border rounded-lg text-sm text-text-secondary hover:border-accent-blue hover:text-accent-blue transition-colors"
                  >
                    <Plus size={12} />
                    Add label
                  </button>
                )}
              </div>

              {/* Common labels */}
              <div className="flex flex-wrap gap-1.5">
                {COMMON_LABELS.filter((l) => !labels.includes(l)).slice(0, 8).map((label) => (
                  <button
                    key={label}
                    type="button"
                    onClick={() => addLabel(label)}
                    className="px-2 py-0.5 text-xs text-text-secondary hover:text-text-primary bg-elevated hover:bg-border rounded transition-colors"
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {/* Task Info (only for editing) */}
            {isEditing && task && (
              <div className="pt-4 border-t border-border">
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div className="flex items-center gap-2 text-text-secondary">
                    <Calendar size={14} />
                    <span>Created: {new Date(task.createdAt).toLocaleDateString()}</span>
                  </div>
                  {task.startedAt && (
                    <div className="flex items-center gap-2 text-text-secondary">
                      <Play size={14} />
                      <span>Started: {new Date(task.startedAt).toLocaleDateString()}</span>
                    </div>
                  )}
                  {task.completedAt && (
                    <div className="flex items-center gap-2 text-text-secondary">
                      <CheckCircle2 size={14} />
                      <span>Completed: {new Date(task.completedAt).toLocaleDateString()}</span>
                    </div>
                  )}
                  {task.sessionId && (
                    <div className="flex items-center gap-2 text-text-secondary">
                      <MessageSquare size={14} />
                      <span>Has chat session</span>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-border bg-elevated">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm hover:bg-border rounded-lg transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!title.trim() || isSubmitting}
              className={cn(
                'flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors',
                title.trim() && !isSubmitting
                  ? 'bg-accent-blue text-white hover:bg-accent-blue/90'
                  : 'bg-elevated text-text-secondary cursor-not-allowed'
              )}
            >
              {isSubmitting && <Loader2 size={14} className="animate-spin" />}
              {isEditing ? 'Save Changes' : 'Create Task'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
