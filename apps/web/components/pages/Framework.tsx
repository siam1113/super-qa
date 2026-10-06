'use client';

import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';
import { useAppStore } from '@/lib/store';
import {
  AutomationActionsPage,
  AutomationAuthPage,
  AutomationDataSetupPage,
  AutomationDomPage,
  AutomationLocatorsPage,
} from './Business';
import { PlaceholderPage } from './PlaceholderPages';

const tabs = [
  { id: 'pom', label: 'POM', content: <AutomationDomPage /> },
  { id: 'data', label: 'Data', content: <AutomationDataSetupPage /> },
  { id: 'setup', label: 'Setup', content: <PlaceholderPage page="frameworks" /> },
  { id: 'locators', label: 'Locators', content: <AutomationLocatorsPage /> },
  { id: 'actions', label: 'Actions', content: <AutomationActionsPage /> },
  { id: 'auth', label: 'Auth', content: <AutomationAuthPage /> },
] as const;

export function FrameworkPage() {
  const [activeTab, setActiveTab] = useState<(typeof tabs)[number]['id']>('pom');
  const pendingFrameworkTab = useAppStore((state) => state.pendingFrameworkTab);
  const setPendingFrameworkTab = useAppStore((state) => state.setPendingFrameworkTab);

  useEffect(() => {
    if (!pendingFrameworkTab) return;
    if (tabs.some(tab => tab.id === pendingFrameworkTab)) setActiveTab(pendingFrameworkTab as (typeof tabs)[number]['id']);
    setPendingFrameworkTab(null);
  }, [pendingFrameworkTab, setPendingFrameworkTab]);

  const selectedTab = tabs.find(tab => tab.id === activeTab) || tabs[0];

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="shrink-0 border-b border-border bg-surface px-5 pt-5 md:px-6">
        <h1 className="text-xl font-semibold tracking-tight">Framework</h1>
        <p className="mt-1 text-sm leading-5 text-text-secondary">Set up shared page objects, test data, locators, actions, and authentication helpers.</p>
        <div role="tablist" aria-label="Framework sections" className="mt-4 flex gap-1 overflow-x-auto">
          {tabs.map(tab => (
            <button
              key={tab.id}
              id={`framework-tab-${tab.id}`}
              type="button"
              role="tab"
              aria-selected={activeTab === tab.id}
              aria-controls="framework-tab-panel"
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                'shrink-0 border-b-2 px-3 py-2.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-blue',
                activeTab === tab.id
                  ? 'border-accent-blue text-accent-blue'
                  : 'border-transparent text-text-secondary hover:text-text-primary'
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>
      <div
        id="framework-tab-panel"
        role="tabpanel"
        aria-labelledby={`framework-tab-${selectedTab.id}`}
        className="min-h-0 flex-1 overflow-hidden"
      >
        {selectedTab.content}
      </div>
    </div>
  );
}
