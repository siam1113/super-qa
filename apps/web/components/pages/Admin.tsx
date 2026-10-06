'use client';

import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { Activity, ArrowLeft, ChevronRight, KeyRound, LifeBuoy, LoaderCircle, Moon, Plus, RefreshCw, Server, ShieldCheck, Sun, UserRoundCog, Users, Workflow } from 'lucide-react';

type Member = { id: string; email: string; role: string; active: boolean; createdAt: string };
type AppInvitation = { id: string; email: string; role: string; createdAt: string; expiresAt: string };
type Agent = { id: string; name: string; kind: string | null; enabled: boolean };
type OrganizationService = { id: string; name: string; provider: string; accessMode: string; enabled: boolean };
type SupportConnector = { enabled: boolean; provider: string; baseUrl: string; workspace: string; queue: string };
type OrganizationSupportSettings = { ticketing: SupportConnector; liveChat: SupportConnector };
type App = {
  id: string; name: string; environment: string; paused: boolean; dailyRunLimit: number; createdAt: string;
  members: Member[]; memberCount: number; invitations: AppInvitation[]; agents: Agent[]; services: OrganizationService[]; supportSettings: OrganizationSupportSettings;
  runStats: { total: number; today: number; passed: number; active: number };
};
type Organization = { id: string; name: string; createdAt: string; appCount: number; memberCount: number; apps: App[] };
type Service = { id: string; name: string; status: 'healthy' | 'unhealthy'; detail: string; checkedAt: string };
type StatusPayload = { checkedAt: string; services: Service[]; timeline: Array<{ id: string; service: string; status: string; message: string; startedAt: string; resolvedAt: string | null }> };
type AdminTab = 'organizations' | 'services';
type OrganizationTab = 'overview' | 'projects' | 'users' | 'services' | 'support' | 'settings';
type AdminResult = { project?: { name: string }; credential?: { secret: string }; secret?: string; adminEmail?: string; invitation?: { delivery: string; inviteUrl?: string } };
type InviteResult = { email: string; role: string; delivery: string; inviteUrl?: string; expiresAt: string };

const inputClass = 'ui-field w-full px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent-blue';
const buttonClass = 'ui-button-primary inline-flex items-center justify-center gap-2 disabled:opacity-40';
const quietButtonClass = 'ui-button-secondary inline-flex items-center justify-center gap-2 disabled:opacity-40';
const panelClass = 'rounded-xl border border-border bg-surface p-5';
const adminTabs: Array<{ id: AdminTab; label: string; icon: typeof Activity }> = [
  { id: 'organizations', label: 'Organizations', icon: Users },
  { id: 'services', label: 'Services', icon: ShieldCheck },
];
const organizationTabs: Array<{ id: OrganizationTab; label: string }> = [
  { id: 'overview', label: 'Overview' },
  { id: 'projects', label: 'App' },
  { id: 'users', label: 'Users' },
  { id: 'services', label: 'Services' },
  { id: 'support', label: 'Support' },
  { id: 'settings', label: 'Settings' },
];
const defaultSupportSettings: OrganizationSupportSettings = {
  ticketing: { enabled: false, provider: 'none', baseUrl: '', workspace: '', queue: '' },
  liveChat: { enabled: false, provider: 'none', baseUrl: '', workspace: '', queue: '' },
};
const ticketingProviders = [
  { id: 'none', label: 'Not connected' }, { id: 'zendesk', label: 'Zendesk' }, { id: 'freshdesk', label: 'Freshdesk' },
  { id: 'jira_service_management', label: 'Jira Service Management' }, { id: 'custom', label: 'Custom integration' },
];
const liveChatProviders = [
  { id: 'none', label: 'Not connected' }, { id: 'intercom', label: 'Intercom' }, { id: 'crisp', label: 'Crisp' }, { id: 'custom', label: 'Custom integration' },
];
const providerLogos: Record<string, string> = {
  zendesk: '/brand-icons/zendesk.svg', freshdesk: '/brand-icons/freshdesk.svg',
  jira_service_management: '/brand-icons/jira.svg', intercom: '/brand-icons/intercom.svg', crisp: '/brand-icons/crisp.svg',
};

async function superAdminRequest(path: string, body?: unknown, method = body === undefined ? 'GET' : 'POST') {
  const response = await fetch('/api/auth/super-admin' + path, {
    method, headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body), cache: 'no-store', credentials: 'same-origin',
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.message || `Request failed (${response.status})`);
  return result;
}

function Metric({ label, value, note }: { label: string; value: string | number; note?: string }) {
  return <div className="min-w-0 border-l-2 border-accent-blue/60 py-1 pl-4"><p className="text-sm text-text-secondary">{label}</p><p className="mt-2 text-2xl font-semibold tracking-tight">{value}</p>{note && <p className="mt-1 text-xs text-text-secondary">{note}</p>}</div>;
}

function StatusPill({ active, activeLabel = 'Active', inactiveLabel = 'Inactive' }: { active: boolean; activeLabel?: string; inactiveLabel?: string }) {
  return <span className={'rounded-full px-2.5 py-1 text-xs font-medium ' + (active ? 'bg-success/10 text-success' : 'bg-warning/10 text-warning')}>{active ? activeLabel : inactiveLabel}</span>;
}

export function AdminPage() {
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [currentAdmin, setCurrentAdmin] = useState('');
  const [loading, setLoading] = useState(true);
  const [authorized, setAuthorized] = useState(false);
  const [busy, setBusy] = useState(false);
  const [refreshingStatus, setRefreshingStatus] = useState(false);
  const [error, setError] = useState('');
  const [tab, setTab] = useState<AdminTab>('organizations');
  const [organizationTab, setOrganizationTab] = useState<OrganizationTab>('overview');
  const [selectedOrganizationId, setSelectedOrganizationId] = useState('');
  const [selectedAppId, setSelectedAppId] = useState('');
  const [supportSettingsDraft, setSupportSettingsDraft] = useState<OrganizationSupportSettings>(defaultSupportSettings);
  const [supportSettingsSaved, setSupportSettingsSaved] = useState(false);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [name, setName] = useState('');
  const [organizationName, setOrganizationName] = useState('');
  const [adminEmail, setAdminEmail] = useState('');
  const [newAppName, setNewAppName] = useState('');
  const [newAppAdminEmail, setNewAppAdminEmail] = useState('');
  const [status, setStatus] = useState<StatusPayload | null>(null);
  const [statusError, setStatusError] = useState('');
  const [result, setResult] = useState<AdminResult | null>(null);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState('member');
  const [inviteResult, setInviteResult] = useState<InviteResult | null>(null);
  const [adminTheme, setAdminTheme] = useState<'light' | 'dark' | 'aurora'>('dark');

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem('superqa-theme');
      const theme = saved === 'light' || saved === 'aurora' ? saved : 'dark';
      document.documentElement.classList.remove('dark', 'light', 'aurora');
      document.documentElement.classList.add(theme);
      setAdminTheme(theme);
    } catch { setAdminTheme('dark'); }
  }, []);

  const refreshOrganizations = useCallback(async () => {
    const list = await superAdminRequest('/organizations') as Organization[];
    setOrganizations(list);
    setSelectedOrganizationId(current => list.some(item => item.id === current) ? current : '');
  }, []);

  const refreshStatus = useCallback(async () => {
    setRefreshingStatus(true);
    try {
      const response = await fetch('/api/admin/status', { cache: 'no-store', credentials: 'same-origin' });
      const body = await response.json();
      if (!response.ok) throw new Error(body.message || 'Could not load service status.');
      setStatus(body as StatusPayload); setStatusError('');
    } catch (failure) {
      setStatus(null); setStatusError(failure instanceof Error ? failure.message : 'Could not load service status.');
    } finally { setRefreshingStatus(false); }
  }, []);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const sessionResponse = await fetch('/api/auth/session', { cache: 'no-store', credentials: 'same-origin' });
        const session = sessionResponse.ok ? await sessionResponse.json() : null;
        if (!session || session.user.accountType !== 'super_admin') { if (active) setAuthorized(false); return; }
        if (active) { setCurrentAdmin(session.user.email); setAuthorized(true); }
        const list = await superAdminRequest('/organizations') as Organization[];
        if (active) setOrganizations(list);
      } catch { if (active) setError('Could not load the authenticated admin console. Sign in with a super-admin account.'); }
      finally { if (active) setLoading(false); }
    })();
    return () => { active = false; };
  }, []);

  useEffect(() => { if (tab === 'services' && !status && !refreshingStatus) void refreshStatus(); }, [tab, status, refreshingStatus, refreshStatus]);

  const selectedOrganization = organizations.find(organization => organization.id === selectedOrganizationId) || null;
  const selectedApp = selectedOrganization?.apps.find(app => app.id === selectedAppId) || null;
  const allApps = useMemo(() => organizations.flatMap(organization => organization.apps), [organizations]);
  const totalMembers = useMemo(() => organizations.reduce((sum, organization) => sum + organization.memberCount, 0), [organizations]);
  const runsToday = useMemo(() => allApps.reduce((sum, app) => sum + app.runStats.today, 0), [allApps]);
  const connectedServices = useMemo(() => allApps.reduce((sum, app) => sum + app.services.filter(service => service.enabled).length, 0), [allApps]);

  const run = async (operation: () => Promise<void>) => {
    setBusy(true); setError(''); setResult(null);
    try { await operation(); } catch (failure) { setError(failure instanceof Error ? failure.message : 'Admin operation failed.'); }
    finally { setBusy(false); }
  };

  const createOrganization = (event: FormEvent) => {
    event.preventDefault();
    void run(async () => {
      const created = await superAdminRequest('/organizations', { organizationName, name, adminEmail }) as AdminResult & { project: App; organization: { id: string } };
      setResult(created); setName(''); setOrganizationName(''); setAdminEmail(''); setShowCreateForm(false);
      await refreshOrganizations();
      setSelectedOrganizationId(created.organization.id); setSelectedAppId(created.project.id); setOrganizationTab('overview'); setSupportSettingsDraft(defaultSupportSettings); setSupportSettingsSaved(false);
    });
  };

  const createOrganizationApp = (event: FormEvent) => {
    event.preventDefault();
    if (!selectedOrganization) return;
    void run(async () => {
      const created = await superAdminRequest(`/organizations/${encodeURIComponent(selectedOrganization.id)}/apps`, { name: newAppName, adminEmail: newAppAdminEmail }) as AdminResult & { project: App };
      setResult(created); setNewAppName(''); setNewAppAdminEmail('');
      await refreshOrganizations();
      setSelectedAppId(created.project.id); setOrganizationTab('overview');
    });
  };

  const issueRecoveryKey = (app: App) => {
    void run(async () => setResult(await superAdminRequest(`/organizations/${encodeURIComponent(app.id)}/recover-owner`, {})));
  };

  const saveSupportSettings = (event: FormEvent) => {
    event.preventDefault();
    if (!selectedOrganization || !selectedApp) return;
    void run(async () => {
      const saved = await superAdminRequest(`/organizations/${encodeURIComponent(selectedApp.id)}/support-settings`, supportSettingsDraft, 'PATCH') as OrganizationSupportSettings;
      setOrganizations(current => current.map(organization => organization.id === selectedOrganization.id ? { ...organization, apps: organization.apps.map(app => app.id === selectedApp.id ? { ...app, supportSettings: saved } : app) } : organization));
      setSupportSettingsDraft(saved); setSupportSettingsSaved(true);
    });
  };

  const inviteMember = (event: FormEvent) => {
    event.preventDefault();
    if (!selectedOrganization || !selectedApp) return;
    void run(async () => {
      const invitation = await superAdminRequest(`/organizations/${encodeURIComponent(selectedOrganization.id)}/apps/${encodeURIComponent(selectedApp.id)}/invitations`, { email: inviteEmail, role: inviteRole }) as InviteResult;
      setInviteResult(invitation); setInviteEmail(''); await refreshOrganizations();
    });
  };

  const impersonateMember = (member: Member) => {
    if (!selectedApp || !window.confirm(`Impersonate ${member.email} for up to 15 minutes? This action is audited.`)) return;
    void run(async () => {
      await superAdminRequest(`/organizations/${encodeURIComponent(selectedApp.id)}/members/${encodeURIComponent(member.id)}/impersonate`, {});
      window.location.assign('/');
    });
  };

  const toggleAdminTheme = () => {
    const theme = adminTheme === 'light' ? 'dark' : 'light';
    setAdminTheme(theme);
    document.documentElement.classList.remove('dark', 'light', 'aurora');
    document.documentElement.classList.add(theme);
    try { window.localStorage.setItem('superqa-theme', theme); } catch { /* Keep the current theme for this page. */ }
  };

  const updateSupportDraft = (kind: keyof OrganizationSupportSettings, field: keyof SupportConnector, value: string | boolean) => {
    setSupportSettingsSaved(false);
    setSupportSettingsDraft(current => ({ ...current, [kind]: { ...current[kind], [field]: value } as SupportConnector }));
  };

  const copyText = (value: string) => { void navigator.clipboard?.writeText(value); };

  if (loading) return <main className="min-h-screen bg-canvas p-8 text-text-secondary">Loading admin console…</main>;
  if (!authorized) return <main className="min-h-screen bg-canvas p-6 text-text-primary"><section className="mx-auto mt-16 max-w-lg space-y-4 rounded-xl border border-border bg-surface p-6"><h1 className="text-2xl font-semibold">Super-admin sign-in required</h1><p className="text-sm text-text-secondary">This console is available only to authenticated deployment super-admins.</p><a className={buttonClass} href="/login">Sign in</a></section></main>;

  return <main className="min-h-screen bg-canvas px-4 pb-8 text-text-primary md:px-8">
    <div className="mx-auto max-w-7xl">
      <header className="sticky top-0 z-30 -mx-4 mb-6 flex flex-wrap items-center gap-x-7 gap-y-2 border-b border-border bg-canvas/95 px-4 py-3 backdrop-blur-md md:-mx-8 md:px-8">
        <div className="shrink-0"><h1 className="text-xl font-semibold tracking-tight">Admin console</h1><p className="text-sm leading-5 text-text-secondary">Manage organizations, access, and platform services.</p></div>
        <nav aria-label="Admin navigation" className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto" role="tablist">
          {adminTabs.map(item => <button key={item.id} id={`admin-tab-${item.id}`} role="tab" aria-selected={tab === item.id} aria-controls={`admin-panel-${item.id}`} onClick={() => { setTab(item.id); setSelectedOrganizationId(''); setSelectedAppId(''); }} className={'inline-flex shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-sm transition ' + (tab === item.id ? 'bg-accent-blue/10 font-semibold text-accent-blue' : 'text-text-secondary hover:bg-elevated hover:text-text-primary')}><item.icon size={15} />{item.label}{item.id === 'organizations' && <span className="rounded-full bg-surface px-1.5 py-0.5 text-[11px]">{organizations.length}</span>}</button>)}
        </nav>
        <div className="ml-auto flex shrink-0 items-center gap-2"><span className="hidden text-xs text-text-secondary sm:inline">{currentAdmin}</span><button type="button" className={quietButtonClass + ' h-9 w-9 px-0'} onClick={toggleAdminTheme} title={`Switch to ${adminTheme === 'light' ? 'dark' : 'light'} theme`} aria-label={`Switch to ${adminTheme === 'light' ? 'dark' : 'light'} theme`}>{adminTheme === 'light' ? <Moon size={16} /> : <Sun size={16} />}</button><button className={quietButtonClass + ' px-2.5 py-1.5 text-xs'} onClick={async () => { await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' }); location.assign('/login'); }}>Sign out</button></div>
      </header>

      {error && <div role="alert" className="mb-4 rounded-lg border border-danger/30 bg-danger/10 p-3 text-sm text-danger">{error}</div>}
      {result && <section role="status" className={panelClass + ' mb-5 space-y-3'}>
        {result.project ? <><h2 className="text-lg font-medium">App created</h2><p className="text-sm">{result.project.name} created. The nominated admin receives an invitation at {result.adminEmail}.</p></> : <><h2 className="text-lg font-medium">Owner recovery key</h2><p className="text-sm text-text-secondary">This one-day key is shown once. Share it securely with the app admin.</p><pre className="overflow-auto rounded-lg bg-canvas p-3 text-sm">{result.secret || result.credential?.secret}</pre><button className={quietButtonClass} onClick={() => copyText(result.secret || result.credential?.secret || '')}>Copy recovery key</button></>}
        {result.invitation?.delivery !== 'email_sent' && result.invitation?.inviteUrl && <><p className="text-sm text-warning">{result.invitation.delivery === 'manual' ? 'Email delivery is not configured.' : 'Email delivery failed.'} Copy this single-use invitation link and share it securely.</p><pre className="overflow-auto rounded-lg bg-canvas p-3 text-sm">{result.invitation.inviteUrl}</pre><button className={quietButtonClass} onClick={() => copyText(result.invitation?.inviteUrl || '')}>Copy invitation link</button></>}
        {result.invitation?.delivery === 'email_sent' && <p className="text-sm text-success">A seven-day invitation was delivered by email. They will set a password before signing in.</p>}
      </section>}

      <section id={`admin-panel-${tab}`} role="tabpanel" aria-labelledby={`admin-tab-${tab}`}>
        {tab === 'organizations' && !selectedOrganization && <div className="space-y-6">
          <div className="flex flex-wrap items-end justify-between gap-4"><div><p className="text-xs font-semibold uppercase tracking-[0.15em] text-accent-blue">Deployment</p><h2 className="mt-1 text-2xl font-semibold tracking-tight">Organizations</h2><p className="mt-1 text-sm text-text-secondary">Organizations contain apps. Select an organization to manage its apps, users, limits, and services.</p></div><div className="flex gap-2"><button className={quietButtonClass} onClick={() => void refreshOrganizations()}><RefreshCw size={14} />Refresh</button><button className={buttonClass} onClick={() => setShowCreateForm(value => !value)}><Plus size={15} />Create organization</button></div></div>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"><div className={panelClass}><Metric label="Organizations" value={organizations.length} /></div><div className={panelClass}><Metric label="Apps" value={allApps.length} /></div><div className={panelClass}><Metric label="Active app memberships" value={totalMembers} /></div><div className={panelClass}><Metric label="QA runs today" value={runsToday} note={`${connectedServices} connected services`} /></div></div>
          {showCreateForm && <section className={panelClass + ' space-y-4'}><div className="flex items-start justify-between gap-4"><div><h3 className="font-semibold">Create an organization and its first app</h3><p className="mt-1 text-sm text-text-secondary">The first app owner receives an invitation.</p></div><button className={quietButtonClass} onClick={() => setShowCreateForm(false)}>Cancel</button></div><form className="grid gap-4 md:grid-cols-3" onSubmit={createOrganization}><label className="block text-sm">Organization name<input required maxLength={100} className={inputClass + ' mt-1'} value={organizationName} onChange={event => setOrganizationName(event.target.value)} placeholder="Acme Inc." /></label><label className="block text-sm">First app name<input required maxLength={100} className={inputClass + ' mt-1'} value={name} onChange={event => setName(event.target.value)} placeholder="Customer Support" /></label><label className="block text-sm">First app owner’s email<input required type="email" maxLength={254} className={inputClass + ' mt-1'} value={adminEmail} onChange={event => setAdminEmail(event.target.value)} placeholder="admin@acme.com" /></label><button className={buttonClass + ' md:col-span-3 md:justify-self-end'} disabled={busy}>{busy ? 'Creating…' : 'Create organization'}</button></form></section>}
          {organizations.length ? <div className="grid gap-3 lg:grid-cols-2">{organizations.map(organization => <button key={organization.id} onClick={() => { setSelectedOrganizationId(organization.id); setSelectedAppId(''); setOrganizationTab('overview'); setSupportSettingsSaved(false); }} className="group rounded-xl border border-border bg-surface p-5 text-left transition hover:-translate-y-0.5 hover:border-accent-blue/30 hover:shadow-md"><div className="flex items-start justify-between gap-4"><div className="min-w-0"><h3 className="truncate font-semibold">{organization.name}</h3><p className="mt-1 text-xs text-text-secondary">Created {new Date(organization.createdAt).toLocaleDateString()}</p></div><ChevronRight size={18} className="shrink-0 text-text-secondary transition group-hover:translate-x-0.5 group-hover:text-accent-blue" /></div><div className="mt-5 grid grid-cols-2 gap-4 border-t border-border pt-4"><div><p className="text-xs text-text-secondary">Apps</p><p className="mt-1 text-sm font-semibold">{organization.appCount}</p></div><div><p className="text-xs text-text-secondary">App memberships</p><p className="mt-1 text-sm font-semibold">{organization.memberCount}</p></div></div><p className="mt-3 truncate text-xs text-text-secondary">{organization.apps.map(app => app.name).join(' · ') || 'No apps yet'}</p></button>)}</div> : <div className="rounded-xl border border-dashed border-border bg-surface px-6 py-14 text-center"><span className="mx-auto grid h-12 w-12 place-items-center rounded-xl bg-accent-blue/10 text-accent-blue"><Users size={21} /></span><h3 className="mt-4 font-semibold">No organizations yet</h3><p className="mt-1 text-sm text-text-secondary">Create an organization and its first app to begin onboarding.</p><button className={buttonClass + ' mt-4'} onClick={() => setShowCreateForm(true)}><Plus size={15} />Create organization</button></div>}
        </div>}

        {tab === 'organizations' && selectedOrganization && !selectedApp && <div className="space-y-5">
          <section className={panelClass + ' space-y-5'}><div><button className="mb-2 inline-flex items-center gap-1.5 text-xs font-medium text-text-secondary hover:text-text-primary" onClick={() => setSelectedOrganizationId('')}><ArrowLeft size={14} />All organizations</button><p className="text-xs uppercase tracking-widest text-accent-blue">Organization</p><h2 className="mt-1 text-xl font-semibold">{selectedOrganization.name}</h2><p className="mt-1 text-sm text-text-secondary">Each app has its own users, access roles, settings, and QA activity.</p></div>
            {selectedOrganization.apps.length > 0 ? <div className="grid gap-3 border-t border-border pt-5 lg:grid-cols-2">{selectedOrganization.apps.map(app => <article key={app.id} className="rounded-xl border border-border bg-canvas p-4"><button type="button" onClick={() => { setSelectedAppId(app.id); setOrganizationTab('overview'); setSupportSettingsDraft(app.supportSettings || defaultSupportSettings); setSupportSettingsSaved(false); }} className="group flex w-full items-start justify-between gap-4 text-left"><span className="min-w-0"><span className="flex flex-wrap items-center gap-2 font-semibold text-text-primary">{app.name}<StatusPill active={!app.paused} activeLabel="Active" inactiveLabel="Paused" /></span><span className="mt-1 block text-xs capitalize text-text-secondary">{app.environment} environment · Added {new Date(app.createdAt).toLocaleDateString()}</span></span><ChevronRight size={17} className="mt-1 shrink-0 text-text-secondary group-hover:text-accent-blue" /></button><div className="mt-4 grid grid-cols-3 gap-3 border-t border-border pt-3 text-sm"><div><p className="text-xs text-text-secondary">Users</p><p className="mt-1 font-medium">{app.memberCount} active</p>{app.invitations.length > 0 && <p className="mt-1 text-xs text-text-secondary">{app.invitations.length} invited</p>}</div><div><p className="text-xs text-text-secondary">Runs today</p><p className="mt-1 font-medium">{app.runStats.today} / {app.dailyRunLimit}</p></div><div><p className="text-xs text-text-secondary">Total runs</p><p className="mt-1 font-medium">{app.runStats.total}</p></div></div><div className="mt-3"><p className="text-xs font-medium text-text-secondary">Users assigned to this app</p>{app.members.length ? <div className="mt-2 flex flex-wrap gap-1.5">{app.members.slice(0, 4).map(member => <span key={member.id} className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-border bg-surface px-2.5 py-1 text-xs"><span className="max-w-[200px] truncate">{member.email}</span><span className="capitalize text-text-secondary">{member.role}</span></span>)}{app.members.length > 4 && <span className="rounded-full bg-elevated px-2.5 py-1 text-xs text-text-secondary">+{app.members.length - 4} more</span>}</div> : <p className="mt-1 text-sm text-text-secondary">No users assigned yet.</p>}{app.invitations.length > 0 && <p className="mt-2 text-xs text-text-secondary">Invited: {app.invitations.map(invitation => invitation.email).join(', ')}</p>}</div><button type="button" onClick={() => { setSelectedAppId(app.id); setOrganizationTab('users'); }} className={quietButtonClass + ' mt-4 w-full justify-center'}><Users size={14} />View app users</button></article>)}</div> : <p className="border-t border-border py-5 text-sm text-text-secondary">No apps in this organization yet.</p>}
            <form onSubmit={createOrganizationApp} className="grid gap-3 border-t border-border pt-5 sm:grid-cols-[1fr_1fr_auto] sm:items-end"><label className="text-sm">App name<input required maxLength={100} className={inputClass + ' mt-1'} value={newAppName} onChange={event => setNewAppName(event.target.value)} /></label><label className="text-sm">First app admin’s email<input required type="email" maxLength={254} className={inputClass + ' mt-1'} value={newAppAdminEmail} onChange={event => setNewAppAdminEmail(event.target.value)} /></label><button className={buttonClass} disabled={busy}><Plus size={14} />{busy ? 'Creating…' : 'Add app'}</button></form></section>
        </div>}

        {tab === 'organizations' && selectedOrganization && selectedApp && <div className="space-y-5">
          <section className={panelClass + ' space-y-4'}>
            <div className="flex flex-wrap items-start justify-between gap-3"><div><button className="mb-2 inline-flex items-center gap-1.5 text-xs font-medium text-text-secondary hover:text-text-primary" onClick={() => { setSelectedOrganizationId(''); setSelectedAppId(''); }}><ArrowLeft size={14} />All organizations</button><p className="text-xs uppercase tracking-widest text-accent-blue">Organization</p><h2 className="mt-1 text-xl font-semibold">{selectedOrganization.name}</h2><p className="mt-1 text-sm text-text-secondary">{selectedOrganization.appCount} apps · {selectedOrganization.memberCount} app memberships</p></div></div>
            <div className="flex flex-wrap items-center gap-2 border-t border-border pt-4"><span className="mr-1 text-xs font-medium text-text-secondary">Apps</span>{selectedOrganization.apps.map(app => <button key={app.id} type="button" aria-pressed={app.id === selectedAppId} onClick={() => { setSelectedAppId(app.id); setOrganizationTab('overview'); setSupportSettingsDraft(app.supportSettings || defaultSupportSettings); setSupportSettingsSaved(false); }} className={'rounded-lg border px-3 py-2 text-left text-sm ' + (app.id === selectedAppId ? 'border-accent-blue/40 bg-accent-blue/10 text-accent-blue' : 'border-border text-text-secondary hover:bg-elevated hover:text-text-primary')}><span className="block font-medium">{app.name}</span><span className="text-xs">{app.environment} · {app.paused ? 'Paused' : 'Active'}</span></button>)}</div>
          </section>
          <div className="flex flex-wrap items-end justify-between gap-3"><div><button className="mb-2 inline-flex items-center gap-1.5 text-xs font-medium text-text-secondary hover:text-text-primary" onClick={() => setSelectedAppId('')}><ArrowLeft size={14} />Organization apps</button><div className="flex flex-wrap items-center gap-2"><h2 className="text-2xl font-semibold tracking-tight">{selectedApp.name}</h2><StatusPill active={!selectedApp.paused} activeLabel="Active" inactiveLabel="Paused" /></div><p className="mt-1 text-sm text-text-secondary">App overview and account operations</p></div><button className={quietButtonClass} disabled={busy} onClick={() => issueRecoveryKey(selectedApp)}><KeyRound size={14} />Recover owner key</button></div>
          <nav aria-label={`${selectedApp.name} sections`} className="flex gap-1 overflow-x-auto border-b border-border" role="tablist">{organizationTabs.map(item => <button key={item.id} id={`org-tab-${item.id}`} role="tab" aria-selected={organizationTab === item.id} aria-controls={`org-panel-${item.id}`} onClick={() => setOrganizationTab(item.id)} className={'shrink-0 border-b-2 px-3 py-2.5 text-sm transition ' + (organizationTab === item.id ? 'border-accent-blue font-medium text-text-primary' : 'border-transparent text-text-secondary hover:text-text-primary')}>{item.label}{item.id === 'users' && <span className="ml-2 text-xs text-text-secondary">{selectedApp.memberCount}</span>}{item.id === 'services' && <span className="ml-2 text-xs text-text-secondary">{selectedApp.services.filter(service => service.enabled).length}</span>}</button>)}</nav>
          <section id={`org-panel-${organizationTab}`} role="tabpanel" aria-labelledby={`org-tab-${organizationTab}`} className="space-y-5">
            {organizationTab === 'overview' && <>
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"><div className={panelClass}><Metric label="QA workspace" value="1" note="Current account model" /></div><div className={panelClass}><Metric label="Active users" value={selectedApp.memberCount} /></div><div className={panelClass}><Metric label="QA runs today" value={selectedApp.runStats.today} note={`${selectedApp.dailyRunLimit} daily limit`} /></div><div className={panelClass}><Metric label="Connected services" value={selectedApp.services.filter(service => service.enabled).length} note={`${selectedApp.agents.length} agents configured`} /></div></div>
              <div className="grid gap-5 xl:grid-cols-[1.3fr_.7fr]"><section className={panelClass + ' space-y-4'}><div><h3 className="font-semibold">App</h3><p className="mt-1 text-sm text-text-secondary">Workspace and QA activity for this app.</p></div><ProjectSummary organization={selectedApp} /><button className={quietButtonClass} onClick={() => setOrganizationTab('projects')}>View app details<ChevronRight size={14} /></button></section><section className={panelClass + ' space-y-4'}><div><h3 className="font-semibold">People</h3><p className="mt-1 text-sm text-text-secondary">App members and access.</p></div>{selectedApp.members.length ? <div className="space-y-3">{selectedApp.members.slice(0, 5).map(member => <div key={member.id} className="flex items-center justify-between gap-3"><div className="min-w-0"><p className="truncate text-sm font-medium">{member.email}</p><p className="text-xs capitalize text-text-secondary">{member.role}</p></div><StatusPill active={member.active} activeLabel="Active" inactiveLabel="Inactive" /></div>)}</div> : <p className="text-sm text-text-secondary">No users have joined yet.</p>}<button className={quietButtonClass} onClick={() => setOrganizationTab('users')}>View all users<ChevronRight size={14} /></button></section></div>
            </>}
            {organizationTab === 'projects' && <section className={panelClass + ' space-y-4'}><div><h3 className="font-semibold">App</h3><p className="mt-1 text-sm text-text-secondary">App execution, environment, limits, and QA activity.</p></div><ProjectSummary organization={selectedApp} /><div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"><Metric label="Total runs" value={selectedApp.runStats.total} /><Metric label="Passed runs" value={selectedApp.runStats.passed} /><Metric label="Active runs" value={selectedApp.runStats.active} /><Metric label="Daily limit" value={selectedApp.dailyRunLimit} /></div><p className="rounded-lg bg-canvas p-3 text-xs leading-5 text-text-secondary">Each app has its own workspace, execution environment, limits, and QA activity.</p></section>}
            {organizationTab === 'users' && <section className={panelClass + ' space-y-4'}><div><h3 className="font-semibold">App users</h3><p className="mt-1 text-sm text-text-secondary">See who has access to this app and manage invitations.</p></div><form onSubmit={inviteMember} className="grid gap-3 rounded-lg border border-border bg-canvas p-4 sm:grid-cols-[1fr_150px_auto] sm:items-end"><label className="text-sm">Email<input required type="email" maxLength={254} className={inputClass + ' mt-1'} value={inviteEmail} onChange={event => setInviteEmail(event.target.value)} placeholder="teammate@company.com" /></label><label className="text-sm">Role<select className={inputClass + ' mt-1'} value={inviteRole} onChange={event => setInviteRole(event.target.value)}><option value="owner">Owner</option><option value="admin">Admin</option><option value="member">Member</option></select></label><button className={buttonClass} disabled={busy}><Plus size={15} />{busy ? 'Inviting…' : 'Invite user'}</button></form>{inviteResult && <div role="status" className="rounded-lg border border-success/20 bg-success/5 p-3 text-sm"><p>{inviteResult.delivery === 'email_sent' ? `Invitation sent to ${inviteResult.email}.` : `Invitation created for ${inviteResult.email}; email delivery is unavailable.`} Expires {new Date(inviteResult.expiresAt).toLocaleDateString()}.</p>{inviteResult.inviteUrl && <div className="mt-2 flex flex-wrap items-center gap-2"><code className="max-w-full break-all text-xs">{inviteResult.inviteUrl}</code><button type="button" className={quietButtonClass + ' py-1 text-xs'} onClick={() => copyText(inviteResult.inviteUrl || '')}>Copy invite link</button></div>}</div>}{selectedApp.members.length ? <div className="overflow-x-auto"><table className="w-full min-w-[710px] text-left text-sm"><thead className="text-xs text-text-secondary"><tr><th className="py-2 font-medium">User</th><th className="py-2 font-medium">Role</th><th className="py-2 font-medium">Access</th><th className="py-2 font-medium">Added</th><th className="py-2 text-right font-medium">Actions</th></tr></thead><tbody className="divide-y divide-border">{selectedApp.members.map(member => <tr key={member.id}><td className="py-3">{member.email}</td><td className="py-3 capitalize">{member.role}</td><td className="py-3"><StatusPill active={member.active} activeLabel="Active" inactiveLabel="Inactive" /></td><td className="py-3 text-xs text-text-secondary">{new Date(member.createdAt).toLocaleDateString()}</td><td className="py-3 text-right"><button type="button" className={quietButtonClass + ' px-2.5 py-1.5 text-xs'} disabled={!member.active || busy} onClick={() => impersonateMember(member)} title="Temporary, audited session; expires in 15 minutes"><UserRoundCog size={14} />Impersonate</button></td></tr>)}</tbody></table></div> : <p className="rounded-lg bg-canvas p-5 text-sm text-text-secondary">No users have joined this app.</p>}{selectedApp.invitations.length > 0 && <div className="space-y-2 border-t border-border pt-4"><h4 className="text-sm font-medium">Pending invitations</h4>{selectedApp.invitations.map(invitation => <div key={invitation.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-canvas px-3 py-2.5 text-sm"><div className="min-w-0"><p className="truncate font-medium">{invitation.email}</p><p className="text-xs capitalize text-text-secondary">{invitation.role} · invited {new Date(invitation.createdAt).toLocaleDateString()}</p></div><span className="text-xs text-text-secondary">Expires {new Date(invitation.expiresAt).toLocaleDateString()}</span></div>)}</div>}<p className="text-xs leading-5 text-text-secondary">Impersonation is limited to 15 minutes, recorded in the app audit trail, and can be exited from the in-app banner.</p></section>}
            {organizationTab === 'services' && <div className="grid gap-5 lg:grid-cols-2"><section className={panelClass + ' space-y-4'}><div><h3 className="font-semibold">Agent services</h3><p className="mt-1 text-sm text-text-secondary">Agents configured for this app.</p></div>{selectedApp.agents.length ? <div className="divide-y divide-border">{selectedApp.agents.map(agent => <div key={agent.id} className="flex items-center justify-between gap-3 py-3"><div className="flex items-center gap-3"><span className="grid h-9 w-9 place-items-center rounded-lg bg-accent-blue/10 text-accent-blue"><Workflow size={16} /></span><div><p className="text-sm font-medium">{agent.name}</p><p className="text-xs uppercase text-text-secondary">{agent.kind || 'Agent'}</p></div></div><StatusPill active={agent.enabled} activeLabel="Enabled" inactiveLabel="Disabled" /></div>)}</div> : <p className="rounded-lg bg-canvas p-4 text-sm text-text-secondary">No agent services are configured for this app.</p>}</section><section className={panelClass + ' space-y-4'}><div><h3 className="font-semibold">Connected services</h3><p className="mt-1 text-sm text-text-secondary">Messaging integrations connected to this app.</p></div>{selectedApp.services.length ? <div className="divide-y divide-border">{selectedApp.services.map(service => <div key={service.id} className="flex items-center justify-between gap-3 py-3"><div className="flex items-center gap-3"><span className="grid h-9 w-9 place-items-center rounded-lg bg-elevated text-text-secondary"><Server size={16} /></span><div><p className="text-sm font-medium">{service.name}</p><p className="text-xs capitalize text-text-secondary">{service.provider} · {service.accessMode === 'read_reply' ? 'read and reply' : 'read only'}</p></div></div><StatusPill active={service.enabled} activeLabel="Connected" inactiveLabel="Disabled" /></div>)}</div> : <p className="rounded-lg bg-canvas p-4 text-sm text-text-secondary">No messaging services are connected to this app.</p>}<p className="text-xs leading-5 text-text-secondary">Knowledge-source integrations are not yet app-scoped in the current data model and are intentionally not shown here.</p></section></div>}
            {organizationTab === 'support' && <SupportPanel organizationName={selectedApp.name} settings={selectedApp.supportSettings || defaultSupportSettings} />}
            {organizationTab === 'settings' && <form onSubmit={saveSupportSettings} className="space-y-5">
              <div className="flex flex-wrap items-end justify-between gap-3"><div><h3 className="text-lg font-semibold">Support integrations</h3><p className="mt-1 text-sm text-text-secondary">Choose and configure support systems for {selectedApp.name}.</p></div>{supportSettingsSaved && <span role="status" className="text-xs font-medium text-success">Settings saved</span>}</div>
              <div className="grid gap-5 xl:grid-cols-2">
                <SupportIntegrationSettingsCard title="Support tickets" description="Configure the ticketing workspace this app uses." integration={supportSettingsDraft.ticketing} providers={ticketingProviders} workspaceLabel="Workspace / project" queueLabel="Queue / project key" onChange={(field, value) => updateSupportDraft('ticketing', field, value)} />
                <SupportIntegrationSettingsCard title="Live chat" description="Configure the live-chat workspace and inbox for this app." integration={supportSettingsDraft.liveChat} providers={liveChatProviders} workspaceLabel="Workspace / site" queueLabel="Inbox / website ID" onChange={(field, value) => updateSupportDraft('liveChat', field, value)} />
              </div>
              <p className="rounded-lg border border-warning/20 bg-warning/5 p-3 text-xs leading-5 text-text-secondary">These settings are saved per app. Provider-specific ticket and chat syncing is not active until the matching connector is implemented; saved configuration is not shown as a live connection.</p>
              <button className={buttonClass} disabled={busy}>{busy ? 'Saving…' : 'Save support settings'}</button>
            </form>}
          </section>
        </div>}

        {tab === 'services' && <section className={panelClass + ' space-y-4'}><div className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-xs font-semibold uppercase tracking-[0.15em] text-accent-blue">Deployment</p><h2 className="mt-1 text-2xl font-semibold tracking-tight">Service status</h2><p className="mt-1 text-sm text-text-secondary">Live infrastructure checks for the whole deployment.</p></div><button className={quietButtonClass} onClick={() => void refreshStatus()} disabled={refreshingStatus}><RefreshCw size={14} className={refreshingStatus ? 'animate-spin' : ''} />Refresh status</button></div>{statusError && <p role="alert" className="rounded-lg border border-warning/25 bg-warning/10 p-3 text-sm text-warning">{statusError}</p>}{!status && refreshingStatus && <p className="flex items-center gap-2 py-6 text-sm text-text-secondary"><LoaderCircle size={16} className="animate-spin" />Checking services…</p>}{status && <><p className="text-xs text-text-secondary">Last checked {new Date(status.checkedAt).toLocaleString()}</p><div className="divide-y divide-border">{status.services.map(service => <article key={service.id} className="flex flex-wrap items-center justify-between gap-3 py-4"><div className="flex items-center gap-3"><span className={'flex h-9 w-9 items-center justify-center rounded-lg ' + (service.status === 'healthy' ? 'bg-success/10 text-success' : 'bg-danger/10 text-danger')}><Activity size={17} /></span><div><h3 className="text-sm font-medium">{service.name}</h3><p className="mt-1 text-xs text-text-secondary">{service.detail}</p></div></div><StatusPill active={service.status === 'healthy'} activeLabel="Operational" inactiveLabel="Issue detected" /></article>)}</div><div className="border-t border-border pt-4"><h3 className="text-sm font-medium">Recent incidents</h3>{status.timeline.length ? <div className="mt-3 space-y-2">{status.timeline.slice(0, 8).map(incident => <div key={incident.id} className="flex flex-wrap justify-between gap-2 rounded-lg bg-canvas p-3 text-sm"><span>{incident.message}</span><span className="text-xs text-text-secondary">{new Date(incident.startedAt).toLocaleString()} · {incident.resolvedAt ? 'Resolved' : 'Ongoing'}</span></div>)}</div> : <p className="mt-2 text-sm text-text-secondary">No incidents recorded in the last 30 days.</p>}</div></>}</section>}

      </section>
      <footer className="mt-8 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4 text-xs text-text-secondary"><span>App admins invite teammates from Settings → Access.</span><span>Super-admin accounts are provisioned on the API host.</span><a className="underline" href="/settings">Open settings</a></footer>
    </div>
  </main>;
}

function ProjectSummary({ organization }: { organization: App }) {
  return <article className="rounded-lg border border-border bg-canvas p-4"><div className="flex flex-wrap items-start justify-between gap-4"><div><div className="flex flex-wrap items-center gap-2"><h4 className="font-medium">{organization.name}</h4><span className="rounded-full bg-elevated px-2 py-1 text-xs text-text-secondary">{organization.environment}</span><StatusPill active={!organization.paused} activeLabel="Running" inactiveLabel="Paused" /></div><p className="mt-2 break-all font-mono text-[11px] text-text-secondary">{organization.id}</p><p className="mt-2 text-xs text-text-secondary">Created {new Date(organization.createdAt).toLocaleDateString()}</p></div><div className="grid grid-cols-2 gap-x-7 gap-y-3 text-sm sm:grid-cols-4"><div><p className="text-xs text-text-secondary">Runs today</p><p className="mt-1 font-medium">{organization.runStats.today} / {organization.dailyRunLimit}</p></div><div><p className="text-xs text-text-secondary">Total runs</p><p className="mt-1 font-medium">{organization.runStats.total}</p></div><div><p className="text-xs text-text-secondary">Passed</p><p className="mt-1 font-medium">{organization.runStats.passed}</p></div><div><p className="text-xs text-text-secondary">Active runs</p><p className="mt-1 font-medium">{organization.runStats.active}</p></div></div></div></article>;
}

function SupportIntegrationSettingsCard({ title, description, integration, providers, workspaceLabel, queueLabel, onChange }: {
  title: string;
  description: string;
  integration: SupportConnector;
  providers: Array<{ id: string; label: string }>;
  workspaceLabel: string;
  queueLabel: string;
  onChange: (field: keyof SupportConnector, value: string | boolean) => void;
}) {
  const providerConfigured = integration.provider !== 'none';
  const selectedProvider = providers.find(provider => provider.id === integration.provider);
  const providerLogo = providerLogos[integration.provider];
  return <section className={panelClass + ' space-y-4'}>
    <div className="flex items-start justify-between gap-4"><div className="flex min-w-0 items-start gap-3">{providerLogo ? <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-border bg-white p-1.5"><img src={providerLogo} alt={`${selectedProvider?.label || 'Provider'} logo`} className={integration.provider === 'crisp' ? 'h-3 w-7 object-contain' : 'h-5 w-5 object-contain'} /></span> : <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-accent-blue/10 text-accent-blue"><LifeBuoy size={17} /></span>}<div className="min-w-0"><h4 className="font-semibold">{title}</h4><p className="mt-1 text-sm text-text-secondary">{description}</p>{providerConfigured && <p className="mt-2 text-xs font-medium text-text-primary">{selectedProvider?.label}</p>}</div></div><label className={'inline-flex shrink-0 items-center gap-2 text-xs font-medium ' + (providerConfigured ? 'cursor-pointer text-text-secondary' : 'cursor-not-allowed text-text-secondary/60')}><span>{integration.enabled ? 'Enabled' : 'Off'}</span><input type="checkbox" className="sr-only" checked={integration.enabled} disabled={!providerConfigured} onChange={event => onChange('enabled', event.target.checked)} /><span aria-hidden="true" className={'relative h-6 w-11 rounded-full transition ' + (integration.enabled ? 'bg-accent-blue' : 'bg-elevated') + (!providerConfigured ? ' opacity-50' : '')}><span className={'absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ' + (integration.enabled ? 'translate-x-5' : 'translate-x-0.5')} /></span></label></div>
    <label className="block text-sm">Provider<select className={inputClass + ' mt-1'} value={integration.provider} onChange={event => { onChange('provider', event.target.value); if (event.target.value === 'none') onChange('enabled', false); }}>
      {providers.map(provider => <option key={provider.id} value={provider.id}>{provider.label}</option>)}
    </select></label>
    <fieldset disabled={!providerConfigured} className="grid gap-3 disabled:opacity-60">
      <label className="block text-sm">Workspace URL<input type="url" className={inputClass + ' mt-1'} value={integration.baseUrl} onChange={event => onChange('baseUrl', event.target.value)} placeholder="https://your-workspace.example" required={integration.enabled} /></label>
      <div className="grid gap-3 sm:grid-cols-2"><label className="block text-sm">{workspaceLabel}<input className={inputClass + ' mt-1'} value={integration.workspace} onChange={event => onChange('workspace', event.target.value)} placeholder="Workspace name or ID" /></label><label className="block text-sm">{queueLabel}<input className={inputClass + ' mt-1'} value={integration.queue} onChange={event => onChange('queue', event.target.value)} placeholder="Optional" /></label></div>
    </fieldset>
  </section>;
}

function SupportPanel({ organizationName, settings }: { organizationName: string; settings: OrganizationSupportSettings }) {
  const integrations = [
    { title: 'Support tickets', icon: LifeBuoy, config: settings.ticketing },
    { title: 'Live chat', icon: Users, config: settings.liveChat },
  ];
  return <div className="space-y-5"><div><h3 className="text-lg font-semibold">Support for {organizationName}</h3><p className="mt-1 text-sm text-text-secondary">Support integrations and availability for this app only.</p></div><div className="grid gap-4 lg:grid-cols-2">{integrations.map(integration => <section key={integration.title} className={panelClass + ' space-y-4'}><div className="flex items-start justify-between gap-3"><div className="flex items-center gap-3"><span className="grid h-10 w-10 place-items-center rounded-lg bg-elevated text-text-secondary"><integration.icon size={18} /></span><div><h4 className="font-semibold">{integration.title}</h4><p className="text-xs text-text-secondary">{integration.config.provider === 'none' ? 'No provider selected' : integration.config.provider.replaceAll('_', ' ')}</p></div></div><StatusPill active={false} inactiveLabel={integration.config.enabled ? 'Configured · not connected' : 'Disabled'} /></div><div className="rounded-lg border border-border bg-canvas p-4 text-sm"><p className="font-medium">{integration.config.enabled ? 'Configuration saved' : 'No active configuration'}</p><p className="mt-1 text-xs leading-5 text-text-secondary">{integration.config.baseUrl || 'Choose a provider and configure its workspace in Settings.'}</p>{integration.config.workspace && <p className="mt-2 text-xs text-text-secondary">Workspace: {integration.config.workspace}{integration.config.queue ? ` · ${integration.config.queue}` : ''}</p>}</div></section>)}</div><p className="rounded-lg border border-warning/20 bg-warning/5 p-3 text-xs leading-5 text-text-secondary">Provider-specific ticket syncing and live-chat conversations are not active until connector adapters are implemented. Manage this app’s provider settings in its Settings tab.</p></div>;
}
