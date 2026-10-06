'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@/lib/utils';
import { themeMode, useAppStore } from '@/lib/store';
import {
  Search,
  Bell,
  Sun,
  Moon,
  ChevronRight,
  LogOut,
  UserRound,
  Activity,
  Building2,
  MessageSquare,
  Radar,
} from 'lucide-react';
import { StatusPanel } from './pages/Status';

const pageNames: Record<string, string> = {
  chat: 'Chat',
  dashboard: 'Dashboard',
  executions: 'Executions',
  'execution-plans': 'Execution Plans',
  'test-cases': 'Test Cases',
  'test-data': 'Data',
  frameworks: 'Framework',
  'automated-tests': 'Automated Tests',
  'test-credentials': 'Test Credentials',
  reports: 'Reports',
  coverage: 'Coverage',
  'user-settings': 'User settings',
  'app-settings': 'Settings',
  settings: 'App settings',
  healer: 'Healer',
  flows: 'Flows',
  facts: 'Facts',
  actions: 'Actions',
  dom: 'POM',
  'data-setup': 'Test Data',
  context: 'Knowledge',
};

export function TopBar() {
  const {
    currentPage,
    theme,
    toggleTheme,
    setSearchOpen,
    setNotificationsOpen,
    notificationsUnreadCount,
    setCurrentPage,
  } = useAppStore();
  const [profileOpen, setProfileOpen] = useState(false);
  const [profileMenuPosition, setProfileMenuPosition] = useState<{ top: number; right: number } | null>(null);
  const avatarButtonRef = useRef<HTMLButtonElement>(null);
  const [account, setAccount] = useState<{ email: string; role: string; accountType?: string; projectId?: string; apps?: Array<{ projectId: string; appName: string; organizationName: string | null; role: string }> } | null>(null);
  const [signOutError, setSignOutError] = useState('');
  const [switchingApp, setSwitchingApp] = useState(false);
  const [statusOpen, setStatusOpen] = useState(false);
  const closeStatus = useCallback(() => setStatusOpen(false), []);

  useEffect(() => {
    let active = true;
    void fetch('/api/auth/session', { credentials: 'same-origin', cache: 'no-store' })
      .then(async response => response.ok ? response.json() : null)
      .then(result => { if (active) setAccount(result?.user || null); })
      .catch(() => { if (active) setAccount(null); });
    return () => { active = false; };
  }, []);

  const signOut = async () => {
    setSignOutError('');
    try {
      const response = await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin', cache: 'no-store' });
      if (!response.ok) throw new Error();
      window.location.assign('/login');
    } catch {
      setSignOutError('Could not sign out. Check your connection and try again.');
    }
  };

  const selectApp = async (projectId: string) => {
    if (switchingApp || projectId === account?.projectId) return;
    setSwitchingApp(true); setSignOutError('');
    try {
      const response = await fetch('/api/auth/select-app', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ projectId }) });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.message || 'Could not switch apps.');
      window.location.assign('/');
    } catch (failure) {
      setSignOutError(failure instanceof Error ? failure.message : 'Could not switch apps.');
      setSwitchingApp(false);
    }
  };

  const initials = account?.email?.split('@')[0].split(/[._-]/).filter(Boolean).slice(0, 2).map(part => part[0]).join('').toUpperCase() || 'M';
  return (
    <header className="relative z-10 flex h-14 items-center justify-between border-b border-border/80 bg-surface/95 px-4 backdrop-blur-sm">
      {/* Left: Breadcrumbs */}
      <div className="flex items-center gap-2 text-sm">
        <span className="text-text-secondary">Workspace</span>
        <ChevronRight size={14} className="text-text-secondary" />
        <span className="text-text-primary font-medium">{pageNames[currentPage] || currentPage}</span>
      </div>

      {/* Right: Actions */}
      <div className="flex items-center gap-2">
        {/* Search */}
        <button
          onClick={() => setSearchOpen(true)}
          className={cn(
            'flex items-center gap-2 px-3 py-1.5 rounded-lg',
            'bg-elevated text-text-secondary text-sm',
            'hover:bg-border transition-colors'
          )}
        >
          <Search size={16} />
          <span>Search</span>
          <kbd className="ml-2 px-1.5 py-0.5 text-xs bg-surface rounded border border-border">
            ⌘K
          </kbd>
        </button>

        <button
          type="button"
          onClick={() => setCurrentPage('chat')}
          className={cn('ui-toolbar-button', currentPage === 'chat' && 'border-accent-blue/20 bg-accent-blue/10 text-accent-blue')}
          title="Chat"
          aria-label="Open Chat"
          aria-current={currentPage === 'chat' ? 'page' : undefined}
        ><MessageSquare size={18} /></button>
        <button
          type="button"
          onClick={() => setCurrentPage('command-center')}
          className={cn('ui-toolbar-button', currentPage === 'command-center' && 'border-accent-blue/20 bg-accent-blue/10 text-accent-blue')}
          title="Command Center"
          aria-label="Open Command Center"
          aria-current={currentPage === 'command-center' ? 'page' : undefined}
        ><Radar size={18} /></button>

        {/* Notifications */}
        <button
          onClick={() => setNotificationsOpen(true)}
          className="ui-toolbar-button relative"
          aria-label={notificationsUnreadCount ? `Notifications, ${notificationsUnreadCount} unread` : 'Notifications'}
          title={notificationsUnreadCount ? `${notificationsUnreadCount} unread notification${notificationsUnreadCount === 1 ? '' : 's'}` : 'Notifications'}
        >
          <Bell size={18} className="text-text-secondary" />
          {notificationsUnreadCount > 0 && <span className="absolute -top-0.5 -right-0.5 min-w-4 h-4 px-1 rounded-full bg-danger text-white text-[10px] leading-4 text-center">{notificationsUnreadCount > 99 ? '99+' : notificationsUnreadCount}</span>}
        </button>

        {/* Theme toggle */}
        <button
          onClick={toggleTheme}
          className="ui-toolbar-button"
          title={themeMode(theme) === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
          aria-label={themeMode(theme) === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
        >
          {themeMode(theme) === 'dark' ? (
            <Sun size={18} className="text-text-secondary" />
          ) : (
            <Moon size={18} className="text-text-secondary" />
          )}
        </button>

        {account?.accountType === 'organization' && <button
          onClick={() => setStatusOpen(true)}
          className="ui-toolbar-button"
          title="Client service status"
          aria-label="Open client service status"
        >
          <Activity size={18} className="text-text-secondary" />
        </button>}

        {/* User avatar */}
        <button
          ref={avatarButtonRef}
          onClick={() => {
            setProfileOpen(open => {
              const next = !open;
              if (next && avatarButtonRef.current) {
                const rect = avatarButtonRef.current.getBoundingClientRect();
                setProfileMenuPosition({ top: rect.bottom + 8, right: window.innerWidth - rect.right });
              }
              return next;
            });
            setSignOutError('');
          }}
          className="w-8 h-8 rounded-full bg-accent-blue flex items-center justify-center text-white text-sm font-medium focus:outline-none focus:ring-2 focus:ring-accent-blue focus:ring-offset-2 focus:ring-offset-surface"
          aria-label="Open profile menu"
          aria-haspopup="menu"
          aria-expanded={profileOpen}
          title={account?.email || 'Profile'}
        >
          {initials}
        </button>
      </div>
      {profileOpen && profileMenuPosition && createPortal(<>
        <button className="fixed inset-0 z-[90] cursor-default" aria-label="Close profile menu" onClick={() => setProfileOpen(false)} />
        <div role="menu" aria-label="Profile" style={{ top: profileMenuPosition.top, right: profileMenuPosition.right }} className="fixed z-[100] w-72 rounded-xl border border-border bg-surface p-2 shadow-2xl">
          <div className="border-b border-border px-3 py-2">
            <p className="truncate text-sm font-medium text-text-primary">{account?.email || 'Not signed in'}</p>
            <p className="mt-1 text-xs capitalize text-text-secondary">{account ? account.role.replaceAll('_', ' ') : 'Session unavailable'}</p>
          </div>
          {signOutError && <p role="alert" className="px-3 py-2 text-xs text-danger">{signOutError}</p>}
          {account ? <>
            {account.accountType === 'organization' && (account.apps?.length || 0) > 1 && <div className="border-b border-border px-1 py-2">
              <p className="px-2 pb-1 text-xs font-medium text-text-secondary">Switch app</p>
              <div className="max-h-48 space-y-0.5 overflow-y-auto">{account.apps?.map(app => <button key={app.projectId} role="menuitem" disabled={switchingApp} onClick={() => void selectApp(app.projectId)} className={'flex w-full items-start justify-between gap-2 rounded-lg px-2 py-2 text-left text-sm hover:bg-elevated disabled:opacity-50 ' + (app.projectId === account.projectId ? 'bg-accent-blue/5' : '')}>
                <span className="min-w-0"><span className="block truncate font-medium">{app.appName}</span><span className="mt-0.5 block truncate text-xs text-text-secondary">{app.organizationName || 'Organization'}</span></span>
                {app.projectId === account.projectId && <span className="shrink-0 text-[11px] text-accent-blue">Current</span>}
              </button>)}</div>
            </div>}
            {account.accountType === 'super_admin' && <button role="menuitem" onClick={() => { setCurrentPage('user-settings'); setProfileOpen(false); }} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm hover:bg-elevated"><Activity size={16} /> App management</button>}
            {account.accountType === 'organization' && account.role === 'owner' && <button role="menuitem" onClick={() => { setCurrentPage('user-settings'); setProfileOpen(false); }} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm hover:bg-elevated"><Building2 size={16} /> Organization settings</button>}
            <button role="menuitem" onClick={() => { setCurrentPage('user-settings'); setProfileOpen(false); }} className="mt-1 flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm hover:bg-elevated"><UserRound size={16} /> User settings</button>
            <button role="menuitem" onClick={() => void signOut()} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-danger hover:bg-elevated"><LogOut size={16} /> Sign out</button>
          </> : <a role="menuitem" href="/login" className="mt-1 flex items-center gap-2 rounded-lg px-3 py-2 text-sm hover:bg-elevated"><UserRound size={16} /> Sign in</a>}
        </div>
      </>, document.body)}
      <StatusPanel open={statusOpen} onClose={closeStatus} />
    </header>
  );
}
