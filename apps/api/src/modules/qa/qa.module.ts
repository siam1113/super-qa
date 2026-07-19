import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Action, ActionSchema, DataSetup, DataSetupSchema, DomSnapshot, DomSnapshotSchema, Execution, ExecutionSchema, Fact, FactSchema, Flow, FlowSchema, TestCase, TestCaseSchema } from './schemas';
import { QaController } from './qa.controller';
import { QaService } from './qa.service';
@Module({ imports: [MongooseModule.forFeature([{ name: TestCase.name, schema: TestCaseSchema }, { name: Execution.name, schema: ExecutionSchema }, { name: Flow.name, schema: FlowSchema }, { name: Fact.name, schema: FactSchema }, { name: Action.name, schema: ActionSchema }, { name: DomSnapshot.name, schema: DomSnapshotSchema }, { name: DataSetup.name, schema: DataSetupSchema }])], controllers: [QaController], providers: [QaService], exports: [QaService] })
export class QaModule {}
