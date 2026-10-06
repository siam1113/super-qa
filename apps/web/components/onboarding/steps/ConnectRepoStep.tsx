'use client';

import { useEffect, useRef, useState } from 'react';
import { CheckCircle2, Github, Loader2 } from 'lucide-react';
import { API, request } from '../api';

type Phase = 'form' | 'syncing' | 'done' | 'error';

const inputClass = 'ui-field w-full px-3 py-2 text-sm';

export function ConnectRepoStep({ onConnected }: { onConnected: (sourceId: string) => void }) {
  const [repository, setRepository] = useState('');
  const [token, setToken] = useState('');
  const [phase, setPhase] = useState<Phase>('form');
  const [error, setError] = useState('');
  const [progress, setProgress] = useState<{ processed: number; total: number } | null>(null);
  const [oauthSupported, setOauthSupported] = useState(false);
  const polling = useRef(false);

  useEffect(() => {
    void fetch(`${API}/sources/oauth/config/status`).then(r => r.ok ? r.json() : null).then(result => { if (result?.github) setOauthSupported(true); }).catch(() => {});
    const params = new URLSearchParams(window.location.search);
    if (params.get('oauth_success') === 'true') {
      const sourceId = params.get('source_id');
      window.history.replaceState({}, '', window.location.pathname);
      if (sourceId) void startSync(sourceId);
    } else if (params.get('error')) {
      setError(decodeURIComponent(params.get('error') || 'GitHub connection failed'));
      window.history.replaceState({}, '', window.location.pathname);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function startSync(sourceId: string) {
    setPhase('syncing');
    setError('');
    try {
      await request(`/sources/${sourceId}/sync`, { method: 'POST', body: JSON.stringify({ mode: 'full' }) });
    } catch (failure) {
      setPhase('error');
      setError(failure instanceof Error ? failure.message : 'Could not start the sync');
      return;
    }
    if (polling.current) return;
    polling.current = true;
    const poll = async () => {
      try {
        const status = await request<{ status: string; itemsProcessed: number; itemsTotal: number; errorMessage: string | null }>(`/sources/${sourceId}/status`);
        setProgress({ processed: status.itemsProcessed || 0, total: status.itemsTotal || 0 });
        if (status.status === 'completed') { setPhase('done'); onConnected(sourceId); return; }
        if (status.status === 'failed' || status.status === 'cancelled') { setPhase('error'); setError(status.errorMessage || 'The sync did not complete'); return; }
        setTimeout(poll, 2000);
      } catch (failure) {
        setPhase('error');
        setError(failure instanceof Error ? failure.message : 'Could not check sync progress');
      }
    };
    void poll();
  }

  async function connectWithToken() {
    if (!repository.trim() || !token.trim()) return;
    setPhase('syncing');
    setError('');
    try {
      const source = await request<{ id: string }>('/sources', {
        method: 'POST',
        body: JSON.stringify({ name: repository.trim(), type: 'github', config: { authType: 'token', token: token.trim(), repository: repository.trim() } }),
      });
      await startSync(source.id);
    } catch (failure) {
      setPhase('error');
      setError(failure instanceof Error ? failure.message : 'Could not connect that repository');
    }
  }

  async function connectWithOAuth() {
    setError('');
    try {
      const response = await fetch('/api/sources/oauth/github/authorize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sourceName: repository.trim() || 'GitHub', redirectUri: window.location.origin + '/onboarding' }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message || 'Could not start GitHub sign-in');
      window.location.href = result.authorizationUrl;
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Could not start GitHub sign-in');
    }
  }

  if (phase === 'syncing') return <div className="flex flex-col items-center gap-3 py-10 text-center">
    <Loader2 size={28} className="animate-spin text-accent-blue" />
    <p className="text-sm font-medium">Syncing your repository…</p>
    <p className="text-xs text-text-secondary">{progress && progress.total ? `${progress.processed} of ${progress.total} items processed` : 'Pulling issues, pull requests, and code context'}</p>
  </div>;

  if (phase === 'done') return <div className="flex flex-col items-center gap-3 py-10 text-center">
    <CheckCircle2 size={28} className="text-success" />
    <p className="text-sm font-medium">Repository connected and synced</p>
  </div>;

  return <div className="space-y-5">
    <div><h2 className="text-lg font-semibold">Connect a GitHub repository</h2><p className="mt-1 text-sm text-text-secondary">We'll pull in issues and pull requests so your agents have real context to work from.</p></div>
    {error && <p role="alert" className="rounded-lg bg-danger/10 p-3 text-sm text-danger">{error}</p>}
    <label className="block text-sm">Repository (owner/repo)<input className={inputClass + ' mt-1'} placeholder="octocat/hello-world" value={repository} onChange={event => setRepository(event.target.value)} /></label>
    <label className="block text-sm">Personal access token<input type="password" className={inputClass + ' mt-1'} placeholder="ghp_…" value={token} onChange={event => setToken(event.target.value)} /></label>
    <button className="ui-button-primary w-full disabled:opacity-50" disabled={!repository.trim() || !token.trim()} onClick={connectWithToken}>Connect &amp; sync</button>
    {oauthSupported && <div className="space-y-3"><div className="text-center text-xs text-text-secondary">or</div><button className="flex w-full items-center justify-center gap-2 rounded-lg border border-border px-3 py-2 text-sm font-medium hover:bg-elevated" onClick={connectWithOAuth}><Github size={16} />Connect with GitHub</button></div>}
  </div>;
}
