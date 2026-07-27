import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

@Schema({ timestamps: true })
export class TestCase extends Document {
  @Prop({ required: true, unique: true })
  id: string;

  @Prop({ required: true })
  title: string;

  @Prop({ enum: ['P0', 'P1', 'P2', 'P3'], default: 'P2' })
  priority: string;

  @Prop({ enum: ['automated', 'manual', 'partial'], default: 'manual' })
  automation: string;

  @Prop()
  owner: string;

  @Prop()
  flow: string;

  @Prop([String])
  tags: string[];

  @Prop()
  lastRun: Date;

  @Prop({ min: 0, max: 100 })
  passRate: number;

  @Prop({ min: 0, max: 100 })
  coverage: number;

  @Prop({ enum: ['low', 'medium', 'high', 'critical'], default: 'medium' })
  risk: string;

  @Prop({ min: 0, max: 100 })
  aiScore: number;
}

export const TestCaseSchema = SchemaFactory.createForClass(TestCase);

@Schema({ timestamps: true })
export class Execution extends Document {
  @Prop({ required: true })
  testName: string;

  @Prop()
  testId: string;

  @Prop()
  flow: string;

  @Prop()
  browser: string;

  @Prop()
  environment: string;

  @Prop({ enum: ['passed', 'failed', 'running', 'blocked', 'skipped'], default: 'running' })
  status: string;

  @Prop()
  duration: number;

  @Prop({ default: 0 })
  retry: number;

  @Prop({ min: 0, max: 100 })
  aiConfidence: number;

  @Prop()
  owner: string;

  @Prop()
  startedAt: Date;

  @Prop()
  completedAt: Date;

  @Prop()
  errorMessage: string;

  @Prop()
  stackTrace: string;
}

export const ExecutionSchema = SchemaFactory.createForClass(Execution);

@Schema({ timestamps: true })
export class HealingSuggestion extends Document {
  @Prop({ required: true })
  issue: string;

  @Prop([String])
  affectedTests: string[];

  @Prop()
  currentLocator: string;

  @Prop()
  suggestedLocator: string;

  @Prop({ min: 0, max: 100 })
  confidence: number;

  @Prop({ enum: ['low', 'medium', 'high'], default: 'medium' })
  risk: string;

  @Prop()
  owner: string;

  @Prop({ enum: ['pending', 'approved', 'rejected'], default: 'pending' })
  status: string;

  @Prop()
  rootCause: string;
}

export const HealingSuggestionSchema = SchemaFactory.createForClass(HealingSuggestion);

@Schema({ timestamps: true })
export class Flow extends Document {
  @Prop({ required: true })
  name: string;

  @Prop()
  module: string;

  @Prop()
  description: string;

  @Prop({ enum: ['low', 'medium', 'high', 'critical'], default: 'medium' })
  risk: string;

  @Prop({ enum: ['P0', 'P1', 'P2', 'P3'], default: 'P2' })
  priority: string;

  @Prop({ min: 0, max: 100 })
  coverage: number;

  @Prop({ min: 0, max: 100 })
  automation: number;

  @Prop([String])
  relatedPages: string[];

  @Prop([String])
  dependencies: string[];
}

export const FlowSchema = SchemaFactory.createForClass(Flow);

@Schema({ timestamps: true })
export class Fact extends Document {
  @Prop({ required: true })
  text: string;

  @Prop({ enum: ['flow', 'execution', 'page', 'api', 'business_rule', 'constraint', 'validation'] })
  category: string;

  @Prop({ min: 0, max: 100 })
  confidence: number;

  @Prop()
  source: string;

  @Prop()
  createdBy: string;

  @Prop({ default: false })
  aiGenerated: boolean;

  @Prop({ default: false })
  humanVerified: boolean;

  @Prop([String])
  relatedObjects: string[];
}

export const FactSchema = SchemaFactory.createForClass(Fact);
