'use client';

import { FormEvent, useEffect, useState } from 'react';

const inputClass = 'ui-field w-full px-3 py-2 text-sm';
const buttonClass = 'ui-button-primary w-full disabled:opacity-50';

export function AcceptInvitationPage() {
  const [token, setToken] = useState('');
  const [password, setPassword] = useState(''); const [confirmation, setConfirmation] = useState(''); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  useEffect(() => { setToken(new URLSearchParams(window.location.search).get('token') || ''); }, []);
  const submit = (event: FormEvent) => {
    event.preventDefault(); setError('');
    if (password !== confirmation) { setError('Passwords do not match.'); return; }
    setBusy(true);
    void fetch('/api/auth/accept-invitation', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', cache: 'no-store', body: JSON.stringify({ token, password }) })
      .then(async response => { const result = await response.json(); if (!response.ok) throw new Error(result.message || 'Invitation could not be accepted'); location.assign('/settings'); })
      .catch(failure => setError(failure instanceof Error ? failure.message : 'Invitation could not be accepted.')).finally(() => setBusy(false));
  };
  return <main className="min-h-screen bg-canvas p-6 text-text-primary"><section className="mx-auto mt-16 max-w-md space-y-5 rounded-xl border border-border bg-surface p-6">
    <header><p className="text-xs uppercase tracking-widest text-accent-blue">Super QA</p><h1 className="mt-2 text-2xl font-semibold">Accept invitation</h1><p className="mt-1 text-sm text-text-secondary">New users can choose a password. If you already use this email in another app, enter your existing account password to add this app.</p></header>
    {error && <p role="alert" className="rounded bg-danger/10 p-3 text-sm text-danger">{error}</p>}
    {!token ? <p role="alert" className="text-sm text-danger">Invitation token is missing. Use the full invitation link from your email.</p> : <form onSubmit={submit} className="space-y-4"><label className="block text-sm">Account password<input className={inputClass + ' mt-1'} type="password" autoComplete="new-password" minLength={12} maxLength={256} required value={password} onChange={event => setPassword(event.target.value)} /><span className="mt-1 block text-xs text-text-secondary">Use your current password if you already have an account with this email. New passwords need at least 12 characters.</span></label><label className="block text-sm">Confirm password<input className={inputClass + ' mt-1'} type="password" autoComplete="new-password" required value={confirmation} onChange={event => setConfirmation(event.target.value)} /></label><button className={buttonClass} disabled={busy}>{busy ? 'Activating…' : 'Activate account'}</button></form>}
  </section></main>;
}
