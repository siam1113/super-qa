import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  OneToMany,
  JoinColumn,
} from 'typeorm';
import { Source } from '../../sources/entities/source.entity';
import { Document } from '../../documents/entities/document.entity';

export type BusinessItemType =
  // Product
  | 'flow'
  | 'fact'
  | 'entity'
  | 'rule'
  | 'state'
  | 'permission'
  | 'integration'
  | 'constraint'
  | 'configuration'
  | 'terminology'
  // Technical
  | 'api'
  | 'code'
  | 'architecture'
  | 'database'
  // Quality
  | 'test_case'
  | 'requirement'
  | 'defect'
  // Automation
  | 'dom'
  | 'locator'
  | 'action'
  | 'data_setup'
  | 'auth';

export type ConfidenceLevel = 'high' | 'medium' | 'low' | 'inferred';

export type VerificationStatus = 'unverified' | 'verified' | 'rejected';

@Entity('business_items')
export class BusinessItem {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 50 })
  type: BusinessItemType;

  @Column()
  name: string;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column({ type: 'jsonb', nullable: true })
  content: BusinessItemContent | null;

  @Column({ type: 'varchar', length: 20, default: 'inferred' })
  confidence: ConfidenceLevel;

  @Column({ type: 'varchar', length: 20, default: 'unverified' })
  verificationStatus: VerificationStatus;

  @Column({ type: 'simple-array', default: '' })
  tags: string[];

  @Column({ type: 'jsonb', nullable: true })
  metadata: Record<string, any> | null;

  @Column({ nullable: true })
  sourceId: string | null;

  @ManyToOne(() => Source, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'sourceId' })
  source: Source | null;

  @Column({ nullable: true })
  documentId: string | null;

  @ManyToOne(() => Document, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'documentId' })
  document: Document | null;

  @Column({ type: 'varchar', nullable: true })
  externalId: string | null;

  @OneToMany(() => BusinessRelationship, (rel) => rel.fromItem)
  outgoingRelationships: BusinessRelationship[];

  @OneToMany(() => BusinessRelationship, (rel) => rel.toItem)
  incomingRelationships: BusinessRelationship[];

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}

// Type-specific content structures
export interface FlowContent {
  steps: Array<{
    order: number;
    name: string;
    description?: string;
    actor?: string;
  }>;
  startCondition?: string;
  endCondition?: string;
  alternativePaths?: string[];
}

export interface FactContent {
  value: string;
  unit?: string;
  effectiveFrom?: string;
  effectiveUntil?: string;
  jurisdiction?: string;
}

export interface EntityContent {
  attributes: Array<{
    name: string;
    type: string;
    required?: boolean;
    description?: string;
  }>;
  relationships?: string[];
}

export interface RuleContent {
  condition: string;
  action: string;
  priority?: number;
  exceptions?: string[];
}

export interface StateContent {
  states: Array<{
    name: string;
    description?: string;
    isInitial?: boolean;
    isFinal?: boolean;
  }>;
  transitions: Array<{
    from: string;
    to: string;
    trigger?: string;
    guard?: string;
  }>;
}

export interface PermissionContent {
  role: string;
  resource: string;
  actions: string[];
  conditions?: string[];
}

export interface IntegrationContent {
  system: string;
  type: 'api' | 'webhook' | 'file' | 'database' | 'message_queue' | 'other';
  direction: 'inbound' | 'outbound' | 'bidirectional';
  dataTypes?: string[];
  frequency?: string;
}

export interface ConstraintContent {
  type: 'min' | 'max' | 'range' | 'pattern' | 'enum' | 'custom';
  value: string | number | { min?: number; max?: number };
  errorMessage?: string;
}

export interface ConfigurationContent {
  key: string;
  value: string;
  environment?: string;
  featureFlag?: boolean;
  conditions?: string[];
}

export interface TerminologyContent {
  term: string;
  definition: string;
  aliases?: string[];
  context?: string;
  notToBeConfusedWith?: string[];
}

// Technical content types
export interface ApiContent {
  method?: string;
  endpoint: string;
  description?: string;
  requestBody?: string;
  responseBody?: string;
  authentication?: string;
  version?: string;
}

export interface CodeContent {
  language: string;
  path: string;
  snippet?: string;
  purpose?: string;
  dependencies?: string[];
}

export interface ArchitectureContent {
  component: string;
  layer?: string;
  dependencies?: string[];
  technologies?: string[];
  description?: string;
}

export interface DatabaseContent {
  tableName?: string;
  schema?: string;
  columns?: Array<{ name: string; type: string; nullable?: boolean }>;
  indexes?: string[];
  relationships?: string[];
}

// Quality content types
export interface TestCaseContent {
  steps: Array<{ order: number; action: string; expected: string }>;
  preconditions?: string[];
  priority?: string;
  automationStatus?: 'automated' | 'manual' | 'partial';
  tags?: string[];
}

export interface RequirementContent {
  type: 'functional' | 'non-functional' | 'business' | 'technical';
  priority?: string;
  status?: string;
  acceptanceCriteria?: string[];
  stakeholder?: string;
}

export interface DefectContent {
  severity: 'critical' | 'high' | 'medium' | 'low';
  status: 'open' | 'in_progress' | 'resolved' | 'closed';
  stepsToReproduce?: string[];
  expectedBehavior?: string;
  actualBehavior?: string;
  affectedArea?: string;
}

// Automation content types
export interface DomContent {
  pageName: string;
  url?: string;
  elements: Array<{ name: string; selector: string; type: string }>;
  screenshot?: string;
}

export interface LocatorContent {
  selector: string;
  type: 'css' | 'xpath' | 'id' | 'name' | 'role' | 'text' | 'testid';
  element: string;
  reliability?: number;
  alternatives?: string[];
}

export interface ActionContent {
  actionType: 'click' | 'type' | 'select' | 'wait' | 'assert' | 'navigate' | 'custom';
  target?: string;
  value?: string;
  code?: string;
  reusable?: boolean;
}

export interface DataSetupContent {
  entityType: string;
  operation: 'create' | 'update' | 'delete' | 'seed';
  data?: Record<string, unknown>;
  script?: string;
  dependencies?: string[];
}

export interface AuthContent {
  authType: 'basic' | 'oauth' | 'jwt' | 'api_key' | 'session';
  credentials?: string;
  roles?: string[];
  permissions?: string[];
}

export type BusinessItemContent =
  | FlowContent
  | FactContent
  | EntityContent
  | RuleContent
  | StateContent
  | PermissionContent
  | IntegrationContent
  | ConstraintContent
  | ConfigurationContent
  | TerminologyContent
  // Technical
  | ApiContent
  | CodeContent
  | ArchitectureContent
  | DatabaseContent
  // Quality
  | TestCaseContent
  | RequirementContent
  | DefectContent
  // Automation
  | DomContent
  | LocatorContent
  | ActionContent
  | DataSetupContent
  | AuthContent;

// Relationship types between business items
export type RelationshipType =
  | 'references'
  | 'implements'
  | 'depends_on'
  | 'part_of'
  | 'triggers'
  | 'validates'
  | 'contradicts'
  | 'supersedes'
  | 'related_to';

@Entity('business_relationships')
export class BusinessRelationship {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 50 })
  type: RelationshipType;

  @Column()
  fromItemId: string;

  @ManyToOne(() => BusinessItem, (item) => item.outgoingRelationships, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'fromItemId' })
  fromItem: BusinessItem;

  @Column()
  toItemId: string;

  @ManyToOne(() => BusinessItem, (item) => item.incomingRelationships, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'toItemId' })
  toItem: BusinessItem;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column({ type: 'jsonb', nullable: true })
  metadata: Record<string, any> | null;

  @CreateDateColumn()
  createdAt: Date;
}
