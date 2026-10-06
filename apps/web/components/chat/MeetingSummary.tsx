'use client';

import { MeetingDetail } from '@/lib/meetings';
import { primaryClass, secondaryClass } from './ChatDialog';

export function MeetingSummary({ detail, busy, canOperate, onCompile, onPublish }: { detail: MeetingDetail; busy: boolean; canOperate: boolean; onBack?: () => void; onCompile: () => void; onPublish: (id: string) => void }) {
  const notes = detail.runs.filter(run => run.kind === 'notes');
  const pending = notes.some(run => ['queued', 'running'].includes(run.status));
  return <section className="space-y-5">
    {canOperate && <div className="flex justify-end"><button className={primaryClass} disabled={busy || pending || !detail.entries.length || detail.meeting.shareTranscriptWithAgents === false} onClick={onCompile}>{pending ? 'Preparing notes…' : notes.length ? 'Update notes' : 'Compile notes'}</button></div>}
    {detail.meeting.shareTranscriptWithAgents === false && <p className="text-sm text-text-secondary">Transcript sharing was off for this call.</p>}
    {!notes.length && <p className="text-sm text-text-secondary">{detail.entries.length ? 'Your transcript is ready. Compile it into notes and follow-ups.' : 'No speech was captured for this call.'}</p>}
    {notes.map(run => <article key={run.id} className="space-y-4 rounded-xl border border-border p-5">
      {['queued', 'running'].includes(run.status) && <p role="status" className="text-sm text-text-secondary">Preparing your meeting notes…</p>}
      {run.error && <p role="alert" className="text-sm text-warning">{run.error}</p>}
      {run.result && <><p className="whitespace-pre-wrap text-sm leading-7">{run.result.summary}</p>{run.result.items.map((item, index) => <div key={index} className="border-l-2 border-accent-blue/40 pl-3"><p className="text-sm">{item.text}</p><div className="mt-2 flex flex-wrap gap-3">{item.evidence.map(id => { const speaker = detail.entries.find(entry => entry.id === id)?.speaker || 'Transcript entry'; return <a className="text-xs text-accent-blue underline" href={'#summary-entry-' + id} key={id}>{speaker}</a>; })}</div></div>)}{canOperate && <button className={secondaryClass} disabled={busy || Boolean(run.publishedMessageId)} onClick={() => onPublish(run.id)}>{run.publishedMessageId ? 'Published to conversation' : 'Approve & publish notes'}</button>}</>}
    </article>)}
    {detail.entries.length > 0 && <section className="space-y-3 border-t border-border pt-4" aria-label="Meeting transcript"><h3 className="text-sm font-medium">Transcript</h3><div className="max-h-64 space-y-4 overflow-y-auto">{detail.entries.map(entry => <article key={entry.id} id={'summary-entry-' + entry.id}><p className="text-xs text-text-secondary">{entry.speaker}</p><p className="mt-1 whitespace-pre-wrap text-sm leading-6">{entry.text}</p></article>)}</div></section>}
  </section>;
}
