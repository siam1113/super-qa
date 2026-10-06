'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { KeyRound, ShieldCheck, Settings2 } from 'lucide-react';
import { ProjectSettings, ScopedError, scopedRequest } from '@/lib/autonomy';

const inputClass = 'ui-field w-full px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent-blue';
const buttonClass = 'ui-button-secondary text-sm font-medium disabled:opacity-40 disabled:cursor-not-allowed';
const primaryClass = 'ui-button-primary text-sm font-medium disabled:opacity-40 disabled:cursor-not-allowed';
const panelClass = 'rounded-xl border border-border bg-surface p-5 space-y-4';
const credentialScopeLabels: Record<string, string> = { owner: 'Owner', admin: 'Admin', member: 'Member', ci: 'CI automation', runner: 'Worker runner' };
const credentialScopeLabel = (scope: string) => credentialScopeLabels[scope] || scope;

export function SettingsPage({ embedded = false }: { embedded?: boolean }) {
  const [credential, setCredential] = useState('');
  const [settings, setSettings] = useState<ProjectSettings | null>(null);
  const [tab, setTab] = useState('project');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [name, setName] = useState('');
  const [quota, setQuota] = useState(20);
  const [label, setLabel] = useState('');
  const [role, setRole] = useState('member');
  const [days, setDays] = useState(7);
  const [issued, setIssued] = useState('');
  const [members, setMembers] = useState<Array<{ id: string; email: string; role: string; createdAt: string }>>([]);
  const [invitations, setInvitations] = useState<Array<{ id: string; email: string; role: string; expiresAt: string; acceptedAt: string | null; revokedAt: string | null }>>([]);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState('member');
  const [inviteLink, setInviteLink] = useState('');
  const [pauseConfirmed, setPauseConfirmed] = useState(false);
  const key = useRef('');
  const lifetime = useRef(new AbortController());

  const disconnect = useCallback(() => {
    lifetime.current.abort(); lifetime.current = new AbortController(); key.current = '';
    setCredential(''); setSettings(null); setIssued('');
    setPauseConfirmed(false); setMembers([]); setInvitations([]); setInviteLink('');
    setName(''); setLabel(''); setNotice(''); setBusy(false); setTab('project'); setRole('member'); setDays(7); setQuota(20);
  }, []);

  useEffect(() => {
    lifetime.current = new AbortController();
    return () => { lifetime.current.abort(); key.current = ''; };
  }, []);

  const request = useCallback(<Value,>(path: string, body?: unknown) => scopedRequest<Value>(key.current, path, body, lifetime.current.signal), []);
  const authRequest = useCallback(async <Value,>(path: string, body?: unknown): Promise<Value> => {
    const response = await fetch('/api/auth' + path, { method: body === undefined ? 'GET' : 'POST', headers: { ...(key.current ? { Authorization: 'Bearer ' + key.current } : {}), 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body), credentials: 'same-origin', cache: 'no-store', signal: lifetime.current.signal });
    if (!response.ok) throw new ScopedError(response.status);
    return response.json();
  }, []);

  const refresh = useCallback(async () => {
    const activeKey = key.current;
    const signal = lifetime.current.signal;
    const configuration = await request<ProjectSettings>('/settings');
    if (signal.aborted || key.current !== activeKey) return;
    setSettings(configuration); setName(configuration.project.name); setQuota(configuration.project.dailyRunLimit);
    if (configuration.identity.role === 'owner') {
      const [memberList, invitationList] = await Promise.all([authRequest<Array<{ id: string; email: string; role: string; createdAt: string }>>('/members'), authRequest<typeof invitations>('/invitations')]);
      if (!signal.aborted && key.current === activeKey) { setMembers(memberList); setInvitations(invitationList); }
    }
  }, [request, authRequest]);

  useEffect(() => {
    void refresh().catch(() => {});
  }, [refresh]);

  const action = async (operation: () => Promise<void>) => {
    const signal = lifetime.current.signal;
    setBusy(true); setError(''); setNotice('');
    try { await operation(); }
    catch (failure) {
      if (!signal.aborted) {
        if (failure instanceof ScopedError && failure.status === 401) disconnect();
        setError(failure instanceof ScopedError ? failure.message : 'Operation failed. Check the input and connection; no success is assumed.');
      }
    } finally { if (!signal.aborted) setBusy(false); }
  };

  const owner = settings?.identity.role === 'owner';
  const canManageApp = owner || settings?.identity.role === 'admin';

  return <div className="h-full overflow-y-auto text-text-primary">
    <div className="mx-auto w-full max-w-[1440px] space-y-6">
      {!embedded && <header className="flex flex-wrap items-start justify-between gap-4">
        <div><h1 className="text-xl font-semibold">App settings</h1><p className="mt-1 text-sm leading-5 text-text-secondary">Manage app policy, credentials, and team access.</p></div>
      </header>}
      {error && <div role="alert" className="rounded-lg border border-danger/30 bg-danger/10 p-3 text-sm text-danger">{error}</div>}
      {notice && <div role="status" className="rounded-lg bg-success/10 p-3 text-sm text-success">{notice}</div>}
      {!settings ? <section className={panelClass + ' max-w-xl'}>
        <ShieldCheck className="text-accent-blue" size={28} /><h2 className="text-lg font-medium">Connect an app</h2>
        <p className="text-sm text-text-secondary">Use an Owner, Admin, Member, CI automation, or worker credential for this app. Your key stays in memory and is cleared when you disconnect or reload. Never enter platform super-admin credentials here.</p>
        <form className="space-y-4" onSubmit={event => { event.preventDefault(); void action(async () => {
          if (location.protocol !== 'https:' && !['localhost', '127.0.0.1', '[::1]'].includes(location.hostname)) throw new Error('HTTPS required');
          if (!/^sq_[a-f0-9]{64}$/.test(credential)) throw new Error('Invalid key');
          lifetime.current = new AbortController(); key.current = credential;
          await refresh(); setCredential('');
        }); }}>
          <label className="block text-sm">App credential<input suppressHydrationWarning autoComplete="off" type="password" required className={inputClass + ' mt-2 font-mono'} value={credential} onChange={event => setCredential(event.target.value)} /></label>
          <button className={primaryClass} disabled={busy}>{busy ? 'Connecting…' : 'Connect app'}</button>
        </form>
        <p className="text-xs text-text-secondary">Already invited? <a className="underline" href="/login">Sign in</a>. Enrollment and deployment policies remain administrator-managed.</p>
      </section> : <div className="flex min-h-0 flex-col gap-5 lg:flex-row lg:items-start">
        <nav aria-label="App settings sections" className="flex w-36 shrink-0 flex-col gap-1 border-r border-border/70 px-3 py-5 md:w-44 md:px-4 md:py-6">
          {[{ id: 'project', title: 'App', icon: Settings2 }, { id: 'access', title: 'Access', icon: KeyRound }].map(item => <button key={item.id} type="button" onClick={() => setTab(item.id)} aria-current={tab === item.id ? 'page' : undefined} className={'inline-flex min-h-10 items-center gap-2 rounded-lg px-3 text-left text-sm font-medium transition-colors ' + (tab === item.id ? 'bg-accent-blue/10 text-accent-blue' : 'text-text-secondary hover:bg-elevated hover:text-text-primary')}><item.icon size={15} className="shrink-0" />{item.title}</button>)}
        </nav>
        <div className="min-w-0 flex-1 space-y-6 py-7 pl-3 pr-5 md:py-8 md:pl-4 md:pr-8">
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-surface p-4 text-sm">
          <span className="font-medium">{settings.project.name}</span><span className="text-text-secondary">{settings.project.environment} / {credentialScopeLabel(settings.identity.role)}</span>
          <span className={'rounded-full px-2 py-1 text-xs ' + (settings.project.paused ? 'bg-warning/10 text-warning' : 'bg-success/10 text-success')}>{settings.project.paused ? 'Execution paused' : 'Execution enabled'}</span>
          <span className="ml-auto text-xs text-text-secondary">Key expires {new Date(settings.identity.expiresAt).toLocaleString()}</span>
        </div>
        {tab === 'project' && <div className="grid gap-6 lg:grid-cols-2">
          <section className={panelClass}><h2 className="text-lg font-medium">App policy</h2>
            <form className="space-y-4" onSubmit={event => { event.preventDefault(); void action(async () => { await request('/settings', { name, dailyRunLimit: quota }); await refresh(); setNotice('App settings saved.'); }); }}>
              <label className="block text-sm">App name<input className={inputClass + ' mt-1'} required maxLength={100} value={name} disabled={!canManageApp} onChange={event => setName(event.target.value)} /></label>
              <label className="block text-sm">Daily run limit<input className={inputClass + ' mt-1'} type="number" min={1} max={100} required value={quota} disabled={!canManageApp} onChange={event => setQuota(Number(event.target.value))} /></label>
              <p className="text-xs text-text-secondary">UTC-day admission limit for autonomous runs.</p>
              <button className={primaryClass} disabled={busy || !canManageApp}>Save app settings</button>
              {!canManageApp && <p className="text-xs text-text-secondary">An app Admin or Owner can change these settings.</p>}
            </form>
          </section>
          <section className={panelClass}><h2 className="text-lg font-medium">Deployment scope · read only</h2><dl className="space-y-2 text-sm"><dt className="text-text-secondary">App ID</dt><dd className="break-all font-mono text-xs">{settings.project.id}</dd><dt className="text-text-secondary">Workspace / application</dt><dd>{settings.project.workspaceId} / {settings.project.applicationId}</dd><dt className="text-text-secondary">Approved origins</dt><dd className="break-all">{settings.project.origins.join(', ') || 'None'}</dd><dt className="text-text-secondary">Requirement catalog</dt><dd>{settings.project.requirements.join(', ')}</dd></dl><p className="text-xs text-text-secondary">Origins, scopes, worker credentials and live-profile registration require deployment administration. They cannot be widened here.</p></section>
          {canManageApp && <section className={panelClass + ' lg:col-span-2 border-warning/30'}><h2 className="font-medium">Execution safety</h2><p className="text-sm text-text-secondary">Pausing cancels active runs. An in-flight request may finish; live data cleanup still runs. Resuming does not replay cancelled work.</p>
            {!settings.project.paused && <label className="flex gap-2 text-sm"><input type="checkbox" checked={pauseConfirmed} onChange={event => setPauseConfirmed(event.target.checked)} />I understand active runs will be cancelled.</label>}
            <button className={buttonClass} disabled={busy || (!settings.project.paused && !pauseConfirmed)} onClick={() => void action(async () => { await request('/pause', { paused: !settings.project.paused }); setPauseConfirmed(false); await refresh(); })}>{settings.project.paused ? 'Resume app execution' : 'Pause app execution'}</button>
          </section>}
        </div>}
        {tab === 'access' && <section className={panelClass}><h2 className="text-lg font-medium">App credentials</h2><p className="text-sm text-text-secondary">Keys are scoped, expiring and individually revocable. Only owners can list or manage them.</p>
          {owner ? <><form className="grid gap-3 md:grid-cols-4" onSubmit={event => { event.preventDefault(); void action(async () => { const result = await request<{ secret: string }>('/keys', { role, label, days }); setIssued(result.secret); await refresh(); setLabel(''); }); }}>
            <label className="text-sm">User email or key label<input className={inputClass} required maxLength={100} value={label} placeholder="teammate@company.com" onChange={event => setLabel(event.target.value)} /></label>
            <label className="text-sm">Credential scope<select aria-label="Credential scope" className={inputClass} value={role} onChange={event => setRole(event.target.value)}><option value="member">Member access</option><option value="admin">Admin access</option><option value="owner">Owner access</option><option value="ci">CI automation</option><option value="runner">Worker runner</option></select></label>
            <label className="text-sm">Valid for days<input className={inputClass} type="number" required min={1} max={90} value={days} onChange={event => setDays(Number(event.target.value))} /></label>
            <button className={primaryClass + ' self-end'} disabled={busy}>Issue credential</button>
          </form>
          {issued && <div className="space-y-2 rounded-lg border border-warning/30 p-3"><p className="text-sm">One-time secret: save it in your secret manager. It cannot be retrieved later.</p><label className="block text-sm">New credential<input className={inputClass + ' font-mono'} type="password" readOnly value={issued} autoComplete="off" /></label><button className={buttonClass} onClick={() => void action(async () => { await navigator.clipboard.writeText(issued); setNotice('Credential copied. Store it securely.'); })}>Copy new credential</button><button className={buttonClass + ' ml-2'} onClick={() => setIssued('')}>Dismiss secret</button></div>}
          <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr className="border-b border-border"><th className="py-3">Label</th><th>Credential scope</th><th>Expires</th><th>Status</th><th>Action</th></tr></thead><tbody>{settings.credentials.map(item => <tr key={item.id} className="border-b border-border"><td className="py-3">{item.label}{item.id === settings.identity.id && ' (current)'}</td><td>{credentialScopeLabel(item.role)}</td><td>{new Date(item.expiresAt).toLocaleDateString()}</td><td>{item.revoked ? 'Revoked' : Date.parse(item.expiresAt) <= Date.now() ? 'Expired' : 'Active'}</td><td><button className={buttonClass} disabled={busy || item.revoked || item.id === settings.identity.id} onClick={() => void action(async () => { await request(`/keys/${item.id}/revoke`, {}); await refresh(); })}>Revoke {item.label}</button></td></tr>)}</tbody></table></div></> : <p>Your {credentialScopeLabel(settings.identity.role)} access does not expose the credential inventory.</p>}
          {owner && <div className="space-y-4 border-t border-border pt-5">
            <div><h3 className="font-medium">App members</h3><p className="text-sm text-text-secondary">Invite teammates by email. They set their own password; revoke access here at any time.</p></div>
            <form className="grid gap-3 md:grid-cols-3" onSubmit={event => { event.preventDefault(); void action(async () => { const result = await authRequest<{ delivery: string; inviteUrl?: string }>('/invitations', { email: inviteEmail, role: inviteRole }); setInviteLink(result.inviteUrl || ''); setInviteEmail(''); await refresh(); setNotice(result.delivery === 'email_sent' ? 'Invitation email sent.' : 'Invitation created. Copy the development link below.'); }); }}>
              <label className="text-sm">Teammate email<input type="email" className={inputClass} required value={inviteEmail} onChange={event => setInviteEmail(event.target.value)} placeholder="teammate@company.com" /></label>
              <label className="text-sm">Role<select className={inputClass} value={inviteRole} onChange={event => setInviteRole(event.target.value)}><option value="owner">Owner</option><option value="admin">Admin</option><option value="member">Member</option></select></label>
              <button className={primaryClass + ' self-end'} disabled={busy}>Send invitation</button>
            </form>
            {inviteLink && <div className="space-y-2 rounded-lg border border-warning/30 p-3"><p className="text-sm">Email delivery was unavailable. Share this one-use invite link securely.</p><input className={inputClass + ' font-mono'} readOnly value={inviteLink} /><button className={buttonClass} onClick={() => void navigator.clipboard.writeText(inviteLink)}>Copy invite link</button></div>}
            <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr className="border-b border-border"><th className="py-2">Member</th><th>Role</th><th>Action</th></tr></thead><tbody>{members.map(member => <tr className="border-b border-border" key={member.id}><td className="py-2">{member.email}</td><td>{credentialScopeLabel(member.role)}</td><td><button className={buttonClass} disabled={busy} onClick={() => void action(async () => { await authRequest(`/members/${member.id}/revoke`, {}); await refresh(); })}>Revoke access</button></td></tr>)}</tbody></table></div>
            {invitations.length > 0 && <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr className="border-b border-border"><th className="py-2">Pending invite</th><th>Role</th><th>Expires</th><th>Status</th><th>Action</th></tr></thead><tbody>{invitations.map(invite => <tr className="border-b border-border" key={invite.id}><td className="py-2">{invite.email}</td><td>{credentialScopeLabel(invite.role)}</td><td>{new Date(invite.expiresAt).toLocaleDateString()}</td><td>{invite.acceptedAt ? 'Accepted' : invite.revokedAt ? 'Revoked' : 'Pending'}</td><td>{!invite.acceptedAt && !invite.revokedAt && <button className={buttonClass} disabled={busy} onClick={() => void action(async () => { await authRequest(`/invitations/${invite.id}/revoke`, {}); await refresh(); })}>Revoke invite</button>}</td></tr>)}</tbody></table></div>}
          </div>}
        </section>}

        </div>
      </div>}
    </div>
  </div>;
}
