'use client';

import { useEffect, useState } from 'react';
import { AppShell } from './AppShell';
import type { Page } from '@/lib/types';

// Shared by every route that used to render AppShell unconditionally (/, /chat,
// /integrations). AppShell fires its legacy workspace/sources/agent-task
// fetches on mount regardless of which page is selected, and those are blocked
// by AutonomyLockdownGuard whenever this deployment has lockdown on (see
// docs/autonomy-operations.md) — so rendering AppShell at all in that mode
// 403-storms for any visitor, signed in or not. legacyAvailable mirrors the
// guard's own condition exactly (from /api/auth/config), so this renders the
// real page when the legacy app actually works, and only falls back to the
// scoped /settings destination when it doesn't — rather than hardcoding one
// or the other and drifting out of sync with what the backend enforces.
export function ScopedHomeRedirect({ legacyPage }: { legacyPage?: Page } = {}) {
  const [showLegacy, setShowLegacy] = useState(false);

  useEffect(() => {
    void Promise.all([
      fetch('/api/auth/session', { cache: 'no-store', credentials: 'same-origin' }).then(r => r.ok ? r.json() : null),
      fetch('/api/auth/config', { cache: 'no-store', credentials: 'same-origin' }).then(r => r.ok ? r.json() : null),
    ])
      .then(([session, config]) => {
        if (!session) { location.assign('/login'); return; }
        if (session.user.accountType === 'super_admin') { location.assign('/admin'); return; }
        if (session.user.onboardingCompleted === false) { location.assign('/onboarding'); return; }
        if (config?.legacyAvailable) { setShowLegacy(true); return; }
        location.assign('/settings');
      })
      .catch(() => location.assign('/login'));
  }, []);

  return showLegacy ? <AppShell initialPage={legacyPage} /> : null;
}
