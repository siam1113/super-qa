import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { AgentType } from '../types';
import { AgentSession } from './agent-session.entity';

export type TaskStatus = 'todo' | 'in_progress' | 'done' | 'cancelled' | 'blocked';
export type TaskPriority = 'urgent' | 'high' | 'medium' | 'low';

@Entity('agent_tasks')
export class AgentTask {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  title: string;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column({ type: 'varchar', length: 10 })
  agentType: AgentType;

  @Column({ type: 'varchar', length: 20, default: 'todo' })
  status: TaskStatus;

  @Column({ type: 'varchar', length: 10, default: 'medium' })
  priority: TaskPriority;

  @Column({ type: 'simple-array', default: '' })
  labels: string[];

  @Column({ nullable: true })
  sessionId: string | null;

  @ManyToOne(() => AgentSession, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'sessionId' })
  session: AgentSession | null;

  @Column({ type: 'jsonb', nullable: true })
  result: TaskResult | null;

  @Column({ type: 'jsonb', nullable: true })
  metadata: Record<string, unknown> | null;

  @Column({ type: 'text', nullable: true })
  blockedReason: string | null;

  @Column({ type: 'timestamp', nullable: true })
  startedAt: Date | null;

  @Column({ type: 'timestamp', nullable: true })
  completedAt: Date | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}

export interface TaskResult {
  summary?: string;
  artifacts?: TaskArtifact[];
  metrics?: Record<string, number>;
}

export interface TaskArtifact {
  type: 'test_case' | 'script' | 'report' | 'document' | 'other';
  name: string;
  content?: string;
  url?: string;
}
