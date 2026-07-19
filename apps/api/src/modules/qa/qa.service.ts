import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Action, DataSetup, DomSnapshot, Execution, Fact, Flow, TestCase } from './schemas';
@Injectable()
export class QaService {
  constructor(@InjectModel(TestCase.name) private readonly testCases: Model<TestCase>, @InjectModel(Execution.name) private readonly executions: Model<Execution>, @InjectModel(Flow.name) private readonly flows: Model<Flow>, @InjectModel(Fact.name) private readonly facts: Model<Fact>, @InjectModel(Action.name) private readonly actions: Model<Action>, @InjectModel(DomSnapshot.name) private readonly domSnapshots: Model<DomSnapshot>, @InjectModel(DataSetup.name) private readonly dataSetup: Model<DataSetup>) {}
  dashboard() { return { kpis: { passed: 1284, failed: 37, blocked: 9, running: 14, skipped: 42, aiConfidence: 91, healingCount: 22 }, insights: ['Checkout Payment coverage below target', 'SSO flow is stable across browsers', 'Zephyr token expires soon'] }; }
  findTestCases() { return this.testCases.find().lean(); }
  findExecutions() { return this.executions.find().sort({ createdAt: -1 }).lean(); }
  findFlows() { return this.flows.find().lean(); }
  findFacts() { return this.facts.find().lean(); }
  findActions() { return this.actions.find().lean(); }
  findDomSnapshots() { return this.domSnapshots.find().lean(); }
  findDataSetup() { return this.dataSetup.find().lean(); }
}
