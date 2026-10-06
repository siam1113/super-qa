import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

export interface BenchmarkSample {
  id: string;
  defective: boolean;
  suiteId: string;
  manifestHash: string;
  revision: string;
  revisionCheckId: string;
  targetCheckId: string;
  reviewedBy: string;
  labelEvidence: string;
}

export interface BenchmarkCorpus {
  name: string;
  kind: 'synthetic' | 'real_project';
  projectId: string;
  repetitions: number;
  samples: BenchmarkSample[];
}

@Entity('qa_benchmarks')
@Index(['projectId', 'requestId'], { unique: true })
export class QaBenchmark {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Index() @Column('uuid') projectId: string;
  @Column('uuid') requestId: string;
  @Column({ type: 'jsonb' }) corpus: BenchmarkCorpus;
  @Column() corpusHash: string;
  @Column({ type: 'uuid', nullable: true }) approvedBy: string | null;
  @Column({ default: true }) paused: boolean;
  @Column({ type: 'jsonb', default: [] }) runIds: string[];
  @CreateDateColumn() createdAt: Date;
}
