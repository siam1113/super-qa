import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';
import { AgentType, AgentStatus, AgentMessage } from '../types';

@Entity('agent_sessions')
export class AgentSession {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 10 })
  agentType: AgentType;

  @Column({ type: 'varchar', length: 20, default: 'idle' })
  status: AgentStatus;

  @Column({ type: 'jsonb', default: [] })
  messages: AgentMessage[];

  @Column({ type: 'jsonb', default: {} })
  context: Record<string, unknown>;

  @Column({ type: 'jsonb', nullable: true })
  metadata: Record<string, unknown> | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
