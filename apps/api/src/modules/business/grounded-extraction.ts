import { createHash } from 'crypto';
import { isDeepStrictEqual } from 'util';
import { scanExtractionCandidates } from './extraction-candidates';
import { scanCodeExtractionCandidates } from './code-extraction-candidates';
import { scanIssueExtractionCandidates } from './issue-extraction-candidates';
import type { CreateBusinessItemDto } from './business.service';
import type { ExtractionResult } from './business-extraction.service';
import type { IExtractionProvider, ValidationRequest } from './extraction-providers/extraction-provider.interface';

export const EXTRACTION_VERSION = 'grounded-sections-v2';

export interface EvidenceDocument {
  id: string;
  sourceId: string;
  title?: string;
  content: string;
  revisionHash?: string;
  type?: string;
  metadata?: Record<string, unknown>;
}

interface Evidence {
  sourceId: string;
  documentId: string;
  contentHash: string;
  revisionHash?: string;
  start: number;
  end: number;
  quote: string;
  fields: Array<{ path: string; start: number; end: number; quote: string }>;
}

interface Candidate {
  item: CreateBusinessItemDto;
  evidence: Evidence[];
}

export interface ExtractionReport {
  version: string;
  candidates: number;
  accepted: number;
  rejected: number;
  excludedLines: number;
  provider: string;
  providerCalls: number;
  inputTokens: number;
  outputTokens: number;
  usageComplete: boolean;
}

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value && typeof value === 'object') return Object.fromEntries(
    Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key, child]) => [key, canonicalValue(child)]),
  );
  return value;
}

function claimKey(item: CreateBusinessItemDto): string {
  return JSON.stringify(canonicalValue([item.type, item.name, item.description, item.content || null]));
}

function candidatesFrom(document: EvidenceDocument): { candidates: Candidate[]; excludedLines: number } {
  const base = document.type === 'code'
    ? scanCodeExtractionCandidates(document.content)
    : scanExtractionCandidates(document.content);
  // Defect detection is additive: an issue can still carry rule/requirement/constraint
  // prose worth extracting alongside its bug-label-gated defect candidate.
  const extra = document.type === 'issue' ? scanIssueExtractionCandidates(document.content, document.metadata) : { drafts: [], excludedLines: 0 };
  const drafts = [...base.drafts, ...extra.drafts];
  const excludedLines = base.excludedLines;
  const contentHash = createHash('sha256').update(document.content).digest('hex');
  const candidates = new Map<string, Candidate>();
  const identities = new Map<string, string>();
  for (const draft of drafts) {
    const evidence: Evidence = {
      sourceId: document.sourceId, documentId: document.id, contentHash,
      ...(document.revisionHash ? { revisionHash: document.revisionHash } : {}),
      start: draft.start, end: draft.end, quote: document.content.slice(draft.start, draft.end),
      fields: draft.fields.map(span => ({ ...span, quote: document.content.slice(span.start, span.end) })),
    };
    const key = claimKey(draft.item);
    const identity = JSON.stringify([draft.item.type, draft.item.name]);
    if (identities.has(identity) && identities.get(identity) !== key) throw new Error('Ambiguous extraction identity; review conflicting claims before publication');
    identities.set(identity, key);
    const existing = candidates.get(key);
    if (existing) existing.evidence.push(evidence);
    else candidates.set(key, { item: draft.item, evidence: [evidence] });
    if (candidates.size > 64) throw new Error('Extraction candidate budget exceeded');
  }
  return { candidates: [...candidates.values()], excludedLines };
}

export async function extractGrounded(document: EvidenceDocument, provider: IExtractionProvider, forceExtract = false): Promise<ExtractionResult & { report: ExtractionReport }> {
  const discovered = candidatesFrom(document);
  const candidates = discovered.candidates;
  const excludedLines = discovered.excludedLines;
  let discoveryUsage: { inputTokens: number; outputTokens: number } | undefined;
  let discoveryCalls = 0;
  if (forceExtract && provider.discoverCandidates && candidates.length < 16) {
    // Explicit force extract asks the configured model to find claims that the
    // deterministic syntax recognizer cannot identify in ordinary prose.
    const result = await provider.discoverCandidates({ title: document.title || '', content: document.content });
    discoveryCalls = 1;
    discoveryUsage = result.usage;
    const identities = new Map(candidates.map(candidate => [JSON.stringify([candidate.item.type, candidate.item.name]), claimKey(candidate.item)]));
    for (const proposal of result.candidates) {
      if (candidates.length >= 15) break; // one discovery call + at most 15 validations
      const quote = proposal.evidenceQuote;
      const start = document.content.indexOf(quote);
      if (start < 0 || quote.length > 8000 || !quote.includes(proposal.name) || !quote.includes(proposal.description)) continue;
      const item = { type: proposal.type, name: proposal.name, description: proposal.description } as CreateBusinessItemDto;
      const key = claimKey(item);
      const identity = JSON.stringify([item.type, item.name]);
      const previous = identities.get(identity);
      if (previous && previous !== key) throw new Error('Ambiguous extraction identity; review conflicting claims before publication');
      if (previous) continue;
      identities.set(identity, key);
      const contentHash = createHash('sha256').update(document.content).digest('hex');
      candidates.push({ item, evidence: [{
        sourceId: document.sourceId, documentId: document.id, contentHash,
        ...(document.revisionHash ? { revisionHash: document.revisionHash } : {}),
        start, end: start + quote.length, quote,
        fields: [proposal.name, proposal.description].map((value, index) => {
          const fieldStart = start + quote.indexOf(value);
          return { path: index === 0 ? '/name' : '/description', start: fieldStart, end: fieldStart + value.length, quote: value };
        }),
      }] });
    }
  }
  if (provider.getName() !== 'local' && candidates.length > 16) throw new Error('Extraction provider call budget exceeded');
  const deadline = Date.now() + 60_000;
  const items: CreateBusinessItemDto[] = [];
  const report: ExtractionReport = {
    version: EXTRACTION_VERSION, candidates: candidates.length, accepted: 0, rejected: 0,
    excludedLines, provider: provider.getName(), providerCalls: discoveryCalls, inputTokens: discoveryUsage?.inputTokens || 0,
    outputTokens: discoveryUsage?.outputTokens || 0, usageComplete: !discoveryCalls || Boolean(discoveryUsage),
  };
  for (const candidate of candidates) {
    if (Date.now() >= deadline) throw new Error('Extraction time budget exceeded');
    let validation: Record<string, unknown> = { method: 'explicit-source-pattern' };
    if (provider.getName() !== 'local') {
      report.providerCalls++;
      const result = await provider.validate({
        text: candidate.evidence[0].quote,
        fullDocument: document.content,
        type: candidate.item.type === 'test_case' ? 'testCase' : candidate.item.type as ValidationRequest['type'],
      });
      if (Date.now() >= deadline) throw new Error('Extraction time budget exceeded');
      if (!Number.isFinite(result.confidence) || result.confidence < 0 || result.confidence > 100 || typeof result.reason !== 'string') {
        throw new Error('Invalid extraction validation result');
      }
      if (result.usage) {
        if (![result.usage.inputTokens, result.usage.outputTokens].every(value => Number.isSafeInteger(value) && value >= 0)) {
          throw new Error('Invalid extraction usage result');
        }
        report.inputTokens += result.usage.inputTokens;
        report.outputTokens += result.usage.outputTokens;
      } else report.usageComplete = false;
      if (result.confidence < 60) { report.rejected++; continue; }
      validation = { method: 'provider-classification', score: result.confidence, reason: result.reason };
    }
    items.push({
      ...candidate.item, sourceId: document.sourceId, documentId: document.id,
      confidence: 'inferred', tags: ['auto-extracted', 'evidence-backed', 'proposal'],
      metadata: { extractionVersion: EXTRACTION_VERSION, evidence: candidate.evidence, validation, provider: provider.getName() },
    });
  }
  report.accepted = items.length;
  return { items, relationships: [], report };
}

export function assertExtractionEvidence(extraction: ExtractionResult, document: EvidenceDocument): void {
  if (!Array.isArray(extraction.items) || !Array.isArray(extraction.relationships) || extraction.relationships.length) {
    throw new Error('Invalid extraction evidence contract');
  }
  const candidates = new Map(candidatesFrom(document).candidates.map(candidate => [claimKey(candidate.item), candidate]));
  const seen = new Set<string>();
  const allowedFields = new Set(['type', 'name', 'description', 'content', 'sourceId', 'documentId', 'confidence', 'tags', 'metadata']);
  for (const item of extraction.items) {
    if (!item || Object.keys(item).some(key => !allowedFields.has(key))) throw new Error('Invalid extraction item fields');
    const key = claimKey(item);
    const candidate = candidates.get(key);
    if (seen.has(key) || item.sourceId !== document.sourceId || item.documentId !== document.id ||
        item.confidence !== 'inferred' || item.metadata?.extractionVersion !== EXTRACTION_VERSION ||
        !isDeepStrictEqual(item.tags, ['auto-extracted', 'evidence-backed', 'proposal'])) {
      throw new Error('Extraction evidence does not support the published claim');
    }
    if (candidate) {
      if (!isDeepStrictEqual(item.metadata?.evidence, candidate.evidence)) throw new Error('Extraction evidence does not match the reconstructed claim');
    } else {
      assertDiscoveredEvidence(item, document);
    }
    seen.add(key);
  }
}

function pointerValue(value: any, path: string): any {
  return path.split('/').slice(1).map(part => part.replace(/~1/g, '/').replace(/~0/g, '~'))
    .reduce((current, part) => current == null ? undefined : current[part], value);
}

function assertDiscoveredEvidence(item: CreateBusinessItemDto, document: EvidenceDocument): void {
  const evidence = item.metadata?.evidence;
  if (!Array.isArray(evidence) || !evidence.length ||
      !['openai', 'anthropic'].includes(item.metadata?.provider) ||
      item.metadata?.validation?.method !== 'provider-classification' ||
      !Number.isFinite(item.metadata?.validation?.score) || item.metadata.validation.score < 60) {
    throw new Error('Discovered extraction is missing provider validation or source evidence');
  }
  for (const occurrence of evidence) {
    if (occurrence.sourceId !== document.sourceId || occurrence.documentId !== document.id ||
        occurrence.contentHash !== createHash('sha256').update(document.content).digest('hex') ||
        (document.revisionHash && occurrence.revisionHash !== document.revisionHash) ||
        !Number.isSafeInteger(occurrence.start) || !Number.isSafeInteger(occurrence.end) ||
        occurrence.start < 0 || occurrence.end <= occurrence.start || occurrence.end > document.content.length ||
        occurrence.end - occurrence.start > 8000 || occurrence.quote !== document.content.slice(occurrence.start, occurrence.end) ||
        !Array.isArray(occurrence.fields) || !occurrence.fields.length) {
      throw new Error('Discovered extraction contains invalid source evidence');
    }
    const byPath = new Map<string, string[]>();
    for (const field of occurrence.fields) {
      if (!field || !['/name', '/description'].includes(field.path) ||
          !Number.isSafeInteger(field.start) || !Number.isSafeInteger(field.end) ||
          field.start < occurrence.start || field.end <= field.start || field.end > occurrence.end ||
          field.quote !== document.content.slice(field.start, field.end) || !field.quote) {
        throw new Error('Discovered extraction contains invalid field evidence');
      }
      byPath.set(field.path, [...(byPath.get(field.path) || []), field.quote]);
    }
    if (!byPath.has('/name') || !byPath.has('/description') ||
        !occurrence.quote.includes(item.name) || !occurrence.quote.includes(item.description || '')) {
      throw new Error('Discovered extraction claim is not present in its cited source passage');
    }
    for (const [path, quotes] of byPath) {
      const value = pointerValue(item, path);
      if (value === undefined || quotes.some(quote => !String(value).includes(quote))) {
        throw new Error('Discovered extraction field is not supported by its cited source text');
      }
    }
  }
}
