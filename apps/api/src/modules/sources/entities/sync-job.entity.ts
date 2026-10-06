import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Source } from './source.entity';

export type SyncJobStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
export type SyncJobStageStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
export type SyncJobTrigger = 'manual' | 'scheduled' | 'webhook';

export const SYNC_STAGES = ['pulling', 'processing', 'indexing', 'extracting', 'populating'] as const;
export type SyncStageName = (typeof SYNC_STAGES)[number];

export interface SyncJobStage {
  name: SyncStageName;
  status: SyncJobStageStatus;
  startedAt?: Date;
  completedAt?: Date;
  itemsProcessed?: number;
  itemsTotal?: number;
  error?: string;
  metadata?: {
    model?: string;
    tool?: string;
    strategy?: string;
    provider?: string;
    [key: string]: any;
  };
}

export interface SyncJobStats {
  documentsTotal: number;
  documentsNew: number;
  documentsUpdated: number;
  documentsDeleted: number;
  businessItemsExtracted: number;
}

export interface SyncJobLog {
  timestamp: string;
  level: 'info' | 'warn' | 'error' | 'debug';
  stage?: SyncStageName;
  message: string;
}

// Descriptions for UI info tooltips
export const STAGE_DESCRIPTIONS: Record<SyncStageName, string> = {
  pulling: 'Fetching documents from the connected source',
  processing: 'Parsing and preparing documents for indexing',
  indexing: 'Creating searchable index and embeddings',
  extracting: 'Extracting business knowledge from content',
  populating: 'Saving extracted items to context database',
};

export const STATUS_DESCRIPTIONS: Record<SyncJobStatus, string> = {
  queued: 'Job is waiting in queue to start',
  running: 'Sync is actively in progress',
  completed: 'Sync finished successfully',
  failed: 'Sync encountered an error and stopped',
  cancelled: 'Sync was manually cancelled',
};

@Entity('sync_jobs')
export class SyncJob {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ default: 0 })
  pipelineVersion: number;

  @Column({ type: 'jsonb', nullable: true })
  request: Record<string, any> | null;

  @Column({ type: 'uuid', nullable: true })
  leaseToken: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  leaseUntil: Date | null;

  @Column({ default: 0 })
  attempts: number;

  @Column({ type: 'timestamptz', nullable: true })
  nextAttemptAt: Date | null;

  @ManyToOne(() => Source, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'source_id' })
  source: Source;

  @Column({ name: 'source_id' })
  sourceId: string;

  @Column({ type: 'varchar', length: 20, default: 'queued' })
  status: SyncJobStatus;

  @Column({ type: 'varchar', length: 20, default: 'manual' })
  trigger: SyncJobTrigger;

  @Column({ type: 'varchar', length: 30, nullable: true })
  currentStage: SyncStageName | null;

  @Column({ type: 'jsonb', default: [] })
  stages: SyncJobStage[];

  @Column({ type: 'jsonb', nullable: true })
  stats: SyncJobStats | null;

  @Column({ default: 0 })
  itemsProcessed: number;

  @Column({ default: 0 })
  itemsTotal: number;

  @Column({ type: 'text', nullable: true })
  errorMessage: string | null;

  @Column({ type: 'jsonb', nullable: true })
  metadata: Record<string, any> | null;

  @Column({ type: 'jsonb', default: [] })
  logs: SyncJobLog[];

  @Column({ type: 'timestamp', nullable: true })
  startedAt: Date | null;

  @Column({ type: 'timestamp', nullable: true })
  completedAt: Date | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
