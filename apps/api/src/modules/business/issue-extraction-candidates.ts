import type { CandidateDraft } from './extraction-candidates';

const BUG_LABEL = /\b(bug|defect|regression)\b/i;

/**
 * Grounded defect recognizer for issue-tracker documents. The *gate* (should this
 * document even be considered a defect report) comes from connector metadata
 * (a bug/defect label) — an auditable signal, not invented text — but the quote
 * itself is always sliced from the actual issue body, never from metadata.
 */
export function scanIssueExtractionCandidates(content: string, metadata: Record<string, unknown> | undefined): { drafts: CandidateDraft[]; excludedLines: number } {
  const labels = Array.isArray(metadata?.labels) ? (metadata!.labels as unknown[]).filter((label): label is string => typeof label === 'string') : [];
  if (!labels.some(label => BUG_LABEL.test(label))) return { drafts: [], excludedLines: 0 };

  const trimmed = content.trim();
  if (!trimmed) return { drafts: [], excludedLines: 0 };

  const start = content.indexOf(trimmed);
  const end = start + trimmed.length;
  const firstLineBreak = content.indexOf('\n', start);
  const nameEnd = firstLineBreak === -1 || firstLineBreak > end ? end : firstLineBreak;
  const name = content.slice(start, nameEnd).trim().slice(0, 200);
  if (!name) return { drafts: [], excludedLines: 0 };

  return {
    drafts: [{
      start, end,
      fields: [
        { path: '/name', start, end: nameEnd },
        { path: '/description', start, end },
      ],
      item: { type: 'defect', name, description: trimmed.slice(0, 500) },
    }],
    excludedLines: 0,
  };
}
