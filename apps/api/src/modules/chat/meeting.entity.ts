import { Column, CreateDateColumn, Entity, Generated, Index, PrimaryGeneratedColumn } from 'typeorm';

export interface MeetingAttendee { name: string; email: string; response: string; }

@Entity('chat_meetings')
@Index(['projectId', 'requestId'], { unique: true })
export class Meeting {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column('uuid') projectId: string;
  @Column('uuid') conversationId: string;
  @Column('uuid') createdBy: string;
  @Column('uuid') keyId: string;
  @Column('uuid') requestId: string;
  @Column('uuid') agentId: string;
  @Column({ default: 'Meeting' }) title: string;
  @Column('timestamptz', { nullable: true }) scheduledStart: Date | null;
  @Column('timestamptz', { nullable: true }) scheduledEnd: Date | null;
  @Column('jsonb', { default: [] }) attendees: MeetingAttendee[];
  @Column('jsonb', { default: [] }) participantMemberIds: string[];
  @Column('jsonb', { default: [] }) agentParticipants: { agentId: string; role: string }[];
  @Column({ default: true }) shareTranscriptWithAgents: boolean;
  @Column() mode: 'notes' | 'active';
  @Column({ default: false }) liveVoice: boolean;
  @Column() provider: 'native' | 'teams' | 'google_meet';
  @Column('text', { nullable: true }) url: string | null;
  @Column({ default: 'live' }) status: string;
  @Column('varchar', { nullable: true }) botId: string | null;
  @Column('varchar', { nullable: true }) error: string | null;
  @Column({ default: 1 }) version: number;
  @Column({ default: false }) stopped: boolean;
  @Column('timestamptz', { nullable: true }) syncedAt: Date | null;
  @Column('timestamptz', { nullable: true }) liveAt: Date | null;
  @CreateDateColumn({ type: 'timestamptz' }) createdAt: Date;
}

@Entity('chat_meeting_peers')
@Index(['meetingId', 'memberId'], { unique: true })
export class MeetingPeer {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column('uuid') meetingId: string;
  @Column('uuid') memberId: string;
  @Column() name: string;
  @Column('uuid') sessionId: string;
  @Column('timestamptz') seenAt: Date;
  @Column('timestamptz') consentAt: Date;
}

@Entity('chat_meeting_signals')
@Index(['meetingId', 'requestId'], { unique: true })
export class MeetingSignal {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column('integer') @Generated('increment') sequence: number;
  @Column('uuid') meetingId: string;
  @Column('uuid') requestId: string;
  @Column('uuid') sender: string;
  @Column('uuid') recipient: string;
  @Column('jsonb') payload: { type: string; sdp?: string; candidate?: object };
  @CreateDateColumn({ type: 'timestamptz' }) createdAt: Date;
}

@Entity('chat_meeting_entries')
@Index(['meetingId', 'eventId'], { unique: true })
export class MeetingEntry {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column('integer') @Generated('increment') sequence: number;
  @Column('uuid') meetingId: string;
  @Column() eventId: string;
  @Column() speaker: string;
  @Column() source: 'manual' | 'browser_caption' | 'provider' | 'live_voice';
  @Column('text') text: string;
  @CreateDateColumn({ type: 'timestamptz' }) createdAt: Date;
}

export interface MeetingNotes {
  summary: string;
  items: { kind: 'decision' | 'action' | 'context' | 'question'; text: string; evidence: string[] }[];
  reply: string | null;
  // False only when this run was relevance-gated (not directly addressed by name) and the
  // model decided it had nothing useful to add; summary/items/reply are then forced empty.
  // Always true for a directly-addressed reply or a 'notes' run.
  relevant: boolean;
}

@Entity('chat_meeting_runs')
@Index(['meetingId', 'requestId'], { unique: true })
export class MeetingRun {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column('uuid') meetingId: string;
  @Column('uuid') projectId: string;
  @Column() requestId: string;
  @Column('uuid') memberId: string;
  @Column('uuid') keyId: string;
  @Column() kind: 'notes' | 'reply';
  @Column('text', { default: '' }) prompt: string;
  @Column({ default: false }) requireRelevance: boolean;
  @Column({ default: 'queued' }) status: string;
  @Column() version: number;
  @Column() policyVersion: number;
  @Column() throughSequence: number;
  @Column('jsonb', { default: [] }) evidenceIds: string[];
  @Column('jsonb', { nullable: true }) result: MeetingNotes | null;
  @Column('jsonb', { nullable: true }) usage: object | null;
  @Column('varchar', { nullable: true }) error: string | null;
  @Column('varchar', { nullable: true }) delivery: string | null;
  @Column('uuid', { nullable: true }) publishedMessageId: string | null;
  @Column('timestamptz', { nullable: true }) voiceAt: Date | null;
  @Column('timestamptz', { nullable: true }) startedAt: Date | null;
  @CreateDateColumn({ type: 'timestamptz' }) createdAt: Date;
}

@Entity('chat_meeting_activity')
@Index(['meetingId', 'sequence'])
@Index('chat_meeting_activity_request_unique', ['meetingId', 'requestId'], { unique: true, where: '"requestId" IS NOT NULL' })
export class MeetingActivity {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column('integer') @Generated('increment') sequence: number;
  @Column('uuid') meetingId: string;
  @Column('uuid') projectId: string;
  @Column() kind: 'human_joined' | 'human_left' | 'agent_joined' | 'agent_left' | 'meeting_ended' | 'message';
  @Column('uuid', { nullable: true }) authorId: string | null;
  @Column('varchar', { nullable: true }) authorKind: 'member' | 'agent' | 'system' | null;
  @Column('varchar', { nullable: true }) authorName: string | null;
  @Column('text', { nullable: true }) text: string | null;
  @Column('uuid', { nullable: true }) replyToId: string | null;
  @Column('uuid', { nullable: true }) requestId: string | null;
  @CreateDateColumn({ type: 'timestamptz' }) createdAt: Date;
}

export const meetingEntities = [Meeting, MeetingPeer, MeetingSignal, MeetingEntry, MeetingRun, MeetingActivity];
