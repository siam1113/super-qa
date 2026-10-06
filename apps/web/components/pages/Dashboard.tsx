'use client';

import { useAppStore } from '@/lib/store';

export function Dashboard() {
  const { stats, executions, testCases, healingSuggestions, setCurrentPage, openInspector } = useAppStore();
  const metrics = [
    ['Passed observations', stats?.passed ?? 'Unavailable'],
    ['Failed observations', stats?.failed ?? 'Unavailable'],
    ['Pending executions', executions.filter(item => item.status === 'pending').length],
    ['Persisted cases', testCases.length],
    ['Pending healing reviews', healingSuggestions.filter(item => item.status === 'pending').length],
    ['AI confidence', 'Not measured'],
  ];

  return <div className="p-6 space-y-6 overflow-y-auto h-full">
    <div className="flex items-center justify-between">
      <div>
        <h1 className="text-xl font-semibold">Executions</h1>
        <p className="mt-1 text-sm leading-5 text-text-secondary">Manual run outcomes and recorded observations.</p>
      </div>
      <button onClick={() => setCurrentPage('test-cases')} className="px-4 py-2 bg-accent-blue text-white rounded-lg">Open test cases</button>
    </div>
    <div className="grid md:grid-cols-3 gap-4">
      {metrics.map(([label, value]) => <div key={label} className="bg-surface border border-border rounded-xl p-4">
        <p className="text-sm text-text-secondary">{label}</p>
        <p className="text-2xl font-semibold mt-2">{value}</p>
      </div>)}
    </div>
    <section className="bg-surface border border-border rounded-xl p-4 space-y-3">
      <h2 className="font-medium">Recent executions</h2>
      {executions.length === 0 && <p className="text-text-secondary">No executions recorded.</p>}
      {executions.slice(0, 10).map((execution, index) => <button key={index} onClick={() => openInspector('execution', execution)} className="flex w-full justify-between text-sm border-b border-border py-2 text-left">
        <span>{execution.testName} · {execution.environment}</span>
        <span>{execution.status} · {execution.duration == null ? 'Not measured' : `${execution.duration}s`}</span>
      </button>)}
    </section>
    <section className="space-y-2">
      <h2 className="font-medium">Pending healing decisions</h2>
      {healingSuggestions.filter(item => item.status === 'pending').map(item => <button key={item.id} className="block text-sm text-accent-blue" onClick={() => openInspector('healing', item)}>{item.issue}</button>)}
    </section>
    <p className="text-sm text-text-secondary">Coverage, model accuracy and cost savings are not measured yet. Healing approval records a decision; it does not apply code changes.</p>
  </div>;
}
