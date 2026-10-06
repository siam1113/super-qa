import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  OneToMany,
  JoinColumn,
  Index,
} from 'typeorm';
import { Source } from '../../sources/entities/source.entity';
import { Chunk } from './chunk.entity';

export type DocumentType =
  | 'requirement'
  | 'code'
  | 'issue'
  | 'pr'
  | 'wiki'
  | 'test_case'
  | 'api_spec'
  | 'comment'
  | 'file';

@Entity('documents')
export class Document {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Source, (source) => source.documents, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'source_id' })
  source: Source;

  @Column({ name: 'source_id' })
  sourceId: string;

  @Index()
  @Column()
  externalId: string;

  @Column({ type: 'varchar', length: 50 })
  type: DocumentType;

  @Column()
  title: string;

  @Column({ type: 'text' })
  content: string;

  @Column({ type: 'varchar', nullable: true })
  url: string | null;

  @Column({ type: 'jsonb', nullable: true })
  metadata: Record<string, unknown> | null;

  @Index()
  @Column()
  contentHash: string;

  @Column({ type: 'varchar', nullable: true })
  processedHash: string | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @OneToMany(() => Chunk, (chunk) => chunk.document)
  chunks: Chunk[];
}
