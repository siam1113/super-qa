'use client';

import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';
import type { BusinessItem, BusinessItemType, BusinessStats } from '@/lib/types';
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
  Rocket,
  Users,
} from 'lucide-react';

const API_URL = 'http://localhost:4000/api';

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
    description: 'Bugs and defects',
  },
  // Automation
  dom: {
    label: 'DOM',
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
    label: 'Data Setup',
    icon: <Database size={18} />,
    color: 'text-info',
    description: 'Test data setup and fixtures',
  },
  auth: {
    label: 'Auth',
    icon: <KeyRound size={18} />,
    color: 'text-danger',
    description: 'Authentication configurations',
  },
};

function BusinessItemCard({ item }: { item: BusinessItem }) {
  const config = typeConfig[item.type];
  const confidenceColors = {
    high: 'bg-success/10 text-success',
    medium: 'bg-warning/10 text-warning',
    low: 'bg-danger/10 text-danger',
    inferred: 'bg-accent-purple/10 text-accent-purple',
  };

  return (
    <div className="bg-surface border border-border rounded-xl p-4 hover:border-accent-blue transition-colors cursor-pointer">
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className={cn('flex-shrink-0', config.color)}>{config.icon}</span>
          <div>
            <h3 className="font-medium line-clamp-1">{item.name}</h3>
            <p className="text-xs text-text-secondary">{config.label}</p>
          </div>
        </div>
        <span className={cn('px-2 py-0.5 text-xs rounded-full capitalize', confidenceColors[item.confidence])}>
          {item.confidence}
        </span>
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

function StatsCard({ type, count }: { type: BusinessItemType; count: number }) {
  const config = typeConfig[type];
  return (
    <div className="bg-surface border border-border rounded-xl p-4 hover:border-accent-blue transition-colors cursor-pointer">
      <div className="flex items-center gap-3">
        <div className={cn('w-10 h-10 rounded-lg flex items-center justify-center bg-elevated', config.color)}>
          {config.icon}
        </div>
        <div>
          <p className="text-2xl font-semibold">{count}</p>
          <p className="text-sm text-text-secondary">{config.label}</p>
        </div>
      </div>
    </div>
  );
}

// Main Business Overview Page
export function BusinessPage() {
  const [stats, setStats] = useState<BusinessStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchStats();
  }, []);

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

  return (
    <div className="h-full flex flex-col">
      <div className="p-6 border-b border-border">
        <h1 className="text-2xl font-semibold">Business Knowledge</h1>
        <p className="text-text-secondary">
          Extracted business knowledge from your connected sources
        </p>
      </div>
      <div className="flex-1 overflow-auto p-6">
        <div className="grid grid-cols-4 gap-4 mb-8">
          {Object.entries(typeConfig).map(([type, _config]) => (
            <StatsCard
              key={type}
              type={type as BusinessItemType}
              count={stats?.byType?.[type as BusinessItemType] || 0}
            />
          ))}
        </div>
        <div className="text-center text-text-secondary">
          <p>Total: {stats?.total || 0} business items extracted</p>
          <p className="text-sm mt-2">
            Select a category from the sidebar to view details
          </p>
        </div>
      </div>
    </div>
  );
}

// Generic Business Type Page
export function BusinessTypePage({ type }: { type: BusinessItemType }) {
  const [items, setItems] = useState<BusinessItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [total, setTotal] = useState(0);

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

  const filteredItems = items.filter(
    (item) =>
      item.name.toLowerCase().includes(search.toLowerCase()) ||
      item.description?.toLowerCase().includes(search.toLowerCase())
  );

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <RefreshCw size={24} className="animate-spin text-text-secondary" />
          <p className="text-text-secondary">Loading {config.label.toLowerCase()}...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      <div className="p-6 border-b border-border">
        <div className="flex items-center gap-3 mb-2">
          <span className={config.color}>{config.icon}</span>
          <h1 className="text-2xl font-semibold">{config.label}</h1>
          <span className="px-2 py-0.5 text-sm rounded-full bg-elevated text-text-secondary">
            {total}
          </span>
        </div>
        <p className="text-text-secondary">{config.description}</p>
      </div>

      <div className="p-4 border-b border-border">
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

      <div className="flex-1 overflow-auto p-6">
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
              <BusinessItemCard key={item.id} item={item} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// Individual page exports for each business type
export function BusinessFlowsPage() {
  return <BusinessTypePage type="flow" />;
}

export function BusinessFactsPage() {
  return <BusinessTypePage type="fact" />;
}

export function BusinessEntitiesPage() {
  return <BusinessTypePage type="entity" />;
}

export function BusinessRulesPage() {
  return <BusinessTypePage type="rule" />;
}

export function BusinessStatesPage() {
  return <BusinessTypePage type="state" />;
}

export function BusinessPermissionsPage() {
  return <BusinessTypePage type="permission" />;
}

export function BusinessIntegrationsPage() {
  return <BusinessTypePage type="integration" />;
}

export function BusinessConstraintsPage() {
  return <BusinessTypePage type="constraint" />;
}

export function BusinessConfigurationsPage() {
  return <BusinessTypePage type="configuration" />;
}

export function BusinessTerminologyPage() {
  return <BusinessTypePage type="terminology" />;
}

// Technical pages
export function TechnicalApisPage() {
  return <BusinessTypePage type="api" />;
}

export function TechnicalCodePage() {
  return <BusinessTypePage type="code" />;
}

export function TechnicalArchitecturePage() {
  return <BusinessTypePage type="architecture" />;
}

export function TechnicalDatabasePage() {
  return <BusinessTypePage type="database" />;
}

// Quality pages
export function QualityTestCasesPage() {
  return <BusinessTypePage type="test_case" />;
}

export function QualityRequirementsPage() {
  return <BusinessTypePage type="requirement" />;
}

export function QualityDefectsPage() {
  return <BusinessTypePage type="defect" />;
}

// Automation pages
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

// Product pages (features and personas)
export function ProductFeaturesPage() {
  return <BusinessTypePage type="flow" />;
}

export function ProductPersonasPage() {
  return <BusinessTypePage type="entity" />;
}
