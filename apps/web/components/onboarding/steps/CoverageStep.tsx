'use client';

import { CheckCircle2, ExternalLink, XCircle } from 'lucide-react';
import { OnboardingTestCase } from '../api';

type RunStatus = 'pending' | 'running' | 'passed' | 'failed' | 'error';

export function CoverageStep({ testCases, results, onFinish, finishing }: { testCases: OnboardingTestCase[]; results: Array<{ testCaseId: string; status: RunStatus }>; onFinish: () => void; finishing: boolean }) {
  const passed = results.filter(result => result.status === 'passed').length;
  const failed = results.length - passed;

  return <div className="space-y-5">
    <div><h2 className="text-lg font-semibold">You're set up</h2><p className="mt-1 text-sm text-text-secondary">Here's what your QA agents just did, for real, against your repository.</p></div>
    <div className="grid grid-cols-3 gap-3">
      <div className="rounded-lg border border-border p-4 text-center"><p className="text-2xl font-semibold">{testCases.length}</p><p className="mt-1 text-xs text-text-secondary">Test cases designed</p></div>
      <div className="rounded-lg border border-success/30 bg-success/5 p-4 text-center"><p className="text-2xl font-semibold text-success">{passed}</p><p className="mt-1 text-xs text-text-secondary">Passed</p></div>
      <div className="rounded-lg border border-border p-4 text-center"><p className={'text-2xl font-semibold' + (failed ? ' text-danger' : '')}>{failed}</p><p className="mt-1 text-xs text-text-secondary">Failed</p></div>
    </div>
    <ul className="space-y-2">
      {testCases.map(testCase => {
        const result = results.find(item => item.testCaseId === testCase.id);
        return <li key={testCase.id} className="flex items-center gap-3 rounded-lg border border-border p-3">
          {result?.status === 'passed' ? <CheckCircle2 size={16} className="text-success" /> : <XCircle size={16} className="text-danger" />}
          <span className="min-w-0 flex-1 truncate text-sm font-medium">{testCase.title}</span>
        </li>;
      })}
    </ul>
    <p className="text-xs text-text-secondary">This is a real, saved snapshot — your test cases, executions, and this repository will all be waiting for you in the main workspace, where the full coverage view ties them back to requirements as more knowledge syncs in.</p>
    <button className="ui-button-primary w-full disabled:opacity-50" disabled={finishing} onClick={onFinish}>{finishing ? 'Finishing…' : <>Go to your workspace <ExternalLink size={14} className="ml-1.5 inline" /></>}</button>
  </div>;
}
