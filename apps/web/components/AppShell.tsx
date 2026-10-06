'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Bot, Video } from 'lucide-react';
import { THEME_PRESETS, useAppStore, type ThemePreset } from '@/lib/store';
import { Conversation, chatRequest } from '@/lib/chat';
import { Meeting, MeetingDetail } from '@/lib/meetings';
import { Sidebar } from './Sidebar';
import { TopBar } from './TopBar';
import { Inspector } from './Inspector';
import { CommandPalette } from './CommandPalette';
import { NotificationCenter } from './NotificationCenter';
import { SuperQA } from './SuperQA';
import { Dashboard } from './pages/Dashboard';
import { TestCases } from './pages/TestCases';
import { PlaceholderPage } from './pages/PlaceholderPages';
import { FrameworkPage } from './pages/Framework';
import { PipelinesPage } from './pages/Pipelines';
import { BusinessPage, QualityDefectsPage } from './pages/Business';
import { EnvironmentsPage } from './pages/Environments';
import { QAEngineerPage, AutomationEngineerPage } from './pages/Agents';
import { CommandCenterPage } from './pages/CommandCenter';
import { SettingsPage } from './pages/Settings';
import { UserSettingsPage } from './pages/UserSettings';
import { OrganizationSettingsPage } from './pages/OrganizationSettings';
import { ChatPage } from './pages/Chat';
import { IntegrationsPage } from './pages/Integrations';
import { ExecutionPlansPage, ExecutionsPage, AutomatedTestsPage, TestCredentialsPage, ReportsPage, CoveragePage } from './pages/OperationalPages';
import type { Page } from '@/lib/types';

export function AppShell({ initialPage }: { initialPage?: Page }) {
  const [dataError, setDataError] = useState<string | null>(null);
  const [impersonating, setImpersonating] = useState('');
  const [activeCall, setActiveCall] = useState<{ meeting: Meeting; conversation: Conversation } | null>(null);
  const [activeDetail, setActiveDetail] = useState<MeetingDetail | null>(null);
  const [callElapsed, setCallElapsed] = useState(0);
  const [callToJoin, setCallToJoin] = useState<{ meeting: Meeting; conversation: Conversation } | null>(null);
  const [initialized, setInitialized] = useState(!initialPage);
  const workspaceLoaded = useRef(false);
  const { currentPage, loading, setLoading, setData, setContextCounts, theme, setTheme, setCurrentPage } = useAppStore();
  const page = initialized ? currentPage : initialPage!;
  const collaborationPage = ['chat', 'agent-qae', 'agent-aue'].includes(page);
  const clearCallToJoin = useCallback(() => setCallToJoin(null), []);

  useEffect(() => {
    let active = true; let inFlight = false;
    const refreshActiveCall = async () => {
      if (!active || inFlight) return;
      inFlight = true;
      try {
        const result = await fetch('/api/chat/meetings/active', { credentials: 'same-origin', cache: 'no-store' });
        if (!result.ok) return;
        const data = await result.json() as { meeting: Meeting | null; conversation: Conversation | null };
        if (!active) return;
        setActiveCall(data.meeting && data.conversation ? { meeting: data.meeting, conversation: data.conversation } : null);
        if (data.meeting) { try { const detail = await chatRequest<MeetingDetail>('/meetings/' + data.meeting.id); if (active) setActiveDetail(detail); } catch { /* keep last known participants */ } }
        else setActiveDetail(null);
      } catch { /* Keep the last known call while the app reconnects. */ }
      finally { inFlight = false; }
    };
    void refreshActiveCall();
    const events = new EventSource('/api/chat/events', { withCredentials: true });
    events.addEventListener('connected', refreshActiveCall);
    events.addEventListener('change', refreshActiveCall);
    const interval = window.setInterval(refreshActiveCall, 5000);
    return () => { active = false; window.clearInterval(interval); events.close(); };
  }, []);

  useEffect(() => {
    if (!activeCall) { setCallElapsed(0); return; }
    const startedAt = Date.parse(activeCall.meeting.liveAt || activeCall.meeting.createdAt);
    const update = () => setCallElapsed(Math.max(0, Math.floor((Date.now() - startedAt) / 1000)));
    update();
    const timer = window.setInterval(update, 1000);
    return () => window.clearInterval(timer);
  }, [activeCall]);

  useEffect(() => {
    if (initialPage) setCurrentPage(initialPage);
    setInitialized(true);
  }, [initialPage, setCurrentPage]);

  // Fetch data on mount
  useEffect(() => {
    if (page === 'settings' || page === 'user-settings' || page === 'app-settings' || page === 'status' || collaborationPage) { setLoading(false); return; }
    if (workspaceLoaded.current) return;
    workspaceLoaded.current = true;
    const fetchData = async () => {
      try {
        const workspaceRes = await fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000'}/api/qa/workspace`);

        if (!workspaceRes.ok) throw new Error('Workspace API request failed');
        if (workspaceRes.ok) {
          const data = await workspaceRes.json();
          setData({
            stats: data.stats,
            testCases: data.testCases,
            executions: data.executions,
            healingSuggestions: data.healingSuggestions,
            flows: data.flows,
            facts: data.facts,
          });
        }
      } catch (error) {
        setDataError('Workspace data is unavailable. No demo results are substituted. Check the API and refresh.');
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [page, collaborationPage, setData, setLoading, setContextCounts]);

  // Context counts change as syncs publish new items. Keep sidebar badges fresh
  // independently of the one-time workspace snapshot fetch above.
  useEffect(() => {
    let active = true;
    let inFlight = false;
    const refreshContextCounts = async () => {
      if (!active || inFlight || document.visibilityState !== 'visible') return;
      inFlight = true;
      try {
        const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000'}/api/qa/context-counts`);
        if (!response.ok) return;
        const counts = await response.json();
        if (active) setContextCounts(counts);
      } catch {
        // Keep the last known counts when the API is temporarily unavailable.
      } finally {
        inFlight = false;
      }
    };

    void refreshContextCounts();
    const events = new EventSource(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000'}/api/sources/events`);
    let refreshTimer: number | undefined;
    const updateCounts = (event: Event) => {
      try {
        const payload = JSON.parse((event as MessageEvent).data);
        if (!['completed', 'failed', 'cancelled'].includes(payload.update?.status)) return;
      } catch { return; }
      if (refreshTimer) clearTimeout(refreshTimer);
      refreshTimer = window.setTimeout(() => void refreshContextCounts(), 750);
    };
    events.addEventListener('job-update', updateCounts);
    events.addEventListener('connected', refreshContextCounts);
    window.addEventListener('focus', refreshContextCounts);
    document.addEventListener('visibilitychange', refreshContextCounts);
    return () => {
      active = false;
      events.close();
      if (refreshTimer) clearTimeout(refreshTimer);
      window.removeEventListener('focus', refreshContextCounts);
      document.removeEventListener('visibilitychange', refreshContextCounts);
    };
  }, [setContextCounts]);

  // Apply theme class
  useEffect(() => {
    try {
      const persisted = window.localStorage.getItem('superqa-theme');
      if (persisted && THEME_PRESETS.includes(persisted as ThemePreset)) { setTheme(persisted as ThemePreset); return; }
    } catch { /* Use the default theme if browser storage is unavailable. */ }
    setTheme(theme);
  }, []);

  useEffect(() => {
    let active = true;
    void fetch('/api/auth/session', { credentials: 'same-origin', cache: 'no-store' })
      .then(response => response.ok ? response.json() : null)
      .then(session => { if (active && session?.user?.impersonated) setImpersonating(session.user.email); })
      .catch(() => undefined);
    return () => { active = false; };
  }, []);

  const exitImpersonation = async () => {
    const response = await fetch('/api/auth/end-impersonation', { method: 'POST', credentials: 'same-origin' });
    if (!response.ok) { window.location.assign('/login'); return; }
    window.location.assign('/admin');
  };

  const renderPage = () => {
    switch (page) {
      case 'chat':
        return <ChatPage joinMeeting={callToJoin} onMeetingOpened={clearCallToJoin} />;
      case 'integrations':
        return <IntegrationsPage />;
      case 'settings':
        return <SettingsPage />;
      case 'user-settings':
        return <UserSettingsPage />;
      case 'app-settings':
        return <OrganizationSettingsPage />;
      case 'dashboard':
        return <Dashboard />;
      case 'executions':
        return <ExecutionsPage />;
      case 'test-cases':
        return <TestCases />;
      case 'execution-plans':
        return <ExecutionPlansPage />;
      case 'automated-tests':
        return <AutomatedTestsPage />;
      case 'test-credentials':
        return <TestCredentialsPage />;
      case 'reports':
        return <ReportsPage />;
      case 'coverage':
        return <CoveragePage />;
      case 'frameworks':
        return <FrameworkPage />;
      case 'sources':
      case 'pipelines':
        return <PipelinesPage onOpenIntegrations={() => setCurrentPage('integrations')} />;
      case 'sync-jobs':
        return <PipelinesPage onOpenIntegrations={() => setCurrentPage('integrations')} />;
      case 'business':
        return <BusinessPage />;
      // Quality
      case 'defects':
        return <QualityDefectsPage />;
      // Environments
      case 'environments':
        return <EnvironmentsPage />;
      // Agents
      case 'command-center':
        return <CommandCenterPage />;
      case 'agent-qae':
        return <QAEngineerPage />;
      case 'agent-aue':
        return <AutomationEngineerPage />;
      default:
        return <PlaceholderPage page={currentPage} />;
    }
  };

  const callTimerLabel = `${Math.floor(callElapsed / 60).toString().padStart(2, '0')}:${(callElapsed % 60).toString().padStart(2, '0')}`;
  const callAvatars: { key: string; label: string; agent?: boolean }[] = activeCall ? [
    ...(activeDetail?.peers || []).map(peer => ({ key: peer.memberId, label: peer.name })),
    ...(activeCall.meeting.agentParticipants?.length ? activeCall.meeting.agentParticipants.map(item => ({ key: item.agentId, label: 'AI', agent: true })) : activeCall.meeting.agentId ? [{ key: activeCall.meeting.agentId, label: 'AI', agent: true }] : []),
  ] : [];
  const visibleCallAvatars = callAvatars.slice(0, 3);
  const extraCallAvatars = callAvatars.length - visibleCallAvatars.length;

  return (
    <div className="h-screen flex flex-col bg-canvas">
      {impersonating && <div role="alert" className="flex shrink-0 flex-wrap items-center justify-center gap-2 bg-warning px-4 py-2 text-center text-sm font-medium text-black"><span>Temporary support session as {impersonating} · changes are made as this user</span><button type="button" onClick={() => void exitImpersonation()} className="rounded-md border border-black/25 px-3 py-1 text-xs font-semibold hover:bg-black/10">Exit impersonation</button></div>}
      <div className="flex-1 flex overflow-hidden">
        <div className={collaborationPage ? 'hidden lg:flex' : 'flex'}><Sidebar /></div>
        <div className="flex-1 flex flex-col overflow-hidden">
          <div className={collaborationPage ? 'hidden md:block' : ''}><TopBar /></div>
          {activeCall && <div role="status" className="flex shrink-0 items-center justify-between gap-4 border-b border-accent-blue/20 bg-accent-blue/8 px-4 py-2.5 md:px-7">
            <div className="flex min-w-0 items-center gap-3">
              <span className="relative grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-accent-blue/15 text-accent-blue"><Video size={16} /><i className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-accent-blue shadow-[0_0_0_2px_var(--bg-canvas)]" /></span>
              <div className="min-w-0">
                <p className="truncate text-xs font-semibold text-text-primary">{activeCall.conversation.title}</p>
                <p className="flex items-center gap-1.5 text-[11px] text-text-secondary"><span className="font-semibold tabular-nums text-accent-blue">{callTimerLabel}</span><span aria-hidden="true">·</span>Ongoing call</p>
              </div>
              {callAvatars.length > 0 && <div className="ml-1 flex shrink-0 items-center" aria-label={callAvatars.length + ' on the call'}>
                {visibleCallAvatars.map(item => <span key={item.key} title={item.agent ? 'AI agent' : item.label} className={'-ml-2 grid h-7 w-7 place-items-center rounded-full border-2 border-canvas text-[10px] font-semibold text-white first:ml-0 ' + (item.agent ? 'bg-accent-purple/80' : 'bg-accent-blue/80')}>{item.agent ? <Bot size={12} /> : item.label.trim().split(/\s+/).slice(0, 2).map(part => part[0]).join('').toUpperCase() || '?'}</span>)}
                {extraCallAvatars > 0 && <span className="-ml-2 grid h-7 w-7 place-items-center rounded-full border-2 border-canvas bg-elevated text-[10px] font-semibold text-text-secondary">+{extraCallAvatars}</span>}
              </div>}
            </div>
            <button className="inline-flex shrink-0 items-center gap-2 rounded-lg bg-accent-blue px-3 py-2 text-xs font-semibold text-white transition hover:opacity-90 active:scale-95" onClick={() => { setCallToJoin(activeCall); setCurrentPage('chat'); }}><Video size={14} />Join in</button>
          </div>}
          {dataError && page !== 'settings' && page !== 'user-settings' && page !== 'app-settings' && !collaborationPage && <div role="alert" className="p-3 bg-danger/10 text-danger">{dataError} <a className="underline" href="/settings">Open scoped Settings</a></div>}
          <div className="flex-1 flex overflow-hidden">
            <main className="flex-1 overflow-hidden">
              {/* Agent chat pages stay mounted across navigation (hidden, not unmounted) so an
                  in-flight streaming turn keeps updating in the background instead of being
                  lost from the thread when the user switches to another page and back. */}
              <div className={page === 'agent-qae' ? 'h-full' : 'hidden'}><QAEngineerPage /></div>
              <div className={page === 'agent-aue' ? 'h-full' : 'hidden'}><AutomationEngineerPage /></div>
              {page !== 'agent-qae' && page !== 'agent-aue' && (loading && page !== 'settings' && page !== 'user-settings' && page !== 'app-settings' && !collaborationPage ? <div className="p-8 text-text-secondary">Loading workspace… Use the sidebar for settings.</div> : renderPage())}
            </main>
            {!collaborationPage && <Inspector />}
          </div>
        </div>
      </div>

      {/* Overlays */}
      <CommandPalette />
      <NotificationCenter />
      {!collaborationPage && <SuperQA />}
    </div>
  );
}
