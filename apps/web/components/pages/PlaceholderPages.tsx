'use client';

import { cn } from '@/lib/utils';
import { useAppStore } from '@/lib/store';
import type { Page } from '@/lib/types';
import {
  Code,
  Box,
  Database,
  Settings,
  Brain,
  Construction,
  Globe,
  FolderTree,
  ClipboardList,
  Bug,
  MousePointer,
  KeyRound,
  Crosshair,
  Rocket,
  Users,
} from 'lucide-react';

const pageConfig: Record<string, { title: string; description: string; icon: React.ReactNode }> = {
  // Technical
  'technical-apis': {
    title: 'APIs',
    description: 'API specifications, endpoints, and documentation',
    icon: <Globe size={48} />,
  },
  'technical-code': {
    title: 'Code',
    description: 'Source code repositories and code analysis',
    icon: <Code size={48} />,
  },
  'technical-architecture': {
    title: 'Architecture',
    description: 'System architecture diagrams and documentation',
    icon: <FolderTree size={48} />,
  },
  'technical-database': {
    title: 'Database',
    description: 'Database schemas, models, and data dictionary',
    icon: <Database size={48} />,
  },
  // Quality
  requirements: {
    title: 'Requirements',
    description: 'Requirements documents and traceability matrix',
    icon: <ClipboardList size={48} />,
  },
  defects: {
    title: 'Defects',
    description: 'Bug tracking, defect analysis, and resolution',
    icon: <Bug size={48} />,
  },
  // Automation
  actions: {
    title: 'Actions',
    description: 'Reusable automation actions and step definitions',
    icon: <MousePointer size={48} />,
  },
  dom: {
    title: 'DOM',
    description: 'Page objects, DOM trees, and element snapshots',
    icon: <Box size={48} />,
  },
  locators: {
    title: 'Locators',
    description: 'Element locators, selectors, and stability analysis',
    icon: <Crosshair size={48} />,
  },
  'data-setup': {
    title: 'Data Setup',
    description: 'Test data builders, factories, and fixtures',
    icon: <Database size={48} />,
  },
  auth: {
    title: 'Auth',
    description: 'Authentication helpers, tokens, and test users',
    icon: <KeyRound size={48} />,
  },
  // Product
  features: {
    title: 'Features',
    description: 'Product features, capabilities, and specifications',
    icon: <Rocket size={48} />,
  },
  personas: {
    title: 'Personas',
    description: 'User personas, roles, and user journeys',
    icon: <Users size={48} />,
  },
  // Settings
  settings: {
    title: 'Settings',
    description: 'Workspace settings, integrations, and API configuration',
    icon: <Settings size={48} />,
  },
  context: {
    title: 'Context Manager',
    description: 'Knowledge graph, sources, and AI clarifications',
    icon: <Brain size={48} />,
  },
};

export function PlaceholderPage({ page }: { page: Page }) {
  const config = pageConfig[page] || {
    title: page,
    description: 'This page is coming soon',
    icon: <Construction size={48} />,
  };

  return (
    <div className="h-full flex flex-col items-center justify-center p-6">
      <div className="text-center max-w-md">
        <div className="w-24 h-24 rounded-2xl bg-elevated flex items-center justify-center mx-auto mb-6 text-text-secondary">
          {config.icon}
        </div>
        <h1 className="text-2xl font-semibold mb-2">{config.title}</h1>
        <p className="text-text-secondary mb-6">{config.description}</p>
        <div className="flex items-center justify-center gap-2 text-sm text-warning bg-warning/10 px-4 py-2 rounded-lg">
          <Construction size={16} />
          <span>Coming soon in the next iteration</span>
        </div>
      </div>
    </div>
  );
}

