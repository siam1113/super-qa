import { Column, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { SyncJob } from '../../sources/entities/sync-job.entity';
import { ConnectorDocument } from '../../sources/connectors/connector.interface';
import { ExtractionResult } from '../../business/business-extraction.service';

export interface IndexedChunk {
  content: string;
  index: number;
  embedding: number[];
}

@Entity('sync_work')
@Index('sync_work_job_external_id', ['syncJobId', 'externalId'], { unique: true })
export class SyncWork {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'sync_job_id' })
  syncJobId: string;

  @ManyToOne(() => SyncJob, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'sync_job_id' })
  job: SyncJob;

  @Column()
  externalId: string;

  @Column({ type: 'uuid' })
  documentId: string;

  @Column()
  revisionHash: string;

  @Column({ type: 'jsonb' })
  snapshot: ConnectorDocument;

  @Column({ type: 'jsonb', nullable: true })
  chunks: IndexedChunk[] | null;

  @Column({ type: 'jsonb', nullable: true })
  extraction: ExtractionResult | null;
}
