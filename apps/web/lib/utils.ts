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

/** Formats a millisecond duration as ms/s/m/h, picking the coarsest unit that keeps
 * the number readable (e.g. 850 -> "850ms", 4200 -> "4.2s", 125000 -> "2m 5s"). */
export function formatMs(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const totalSeconds = ms / 1000;
  if (totalSeconds < 60) {
    const rounded = Math.round(totalSeconds * 10) / 10;
    return `${rounded % 1 === 0 ? rounded.toFixed(0) : rounded.toFixed(1)}s`;
  }
  const totalMinutes = Math.floor(totalSeconds / 60);
  const seconds = Math.round(totalSeconds % 60);
  if (totalMinutes < 60) return seconds > 0 ? `${totalMinutes}m ${seconds}s` : `${totalMinutes}m`;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
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
    ready: 'text-info',
    draft: 'text-text-secondary',
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
    ready: 'bg-info/10 text-info',
    draft: 'bg-text-secondary/10 text-text-secondary',
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
