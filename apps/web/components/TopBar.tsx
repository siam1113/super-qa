'use client';

import { cn } from '@/lib/utils';
import { useAppStore } from '@/lib/store';
import {
  Search,
  Bell,
  Sun,
  Moon,
  ChevronRight,
} from 'lucide-react';

const pageNames: Record<string, string> = {
  dashboard: 'Dashboard',
  executions: 'Executions',
  'test-cases': 'Test Cases',
  healer: 'Healer',
  flows: 'Flows',
  facts: 'Facts',
  actions: 'Actions',
  dom: 'DOM',
  'data-setup': 'Data Setup',
  settings: 'Settings',
  context: 'Context Manager',
};

export function TopBar() {
  const {
    currentPage,
    theme,
    toggleTheme,
    setSearchOpen,
    setNotificationsOpen,
  } = useAppStore();

  return (
    <header className="h-14 bg-surface border-b border-border flex items-center justify-between px-4">
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

        {/* Notifications */}
        <button
          onClick={() => setNotificationsOpen(true)}
          className="relative p-2 hover:bg-elevated rounded-lg transition-colors"
        >
          <Bell size={18} className="text-text-secondary" />
          <span className="absolute top-1 right-1 w-2 h-2 bg-danger rounded-full" />
        </button>

        {/* Theme toggle */}
        <button
          onClick={toggleTheme}
          className="p-2 hover:bg-elevated rounded-lg transition-colors"
        >
          {theme === 'dark' ? (
            <Sun size={18} className="text-text-secondary" />
          ) : (
            <Moon size={18} className="text-text-secondary" />
          )}
        </button>

        {/* User avatar */}
        <button className="w-8 h-8 rounded-full bg-accent-blue flex items-center justify-center text-white text-sm font-medium">
          M
        </button>
      </div>
    </header>
  );
}
