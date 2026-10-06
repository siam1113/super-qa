'use client';

import { useEffect } from 'react';

// Root has no session-scoped experience of its own — it only decides where to
// send the visitor. Rendering AppShell directly here (the previous behavior)
// meant every visitor, signed in or not, immediately fired AppShell's legacy
// workspace/sources/agent-task fetches, all blocked under production
// lockdown (see docs/autonomy-operations.md) regardless of who's visiting.
export default function Home() {
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
