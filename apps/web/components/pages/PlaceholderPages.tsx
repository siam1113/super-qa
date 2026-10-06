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
  'execution-plans': {
    title: 'Execution Plans',
    description: 'Build reusable plans that select test cases, data, and target environments.',
    icon: <ClipboardList size={48} />,
  },
  frameworks: {
    title: 'Setup',
    description: 'Configure framework conventions, shared helpers, and automation defaults for this app.',
    icon: <Code size={48} />,
  },
  'automated-tests': {
    title: 'Automated Tests',
    description: 'Browse runnable automated checks linked to app test cases and plans.',
    icon: <Construction size={48} />,
  },
  'test-credentials': {
    title: 'Test Credentials',
    description: 'Configure secure credential references for this app’s test environments.',
    icon: <KeyRound size={48} />,
  },
  reports: {
    title: 'Reports',
    description: 'Review execution outcomes and quality trends for this app.',
    icon: <Construction size={48} />,
  },
  coverage: {
    title: 'Coverage',
    description: 'Review coverage between app requirements, test cases, and executions.',
    icon: <Construction size={48} />,
  },
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
    title: 'POM',
    description: 'Page objects, DOM trees, and element snapshots',
    icon: <Box size={48} />,
  },
  locators: {
    title: 'Locators',
    description: 'Element locators, selectors, and stability analysis',
    icon: <Crosshair size={48} />,
  },
  'data-setup': {
    title: 'Setup',
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
    title: 'Knowledge',
    description: 'Workspace sources and structured product knowledge',
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
        <h1 className="text-xl font-semibold mb-2">{config.title}</h1>
        <p className="text-text-secondary mb-6">{config.description}</p>
        <div className="flex items-center justify-center gap-2 text-sm text-warning bg-warning/10 px-4 py-2 rounded-lg">
          <Construction size={16} />
          <span>Coming soon in the next iteration</span>
        </div>
      </div>
    </div>
  );
}
