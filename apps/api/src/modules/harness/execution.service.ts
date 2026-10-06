import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { createHash, randomUUID } from 'crypto';
import { HarnessService } from './harness.service';
import { BrowserStep, HarnessExecution } from './execution.entity';
import { BrowserReportDto, SubmitExecutionDto } from './execution.dto';

function digest(value: unknown): string {
  const canonical = (input: unknown): string => {
    if (Array.isArray(input)) return '[' + input.map(canonical).join(',') + ']';
    if (input && typeof input === 'object') return '{' + Object.entries(input).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => JSON.stringify(key) + ':' + canonical(item)).join(',') + '}';
    return JSON.stringify(input);
  };
  return createHash('sha256').update(canonical(value)).digest('hex');
}

@Injectable()
export class HarnessExecutionService {
  constructor(private readonly database: DataSource, private readonly harness: HarnessService) {}

  private target(id: string): string {
    let targets: Record<string, string>;
    try { targets = JSON.parse(process.env.HARNESS_EXECUTION_TARGETS || '{}'); }
    catch { throw new ServiceUnavailableException('Execution targets are not configured'); }
    const hash = targets?.[id];
    if (typeof hash !== 'string' || !/^[a-f0-9]{64}$/.test(hash)) throw new BadRequestException('Target is not explicitly allowlisted');
    return hash;
  }

  private view(run: HarnessExecution) {
    const { token, screenshot, completionHash, ...visible } = run;
    return { ...visible, artifactAvailable: Boolean(screenshot), modelCalls: 0, verdictOrigin: 'deterministic-browser-observation' };
  }

  private async locked(manager: EntityManager, id: string) {
    const run = await manager.findOne(HarnessExecution, { where: { id }, lock: { mode: 'pessimistic_write' } });
    if (!run) throw new NotFoundException('Execution not found');
    await this.harness.assertRunScope(manager, run.proposalRunId);
    return run;
  }

  private expire(run: HarnessExecution): boolean {
    if ((run.status === 'running' && (!run.leaseUntil || run.leaseUntil.getTime() <= Date.now())) ||
        (run.status === 'queued' && run.deadline.getTime() <= Date.now())) {
      run.status = 'interrupted'; run.reason = 'Lease/deadline expired; side effects are uncertain and will not be replayed';
      run.leaseUntil = null;
      return true;
    }
    return false;
  }

  async submit(input: SubmitExecutionDto) {
    if (!input.actor.trim()) throw new BadRequestException('Actor required');
    return this.database.transaction(async manager => {
      await manager.query('SELECT pg_advisory_xact_lock(hashtext($1))', ['browser:' + input.requestId]);
      const existing = await manager.findOneBy(HarnessExecution, { requestId: input.requestId });
      if (existing) {
        await this.harness.assertRunScope(manager, existing.proposalRunId);
        if (existing.requestHash !== digest(input)) throw new ConflictException('Request ID input changed');
        return this.view(existing);
      }
      const proposal = await this.harness.executionSnapshot(manager, input.proposalRunId);
      const plan = proposal.proposal as unknown as { steps: BrowserStep[] };
      if (plan.steps.length !== input.bindings.length) throw new BadRequestException('Bind every approved step exactly once');
      const selector = /^(#[a-zA-Z][a-zA-Z0-9_-]*|\[data-testid="[a-zA-Z0-9_-]+"\])$/;
      const steps = plan.steps.map((step, index) => {
        const binding = input.bindings[index];
        if (!selector.test(step.selector) || !selector.test(step.assertion.selector) || step.assertion.expected.length > 1000) throw new BadRequestException('Unsupported selector or oversized oracle');
        if ((binding.operation === 'fill' && typeof binding.value !== 'string') || (binding.operation !== 'fill' && binding.value !== undefined)) throw new BadRequestException('Only fill operations accept a required value');
        return { caseStep: step.caseStep, action: step.action, selector: step.selector, assertion: step.assertion, ...binding };
      });
      const targetHash = this.target(input.targetId);
      if (input.retryOf) {
        const prior = await manager.findOneBy(HarnessExecution, { id: input.retryOf });
        if (!prior || ['queued', 'running'].includes(prior.status) || prior.proposalRunId !== input.proposalRunId || prior.targetId !== input.targetId || prior.targetHash !== targetHash || digest(prior.steps) !== digest(steps)) throw new ConflictException('Retry must preserve the same terminal execution inputs');
      }
      const run = manager.create(HarnessExecution, { requestId: input.requestId, requestHash: digest(input), proposalRunId: proposal.id,
        targetId: input.targetId, targetHash, steps, actor: input.actor, retryOf: input.retryOf || null, deadline: new Date(Date.now() + 300000) });
      return this.view(await manager.save(run));
    });
  }

  async status(id: string) {
    return this.database.transaction(async manager => {
      const run = await this.locked(manager, id);
      if (this.expire(run)) await manager.save(run);
      return this.view(run);
    });
  }

  async claim() {
    return this.database.transaction(async manager => {
      await manager.query("SELECT pg_advisory_xact_lock(hashtext('browser:dispatch'))");
      const active = await manager.find(HarnessExecution, { where: [{ status: 'queued' }, { status: 'running' }], order: { createdAt: 'ASC' }, lock: { mode: 'pessimistic_write' } });
      for (const run of active) if (this.expire(run)) await manager.save(run);
      if (active.some(run => run.status === 'running')) return null;
      for (const run of active.filter(item => item.status === 'queued')) {
        try {
          await this.harness.executionSnapshot(manager, run.proposalRunId);
          if (this.target(run.targetId) !== run.targetHash) throw new ConflictException('Target revision changed');
        } catch (error) {
          if (!(error instanceof ConflictException || error instanceof BadRequestException || error instanceof ForbiddenException || error instanceof ServiceUnavailableException)) throw error;
          run.status = 'blocked'; run.reason = error.message; await manager.save(run); continue;
        }
        run.status = 'running'; run.token = randomUUID(); run.leaseUntil = new Date(Math.min(run.deadline.getTime(), Date.now() + 90000));
        await manager.save(run);
        return { id: run.id, token: run.token, targetId: run.targetId, targetHash: run.targetHash, steps: run.steps, leaseUntil: run.leaseUntil };
      }
      return null;
    });
  }

  async complete(id: string, input: BrowserReportDto) {
    return this.database.transaction(async manager => {
      const run = await this.locked(manager, id);
      if (run.completionHash === digest(input)) return this.view(run);
      if (this.expire(run)) { await manager.save(run); return this.view(run); }
      if (run.status !== 'running' || run.token !== input.token) throw new ConflictException('Execution lease is not current');
      if (input.observations.length > run.steps.length || input.observations.some((item, index) => item.caseStep !== index + 1)) throw new BadRequestException('Invalid observation order/count');
      let screenshot: Buffer | null = null;
      if (input.screenshot) {
        screenshot = Buffer.from(input.screenshot, 'base64');
        if (screenshot.toString('base64') !== input.screenshot || screenshot.length > 48000 || screenshot[0] !== 255 || screenshot[1] !== 216 || screenshot[screenshot.length - 2] !== 255 || screenshot[screenshot.length - 1] !== 217) throw new BadRequestException('Invalid bounded JPEG artifact');
      }
      const mismatch = input.observations.some((item, index) => item.actionCompleted && !item.error && item.actual !== run.steps[index].assertion.expected);
      const infrastructure = input.error || input.observations.some(item => item.error || !item.actionCompleted);
      run.status = infrastructure ? 'error' : mismatch ? 'failed' : input.observations.length === run.steps.length && screenshot ? 'passed' : 'error';
      run.reason = infrastructure ? 'Execution infrastructure/action error' : mismatch ? 'Observed text differs from the approved expectation' : run.status === 'passed' ? 'All approved assertions observed; artifact captured' : 'Missing assertions or screenshot artifact';
      try {
        await this.harness.executionSnapshot(manager, run.proposalRunId);
        if (this.target(run.targetId) !== run.targetHash) throw new ConflictException('Target revision changed');
      } catch (error) {
        if (!(error instanceof ConflictException || error instanceof BadRequestException || error instanceof ForbiddenException || error instanceof ServiceUnavailableException)) throw error;
        run.status = 'blocked'; run.reason = error.message;
      }
      const { token, screenshot: image, ...report } = input;
      run.report = report;
      run.screenshot = screenshot ? image : null;
      run.artifactHash = screenshot ? createHash('sha256').update(screenshot).digest('hex') : null;
      run.completionHash = digest(input); run.leaseUntil = null;
      if (run.retryOf && run.status === 'passed') {
        const prior = await manager.findOneByOrFail(HarnessExecution, { id: run.retryOf });
        run.flaky = prior.flaky || prior.status === 'failed';
      }
      return this.view(await manager.save(run));
    });
  }

  async cancel(id: string) {
    return this.database.transaction(async manager => {
      const run = await this.locked(manager, id);
      if (['queued', 'running'].includes(run.status)) {
        run.status = 'cancelled'; run.reason = 'Operator cancelled execution'; run.leaseUntil = null;
        await manager.save(run);
      }
      return this.view(run);
    });
  }

  async artifact(id: string) {
    const run = await this.database.getRepository(HarnessExecution).findOneBy({ id });
    if (!run?.screenshot) throw new NotFoundException('Screenshot not available');
    await this.harness.assertRunScope(this.database.manager, run.proposalRunId);
    return { mediaType: 'image/jpeg', sha256: run.artifactHash, base64: run.screenshot };
  }
}
