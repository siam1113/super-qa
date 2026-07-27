'use client';

import { useMemo } from 'react';
import { cn } from '@/lib/utils';
import { useAppStore, type ContextCounts } from '@/lib/store';
import type { Page } from '@/lib/types';
import {
  LayoutDashboard,
  TestTube,
  GitBranch,
  Code,
  Box,
  Database,
  Settings,
  Brain,
  ChevronRight,
  ChevronDown,
  Link,
  Layers,
  Briefcase,
  BookOpen,
  Target,
  Shield,
  Plug,
  Lock,
  ToggleLeft,
  BookText,
  Workflow,
  Cpu,
  Globe,
  FolderTree,
  CheckCircle,
  ClipboardList,
  Bug,
  Cog,
  MousePointer,
  KeyRound,
  Crosshair,
  Rocket,
  Users,
  Server,
  Bot,
  Search,
  Radar,
} from 'lucide-react';

type NavSection = {
  id: string;
  label: string;
  icon: React.ReactNode;
  page?: Page;
  children?: NavSection[];
  count?: number;
  status?: 'success' | 'warning' | 'error';
};

function buildNavigation(counts: ContextCounts): NavSection[] {
  return [
    {
      id: 'command-center',
      label: 'Command Center',
      icon: <Radar size={18} />,
      page: 'command-center',
    },
    {
      id: 'agents',
      label: 'Agents',
      icon: <Brain size={18} />,
      children: [
        { id: 'agent-qae', label: 'QAE', icon: <Search size={16} />, page: 'agent-qae' },
        { id: 'agent-aue', label: 'AUE', icon: <Bot size={16} />, page: 'agent-aue' },
      ],
    },
    {
      id: 'context',
      label: 'Context',
      icon: <Layers size={18} />,
      children: [
        { id: 'sources', label: 'Sources', icon: <Link size={16} />, page: 'sources', count: counts.sources, status: 'success' },
        {
          id: 'product',
          label: 'Product',
          icon: <Briefcase size={16} />,
          page: 'business',
          children: [
            { id: 'business-flows', label: 'Flows', icon: <Workflow size={14} />, page: 'business-flows', count: counts.flows },
            { id: 'business-facts', label: 'Facts', icon: <BookOpen size={14} />, page: 'business-facts', count: counts.facts },
            { id: 'business-entities', label: 'Entities', icon: <Box size={14} />, page: 'business-entities', count: counts.entities },
            { id: 'business-rules', label: 'Rules', icon: <Target size={14} />, page: 'business-rules', count: counts.rules },
            { id: 'business-states', label: 'States', icon: <GitBranch size={14} />, page: 'business-states', count: counts.states },
            { id: 'business-permissions', label: 'Permissions', icon: <Shield size={14} />, page: 'business-permissions', count: counts.permissions },
            { id: 'business-integrations', label: 'Integrations', icon: <Plug size={14} />, page: 'business-integrations', count: counts.integrations },
            { id: 'business-constraints', label: 'Constraints', icon: <Lock size={14} />, page: 'business-constraints', count: counts.constraints },
            { id: 'business-configurations', label: 'Configurations', icon: <ToggleLeft size={14} />, page: 'business-configurations', count: counts.configurations },
            { id: 'business-terminology', label: 'Terminology', icon: <BookText size={14} />, page: 'business-terminology', count: counts.terminology },
            { id: 'features', label: 'Features', icon: <Rocket size={14} />, page: 'features', count: counts.features },
            { id: 'personas', label: 'Personas', icon: <Users size={14} />, page: 'personas', count: counts.personas },
          ],
        },
        {
          id: 'technical',
          label: 'Technical',
          icon: <Cpu size={16} />,
          children: [
            { id: 'technical-apis', label: 'APIs', icon: <Globe size={14} />, page: 'technical-apis', count: counts.apis },
            { id: 'technical-code', label: 'Code', icon: <Code size={14} />, page: 'technical-code', count: counts.code },
            { id: 'technical-architecture', label: 'Architecture', icon: <FolderTree size={14} />, page: 'technical-architecture', count: counts.architecture },
            { id: 'technical-database', label: 'Database', icon: <Database size={14} />, page: 'technical-database', count: counts.database },
          ],
        },
        {
          id: 'quality',
          label: 'Quality',
          icon: <CheckCircle size={16} />,
          children: [
            { id: 'test-cases', label: 'Test Cases', icon: <TestTube size={14} />, page: 'test-cases', count: counts.testCases },
            { id: 'requirements', label: 'Requirements', icon: <ClipboardList size={14} />, page: 'requirements', count: counts.requirements },
            { id: 'defects', label: 'Defects', icon: <Bug size={14} />, page: 'defects', count: counts.defects, status: counts.defects > 0 ? 'warning' : undefined },
          ],
        },
        {
          id: 'automation',
          label: 'Automation',
          icon: <Cog size={16} />,
          children: [
            { id: 'dom', label: 'DOM', icon: <Box size={14} />, page: 'dom', count: counts.dom },
            { id: 'locators', label: 'Locators', icon: <Crosshair size={14} />, page: 'locators', count: counts.locators },
            { id: 'actions', label: 'Actions', icon: <MousePointer size={14} />, page: 'actions', count: counts.actions },
            { id: 'data-setup', label: 'Data Setup', icon: <Database size={14} />, page: 'data-setup', count: counts.dataSetup },
            { id: 'auth', label: 'Auth', icon: <KeyRound size={14} />, page: 'auth', count: counts.auth },
          ],
        },
      ],
    },
    {
      id: 'environments',
      label: 'Environments',
      icon: <Server size={18} />,
      page: 'environments',
    },
    {
      id: 'settings',
      label: 'Settings',
      icon: <Settings size={18} />,
      page: 'settings',
    },
  ];
}

function NavItem({ item, depth = 0 }: { item: NavSection; depth?: number }) {
  const { currentPage, setCurrentPage, expandedNodes, toggleNode } = useAppStore();
  const hasChildren = item.children && item.children.length > 0;
  const isExpanded = expandedNodes.has(item.id);
  const isActive = item.page === currentPage;

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
        onClick={handleClick}
        className={cn(
          'w-full flex items-center gap-2 px-3 py-2 text-sm rounded-lg transition-colors',
          'hover:bg-elevated',
          isActive && 'bg-accent-blue/10 text-accent-blue',
          !isActive && 'text-text-secondary hover:text-text-primary'
        )}
        style={{ paddingLeft: `${12 + depth * 16}px` }}
      >
        {hasChildren && (
          <span className="w-4 h-4 flex items-center justify-center">
            {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </span>
        )}
        {!hasChildren && <span className="w-4" />}
        <span className="flex-shrink-0">{item.icon}</span>
        <span className="flex-1 text-left truncate">{item.label}</span>
        {item.count !== undefined && (
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
        <div className="mt-1">
          {item.children!.map((child) => (
            <NavItem key={child.id} item={child} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  );
}

export function Sidebar() {
  const { sidebarCollapsed, toggleSidebar, contextCounts } = useAppStore();

  const navigation = useMemo(() => buildNavigation(contextCounts), [contextCounts]);

  return (
    <aside
      className={cn(
        'h-full bg-surface border-r border-border flex flex-col transition-all duration-200',
        sidebarCollapsed ? 'w-16' : 'w-[280px]'
      )}
    >
      {/* Logo */}
      <div className="h-14 flex items-center px-4 border-b border-border">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-accent-purple flex items-center justify-center">
            <Brain size={18} className="text-white" />
          </div>
          {!sidebarCollapsed && (
            <span className="font-semibold text-text-primary">QA Agent</span>
          )}
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto p-2 space-y-1">
        {navigation.map((item) => (
          <NavItem key={item.id} item={item} />
        ))}
      </nav>

      {/* Collapse button */}
      <button
        onClick={toggleSidebar}
        className="h-10 flex items-center justify-center border-t border-border text-text-secondary hover:text-text-primary transition-colors"
      >
        <ChevronRight
          size={18}
          className={cn('transition-transform', sidebarCollapsed ? '' : 'rotate-180')}
        />
      </button>
    </aside>
  );
}
