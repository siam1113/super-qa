import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

export type OutpostActivitySource = 'built_in' | 'custom';
export type OutpostAutonomyLevel = 'observer' | 'suggest' | 'act';
export type OutpostTrigger = { type: 'schedule'; cron: string } | { type: 'event'; event: string };

@Entity('outpost_activities')
@Index(['projectId', 'agentId', 'key'], { unique: true })
export class OutpostActivity {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Index() @Column('uuid') projectId: string;
  @Index() @Column('uuid') agentId: string;
  @Column() key: string;
  @Column('varchar', { default: 'built_in' }) source: OutpostActivitySource;
  @Column() name: string;
  @Column('text', { default: '' }) description: string;
  @Column() skill: string;
  // Parameters the skill needs (e.g. profile_id, suite_profile_id) that this
  // project's admin must supply before a built-in can run successfully — the
  // skill registry validates these itself and a run fails loudly if missing.
  @Column('jsonb', { default: {} }) inputs: Record<string, unknown>;
  @Column('text', { nullable: true }) instructions: string | null;
  @Column('jsonb', { default: [] }) triggers: OutpostTrigger[];
  @Column('varchar', { default: 'observer' }) autonomyLevel: OutpostAutonomyLevel;
  @Column({ default: true }) enabled: boolean;
  @Column('uuid', { nullable: true }) createdBy: string | null;
  @CreateDateColumn() createdAt: Date;
  @UpdateDateColumn() updatedAt: Date;
}

export type OutpostRunTrigger = 'manual' | 'schedule' | `event:${string}`;
export type OutpostRunStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'skipped';
export type OutpostApprovalStatus = 'not_required' | 'pending' | 'approved' | 'rejected';

@Entity('outpost_runs')
@Index(['activityId', 'requestId'], { unique: true })
export class OutpostRun {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Index() @Column('uuid') projectId: string;
  @Index() @Column('uuid') activityId: string;
  @Column('uuid') requestId: string;
  @Column() triggeredBy: OutpostRunTrigger;
  @Index() @Column('varchar', { default: 'queued' }) status: OutpostRunStatus;
  @Column('varchar') autonomyLevel: OutpostAutonomyLevel;
  @Column('text', { nullable: true }) resultSummary: string | null;
  @Column('uuid', { nullable: true }) artifactRequestId: string | null;
  // The Console session this run's finding was seeded into — opening it lets
  // the human continue the conversation with the agent about that finding.
  @Column('uuid', { nullable: true }) sessionId: string | null;
  // Whether a human needs to sign off on this run's output. Only Suggest-tier
  // runs that actually produced something need review; Observer is pure FYI
  // and Act already executed under a pre-approved policy.
  @Column('varchar', { default: 'not_required' }) approvalStatus: OutpostApprovalStatus;
  @Column('text', { nullable: true }) error: string | null;
  @Column('timestamptz', { nullable: true }) startedAt: Date | null;
  @Column('timestamptz', { nullable: true }) finishedAt: Date | null;
  @CreateDateColumn() createdAt: Date;
}
