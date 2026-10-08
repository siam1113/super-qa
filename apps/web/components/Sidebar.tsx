'use client';

import { useEffect, useMemo, useState } from 'react';
import { cn } from '@/lib/utils';
import { useAppStore, type ContextCounts } from '@/lib/store';
import type { Page } from '@/lib/types';
import { getAgentAvatar } from '@/lib/agent-avatars';
import { useAgentNames } from '@/hooks/useAgentNames';
import {
  Bot,
  Box,
  Bug,
  CheckCircle,
  ClipboardCheck,
  ChevronDown,
  ChevronRight,
  Code,
  ChevronLeft,
  KeyRound,
  Layers3,
  ListChecks,
  Play,
  Server,
  Settings,
  Target,
  TestTube,
  Users,
  Workflow,
  FileText,
} from 'lucide-react';

type NavSection = {
  id: string;
  label: string;
  icon?: React.ReactNode;
  iconTone?: string;
  iconBgTone?: string;
  page?: Page;
  children?: NavSection[];
  count?: number;
  status?: 'success' | 'warning' | 'error';
};

type Navigation = {
  organization: NavSection[];
  app: NavSection[];
};

function AgentNavIcon({ avatar, tone }: { avatar: string | null; tone: string }) {
  const selected = getAgentAvatar(avatar);
  return selected
    ? <span aria-hidden="true" className={`flex h-[18px] w-[18px] flex-none items-center justify-center rounded-md text-[13px] ${selected.color}`}>{selected.emoji}</span>
    : <Bot size={14} className={tone} />;
}

function buildNavigation(counts: ContextCounts, agents: ReturnType<typeof useAgentNames>): Navigation {
  return {
    organization: [
      {
        id: 'agents',
        label: 'Agents',
        icon: <Bot size={15} />,
        iconTone: 'text-accent-blue',
        iconBgTone: 'bg-accent-blue/15',
        children: [
          { id: 'agent-qae', label: agents.qae.name || 'QAE', icon: <AgentNavIcon avatar={agents.qae.avatar} tone="text-accent-blue" />, iconTone: 'text-accent-blue', iconBgTone: 'bg-accent-blue/15', page: 'agent-qae' },
          { id: 'agent-aue', label: agents.aue.name || 'AUE', icon: <AgentNavIcon avatar={agents.aue.avatar} tone="text-accent-purple" />, iconTone: 'text-accent-purple', iconBgTone: 'bg-accent-purple/15', page: 'agent-aue' },
        ],
      },
    ],
    app: [
      {
        id: 'plan',
        label: 'Plan',
        icon: <ListChecks size={15} />,
        iconTone: 'text-accent-blue',
        iconBgTone: 'bg-accent-blue/15',
        children: [
          { id: 'test-cases', label: 'Test Cases', icon: <TestTube size={14} />, iconTone: 'text-accent-blue', iconBgTone: 'bg-accent-blue/15', page: 'test-cases', count: counts.testCases },
          { id: 'execution-plans', label: 'Execution Plans', icon: <Workflow size={14} />, iconTone: 'text-info', iconBgTone: 'bg-info/15', page: 'execution-plans' },
        ],
      },
      {
        id: 'automate',
        label: 'Automate',
        icon: <Layers3 size={15} />,
        iconTone: 'text-accent-purple',
        iconBgTone: 'bg-accent-purple/15',
        children: [
          { id: 'framework', label: 'Framework', icon: <Box size={14} />, iconTone: 'text-accent-purple', iconBgTone: 'bg-accent-purple/15', page: 'frameworks' },
          { id: 'automated-tests', label: 'Automated Tests', icon: <Code size={14} />, iconTone: 'text-info', iconBgTone: 'bg-info/15', page: 'automated-tests' },
        ],
      },
      {
        id: 'execute',
        label: 'Execute',
        icon: <Play size={15} />,
        iconTone: 'text-success',
        iconBgTone: 'bg-success/15',
        children: [
          { id: 'executions', label: 'Executions', icon: <CheckCircle size={14} />, iconTone: 'text-success', iconBgTone: 'bg-success/15', page: 'executions' },
          { id: 'environments', label: 'Environments', icon: <Server size={14} />, iconTone: 'text-info', iconBgTone: 'bg-info/15', page: 'environments' },
          { id: 'test-credentials', label: 'Test Credentials', icon: <KeyRound size={14} />, iconTone: 'text-warning', iconBgTone: 'bg-warning/15', page: 'test-credentials' },
        ],
      },
      {
        id: 'review',
        label: 'Review',
        icon: <ClipboardCheck size={15} />,
        iconTone: 'text-warning',
        iconBgTone: 'bg-warning/15',
        children: [
          { id: 'defects', label: 'Defects', icon: <Bug size={14} />, iconTone: 'text-danger', iconBgTone: 'bg-danger/15', page: 'defects', count: counts.defects, status: counts.defects > 0 ? 'warning' : undefined },
          { id: 'reports', label: 'Reports', icon: <FileText size={14} />, iconTone: 'text-warning', iconBgTone: 'bg-warning/15', page: 'reports' },
          { id: 'coverage', label: 'Coverage', icon: <Target size={14} />, iconTone: 'text-accent-purple', iconBgTone: 'bg-accent-purple/15', page: 'coverage' },
        ],
      },
    ],
  };
}

function NavItem({ item, depth = 0 }: { item: NavSection; depth?: number }) {
  const { currentPage, setCurrentPage, expandedNodes, toggleNode, sidebarCollapsed } = useAppStore();
  const hasChildren = item.children && item.children.length > 0;
  const isExpanded = expandedNodes.has(item.id);
  const isActive = item.page === currentPage;
  const containsActivePage = (section: NavSection): boolean => Boolean(section.children?.some(child => child.page === currentPage || containsActivePage(child)));
  const hasActiveChild = hasChildren && containsActivePage(item);

  const handleClick = () => {
    if (hasChildren) {
      toggleNode(item.id);
    } else if (item.page) {
      setCurrentPage(item.page);
    }
  };

  return (
    <div>
      <button
        type="button"
        onClick={handleClick}
        aria-expanded={hasChildren ? isExpanded : undefined}
        aria-current={isActive ? 'page' : undefined}
        aria-label={sidebarCollapsed ? item.label : undefined}
        title={item.label}
        className={cn(
          'group/section relative flex w-full items-center transition-[color,background-color,transform] duration-200 motion-reduce:transition-none',
          hasChildren
            ? 'min-h-9 gap-2 rounded-lg px-2 text-sm font-semibold hover:bg-elevated/70 hover:text-text-primary'
            : 'min-h-9 gap-2.5 rounded-lg px-2.5 text-sm hover:bg-elevated/80',
          (isActive || hasActiveChild) && 'text-accent-blue',
          isActive && 'bg-accent-blue/10 shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--accent-blue)_18%,transparent)]',
          !isActive && !hasActiveChild && 'text-text-secondary',
          !hasChildren && !isActive && 'hover:translate-x-0.5 hover:text-text-primary motion-reduce:hover:translate-x-0'
        )}
        style={sidebarCollapsed ? { justifyContent: 'center', paddingInline: 0 } : { paddingLeft: depth > 0 ? `${10 + Math.min(depth - 1, 2) * 8}px` : undefined }}
      >
        {item.icon && (!hasChildren || sidebarCollapsed) && <span className={cn(
          'flex flex-none items-center justify-center',
          hasChildren ? 'h-7 w-7 rounded-lg border border-current/10' : 'h-5 w-5',
          item.iconTone,
          hasChildren && item.iconBgTone
        )}>{item.icon}</span>}
        {!sidebarCollapsed && <span className={cn('min-w-0 flex-1 truncate text-left', hasChildren && 'px-0.5')}>{item.label}</span>}
        {!sidebarCollapsed && hasChildren && <span className="ml-auto flex-none text-text-secondary transition-transform duration-200 group-hover/section:text-text-primary">{isExpanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}</span>}
        {!sidebarCollapsed && item.count !== undefined && (
          <span className={cn(
            'px-1.5 py-0.5 text-xs rounded-full',
            item.status === 'warning' && 'bg-warning/10 text-warning',
            item.status === 'error' && 'bg-danger/10 text-danger',
            item.status === 'success' && 'bg-success/10 text-success',
            !item.status && 'bg-elevated text-text-secondary'
          )}>
            {item.count}
          </span>
        )}
      </button>
      {hasChildren && isExpanded && (
        <div className="mt-1 w-full space-y-0.5">
          {item.children!.map(child => <NavItem key={child.id} item={child} depth={depth + 1} />)}
        </div>
      )}
    </div>
  );
}

export function Sidebar() {
  const { sidebarCollapsed, toggleSidebar, contextCounts, currentPage, setCurrentPage } = useAppStore();
  const [isOrganizationAdmin, setIsOrganizationAdmin] = useState(false);
  const agentProfiles = useAgentNames();
  const navigation = useMemo(() => buildNavigation(contextCounts, agentProfiles), [contextCounts, agentProfiles]);

  useEffect(() => {
    let active = true;
    void fetch('/api/auth/session', { credentials: 'same-origin', cache: 'no-store' })
      .then(async response => response.ok ? response.json() : null)
      .then(result => {
        if (active) setIsOrganizationAdmin(result?.user?.accountType === 'organization' && result?.user?.role === 'owner');
      })
      .catch(() => { if (active) setIsOrganizationAdmin(false); });
    return () => { active = false; };
  }, []);

  return (
    <aside
      className={cn(
        'group/sidebar relative h-full flex flex-col border-r border-border/80 bg-surface transition-[width] duration-300 ease-out motion-reduce:transition-none',
        sidebarCollapsed ? 'w-[76px]' : 'w-[248px]'
      )}
    >
      <div className={cn('relative flex h-[76px] flex-none items-center px-3.5', sidebarCollapsed && 'justify-center px-0')}>
        <div className={cn('flex min-w-0 items-center gap-3 rounded-xl py-2', !sidebarCollapsed && 'px-1.5')}>
          {!sidebarCollapsed && (
            <span className="min-w-0 truncate font-mono text-2xl font-semibold tracking-tight lowercase"><span className="text-text-primary">super</span><span className="text-accent-blue">qa</span></span>
          )}
        </div>
      </div>

      <button
        type="button"
        onClick={toggleSidebar}
        className="pointer-events-none absolute -right-3 top-[88px] z-20 flex h-6 w-6 items-center justify-center rounded-full border border-border bg-surface text-text-secondary opacity-0 shadow-md transition-[opacity,color,background-color,transform] duration-150 hover:scale-105 hover:bg-elevated hover:text-text-primary group-hover/sidebar:pointer-events-auto group-hover/sidebar:opacity-100 group-focus-within/sidebar:pointer-events-auto group-focus-within/sidebar:opacity-100"
        aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
      >
        {sidebarCollapsed ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
      </button>

      <nav aria-label="Main navigation" className={cn('flex-1 overflow-y-auto py-4', sidebarCollapsed ? 'px-2.5' : 'px-3')}>
        <div className="space-y-1.5">
          {navigation.organization.map(item => <NavItem key={item.id} item={item} />)}
          <div className="px-1"><div className="h-px bg-border/70" /></div>
          {navigation.app.map(item => <NavItem key={item.id} item={item} />)}
        </div>
      </nav>

      {isOrganizationAdmin && <div className={cn('mx-3 border-t border-border/80 py-2', sidebarCollapsed && 'mx-2.5')}>
        <button
          type="button"
          onClick={() => setCurrentPage('app-settings')}
          title="Settings"
          aria-current={currentPage === 'app-settings' ? 'page' : undefined}
          className={cn(
            'flex h-10 w-full items-center gap-2 rounded-xl px-3 text-sm transition-colors hover:bg-elevated',
            sidebarCollapsed ? 'justify-center' : 'justify-start',
            currentPage === 'app-settings' ? 'bg-accent-blue/10 text-accent-blue' : 'text-text-secondary hover:text-text-primary'
          )}
        >
          <Settings size={16} />
          {!sidebarCollapsed && <span className="truncate">Settings</span>}
        </button>
      </div>}

    </aside>
  );
}
