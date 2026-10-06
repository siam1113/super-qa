'use client';

import { useState } from 'react';
import { CheckCircle2, Loader2, PlayCircle, XCircle } from 'lucide-react';
import { request, OnboardingTestCase } from '../api';

type RunStatus = 'pending' | 'running' | 'passed' | 'failed' | 'error';

export function ExecuteTestsStep({ testCases, onDone }: { testCases: OnboardingTestCase[]; onDone: (results: Array<{ testCaseId: string; status: RunStatus }>) => void }) {
  const [statuses, setStatuses] = useState<Record<string, RunStatus>>(() => Object.fromEntries(testCases.map(testCase => [testCase.id, 'pending'])));
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(false);

  async function runAll() {
    setRunning(true);
    const results: Array<{ testCaseId: string; status: RunStatus }> = [];
    for (const testCase of testCases) {
      setStatuses(previous => ({ ...previous, [testCase.id]: 'running' }));
      try {
        const execution = await request<{ status: string }>(`/onboarding/execute/${testCase.id}`, { method: 'POST' });
        const status: RunStatus = execution.status === 'passed' ? 'passed' : 'failed';
        setStatuses(previous => ({ ...previous, [testCase.id]: status }));
        results.push({ testCaseId: testCase.id, status });
      } catch {
        setStatuses(previous => ({ ...previous, [testCase.id]: 'error' }));
        results.push({ testCaseId: testCase.id, status: 'error' });
      }
    }
    setRunning(false);
    setDone(true);
    onDone(results);
  }

  const icon = (status: RunStatus) => status === 'passed' ? <CheckCircle2 size={16} className="text-success" />
    : status === 'failed' || status === 'error' ? <XCircle size={16} className="text-danger" />
    : status === 'running' ? <Loader2 size={16} className="animate-spin text-accent-blue" />
    : <span className="h-4 w-4 rounded-full border border-border" />;

  return <div className="space-y-4">
    <div><h2 className="text-lg font-semibold">Run the tests</h2><p className="mt-1 text-sm text-text-secondary">QAE will drive a real browser through each test case.</p></div>
    <ul className="space-y-2">
      {testCases.map(testCase => <li key={testCase.id} className="flex items-center gap-3 rounded-lg border border-border p-3">{icon(statuses[testCase.id])}<span className="min-w-0 flex-1 truncate text-sm font-medium">{testCase.title}</span></li>)}
    </ul>
    {!done && <button className="ui-button-primary w-full disabled:opacity-50" disabled={running} onClick={runAll}>{running ? 'Running…' : <><PlayCircle size={16} className="mr-1.5 inline" />Run all tests</>}</button>}
    {done && <button className="ui-button-primary w-full" onClick={() => onDone(Object.entries(statuses).map(([testCaseId, status]) => ({ testCaseId, status })))}>See results</button>}
  </div>;
}
