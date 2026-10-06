'use client';

import { useState } from 'react';
import { cn } from '@/lib/utils';

function prettifyKey(key: string): string {
  return key.replace(/_/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase());
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const ID_PATTERN = /^(?:[a-z0-9]+-){2,}[a-z0-9]+$|^tc-[a-f0-9]+$|^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;

function ExpandableText({ text, mono = false }: { text: string; mono?: boolean }) {
  const [open, setOpen] = useState(false);
  return <div>
    <p className={cn('whitespace-pre-wrap break-words text-sm', mono && 'font-mono text-xs text-text-secondary')}>{open ? text : text.slice(0, 280) + '…'}</p>
    <button type="button" onClick={() => setOpen((value) => !value)} className="mt-1 text-xs text-accent-blue">{open ? 'Show less' : 'Show more'}</button>
  </div>;
}

function Primitive({ value }: { value: string | number | boolean | null | undefined }) {
  if (value === null || value === undefined || value === '') return <span className="text-text-secondary">—</span>;
  if (typeof value === 'boolean') return <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-medium', value ? 'bg-success/10 text-success' : 'bg-elevated text-text-secondary')}>{value ? 'Yes' : 'No'}</span>;
  if (typeof value === 'number') return <span className="font-mono text-sm">{value}</span>;
  if (DATE_PATTERN.test(value)) {
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) return <span className="text-sm">{date.toLocaleString()}</span>;
  }
  if (value.length < 80 && ID_PATTERN.test(value)) return <span className="break-all rounded bg-elevated px-1.5 py-0.5 font-mono text-xs">{value}</span>;
  if (value.length > 280) return <ExpandableText text={value} mono={value.length > 600} />;
  return <span className="whitespace-pre-wrap break-words text-sm">{value}</span>;
}

function ChipList({ items }: { items: Array<string | number | boolean> }) {
  return <div className="flex flex-wrap gap-1.5">{items.map((item, index) => <span key={index} className="rounded-full bg-elevated px-2 py-0.5 text-xs">{String(item)}</span>)}</div>;
}

function ObjectTable({ items }: { items: Array<Record<string, unknown>> }) {
  const keys = Array.from(new Set(items.flatMap((item) => Object.keys(item))));
  return <div className="overflow-x-auto rounded-lg border border-border">
    <table className="w-full text-left text-sm">
      <thead className="bg-elevated/70 text-xs text-text-secondary"><tr>{keys.map((key) => <th key={key} className="whitespace-nowrap px-3 py-2 font-medium">{prettifyKey(key)}</th>)}</tr></thead>
      <tbody className="divide-y divide-border">{items.map((item, index) => <tr key={index} className="align-top">{keys.map((key) => <td key={key} className="px-3 py-2"><DataValue value={item[key]} depth={2} /></td>)}</tr>)}</tbody>
    </table>
  </div>;
}

function DataArray({ items, depth }: { items: unknown[]; depth: number }) {
  if (!items.length) return <span className="text-text-secondary">None</span>;
  const allPrimitive = items.every((item) => item === null || ['string', 'number', 'boolean'].includes(typeof item));
  if (allPrimitive) {
    const allShort = items.every((item) => typeof item !== 'string' || item.length <= 48);
    if (allShort) return <ChipList items={items as Array<string | number | boolean>} />;
    return <ul className="list-inside list-disc space-y-1 text-sm">{items.map((item, index) => <li key={index}>{String(item)}</li>)}</ul>;
  }
  const allObjects = items.every(isPlainObject);
  if (allObjects && depth <= 1) {
    const keyCount = new Set(items.flatMap((item) => Object.keys(item as Record<string, unknown>))).size;
    if (keyCount > 0 && keyCount <= 8) {
      const shown = items.slice(0, 50) as Array<Record<string, unknown>>;
      return <div className="space-y-2"><ObjectTable items={shown} />{items.length > 50 && <p className="text-xs text-text-secondary">+{items.length - 50} more rows</p>}</div>;
    }
  }
  const shown = items.slice(0, 20);
  return <div className="space-y-2">
    {shown.map((item, index) => <div key={index} className="rounded-lg border border-border p-3"><DataValue value={item} depth={depth + 1} /></div>)}
    {items.length > 20 && <p className="text-xs text-text-secondary">+{items.length - 20} more</p>}
  </div>;
}

function DataObject({ value, depth }: { value: Record<string, unknown>; depth: number }) {
  const entries = Object.entries(value).filter(([, item]) => item !== undefined);
  if (!entries.length) return <span className="text-text-secondary">—</span>;
  return <dl className={cn('space-y-3', depth === 0 && 'divide-y divide-border rounded-lg border border-border p-3')}>
    {entries.map(([key, item]) => <div key={key} className={cn(depth === 0 && 'pt-3 first:pt-0')}>
      <dt className="text-xs font-medium text-text-secondary">{prettifyKey(key)}</dt>
      <dd className="mt-1">{<DataValue value={item} depth={depth + 1} />}</dd>
    </div>)}
  </dl>;
}

function DataValue({ value, depth }: { value: unknown; depth: number }) {
  if (Array.isArray(value)) return <DataArray items={value} depth={depth} />;
  if (isPlainObject(value)) return <DataObject value={value} depth={depth} />;
  return <Primitive value={value as string | number | boolean | null | undefined} />;
}

/** Turns an arbitrary workflow-report JSON value into a readable panel: tables for lists of
 * similar records, chips for lists of plain values, labeled rows for objects. Falls back
 * gracefully for shapes it doesn't specially recognize — there is always something to show. */
export function DataView({ value }: { value: unknown }) {
  return <DataValue value={value} depth={0} />;
}

export function RawJson({ value }: { value: unknown }) {
  return <details><summary className="cursor-pointer text-sm text-accent-blue">View raw JSON</summary><pre className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-elevated p-3 text-xs">{JSON.stringify(value, null, 2)}</pre></details>;
}
