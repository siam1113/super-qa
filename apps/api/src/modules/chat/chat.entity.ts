import { Check, Column, CreateDateColumn, Entity, Generated, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import { ChatRole } from './chat.roles';
import type { AgentModelSelection } from '../agents/types';

@Entity('chat_agents')
@Index(['projectId', 'email'], { unique: true })
@Index(['projectId', 'kind'], { unique: true })
@Check('chat_agents_supported_kind', 'kind IS NULL OR kind IN (\'qae\', \'aue\', \'superqa\')')
export class ChatAgent {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Index() @Column('uuid') projectId: string;
  @Column('varchar', { nullable: true }) kind: ChatRole | null;
  @Column() name: string;
  @Column('varchar', { length: 20, nullable: true }) avatar: string | null;
  @Column('jsonb', { nullable: true }) modelSelection: AgentModelSelection | null;
  @Column('int', { nullable: true }) maxIterations: number | null;
  @Column('real', { nullable: true }) temperature: number | null;
  @Column() email: string;
  @Column('jsonb', { default: [] }) aliases: string[];
  @Column('text', { default: '' }) instructions: string;
  @Column({ default: true }) enabled: boolean;
  @CreateDateColumn() createdAt: Date;
}

export type ChatAgentMemoryCategory = 'preference' | 'decision' | 'workflow' | 'constraint';
export type ChatAgentMemoryStatus = 'active' | 'archived';

@Entity('chat_agent_memories')
@Index(['projectId', 'agentId', 'status', 'importance'])
@Index('chat_agent_memories_active_content', ['projectId', 'agentId', 'contentHash'], { unique: true, where: '"status" = \'active\'' })
export class ChatAgentMemory {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column('uuid') projectId: string;
  @Column('uuid') agentId: string;
  @Column('varchar', { length: 20 }) category: ChatAgentMemoryCategory;
  @Column('text') content: string;
  @Column('varchar', { length: 64 }) contentHash: string;
  @Column('varchar', { length: 10, default: 'active' }) status: ChatAgentMemoryStatus;
  @Column('smallint', { default: 3 }) importance: number;
  @Column('uuid') createdBy: string;
  @Column('uuid') updatedBy: string;
  @Column('integer', { default: 1 }) version: number;
  @Column('timestamptz', { nullable: true }) expiresAt: Date | null;
  @Column('timestamptz', { nullable: true }) lastUsedAt: Date | null;
  @CreateDateColumn({ type: 'timestamptz' }) createdAt: Date;
  @UpdateDateColumn({ type: 'timestamptz' }) updatedAt: Date;
}

@Entity('chat_agent_memory_revisions')
@Index(['projectId', 'memoryId', 'version'], { unique: true })
export class ChatAgentMemoryRevision {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column('uuid') projectId: string;
  @Column('uuid') memoryId: string;
  @Column('integer') version: number;
  @Column('varchar', { length: 12 }) change: 'created' | 'updated' | 'archived' | 'restored';
  @Column('varchar', { length: 20 }) category: ChatAgentMemoryCategory;
  @Column('text') content: string;
  @Column('smallint') importance: number;
  @Column('uuid') actorId: string;
  @CreateDateColumn({ type: 'timestamptz' }) createdAt: Date;
}

@Entity('chat_conversations')
@Index(['projectId', 'dedupKey'], { unique: true })
export class ChatConversation {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Index() @Column('uuid') projectId: string;
  @Column() kind: 'direct' | 'group' | 'external';
  @Column() title: string;
  @Column('uuid') createdBy: string;
  @Column('jsonb') memberIds: string[];
  @Column('uuid', { nullable: true }) agentId: string | null;
  @Column('jsonb', { default: [] }) agentIds: string[];
  @Column('text', { default: '' }) instructions: string;
  @Column('jsonb', { default: {} }) agentInstructions: Record<string, string>;
  @Column({ default: 1 }) policyVersion: number;
  @Column('varchar', { nullable: true }) dedupKey: string | null;
  @Column('uuid', { nullable: true }) installationId: string | null;
  @Column('varchar', { nullable: true }) externalId: string | null;
  @Column({ default: false }) archived: boolean;
  @CreateDateColumn() createdAt: Date;
  @UpdateDateColumn() updatedAt: Date;
}

export interface ChatContent {
  summary: string;
  details: string[];
  task: { title: string; description: string } | null;
}

@Entity('chat_messages')
@Index(['conversationId', 'requestId'], { unique: true })
@Index(['conversationId', 'sequence'])
export class ChatMessage {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column('integer') @Generated('increment') sequence: number;
  @Column('uuid') projectId: string;
  @Column('uuid') conversationId: string;
  @Column() requestId: string;
  @Column() authorId: string;
  @Column() authorName: string;
  @Column() authorKind: 'member' | 'agent' | 'external';
  @Column('text') text: string;
  @Column('jsonb', { nullable: true }) content: ChatContent | null;
  @Column('uuid', { nullable: true }) replyToId: string | null;
  @Column('uuid', { nullable: true }) meetingContextId: string | null;
  @Column({ default: 'sent' }) status: 'queued' | 'running' | 'sent' | 'failed' | 'skipped';
  @Column('varchar', { nullable: true }) error: string | null;
  @Column('varchar', { nullable: true }) externalThreadId: string | null;
  @CreateDateColumn() createdAt: Date;
}

@Entity('chat_tasks')
@Index(['messageId'], { unique: true })
export class ChatTask {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column('uuid') projectId: string;
  @Column('uuid') conversationId: string;
  @Column('uuid') messageId: string;
  @Column() title: string;
  @Column('text') description: string;
  @Column() createdBy: string;
  @Column({ default: 'open' }) status: 'open' | 'done';
  @CreateDateColumn() createdAt: Date;
}

@Entity('chat_work')
@Index(['messageId', 'agentId'], { unique: true })
export class ChatWork {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Index() @Column('uuid') projectId: string;
  @Column('uuid') conversationId: string;
  @Column('uuid') agentId: string;
  @Column('uuid') messageId: string;
  @Column('uuid') responseId: string;
  @Index() @Column({ default: 'queued' }) status: string;
  @Column('uuid', { nullable: true }) leaseToken: string | null;
  @Column('timestamptz', { nullable: true }) leaseUntil: Date | null;
  @Column() policyVersion: number;
  @Column({ default: false }) requireRelevance: boolean;
  @Column('jsonb', { nullable: true }) usage: Record<string, number> | null;
  @CreateDateColumn() createdAt: Date;
}

@Entity('chat_installations')
@Index(['provider', 'providerId'], { unique: true })
export class ChatInstallation {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Index() @Column('uuid') projectId: string;
  @Column('uuid', { nullable: true }) agentId: string | null;
  @Column('jsonb', { default: [] }) agentIds: string[];
  @Column() provider: 'slack' | 'teams';
  @Column({ type: 'varchar', length: 20, default: 'read_reply' }) accessMode: 'read_only' | 'read_reply';
  @Column() providerId: string;
  @Column() name: string;
  @Column() botId: string;
  @Column({ select: false }) secret: string;
  @Column({ default: true }) enabled: boolean;
  @CreateDateColumn() createdAt: Date;
}

@Entity('chat_deliveries')
export class ChatDelivery {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column('uuid') installationId: string;
  @Column('uuid', { unique: true }) messageId: string;
  @Column('jsonb') address: { conversationId: string; threadId: string; serviceUrl?: string };
  @Column({ default: 'waiting' }) status: string;
  @Column('varchar', { nullable: true }) externalId: string | null;
  @Column('timestamptz', { nullable: true }) startedAt: Date | null;
  @CreateDateColumn() createdAt: Date;
}

@Entity('chat_channels')
@Index(['installationId', 'externalId'], { unique: true })
export class ChatChannel {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column('uuid') installationId: string;
  @Column() externalId: string;
  @Column() name: string;
  @CreateDateColumn() createdAt: Date;
}

export type ChatPromptScenario = 'conversation' | 'meeting';
export const chatPromptScenarios: ChatPromptScenario[] = ['conversation', 'meeting'];

@Entity('chat_prompts')
@Index(['projectId', 'name'], { unique: true })
export class ChatPrompt {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Index() @Column('uuid') projectId: string;
  @Column('varchar', { length: 60 }) name: string;
  @Column('text') content: string;
  @Column('uuid', { nullable: true }) createdBy: string | null;
  @Column('uuid', { nullable: true }) updatedBy: string | null;
  @CreateDateColumn() createdAt: Date;
  @UpdateDateColumn() updatedAt: Date;
}

@Entity('chat_agent_prompt_installs')
@Index(['projectId', 'agentId', 'scenario'], { unique: true })
export class ChatAgentPromptInstall {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column('uuid') projectId: string;
  @Column('uuid') agentId: string;
  @Column('varchar', { length: 20 }) scenario: ChatPromptScenario;
  @Column('uuid') promptId: string;
  @UpdateDateColumn() updatedAt: Date;
}

export const chatEntities = [ChatAgent, ChatAgentMemory, ChatAgentMemoryRevision, ChatConversation, ChatMessage, ChatTask, ChatWork, ChatInstallation, ChatDelivery, ChatChannel, ChatPrompt, ChatAgentPromptInstall];
