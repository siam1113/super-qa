export type TestCase = {
  id: string;
  title: string;
  priority: 'P0' | 'P1' | 'P2' | 'P3';
  automation: 'automated' | 'manual' | 'partial';
  owner: string;
  flow: string;
  tags: string[];
  lastRun: string | null;
  passRate: number | null;
  coverage: number | null;
  risk: 'low' | 'medium' | 'high' | 'critical' | 'unknown';
  aiScore: number | null;
  steps?: Array<{ action: string; expected: string }>;
  preconditions?: string[];
  baseUrl?: string | null;
  reviewStatus?: 'draft' | 'ready' | 'approved' | 'rejected';
  revision?: number;
  reviewedBy?: string | null;
  evidence?: { businessItemId: string; documentId: string; sourceId: string; revisionHash: string } | null;
  workflowArtifactId?: string | null;
  sourceCaseId?: string | null;
  createdAt?: string;
  updatedAt?: string;
  category?: 'smoke' | 'regression' | 'sanity' | 'functional' | 'integration' | 'exploratory' | 'performance' | 'security' | 'acceptance' | null;
  technique?: 'boundary-value' | 'equivalence-partitioning' | 'decision-table' | 'state-transition' | 'exploratory' | 'error-guessing' | 'pairwise' | 'use-case' | null;
  severity?: 'blocker' | 'critical' | 'major' | 'minor' | 'trivial' | null;
  platform?: 'web' | 'mobile' | 'desktop' | 'api' | 'backend' | null;
};

export type Execution = {
  testName: string;
  testId: string;
  flow: string;
  browser: string;
  environment: string;
  status: 'passed' | 'failed' | 'running' | 'blocked' | 'skipped' | 'pending' | 'cancelled';
  duration: number | null;
  retry: number;
  aiConfidence: number | null;
  owner: string;
  startedAt: string | null;
  result?: { reporter: string; steps: Array<{ actual: string; passed: boolean; evidence: string }>; duration: number } | null;
  completedAt?: string;
  errorMessage?: string;
  stackTrace?: string;
};

export type HealingSuggestion = {
  id?: string;
  issue: string;
  affectedTests: string[];
  currentLocator: string;
  suggestedLocator: string;
  confidence: number;
  risk: 'low' | 'medium' | 'high';
  owner: string;
  status: 'pending' | 'approved' | 'rejected';
  rootCause: string;
};

export type Flow = {
  name: string;
  module: string;
  description: string;
  risk: 'low' | 'medium' | 'high' | 'critical';
  priority: 'P0' | 'P1' | 'P2' | 'P3';
  coverage: number;
  automation: number;
  relatedPages: string[];
  dependencies: string[];
};

export type Fact = {
  text: string;
  category: 'flow' | 'execution' | 'page' | 'api' | 'business_rule' | 'constraint' | 'validation';
  confidence: number;
  source: string;
  createdBy: string;
  aiGenerated: boolean;
  humanVerified: boolean;
  relatedObjects: string[];
};

export type DashboardStats = {
  passed: number;
  passedChange: number;
  failed: number;
  failedChange: number;
  blocked: number;
  blockedChange: number;
  running: number;
  skipped: number;
  duration: string;
  aiConfidence: number;
  aiConfidenceChange: number;
  healingCount: number;
  healingPending: number;
};

export type NavItem = {
  id: string;
  label: string;
  icon?: string;
  children?: NavItem[];
  count?: number;
  status?: 'success' | 'warning' | 'error' | 'info';
};

export type InspectorType =
  | 'testCase'
  | 'execution'
  | 'flow'
  | 'fact'
  | 'healing'
  | 'action'
  | 'dom'
  | null;

export type Page =
  | 'chat'
  | 'integrations'
  | 'status'
  | 'dashboard'
  | 'executions'
  | 'user-settings'
  | 'app-settings'
  | 'settings'
  // Context
  | 'sources'
  | 'pipelines'
  | 'sync-jobs'
  | 'business'
  | 'business-flows'
  | 'business-facts'
  | 'business-entities'
  | 'business-rules'
  | 'business-states'
  | 'business-permissions'
  | 'business-integrations'
  | 'business-constraints'
  | 'business-configurations'
  | 'business-terminology'
  // Technical
  | 'technical'
  | 'technical-apis'
  | 'technical-code'
  | 'technical-architecture'
  | 'technical-database'
  // Quality
  | 'quality'
  | 'test-cases'
  | 'execution-plans'
  | 'test-data'
  | 'requirements'
  | 'defects'
  // Automation
  | 'automation'
  | 'dom'
  // Agents
  | 'agents'
  | 'command-center'
  | 'agent-qae'
  | 'agent-aue'
  | 'actions'
  | 'frameworks'
  | 'automated-tests'
  | 'test-credentials'
  | 'reports'
  | 'coverage'
  | 'data-setup'
  | 'auth'
  | 'locators'
  // Product
  | 'product'
  | 'features'
  | 'personas'
  // Environment
  | 'environments';

export type Source = {
  id: string;
  name: string;
  type: 'github' | 'jira' | 'confluence' | 'notion' | 'zephyr' | 'azure' | 'gitlab' | 'postman' | 'swagger' | 'database' | 'api' | 'upload';
  status: 'connected' | 'disconnected' | 'syncing' | 'error';
  lastSync: string | null;
  lastSyncJobId?: string | null;
  lastSyncStatus?: SyncJobStatus | null;
  itemsCount: number;
  permissions: string[];
  syncMode: 'auto' | 'manual';
  errorMessage?: string | null;
  repository?: string;
  project?: string;
  spaceKey?: string;
  baseUrl?: string;
  credentialKey?: string | null;
};

export type BusinessItemType =
  // Product
  | 'flow'
  | 'fact'
  | 'entity'
  | 'rule'
  | 'state'
  | 'permission'
  | 'integration'
  | 'constraint'
  | 'configuration'
  | 'terminology'
  // Technical
  | 'api'
  | 'code'
  | 'architecture'
  | 'database'
  // Quality
  | 'test_case'
  | 'requirement'
  | 'defect'
  // Automation
  | 'dom'
  | 'locator'
  | 'action'
  | 'data_setup'
  | 'auth';

export type ConfidenceLevel = 'high' | 'medium' | 'low' | 'inferred';

export type VerificationStatus = 'unverified' | 'verified' | 'rejected';

export type BusinessItem = {
  id: string;
  type: BusinessItemType;
  name: string;
  description: string | null;
  content: Record<string, any> | null;
  confidence: ConfidenceLevel;
  verificationStatus?: VerificationStatus;
  tags: string[];
  metadata?: Record<string, any> | null;
  sourceId: string | null;
  documentId: string | null;
  source?: { id: string; name: string; type: string } | null;
  document?: { id: string; title: string; url: string | null; type: string } | null;
  externalId: string | null;
  outgoingRelationships?: BusinessRelationship[];
  incomingRelationships?: BusinessRelationship[];
  createdAt: string;
  updatedAt: string;
};

export type BusinessRelationship = {
  id: string;
  type: string;
  fromItemId: string;
  toItemId: string;
  description: string | null;
};

export type BusinessStats = {
  byType: Record<BusinessItemType, number>;
  bySource: Array<{ sourceId: string; count: number }>;
  total: number;
};

// Sync Jobs
export type SyncJobStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
export type SyncJobStageStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
export type SyncJobTrigger = 'manual' | 'scheduled' | 'webhook';
export type SyncStageName = 'pulling' | 'processing' | 'indexing' | 'extracting' | 'populating';

export type SyncJobStage = {
  name: SyncStageName;
  status: SyncJobStageStatus;
  startedAt?: string;
  completedAt?: string;
  itemsProcessed?: number;
  itemsTotal?: number;
  error?: string;
  metadata?: {
    model?: string;
    tool?: string;
    strategy?: string;
    provider?: string;
    [key: string]: any;
  };
};

export type SyncJobStats = {
  documentsTotal: number;
  documentsNew: number;
  documentsUpdated: number;
  documentsDeleted: number;
  businessItemsExtracted: number;
};

export type SyncJob = {
  id: string;
  sourceId: string;
  sourceName?: string;
  status: SyncJobStatus;
  trigger: SyncJobTrigger;
  currentStage: SyncStageName | null;
  stages: SyncJobStage[];
  stats: SyncJobStats | null;
  itemsProcessed: number;
  itemsTotal: number;
  errorMessage: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  syncMode?: 'incremental' | 'full' | 'selective';
  forceReprocess?: boolean;
  forceExtract?: boolean;
  selectedDocumentsCount?: number;
};

export type SyncDescriptions = {
  stages: Record<SyncStageName, string>;
  statuses: Record<SyncJobStatus, string>;
};

// Agents
export type AgentType = 'qae' | 'aue' | 'superqa';

export type AgentStatus = 'idle' | 'running' | 'paused' | 'error' | 'needs_help';

export type AgentMessage = {
  id: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  timestamp: string;
  toolCalls?: AgentToolCall[];
  meetingAttachment?: { meetingId: string; title: string; wordCount: number; tokenCount: number };
  // Chronological log of narration ("status") lines and tool calls, in the order they
  // actually happened, so narration preceding a tool call renders above it rather than
  // being overwritten by the next event before it's ever painted. `tool` entries point
  // at the matching toolCalls[] item by id; `status` entries carry their own label.
  timeline?: Array<{ kind: 'status'; id: string; label: string } | { kind: 'tool'; id: string }>;
};

export type AgentToolCall = {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
  result?: string;
  status: 'pending' | 'running' | 'completed' | 'error';
  liveRunId?: string;
  liveTestName?: string;
};

export type AgentSession = {
  id: string;
  agentType: AgentType;
  status: AgentStatus;
  messages: AgentMessage[];
  context?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

export type AgentConfig = {
  id: string;
  type: AgentType;
  name: string;
  description: string;
  systemPrompt: string;
  tools: string[];
  model: string;
  temperature: number;
  maxTokens: number;
};

// Agent Tasks
export type TaskStatus = 'todo' | 'in_progress' | 'done' | 'cancelled' | 'blocked';
export type TaskPriority = 'urgent' | 'high' | 'medium' | 'low';

export type TaskArtifact = {
  type: 'test_case' | 'script' | 'report' | 'document' | 'other';
  name: string;
  content?: string;
  url?: string;
};

export type TaskResult = {
  summary?: string;
  artifacts?: TaskArtifact[];
  metrics?: Record<string, number>;
};

export type AgentTask = {
  id: string;
  title: string;
  description: string | null;
  agentType: AgentType;
  status: TaskStatus;
  priority: TaskPriority;
  labels: string[];
  sessionId: string | null;
  result: TaskResult | null;
  metadata: Record<string, unknown> | null;
  blockedReason: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

// Environments
export type EnvironmentVariable = {
  key: string;
  value: string;
  isSecret: boolean;
};

export type Environment = {
  id: string;
  name: string;
  description: string | null;
  color: string;
  variables: EnvironmentVariable[];
  baseUrl?: string | null;
  isDefault: boolean;
  maxRetries: number | null;
  retryDelayMs: number | null;
  createdAt: string;
  updatedAt: string;
};
