import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity('qa_projects')
export class QaProject {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Index() @Column('uuid', { nullable: true }) organizationId: string | null;
  @Column() name: string;
  @Column() workspaceId: string;
  @Column() applicationId: string;
  @Column() environment: string;
  @Column({ default: false }) paused: boolean;
  @Column({ type: 'jsonb' }) origins: string[];
  @Column({ type: 'jsonb' }) targets: string[];
  @Column({ type: 'jsonb' }) requirements: string[];
  @Column({ default: 20 }) dailyRunLimit: number;
  @Column('timestamptz', { nullable: true }) onboardingCompletedAt: Date | null;
  @CreateDateColumn() createdAt: Date;
}

@Entity('qa_organizations')
export class QaOrganization {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column() name: string;
  @CreateDateColumn() createdAt: Date;
}

@Entity('qa_project_keys')
export class ProjectKey {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Index() @Column('uuid') projectId: string;
  @Index({ unique: true }) @Column() digest: string;
  @Column() role: string;
  @Column() label: string;
  @Column({ type: 'timestamptz' }) expiresAt: Date;
  @Column({ default: false }) revoked: boolean;
}

export interface AutonomousCheck {
  id: string;
  requirement: string;
  kind: 'api' | 'browser' | 'live' | 'repository' | 'api_flow';
  profileHash?: string;
  assertions?: string[];
  origin?: string;
  path?: string;
  expectedStatus?: number;
  pointer?: string;
  expected?: string | number | boolean | null;
  proposalRunId?: string;
  targetId?: string;
  bindings?: Array<{ operation: 'click' | 'fill' | 'check'; value?: string }>;
}

@Entity('qa_autonomous_suites')
export class AutonomousSuite {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Index() @Column('uuid') projectId: string;
  @Column() name: string;
  @Column({ default: 1 }) version: number;
  @Column({ type: 'uuid', nullable: true }) previousId: string | null;
  @Column({ type: 'jsonb' }) checks: AutonomousCheck[];
  @Column() manifestHash: string;
  @Column({ type: 'uuid', nullable: true }) approvedBy: string | null;
  @CreateDateColumn() createdAt: Date;
}

@Entity('qa_autonomous_runs')
@Index(['projectId', 'requestId'], { unique: true })
export class AutonomousRun {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column('uuid') projectId: string;
  @Column('uuid') requestId: string;
  @Column('uuid') suiteId: string;
  @Column({ type: 'jsonb' }) snapshot: AutonomousSuite;
  @Column({ default: 'queued' }) status: string;
  @Column({ type: 'uuid', nullable: true }) token: string | null;
  @Column({ type: 'uuid', nullable: true }) workerKeyId: string | null;
  @Column({ type: 'timestamptz' }) deadline: Date;
  @Column({ type: 'jsonb', default: {} }) browserExecutions: Record<string, string>;
  @Column({ type: 'jsonb', nullable: true }) results: Array<Record<string, unknown>> | null;
  @Column({ type: 'varchar', nullable: true }) completionHash: string | null;
  @Column({ type: 'jsonb', nullable: true }) dataset: Record<string, unknown> | null;
  @Column({ type: 'jsonb', nullable: true }) cleanupReceipt: Record<string, unknown> | null;
  @Column({ type: 'jsonb', nullable: true }) repairPatch: Record<string, unknown> | null;
  @CreateDateColumn() createdAt: Date;
}

@Entity('qa_audit_events')
export class QaAuditEvent {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Index() @Column('uuid') projectId: string;
  @Column() actor: string;
  @Column() action: string;
  @Column({ type: 'jsonb', default: {} }) data: Record<string, unknown>;
  @CreateDateColumn() createdAt: Date;
}
