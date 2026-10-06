import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { SubmitHarnessDto } from './harness.dto';
import { QaTestCase } from '../qa/qa.entity';

export interface HarnessEvidence { documentId: string; sourceId: string; revisionHash: string; content: string }
export interface HarnessProfile { provider: string; model: string; inputNanoUsd: number; outputNanoUsd: number; version: string }
export interface HarnessAttempt {
  token: string;
  startedAt: string;
  endedAt?: string;
  status: string;
  reservedInput: number;
  reservedOutput: number;
  reservedCost: number;
  usage?: { inputTokens: number; outputTokens: number };
  reason?: string;
  completionHash?: string;
}

@Entity('harness_runs')
export class HarnessRun {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Index({ unique: true }) @Column('uuid') requestId: string;
  @Column() requestHash: string;
  @Column({ type: 'jsonb' }) task: SubmitHarnessDto;
  @Column({ type: 'jsonb' }) evidence: HarnessEvidence[];
  @Column({ type: 'jsonb', nullable: true }) caseSnapshot: QaTestCase | null;
  @Column({ type: 'jsonb' }) profile: HarnessProfile;
  @Column({ type: 'text' }) prompt: string;
  @Index() @Column({ default: 'queued' }) status: string;
  @Column({ default: '' }) reason: string;
  @Column({ type: 'jsonb', default: [] }) attempts: HarnessAttempt[];
  @Column({ type: 'jsonb', nullable: true }) proposal: Record<string, unknown> | null;
  @Column({ type: 'jsonb', nullable: true }) review: { decision: string; reviewer: string; at: string } | null;
  @Column({ type: 'timestamptz' }) deadline: Date;
  @Column({ type: 'timestamptz', nullable: true }) leaseUntil: Date | null;
  @CreateDateColumn() createdAt: Date;
}
