import { BadRequestException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { QaProject } from '../autonomy/autonomy.entity';
import { QaService } from '../qa/qa.service';
import { BusinessService } from '../business/business.service';
import { AgentsService } from '../agents/agents.service';

const PRIORITIES = ['P0', 'P1', 'P2', 'P3'];
const RISKS = ['low', 'medium', 'high', 'critical'];

interface ProposedCase {
  title: string;
  steps: Array<{ action: string; expected: string }>;
  priority?: unknown;
  risk?: unknown;
  tags?: unknown;
}

interface HarnessStep {
  description?: string;
  status?: string;
  actualResult?: string;
  errorMessage?: string;
}

interface HarnessReport {
  steps: HarnessStep[];
  durationMs?: number;
}

@Injectable()
export class OnboardingService {
  constructor(
    @InjectDataSource() private readonly database: DataSource,
    private readonly qaService: QaService,
    private readonly businessService: BusinessService,
    private readonly agentsService: AgentsService,
  ) {}

  private get runtimeUrl() {
    return (process.env.AGENTS_API_URL || 'http://localhost:8000').replace(/\/$/, '');
  }

  async generateTestCases(sourceId: string) {
    const { items } = await this.businessService.findAll(undefined, sourceId, undefined, 10, 0);
    const context = items.map(item => `- [${item.type}] ${item.name}${item.description ? ': ' + item.description : ''}`).join('\n').slice(0, 4000);
    const prompt = [
      'You are designing test cases for a newly connected repository as part of a product onboarding tour.',
      context ? `Recently extracted knowledge about this repository:\n${context}` : 'No extracted knowledge is available yet for this repository; use general best-practice coverage for a typical software project.',
      'Propose exactly 3 concrete, runnable test cases covering distinct, important behavior.',
      'Reply with ONLY a JSON array, no markdown code fences and no prose before or after it. Each element must match this shape exactly: {"title": string, "steps": [{"action": string, "expected": string}], "priority": "P0"|"P1"|"P2"|"P3", "risk": "low"|"medium"|"high"|"critical", "tags": string[]}.',
      'Each test case needs 2 to 5 steps. Keep actions and expected outcomes concrete and independently verifiable.',
    ].join('\n\n');
    const chatResult = await this.agentsService.chatWithMemories('qae', { message: prompt }, []);
    const proposals = this.parseProposedCases(chatResult.response);
    const created = [];
    for (const proposal of proposals) {
      const testCase = await this.qaService.createTestCase({
        title: proposal.title.slice(0, 300),
        steps: proposal.steps.map(step => ({ action: step.action.slice(0, 4000), expected: step.expected.slice(0, 4000) })),
        priority: this.normalizeEnum(proposal.priority, PRIORITIES, 'P2'),
        risk: this.normalizeEnum(proposal.risk, RISKS, 'medium'),
        tags: Array.isArray(proposal.tags) ? proposal.tags.filter((tag): tag is string => typeof tag === 'string').slice(0, 10) : [],
      });
      const approved = await this.qaService.reviewTestCase(testCase.id, { revision: testCase.revision, status: 'approved', reviewer: 'QAE Agent (Onboarding)' });
      created.push(approved);
    }
    return created;
  }

  private normalizeEnum(value: unknown, allowed: string[], fallback: string): string {
    return typeof value === 'string' && allowed.includes(value) ? value : fallback;
  }

  private parseProposedCases(raw: string): ProposedCase[] {
    const start = raw.indexOf('[');
    const end = raw.lastIndexOf(']');
    if (start === -1 || end === -1 || end < start) throw new ServiceUnavailableException('The agent did not return structured test cases');
    let value: unknown;
    try { value = JSON.parse(raw.slice(start, end + 1)); }
    catch { throw new ServiceUnavailableException('The agent returned malformed test case data'); }
    if (!Array.isArray(value)) throw new ServiceUnavailableException('The agent returned malformed test case data');
    const cases = value.filter((item): item is ProposedCase => Boolean(item) && typeof item.title === 'string' && Array.isArray(item.steps) && item.steps.length > 0 &&
      item.steps.every((step: unknown) => Boolean(step) && typeof (step as { action?: unknown }).action === 'string' && typeof (step as { expected?: unknown }).expected === 'string'));
    if (!cases.length) throw new ServiceUnavailableException('The agent did not propose any usable test cases');
    return cases;
  }

  async executeTestCase(testCaseId: string) {
    const run = await this.qaService.runTests({ testIds: [testCaseId] });
    const execution = run.executions.find(item => item.testId === testCaseId);
    if (!execution) throw new BadRequestException('Execution could not be created');
    const response = await fetch(`${this.runtimeUrl}/agents/qae/execute-test-case-direct`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ test_id: testCaseId, environment: 'staging', browser: 'chromium' }),
      signal: AbortSignal.timeout(180000),
    }).catch(() => { throw new ServiceUnavailableException('The automation harness is unreachable'); });
    if (!response.ok) throw new ServiceUnavailableException('The automation harness could not run this test case');
    const report = await response.json() as HarnessReport;
    const steps = this.reconcileSteps(report.steps || [], execution.snapshot.steps.length);
    return this.qaService.recordResult(execution.id, { reporter: 'QAE Agent (Onboarding)', steps, duration: Math.round((report.durationMs || 0) / 1000) });
  }

  private reconcileSteps(harnessSteps: HarnessStep[], requiredCount: number) {
    const mapped = harnessSteps.map(step => ({
      actual: (step.actualResult || step.errorMessage || step.description || 'No output recorded').slice(0, 8000),
      passed: step.status === 'passed',
      evidence: (step.description || step.status || 'Automation step').slice(0, 2000),
    }));
    if (mapped.length === requiredCount) return mapped;
    if (mapped.length > requiredCount) {
      const kept = mapped.slice(0, requiredCount);
      if (mapped.slice(requiredCount).some(step => !step.passed)) {
        const last = kept[kept.length - 1];
        kept[kept.length - 1] = { ...last, passed: false, evidence: (last.evidence + ' (additional harness steps beyond the authored test case failed)').slice(0, 2000) };
      }
      return kept;
    }
    const padding = Array.from({ length: requiredCount - mapped.length }, () => ({
      actual: 'Not executed by the automation harness', passed: false, evidence: 'Step count mismatch between the authored test case and the harness report',
    }));
    return [...mapped, ...padding];
  }

  async complete(projectId: string) {
    await this.database.getRepository(QaProject).update({ id: projectId }, { onboardingCompletedAt: new Date() });
    return { completed: true };
  }
}
