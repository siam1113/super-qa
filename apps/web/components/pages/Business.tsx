'use client';

import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';
import { useAppStore } from '@/lib/store';
import type { BusinessItem, BusinessItemType, BusinessStats, Page } from '@/lib/types';
import type { ContextCounts } from '@/lib/store';
import {
  Workflow,
  BookOpen,
  Box,
  Target,
  GitBranch,
  Shield,
  Plug,
  Lock,
  ToggleLeft,
  BookText,
  Search,
  RefreshCw,
  ChevronRight,
  ExternalLink,
  Globe,
  Code,
  FolderTree,
  Database,
  TestTube,
  ClipboardList,
  Bug,
  Layout,
  Crosshair,
  MousePointer,
  KeyRound,
  Sparkles,
  Users,
} from 'lucide-react';
import { BusinessItemModal } from '../business/BusinessItemModal';

const API_URL = `${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000'}/api`;

const typeConfig: Record<
  BusinessItemType,
  { label: string; icon: React.ReactNode; color: string; description: string }
> = {
  flow: {
    label: 'Flows',
    icon: <Workflow size={18} />,
    color: 'text-accent-blue',
    description: 'Business process flows and user journeys',
  },
  fact: {
    label: 'Facts',
    icon: <BookOpen size={18} />,
    color: 'text-success',
    description: 'Business facts and data points',
  },
  entity: {
    label: 'Entities',
    icon: <Box size={18} />,
    color: 'text-accent-purple',
    description: 'Domain entities and data models',
  },
  rule: {
    label: 'Rules',
    icon: <Target size={18} />,
    color: 'text-warning',
    description: 'Business rules and validations',
  },
  state: {
    label: 'States',
    icon: <GitBranch size={18} />,
    color: 'text-accent-blue',
    description: 'State machines and transitions',
  },
  permission: {
    label: 'Permissions',
    icon: <Shield size={18} />,
    color: 'text-danger',
    description: 'Access control and permissions',
  },
  integration: {
    label: 'Integrations',
    icon: <Plug size={18} />,
    color: 'text-accent-purple',
    description: 'External system integrations',
  },
  constraint: {
    label: 'Constraints',
    icon: <Lock size={18} />,
    color: 'text-warning',
    description: 'Business constraints and limits',
  },
  configuration: {
    label: 'Configurations',
    icon: <ToggleLeft size={18} />,
    color: 'text-text-secondary',
    description: 'Configuration settings and feature flags',
  },
  terminology: {
    label: 'Terminology',
    icon: <BookText size={18} />,
    color: 'text-success',
    description: 'Domain terminology and definitions',
  },
  // Technical
  api: {
    label: 'APIs',
    icon: <Globe size={18} />,
    color: 'text-accent-blue',
    description: 'API endpoints and specifications',
  },
  code: {
    label: 'Code',
    icon: <Code size={18} />,
    color: 'text-accent-purple',
    description: 'Code elements and functions',
  },
  architecture: {
    label: 'Architecture',
    icon: <FolderTree size={18} />,
    color: 'text-warning',
    description: 'System architecture components',
  },
  database: {
    label: 'Database',
    icon: <Database size={18} />,
    color: 'text-info',
    description: 'Database tables and schemas',
  },
  // Quality
  test_case: {
    label: 'Test Cases',
    icon: <TestTube size={18} />,
    color: 'text-success',
    description: 'Test cases and scenarios',
  },
  requirement: {
    label: 'Requirements',
    icon: <ClipboardList size={18} />,
    color: 'text-accent-blue',
    description: 'Requirements and user stories',
  },
  defect: {
    label: 'Defects',
    icon: <Bug size={18} />,
    color: 'text-danger',
    description: 'Track reported issues, understand their impact, and follow them through resolution.',
  },
  // Automation
  dom: {
    label: 'POM',
    icon: <Layout size={18} />,
    color: 'text-accent-purple',
    description: 'Page objects and DOM elements',
  },
  locator: {
    label: 'Locators',
    icon: <Crosshair size={18} />,
    color: 'text-warning',
    description: 'Element locators and selectors',
  },
  action: {
    label: 'Actions',
    icon: <MousePointer size={18} />,
    color: 'text-accent-blue',
    description: 'Automation actions and steps',
  },
  data_setup: {
    label: 'Data',
    icon: <Database size={18} />,
    color: 'text-info',
    description: 'Reusable test data sets, setup steps, and fixtures',
  },
  auth: {
    label: 'Auth',
    icon: <KeyRound size={18} />,
    color: 'text-danger',
    description: 'Authentication configurations',
  },
};

function BusinessItemCard({ item, onClick }: { item: BusinessItem; onClick?: () => void }) {
  const config = typeConfig[item.type];
  const confidenceColors = {
    high: 'bg-success/10 text-success',
    medium: 'bg-warning/10 text-warning',
    low: 'bg-danger/10 text-danger',
    inferred: 'bg-accent-purple/10 text-accent-purple',
  };

  const verificationColors = {
    verified: 'border-success/30',
    unverified: 'border-border',
    rejected: 'border-danger/30',
  };

  const verificationBadgeColors = {
    verified: 'bg-success/10 text-success',
    unverified: 'bg-text-secondary/10 text-text-secondary',
    rejected: 'bg-danger/10 text-danger',
  };

  return (
    <div
      onClick={onClick}
      className={cn(
        'bg-surface border rounded-xl p-4 hover:border-accent-blue transition-colors cursor-pointer',
        verificationColors[item.verificationStatus || 'unverified']
      )}
    >
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <span className={cn('flex-shrink-0', config.color)}>{config.icon}</span>
          <div className="min-w-0 flex-1">
            <h3 className="font-medium line-clamp-1">{item.name}</h3>
            <p className="text-xs text-text-secondary">{config.label}</p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0 ml-2">
          <span className={cn('px-2 py-0.5 text-xs rounded-full capitalize', confidenceColors[item.confidence])}>
            {item.confidence}
          </span>
          <span className={cn('px-2 py-0.5 text-xs rounded-full capitalize', verificationBadgeColors[item.verificationStatus || 'unverified'])}>
            {item.verificationStatus || 'unverified'}
          </span>
        </div>
      </div>
      {item.description && (
        <p className="text-sm text-text-secondary mb-3 line-clamp-2">{item.description}</p>
      )}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {item.tags.slice(0, 3).map((tag) => (
            <span key={tag} className="px-2 py-0.5 text-xs rounded-full bg-elevated text-text-secondary">
              {tag}
            </span>
          ))}
          {item.tags.length > 3 && (
            <span className="text-xs text-text-secondary">+{item.tags.length - 3}</span>
          )}
        </div>
        <ChevronRight size={16} className="text-text-secondary" />
      </div>
    </div>
  );
}

const knowledgeGroups: Array<{
  id: string;
  label: string;
  eyebrow: string;
  description: string;
  icon: React.ReactNode;
  tone: string;
  categories: Array<{
    type: BusinessItemType;
    page: Page;
    label?: string;
    description?: string;
    icon?: React.ReactNode;
    countKey?: keyof ContextCounts;
  }>;
}> = [
  {
    id: 'product', label: 'Product', eyebrow: 'Business context', description: 'The concepts, rules, and journeys that define how your product works.',
    icon: <Box size={17} />, tone: 'text-accent-blue bg-accent-blue/10',
    categories: [
      { type: 'flow', page: 'business-flows' }, { type: 'fact', page: 'business-facts' }, { type: 'entity', page: 'business-entities' },
      { type: 'rule', page: 'business-rules' }, { type: 'state', page: 'business-states' }, { type: 'permission', page: 'business-permissions' },
      { type: 'integration', page: 'business-integrations' }, { type: 'constraint', page: 'business-constraints' },
      { type: 'configuration', page: 'business-configurations' }, { type: 'terminology', page: 'business-terminology' },
      { type: 'flow', page: 'features', label: 'Features', description: 'Product capabilities and feature context', icon: <Sparkles size={18} />, countKey: 'features' },
      { type: 'entity', page: 'personas', label: 'Personas', description: 'User types and audience profiles', icon: <Users size={18} />, countKey: 'personas' },
    ],
  },
  {
    id: 'technical', label: 'Technical', eyebrow: 'System knowledge', description: 'A practical map of your interfaces, code, and data architecture.',
    icon: <Code size={17} />, tone: 'text-accent-purple bg-accent-purple/10',
    categories: [
      { type: 'api', page: 'technical-apis' }, { type: 'code', page: 'technical-code' },
      { type: 'architecture', page: 'technical-architecture' }, { type: 'database', page: 'technical-database' },
    ],
  },
  {
    id: 'quality', label: 'Quality', eyebrow: 'What good looks like', description: 'Requirements, coverage, and known issues grounded in your sources.',
    icon: <TestTube size={17} />, tone: 'text-success bg-success/10',
    categories: [
      { type: 'test_case', page: 'test-cases' }, { type: 'requirement', page: 'requirements' }, { type: 'defect', page: 'defects' },
    ],
  },
  {
    id: 'automation', label: 'Automation', eyebrow: 'Execution context', description: 'Reusable interface, action, and test data knowledge for agents.',
    icon: <MousePointer size={17} />, tone: 'text-warning bg-warning/10',
    categories: [
      { type: 'dom', page: 'dom' }, { type: 'locator', page: 'locators' }, { type: 'action', page: 'actions' },
      { type: 'data_setup', page: 'test-data' }, { type: 'auth', page: 'auth' },
    ],
  },
];

// Main Business Overview Page
const frameworkTabByType: Partial<Record<BusinessItemType, string>> = {
  dom: 'pom',
  data_setup: 'data',
  locator: 'locators',
  action: 'actions',
  auth: 'auth',
};

export function BusinessPage({ embedded = false }: { embedded?: boolean }) {
  const [stats, setStats] = useState<BusinessStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeGroupId, setActiveGroupId] = useState(knowledgeGroups[0].id);
  const [activeType, setActiveType] = useState<BusinessItemType | null>(null);
  const setCurrentPage = useAppStore((state) => state.setCurrentPage);
  const contextCounts = useAppStore((state) => state.contextCounts);
  const pendingKnowledgeType = useAppStore((state) => state.pendingKnowledgeType);
  const setPendingKnowledgeType = useAppStore((state) => state.setPendingKnowledgeType);
  const setPendingFrameworkTab = useAppStore((state) => state.setPendingFrameworkTab);

  useEffect(() => {
    fetchStats();
  }, []);

  useEffect(() => {
    if (!pendingKnowledgeType) return;
    const group = knowledgeGroups.find(group => group.categories.some(category => category.type === pendingKnowledgeType));
    if (group) { setActiveGroupId(group.id); setActiveType(pendingKnowledgeType); }
    setPendingKnowledgeType(null);
  }, [pendingKnowledgeType, setPendingKnowledgeType]);

  function openCategory(type: BusinessItemType, page: Page) {
    const frameworkTab = frameworkTabByType[type];
    if (frameworkTab) { setCurrentPage('frameworks'); setPendingFrameworkTab(frameworkTab); return; }
    if (page === 'test-cases') { setCurrentPage('test-cases'); return; }
    setActiveType(type);
  }

  const fetchStats = async () => {
    try {
      const res = await fetch(`${API_URL}/business/stats`);
      if (res.ok) {
        const data = await res.json();
        setStats(data);
      }
    } catch (error) {
      console.error('Failed to fetch business stats:', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <RefreshCw size={24} className="animate-spin text-text-secondary" />
          <p className="text-text-secondary">Loading business knowledge...</p>
        </div>
      </div>
    );
  }

  const total = stats?.total || 0;
  const activeGroup = knowledgeGroups.find(group => group.id === activeGroupId) || knowledgeGroups[0];
  const activeGroupTotal = activeGroup.categories.reduce((sum, category) => sum + (category.countKey ? contextCounts[category.countKey] : stats?.byType?.[category.type] || 0), 0);

  return (
    <div className="h-full overflow-hidden bg-canvas">
      <div className="mx-auto flex h-full max-w-[1440px]">
        <nav aria-label="Knowledge sections" className="flex w-36 shrink-0 flex-col gap-1 border-r border-border/70 px-3 py-5 md:w-44 md:px-4 md:py-6">
          {knowledgeGroups.map(group => <button key={group.id} type="button" onClick={() => { setActiveGroupId(group.id); setActiveType(null); }} aria-current={activeGroupId === group.id ? 'page' : undefined} className={cn('flex min-h-10 w-full items-center gap-2 rounded-lg px-3 text-left text-sm font-medium transition-colors', activeGroupId === group.id ? 'bg-accent-blue/10 text-accent-blue' : 'text-text-secondary hover:bg-elevated hover:text-text-primary')}><span className="shrink-0">{group.icon}</span>{group.label}</button>)}
        </nav>
        <main className="min-w-0 flex-1 overflow-y-auto py-7 pl-3 pr-5 md:py-8 md:pl-4 md:pr-8">
         <div className="max-w-7xl">
        {!embedded && <header className="relative overflow-hidden rounded-2xl border border-border bg-surface p-6 shadow-sm md:p-8">
          <div aria-hidden="true" className="pointer-events-none absolute -right-12 -top-24 h-64 w-64 rounded-full bg-accent-blue/10 blur-3xl" />
          <div aria-hidden="true" className="pointer-events-none absolute right-36 top-16 h-36 w-36 rounded-full bg-accent-purple/10 blur-3xl" />
          <div className="relative flex flex-col justify-between gap-6 md:flex-row md:items-end">
            <div className="max-w-2xl">
              <h1 className="text-xl font-semibold tracking-tight text-text-primary">Knowledge</h1>
              <p className="mt-1 max-w-xl text-sm leading-5 text-text-secondary">
                One clear map of your product, systems, quality, and automation context—ready for your team and agents.
              </p>
            </div>
            <div className="relative flex items-center gap-4 rounded-xl border border-border bg-canvas/70 px-4 py-3 backdrop-blur-sm">
              <div>
                <p className="text-xl font-semibold leading-none tracking-tight text-text-primary">{total.toLocaleString()}</p>
                <p className="mt-1.5 text-xs text-text-secondary">items in your library</p>
              </div>
            </div>
          </div>
        </header>}

        <section className={embedded ? '' : 'mt-8'} aria-labelledby="knowledge-categories-heading">
          <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-text-secondary">{activeGroup.eyebrow}</p>
              <h2 id="knowledge-categories-heading" className="mt-1 text-lg font-semibold tracking-tight">{activeGroup.label} knowledge</h2>
            </div>
            <p className="text-xs text-text-secondary">{activeGroup.categories.length} categories · {activeGroupTotal.toLocaleString()} items</p>
          </div>

          <div className="grid gap-4">
                <section aria-labelledby={`knowledge-${activeGroup.id}`} className="group overflow-hidden rounded-2xl border border-border bg-surface transition-colors duration-200 hover:border-accent-blue/40">
                  <div className="flex items-start justify-between gap-4 border-b border-border/70 p-5 md:p-6">
                    <div className="flex items-start gap-3.5">
                      <span className={cn('flex h-10 w-10 flex-none items-center justify-center rounded-xl', activeGroup.tone)}>{activeGroup.icon}</span>
                      <div>
                        <p className="text-[10px] font-semibold uppercase tracking-[0.15em] text-text-secondary">{activeGroup.eyebrow}</p>
                        <h3 id={`knowledge-${activeGroup.id}`} className="mt-1 text-base font-semibold tracking-tight">{activeGroup.label}</h3>
                        <p className="mt-1 max-w-md text-xs leading-5 text-text-secondary">{activeGroup.description}</p>
                      </div>
                    </div>
                    <div className="min-w-[3.5rem] text-right">
                      <p className="text-xl font-semibold tabular-nums tracking-tight">{activeGroupTotal.toLocaleString()}</p>
                      <p className="text-[10px] text-text-secondary">items</p>
                    </div>
                  </div>
                  <div className="grid grid-cols-1 gap-2 p-3 sm:grid-cols-2 md:p-4">
                    {activeGroup.categories.map(({ type, page, label: categoryLabel, description: categoryDescription, icon: categoryIcon, countKey }) => {
                      const config = typeConfig[type];
                      const count = countKey ? contextCounts[countKey] : stats?.byType?.[type] || 0;
                      const selected = activeType === type;
                      return (
                        <button
                          key={page}
                          type="button"
                          aria-pressed={selected}
                          onClick={() => openCategory(type, page)}
                          className={cn(
                            'flex min-h-12 items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors duration-150 hover:bg-elevated focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-blue',
                            selected && 'bg-accent-blue/10 ring-1 ring-inset ring-accent-blue/30'
                          )}
                        >
                          <span className={cn('flex h-8 w-8 flex-none items-center justify-center rounded-lg bg-elevated [&>svg]:h-4 [&>svg]:w-4', config.color)}>{categoryIcon || config.icon}</span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-medium">{categoryLabel || config.label}</span>
                            <span className="block truncate text-[11px] text-text-secondary">{categoryDescription || config.description}</span>
                          </span>
                          <span className="rounded-md bg-elevated px-2 py-1 text-xs tabular-nums text-text-secondary">{count}</span>
                          <ChevronRight size={14} className="flex-none text-text-secondary transition-transform duration-150 group-hover:translate-x-0.5" />
                        </button>
                      );
                    })}
                  </div>
                </section>
          </div>
          {activeType && <div className="mt-4 overflow-hidden rounded-2xl border border-border bg-surface"><BusinessTypePage type={activeType} embedded /></div>}
        </section>

        <div className="mt-6 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-dashed border-border px-4 py-3 text-xs text-text-secondary">
          <span>Knowledge is extracted from your connected sources during sync.</span>
          <span>Counts update as new sources are processed.</span>
        </div>
         </div>
        </main>
      </div>
    </div>
  );
}

// Generic Business Type Page
export function BusinessTypePage({ type, embedded = false }: { type: BusinessItemType; embedded?: boolean }) {
  const [items, setItems] = useState<BusinessItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [total, setTotal] = useState(0);
  const [selectedItem, setSelectedItem] = useState<BusinessItem | null>(null);

  const config = typeConfig[type];

  useEffect(() => {
    fetchItems();
  }, [type]);

  const fetchItems = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/business/items?type=${type}&limit=100`);
      if (res.ok) {
        const data = await res.json();
        setItems(data.items);
        setTotal(data.total);
      }
    } catch (error) {
      console.error('Failed to fetch business items:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleItemClick = async (itemId: string) => {
    try {
      // Fetch full item details with relationships
      const res = await fetch(`${API_URL}/business/items/${itemId}`);
      if (res.ok) {
        const item = await res.json();
        setSelectedItem(item);
      }
    } catch (error) {
      console.error('Failed to fetch item details:', error);
    }
  };

  const handleModalClose = () => {
    setSelectedItem(null);
  };

  const handleItemUpdate = () => {
    fetchItems();
  };

  const filteredItems = items.filter(
    (item) =>
      item.name.toLowerCase().includes(search.toLowerCase()) ||
      item.description?.toLowerCase().includes(search.toLowerCase())
  );

  if (loading) {
    return (
      <div className={cn('flex items-center justify-center', embedded ? 'py-16' : 'h-full')}>
        <div className="flex flex-col items-center gap-3">
          <RefreshCw size={24} className="animate-spin text-text-secondary" />
          <p className="text-text-secondary">Loading {config.label.toLowerCase()}...</p>
        </div>
      </div>
    );
  }

  return (
    <div className={embedded ? 'flex flex-col' : 'h-full flex flex-col'}>
      <header className={embedded ? 'px-4 pt-4 md:px-5' : 'px-6 py-6 md:px-8 md:py-7'}>
        <div className="flex items-center gap-2">
          <h1 className="text-xl font-semibold">{config.label}</h1>
          <span className="px-2 py-0.5 text-sm rounded-full bg-elevated text-text-secondary">
            {total}
          </span>
        </div>
        <p className="mt-1 text-sm leading-5 text-text-secondary">{config.description}</p>
      </header>

      <div className={embedded ? 'p-4 md:px-5' : 'p-4 border-b border-border'}>
        <div className="relative">
          <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-secondary" />
          <input
            type="text"
            placeholder={`Search ${config.label.toLowerCase()}...`}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-2 bg-elevated border border-border rounded-lg text-sm focus:outline-none focus:border-accent-blue"
          />
        </div>
      </div>

      <div className={embedded ? 'px-4 pb-5 md:px-5' : 'flex-1 overflow-auto p-6'}>
        {filteredItems.length === 0 ? (
          <div className="text-center py-12">
            <div className="w-16 h-16 rounded-2xl bg-elevated flex items-center justify-center mx-auto mb-4">
              {config.icon}
            </div>
            <h3 className="font-medium mb-2">No {config.label.toLowerCase()} found</h3>
            <p className="text-sm text-text-secondary">
              {search
                ? 'Try adjusting your search'
                : 'Business knowledge will be extracted when you sync your sources'}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-4">
            {filteredItems.map((item) => (
              <BusinessItemCard
                key={item.id}
                item={item}
                onClick={() => handleItemClick(item.id)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Modal */}
      <BusinessItemModal
        item={selectedItem}
        onClose={handleModalClose}
        onUpdate={handleItemUpdate}
      />
    </div>
  );
}

// Defects keeps a standalone page export: it's also reachable from the main sidebar (Review > Defects).
export function QualityDefectsPage() {
  return <BusinessTypePage type="defect" />;
}

// Automation pages are rendered as tabs inside the Framework page (components/pages/Framework.tsx).
export function AutomationDomPage() {
  return <BusinessTypePage type="dom" />;
}

export function AutomationLocatorsPage() {
  return <BusinessTypePage type="locator" />;
}

export function AutomationActionsPage() {
  return <BusinessTypePage type="action" />;
}

export function AutomationDataSetupPage() {
  return <BusinessTypePage type="data_setup" />;
}

export function AutomationAuthPage() {
  return <BusinessTypePage type="auth" />;
}
