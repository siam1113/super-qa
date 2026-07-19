import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Action, DataSetup, DomSnapshot, Execution, Fact, Flow, TestCase } from './schemas';
import { GenerateTestsDto, HealingDecisionDto, RunRequestDto } from './dto';
import { qaSeed } from './seed-data';
@Injectable()
export class QaService {
  constructor(@InjectModel(TestCase.name) private readonly testCases: Model<TestCase>, @InjectModel(Execution.name) private readonly executions: Model<Execution>, @InjectModel(Flow.name) private readonly flows: Model<Flow>, @InjectModel(Fact.name) private readonly facts: Model<Fact>, @InjectModel(Action.name) private readonly actions: Model<Action>, @InjectModel(DomSnapshot.name) private readonly domSnapshots: Model<DomSnapshot>, @InjectModel(DataSetup.name) private readonly dataSetup: Model<DataSetup>) {}
  dashboard() { return { kpis: { passed: 1284, failed: 37, blocked: 9, running: 14, skipped: 42, aiConfidence: 91, healingCount: 22 }, insights: ['Checkout Payment coverage below target', 'SSO flow is stable across browsers', 'Zephyr token expires soon'] }; }
  async findTestCases() { const rows = await this.testCases.find().lean(); return rows.length ? rows : qaSeed.testCases; }
  async findExecutions() { const rows = await this.executions.find().sort({ createdAt: -1 }).lean(); return rows.length ? rows : qaSeed.executions; }
  async findFlows() { const rows = await this.flows.find().lean(); return rows.length ? rows : qaSeed.flows; }
  async findFacts() { const rows = await this.facts.find().lean(); return rows.length ? rows : qaSeed.facts; }
  async findActions() { const rows = await this.actions.find().lean(); return rows.length ? rows : qaSeed.actions; }
  async findDomSnapshots() { const rows = await this.domSnapshots.find().lean(); return rows.length ? rows : qaSeed.domSnapshots; }
  async findDataSetup() { const rows = await this.dataSetup.find().lean(); return rows.length ? rows : qaSeed.dataSetup; }
  async workspaceEnvelope() { const [executions, testCases, flows, facts, actions, domSnapshots, dataSetup] = await Promise.all([this.findExecutions(), this.findTestCases(), this.findFlows(), this.findFacts(), this.findActions(), this.findDomSnapshots(), this.findDataSetup()]); return { data: { executions, testCases, flows, facts, actions, domSnapshots, dataSetup }, meta: { requestId: `seed-${Date.now()}`, generatedAt: new Date().toISOString(), workspaceId: 'enterprise-demo', permissions: ['read','run','review','approve'] } }; }
  startRun(request: RunRequestDto) { return { id: `run-${Date.now()}`, status: 'queued', request, timeline: ['queued','allocating-browser','starting-agent'] }; }
  decideHealing(decision: HealingDecisionDto) { return { id: decision.suggestionId, status: decision.decision === 'approve' ? 'approved' : 'rejected', scope: decision.scope, pr: decision.decision === 'approve' ? 'PR-128' : null }; }
  generateTests(request: GenerateTestsDto) { return Array.from({ length: request.count }, (_, index) => ({ id: `AI-${index + 1}`, title: `${request.flow} generated risk test ${index + 1}`, priority: request.risk === 'High' ? 'P0' : 'P1', status: 'draft' })); }
}
