'use client';

import { useState } from 'react';
import { Bot, Loader2 } from 'lucide-react';
import { request, OnboardingTestCase } from '../api';

export function GenerateTestCasesStep({ sourceId, onGenerated }: { sourceId: string; onGenerated: (cases: OnboardingTestCase[]) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [cases, setCases] = useState<OnboardingTestCase[] | null>(null);

  async function generate() {
    setBusy(true);
    setError('');
    try {
      const created = await request<OnboardingTestCase[]>('/onboarding/generate-test-cases', { method: 'POST', body: JSON.stringify({ sourceId }) });
      setCases(created);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'QAE could not design test cases');
    } finally {
      setBusy(false);
    }
  }

  if (busy) return <div className="flex flex-col items-center gap-3 py-10 text-center">
    <Loader2 size={28} className="animate-spin text-accent-blue" />
    <p className="text-sm font-medium">QAE is designing test cases from your repository…</p>
  </div>;

  if (cases) return <div className="space-y-4">
    <div><h2 className="text-lg font-semibold">Here's what QAE designed</h2><p className="mt-1 text-sm text-text-secondary">{cases.length} test case{cases.length === 1 ? '' : 's'}, approved and ready to run.</p></div>
    <ul className="space-y-2">
      {cases.map(testCase => <li key={testCase.id} className="rounded-lg border border-border p-3"><p className="text-sm font-medium">{testCase.title}</p><p className="mt-1 text-xs text-text-secondary">{testCase.steps.length} step{testCase.steps.length === 1 ? '' : 's'}</p></li>)}
    </ul>
    <button className="ui-button-primary w-full" onClick={() => onGenerated(cases)}>Run these tests</button>
  </div>;

  return <div className="space-y-5 text-center">
    <div><Bot size={28} className="mx-auto text-accent-purple" /><h2 className="mt-3 text-lg font-semibold">Let QAE design your test cases</h2><p className="mt-1 text-sm text-text-secondary">QAE will read what was just synced and propose concrete, runnable test cases.</p></div>
    {error && <p role="alert" className="rounded-lg bg-danger/10 p-3 text-sm text-danger">{error}</p>}
    <button className="ui-button-primary w-full" onClick={generate}>Design test cases</button>
  </div>;
}
