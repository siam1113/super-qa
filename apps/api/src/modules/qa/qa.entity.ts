import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, ManyToOne, JoinColumn, Index } from 'typeorm';

export interface QaStep { action: string; expected: string }
export interface QaEvidence { businessItemId: string; documentId: string; sourceId: string; revisionHash: string }

@Entity('qa_test_cases')
export class QaTestCase {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ type: 'text' }) title: string;
  @Column({ default: 'P2' }) priority: string;
  @Column({ default: 'manual' }) automation: string;
  @Column({ default: '' }) owner: string;
  @Column({ default: '' }) flow: string;
  @Column({ type: 'varchar', nullable: true }) risk: string | null;
  @Column({ type: 'varchar', nullable: true }) category: string | null;
  @Column({ type: 'varchar', nullable: true }) technique: string | null;
  @Column({ type: 'varchar', nullable: true }) severity: string | null;
  @Column({ type: 'varchar', nullable: true }) platform: string | null;
  @Column({ type: 'jsonb', default: [] }) tags: string[];
  @Column({ type: 'jsonb' }) steps: QaStep[];
  @Column({ type: 'jsonb', default: [] }) preconditions: string[];
  // Where the agent navigates before step 1. Supports {environment} and {VAR_NAME}
  // placeholders resolved against the run's environment config. Falls back to the
  // environment's own baseUrl (see Environment entity) when unset.
  @Column({ type: 'varchar', nullable: true }) baseUrl: string | null;
  @Column({ default: 'draft' }) reviewStatus: string;
  @Column({ default: 1 }) revision: number;
  @Column({ type: 'varchar', nullable: true }) reviewedBy: string | null;
  @Column({ type: 'jsonb', nullable: true }) evidence: QaEvidence | null;
  // Traceability back to the chat agent's design_test_cases run this case was imported from, if any.
  @Column({ type: 'uuid', nullable: true }) workflowArtifactId: string | null;
  @Column({ type: 'varchar', nullable: true }) sourceCaseId: string | null;
  @CreateDateColumn() createdAt: Date;
  @UpdateDateColumn() updatedAt: Date;
}

@Entity('qa_runs')
export class QaRun {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Index({ unique: true }) @Column('uuid') requestId: string;
  @Column() requestHash: string;
  @Column({ default: 'manual' }) mode: string;
  @Column() environment: string;
  @Column() browser: string;
  @CreateDateColumn() createdAt: Date;
}

@Entity('qa_executions')
export class QaExecution {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Index() @Column('uuid') runId: string;
  @ManyToOne(() => QaRun, { onDelete: 'CASCADE' }) @JoinColumn({ name: 'runId' }) run: QaRun;
  @Index() @Column('uuid') testId: string;
  @Column({ type: 'jsonb' }) snapshot: QaTestCase;
  @Column({ default: 'pending' }) status: string;
  @Column({ type: 'jsonb', nullable: true }) result: { reporter: string; steps: Array<{ actual: string; passed: boolean; evidence: string }>; duration: number } | Record<string, unknown> | null;
  @Column({ type: 'timestamptz', nullable: true }) completedAt: Date | null;
  @Index({ unique: true }) @Column({ type: 'varchar', nullable: true }) agentRunId: string | null;
  @CreateDateColumn() createdAt: Date;
}

@Entity('qa_healing_suggestions')
export class QaHealingSuggestion {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ type: 'text' }) issue: string;
  @Column({ type: 'jsonb' }) affectedTests: string[];
  @Column({ type: 'text' }) currentLocator: string;
  @Column({ type: 'text' }) suggestedLocator: string;
  @Column({ default: '' }) rootCause: string;
  @Column({ default: '' }) owner: string;
  @Column({ default: 'pending' }) status: string;
  @Column({ type: 'varchar', nullable: true }) reviewedBy: string | null;
  @CreateDateColumn() createdAt: Date;
}

@Entity('qa_execution_plans')
export class QaExecutionPlan {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ type: 'text' }) name: string;
  @Column({ type: 'text', default: '' }) description: string;
  @Column({ type: 'jsonb', default: [] }) testIds: string[];
  @Column({ default: 'manual' }) environment: string;
  @Column({ default: 'manual' }) browser: string;
  @CreateDateColumn() createdAt: Date;
  @UpdateDateColumn() updatedAt: Date;
}

// A generate/refine AI request run in the background by the qa-generation queue, so the
// wizard that started it can be closed immediately and reviewed later from the runs list.
@Entity('qa_generation_runs')
export class QaGenerationRun {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column() kind: 'generate' | 'refine';
  @Column({ default: 'pending' }) status: 'pending' | 'running' | 'completed' | 'failed';
  @Column({ type: 'varchar' }) label: string;
  @Column({ type: 'jsonb' }) input: Record<string, unknown>;
  @Column({ type: 'jsonb', nullable: true }) result: Record<string, unknown> | null;
  @Column({ type: 'text', nullable: true }) error: string | null;
  @Column({ default: false }) applied: boolean;
  @CreateDateColumn() createdAt: Date;
  @UpdateDateColumn() updatedAt: Date;
}
