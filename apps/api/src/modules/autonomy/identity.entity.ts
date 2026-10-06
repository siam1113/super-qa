import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity('qa_org_members')
@Index(['projectId', 'email'], { unique: true })
export class QaOrgMember {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Index() @Column('uuid') projectId: string;
  @Column({ length: 254 }) email: string;
  @Column({ type: 'uuid', unique: true }) keyId: string;
  @Column({ type: 'varchar', nullable: true }) passwordHash: string | null;
  @Column({ default: 0 }) tokenVersion: number;
  @Column({ default: true }) active: boolean;
  @CreateDateColumn() createdAt: Date;
}

@Entity('qa_super_admins')
@Index(['email'], { unique: true })
export class QaSuperAdmin {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ length: 254 }) email: string;
  @Column() passwordHash: string;
  @Column({ default: true }) active: boolean;
  @CreateDateColumn() createdAt: Date;
}

@Entity('qa_org_invitations')
@Index(['email', 'projectId'])
export class QaOrgInvitation {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Index() @Column('uuid') projectId: string;
  @Column({ length: 254 }) email: string;
  @Column() role: string;
  @Index({ unique: true }) @Column() tokenDigest: string;
  @Column({ type: 'timestamptz' }) expiresAt: Date;
  @Column({ type: 'timestamptz', nullable: true }) acceptedAt: Date | null;
  @Column({ type: 'timestamptz', nullable: true }) revokedAt: Date | null;
  @Column({ type: 'uuid', nullable: true }) createdBy: string | null;
  @Column('uuid') memberKeyId: string;
  @CreateDateColumn() createdAt: Date;
}

@Entity('qa_auth_sessions')
@Index(['tokenDigest'], { unique: true })
export class QaAuthSession {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Index() @Column('uuid', { nullable: true }) memberId: string | null;
  @Column('uuid', { nullable: true }) superAdminId: string | null;
  @Column('uuid', { nullable: true }) impersonatedBySuperAdminId: string | null;
  @Column() tokenDigest: string;
  @Column({ type: 'timestamptz' }) expiresAt: Date;
  @Column({ type: 'timestamptz', nullable: true }) revokedAt: Date | null;
  @CreateDateColumn() createdAt: Date;
}

@Entity('qa_oidc_attempts')
@Index(['stateDigest'], { unique: true })
export class QaOidcAttempt {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column() stateDigest: string;
  @Column() nonce: string;
  @Column() verifier: string;
  @Column({ type: 'timestamptz' }) expiresAt: Date;
  @CreateDateColumn() createdAt: Date;
}
