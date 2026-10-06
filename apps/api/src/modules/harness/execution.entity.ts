import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

export interface BrowserStep {
  caseStep: number;
  action: string;
  selector: string;
  operation: 'click' | 'fill' | 'check';
  value?: string;
  assertion: { kind: 'text_equals'; selector: string; expected: string };
}

@Entity('harness_executions')
export class HarnessExecution {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Index({ unique: true }) @Column('uuid') requestId: string;
  @Column() requestHash: string;
  @Column('uuid') proposalRunId: string;
  @Column() targetId: string;
  @Column() targetHash: string;
  @Column() actor: string;
  @Column({ type: 'jsonb' }) steps: BrowserStep[];
  @Column({ type: 'uuid', nullable: true }) retryOf: string | null;
  @Index() @Column({ default: 'queued' }) status: string;
  @Column({ default: '' }) reason: string;
  @Column({ type: 'uuid', nullable: true }) token: string | null;
  @Column({ type: 'timestamptz', nullable: true }) leaseUntil: Date | null;
  @Column({ type: 'timestamptz' }) deadline: Date;
  @Column({ type: 'jsonb', nullable: true }) report: Record<string, unknown> | null;
  @Column({ type: 'text', nullable: true }) screenshot: string | null;
  @Column({ type: 'varchar', nullable: true }) artifactHash: string | null;
  @Column({ type: 'varchar', nullable: true }) completionHash: string | null;
  @Column({ default: false }) flaky: boolean;
  @CreateDateColumn() createdAt: Date;
}
