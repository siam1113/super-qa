import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToMany,
} from 'typeorm';
import { Document } from '../../documents/entities/document.entity';

export type SourceType =
  | 'github'
  | 'jira'
  | 'confluence'
  | 'notion'
  | 'zephyr'
  | 'azure'
  | 'gitlab'
  | 'postman'
  | 'swagger'
  | 'database'
  | 'api';

export type SourceStatus = 'connected' | 'disconnected' | 'syncing' | 'error';
export type SyncMode = 'auto' | 'manual';
export type AuthType = 'token' | 'oauth';

export interface SourceConfig {
  authType: AuthType;
  token?: string;
  oauth?: {
    accessToken: string;
    refreshToken: string;
    expiresAt: Date;
  };
  baseUrl?: string;
  repository?: string;
  project?: string;
  spaceKey?: string;
  cloudId?: string;
  additionalConfig?: Record<string, unknown>;
}

export interface SyncState {
  lastCursor?: string;          // Last pagination cursor
  lastSyncedAt?: Date;          // Last successful sync timestamp
  lastModifiedAt?: Date;        // Last modified date from source (for incremental)
  etag?: string;                // ETag for conditional requests
}

export interface WebhookConfig {
  enabled: boolean;
  secret?: string;              // Webhook secret for verification
  url?: string;                 // Our webhook URL
  registeredAt?: Date;          // When webhook was registered with source
  webhookId?: string;           // ID of webhook in source system
}

@Entity('sources')
export class Source {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  name: string;

  @Column({ type: 'varchar', length: 50 })
  type: SourceType;

  @Column({ type: 'jsonb' })
  config: SourceConfig;

  @Column({ type: 'varchar', length: 50, default: 'disconnected' })
  status: SourceStatus;

  @Column({ type: 'timestamp', nullable: true })
  lastSync: Date | null;

  @Column({ type: 'varchar', length: 20, default: 'manual' })
  syncMode: SyncMode;

  @Column({ default: 0 })
  itemsCount: number;

  @Column({ type: 'text', nullable: true })
  errorMessage: string | null;

  @Column({ type: 'simple-array', default: '' })
  permissions: string[];

  @Column({ type: 'jsonb', nullable: true })
  syncState: SyncState | null;

  @Column({ type: 'jsonb', nullable: true })
  webhookConfig: WebhookConfig | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @OneToMany(() => Document, (document) => document.source)
  documents: Document[];
}
