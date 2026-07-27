'use client';

import { cn, formatRelativeTime } from '@/lib/utils';
import { useAppStore } from '@/lib/store';
import { X, Check, AlertTriangle, Wrench, GitPullRequest, RefreshCw } from 'lucide-react';

const notifications = [
  {
    id: '1',
    type: 'success',
    title: 'Execution completed',
    message: 'Suite "Checkout Flow" passed with 24/24 tests',
    time: new Date(Date.now() - 5 * 60000).toISOString(),
    icon: <Check size={16} />,
  },
  {
    id: '2',
    type: 'warning',
    title: 'Healing suggestion',
    message: '3 locators need review in Payment tests',
    time: new Date(Date.now() - 15 * 60000).toISOString(),
    icon: <Wrench size={16} />,
  },
  {
    id: '3',
    type: 'info',
    title: 'PR awaiting review',
    message: 'AI generated test improvements for Login flow',
    time: new Date(Date.now() - 30 * 60000).toISOString(),
    icon: <GitPullRequest size={16} />,
  },
  {
    id: '4',
    type: 'error',
    title: 'Test failure',
    message: 'TC-1042 Payment decline failed on staging',
    time: new Date(Date.now() - 45 * 60000).toISOString(),
    icon: <AlertTriangle size={16} />,
  },
  {
    id: '5',
    type: 'info',
    title: 'Context updated',
    message: 'Confluence sync completed - 12 new facts',
    time: new Date(Date.now() - 2 * 3600000).toISOString(),
    icon: <RefreshCw size={16} />,
  },
];

export function NotificationCenter() {
  const { notificationsOpen, setNotificationsOpen } = useAppStore();

  if (!notificationsOpen) return null;

  const getTypeStyles = (type: string) => {
    switch (type) {
      case 'success':
        return 'bg-success/10 text-success';
      case 'warning':
        return 'bg-warning/10 text-warning';
      case 'error':
        return 'bg-danger/10 text-danger';
      default:
        return 'bg-info/10 text-info';
    }
  };

  return (
    <div className="fixed inset-0 z-50">
      {/* Backdrop */}
      <div
        className="absolute inset-0"
        onClick={() => setNotificationsOpen(false)}
      />

      {/* Panel */}
      <div className="absolute top-14 right-4 w-96 bg-surface border border-border rounded-xl shadow-2xl overflow-hidden animate-slide-in">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <h3 className="font-medium">Notifications</h3>
          <div className="flex items-center gap-2">
            <button className="text-sm text-accent-blue hover:underline">
              Mark all read
            </button>
            <button
              onClick={() => setNotificationsOpen(false)}
              className="p-1 hover:bg-elevated rounded transition-colors"
            >
              <X size={16} className="text-text-secondary" />
            </button>
          </div>
        </div>

        {/* Notifications list */}
        <div className="max-h-96 overflow-y-auto">
          {notifications.map((notification) => (
            <div
              key={notification.id}
              className="px-4 py-3 border-b border-border hover:bg-elevated transition-colors cursor-pointer"
            >
              <div className="flex gap-3">
                <div className={cn('w-8 h-8 rounded-lg flex items-center justify-center', getTypeStyles(notification.type))}>
                  {notification.icon}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-text-primary">{notification.title}</p>
                  <p className="text-sm text-text-secondary truncate">{notification.message}</p>
                  <p className="text-xs text-text-secondary mt-1">{formatRelativeTime(notification.time)}</p>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="px-4 py-2 border-t border-border">
          <button className="w-full text-center text-sm text-accent-blue hover:underline">
            View all notifications
          </button>
        </div>
      </div>
    </div>
  );
}
