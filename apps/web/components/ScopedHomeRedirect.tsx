'use client';

import { useEffect } from 'react';

// Shared by every route that used to render AppShell directly (/, /chat,
// /integrations). AppShell fires its legacy workspace/sources/agent-task
// fetches on mount regardless of which page is selected, and every one of
// those is permanently blocked by AutonomyLockdownGuard in production (see
// docs/autonomy-operations.md) — so rendering AppShell at all under lockdown
// 403-storms for any visitor, signed in or not. None of these routes have a
// scoped equivalent of their own, so they all land on the same scoped
// destination a session actually resolves to, mirroring Login.tsx's
// post-login redirect.
export function ScopedHomeRedirect() {
  useEffect(() => {
    void fetch('/api/auth/session', { cache: 'no-store', credentials: 'same-origin' })
      .then(async response => {
        if (!response.ok) { location.assign('/login'); return; }
        const result = await response.json();
        location.assign(result.user.accountType === 'super_admin' ? '/admin' : result.user.onboardingCompleted === false ? '/onboarding' : '/settings');
      })
      .catch(() => location.assign('/login'));
  }, []);
  return null;
}
