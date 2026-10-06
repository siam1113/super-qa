'use client';

import { FormEvent, useState } from 'react';
import { CornerUpLeft, X } from 'lucide-react';
import { MeetingActivityEntry } from '@/lib/meetings';

const SYSTEM_LABEL: Record<string, (name: string) => string> = {
  human_joined: name => name + ' joined the call',
  human_left: name => name + ' left the call',
  agent_joined: name => name + ' connected',
  agent_left: name => name + ' disconnected',
  meeting_ended: name => (name ? name + ' ended the meeting' : 'Meeting ended'),
};

function timeLabel(value: string) {
  return new Date(value).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

export function MeetingActivity({ onClose, activity, onPost, busy }: { onClose: () => void; activity: MeetingActivityEntry[]; onPost: (text: string, replyToId?: string) => Promise<void>; busy?: boolean }) {
  const [text, setText] = useState('');
  const [replyingTo, setReplyingTo] = useState<MeetingActivityEntry | null>(null);
  const [sending, setSending] = useState(false);
  const byId = new Map(activity.map(entry => [entry.id, entry]));
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!text.trim() || sending) return;
    setSending(true);
    try { await onPost(text.trim(), replyingTo?.id); setText(''); setReplyingTo(null); }
    finally { setSending(false); }
  };
  return <aside className="call-transcript-panel" aria-label="Meeting activity">
    <header><h3>Activity</h3><button aria-label="Close activity" onClick={onClose}><X size={18} /></button></header>
    <div role="log" aria-label="Meeting activity log">
      {activity.length ? activity.map(entry => {
        if (entry.kind === 'message') {
          const replyTarget = entry.replyToId ? byId.get(entry.replyToId) : null;
          return <article key={entry.id} className="call-activity-message">
            {replyTarget && <p className="call-activity-reply-ref">Replying to {replyTarget.authorName || 'a message'}: “{(replyTarget.text || '').slice(0, 80)}”</p>}
            <p>{entry.authorName || 'Someone'} <span className="call-activity-time">{timeLabel(entry.createdAt)}</span></p>
            <span>{entry.text}</span>
            <button type="button" className="call-activity-reply-button" onClick={() => setReplyingTo(entry)}><CornerUpLeft size={12} /> Reply</button>
          </article>;
        }
        const label = SYSTEM_LABEL[entry.kind]?.(entry.authorName || '') || entry.kind;
        return <p key={entry.id} className="call-activity-system">{label} · {timeLabel(entry.createdAt)}</p>;
      }) : <p>No activity yet. Joins, leaves, and messages for this call will appear here.</p>}
    </div>
    <form onSubmit={submit}>
      {replyingTo && <div className="call-activity-replying" role="status">
        <span>Replying to {replyingTo.authorName || 'a message'}: “{(replyingTo.text || '').slice(0, 60)}”</span>
        <button type="button" aria-label="Cancel reply" onClick={() => setReplyingTo(null)}><X size={14} /></button>
      </div>}
      <input aria-label="Write a message" maxLength={4000} value={text} onChange={event => setText(event.target.value)} placeholder="Write a message…" disabled={busy} />
      <button disabled={sending || busy || !text.trim()}>Send</button>
    </form>
  </aside>;
}
