import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/** Immutable, app-owned publication of a completed skill invocation. */
@Entity('qa_workflow_artifacts')
@Index(['projectId', 'requestId'], { unique: true })
export class WorkflowArtifact {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Index() @Column('uuid') projectId: string;
  @Column('uuid') requestId: string;
  @Column() agentType: string;
  @Column() skill: string;
  @Column({ default: 1 }) schemaVersion: number;
  @Column() contentHash: string;
  // Exact signed bytes are retained so hashes do not depend on JSONB normalization.
  @Column({ type: 'text' }) resultJson: string;
  @Column() status: string;
  @Column({ type: 'text' }) summary: string;
  @Column({ type: 'timestamptz' }) producedAt: Date;
  @CreateDateColumn() publishedAt: Date;
}
