import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { createHash, randomUUID } from 'crypto';
import { Document } from '../documents/entities/document.entity';
import { QaTestCase } from '../qa/qa.entity';
import { CompleteHarnessDto, ReviewHarnessDto, SubmitHarnessDto } from './harness.dto';
import { HarnessProfile, HarnessRun } from './harness.entity';
import { makePrompt, validateProposal } from './harness-contract';

function canonical(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => JSON.stringify(key) + ':' + canonical(item)).join(',') + '}';
  return JSON.stringify(value);
}

function hash(value: unknown): string { return createHash('sha256').update(canonical(value)).digest('hex'); }

@Injectable()
export class HarnessService {
  constructor(private readonly database: DataSource) {}

  private policy(task: SubmitHarnessDto): Set<string> {
    for (const [field, variable] of [['workspaceId', 'HARNESS_WORKSPACE_ID'], ['applicationId', 'HARNESS_APPLICATION_ID'], ['environment', 'HARNESS_ENVIRONMENT']] as const) {
      if (!process.env[variable]) throw new ServiceUnavailableException('Harness scope is not configured');
      if (task[field] !== process.env[variable]) throw new ForbiddenException('Task is outside configured harness scope');
    }
    const sources = new Set((process.env.HARNESS_SOURCE_IDS || '').split(',').filter(Boolean));
    if (!sources.size) throw new ServiceUnavailableException('Harness source allowlist is not configured');
    return sources;
  }

  private profile(): HarnessProfile {
    const provider = process.env.HARNESS_PROVIDER || '';
    const model = process.env.HARNESS_MODEL || '';
    const inputNanoUsd = Number(process.env.HARNESS_INPUT_NANO_USD);
    const outputNanoUsd = Number(process.env.HARNESS_OUTPUT_NANO_USD);
    if (!['openai', 'anthropic', 'ollama'].includes(provider) || !model || model.length > 200 ||
        !/^\d+$/.test(process.env.HARNESS_INPUT_NANO_USD || '') || !/^\d+$/.test(process.env.HARNESS_OUTPUT_NANO_USD || '') ||
        !Number.isSafeInteger(inputNanoUsd) || inputNanoUsd < 0 || inputNanoUsd > 1000000 ||
        !Number.isSafeInteger(outputNanoUsd) || outputNanoUsd < 0 || outputNanoUsd > 1000000) throw new ServiceUnavailableException('Harness model and price schedule must be configured');
    return { provider, model, inputNanoUsd, outputNanoUsd, version: 'harness-v1' };
  }

  private async fresh(manager: EntityManager, run: HarnessRun): Promise<void> {
    const sources = this.policy(run.task);
    if (run.caseSnapshot) {
      const current = await manager.findOne(QaTestCase, { where: { id: run.caseSnapshot.id }, lock: { mode: 'pessimistic_read' } });
      if (!current || current.reviewStatus !== 'approved' || current.revision !== run.caseSnapshot.revision) throw new ConflictException('Approved case changed');
    }
    for (const evidence of [...run.evidence].sort((left, right) => left.documentId.localeCompare(right.documentId))) {
      const document = await manager.findOne(Document, { where: { id: evidence.documentId }, lock: { mode: 'pessimistic_read' } });
      if (!document || document.sourceId !== evidence.sourceId || !sources.has(document.sourceId) || document.processedHash !== evidence.revisionHash || document.content !== evidence.content) throw new ConflictException('Source evidence changed or scope was revoked');
    }
  }

  async submit(task: SubmitHarnessDto) {
    const sources = this.policy(task);
    if (!task.objective.trim() || !task.actor.trim()) throw new BadRequestException('Objective and actor are required');
    if (new Set(task.evidence.map(item => item.documentId)).size !== task.evidence.length) throw new BadRequestException('Duplicate evidence document');
    if (task.role === 'qae' && (task.caseId || task.caseRevision)) throw new BadRequestException('Case references are only supported for AUE');
    const run = await this.database.transaction(async manager => {
      await manager.query('SELECT pg_advisory_xact_lock(hashtext($1))', ['harness:' + task.requestId]);
      const existing = await manager.findOneBy(HarnessRun, { requestId: task.requestId });
      const requestHash = hash(task);
      if (existing) {
        if (existing.requestHash !== requestHash) throw new ConflictException('Request ID was used with different input');
        return existing;
      }
      let caseSnapshot: QaTestCase | null = null;
      if (task.role === 'aue') {
        if (!task.caseId || !task.caseRevision) throw new BadRequestException('AUE requires an approved case revision');
        caseSnapshot = await manager.findOne(QaTestCase, { where: { id: task.caseId }, lock: { mode: 'pessimistic_read' } });
        if (!caseSnapshot || caseSnapshot.reviewStatus !== 'approved' || caseSnapshot.revision !== task.caseRevision) throw new ConflictException('AUE requires the current approved case');
        if (caseSnapshot.evidence && !task.evidence.some(item => item.documentId === caseSnapshot!.evidence!.documentId && item.revisionHash === caseSnapshot!.evidence!.revisionHash)) throw new ConflictException('Include the approved case source revision');
      }
      const evidence = [];
      for (const reference of [...task.evidence].sort((left, right) => left.documentId.localeCompare(right.documentId))) {
        const document = await manager.findOne(Document, { where: { id: reference.documentId }, lock: { mode: 'pessimistic_read' } });
        if (!document || !sources.has(document.sourceId)) throw new ForbiddenException('Evidence is outside the source allowlist');
        if (document.processedHash !== reference.revisionHash) throw new ConflictException('Evidence revision changed');
        evidence.push({ ...reference, sourceId: document.sourceId, content: document.content });
      }
      if (Buffer.byteLength(JSON.stringify(evidence)) > 18000) throw new BadRequestException('Evidence bundle too large; select smaller documents');
      const created = manager.create(HarnessRun, { requestId: task.requestId, requestHash, task, evidence, caseSnapshot,
        profile: this.profile(), deadline: new Date(Date.now() + task.budget.wallSeconds * 1000) });
      created.prompt = makePrompt(created);
      return manager.save(created);
    });
    return this.view(run);
  }

  async executionSnapshot(manager: EntityManager, id: string): Promise<HarnessRun> {
    const run = await manager.findOne(HarnessRun, { where: { id }, lock: { mode: 'pessimistic_read' } });
    if (!run || run.task.role !== 'aue' || run.status !== 'approved') throw new ConflictException('Execution requires an approved AUE proposal');
    await this.fresh(manager, run);
    validateProposal(run, run.proposal);
    return run;
  }

  async assertRunScope(manager: EntityManager, id: string): Promise<void> {
    const run = await manager.findOneBy(HarnessRun, { id });
    if (!run) throw new NotFoundException('Parent proposal not found');
    this.policy(run.task);
  }

  private view(run: HarnessRun) {
    return { id: run.id, requestId: run.requestId, role: run.task.role, workspaceId: run.task.workspaceId, status: run.status, reason: run.reason,
      task: run.task, caseSnapshot: run.caseSnapshot,
      budget: run.task.budget, profile: run.profile, deadline: run.deadline, createdAt: run.createdAt, proposal: run.proposal, review: run.review,
      evidence: run.evidence.map(({ content, ...reference }) => reference),
      attempts: run.attempts.map(({ token, completionHash, ...attempt }) => attempt),
      charged: { modelCalls: run.attempts.length, inputTokens: run.attempts.reduce((sum, item) => sum + Math.max(item.reservedInput, item.usage?.inputTokens || 0), 0),
        outputTokens: run.attempts.reduce((sum, item) => sum + Math.max(item.reservedOutput, item.usage?.outputTokens || 0), 0),
        costNanoUsd: run.attempts.reduce((sum, item) => sum + Math.max(item.reservedCost, (item.usage?.inputTokens || 0) * run.profile.inputNanoUsd + (item.usage?.outputTokens || 0) * run.profile.outputNanoUsd), 0) },
      executionAuthorized: false, testVerdict: null };
  }

  private async locked(manager: EntityManager, id: string) {
    const run = await manager.findOne(HarnessRun, { where: { id }, lock: { mode: 'pessimistic_write' } });
    if (!run) throw new NotFoundException('Harness run not found');
    this.policy(run.task);
    return run;
  }

  private expire(run: HarnessRun): boolean {
    if (!['queued', 'running'].includes(run.status)) return false;
    const expired = run.status === 'running' && (!run.leaseUntil || run.leaseUntil.getTime() <= Date.now());
    const deadline = run.deadline.getTime() <= Date.now();
    if (!expired && !deadline) return false;
    const attempt = run.attempts[run.attempts.length - 1];
    if (attempt?.status === 'running') Object.assign(attempt, { status: 'abandoned', endedAt: new Date().toISOString(), reason: 'Lease or deadline expired; reserved usage remains charged' });
    run.status = deadline ? 'budget_exhausted' : 'queued';
    run.reason = deadline ? 'Wall-time budget exhausted' : 'Worker lease expired';
    run.leaseUntil = null;
    return true;
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
      await manager.query("SELECT pg_advisory_xact_lock(hashtext('harness:dispatch'))");
      const active = await manager.find(HarnessRun, { where: [{ status: 'queued' }, { status: 'running' }], order: { createdAt: 'ASC' }, lock: { mode: 'pessimistic_write' } });
      for (const run of active) if (this.expire(run)) await manager.save(run);
      if (active.filter(run => run.status === 'running').length >= 2) return null;
      for (const run of active.filter(item => item.status === 'queued')) {
        try { await this.fresh(manager, run); }
        catch (error) {
          if (!(error instanceof ConflictException || error instanceof ForbiddenException || error instanceof ServiceUnavailableException)) throw error;
          run.status = 'blocked'; run.reason = error.message;
          await manager.save(run); continue;
        }
        const input = Buffer.byteLength(run.prompt, 'utf8') + 1024;
        const output = run.task.budget.outputTokensPerCall;
        const cost = input * run.profile.inputNanoUsd + output * run.profile.outputNanoUsd;
        const charged = this.view(run).charged;
        if (charged.modelCalls + 1 > run.task.budget.modelCalls || charged.inputTokens + input > run.task.budget.inputTokens ||
            charged.outputTokens + output > run.task.budget.outputTokens || charged.costNanoUsd + cost > run.task.budget.costNanoUsd) {
          run.status = 'budget_exhausted'; run.reason = 'Cannot reserve another bounded model call';
          await manager.save(run); continue;
        }
        const token = randomUUID();
        run.attempts.push({ token, status: 'running', startedAt: new Date().toISOString(), reservedInput: input, reservedOutput: output, reservedCost: cost });
        run.status = 'running'; run.reason = '';
        run.leaseUntil = new Date(Math.min(run.deadline.getTime(), Date.now() + 75000));
        await manager.save(run);
        return { id: run.id, token, role: run.task.role, profile: run.profile, prompt: run.prompt, maxOutputTokens: output,
          inputTokenAllowance: input, leaseUntil: run.leaseUntil, deadline: run.deadline };
      }
      return null;
    });
  }

  async complete(id: string, input: CompleteHarnessDto) {
    return this.database.transaction(async manager => {
      const run = await this.locked(manager, id);
      const attempt = run.attempts.find(item => item.token === input.token);
      if (attempt?.completionHash === hash(input)) return this.view(run);
      if (this.expire(run)) {
        await manager.save(run);
        return this.view(run);
      }
      if (run.status !== 'running' || !attempt || attempt !== run.attempts[run.attempts.length - 1]) throw new ConflictException('Worker lease is no longer current');
      attempt.usage = input.usage;
      attempt.completionHash = hash(input);
      attempt.endedAt = new Date().toISOString();
      run.leaseUntil = null;
      run.status = input.outcome === 'proposal' ? 'awaiting_review' : input.outcome;
      run.reason = input.reason;
      if (input.usage && (input.usage.inputTokens > attempt.reservedInput || input.usage.outputTokens > attempt.reservedOutput)) {
        run.status = 'budget_exhausted'; run.reason = 'Provider usage exceeded reserved allowance';
      } else if (input.outcome === 'proposal') {
        try {
          await this.fresh(manager, run);
          run.proposal = validateProposal(run, input.proposal);
        } catch (error) {
          if (!(error instanceof BadRequestException || error instanceof ConflictException || error instanceof ForbiddenException || error instanceof ServiceUnavailableException)) throw error;
          run.status = 'blocked'; run.reason = error.message;
        }
      }
      attempt.status = run.status;
      attempt.reason = run.reason;
      await manager.save(run);
      return this.view(run);
    });
  }

  async cancel(id: string) {
    return this.database.transaction(async manager => {
      const run = await this.locked(manager, id);
      if (['queued', 'running', 'awaiting_review'].includes(run.status)) {
        const attempt = run.attempts[run.attempts.length - 1];
        if (attempt?.status === 'running') Object.assign(attempt, { status: 'cancelled', endedAt: new Date().toISOString() });
        run.status = 'cancelled'; run.reason = 'Cancelled by operator'; run.leaseUntil = null;
        await manager.save(run);
      }
      return this.view(run);
    });
  }

  async review(id: string, input: ReviewHarnessDto) {
    if (!input.reviewer.trim()) throw new BadRequestException('Reviewer required');
    return this.database.transaction(async manager => {
      const run = await this.locked(manager, id);
      if (run.review?.decision === input.decision && run.review.reviewer === input.reviewer) return this.view(run);
      if (run.status !== 'awaiting_review') throw new ConflictException('Run is not awaiting review');
      await this.fresh(manager, run);
      run.review = { ...input, at: new Date().toISOString() };
      run.status = input.decision;
      await manager.save(run);
      return this.view(run);
    });
  }
}
