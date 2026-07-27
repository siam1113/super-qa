'use client';

import { useEffect, useState, useMemo } from 'react';
import { cn } from '@/lib/utils';
import { useAppStore } from '@/lib/store';
import type { Page } from '@/lib/types';
import {
  Search,
  LayoutDashboard,
  TestTube,
  Code,
  Box,
  Database,
  Settings,
  X,
  Link,
  Briefcase,
  Cpu,
  Cog,
  Lightbulb,
} from 'lucide-react';

type Command = {
  id: string;
  label: string;
  icon: React.ReactNode;
  action: () => void;
  category: 'navigation' | 'action';
};

export function CommandPalette() {
  const { searchOpen, setSearchOpen, setCurrentPage } = useAppStore();
  const [query, setQuery] = useState('');

  const commands: Command[] = useMemo(() => [
    // Main
    { id: 'dashboard', label: 'Go to Dashboard', icon: <LayoutDashboard size={18} />, action: () => setCurrentPage('dashboard'), category: 'navigation' },
    // Context
    { id: 'sources', label: 'Go to Sources', icon: <Link size={18} />, action: () => setCurrentPage('sources'), category: 'navigation' },
    { id: 'business', label: 'Go to Business Knowledge', icon: <Briefcase size={18} />, action: () => setCurrentPage('business'), category: 'navigation' },
    // Technical
    { id: 'technical-apis', label: 'Go to APIs', icon: <Cpu size={18} />, action: () => setCurrentPage('technical-apis'), category: 'navigation' },
    { id: 'technical-code', label: 'Go to Code', icon: <Code size={18} />, action: () => setCurrentPage('technical-code'), category: 'navigation' },
    // Quality
    { id: 'test-cases', label: 'Go to Test Cases', icon: <TestTube size={18} />, action: () => setCurrentPage('test-cases'), category: 'navigation' },
    // Automation
    { id: 'actions', label: 'Go to Actions', icon: <Cog size={18} />, action: () => setCurrentPage('actions'), category: 'navigation' },
    { id: 'dom', label: 'Go to DOM', icon: <Box size={18} />, action: () => setCurrentPage('dom'), category: 'navigation' },
    { id: 'data-setup', label: 'Go to Data Setup', icon: <Database size={18} />, action: () => setCurrentPage('data-setup'), category: 'navigation' },
    // Product
    { id: 'features', label: 'Go to Features', icon: <Lightbulb size={18} />, action: () => setCurrentPage('features'), category: 'navigation' },
    // Settings
    { id: 'settings', label: 'Go to Settings', icon: <Settings size={18} />, action: () => setCurrentPage('settings'), category: 'navigation' },
  ], [setCurrentPage]);

  const filteredCommands = useMemo(() => {
    if (!query) return commands;
    return commands.filter((cmd) =>
      cmd.label.toLowerCase().includes(query.toLowerCase())
    );
  }, [commands, query]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setSearchOpen(!searchOpen);
      }
      if (e.key === 'Escape' && searchOpen) {
        setSearchOpen(false);
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [searchOpen, setSearchOpen]);

  useEffect(() => {
    if (!searchOpen) {
      setQuery('');
    }
  }, [searchOpen]);

  if (!searchOpen) return null;

  const handleSelect = (command: Command) => {
    command.action();
    setSearchOpen(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[20vh]">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={() => setSearchOpen(false)}
      />

      {/* Palette */}
      <div className="relative w-full max-w-lg bg-surface border border-border rounded-xl shadow-2xl overflow-hidden animate-fade-in">
        {/* Search input */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-border">
          <Search size={20} className="text-text-secondary" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search commands..."
            className="flex-1 bg-transparent outline-none text-text-primary placeholder:text-text-secondary"
            autoFocus
          />
          <button
            onClick={() => setSearchOpen(false)}
            className="p-1 hover:bg-elevated rounded transition-colors"
          >
            <X size={16} className="text-text-secondary" />
          </button>
        </div>

        {/* Results */}
        <div className="max-h-80 overflow-y-auto p-2">
          {filteredCommands.length === 0 ? (
            <div className="px-4 py-8 text-center text-text-secondary">
              No commands found
            </div>
          ) : (
            <div className="space-y-1">
              {filteredCommands.map((command) => (
                <button
                  key={command.id}
                  onClick={() => handleSelect(command)}
                  className={cn(
                    'w-full flex items-center gap-3 px-3 py-2 rounded-lg',
                    'text-left text-sm text-text-primary',
                    'hover:bg-elevated transition-colors'
                  )}
                >
                  <span className="text-text-secondary">{command.icon}</span>
                  <span>{command.label}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center gap-4 px-4 py-2 border-t border-border text-xs text-text-secondary">
          <span className="flex items-center gap-1">
            <kbd className="px-1.5 py-0.5 bg-elevated rounded">↵</kbd>
            <span>to select</span>
          </span>
          <span className="flex items-center gap-1">
            <kbd className="px-1.5 py-0.5 bg-elevated rounded">esc</kbd>
            <span>to close</span>
          </span>
        </div>
      </div>
    </div>
  );
}
