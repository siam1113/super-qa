'use client';

import { FormEvent, useEffect, useState } from 'react';

const inputClass = 'ui-field w-full px-3 py-2 text-sm';
const buttonClass = 'ui-button-primary w-full disabled:opacity-50';

export function LoginPage() {
  const [email, setEmail] = useState(''); const [password, setPassword] = useState('');
  const [sso, setSso] = useState(false); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  useEffect(() => { void fetch('/api/auth/config', { cache: 'no-store' }).then(result => result.json()).then(result => setSso(Boolean(result.ssoEnabled))).catch(() => {}); }, []);
  const submit = (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setError('');
    void fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', cache: 'no-store', body: JSON.stringify({ email, password }) })
      .catch(() => { throw new Error('Could not reach the server. Check your connection and try again.'); })
      .then(async response => {
        // A gateway/proxy failure (502/503/504) has no JSON body at all, not an
        // app-level error payload — don't let that surface as a raw parse error.
        let result: { message?: string; user?: { accountType: string; onboardingCompleted?: boolean } } | null = null;
        try { result = await response.json(); } catch { /* empty/non-JSON body */ }
        if (!response.ok) {
          throw new Error(result?.message || (response.status >= 500
            ? 'The server is temporarily unavailable. Please try again in a moment.'
            : 'Sign in failed.'));
        }
        if (!result?.user) throw new Error('Sign in failed: unexpected response from the server.');
        // '/' decides AppShell vs. /settings itself (ScopedHomeRedirect, based
        // on whether legacy routes are actually available) — redirecting there
        // instead of hardcoding /settings keeps this in sync with that logic
        // rather than duplicating it.
        location.assign(result.user.accountType === 'super_admin' ? '/admin' : result.user.onboardingCompleted === false ? '/onboarding' : '/');
      })
      .catch(failure => setError(failure instanceof Error ? failure.message : 'Sign in failed.')).finally(() => setBusy(false));
  };
  return <main className="min-h-screen bg-canvas p-6 text-text-primary"><section className="mx-auto mt-16 max-w-md space-y-5 rounded-xl border border-border bg-surface p-6">
    <header><p className="text-xs uppercase tracking-widest text-accent-blue">superqa</p><h1 className="mt-2 text-2xl font-semibold">Sign in</h1><p className="mt-1 text-sm text-text-secondary">Use your app account.</p></header>
    {error && <p role="alert" className="rounded bg-danger/10 p-3 text-sm text-danger">{error}</p>}
    <form onSubmit={submit} className="space-y-4"><label className="block text-sm">Email<input className={inputClass + ' mt-1'} type="email" autoComplete="username" required value={email} onChange={event => setEmail(event.target.value)} /></label><label className="block text-sm">Password<input className={inputClass + ' mt-1'} type="password" autoComplete="current-password" required value={password} onChange={event => setPassword(event.target.value)} /></label><button className={buttonClass} disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button></form>
    {sso && <div className="space-y-3"><div className="text-center text-xs text-text-secondary">or</div><a className={buttonClass + ' block text-center'} href="/api/auth/oidc/start">Continue with SSO</a></div>}
    <p className="text-xs text-text-secondary">Accounts are created from app invitations. Ask an app admin to invite you.</p>
  </section></main>;
}
