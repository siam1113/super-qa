import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return secs > 0 ? `${mins}m ${secs}s` : `${mins}m`;
}

export function formatRelativeTime(date: string | Date): string {
  const now = new Date();
  const then = new Date(date);
  const diff = now.getTime() - then.getTime();

  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;
  return then.toLocaleDateString();
}

export function getStatusColor(status: string): string {
  const colors: Record<string, string> = {
    passed: 'text-success',
    failed: 'text-danger',
    running: 'text-info',
    blocked: 'text-warning',
    skipped: 'text-text-secondary',
    pending: 'text-warning',
    approved: 'text-success',
    rejected: 'text-danger',
  };
  return colors[status] || 'text-text-secondary';
}

export function getStatusBgColor(status: string): string {
  const colors: Record<string, string> = {
    passed: 'bg-success/10 text-success',
    failed: 'bg-danger/10 text-danger',
    running: 'bg-info/10 text-info',
    blocked: 'bg-warning/10 text-warning',
    skipped: 'bg-text-secondary/10 text-text-secondary',
    pending: 'bg-warning/10 text-warning',
    approved: 'bg-success/10 text-success',
    rejected: 'bg-danger/10 text-danger',
  };
  return colors[status] || 'bg-text-secondary/10 text-text-secondary';
}

export function getRiskColor(risk: string): string {
  const colors: Record<string, string> = {
    low: 'text-success',
    medium: 'text-warning',
    high: 'text-danger',
    critical: 'text-danger',
  };
  return colors[risk] || 'text-text-secondary';
}

export function getPriorityColor(priority: string): string {
  const colors: Record<string, string> = {
    P0: 'text-danger',
    P1: 'text-warning',
    P2: 'text-info',
    P3: 'text-text-secondary',
  };
  return colors[priority] || 'text-text-secondary';
}
