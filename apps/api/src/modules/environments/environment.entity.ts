import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

export interface EnvironmentVariable {
  key: string;
  value: string;
  isSecret: boolean;
}

@Entity('environments')
export class Environment {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 100 })
  name: string;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column({ type: 'varchar', length: 20, default: '#3B82F6' })
  color: string;

  @Column({ type: 'jsonb', default: [] })
  variables: EnvironmentVariable[];

  // Default start URL for agent-driven test runs against this environment. A test
  // case's own baseUrl (if set) takes precedence over this.
  @Column({ type: 'varchar', nullable: true })
  baseUrl: string | null;

  @Column({ type: 'boolean', default: false })
  isDefault: boolean;

  // Overrides the QAE test-execution runtime's default retry policy (TEST_RETRY_COUNT /
  // TEST_RETRY_DELAY_MS env vars) for runs against this environment. Null uses the default.
  @Column({ type: 'smallint', nullable: true })
  maxRetries: number | null;

  @Column({ type: 'integer', nullable: true })
  retryDelayMs: number | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
