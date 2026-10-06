import type { CreateBusinessItemDto } from './business.service';
import type { CandidateDraft } from './extraction-candidates';

const EXCLUDED_TEXT = /\b(deprecated|obsolete|todo|fixme)\b/i;
const METHOD_FIELD = /\bmethod\s*:\s*(['"`])(get|post|put|patch|delete|head|options)\1/i;
const FETCH_METHOD_LOOKAHEAD = 400;

// Constructed fresh per call (not module-level) since these carry the 'g' flag:
// a shared RegExp's mutable lastIndex would corrupt concurrent extraction of
// different documents interleaved on the same event loop (Bull runs this
// processor at concurrency 2).
const API_CALL_SOURCE = '\\b(axios|app|router)\\.(get|post|put|patch|delete)\\s*\\(\\s*([\'"`])|\\bfetch\\s*\\(\\s*([\'"`])';
const GUARD_THROW_SOURCE = '\\bif\\s*\\(([^()]{3,200})\\)\\s*\\{?[ \\t]*\\n[ \\t]*throw\\s+new\\s+(Error|TypeError|RangeError)\\s*\\(\\s*([\'"`])';
const INLINE_GUARD_THROW_SOURCE = '\\bif\\s*\\(([^()]{3,200})\\)\\s*throw\\s+new\\s+(Error|TypeError|RangeError)\\s*\\(\\s*([\'"`])';

function literalAt(content: string, quote: string, openIndex: number): { value: string; end: number } | undefined {
  let index = openIndex;
  while (index < content.length && content[index] !== '\n') {
    if (content[index] === '\\') { index += 2; continue; }
    if (content[index] === quote) return { value: content.slice(openIndex, index), end: index + 1 };
    index++;
  }
  return undefined;
}

function lineStart(content: string, from: number): number {
  return content.lastIndexOf('\n', from) + 1;
}

function lineEnd(content: string, from: number): number {
  const index = content.indexOf('\n', from);
  return index === -1 ? content.length : index;
}

function apiCandidates(content: string): CandidateDraft[] {
  const drafts: CandidateDraft[] = [];
  const apiCall = new RegExp(API_CALL_SOURCE, 'gi');
  let match: RegExpExecArray | null;
  while ((match = apiCall.exec(content))) {
    const isNamedVerb = Boolean(match[1]);
    const quote = isNamedVerb ? match[3] : match[4];
    const openIndex = match.index + match[0].length;
    const literal = literalAt(content, quote, openIndex);
    if (!literal || !literal.value.includes('/') || EXCLUDED_TEXT.test(literal.value)) continue;

    let method = isNamedVerb ? match[2].toUpperCase() : undefined;
    let methodField: { start: number; end: number } | undefined;
    let end = lineEnd(content, literal.end);

    if (!method) {
      const windowEnd = Math.min(content.length, literal.end + FETCH_METHOD_LOOKAHEAD);
      const lookahead = content.slice(literal.end, windowEnd);
      const methodMatch = METHOD_FIELD.exec(lookahead);
      if (methodMatch) {
        method = methodMatch[2].toUpperCase();
        const absoluteStart = literal.end + methodMatch.index + methodMatch[0].indexOf(methodMatch[2]);
        methodField = { start: absoluteStart, end: absoluteStart + methodMatch[2].length };
        end = Math.max(end, lineEnd(content, methodField.end));
      }
    }

    const start = lineStart(content, match.index);
    const endpoint = literal.value;
    const endpointField = { start: openIndex, end: literal.end - 1 };
    const name = (method ? `${method} ${endpoint}` : endpoint).slice(0, 200);
    const descriptionField = { start, end: lineEnd(content, match.index) };

    drafts.push({
      start, end,
      fields: [
        { path: '/content/endpoint', ...endpointField },
        ...(methodField ? [{ path: '/content/method', ...methodField }] : []),
        { path: '/name', ...endpointField },
        { path: '/description', ...descriptionField },
      ],
      item: {
        type: 'api', name, description: content.slice(descriptionField.start, descriptionField.end).trim().slice(0, 500),
        content: { endpoint, ...(method ? { method } : {}) },
      },
    });
  }
  return drafts;
}

function ruleCandidates(content: string): CandidateDraft[] {
  const drafts: CandidateDraft[] = [];
  for (const source of [GUARD_THROW_SOURCE, INLINE_GUARD_THROW_SOURCE]) {
    const pattern = new RegExp(source, 'g');
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(content))) {
      const condition = match[1].trim();
      const quote = match[3];
      const openIndex = match.index + match[0].length;
      const literal = literalAt(content, quote, openIndex);
      if (!literal || literal.value.length < 8 || EXCLUDED_TEXT.test(literal.value)) continue;

      const start = lineStart(content, match.index);
      const end = lineEnd(content, literal.end);
      const message = literal.value;
      const messageField = { start: openIndex, end: literal.end - 1 };

      drafts.push({
        start, end,
        fields: [
          { path: '/name', ...messageField },
          { path: '/description', ...messageField },
          { path: '/content/action', ...messageField },
        ],
        item: { type: 'rule', name: message.slice(0, 200), description: message, content: { condition, action: message } },
      });
    }
  }
  return drafts;
}

const CONSTRAINT_CONST_SOURCE = '\\b(?:export\\s+)?(?:const|let|var)\\s+([A-Z][A-Z0-9_]*)\\s*=\\s*([^;\\n]{1,80});';
const CONSTRAINT_NAME_SEGMENT = /(?:^|_)(MAX|MIN|LIMIT|TIMEOUT|THRESHOLD|QUOTA)(?:_|$)/;

function constraintCandidates(content: string): CandidateDraft[] {
  const drafts: CandidateDraft[] = [];
  const pattern = new RegExp(CONSTRAINT_CONST_SOURCE, 'g');
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(content))) {
    const name = match[1];
    const segment = CONSTRAINT_NAME_SEGMENT.exec(name);
    if (!segment) continue;
    const value = match[2].trim();
    if (!/\d/.test(value) || EXCLUDED_TEXT.test(value)) continue;

    const start = lineStart(content, match.index);
    const end = lineEnd(content, match.index);
    const nameStart = match.index + match[0].indexOf(name);
    const valueStart = match.index + match[0].indexOf(match[2], match[0].indexOf(name) + name.length);
    const description = `${name} = ${value}`;
    const kind = segment[1] === 'MAX' ? 'max' : segment[1] === 'MIN' ? 'min' : 'custom';

    drafts.push({
      start, end,
      fields: [
        { path: '/name', start: nameStart, end: nameStart + name.length },
        { path: '/description', start, end },
        { path: '/content/value', start: valueStart, end: valueStart + match[2].length },
      ],
      item: { type: 'constraint', name: name.slice(0, 200), description, content: { type: kind, value } },
    });
  }
  return drafts;
}

/**
 * Deterministic, grounded candidate recognizer for source code documents — the
 * code-document counterpart to scanExtractionCandidates's prose patterns.
 * Every span must be an exact, reproducible offset into `content`: this function
 * is re-run at publish time to verify published items against a fresh scan.
 */
export function scanCodeExtractionCandidates(content: string): { drafts: CandidateDraft[]; excludedLines: number } {
  if (content.length > 1_000_000) throw new Error('Extraction document budget exceeded');
  return { drafts: [...apiCandidates(content), ...ruleCandidates(content), ...constraintCandidates(content)], excludedLines: 0 };
}
