import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { Document } from './document.entity';

@Entity('chunks')
export class Chunk {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Document, (document) => document.chunks, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'document_id' })
  document: Document;

  @Column({ name: 'document_id' })
  documentId: string;

  @Column({ type: 'text' })
  content: string;

  @Index()
  @Column()
  chunkIndex: number;

  @Column({ type: 'jsonb', nullable: true })
  metadata: Record<string, unknown> | null;

  @CreateDateColumn()
  createdAt: Date;

  // Note: pgvector column will be added via migration after pgvector extension is enabled
  // For now, we store embeddings as JSON array and convert later
  @Column({ type: 'jsonb', nullable: true })
  embedding: number[] | null;
}
