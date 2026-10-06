import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity('chat_meeting_voice')
@Index(['meetingId', 'agentId'], { unique: true })
export class MeetingVoice {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column('uuid') meetingId: string;
  @Column('uuid') agentId: string;
  @Column('uuid') projectId: string;
  @Column('uuid', { nullable: true }) peerSession: string | null;
  @Column('varchar', { nullable: true, select: false }) capability: string | null;
  @Column('varchar', { nullable: true, select: false }) providerId: string | null;
  @Column({ type: 'varchar', default: 'marin' }) openAIVoice: string;
  @Column({ default: 'pending' }) status: string;
  @Column({ default: false }) stopped: boolean;
  @Column({ default: false }) finalized: boolean;
  @Column('float', { default: 0 }) seconds: number;
  @Column('float', { default: 0 }) attemptSeconds: number;
  @Column({ default: 1 }) attempts: number;
  @Column({ default: 1 }) policyVersion: number;
  @Column('timestamptz') controlAt: Date;
  @Column('varchar', { nullable: true }) error: string | null;
  @Column('timestamptz') seenAt: Date;
  @Column('timestamptz') expiresAt: Date;
  @CreateDateColumn({ type: 'timestamptz' }) createdAt: Date;
}
