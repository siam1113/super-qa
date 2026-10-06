'use client';

import { useEffect, useState } from 'react';
import { Bot, Check, GitBranch, PlayCircle, Target } from 'lucide-react';
import { request, OnboardingTestCase } from './api';
import { ConnectRepoStep } from './steps/ConnectRepoStep';
import { GenerateTestCasesStep } from './steps/GenerateTestCasesStep';
import { ExecuteTestsStep } from './steps/ExecuteTestsStep';
import { CoverageStep } from './steps/CoverageStep';

type RunStatus = 'pending' | 'running' | 'passed' | 'failed' | 'error';
type StepId = 'connect' | 'design' | 'run' | 'coverage';

const steps: Array<{ id: StepId; label: string; icon: typeof GitBranch }> = [
  { id: 'connect', label: 'Connect', icon: GitBranch },
  { id: 'design', label: 'Design', icon: Bot },
  { id: 'run', label: 'Run', icon: PlayCircle },
  { id: 'coverage', label: 'Coverage', icon: Target },
];

export function OnboardingPage() {
  const [stepIndex, setStepIndex] = useState(0);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [sourceId, setSourceId] = useState<string | null>(null);
  const [testCases, setTestCases] = useState<OnboardingTestCase[]>([]);
  const [results, setResults] = useState<Array<{ testCaseId: string; status: RunStatus }>>([]);
  const [finishing, setFinishing] = useState(false);
  const activeStep = steps[stepIndex].id;

  useEffect(() => {
    void fetch('/api/auth/session', { credentials: 'same-origin', cache: 'no-store' })
      .then(response => response.ok ? response.json() : null)
      .then(session => { if (session?.user?.projectId) setProjectId(session.user.projectId); })
      .catch(() => undefined);
  }, []);

  async function finish() {
    if (finishing) return;
    setFinishing(true);
    try { if (projectId) await request('/onboarding/complete', { method: 'POST', body: JSON.stringify({ projectId }) }); }
    catch { /* Still let the user into the workspace even if the flag couldn't be saved. */ }
    finally { location.assign('/'); }
  }

  return <main className="min-h-screen bg-canvas p-6 text-text-primary">
    <div className="mx-auto max-w-3xl">
      <header className="mb-8 flex flex-wrap items-start justify-between gap-4">
        <div><p className="text-xs uppercase tracking-widest text-accent-blue">Quick start</p><h1 className="mt-2 text-2xl font-semibold">See it work, end to end</h1><p className="mt-1 max-w-lg text-sm text-text-secondary">Connect a repository and watch your QA agents design, run, and report on real tests.</p></div>
        <button className="text-sm text-text-secondary hover:text-text-primary disabled:opacity-50" disabled={finishing} onClick={finish}>Skip for now</button>
      </header>
      <nav aria-label="Onboarding steps" className="mb-8 flex items-center">
        {steps.map((step, index) => <div key={step.id} className="flex flex-1 items-center">
          <div className="flex items-center gap-2">
            <span className={'flex h-9 w-9 shrink-0 items-center justify-center rounded-full border ' + (index < stepIndex ? 'border-success bg-success/10 text-success' : index === stepIndex ? 'border-accent-blue bg-accent-blue/10 text-accent-blue' : 'border-border text-text-secondary')}>
              {index < stepIndex ? <Check size={16} /> : <step.icon size={16} />}
            </span>
            <span className={'text-sm font-medium ' + (index === stepIndex ? 'text-text-primary' : 'text-text-secondary')}>{step.label}</span>
          </div>
          {index < steps.length - 1 && <div className="mx-3 h-px flex-1 bg-border" />}
        </div>)}
      </nav>
      <section className="rounded-xl border border-border bg-surface p-6">
        {activeStep === 'connect' && <ConnectRepoStep onConnected={id => { setSourceId(id); setStepIndex(1); }} />}
        {activeStep === 'design' && sourceId && <GenerateTestCasesStep sourceId={sourceId} onGenerated={cases => { setTestCases(cases); setStepIndex(2); }} />}
        {activeStep === 'run' && <ExecuteTestsStep testCases={testCases} onDone={next => { setResults(next); setStepIndex(3); }} />}
        {activeStep === 'coverage' && <CoverageStep testCases={testCases} results={results} onFinish={finish} finishing={finishing} />}
      </section>
    </div>
  </main>;
}
