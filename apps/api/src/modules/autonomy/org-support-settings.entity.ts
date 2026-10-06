import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

export interface SupportIntegrationSettings {
  enabled: boolean;
  provider: string;
  baseUrl: string;
  workspace: string;
  queue: string;
}

export interface OrganizationSupportSettings {
  ticketing: SupportIntegrationSettings;
  liveChat: SupportIntegrationSettings;
}

export const defaultOrganizationSupportSettings: OrganizationSupportSettings = {
  ticketing: { enabled: false, provider: 'none', baseUrl: '', workspace: '', queue: '' },
  liveChat: { enabled: false, provider: 'none', baseUrl: '', workspace: '', queue: '' },
};

@Entity('qa_org_support_settings')
export class QaOrgSupportSettings {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Index({ unique: true }) @Column('uuid') projectId: string;
  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" }) settings: OrganizationSupportSettings;
  @CreateDateColumn({ type: 'timestamptz' }) createdAt: Date;
  @UpdateDateColumn({ type: 'timestamptz' }) updatedAt: Date;
}
