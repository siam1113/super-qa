import { Injectable, Logger, NotFoundException, ConflictException, BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { DataSource, EntityManager, In } from 'typeorm';
import { createHash, randomUUID } from 'crypto';
import { isDeepStrictEqual } from 'util';
import { SourcesService } from '../sources/sources.service';
import { BusinessService } from '../business/business.service';
import { AgentsService } from '../agents/agents.service';
import { BusinessItem } from '../business/entities/business-item.entity';
import { Document } from '../documents/entities/document.entity';
import { WorkflowArtifact } from '../autonomy/workflow-artifact.entity';
import { Environment } from '../environments/environment.entity';
import { QaTestCase, QaRun, QaExecution, QaHealingSuggestion, QaExecutionPlan, QaGenerationRun } from './qa.entity';
import { CreateQaCaseDto, UpdateQaCaseDto, ReviewQaCaseDto, CreateQaRunDto, RecordQaResultDto, CreateHealingDto, SaveQaPlanDto, RunWithAgentDto, AgentExecutionResultDto, GenerateQaCasesDto, RefineQaCaseDto } from './qa.dto';

const GENERATE_PRIORITIES = ['P0', 'P1', 'P2', 'P3'];
const GENERATE_RISKS = ['low', 'medium', 'high', 'critical'];

type ProposedCase = { title: string; steps: Array<{ action: string; expected: string }>; priority: string; risk: string; flow: string; tags: string[] };
type RefinedCase = { title: string; steps: Array<{ action: string; expected: string }>; preconditions: string[] };

@Injectable()
export class QaService {
  private readonly logger = new Logger(QaService.name);

  private sameValue(left: unknown, right: unknown): boolean {
    return isDeepStrictEqual(JSON.parse(JSON.stringify(left)), JSON.parse(JSON.stringify(right)));
  }
  constructor(private readonly sourcesService: SourcesService, private readonly businessService: BusinessService,
    private readonly agentsService: AgentsService,
    @InjectDataSource() private readonly database: DataSource,
    @InjectQueue('qa-generation') private readonly generationQueue: Queue) {}

  private async currentEvidence(manager: EntityManager, testCase: QaTestCase): Promise<void> {
    if (!testCase.evidence) return;
    const document = await manager.findOne(Document, { where: { id: testCase.evidence.documentId, sourceId: testCase.evidence.sourceId }, lock: { mode: 'pessimistic_read' } });
    if (!document || document.processedHash !== testCase.evidence.revisionHash) throw new ConflictException('Source evidence changed; import and review the current case');
  }

  private validateCase(input: CreateQaCaseDto): void {
    if (!input.title?.trim() || !Array.isArray(input.steps) || !input.steps.length || input.steps.some(step => !step?.action?.trim() || !step?.expected?.trim())) throw new BadRequestException('Cases require a title, actions and explicit expected outcomes');
  }

  async createTestCase(input: CreateQaCaseDto) {
    this.validateCase(input);
    return this.database.getRepository(QaTestCase).save({ ...input, automation: 'manual', reviewStatus: 'draft' });
  }

  async importTestCase(businessItemId: string) {
    return this.database.transaction(async manager => {
      const item = await manager.findOneBy(BusinessItem, { id: businessItemId, type: 'test_case' });
      if (!item || !item.documentId || !item.sourceId || !item.metadata?.revisionHash) throw new NotFoundException('Grounded test-case proposal not found');
      if (item.verificationStatus === 'rejected' || item.metadata?.evidenceStatus === 'needs-review') throw new ConflictException('Proposal is rejected or stale');
      const content = item.content as { steps?: Array<{ action: string; expected: string }>; preconditions?: string[] };
      if (!Array.isArray(content?.steps) || content.steps.some(step => !step || typeof step.action !== 'string' || typeof step.expected !== 'string') ||
          (content.preconditions !== undefined && (!Array.isArray(content.preconditions) || content.preconditions.some(value => typeof value !== 'string')))) throw new BadRequestException('Proposal has malformed steps or preconditions');
      const input = { title: item.name, steps: (content?.steps || []).map(({ action, expected }) => ({ action, expected })), preconditions: content?.preconditions || [] };
      this.validateCase(input);
      const testCase = manager.create(QaTestCase, { ...input, evidence: {
        businessItemId, documentId: item.documentId, sourceId: item.sourceId, revisionHash: item.metadata.revisionHash,
      } });
      await this.currentEvidence(manager, testCase);
      return manager.save(QaTestCase, testCase);
    });
  }

  async importArtifactCases(artifactId: string) {
    return this.database.transaction(async manager => {
      const artifact = await manager.findOneBy(WorkflowArtifact, { id: artifactId });
      if (!artifact) throw new NotFoundException('Workflow artifact not found');
      return this.importCasesFromArtifact(manager, artifact);
    });
  }

  /** Same import, looked up the way the agent runtime addresses artifacts: by the scope it ran in and its request ID. */
  async importArtifactCasesByRequest(projectId: string, requestId: string) {
    return this.database.transaction(async manager => {
      const artifact = await manager.findOneBy(WorkflowArtifact, { projectId, requestId });
      if (!artifact) throw new NotFoundException('Workflow artifact not found');
      return this.importCasesFromArtifact(manager, artifact);
    });
  }

  private async importCasesFromArtifact(manager: EntityManager, artifact: WorkflowArtifact) {
    if (artifact.skill !== 'design_test_cases') throw new BadRequestException('Only design_test_cases artifacts can be imported as test cases');
    if (artifact.status !== 'completed') throw new BadRequestException('Only a completed workflow report can be imported');
    let result: { data?: { cases?: unknown } };
    try { result = JSON.parse(artifact.resultJson); } catch { throw new BadRequestException('Workflow artifact content is unreadable'); }
    const cases = result?.data?.cases;
    if (!Array.isArray(cases) || !cases.length) throw new BadRequestException('This workflow report has no cases to import');
    const created: QaTestCase[] = [];
    let alreadyImported = 0;
    let invalid = 0;
    for (const source of cases as Array<Record<string, unknown>>) {
      const steps = Array.isArray(source?.steps) ? source.steps as Array<Record<string, unknown>> : null;
      if (!source || typeof source.id !== 'string' || typeof source.title !== 'string' || !steps?.length ||
          steps.some(step => !step || typeof step.action !== 'string' || typeof step.expected !== 'string')) { invalid += 1; continue; }
      const existing = await manager.findOneBy(QaTestCase, { workflowArtifactId: artifact.id, sourceCaseId: source.id });
      if (existing) { alreadyImported += 1; continue; }
      const preconditions = Array.isArray(source.preconditions) ? source.preconditions.filter((value): value is string => typeof value === 'string') : [];
      const input = { title: source.title, steps: steps.map(step => ({ action: step.action as string, expected: step.expected as string })), preconditions };
      this.validateCase(input);
      created.push(await manager.save(QaTestCase, manager.create(QaTestCase, {
        ...input, tags: ['imported'], workflowArtifactId: artifact.id, sourceCaseId: source.id,
      })));
    }
    if (!created.length && !alreadyImported) throw new BadRequestException('No valid cases were found in this workflow report');
    return { created, createdCount: created.length, alreadyImported, invalid };
  }

  async updateTestCase(id: string, input: UpdateQaCaseDto) {
    this.validateCase(input);
    return this.database.transaction(async manager => {
      const current = await manager.findOne(QaTestCase, { where: { id }, lock: { mode: 'pessimistic_write' } });
      if (!current) throw new NotFoundException('Test case not found');
      if (current.revision !== input.revision) throw new ConflictException('Test case revision changed');
      const contentChanged = !this.sameValue(current.steps, input.steps) ||
        (input.preconditions !== undefined && !this.sameValue(current.preconditions, input.preconditions));
      if (current.evidence && contentChanged) throw new ConflictException('Create a manual case or import current evidence to change grounded steps');
      const reviewInvalidated = contentChanged || current.title !== input.title;
      // Editing the script or its title invalidates any prior review; editing other metadata alone (owner, status, etc.) does not.
      Object.assign(current, input, { revision: current.revision + 1, ...(reviewInvalidated ? { reviewStatus: 'draft', reviewedBy: null } : {}) });
      return manager.save(QaTestCase, current);
    });
  }

  async reviewTestCase(id: string, input: ReviewQaCaseDto) {
    if (!input.reviewer.trim()) throw new BadRequestException('Reviewer is required');
    return this.database.transaction(async manager => {
      const current = await manager.findOne(QaTestCase, { where: { id }, lock: { mode: 'pessimistic_write' } });
      if (!current) throw new NotFoundException('Test case not found');
      if (current.revision !== input.revision) throw new ConflictException('Test case revision changed');
      await this.currentEvidence(manager, current);
      if (current.reviewStatus !== 'draft' && (current.reviewStatus !== input.status || current.reviewedBy !== input.reviewer)) throw new ConflictException('Review already recorded; edit the case before re-review');
      current.reviewStatus = input.status;
      current.reviewedBy = input.reviewer;
      return manager.save(QaTestCase, current);
    });
  }

  async getTestCases(filters?: { priority?: string; automation?: string; risk?: string }) {
    const cases = await this.database.getRepository(QaTestCase).find({ where: {
      ...(filters?.priority ? { priority: filters.priority } : {}),
      ...(filters?.automation ? { automation: filters.automation } : {}),
      ...(filters?.risk ? { risk: filters.risk } : {}),
    }, order: { createdAt: 'DESC' } });
    const executions = await this.database.getRepository(QaExecution).find();
    return cases.map(testCase => {
      const results = executions.filter(execution => execution.testId === testCase.id && ['passed', 'failed'].includes(execution.status));
      return { ...testCase, lastRun: results.map(result => result.completedAt!).sort((left, right) => right.getTime() - left.getTime())[0] || null,
        passRate: results.length ? Math.round(100 * results.filter(result => result.status === 'passed').length / results.length) : null,
        coverage: null, aiScore: null, risk: testCase.risk || 'unknown' };
    });
  }

  async getTestCase(id: string) {
    const testCase = await this.database.getRepository(QaTestCase).findOneBy({ id });
    if (!testCase) throw new NotFoundException('Test case not found');
    return testCase;
  }

  async runTests(input: CreateQaRunDto) {
    const testIds = [...new Set(input.testIds)].sort();
    if (!testIds.length) throw new BadRequestException('Select test cases explicitly');
    const requestId = input.requestId || randomUUID();
    const environment = input.environment || 'manual';
    const browser = input.browser || 'manual';
    const requestHash = createHash('sha256').update(JSON.stringify({ testIds, environment, browser })).digest('hex');
    const run = await this.database.transaction(async manager => {
      await manager.query('SELECT pg_advisory_xact_lock(hashtext($1))', [requestId]);
      const existing = await manager.findOneBy(QaRun, { requestId });
      if (existing) {
        if (existing.requestHash !== requestHash) throw new ConflictException('Request ID already used with different input');
        return existing;
      }
      const snapshots: QaTestCase[] = [];
      for (const id of testIds) {
        const testCase = await manager.findOne(QaTestCase, { where: { id }, lock: { mode: 'pessimistic_read' } });
        if (!testCase) throw new NotFoundException('Test case not found');
        if (testCase.reviewStatus !== 'approved') throw new ConflictException('All cases must be reviewed and approved');
        await this.currentEvidence(manager, testCase);
        snapshots.push(testCase);
      }
      const created = await manager.save(QaRun, manager.create(QaRun, { requestId, requestHash, environment, browser }));
      for (const snapshot of snapshots) await manager.save(QaExecution, manager.create(QaExecution, { runId: created.id, testId: snapshot.id, snapshot }));
      return created;
    });
    return this.getRun(run.id);
  }

  async runWithAgent(testId: string, input: RunWithAgentDto) {
    const environment = input.environment || 'staging';
    const browser = input.browser || 'chromium';
    const testCase = await this.database.getRepository(QaTestCase).findOneBy({ id: testId });
    if (!testCase) throw new NotFoundException('Test case not found');
    if (testCase.reviewStatus !== 'approved') throw new ConflictException('Case must be reviewed and approved before an agent can run it');

    const { runId } = await this.agentsService.startExecution(testId, environment, browser);

    const execution = await this.database.transaction(async manager => {
      const run = await manager.save(QaRun, manager.create(QaRun, {
        requestId: randomUUID(), requestHash: runId, mode: 'agent', environment, browser,
      }));
      return manager.save(QaExecution, manager.create(QaExecution, {
        runId: run.id, testId, snapshot: testCase, status: 'running', agentRunId: runId,
      }));
    });

    return { ...execution, runId };
  }

  async recordAgentResult(input: AgentExecutionResultDto) {
    const execution = await this.database.getRepository(QaExecution).findOneBy({ agentRunId: input.agentRunId });
    if (!execution) return { acknowledged: false };
    execution.status = input.status;
    execution.result = input.result;
    execution.completedAt = new Date();
    await this.database.getRepository(QaExecution).save(execution);
    return { acknowledged: true };
  }

  listPlans() { return this.database.getRepository(QaExecutionPlan).find({ order: { updatedAt: 'DESC' } }); }

  async savePlan(input: SaveQaPlanDto, id?: string) {
    const testIds = [...new Set(input.testIds)].sort();
    const count = await this.database.getRepository(QaTestCase).countBy({ id: In(testIds) });
    if (count !== testIds.length) throw new NotFoundException('One or more selected test cases do not exist');
    const repo = this.database.getRepository(QaExecutionPlan);
    if (!id) return repo.save(repo.create({ ...input, testIds, environment: input.environment || 'manual', browser: input.browser || 'manual' }));
    const plan = await repo.findOneBy({ id });
    if (!plan) throw new NotFoundException('Execution plan not found');
    Object.assign(plan, input, { testIds, environment: input.environment || 'manual', browser: input.browser || 'manual' });
    return repo.save(plan);
  }

  async deletePlan(id: string) {
    const result = await this.database.getRepository(QaExecutionPlan).delete({ id });
    if (!result.affected) throw new NotFoundException('Execution plan not found');
    return { deleted: true };
  }

  async runPlan(id: string) {
    const plan = await this.database.getRepository(QaExecutionPlan).findOneBy({ id });
    if (!plan) throw new NotFoundException('Execution plan not found');
    return this.runTests({ testIds: plan.testIds, environment: plan.environment, browser: plan.browser });
  }

  async getRun(id: string) {
    const run = await this.database.getRepository(QaRun).findOneBy({ id });
    if (!run) throw new NotFoundException('Run not found');
    const executions = await this.database.getRepository(QaExecution).findBy({ runId: id });
    return { ...run, executionId: run.id, status: executions.some(execution => execution.status === 'pending') ? 'awaiting_results' : executions.every(execution => execution.status === 'cancelled') ? 'cancelled' : 'completed',
      testsQueued: executions.length, executions };
  }

  async cancelRun(id: string) {
    await this.database.transaction(async manager => {
      const run = await manager.findOne(QaRun, { where: { id }, lock: { mode: 'pessimistic_write' } });
      if (!run) throw new NotFoundException('Run not found');
      await manager.update(QaExecution, { runId: id, status: 'pending' }, { status: 'cancelled', completedAt: new Date() });
    });
    return this.getRun(id);
  }

  async recordResult(id: string, input: RecordQaResultDto) {
    if (!input.reporter.trim() || input.steps.some(step => !step.actual.trim() || !step.evidence.trim())) throw new BadRequestException('Reporter, actual observations and evidence references are required');
    const reference = await this.database.getRepository(QaExecution).findOneBy({ id });
    if (!reference) throw new NotFoundException('Execution not found');
    return this.database.transaction(async manager => {
      await manager.findOne(QaRun, { where: { id: reference.runId }, lock: { mode: 'pessimistic_write' } });
      const execution = await manager.findOneOrFail(QaExecution, { where: { id }, lock: { mode: 'pessimistic_write' } });
      if (execution.status !== 'pending') {
        if (this.sameValue(execution.result, input)) return execution;
        throw new ConflictException('Execution already finalized');
      }
      await this.currentEvidence(manager, execution.snapshot);
      if (input.steps.length !== execution.snapshot.steps.length) throw new BadRequestException('An observation is required for every snapshot step');
      execution.result = input;
      execution.status = input.steps.every(step => step.passed) ? 'passed' : 'failed';
      execution.completedAt = new Date();
      return manager.save(QaExecution, execution);
    });
  }

  async getExecutions(filters?: { status?: string; environment?: string; browser?: string }) {
    const executions = await this.database.getRepository(QaExecution).find({ relations: ['run'], order: { createdAt: 'DESC' } });
    return executions.filter(execution => (!filters?.status || execution.status === filters.status) &&
      (!filters?.environment || execution.run.environment === filters.environment) && (!filters?.browser || execution.run.browser === filters.browser))
      .map(execution => {
        const result = execution.result as { duration?: number; durationMs?: number } | null;
        const duration = result?.duration ?? (typeof result?.durationMs === 'number' ? Math.round(result.durationMs / 1000) : null);
        return { ...execution, testName: execution.snapshot.title, flow: execution.snapshot.flow, owner: execution.snapshot.owner,
          environment: execution.run.environment, browser: execution.run.browser, mode: execution.run.mode || 'manual', duration,
          retry: 0, aiConfidence: null, startedAt: null, resultOrigin: execution.agentRunId ? 'agent' : execution.result ? 'human-reported' : null };
      });
  }

  async createHealing(input: CreateHealingDto) {
    const count = await this.database.getRepository(QaTestCase).countBy({ id: In([...new Set(input.affectedTests)]) });
    if (count !== new Set(input.affectedTests).size) throw new NotFoundException('Affected case not found');
    return this.database.getRepository(QaHealingSuggestion).save(input);
  }

  getHealingSuggestions(status?: string) {
    return this.database.getRepository(QaHealingSuggestion).find({ where: status ? { status } : {}, order: { createdAt: 'DESC' } });
  }

  async reviewHealing(id: string, status: 'approved' | 'rejected', reviewer: string) {
    if (!reviewer.trim()) throw new BadRequestException('Reviewer is required');
    return this.database.transaction(async manager => {
      const suggestion = await manager.findOne(QaHealingSuggestion, { where: { id }, lock: { mode: 'pessimistic_write' } });
      if (!suggestion) throw new NotFoundException('Healing suggestion not found');
      if (suggestion.status !== 'pending' && (suggestion.status !== status || suggestion.reviewedBy !== reviewer)) throw new ConflictException('Healing review already recorded');
      suggestion.status = status;
      suggestion.reviewedBy = reviewer;
      return { ...await manager.save(QaHealingSuggestion, suggestion), applied: false };
    });
  }

  async getFlows() {
    const items = await this.database.getRepository(BusinessItem).findBy({ type: 'flow' });
    return items.map(item => ({ id: item.id, name: item.name, description: item.description, content: item.content, module: '',
      risk: 'unknown', priority: null, coverage: null, automation: null, relatedPages: [], dependencies: [], metadata: item.metadata }));
  }

  async getFlow(name: string) {
    const flow = (await this.getFlows()).find(item => item.name.toLowerCase() === name.toLowerCase());
    if (!flow) throw new NotFoundException('Flow not found');
    return flow;
  }

  async getFacts(category?: string) {
    const types = ['fact', 'rule', 'constraint', 'api', 'flow'];
    const items = await this.database.getRepository(BusinessItem).findBy({ type: In(types) });
    return items.map(item => ({ id: item.id, text: item.description || item.name, category: item.type === 'rule' ? 'business_rule' : item.type,
      confidence: null, source: item.sourceId, createdBy: 'source-extraction', aiGenerated: item.tags.includes('auto-extracted'),
      humanVerified: item.verificationStatus === 'verified' && item.metadata?.evidenceStatus !== 'needs-review',
      relatedObjects: [], metadata: item.metadata })).filter(item => !category || item.category === category);
  }

  async getDashboard() {
    const [executions, cases, healing] = await Promise.all([this.getExecutions(), this.getTestCases(), this.getHealingSuggestions()]);
    const count = (status: string) => executions.filter(execution => execution.status === status).length;
    return { stats: { passed: count('passed'), failed: count('failed'), blocked: count('blocked'), running: count('running'), pending: count('pending'),
      skipped: count('skipped'), cancelled: count('cancelled'), duration: executions.reduce((total, execution) => total + (execution.duration || 0), 0) + 's',
      passedChange: null, failedChange: null, blockedChange: null, aiConfidence: null, aiConfidenceChange: null,
      healingCount: healing.length, healingPending: healing.filter(item => item.status === 'pending').length },
      recentExecutions: executions.slice(0, 5), topRisks: cases.filter(item => ['high', 'critical'].includes(item.risk)), pendingHealing: healing.filter(item => item.status === 'pending').length };
  }

  async getWorkspace() {
    const [dashboard, testCases, executions, healingSuggestions, flows, facts] = await Promise.all([
      this.getDashboard(), this.getTestCases(), this.getExecutions(), this.getHealingSuggestions(), this.getFlows(), this.getFacts(),
    ]);
    return { name: 'QA Workspace', stats: dashboard.stats, testCases, executions, healingSuggestions, flows, facts };
  }

  async getContextCounts() {
    // Fetch real counts from database
    const [sources, businessStats] = await Promise.all([
      this.sourcesService.findAll(),
      this.businessService.getStatsByType(),
    ]);

    // Cast to Record<string, number> for flexible key access
    const stats = businessStats as Record<string, number>;

    return {
      // Sources count from database
      sources: sources.length,
      // Product - from business items by type
      flows: stats['flow'] || 0,
      facts: stats['fact'] || 0,
      entities: stats['entity'] || 0,
      rules: stats['rule'] || 0,
      states: stats['state'] || 0,
      permissions: stats['permission'] || 0,
      integrations: stats['integration'] || 0,
      constraints: stats['constraint'] || 0,
      configurations: stats['configuration'] || 0,
      terminology: stats['terminology'] || 0,
      features: 0, // Not in BusinessItemType yet
      personas: 0, // Not in BusinessItemType yet
      // Technical
      apis: stats['api'] || 0,
      code: stats['code'] || 0,
      architecture: stats['architecture'] || 0,
      database: stats['database'] || 0,
      // Quality
      testCases: await this.database.getRepository(QaTestCase).count(),
      requirements: stats['requirement'] || 0,
      defects: stats['defect'] || 0,
      // Automation
      dom: stats['dom'] || 0,
      locators: stats['locator'] || 0,
      actions: stats['action'] || 0,
      dataSetup: stats['data_setup'] || 0,
      auth: stats['auth'] || 0,
    };
  }

  /**
   * AI-proposed cases for the Generate wizard. Never persists — the caller reviews and
   * creates only the ones it wants via the existing createTestCase endpoint.
   */
  async generateTestCases(dto: GenerateQaCasesDto) {
    const count = dto.count || 3;
    let framing: string;
    let context: string;
    if (dto.mode === 'instruction') {
      if (!dto.instructions?.trim()) throw new BadRequestException('Describe what to test');
      framing = 'You are designing test cases for a QA lead based on their plain-language instructions.';
      context = dto.instructions.trim();
    } else if (dto.mode === 'ticket') {
      if (!dto.documentId) throw new BadRequestException('Select a ticket to generate from');
      const ticket = await this.database.getRepository(Document).findOneBy({ id: dto.documentId });
      if (!ticket) throw new NotFoundException('Ticket not found');
      framing = 'You are designing test cases that verify the following ticket is implemented correctly.';
      context = `${ticket.title}\n\n${ticket.content}`.slice(0, 6000);
    } else {
      const [flows, cases] = await Promise.all([this.getFlows(), this.getTestCases()]);
      const coverage = flows
        .map(flow => ({ name: flow.name, cases: cases.filter(testCase => testCase.flow === flow.name).length }))
        .sort((left, right) => left.cases - right.cases);
      const coverageContext = coverage.length
        ? `Known flows and how many test cases currently cover each (lowest coverage first):\n${coverage.map(item => `- ${item.name}: ${item.cases} case(s)`).join('\n')}`
        : 'No flows have been catalogued yet for this platform; propose cases for common, high-value areas of a typical web application.';
      const explored = dto.environmentId ? await this.exploreEnvironment(dto.environmentId, dto.explorationRunId) : null;
      if (explored) {
        framing = 'You just explored the live application below. Use what you actually observed to find the biggest coverage gaps against the catalogued test cases, then design cases that close them.';
        context = `What exploring the live app found:\n${explored}\n\n${coverageContext}`;
      } else {
        framing = 'You are exploring this QA platform\'s catalogued application flows and current test coverage to find the biggest coverage gaps, then designing cases that close them.';
        context = coverageContext;
      }
    }
    const prompt = [
      'Do not call any tools or skills for this request; just answer directly in your reply text.',
      framing,
      context,
      `Propose exactly ${count} concrete, runnable test case${count === 1 ? '' : 's'} covering distinct, important behavior. Do not repeat behavior already covered by an existing case.`,
      'Reply with ONLY a JSON array, no markdown code fences and no prose before or after it. Each element must match this shape exactly: {"title": string, "steps": [{"action": string, "expected": string}], "priority": "P0"|"P1"|"P2"|"P3", "risk": "low"|"medium"|"high"|"critical", "flow": string, "tags": string[]}.',
      'Each test case needs 2 to 6 steps. Keep actions and expected outcomes concrete and independently verifiable. "flow" should name the feature area the case belongs to.',
    ].join('\n\n');
    const chatResult = await this.agentsService.chatWithMemories('qae', { message: prompt }, []);
    return { proposals: this.parseProposedCases(chatResult.response, count) };
  }

  // Drives a real explore_app run against the environment's baseUrl so
  // exploration-mode generation reflects the actual live app instead of
  // only the DB's catalogued-flow coverage stats. 'local' is the
  // established sentinel project identity for this module's unscoped
  // (legacy, pre-multi-tenancy) callers — see shared.skills.suites'
  // current_scope().identity check. Degrades to null (not a thrown error)
  // on any failure — missing/misconfigured environment, agents runtime
  // unreachable, QA_WORKFLOW_KEY unset — so generation still falls back to
  // the DB-only context rather than failing the whole request outright.
  private async exploreEnvironment(environmentId: string, explorationRunId?: string): Promise<string | null> {
    try {
      const environment = await this.database.getRepository(Environment).findOneBy({ id: environmentId });
      if (!environment?.baseUrl) {
        this.logger.warn(`Exploration skipped: environment ${environmentId} has no baseUrl configured`);
        return null;
      }
      // Use the wizard's pre-generated id as the agents runtime's live run id so its
      // viewer (already connected via useLiveExecution) receives this run's steps.
      const result = await this.agentsService.runWorkflowSkill('qae', 'explore_app', { url: environment.baseUrl }, explorationRunId || randomUUID(), 'local', false);
      return result.summary || null;
    } catch (error) {
      this.logger.warn(`Exploration failed, falling back to catalogued coverage only: ${error.message}`);
      return null;
    }
  }

  private parseProposedCases(raw: string, max: number): ProposedCase[] {
    const start = raw.indexOf('[');
    const end = raw.lastIndexOf(']');
    if (start === -1 || end === -1 || end < start) throw new ServiceUnavailableException('The agent did not return structured test cases');
    let value: unknown;
    try { value = JSON.parse(raw.slice(start, end + 1)); } catch { throw new ServiceUnavailableException('The agent returned malformed test case data'); }
    if (!Array.isArray(value)) throw new ServiceUnavailableException('The agent returned malformed test case data');
    const cases = value.filter((item): item is Record<string, unknown> => {
      const steps = (item as { steps?: unknown })?.steps;
      return Boolean(item) && typeof (item as { title?: unknown }).title === 'string' && Array.isArray(steps) && steps.length > 0 &&
        steps.every((step: unknown) => Boolean(step) && typeof (step as { action?: unknown }).action === 'string' && typeof (step as { expected?: unknown }).expected === 'string');
    }).slice(0, max).map(item => ({
      title: (item.title as string).slice(0, 300),
      steps: (item.steps as Array<{ action: string; expected: string }>).slice(0, 6).map(step => ({ action: step.action.slice(0, 4000), expected: step.expected.slice(0, 4000) })),
      priority: GENERATE_PRIORITIES.includes(item.priority as string) ? item.priority as string : 'P2',
      risk: GENERATE_RISKS.includes(item.risk as string) ? item.risk as string : 'medium',
      flow: typeof item.flow === 'string' ? item.flow.slice(0, 200) : '',
      tags: Array.isArray(item.tags) ? item.tags.filter((tag): tag is string => typeof tag === 'string').slice(0, 10) : [],
    }));
    if (!cases.length) throw new ServiceUnavailableException('The agent did not propose any usable test cases');
    return cases;
  }

  /**
   * AI-refined version of an existing case (by id) or a pasted description of a test that
   * lives in an external tool. Never persists — the caller applies it via the existing
   * update/create endpoints once it has reviewed the proposal.
   */
  async refineTestCase(dto: RefineQaCaseDto) {
    let original: { title: string; steps: Array<{ action: string; expected: string }>; preconditions: string[] };
    if (dto.testCaseId) {
      const testCase = await this.database.getRepository(QaTestCase).findOneBy({ id: dto.testCaseId });
      if (!testCase) throw new NotFoundException('Test case not found');
      original = { title: testCase.title, steps: testCase.steps, preconditions: testCase.preconditions || [] };
    } else if (dto.externalTitle?.trim()) {
      original = { title: dto.externalTitle.trim(), steps: [], preconditions: [] };
    } else {
      throw new BadRequestException('Select a test case or describe the external test to refine');
    }
    const context = [
      `Existing test case title: ${original.title}`,
      original.steps.length
        ? `Current steps:\n${original.steps.map((step, index) => `${index + 1}. ${step.action} -> ${step.expected}`).join('\n')}`
        : (dto.externalDescription?.trim() ? `Description from the external tool:\n${dto.externalDescription.trim()}` : 'No steps are recorded for it yet.'),
      original.preconditions.length ? `Current preconditions:\n${original.preconditions.join('\n')}` : '',
      `Refinement instructions from the QA lead:\n${dto.instructions.trim()}`,
      dto.links?.length ? `Reference links the QA lead attached:\n${dto.links.join('\n')}` : '',
    ].filter(Boolean).join('\n\n');
    const prompt = [
      'Do not call any tools or skills for this request; just answer directly in your reply text.',
      'You are refining an existing QA test case for a QA lead.',
      context,
      'Reply with ONLY a JSON object, no markdown code fences and no prose before or after it. Shape exactly: {"title": string, "steps": [{"action": string, "expected": string}], "preconditions": string[]}.',
      'Preserve what still applies from the original; change only what the instructions ask for. Keep actions and expected outcomes concrete and independently verifiable.',
    ].join('\n\n');
    const chatResult = await this.agentsService.chatWithMemories('qae', { message: prompt }, []);
    return this.parseRefinedCase(chatResult.response);
  }

  private parseRefinedCase(raw: string): RefinedCase {
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    if (start === -1 || end === -1 || end < start) throw new ServiceUnavailableException('The agent did not return a structured test case');
    let value: unknown;
    try { value = JSON.parse(raw.slice(start, end + 1)); } catch { throw new ServiceUnavailableException('The agent returned malformed test case data'); }
    const parsed = value as { title?: unknown; steps?: unknown; preconditions?: unknown };
    const steps = Array.isArray(parsed?.steps) ? parsed.steps as Array<Record<string, unknown>> : null;
    if (!parsed || typeof parsed.title !== 'string' || !steps?.length ||
        steps.some(step => !step || typeof step.action !== 'string' || typeof step.expected !== 'string')) {
      throw new ServiceUnavailableException('The agent did not propose a usable test case');
    }
    return {
      title: parsed.title.slice(0, 300),
      steps: steps.slice(0, 50).map(step => ({ action: (step.action as string).slice(0, 4000), expected: (step.expected as string).slice(0, 4000) })),
      preconditions: Array.isArray(parsed.preconditions) ? parsed.preconditions.filter((value): value is string => typeof value === 'string').slice(0, 50).map(value => value.slice(0, 4000)) : [],
    };
  }

  /**
   * Queues a generate/refine request instead of running it inline, so the wizard that
   * started it can close immediately. The job itself (runGenerationJob/runRefinementJob
   * below) reuses generateTestCases/refineTestCase unchanged and persists their outcome.
   */
  async startGenerationRun(dto: GenerateQaCasesDto) {
    let label: string;
    if (dto.mode === 'instruction') {
      if (!dto.instructions?.trim()) throw new BadRequestException('Describe what to test');
      label = dto.instructions.trim().slice(0, 140);
    } else if (dto.mode === 'ticket') {
      if (!dto.documentId) throw new BadRequestException('Select a ticket to generate from');
      const ticket = await this.database.getRepository(Document).findOneBy({ id: dto.documentId });
      if (!ticket) throw new NotFoundException('Ticket not found');
      label = `Ticket: ${ticket.title}`.slice(0, 140);
    } else {
      label = 'Explore coverage gaps';
    }
    const run = await this.database.getRepository(QaGenerationRun).save({
      kind: 'generate', status: 'pending', label, input: dto as unknown as Record<string, unknown>, result: null, error: null, applied: false,
    });
    await this.generationQueue.add('generate', { runId: run.id });
    return run;
  }

  async startRefinementRun(dto: RefineQaCaseDto) {
    let label: string;
    if (dto.testCaseId) {
      const testCase = await this.database.getRepository(QaTestCase).findOneBy({ id: dto.testCaseId });
      if (!testCase) throw new NotFoundException('Test case not found');
      label = `Refining: ${testCase.title}`.slice(0, 140);
    } else if (dto.externalTitle?.trim()) {
      label = `Refining: ${dto.externalTitle.trim()}`.slice(0, 140);
    } else {
      throw new BadRequestException('Select a test case or describe the external test to refine');
    }
    const run = await this.database.getRepository(QaGenerationRun).save({
      kind: 'refine', status: 'pending', label, input: dto as unknown as Record<string, unknown>, result: null, error: null, applied: false,
    });
    await this.generationQueue.add('refine', { runId: run.id });
    return run;
  }

  /** Invoked by QaGenerationProcessor off the queue; never called synchronously from a controller. */
  async runGenerationJob(runId: string): Promise<void> {
    const repo = this.database.getRepository(QaGenerationRun);
    const run = await repo.findOneBy({ id: runId });
    if (!run) return;
    run.status = 'running';
    await repo.save(run);
    try {
      const { proposals } = await this.generateTestCases(run.input as unknown as GenerateQaCasesDto);
      run.status = 'completed';
      run.result = { proposals };
      run.error = null;
    } catch (error) {
      run.status = 'failed';
      run.error = error instanceof Error ? error.message : 'Generation failed';
    }
    await repo.save(run);
  }

  /** Invoked by QaGenerationProcessor off the queue; never called synchronously from a controller. */
  async runRefinementJob(runId: string): Promise<void> {
    const repo = this.database.getRepository(QaGenerationRun);
    const run = await repo.findOneBy({ id: runId });
    if (!run) return;
    run.status = 'running';
    await repo.save(run);
    try {
      const refined = await this.refineTestCase(run.input as unknown as RefineQaCaseDto);
      run.status = 'completed';
      run.result = refined as unknown as Record<string, unknown>;
      run.error = null;
    } catch (error) {
      run.status = 'failed';
      run.error = error instanceof Error ? error.message : 'Refinement failed';
    }
    await repo.save(run);
  }

  async listGenerationRuns() {
    return this.database.getRepository(QaGenerationRun).find({ order: { createdAt: 'DESC' }, take: 50 });
  }

  async getGenerationRun(id: string) {
    const run = await this.database.getRepository(QaGenerationRun).findOneBy({ id });
    if (!run) throw new NotFoundException('Run not found');
    return run;
  }

  async markGenerationRunApplied(id: string) {
    const repo = this.database.getRepository(QaGenerationRun);
    const run = await repo.findOneBy({ id });
    if (!run) throw new NotFoundException('Run not found');
    run.applied = true;
    return repo.save(run);
  }
}
