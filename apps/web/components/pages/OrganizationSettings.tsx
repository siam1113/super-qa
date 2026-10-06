'use client';

import { useEffect, useState } from 'react';
import { BookOpen, Workflow, Plug, Settings2 } from 'lucide-react';
import { useAppStore } from '@/lib/store';
import { BusinessPage } from './Business';
import { IntegrationsPage } from './Integrations';
import { PipelinesPage } from './Pipelines';
import { SettingsPage } from './Settings';

type OrganizationSettingsTab = 'project-settings' | 'integrations' | 'pipelines' | 'knowledge';

const tabs: Array<{ id: OrganizationSettingsTab; label: string; icon: typeof Plug }> = [
  { id: 'project-settings', label: 'App settings', icon: Settings2 },
  { id: 'integrations', label: 'Integrations', icon: Plug },
  { id: 'pipelines', label: 'Pipelines', icon: Workflow },
  { id: 'knowledge', label: 'Knowledge', icon: BookOpen },
];

export function OrganizationSettingsPage() {
  const [tab, setTab] = useState<OrganizationSettingsTab>('integrations');
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const pendingKnowledgeType = useAppStore((state) => state.pendingKnowledgeType);

  useEffect(() => {
    if (pendingKnowledgeType) setTab('knowledge');
  }, [pendingKnowledgeType]);

  useEffect(() => {
    let active = true;
    void fetch('/api/auth/session', { credentials: 'same-origin', cache: 'no-store' })
      .then(response => response.ok ? response.json() : null)
      .then(result => {
        if (active) setIsAdmin(result?.user?.accountType === 'organization' && result?.user?.role === 'owner');
      })
      .catch(() => { if (active) setIsAdmin(false); });
    return () => { active = false; };
  }, []);

  if (isAdmin === null) return <div className="flex h-full items-center justify-center text-sm text-text-secondary">Loading app settings…</div>;
  if (!isAdmin) return <div role="alert" className="p-8 text-sm text-text-secondary">App settings are available to app admins.</div>;

  return <div className="relative flex h-full min-h-0 flex-col overflow-hidden bg-canvas text-text-primary">
    <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 h-56 bg-[radial-gradient(ellipse_at_top_left,color-mix(in_srgb,var(--accent-blue)_10%,transparent),transparent_66%)]" />
    <header className="relative z-10 shrink-0 border-b border-border/80 bg-canvas/85 px-5 pt-6 backdrop-blur-xl md:px-8">
      <div className="mx-auto max-w-[1440px]">
        <div className="mb-5">
          <h1 className="text-xl font-semibold tracking-tight">Settings</h1>
          <p className="mt-1 max-w-2xl text-sm leading-5 text-text-secondary">Manage your app, integrations, and the systems that keep workspace knowledge current.</p>
        </div>
        <nav role="tablist" aria-label="Settings" className="flex gap-1 overflow-x-auto" aria-orientation="horizontal">
          {tabs.map(({ id, label, icon: Icon }) => <button
            key={id}
            type="button"
            id={`settings-tab-${id}`}
            role="tab"
            aria-selected={tab === id}
            aria-controls="settings-tabpanel"
            onClick={() => setTab(id)}
            className={`group relative inline-flex shrink-0 items-center gap-2 rounded-t-lg border-b-2 px-3.5 py-3 text-sm font-medium transition-[color,background-color,border-color] duration-200 ${tab === id ? 'border-accent-blue bg-accent-blue/[0.07] text-text-primary' : 'border-transparent text-text-secondary hover:bg-surface/70 hover:text-text-primary'}`}
          ><Icon size={15} className={tab === id ? 'text-accent-blue' : 'transition-colors group-hover:text-accent-blue'} />{label}</button>)}
        </nav>
      </div>
    </header>
    <section role="tabpanel" id="settings-tabpanel" aria-labelledby={`settings-tab-${tab}`} className="relative z-10 min-h-0 flex-1 overflow-hidden" key={tab}>
        {tab === 'project-settings' && <SettingsPage embedded />}
        {tab === 'integrations' && <IntegrationsPage embedded />}
        {tab === 'pipelines' && <PipelinesPage embedded onOpenIntegrations={() => setTab('integrations')} />}
        {tab === 'knowledge' && <BusinessPage embedded />}
    </section>
  </div>;
}
