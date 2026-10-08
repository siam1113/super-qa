import { Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { InjectQueue, Process, Processor } from '@nestjs/bull';
import { OnEvent, EventEmitter2 } from '@nestjs/event-emitter';
import { InjectRepository } from '@nestjs/typeorm';
import { Queue, Job } from 'bull';
import { In, Repository } from 'typeorm';
import { randomUUID } from 'crypto';
import { OutpostActivity, OutpostRun, OutpostAutonomyLevel, OutpostTrigger } from './outpost.entity';
import { BUILTIN_ACTIVITIES } from './outpost.catalog';
import { ChatAgent } from '../chat/chat.entity';
import { AgentsService } from '../agents/agents.service';

export interface CustomActivityInput {
  name: string;
  description?: string;
  skill: string;
  inputs?: Record<string, unknown>;
  instructions?: string;
  triggers: OutpostTrigger[];
  autonomyLevel: OutpostAutonomyLevel;
  createdBy: string;
}

@Injectable()
@Processor('outpost')
export class OutpostService implements OnModuleInit {
  private readonly logger = new Logger(OutpostService.name);

  constructor(
    @InjectRepository(OutpostActivity) private readonly activities: Repository<OutpostActivity>,
    @InjectRepository(OutpostRun) private readonly runs: Repository<OutpostRun>,
    @InjectRepository(ChatAgent) private readonly chatAgents: Repository<ChatAgent>,
    @InjectQueue('outpost') private readonly queue: Queue,
    private readonly agentsService: AgentsService,
    private readonly events: EventEmitter2,
  ) {}

  async onModuleInit() {
    const enabled = await this.activities.find({ where: { enabled: true } });
    for (const activity of enabled) await this.reconcileSchedule(activity);
  }

  // ---------- catalog / listing ----------

  async listActivities(agentId: string): Promise<OutpostActivity[]> {
    const agent = await this.chatAgents.findOneBy({ id: agentId });
    if (!agent) throw new NotFoundException('Agent not found');
    if (agent.kind === 'qae' || agent.kind === 'aue') await this.ensureBuiltins(agent);
    return this.activities.find({ where: { agentId }, order: { name: 'ASC' } });
  }

  private async ensureBuiltins(agent: ChatAgent) {
    const defs = BUILTIN_ACTIVITIES[agent.kind as 'qae' | 'aue'] || [];
    for (const def of defs) {
      const existing = await this.activities.findOneBy({ projectId: agent.projectId, agentId: agent.id, key: def.key });
      if (existing) continue;
      const activity = await this.activities.save(this.activities.create({
        projectId: agent.projectId, agentId: agent.id, key: def.key, source: 'built_in',
        name: def.name, description: def.description, skill: def.skill, inputs: {},
        triggers: def.triggers, autonomyLevel: def.autonomyLevel, enabled: true, createdBy: null,
      }));
      await this.reconcileSchedule(activity);
    }
  }

  async createCustom(agentId: string, input: CustomActivityInput): Promise<OutpostActivity> {
    const agent = await this.chatAgents.findOneBy({ id: agentId });
    if (!agent) throw new NotFoundException('Agent not found');
    const activity = await this.activities.save(this.activities.create({
      projectId: agent.projectId, agentId, key: 'custom.' + randomUUID(), source: 'custom',
      name: input.name, description: input.description || '', skill: input.skill, inputs: input.inputs || {},
      instructions: input.instructions || null, triggers: input.triggers, autonomyLevel: input.autonomyLevel,
      enabled: true, createdBy: input.createdBy,
    }));
    await this.reconcileSchedule(activity);
    return activity;
  }

  async setEnabled(activityId: string, enabled: boolean): Promise<OutpostActivity> {
    const activity = await this.get(activityId);
    activity.enabled = enabled;
    await this.activities.save(activity);
    await this.reconcileSchedule(activity);
    return activity;
  }

  async setAutonomyLevel(activityId: string, autonomyLevel: OutpostAutonomyLevel): Promise<OutpostActivity> {
    const activity = await this.get(activityId);
    activity.autonomyLevel = autonomyLevel;
    return this.activities.save(activity);
  }

  async setInputs(activityId: string, inputs: Record<string, unknown>): Promise<OutpostActivity> {
    const activity = await this.get(activityId);
    activity.inputs = inputs;
    return this.activities.save(activity);
  }

  async listRuns(activityId: string): Promise<OutpostRun[]> {
    return this.runs.find({ where: { activityId }, order: { createdAt: 'DESC' }, take: 50 });
  }

  // The "Recent Activities" feed: every run across every Activity this agent
  // owns, newest first, with just enough Activity metadata to render a card.
  async listRecentRuns(agentId: string): Promise<Array<OutpostRun & { activityName: string; activityKey: string; activitySource: string }>> {
    const activityRows = await this.activities.find({ where: { agentId } });
    const byId = new Map(activityRows.map(activity => [activity.id, activity]));
    if (!byId.size) return [];
    const runs = await this.runs.find({ where: { activityId: In([...byId.keys()]) }, order: { createdAt: 'DESC' }, take: 50 });
    return runs.map(run => {
      const activity = byId.get(run.activityId);
      return { ...run, activityName: activity?.name ?? 'Unknown activity', activityKey: activity?.key ?? '', activitySource: activity?.source ?? 'custom' };
    });
  }

  async setApproval(runId: string, approved: boolean): Promise<OutpostRun> {
    const run = await this.runs.findOneBy({ id: runId });
    if (!run) throw new NotFoundException('Run not found');
    if (run.approvalStatus === 'not_required') throw new Error('This run does not require approval');
    run.approvalStatus = approved ? 'approved' : 'rejected';
    return this.runs.save(run);
  }

  async runNow(activityId: string): Promise<OutpostRun> {
    const activity = await this.get(activityId);
    return this.enqueueRun(activity, 'manual');
  }

  private async get(activityId: string): Promise<OutpostActivity> {
    const activity = await this.activities.findOneBy({ id: activityId });
    if (!activity) throw new NotFoundException('Activity not found');
    return activity;
  }

  // ---------- trigger plumbing ----------

  private async reconcileSchedule(activity: OutpostActivity) {
    const repeatables = await this.queue.getRepeatableJobs();
    for (const job of repeatables) if (job.id === activity.id) await this.queue.removeRepeatableByKey(job.key);
    if (!activity.enabled) return;
    const schedule = activity.triggers.find((trigger): trigger is { type: 'schedule'; cron: string } => trigger.type === 'schedule');
    if (!schedule) return;
    await this.queue.add('run-activity', { activityId: activity.id, triggeredBy: 'schedule' },
      { repeat: { cron: schedule.cron }, jobId: activity.id });
  }

  @OnEvent('outpost.run.completed')
  async onRunCompleted(payload: { projectId: string; agentKind: string; activityKey: string }) {
    await this.fireEvent(payload.projectId, 'outpost.run.completed');
  }

  @OnEvent('outpost.activity.finding')
  async onFinding(payload: { projectId: string; agentKind: string; activityKey: string }) {
    await this.fireEvent(payload.projectId, 'outpost.activity.finding');
  }

  private async fireEvent(projectId: string, event: string) {
    const candidates = await this.activities.find({ where: { projectId, enabled: true } });
    for (const activity of candidates) {
      if (activity.triggers.some(trigger => trigger.type === 'event' && trigger.event === event)) {
        await this.enqueueRun(activity, ('event:' + event) as OutpostRun['triggeredBy']);
      }
    }
  }

  private async enqueueRun(activity: OutpostActivity, triggeredBy: OutpostRun['triggeredBy']): Promise<OutpostRun> {
    const run = await this.runs.save(this.runs.create({
      projectId: activity.projectId, activityId: activity.id, requestId: randomUUID(),
      triggeredBy, status: 'queued', autonomyLevel: activity.autonomyLevel,
    }));
    await this.queue.add('run-activity', { runId: run.id });
    return run;
  }

  // ---------- execution ----------

  @Process({ name: 'run-activity', concurrency: 3 })
  async handleRun(job: Job<{ runId?: string; activityId?: string; triggeredBy?: string }>) {
    // Bull repeatable jobs (schedule triggers) carry activityId, not runId — materialize the run row now.
    let run = job.data.runId ? await this.runs.findOneBy({ id: job.data.runId }) : null;
    if (!run && job.data.activityId) {
      const activity = await this.activities.findOneBy({ id: job.data.activityId });
      if (!activity || !activity.enabled) return;
      run = await this.runs.save(this.runs.create({
        projectId: activity.projectId, activityId: activity.id, requestId: randomUUID(),
        triggeredBy: 'schedule', status: 'queued', autonomyLevel: activity.autonomyLevel,
      }));
    }
    if (!run) return;
    const activity = await this.activities.findOneBy({ id: run.activityId });
    const agent = activity ? await this.chatAgents.findOneBy({ id: activity.agentId }) : null;
    if (!activity || !agent || (agent.kind !== 'qae' && agent.kind !== 'aue')) {
      run.status = 'failed'; run.error = 'Activity or agent no longer exists'; run.finishedAt = new Date();
      await this.runs.save(run);
      return;
    }

    run.status = 'running';
    run.startedAt = new Date();
    await this.runs.save(run);

    try {
      const result = await this.agentsService.runWorkflowSkill(agent.kind, activity.skill, activity.inputs,
        run.requestId, run.projectId, activity.autonomyLevel === 'act');
      run.resultSummary = result.summary;
      if (result.publication !== 'local') run.artifactRequestId = run.requestId;

      if (!this.isNotable(result.status, result.data)) {
        run.status = 'skipped';
      } else {
        // Seeds a Console session only — Outpost findings surface in the Recent
        // Activities feed (OutpostPanel) and the Console they link to, never in the
        // general team Chat. Posting into a shared ChatConversation as well made every
        // finding show up in everyone's Chat UI indistinguishable from a human message.
        const text = this.describe(activity.name, result.summary, result.status);
        const session = await this.agentsService.seedConsoleSession(agent.kind, text);
        run.sessionId = session.id;
        run.status = 'succeeded';
        run.approvalStatus = activity.autonomyLevel === 'suggest' ? 'pending' : 'not_required';
        this.events.emit('outpost.run.completed', { projectId: activity.projectId, agentKind: agent.kind, activityKey: activity.key });
        this.events.emit('outpost.activity.finding', { projectId: activity.projectId, agentKind: agent.kind, activityKey: activity.key, summary: result.summary });
      }
    } catch (error) {
      run.status = 'failed';
      run.error = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Outpost activity ${activity.id} failed: ${run.error}`);
    }
    run.finishedAt = new Date();
    await this.runs.save(run);
  }

  // A skill run is "notable" (worth an unprompted chat post) unless it completed
  // cleanly with every known finding/issue list empty. Unrecognized result shapes
  // default to notable — silence is a choice the agent should visibly make, not one
  // this heuristic makes for it by guessing wrong.
  private isNotable(status: string, data: Record<string, unknown>): boolean {
    if (status !== 'completed') return true;
    const findingKeys = ['findings', 'gaps', 'issues', 'warnings', 'mismatches'];
    const present = findingKeys.filter(key => Array.isArray((data as any)?.[key]));
    if (!present.length) return true;
    return present.some(key => ((data as any)[key] as unknown[]).length > 0);
  }

  private describe(activityName: string, summary: string, status: string): string {
    const prefix = status === 'completed' ? '' : `[${status}] `;
    return `${prefix}${activityName}: ${summary}`.slice(0, 8000);
  }
}
