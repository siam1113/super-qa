'use client';

import { useEffect, useRef, useState } from 'react';
import { Play, ChevronDown, Bot, Terminal } from 'lucide-react';

const API = `${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000'}/api/qa`;

export type ExecutableTestCase = { id: string; title: string; automation: string; reviewStatus?: string };

export function ExecuteMenu({
  testCase,
  onRunStarted,
  align = 'right',
}: {
  testCase: ExecutableTestCase;
  onRunStarted: (run: { runId: string; testName: string }) => void;
  align?: 'left' | 'right';
}) {
  const [open, setOpen] = useState(false);
  const [environment, setEnvironment] = useState('staging');
  const [browser, setBrowser] = useState('chromium');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const closeOnOutside = (event: MouseEvent) => { if (event.target instanceof Node && !rootRef.current?.contains(event.target)) setOpen(false); };
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', closeOnOutside);
    document.addEventListener('keydown', closeOnEscape);
    return () => { document.removeEventListener('mousedown', closeOnOutside); document.removeEventListener('keydown', closeOnEscape); };
  }, [open]);

  const approved = testCase.reviewStatus ? testCase.reviewStatus === 'approved' : true;
  const automated = testCase.automation === 'automated';

  const runWithAgent = async () => {
    setBusy(true);
    setError('');
    try {
      const response = await fetch(`${API}/test-cases/${testCase.id}/run-with-agent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ environment, browser }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || 'Could not start run');
      onRunStarted({ runId: data.runId, testName: testCase.title });
      setOpen(false);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not start run');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div ref={rootRef} className="relative inline-block text-left">
      <button
        type="button"
        onClick={() => setOpen(current => !current)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="ui-button-secondary inline-flex min-h-9 items-center gap-1.5 text-xs font-medium"
      >
        <Play size={14} /> Execute <ChevronDown size={13} className={open ? 'rotate-180 transition-transform' : 'transition-transform'} />
      </button>

      {open && (
        <div role="menu" className={`absolute top-full z-30 mt-2 w-72 rounded-xl border border-border bg-surface p-3 shadow-xl ${align === 'right' ? 'right-0' : 'left-0'}`}>
          <div className="grid grid-cols-2 gap-2">
            <label className="block text-[10px] font-semibold text-text-secondary">
              ENVIRONMENT
              <select className="ui-field mt-1 w-full text-xs" value={environment} onChange={event => setEnvironment(event.target.value)}>
                <option value="staging">Staging</option>
                <option value="development">Development</option>
                <option value="production">Production</option>
              </select>
            </label>
            <label className="block text-[10px] font-semibold text-text-secondary">
              BROWSER
              <select className="ui-field mt-1 w-full text-xs" value={browser} onChange={event => setBrowser(event.target.value)}>
                <option value="chromium">Chromium</option>
                <option value="firefox">Firefox</option>
                <option value="webkit">WebKit</option>
              </select>
            </label>
          </div>

          <div className="mt-3 space-y-1.5">
            <button
              type="button"
              disabled={busy || !approved}
              onClick={() => void runWithAgent()}
              title={!approved ? 'Case must be reviewed and approved before it can run' : undefined}
              className="ui-button-primary flex w-full items-center justify-center gap-2 text-xs disabled:opacity-45"
            >
              <Bot size={14} /> {busy ? 'Starting…' : 'Run with Agent'}
            </button>

            {automated && (
              <button
                type="button"
                disabled
                title="Script execution is coming soon"
                className="flex w-full cursor-not-allowed items-center justify-center gap-2 rounded-lg border border-border bg-elevated/40 px-3 py-2 text-xs font-medium text-text-secondary opacity-60"
              >
                <Terminal size={14} /> Run Script
                <span className="rounded-full bg-elevated px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide">Soon</span>
              </button>
            )}
          </div>

          {!approved && <p className="mt-2 text-[11px] text-text-secondary">Approve this case in review before running it with the agent.</p>}
          {error && <p role="alert" className="mt-2 text-[11px] text-danger">{error}</p>}
        </div>
      )}
    </div>
  );
}
