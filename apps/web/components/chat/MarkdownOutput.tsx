'use client';

import { useMemo, useState } from 'react';
import { CheckCircle, ChevronDown, ChevronRight, Loader2, Wrench, XCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { AgentToolCall } from '@/lib/types';

export function ToolCallDisplay({ toolCall, onWatchLive }: { toolCall: AgentToolCall; onWatchLive?: (runId: string, testName: string) => void }) {
  const [expanded, setExpanded] = useState(false);

  const statusIcon = {
    pending: <Loader2 size={12} className="animate-spin text-text-secondary" />,
    running: <Loader2 size={12} className="animate-spin text-info" />,
    completed: <CheckCircle size={12} className="text-success" />,
    error: <XCircle size={12} className="text-danger" />,
  };

  return (
    <div className="my-2 overflow-hidden rounded-md border border-border bg-canvas font-mono">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center gap-2 bg-elevated px-3 py-2 text-left text-xs text-text-primary transition-colors hover:bg-surface"
      >
        {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        <Wrench size={13} className="text-accent-purple" />
        <span className="font-medium">{toolCall.name}</span>
        <span className="flex-1" />
        {toolCall.liveRunId && toolCall.status === 'running' && (
          <span
            role="button"
            tabIndex={0}
            onClick={(event) => { event.stopPropagation(); onWatchLive?.(toolCall.liveRunId!, toolCall.liveTestName || toolCall.name); }}
            className="inline-flex items-center gap-1 rounded-full bg-info/10 px-2 py-0.5 text-[10px] font-medium text-info hover:bg-info/20"
          >
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-info" />Watch in browser
          </span>
        )}
        {statusIcon[toolCall.status]}
      </button>
      {expanded && (
        <div className="border-t border-border bg-canvas px-3 py-2">
          <div className="mb-2">
            <p className="mb-1 text-[10px] text-text-secondary">arguments</p>
            <pre className="overflow-x-auto rounded bg-elevated p-2 text-[11px] text-info">
              {JSON.stringify(toolCall.arguments, null, 2)}
            </pre>
          </div>
          {toolCall.result && (
            <div>
              <p className="mb-1 text-[10px] text-text-secondary">result</p>
              <pre className="max-h-32 overflow-x-auto rounded bg-elevated p-2 text-[11px] text-text-primary">
                {toolCall.result}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

type MarkdownBlock =
  | { type: 'code'; lang: string; text: string }
  | { type: 'heading'; level: number; text: string }
  | { type: 'list'; ordered: boolean; items: string[] }
  | { type: 'hr' }
  | { type: 'p'; text: string };

export function parseMarkdownBlocks(content: string): MarkdownBlock[] {
  const lines = content.replace(/\r\n/g, '\n').split('\n');
  const blocks: MarkdownBlock[] = [];
  const listLine = /^\s*([-*]|\d+[.)])\s+(.*)$/;
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (/^```/.test(line.trim())) {
      const lang = line.trim().slice(3).trim();
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i].trim())) { codeLines.push(lines[i]); i++; }
      i++;
      blocks.push({ type: 'code', lang, text: codeLines.join('\n') });
      continue;
    }
    if (!line.trim()) { i++; continue; }
    const heading = /^(#{1,4})\s+(.*)$/.exec(line);
    if (heading) { blocks.push({ type: 'heading', level: heading[1].length, text: heading[2] }); i++; continue; }
    if (/^(-{3,}|\*{3,})\s*$/.test(line.trim())) { blocks.push({ type: 'hr' }); i++; continue; }
    const listMatch = listLine.exec(line);
    if (listMatch) {
      const ordered = /\d/.test(listMatch[1]);
      const items: string[] = [];
      while (i < lines.length) {
        const match = listLine.exec(lines[i]);
        if (!match) break;
        items.push(match[2]);
        i++;
      }
      blocks.push({ type: 'list', ordered, items });
      continue;
    }
    const paraLines: string[] = [];
    while (i < lines.length && lines[i].trim() && !/^```/.test(lines[i].trim()) && !/^#{1,4}\s+/.test(lines[i]) && !listLine.test(lines[i])) {
      paraLines.push(lines[i]);
      i++;
    }
    blocks.push({ type: 'p', text: paraLines.join('\n') });
  }
  return blocks;
}

export function renderInline(text: string, keyPrefix: string) {
  const pattern = /`([^`]+)`|\*\*([^*]+)\*\*|__([^_]+)__|\*([^*\n]+)\*|_([^_\n]+)_/g;
  const nodes: (string | JSX.Element)[] = [];
  let last = 0;
  let match: RegExpExecArray | null;
  let index = 0;
  while ((match = pattern.exec(text))) {
    if (match.index > last) nodes.push(text.slice(last, match.index));
    const key = keyPrefix + '-' + index++;
    if (match[1] !== undefined) nodes.push(<code key={key} className="rounded bg-elevated px-1.5 py-0.5 text-[12px] text-accent-blue">{match[1]}</code>);
    else if (match[2] !== undefined || match[3] !== undefined) nodes.push(<strong key={key} className="font-semibold text-text-primary">{match[2] ?? match[3]}</strong>);
    else nodes.push(<em key={key} className="italic">{match[4] ?? match[5]}</em>);
    last = match.index + match[0].length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

export function MarkdownOutput({ content }: { content: string }) {
  const blocks = useMemo(() => parseMarkdownBlocks(content), [content]);
  return (
    <div className="space-y-2.5">
      {blocks.map((block, index) => {
        if (block.type === 'code') return (
          <pre key={index} className="overflow-x-auto rounded-md bg-elevated px-3 py-2.5 text-[12px] leading-5 text-text-primary">
            {block.lang && <span className="mb-1 block select-none text-[10px] uppercase tracking-wide text-text-secondary">{block.lang}</span>}
            <code>{block.text}</code>
          </pre>
        );
        if (block.type === 'heading') return <p key={index} className={cn('font-semibold text-text-primary', block.level <= 2 ? 'text-[14px]' : 'text-[13px]')}>{renderInline(block.text, 'h' + index)}</p>;
        if (block.type === 'hr') return <hr key={index} className="border-border" />;
        if (block.type === 'list') return block.ordered
          ? <ol key={index} className="list-decimal space-y-1 pl-5">{block.items.map((item, i) => <li key={i}>{renderInline(item, 'li' + index + '-' + i)}</li>)}</ol>
          : <ul key={index} className="list-disc space-y-1 pl-5">{block.items.map((item, i) => <li key={i}>{renderInline(item, 'li' + index + '-' + i)}</li>)}</ul>;
        return <p key={index} className="whitespace-pre-wrap">{renderInline(block.text, 'p' + index)}</p>;
      })}
    </div>
  );
}
