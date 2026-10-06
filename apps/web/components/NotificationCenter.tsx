'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { cn, formatRelativeTime } from '@/lib/utils';
import { useAppStore } from '@/lib/store';
import { X, Check, AlertTriangle, CircleX, Inbox } from 'lucide-react';

type SyncJob = {
  id: string;
  sourceId: string;
  sourceName?: string;
  status: string;
  errorMessage?: string | null;
  startedAt?: string;
  completedAt?: string;
  createdAt: string;
};

type ActivityNotification = {
  id: string;
  jobId: string;
  type: 'success' | 'error' | 'info';
  title: string;
  message: string;
  time: string;
};

const STORAGE_KEY = 'superqa-notification-state-v1';
const TERMINAL = new Set(['completed', 'failed', 'cancelled']);
const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

export function NotificationCenter() {
  const { notificationsOpen, setNotificationsOpen, setNotificationsUnreadCount, setCurrentPage, setSelectedSyncJobId } = useAppStore();
  const [notifications, setNotifications] = useState<ActivityNotification[]>([]);
  const [readIds, setReadIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const readIdsRef = useRef<string[]>([]);
  const knownIdsRef = useRef<string[]>([]);
  const readyRef = useRef(false);
  const inFlightRef = useRef(false);

  const saveState = useCallback((knownIds: string[], nextReadIds: string[]) => {
    const known = knownIds.slice(-300);
    const read = nextReadIds.slice(-300);
    knownIdsRef.current = known;
    readIdsRef.current = read;
    setReadIds(read);
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ knownIds: known, readIds: read })); } catch { /* In-memory read state still works for this visit. */ }
  }, []);

  const refresh = useCallback(async () => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    setLoading(true);
    try {
      const response = await fetch(`${API_BASE}/api/sources/jobs/all?limit=50`, { cache: 'no-store' });
      if (!response.ok) throw new Error('Could not load sync activity.');
      const result = await response.json() as { jobs?: SyncJob[] };
      const terminalJobs = (result.jobs || []).filter(job => TERMINAL.has(job.status));
      const nextNotifications = terminalJobs.map(job => {
        const failed = job.status === 'failed';
        const cancelled = job.status === 'cancelled';
        return {
          id: `sync-job:${job.id}`,
          jobId: job.id,
          type: failed ? 'error' as const : cancelled ? 'info' as const : 'success' as const,
          title: failed ? 'Sync failed' : cancelled ? 'Sync cancelled' : 'Sync completed',
          message: failed ? `${job.sourceName || 'Source sync'}${job.errorMessage ? `: ${job.errorMessage}` : ' encountered an error.'}` : `${job.sourceName || 'Source sync'} ${cancelled ? 'was cancelled.' : 'finished successfully.'}`,
          time: job.completedAt || job.createdAt,
        };
      });

      let known = knownIdsRef.current;
      let read = readIdsRef.current;
      if (!readyRef.current) {
        let persisted = false;
        try {
          const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
          if (saved && Array.isArray(saved.knownIds) && Array.isArray(saved.readIds)) {
            persisted = true;
            known = saved.knownIds.filter((id: unknown): id is string => typeof id === 'string');
            read = saved.readIds.filter((id: unknown): id is string => typeof id === 'string');
          }
        } catch { /* Ignore malformed or unavailable browser storage. */ }
        if (!persisted) {
          known = nextNotifications.map(notification => notification.id);
          read = known;
        }
        readyRef.current = true;
      }

      const freshIds = nextNotifications.map(notification => notification.id).filter(id => !known.includes(id));
      known = [...known, ...nextNotifications.map(notification => notification.id)];
      read = read.filter(id => !freshIds.includes(id));
      saveState(known, read);
      setNotifications(nextNotifications);
      setError('');
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Could not load notifications.');
    } finally {
      inFlightRef.current = false;
      setLoading(false);
    }
  }, [saveState]);

  useEffect(() => {
    void refresh();
    const events = new EventSource(`${API_BASE}/api/sources/events`);
    let timer: number | undefined;
    const onJobUpdate = () => {
      if (timer) clearTimeout(timer);
      timer = window.setTimeout(() => void refresh(), 500);
    };
    events.addEventListener('job-update', onJobUpdate);
    events.addEventListener('connected', onJobUpdate);
    const onFocus = () => { if (document.visibilityState === 'visible') void refresh(); };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onFocus);
    return () => {
      events.close();
      if (timer) clearTimeout(timer);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onFocus);
    };
  }, [refresh]);

  const unreadCount = useMemo(() => notifications.filter(notification => !readIds.includes(notification.id)).length, [notifications, readIds]);
  useEffect(() => setNotificationsUnreadCount(unreadCount), [unreadCount, setNotificationsUnreadCount]);

  if (!notificationsOpen) return null;

  const markAllRead = () => saveState(knownIdsRef.current, notifications.map(notification => notification.id));
  const openJob = (notification: ActivityNotification) => {
    saveState(knownIdsRef.current, [...readIdsRef.current, notification.id]);
    setNotificationsOpen(false);
    setSelectedSyncJobId(notification.jobId);
    setCurrentPage('sync-jobs');
  };

  const getTypeStyles = (type: ActivityNotification['type']) => {
    if (type === 'success') return 'bg-success/10 text-success';
    if (type === 'error') return 'bg-danger/10 text-danger';
    return 'bg-info/10 text-info';
  };

  return (
    <div className="fixed inset-0 z-50">
      <button className="absolute inset-0 cursor-default" aria-label="Close notifications" onClick={() => setNotificationsOpen(false)} />
      <section role="dialog" aria-modal="true" aria-labelledby="notification-title" className="ui-dialog-panel absolute right-4 top-14 flex max-h-[min(32rem,calc(100vh-4.5rem))] w-[min(24rem,calc(100vw-2rem))] flex-col overflow-hidden">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <div>
            <h3 id="notification-title" className="font-medium">Notifications</h3>
            <p className="mt-0.5 text-xs text-text-secondary">{unreadCount ? `${unreadCount} unread` : 'All caught up'}</p>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={markAllRead} disabled={!unreadCount} className="text-sm text-accent-blue hover:underline disabled:cursor-not-allowed disabled:opacity-40">Mark all read</button>
            <button onClick={() => setNotificationsOpen(false)} aria-label="Close notifications" className="rounded p-1 hover:bg-elevated"><X size={16} className="text-text-secondary" /></button>
          </div>
        </div>

        <div className="min-h-24 flex-1 overflow-y-auto">
          {loading && notifications.length === 0 && <p className="p-5 text-sm text-text-secondary">Loading activity…</p>}
          {error && <div className="p-4"><p role="alert" className="text-sm text-danger">{error}</p><button onClick={() => void refresh()} className="mt-2 text-sm text-accent-blue hover:underline">Retry</button></div>}
          {!error && !loading && notifications.length === 0 && <div className="flex flex-col items-center gap-2 p-8 text-center text-text-secondary"><Inbox size={22} /><p className="text-sm">No sync activity yet.</p></div>}
          {notifications.map(notification => {
            const isRead = readIds.includes(notification.id);
            return <button key={notification.id} onClick={() => openJob(notification)} className={cn('flex w-full gap-3 border-b border-border px-4 py-3 text-left transition-colors hover:bg-elevated', !isRead && 'bg-accent-blue/5')}>
              <span className={cn('mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg', getTypeStyles(notification.type))}>
                {notification.type === 'success' ? <Check size={16} /> : notification.type === 'error' ? <AlertTriangle size={16} /> : <CircleX size={16} />}
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2 text-sm font-medium text-text-primary"><span className="truncate">{notification.title}</span>{!isRead && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent-blue" />}</span>
                <span className="mt-0.5 block truncate text-sm text-text-secondary">{notification.message}</span>
                <span className="mt-1 block text-xs text-text-secondary">{formatRelativeTime(notification.time)}</span>
              </span>
            </button>;
          })}
        </div>

        <div className="border-t border-border px-4 py-2">
          <button onClick={() => { setNotificationsOpen(false); setCurrentPage('sync-jobs'); }} className="w-full text-center text-sm text-accent-blue hover:underline">View sync history</button>
        </div>
      </section>
    </div>
  );
}
