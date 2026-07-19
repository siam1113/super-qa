import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
export type TestCaseDocument = HydratedDocument<TestCase>;
@Schema({ timestamps: true })
export class TestCase { @Prop({ required: true, unique: true }) id!: string; @Prop({ required: true }) title!: string; @Prop() priority!: string; @Prop() automation!: string; @Prop() owner!: string; @Prop() flow!: string; @Prop([String]) tags!: string[]; @Prop() lastRun!: string; @Prop() passRate!: number; @Prop() coverage!: number; @Prop() risk!: string; @Prop() aiScore!: number; }
export const TestCaseSchema = SchemaFactory.createForClass(TestCase);
@Schema({ timestamps: true })
export class Execution { @Prop({ required: true }) testName!: string; @Prop() flow!: string; @Prop() browser!: string; @Prop() environment!: string; @Prop() status!: string; @Prop() duration!: string; @Prop() retry!: number; @Prop() confidence!: number; @Prop() owner!: string; @Prop() artifacts!: Record<string, unknown>; }
export const ExecutionSchema = SchemaFactory.createForClass(Execution);
@Schema({ timestamps: true })
export class Flow { @Prop({ required: true }) name!: string; @Prop() module!: string; @Prop() risk!: string; @Prop() priority!: string; @Prop() coverage!: number; @Prop() automation!: number; @Prop([String]) dependencies!: string[]; }
export const FlowSchema = SchemaFactory.createForClass(Flow);
@Schema({ timestamps: true })
export class Fact { @Prop({ required: true }) text!: string; @Prop() category!: string; @Prop() confidence!: number; @Prop() source!: string; @Prop() aiGenerated!: boolean; @Prop() humanVerified!: boolean; @Prop([String]) relatedObjects!: string[]; }
export const FactSchema = SchemaFactory.createForClass(Fact);
@Schema({ timestamps: true })
export class Action { @Prop({ required: true }) name!: string; @Prop() page!: string; @Prop() sourceCode!: string; @Prop() usageCount!: number; @Prop([String]) dependencies!: string[]; }
export const ActionSchema = SchemaFactory.createForClass(Action);
@Schema({ timestamps: true })
export class DomSnapshot { @Prop({ required: true }) page!: string; @Prop() screenshotUrl!: string; @Prop() domTree!: string; @Prop() locatorTree!: string; @Prop() accessibilityScore!: number; }
export const DomSnapshotSchema = SchemaFactory.createForClass(DomSnapshot);
@Schema({ timestamps: true })
export class DataSetup { @Prop({ required: true }) entity!: string; @Prop({ required: true }) operation!: string; @Prop([String]) supportedModes!: string[]; @Prop() preview!: Record<string, unknown>; }
export const DataSetupSchema = SchemaFactory.createForClass(DataSetup);
