'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import { Activity, ArrowUpRight, Building2, Check, CircleUserRound, Flame, Gauge, KeyRound, Leaf, Mail, Moon, Plus, RefreshCw, ShieldCheck, Sparkles, Sun, Users } from 'lucide-react';
import { themeMode, themePalette, useAppStore, type ThemePalette } from '@/lib/store';

type AccountSummary = { email: string; role: string; accountType?: string };
type ManagedApp = {
  id: string;
  organizationId: string;
  name: string;
  environment: string;
  paused: boolean;
  dailyRunLimit: number;
  createdAt: string;
  memberCount: number;
  members: Array<{ id: string; email: string; role: string; active: boolean; createdAt: string }>;
  runStats: { total: number; today: number; passed: number; active: number };
};
type ManagedOrganization = { id: string; name: string; createdAt: string; appCount: number; memberCount: number; apps: ManagedApp[] };
type InvitationResult = { email: string; role: string; delivery: string; inviteUrl?: string; expiresAt: string };
type AdminCreateResult = { organization: ManagedOrganization; project: ManagedApp; invitation?: InvitationResult };
type ProfileTab = 'profile' | 'org-settings';

const paletteOptions: Array<{ id: ThemePalette; name: string; description: string; icon: typeof Moon }> = [
  { id: 'default', name: 'Default', description: 'Focused, neutral workspace', icon: Moon },
  { id: 'aurora', name: 'Aurora', description: 'Deep blue with vivid accents', icon: Sparkles },
  { id: 'secure', name: 'Secure', description: 'Trustworthy, calm blue', icon: ShieldCheck },
  { id: 'energetic', name: 'Energetic', description: 'Vivid, driven orange', icon: Flame },
  { id: 'natural', name: 'Natural', description: 'Grounded, organic green', icon: Leaf },
];

const modeOptions: Array<{ id: 'dark' | 'light'; name: string; icon: typeof Moon }> = [
  { id: 'dark', name: 'Dark', icon: Moon },
  { id: 'light', name: 'Light', icon: Sun },
];

const inputClass = 'ui-field w-full px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent-blue';
const buttonClass = 'ui-button-primary inline-flex items-center justify-center gap-2 disabled:opacity-40';
const quietButtonClass = 'ui-button-secondary inline-flex items-center justify-center gap-2 disabled:opacity-40';

async function adminRequest(path: string, body?: unknown, method = body === undefined ? 'GET' : 'POST', apiRoot = '/api/auth/super-admin') {
  const response = await fetch(apiRoot + path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: 'no-store',
    credentials: 'same-origin',
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.message || `Request failed (${response.status})`);
  return result;
}

function Metric({ label, value, icon: Icon, note }: { label: string; value: string | number; icon: typeof Activity; note?: string }) {
  return <article className="group rounded-2xl border border-border bg-gradient-to-br from-surface to-elevated/60 p-4 transition duration-200 hover:border-accent-blue/30">
    <div className="flex items-center justify-between gap-3"><span className="grid h-9 w-9 place-items-center rounded-xl border border-accent-blue/15 bg-accent-blue/10 text-accent-blue"><Icon size={16} /></span><ArrowUpRight size={14} className="text-text-secondary/60 transition-transform duration-200 group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-accent-blue" /></div>
    <p className="mt-4 text-xs font-medium uppercase tracking-[.12em] text-text-secondary">{label}</p>
    <p className="mt-1 text-2xl font-semibold tracking-tight tabular-nums">{value}</p>
    {note && <p className="mt-1 text-xs text-text-secondary">{note}</p>}
  </article>;
}

export function UserSettingsPage() {
  const { theme, setThemePalette, setThemeMode } = useAppStore();
  const activePalette = themePalette(theme);
  const activeMode = themeMode(theme);
  const [account, setAccount] = useState<AccountSummary | null>(null);
  const [tab, setTab] = useState<ProfileTab>('profile');
  const [organizations, setOrganizations] = useState<ManagedOrganization[]>([]);
  const [selectedOrganizationId, setSelectedOrganizationId] = useState('');
  const [selectedAppId, setSelectedAppId] = useState('');
  const [loadingOrganizations, setLoadingOrganizations] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [organizationName, setOrganizationName] = useState('');
  const [firstAppName, setFirstAppName] = useState('');
  const [firstAdminEmail, setFirstAdminEmail] = useState('');
  const [firstAppLimit, setFirstAppLimit] = useState(20);
  const [newAppName, setNewAppName] = useState('');
  const [newAppAdminEmail, setNewAppAdminEmail] = useState('');
  const [newAppLimit, setNewAppLimit] = useState(20);
  const [appName, setAppName] = useState('');
  const [dailyRunLimit, setDailyRunLimit] = useState(20);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState('member');
  const [invitation, setInvitation] = useState<InvitationResult | null>(null);

  const isDeploymentAdmin = account?.accountType === 'super_admin';
  const isOrganizationAdmin = account?.accountType === 'organization' && account.role === 'owner';
  const canManageOrganization = isDeploymentAdmin || isOrganizationAdmin;
  const organizationAdminRoot = '/api/auth/organization-admin';

  const refreshOrganizations = useCallback(async () => {
    setLoadingOrganizations(true);
    try {
      const response = isOrganizationAdmin
        ? await adminRequest('', undefined, 'GET', organizationAdminRoot) as ManagedOrganization | null
        : await adminRequest('/organizations') as ManagedOrganization[];
      const result = Array.isArray(response) ? response : response ? [response] : [];
      setOrganizations(result);
      setSelectedOrganizationId(current => result.some(organization => organization.id === current) ? current : result[0]?.id || '');
      setSelectedAppId(current => result.some(organization => organization.apps.some(app => app.id === current)) ? current : result[0]?.apps[0]?.id || '');
      setError('');
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Could not load organizations.');
    } finally {
      setLoadingOrganizations(false);
    }
  }, [isOrganizationAdmin]);

  useEffect(() => {
    let active = true;
    void fetch('/api/auth/session', { credentials: 'same-origin', cache: 'no-store' })
      .then(async response => response.ok ? response.json() : null)
      .then(result => {
        if (!active) return;
        const user = result?.user || null;
        setAccount(user);
        if (user?.accountType === 'super_admin' || (user?.accountType === 'organization' && user.role === 'owner')) setTab('org-settings');
      })
      .catch(() => { if (active) setAccount(null); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (account?.accountType === 'super_admin' || (account?.accountType === 'organization' && account.role === 'owner')) void refreshOrganizations();
  }, [account, refreshOrganizations]);

  const selectedOrganization = organizations.find(organization => organization.id === selectedOrganizationId) || null;
  const selectedApp = selectedOrganization?.apps.find(app => app.id === selectedAppId) || null;

  useEffect(() => {
    if (!selectedApp) return;
    setAppName(selectedApp.name);
    setDailyRunLimit(selectedApp.dailyRunLimit);
    setInvitation(null);
  }, [selectedApp?.id, selectedApp?.name, selectedApp?.dailyRunLimit]);

  const createOrganization = (event: FormEvent) => {
    event.preventDefault();
    setBusy(true); setError(''); setNotice(''); setInvitation(null);
    void adminRequest('/organizations', { organizationName, name: firstAppName, adminEmail: firstAdminEmail, dailyRunLimit: firstAppLimit })
      .then(async (result: AdminCreateResult) => {
        setNotice(`Organization “${result.organization.name}” created with app “${result.project.name}”.`);
        setOrganizationName(''); setFirstAppName(''); setFirstAdminEmail('');
        await refreshOrganizations();
        setSelectedOrganizationId(result.organization.id); setSelectedAppId(result.project.id);
        if (result.invitation) setInvitation(result.invitation);
      })
      .catch(failure => setError(failure instanceof Error ? failure.message : 'Could not create this organization.'))
      .finally(() => setBusy(false));
  };

  const createApp = (event: FormEvent) => {
    event.preventDefault();
    if (!selectedOrganization) return;
    setBusy(true); setError(''); setNotice(''); setInvitation(null);
    void adminRequest(isOrganizationAdmin ? '/apps' : `/organizations/${encodeURIComponent(selectedOrganization.id)}/apps`, { name: newAppName, adminEmail: newAppAdminEmail, dailyRunLimit: newAppLimit }, 'POST', isOrganizationAdmin ? organizationAdminRoot : undefined)
      .then(async (result: AdminCreateResult) => {
        setNotice(`App “${result.project.name}” added to ${selectedOrganization.name}.`);
        setNewAppName(''); setNewAppAdminEmail('');
        await refreshOrganizations();
        setSelectedOrganizationId(selectedOrganization.id); setSelectedAppId(result.project.id);
        if (result.invitation) setInvitation(result.invitation);
      })
      .catch(failure => setError(failure instanceof Error ? failure.message : 'Could not create this app.'))
      .finally(() => setBusy(false));
  };

  const saveAppSettings = (event: FormEvent) => {
    event.preventDefault();
    if (!selectedOrganization || !selectedApp) return;
    setBusy(true); setError(''); setNotice('');
    void adminRequest(isOrganizationAdmin ? `/apps/${encodeURIComponent(selectedApp.id)}/settings` : `/organizations/${encodeURIComponent(selectedOrganization.id)}/apps/${encodeURIComponent(selectedApp.id)}/settings`, { name: appName, dailyRunLimit }, 'PATCH', isOrganizationAdmin ? organizationAdminRoot : undefined)
      .then(async () => { setNotice('App settings saved.'); await refreshOrganizations(); })
      .catch(failure => setError(failure instanceof Error ? failure.message : 'Could not save app settings.'))
      .finally(() => setBusy(false));
  };

  const inviteUser = (event: FormEvent) => {
    event.preventDefault();
    if (!selectedOrganization || !selectedApp) return;
    setBusy(true); setError(''); setNotice(''); setInvitation(null);
    void adminRequest(isOrganizationAdmin ? `/apps/${encodeURIComponent(selectedApp.id)}/invitations` : `/organizations/${encodeURIComponent(selectedOrganization.id)}/apps/${encodeURIComponent(selectedApp.id)}/invitations`, { email: inviteEmail, role: inviteRole }, 'POST', isOrganizationAdmin ? organizationAdminRoot : undefined)
      .then((result: InvitationResult) => { setInvitation(result); setInviteEmail(''); setNotice(`Invitation created for ${result.email}.`); return refreshOrganizations(); })
      .catch(failure => setError(failure instanceof Error ? failure.message : 'Could not invite this user.'))
      .finally(() => setBusy(false));
  };

  const profileTab = tab === 'org-settings' && canManageOrganization ? 'Organization settings' : 'Profile';
  const appUsagePercent = selectedApp ? Math.min(100, Math.round((selectedApp.runStats.today / Math.max(1, selectedApp.dailyRunLimit)) * 100)) : 0;

  return <div className="h-full overflow-y-auto p-4 text-text-primary md:p-8">
    <div className="mx-auto max-w-7xl space-y-6 pb-8">
      <header className="relative isolate overflow-hidden rounded-3xl border border-border bg-gradient-to-br from-surface via-surface to-accent-blue/10 p-5 md:p-7">
        <div aria-hidden="true" className="pointer-events-none absolute -right-16 -top-28 -z-10 h-72 w-72 rounded-full bg-accent-blue/10 blur-3xl" />
        <div className="flex flex-wrap items-center justify-between gap-5">
          <div className="flex min-w-0 items-center gap-4">
            <div className="min-w-0">
              <h1 className="text-xl font-semibold tracking-tight">{profileTab}</h1>
              <p className="mt-1 truncate text-sm leading-5 text-text-secondary">{account?.email || 'Account details and workspace preferences'}</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {canManageOrganization && <span className="hidden items-center gap-1.5 rounded-full border border-success/20 bg-success/5 px-3 py-1.5 text-xs font-medium text-success sm:inline-flex"><ShieldCheck size={14} />{isDeploymentAdmin ? 'Platform admin' : 'Organization Owner'}</span>}
            {canManageOrganization && <button type="button" className={quietButtonClass + ' bg-surface/70 backdrop-blur'} onClick={() => void refreshOrganizations()} disabled={loadingOrganizations}><RefreshCw size={15} className={loadingOrganizations ? 'animate-spin' : ''} />Refresh</button>}
          </div>
        </div>
      </header>

      {canManageOrganization && <nav aria-label="Profile settings" className="inline-flex max-w-full items-center gap-1 rounded-2xl border border-border bg-surface/80 p-1.5 backdrop-blur" role="tablist">
        {[{ id: 'profile' as const, label: 'Profile', icon: CircleUserRound }, { id: 'org-settings' as const, label: 'Organization settings', icon: Building2 }].map(item => <button key={item.id} id={`profile-tab-${item.id}`} role="tab" aria-selected={tab === item.id} aria-controls={`profile-panel-${item.id}`} onClick={() => { setTab(item.id); setError(''); setNotice(''); }} className={'inline-flex min-h-10 items-center gap-2 rounded-xl px-3 py-2 text-sm transition duration-200 ' + (tab === item.id ? 'bg-accent-blue/10 font-semibold text-accent-blue ring-1 ring-inset ring-accent-blue/15' : 'text-text-secondary hover:bg-elevated hover:text-text-primary')}><item.icon size={16} />{item.label}</button>)}
      </nav>}

      {error && <p role="alert" className="flex items-start gap-2 rounded-2xl border border-danger/25 bg-danger/5 px-4 py-3 text-sm text-danger"><ShieldCheck size={16} className="mt-0.5 shrink-0" />{error}</p>}
      {notice && <p role="status" className="flex items-start gap-2 rounded-2xl border border-success/25 bg-success/5 px-4 py-3 text-sm text-success"><Check size={16} className="mt-0.5 shrink-0" />{notice}</p>}

      {(!canManageOrganization || tab === 'profile') && <div className="grid gap-5 xl:grid-cols-[.9fr_1.1fr]" role={canManageOrganization ? 'tabpanel' : undefined} id={canManageOrganization ? 'profile-panel-profile' : undefined} aria-labelledby={canManageOrganization ? 'profile-tab-profile' : undefined}>
        <section className="relative isolate overflow-hidden rounded-3xl border border-border bg-gradient-to-br from-surface via-surface to-accent-purple/10 p-5 md:p-6">
          <div aria-hidden="true" className="pointer-events-none absolute -bottom-24 -right-20 -z-10 h-64 w-64 rounded-full bg-accent-purple/10 blur-3xl" />
          <div className="flex items-start justify-between gap-4"><div><p className="text-[11px] font-semibold uppercase tracking-[.16em] text-accent-blue">Identity</p><h2 className="mt-1 text-xl font-semibold tracking-tight">Your account</h2><p className="mt-1 text-sm text-text-secondary">The account you use across your workspaces.</p></div><span className="grid h-10 w-10 place-items-center rounded-xl border border-border bg-elevated/80 text-text-secondary"><KeyRound size={17} /></span></div>
          {account ? <div className="mt-7 rounded-2xl border border-border/80 bg-canvas/55 p-4 backdrop-blur-sm">
            <div className="flex min-w-0 items-center gap-3"><span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-accent-blue/15 text-sm font-semibold text-accent-blue">{account.email.split('@')[0].slice(0, 2).toUpperCase()}</span><div className="min-w-0"><p className="truncate text-sm font-semibold">{account.email}</p><p className="mt-0.5 text-xs text-text-secondary">Signed in</p></div><span className="ml-auto hidden shrink-0 rounded-full border border-success/20 bg-success/5 px-2.5 py-1 text-[11px] font-medium text-success sm:inline-flex">Active</span></div>
            <dl className="mt-4 grid gap-3 border-t border-border/80 pt-4 sm:grid-cols-2"><div><dt className="text-[11px] font-medium uppercase tracking-wider text-text-secondary">Access role</dt><dd className="mt-1 inline-flex items-center gap-1.5 text-sm font-medium capitalize"><ShieldCheck size={14} className="text-accent-blue" />{account.role.replaceAll('_', ' ')}</dd></div><div><dt className="text-[11px] font-medium uppercase tracking-wider text-text-secondary">Account type</dt><dd className="mt-1 text-sm font-medium">{account.accountType === 'super_admin' ? 'Platform account' : 'Organization account'}</dd></div></dl>
          </div> : <div className="mt-7 rounded-2xl border border-dashed border-border p-5 text-sm text-text-secondary">Account details are unavailable for this session.</div>}
          <p className="mt-4 text-xs leading-5 text-text-secondary">Your app memberships and permissions are managed by each app Owner.</p>
        </section>
        <section className="rounded-3xl border border-border bg-surface p-5 md:p-6">
          <div className="flex items-start justify-between gap-4"><div><p className="text-[11px] font-semibold uppercase tracking-[.16em] text-accent-blue">Workspace appearance</p><h2 className="mt-1 text-xl font-semibold tracking-tight">Choose your theme</h2><p className="mt-1 text-sm text-text-secondary">Saved on this device and applied across your workspace.</p></div><span className="grid h-10 w-10 place-items-center rounded-xl border border-border bg-elevated/80 text-text-secondary"><Sparkles size={17} /></span></div>
          <div className="mt-6 inline-flex items-center gap-1 rounded-xl border border-border bg-canvas/45 p-1" role="group" aria-label="Choose a mode">{modeOptions.map(option => <button key={option.id} type="button" aria-pressed={activeMode === option.id} onClick={() => setThemeMode(option.id)} className={'inline-flex min-h-9 items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-medium transition duration-200 ' + (activeMode === option.id ? 'bg-accent-blue/15 text-accent-blue' : 'text-text-secondary hover:bg-elevated hover:text-text-primary')}><option.icon size={15} />{option.name}</button>)}</div>
          <div className="mt-4 grid gap-3 sm:grid-cols-3" role="group" aria-label="Choose a palette">{paletteOptions.map(option => <button key={option.id} type="button" aria-pressed={activePalette === option.id} onClick={() => setThemePalette(option.id)} className={'group relative min-h-32 rounded-2xl border p-4 text-left transition duration-200 hover:border-accent-blue/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-blue focus-visible:ring-offset-2 focus-visible:ring-offset-surface ' + (activePalette === option.id ? 'border-accent-blue/50 bg-accent-blue/5 ring-1 ring-inset ring-accent-blue/20' : 'border-border bg-canvas/45')}>
            <span className={'mb-5 grid h-9 w-9 place-items-center rounded-xl ' + (activePalette === option.id ? 'bg-accent-blue/15 text-accent-blue' : 'bg-elevated text-text-secondary')}><option.icon size={17} /></span><span className="block text-sm font-semibold">{option.name}</span><span className="mt-1 block text-xs leading-5 text-text-secondary">{option.description}</span>{activePalette === option.id && <span className="absolute right-3 top-3 grid h-5 w-5 place-items-center rounded-full bg-accent-blue text-white"><Check size={12} /></span>}
          </button>)}</div>
        </section>
      </div>}

      {canManageOrganization && tab === 'org-settings' && <div role="tabpanel" id="profile-panel-org-settings" aria-labelledby="profile-tab-org-settings" className="space-y-6">
        <section className="flex flex-wrap items-end justify-between gap-4"><div><h2 className="text-xl font-semibold tracking-tight">Apps, people & usage</h2><p className="mt-1 max-w-2xl text-sm text-text-secondary">Choose an app to manage access, daily run limits, and usage at a glance.</p></div>{selectedOrganization && <div className="inline-flex items-center gap-2 rounded-full border border-border bg-surface px-3 py-1.5 text-xs text-text-secondary"><Building2 size={14} className="text-accent-blue" />{selectedOrganization.name}</div>}</section>

        {isDeploymentAdmin && <section className="rounded-3xl border border-border bg-surface p-5 md:p-6">
          <div className="mb-5 flex items-start gap-3"><span className="grid h-10 w-10 place-items-center rounded-xl bg-accent-purple/10 text-accent-purple"><Plus size={17} /></span><div><h3 className="font-semibold">Create an organization</h3><p className="mt-1 text-sm text-text-secondary">Start with its first app and Owner account.</p></div></div>
          <form onSubmit={createOrganization} className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5 xl:items-end">
            <label className="text-sm">Organization name<input required maxLength={100} className={inputClass + ' mt-1'} value={organizationName} onChange={event => setOrganizationName(event.target.value)} placeholder="Acme" /></label>
            <label className="text-sm">First app name<input required maxLength={100} className={inputClass + ' mt-1'} value={firstAppName} onChange={event => setFirstAppName(event.target.value)} placeholder="Customer portal" /></label>
            <label className="text-sm">First app Owner<input required type="email" maxLength={254} className={inputClass + ' mt-1'} value={firstAdminEmail} onChange={event => setFirstAdminEmail(event.target.value)} placeholder="owner@example.com" /></label>
            <label className="text-sm">Daily run limit<input required type="number" min={1} max={100} className={inputClass + ' mt-1'} value={firstAppLimit} onChange={event => setFirstAppLimit(Number(event.target.value))} /></label>
            <button className={buttonClass} disabled={busy}><Plus size={15} />{busy ? 'Creating…' : 'Create organization'}</button>
          </form>
        </section>}

        {loadingOrganizations && !organizations.length ? <div className="grid gap-4 md:grid-cols-2"><div className="motion-safe:animate-pulse h-36 rounded-3xl border border-border bg-surface" /><div className="motion-safe:animate-pulse h-36 rounded-3xl border border-border bg-surface" /></div> : organizations.length === 0 ? <section className="rounded-3xl border border-dashed border-border bg-surface px-6 py-14 text-center"><span className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-accent-blue/10 text-accent-blue"><Building2 size={21} /></span><h3 className="mt-4 font-semibold">No organizations yet</h3><p className="mt-1 text-sm text-text-secondary">Create an organization above to get started.</p></section> : <>
          <div className={isDeploymentAdmin ? 'grid gap-5 xl:grid-cols-[minmax(220px,.68fr)_minmax(0,1.32fr)]' : 'grid gap-5'}>
            {isDeploymentAdmin && <section className="h-fit rounded-3xl border border-border bg-surface p-4">
              <div className="mb-3 flex items-center justify-between px-1"><div><p className="text-[11px] font-semibold uppercase tracking-[.14em] text-text-secondary">Directory</p><h3 className="mt-1 text-sm font-semibold">Organizations</h3></div><span className="rounded-full bg-elevated px-2.5 py-1 text-xs tabular-nums text-text-secondary">{organizations.length}</span></div>
              <div className="space-y-1">{organizations.map(organization => <button key={organization.id} type="button" onClick={() => { setSelectedOrganizationId(organization.id); setSelectedAppId(organization.apps[0]?.id || ''); setError(''); setNotice(''); }} aria-current={organization.id === selectedOrganizationId ? 'true' : undefined} className={'flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2.5 text-left text-sm transition-colors ' + (organization.id === selectedOrganizationId ? 'bg-accent-blue/10 text-accent-blue' : 'text-text-secondary hover:bg-elevated hover:text-text-primary')}><span className="min-w-0 truncate font-medium">{organization.name}</span><span className="shrink-0 text-xs">{organization.appCount} {organization.appCount === 1 ? 'app' : 'apps'}</span></button>)}</div>
            </section>}

            {selectedOrganization && <div className="min-w-0 space-y-5">
              <section className="relative isolate overflow-hidden rounded-3xl border border-border bg-gradient-to-br from-surface via-surface to-accent-blue/5 p-5 md:p-6">
                <div aria-hidden="true" className="pointer-events-none absolute -right-16 -top-20 -z-10 h-56 w-56 rounded-full bg-accent-blue/10 blur-3xl" />
                <div className="flex flex-wrap items-center justify-between gap-4"><div className="flex items-center gap-3"><span className="grid h-11 w-11 place-items-center rounded-2xl border border-accent-blue/20 bg-accent-blue/10 text-accent-blue"><Building2 size={19} /></span><div><p className="text-[11px] font-semibold uppercase tracking-[.14em] text-text-secondary">Organization</p><h3 className="mt-0.5 text-xl font-semibold tracking-tight">{selectedOrganization.name}</h3></div></div><div className="flex items-center gap-2"><span className="rounded-full border border-border bg-canvas/70 px-3 py-1.5 text-xs text-text-secondary">{selectedOrganization.appCount} {selectedOrganization.appCount === 1 ? 'app' : 'apps'}</span><span className="rounded-full border border-border bg-canvas/70 px-3 py-1.5 text-xs text-text-secondary">{selectedOrganization.memberCount} memberships</span></div></div>
                <div className="mt-5 border-t border-border/80 pt-4"><div className="mb-3 flex items-center justify-between gap-3"><h4 className="text-sm font-semibold">Apps</h4><span className="text-xs text-text-secondary">Select an app to view its settings</span></div><div className="grid gap-2 sm:grid-cols-2 2xl:grid-cols-3">{selectedOrganization.apps.map(app => <button key={app.id} type="button" aria-pressed={app.id === selectedAppId} onClick={() => { setSelectedAppId(app.id); setError(''); setNotice(''); }} className={'group flex min-w-0 items-center gap-3 rounded-2xl border p-3 text-left transition duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-blue ' + (app.id === selectedAppId ? 'border-accent-blue/45 bg-accent-blue/5 ring-1 ring-inset ring-accent-blue/15' : 'border-border bg-canvas/50 hover:border-accent-blue/30')}><span className={'grid h-10 w-10 shrink-0 place-items-center rounded-xl ' + (app.id === selectedAppId ? 'bg-accent-blue/15 text-accent-blue' : 'bg-elevated text-text-secondary')}><Building2 size={17} /></span><span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold">{app.name}</span><span className="mt-1 flex items-center gap-1.5 text-xs text-text-secondary"><span className={'h-1.5 w-1.5 rounded-full ' + (app.paused ? 'bg-warning' : 'bg-success')} />{app.paused ? 'Paused' : 'Active'}<span aria-hidden="true">·</span><span className="capitalize">{app.environment}</span></span></span>{app.id === selectedAppId && <Check size={16} className="shrink-0 text-accent-blue" />}</button>)}</div></div>
              </section>

              <section className="rounded-3xl border border-border bg-surface p-5 md:p-6">
                <div className="mb-5 flex items-start gap-3"><span className="grid h-10 w-10 place-items-center rounded-xl border border-accent-purple/20 bg-accent-purple/10 text-accent-purple"><Plus size={17} /></span><div><h4 className="font-semibold">Add an app</h4><p className="mt-1 text-sm text-text-secondary">Choose a name, run allowance, and first app Owner.</p></div></div>
                <form onSubmit={createApp} className="grid gap-3 sm:grid-cols-2 xl:grid-cols-[1.1fr_1.1fr_.7fr_auto] xl:items-end">
                  <label className="text-sm font-medium">App name<input required maxLength={100} className={inputClass + ' mt-1.5'} value={newAppName} onChange={event => setNewAppName(event.target.value)} placeholder="Internal dashboard" /></label>
                  <label className="text-sm font-medium">First app Owner email<span className="relative mt-1.5 block"><Mail size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-secondary" /><input required type="email" maxLength={254} className={inputClass + ' pl-9'} value={newAppAdminEmail} onChange={event => setNewAppAdminEmail(event.target.value)} placeholder="owner@example.com" /></span></label>
                  <label className="text-sm font-medium">Daily run limit<input required type="number" min={1} max={100} className={inputClass + ' mt-1.5'} value={newAppLimit} onChange={event => setNewAppLimit(Number(event.target.value))} /></label>
                  <button className={buttonClass + ' min-w-28'} disabled={busy}><Plus size={15} />{busy ? 'Adding…' : 'Add app'}</button>
                </form>
              </section>
            </div>}
          </div>

          {selectedApp && <>
            <section className="grid gap-4 xl:grid-cols-[1.15fr_1.85fr]" aria-label={`Usage for ${selectedApp.name}`}>
              <article className="rounded-3xl border border-border bg-gradient-to-br from-surface to-accent-blue/5 p-5 md:p-6">
                <div className="flex items-start justify-between gap-4"><div><p className="text-[11px] font-semibold uppercase tracking-[.14em] text-text-secondary">Daily run usage</p><h3 className="mt-1 text-lg font-semibold">{selectedApp.name}</h3></div><span className="grid h-9 w-9 place-items-center rounded-xl bg-accent-blue/10 text-accent-blue"><Gauge size={17} /></span></div>
                <div className="mt-5 flex items-baseline gap-2"><span className="text-4xl font-semibold tracking-tight tabular-nums">{selectedApp.runStats.today}</span><span className="text-sm text-text-secondary">of {selectedApp.dailyRunLimit} runs</span><span className="ml-auto text-sm font-semibold tabular-nums text-accent-blue">{appUsagePercent}%</span></div>
                <div className="mt-3 h-2 overflow-hidden rounded-full bg-elevated" role="progressbar" aria-label="Daily run limit used" aria-valuemin={0} aria-valuemax={selectedApp.dailyRunLimit} aria-valuenow={Math.min(selectedApp.runStats.today, selectedApp.dailyRunLimit)}><div className="h-full origin-left rounded-full bg-gradient-to-r from-accent-blue to-accent-purple transition-transform duration-500 motion-reduce:transition-none" style={{ transform: `scaleX(${appUsagePercent / 100})` }} /></div>
                <div className="mt-2 flex items-center justify-between text-xs text-text-secondary"><span>{Math.max(0, selectedApp.dailyRunLimit - selectedApp.runStats.today)} runs remaining</span><span>Resets at 00:00 UTC</span></div>
              </article>
              <div className="grid gap-3 sm:grid-cols-3">
                <Metric label="Total runs" value={selectedApp.runStats.total} icon={Activity} note="All time" />
                <Metric label="Passed runs" value={selectedApp.runStats.passed} icon={ShieldCheck} note="All time" />
                <Metric label="Active users" value={selectedApp.memberCount} icon={Users} note="App members" />
              </div>
            </section>
            <div className="grid gap-5 xl:grid-cols-2">
              <form onSubmit={saveAppSettings} className="space-y-5 rounded-3xl border border-border bg-surface p-5 md:p-6">
                <div className="flex items-start gap-3"><span className="grid h-10 w-10 place-items-center rounded-xl border border-accent-blue/15 bg-accent-blue/10 text-accent-blue"><Gauge size={17} /></span><div><p className="text-[11px] font-semibold uppercase tracking-[.14em] text-text-secondary">Configuration</p><h3 className="mt-0.5 font-semibold">App settings</h3><p className="mt-1 text-sm text-text-secondary">Tune the app name and its daily run allowance.</p></div></div>
                <label className="block text-sm font-medium">App name<input required maxLength={100} className={inputClass + ' mt-1.5'} value={appName} onChange={event => setAppName(event.target.value)} /></label>
                <label className="block text-sm font-medium">Daily run limit<span className="relative mt-1.5 block"><Gauge size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-secondary" /><input required type="number" min={1} max={100} className={inputClass + ' pl-9'} value={dailyRunLimit} onChange={event => setDailyRunLimit(Number(event.target.value))} /></span><span className="mt-1.5 block text-xs font-normal leading-5 text-text-secondary">Runs above this limit are blocked until the next UTC day.</span></label>
                <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4"><span className="text-xs text-text-secondary">Applies to {selectedApp.name}</span><button className={buttonClass} disabled={busy || (appName === selectedApp.name && dailyRunLimit === selectedApp.dailyRunLimit)}>{busy ? 'Saving…' : 'Save changes'}</button></div>
              </form>

              <section className="space-y-5 rounded-3xl border border-border bg-surface p-5 md:p-6">
                <div className="flex items-start gap-3"><span className="grid h-10 w-10 place-items-center rounded-xl border border-accent-purple/20 bg-accent-purple/10 text-accent-purple"><Users size={17} /></span><div><p className="text-[11px] font-semibold uppercase tracking-[.14em] text-text-secondary">Access</p><h3 className="mt-0.5 font-semibold">People in {selectedApp.name}</h3><p className="mt-1 text-sm text-text-secondary">Invite a new or existing account to this app.</p></div></div>
                <form onSubmit={inviteUser} className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_140px_auto] sm:items-end">
                  <label className="text-sm font-medium">Email<input required type="email" maxLength={254} className={inputClass + ' mt-1.5'} value={inviteEmail} onChange={event => setInviteEmail(event.target.value)} placeholder="teammate@example.com" /></label>
                  <label className="text-sm font-medium">Role<select className={inputClass + ' mt-1.5'} value={inviteRole} onChange={event => setInviteRole(event.target.value)}><option value="owner">Owner</option><option value="admin">Admin</option><option value="member">Member</option></select></label>
                  <button className={buttonClass} disabled={busy}><Mail size={15} />{busy ? 'Inviting…' : 'Invite user'}</button>
                </form>
                {invitation && <div role="status" className="rounded-2xl border border-success/20 bg-success/5 p-3.5 text-sm"><div className="flex items-start gap-2"><Check size={16} className="mt-0.5 shrink-0 text-success" /><div><p className="font-medium">{invitation.delivery === 'email_sent' ? `Invitation sent to ${invitation.email}` : `Invitation created for ${invitation.email}`}</p><p className="mt-1 text-xs leading-5 text-text-secondary">Expires {new Date(invitation.expiresAt).toLocaleDateString()}.{invitation.inviteUrl ? ' Email delivery is unavailable; share the link below.' : ''}</p>{invitation.inviteUrl && <p className="mt-2 break-all rounded-lg bg-canvas/70 p-2 font-mono text-xs text-text-secondary">{invitation.inviteUrl}</p>}</div></div></div>}
                <div className="overflow-hidden rounded-2xl border border-border">
                  <div className="flex items-center justify-between bg-canvas/55 px-4 py-3"><div><h4 className="text-sm font-semibold">App members</h4><p className="mt-0.5 text-xs text-text-secondary">Access is assigned separately for each app.</p></div><span className="rounded-full bg-elevated px-2.5 py-1 text-xs tabular-nums text-text-secondary">{selectedApp.memberCount}</span></div>
                  {selectedApp.members.length > 0 ? <div className="divide-y divide-border">{selectedApp.members.map(member => <div key={member.id} className="flex min-w-0 items-center gap-3 px-4 py-3 text-sm transition-colors hover:bg-elevated/40"><span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-elevated text-xs font-semibold text-text-secondary">{member.email.split('@')[0].slice(0, 2).toUpperCase()}</span><span className="min-w-0 flex-1 truncate font-medium">{member.email}</span><span className="shrink-0 rounded-full border border-border bg-canvas/70 px-2.5 py-1 text-[11px] font-medium capitalize text-text-secondary">{member.role}</span></div>)}</div> : <p className="px-4 py-8 text-center text-sm text-text-secondary">No members have joined this app yet.</p>}
                </div>
              </section>
            </div>
          </>}
        </>}
      </div>}
    </div>
  </div>;
}
