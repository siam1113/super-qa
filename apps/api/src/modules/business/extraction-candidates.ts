import type { CreateBusinessItemDto } from './business.service';

interface Span { start: number; end: number }
interface FieldSpan extends Span { path: string }
export interface CandidateDraft extends Span {
  item: CreateBusinessItemDto;
  fields: FieldSpan[];
}

interface SourceLine extends Span {
  text: string;
  allowed: boolean;
}

const excludedText = /\b(example|deprecated|obsolete|todo|maybe|perhaps|ignore previous|system prompt)\b/i;

function field(line: SourceLine, value: string, path: string, from = 0): FieldSpan {
  const position = line.text.indexOf(value, from);
  if (position < 0) throw new Error('Extraction field is not present in its source line');
  return { path, start: line.start + position, end: line.start + position + value.length };
}

function inlineCandidate(line: SourceLine): CandidateDraft | undefined {
  const text = line.text.trim().replace(/^[-*]\s+/, '');
  if (excludedText.test(text)) return;
  const statement = /^(?:(business rule|rule)|(requirement|req)):\s*(\S.+)$/i.exec(text);
  const obligation = /^(?:(?:the )?(?:system|application|service|platform)|users?|guests?|administrators?|customers?|clients?|servers?)\s+(?:must|shall)\s+\S.+[.!]$/i.test(text) && !text.includes('?');
  if ((statement && !text.includes('?') && /\b(must|shall|required)\b/i.test(statement[3]) && statement[3].length >= 12) || obligation) {
    const type = statement?.[1] ? 'rule' : 'requirement';
    const value = statement ? statement[3] : text;
    const name = value.slice(0, 200);
    const fields = [field(line, name, '/name'), field(line, value, '/description')];
    if (type === 'rule') fields.push(field(line, value, '/content/action'));
    return { start: line.start, end: line.end, fields, item: {
      type, name, description: value, ...(type === 'rule' ? { content: { condition: '', action: value } } : {}),
    } };
  }
  const api = /^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s+(\/[A-Za-z0-9_/{\}:.-]*)(?:\s+[-–]\s+(.+))?$/.exec(text);
  if (api) return { start: line.start, end: line.end, fields: [
    field(line, api[1], '/content/method'), field(line, api[2], '/content/endpoint'), field(line, text, '/description'),
    field(line, api[1], '/name'), field(line, api[2], '/name'),
    ...(api[3] ? [field(line, api[3], '/content/description', line.text.indexOf(api[2]) + api[2].length)] : []),
  ], item: {
    type: 'api', name: `${api[1]} ${api[2]}`, description: text,
    content: { method: api[1], endpoint: api[2], ...(api[3] ? { description: api[3] } : {}) },
  } };
  const fact = /^Fact:\s*([^=\n]+?)\s*=\s*(-?\d+(?:\.\d+)?)(?:\s+([a-zA-Z%]+))?$/i.exec(text);
  if (fact) return { start: line.start, end: line.end, fields: [
    field(line, text.slice(0, 200), '/name'), field(line, text, '/description'),
    field(line, fact[2], '/content/value', line.text.indexOf('=') + 1),
    ...(fact[3] ? [field(line, fact[3], '/content/unit', line.text.indexOf('=') + 1)] : []),
  ], item: { type: 'fact', name: text.slice(0, 200), description: text, content: { value: fact[2], ...(fact[3] ? { unit: fact[3] } : {}) } } };
  const constraint = /^(?:Constraint|Limit):\s*(\S.+)$/i.exec(text);
  if (constraint) {
    const value = constraint[1];
    const name = value.slice(0, 200);
    return { start: line.start, end: line.end, fields: [
      field(line, name, '/name'), field(line, value, '/description'),
    ], item: { type: 'constraint', name, description: value, content: { type: 'custom', value } } };
  }
}

function blockHeader(text: string): { type: 'flow' | 'test_case'; name: string; supported: boolean } | undefined {
  const body = text.trim().replace(/^#{1,6}\s+/, '');
  const flow = /^(?:flow|workflow):\s*(.+)$/i.exec(body) || /^(.+?)\s+(?:flow|workflow):$/i.exec(body);
  if (flow) return { type: 'flow', name: flow[1], supported: true };
  const scenario = /^Scenario( Outline)?:\s*(.+)$/i.exec(body);
  if (scenario) return { type: 'test_case', name: scenario[2], supported: !scenario[1] };
}

function blockCandidate(content: string, lines: SourceLine[], header: NonNullable<ReturnType<typeof blockHeader>>): CandidateDraft | undefined {
  if (!header.supported || lines.some(line => excludedText.test(line.text))) return;
  const first = lines[0];
  const last = lines[lines.length - 1];
  const fields: FieldSpan[] = [field(first, header.name.slice(0, 200), '/name'), { path: '/description', start: first.start, end: last.end }];
  const base = { type: header.type, name: header.name.slice(0, 200), description: content.slice(first.start, last.end) };
  if (header.type === 'flow') {
    const steps: Array<{ order: number; name: string }> = [];
    for (const line of lines.slice(1)) {
      const match = /^\s*(\d+)[.)]\s+(\S.*?)\s*$/.exec(line.text);
      if (!match || Number(match[1]) !== steps.length + 1) return;
      fields.push(field(line, match[1], `/content/steps/${steps.length}/order`));
      fields.push(field(line, match[2], `/content/steps/${steps.length}/name`, line.text.indexOf(match[1]) + match[1].length));
      steps.push({ order: Number(match[1]), name: match[2] });
    }
    if (steps.length < 2) return;
    return { start: first.start, end: last.end, fields, item: { ...base, content: { steps } } };
  }
  const preconditions: string[] = [];
  const actions: string[] = [];
  const expectations: string[] = [];
  let phase: 'given' | 'when' | 'then' | undefined;
  for (const line of lines.slice(1)) {
    const match = /^\s*(Given|When|Then|And|But)\s+(\S.*?)\s*$/.exec(line.text);
    if (!match || /[<>]/.test(match[2])) return;
    if (match[1] === 'Given') { if (phase && phase !== 'given') return; phase = 'given'; }
    if (match[1] === 'When') { if (phase !== 'given') return; phase = 'when'; }
    if (match[1] === 'Then') { if (phase !== 'when') return; phase = 'then'; }
    if (!phase) return;
    const path = phase === 'given' ? `/content/preconditions/${preconditions.length}` : `/content/steps/0/${phase === 'when' ? 'action' : 'expected'}`;
    fields.push(field(line, match[2], path, line.text.indexOf(match[1]) + match[1].length));
    (phase === 'given' ? preconditions : phase === 'when' ? actions : expectations).push(match[2]);
  }
  if (!preconditions.length || !actions.length || !expectations.length) return;
  return { start: first.start, end: last.end, fields, item: { ...base, content: {
    preconditions, steps: [{ order: 1, action: actions.join('\n'), expected: expectations.join('\n') }],
  } } };
}

export function scanExtractionCandidates(content: string): { drafts: CandidateDraft[]; excludedLines: number } {
  if (content.length > 1_000_000) throw new Error('Extraction document budget exceeded');
  const lines: SourceLine[] = [];
  let offset = 0;
  let fence: string | undefined;
  let excludedSectionLevel: number | undefined;
  for (const raw of content.split('\n')) {
    const text = raw.endsWith('\r') ? raw.slice(0, -1) : raw;
    const marker = /^\s*(`{3,}|~{3,})/.exec(text)?.[1];
    const heading = /^ {0,3}(#{1,6})\s+(.+)/.exec(text);
    let allowed = !fence && !marker && !/^\s*>|^(?: {4}|\t)/.test(text);
    if (allowed && heading) {
      if (excludedSectionLevel !== undefined && heading[1].length <= excludedSectionLevel) excludedSectionLevel = undefined;
      if (excludedSectionLevel === undefined && /\b(examples?|deprecated|obsolete|historical|draft|proposed|templates?)\b/i.test(heading[2])) excludedSectionLevel = heading[1].length;
    }
    if (marker) {
      if (!fence) fence = marker;
      else if (marker[0] === fence[0] && marker.length >= fence.length && text.trim() === marker) fence = undefined;
    }
    allowed = allowed && excludedSectionLevel === undefined;
    lines.push({ text, start: offset, end: offset + text.length, allowed });
    offset += raw.length + 1;
  }
  const drafts: CandidateDraft[] = [];
  const covered = new Set<number>();
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    if (!line.allowed || !line.text.trim()) continue;
    const header = blockHeader(line.text);
    let endIndex = index;
    let draft: CandidateDraft | undefined;
    if (header) {
      while (endIndex + 1 < lines.length && lines[endIndex + 1].allowed && lines[endIndex + 1].text.trim() &&
             !/^\s*#{1,6}\s/.test(lines[endIndex + 1].text) && !blockHeader(lines[endIndex + 1].text)) endIndex++;
      if (endIndex - index > 50 || lines[endIndex].end - line.start > 8000) throw new Error('Extraction block budget exceeded');
      draft = blockCandidate(content, lines.slice(index, endIndex + 1), header);
    } else draft = inlineCandidate(line);
    if (draft) {
      if (!header && line.text.length > 2000) throw new Error('Extraction claim budget exceeded');
      drafts.push(draft);
      for (let coveredIndex = index; coveredIndex <= endIndex; coveredIndex++) covered.add(coveredIndex);
    }
    index = endIndex;
  }
  return { drafts, excludedLines: lines.filter((line, index) => line.text.trim() && !covered.has(index)).length };
}
