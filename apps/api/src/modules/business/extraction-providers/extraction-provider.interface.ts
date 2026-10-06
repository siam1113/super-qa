/**
 * Extraction Provider Interface
 *
 * Defines the contract for different AI extraction providers
 * (Anthropic, OpenAI, Local)
 */

export interface ValidationRequest {
  text: string;
  fullDocument: string;
  type: 'rule' | 'entity' | 'fact' | 'flow' | 'requirement' | 'testCase' | 'api' |
    'constraint' | 'permission' | 'integration' | 'state' | 'terminology' | 'defect';
}

export interface ValidationResult {
  usage?: { inputTokens: number; outputTokens: number };
  confidence: number;  // 0-100
  reason: string;
  contextQuality: number;  // 0-100
}

export interface ContextAnalysis {
  surroundingText: string;
  contextQuality: number;
  headingContext?: string;
  sectionType?: string;
}

export interface ExplanationRequest {
  type: string;
  name: string;
  content: string;
  fullDocument: string;
}

// 'api' is deliberately excluded: discovered candidates only ever carry a name/description/quote
// (see CandidateProposal below), never a structured method+endpoint, so a free-form "api" guess
// is always less useful than what the deterministic code/prose scanners already produce. Keeping
// api strictly deterministic means every api item in the knowledge base has real content.method/endpoint.
export type ExtractableCandidateType = 'rule' | 'requirement' | 'fact' | 'flow' | 'test_case' |
  'constraint' | 'permission' | 'integration' | 'state' | 'terminology';

/** Single source of truth so the discovery prompt and its validation allowlist can never drift apart. */
export const DISCOVERABLE_TYPES: ExtractableCandidateType[] = [
  'rule', 'requirement', 'fact', 'flow', 'test_case', 'constraint', 'permission', 'integration', 'state', 'terminology',
];

/** Shared negative instructions for the discovery prompt, written from real low-quality output we've seen. */
export const DISCOVERY_EXCLUSIONS =
  'Do not propose: a single line of source code or raw syntax as a name (e.g. a function call or event listener registration); ' +
  'generic instructions for using the authoring/documentation tool itself rather than this product (e.g. keyboard shortcuts, menu clicks, slash-commands, "press X to do Y"); ' +
  'a bare category label with no specific named role, action, or value (e.g. "Page permissions" alone); ' +
  'a single identifier or function name with no explanatory sentence around it. ' +
  'Every candidate must be specific to this product/domain, not about the tool used to author the document.';

/**
 * Shared validation guidelines so OpenAI and Anthropic providers score claims the same way.
 * Each includes a concrete reject example drawn from real low-quality output we've seen in
 * production, not just an abstract rule — models follow examples far more reliably than adjectives.
 */
export const TYPE_VALIDATION_GUIDELINES: Record<string, string> = {
  rule: 'Rules should have conditional logic (if/when/then) or prescriptive statements (must/shall/should), specific to this product. Avoid generic validation instructions.',
  entity: 'Entities should be nouns representing business objects with clear identity. Reject common words, verbs, or code snippets.',
  fact: 'Facts should contain quantifiable values (numbers, percentages) with clear context. Must have a measurable aspect.',
  flow: 'Flows must describe a multi-step BUSINESS or PRODUCT process specific to this system. Reject: a single line of source code or raw syntax used as the name (e.g. "window.addEventListener(\'load\', ...)"); generic instructions for using the authoring/documentation tool itself rather than the product (e.g. "Press e when on a page to open the editor", "Type /whiteboard to create a canvas", keyboard shortcuts, menu clicks, or slash-commands). A flow name must read as a business capability, not a UI action or a code statement.',
  requirement: 'Requirements should state what the system must do, using clear acceptance criteria specific to this product. Reject prerequisites about the authoring tool itself (e.g. "must be an Atlassian Admin account") unless the document is literally specifying access control for this product.',
  testCase: 'Test cases should describe specific scenarios to validate. Should have clear steps or expected outcomes.',
  api: 'APIs should describe endpoints, methods, or integration points. Should include technical details.',
  constraint: 'Constraints should state a concrete limit, boundary, or restriction (size, rate, timeout, quota). Reject vague caution without a specific bound.',
  permission: 'Accept ONLY if BOTH a specific named role/actor (not "who", "users", or a category label) AND a specific action are present together (e.g. "Only Space Admins can delete a page"). If either is missing, reject — e.g. "Page permissions" and "Control who can view, edit, and comment on pages" are BOTH rejects: the first names no action, the second names no specific role.',
  integration: 'Integrations should name a specific external system or service and how this codebase connects to it. Reject generic networking code with no identifiable third party.',
  state: 'States should enumerate the distinct values a status/lifecycle field can hold, or describe a transition between them. Reject a single isolated value with no enumeration or transition.',
  terminology: 'Terminology should define what a specific domain term means in this system. Reject common words or definitions that are not specific to this codebase/domain.',
  defect: 'Defects should describe a concrete reported problem with observed (and ideally expected) behavior. Reject feature requests or vague complaints with no specific failure.',
};

export interface CandidateDiscoveryRequest {
  title: string;
  content: string;
}

export interface CandidateProposal {
  type: ExtractableCandidateType;
  name: string;
  description: string;
  evidenceQuote: string;
}

export interface CandidateDiscoveryResult {
  candidates: CandidateProposal[];
  usage?: { inputTokens: number; outputTokens: number };
}

export interface IExtractionProvider {
  /**
   * Provider name (for logging)
   */
  getName(): string;

  /**
   * Validate extracted content using AI or pattern matching
   */
  validate(request: ValidationRequest): Promise<ValidationResult>;

  /** Discover bounded, source-quoted candidates during an explicit force extract. */
  discoverCandidates?(request: CandidateDiscoveryRequest): Promise<CandidateDiscoveryResult>;

  /**
   * Analyze context around extracted text
   */
  analyzeContext(text: string, fullDocument: string): ContextAnalysis;

  /**
   * Generate human-readable explanation for QA/testing purposes
   */
  generateExplanation(request: ExplanationRequest): Promise<string>;

  /**
   * Convert 0-100 score to confidence level
   */
  scoreToLevel(score: number): 'high' | 'medium' | 'low' | 'inferred';
}
