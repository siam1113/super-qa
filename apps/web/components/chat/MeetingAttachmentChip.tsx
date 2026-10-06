'use client';

import { History, X } from 'lucide-react';

export function MeetingAttachmentChip({ title, wordCount, tokenCount, onOpen, onRemove }: { title: string; wordCount?: number; tokenCount?: number; onOpen: () => void; onRemove?: () => void }) {
  return <span className="meeting-attachment-chip">
    <button type="button" className="meeting-attachment-chip-open" onClick={onOpen}>
      <History size={12} />
      <span className="truncate">{title}</span>
      {typeof wordCount === 'number' && <span className="meeting-meta-chip meeting-meta-chip--blue">{wordCount} words</span>}
      {typeof tokenCount === 'number' && <span className="meeting-meta-chip meeting-meta-chip--purple">{tokenCount} tokens</span>}
    </button>
    {onRemove && <button type="button" aria-label="Remove meeting attachment" className="meeting-attachment-chip-remove" onClick={onRemove}><X size={12} /></button>}
  </span>;
}
