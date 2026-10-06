import { Controller, Get, Post, Put, Delete, Param, Query, Body, ParseUUIDPipe, UsePipes, ValidationPipe } from '@nestjs/common';
import { QaService } from './qa.service';
import { CreateQaCaseDto, UpdateQaCaseDto, ReviewQaCaseDto, CreateQaRunDto, RecordQaResultDto, CreateHealingDto, HealingReviewDto, SaveQaPlanDto, RunWithAgentDto, AgentExecutionResultDto, ImportArtifactCasesDto, ImportArtifactCasesByRequestDto, GenerateQaCasesDto, RefineQaCaseDto } from './qa.dto';

@Controller('qa')
@UsePipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }))
export class QaController {
  constructor(private readonly qaService: QaService) {}

  @Get('workspace')
  getWorkspace() {
    return this.qaService.getWorkspace();
  }

  @Get('dashboard')
  getDashboard() {
    return this.qaService.getDashboard();
  }

  @Get('test-cases')
  getTestCases(
    @Query('priority') priority?: string,
    @Query('automation') automation?: string,
    @Query('risk') risk?: string,
  ) {
    return this.qaService.getTestCases({ priority, automation, risk });
  }

  // Declared before the bare test-cases/:id route below so that literal path doesn't get
  // swallowed by the :id wildcard (Nest/Express match routes in declaration order).
  @Get('test-cases/generation-runs')
  listGenerationRuns() { return this.qaService.listGenerationRuns(); }

  @Get('test-cases/generation-runs/:id')
  getGenerationRun(@Param('id', ParseUUIDPipe) id: string) { return this.qaService.getGenerationRun(id); }

  @Get('test-cases/:id')
  getTestCase(@Param('id', ParseUUIDPipe) id: string) {
    return this.qaService.getTestCase(id);
  }

  @Post('test-cases')
  createTestCase(@Body() body: CreateQaCaseDto) { return this.qaService.createTestCase(body); }

  @Post('test-cases/generate')
  generateTestCases(@Body() body: GenerateQaCasesDto) { return this.qaService.generateTestCases(body); }

  @Post('test-cases/refine')
  refineTestCase(@Body() body: RefineQaCaseDto) { return this.qaService.refineTestCase(body); }

  @Post('test-cases/generate/runs')
  startGenerationRun(@Body() body: GenerateQaCasesDto) { return this.qaService.startGenerationRun(body); }

  @Post('test-cases/refine/runs')
  startRefinementRun(@Body() body: RefineQaCaseDto) { return this.qaService.startRefinementRun(body); }

  @Post('test-cases/generation-runs/:id/applied')
  markGenerationRunApplied(@Param('id', ParseUUIDPipe) id: string) { return this.qaService.markGenerationRunApplied(id); }

  @Post('test-cases/import/:id')
  importTestCase(@Param('id', ParseUUIDPipe) id: string) { return this.qaService.importTestCase(id); }

  @Post('test-cases/import-artifact')
  importArtifactCases(@Body() body: ImportArtifactCasesDto) { return this.qaService.importArtifactCases(body.artifactId); }

  // Used by the agent runtime itself, which knows its own run's requestId and project scope but not the artifact's Postgres row id.
  @Post('test-cases/import-artifact-by-request')
  importArtifactCasesByRequest(@Body() body: ImportArtifactCasesByRequestDto) { return this.qaService.importArtifactCasesByRequest(body.projectId, body.requestId); }

  @Put('test-cases/:id')
  updateTestCase(@Param('id', ParseUUIDPipe) id: string, @Body() body: UpdateQaCaseDto) { return this.qaService.updateTestCase(id, body); }

  // POST alias for the same update: some browser extensions/security proxies intercept or silently
  // stall PUT requests, so the frontend calls this instead. PUT above is kept for other API consumers.
  @Post('test-cases/:id/update')
  updateTestCasePost(@Param('id', ParseUUIDPipe) id: string, @Body() body: UpdateQaCaseDto) { return this.qaService.updateTestCase(id, body); }

  @Post('test-cases/:id/review')
  reviewTestCase(@Param('id', ParseUUIDPipe) id: string, @Body() body: ReviewQaCaseDto) { return this.qaService.reviewTestCase(id, body); }

  @Post('executions/:id/result')
  recordResult(@Param('id', ParseUUIDPipe) id: string, @Body() body: RecordQaResultDto) { return this.qaService.recordResult(id, body); }

  @Post('test-cases/:id/run-with-agent')
  runWithAgent(@Param('id', ParseUUIDPipe) id: string, @Body() body: RunWithAgentDto) { return this.qaService.runWithAgent(id, body); }

  @Post('executions/agent-result')
  recordAgentResult(@Body() body: AgentExecutionResultDto) { return this.qaService.recordAgentResult(body); }

  @Get('runs/:id')
  getRun(@Param('id', ParseUUIDPipe) id: string) { return this.qaService.getRun(id); }

  @Post('runs/:id/cancel')
  cancelRun(@Param('id', ParseUUIDPipe) id: string) { return this.qaService.cancelRun(id); }

  @Get('executions')
  getExecutions(
    @Query('status') status?: string,
    @Query('environment') environment?: string,
    @Query('browser') browser?: string,
  ) {
    return this.qaService.getExecutions({ status, environment, browser });
  }

  @Get('healing')
  getHealingSuggestions(@Query('status') status?: string) {
    return this.qaService.getHealingSuggestions(status);
  }

  @Post('healing/:id/approve')
  approveHealing(@Param('id', ParseUUIDPipe) id: string, @Body() body: HealingReviewDto) {
    return this.qaService.reviewHealing(id, 'approved', body.reviewer);
  }

  @Post('healing/:id/reject')
  rejectHealing(@Param('id', ParseUUIDPipe) id: string, @Body() body: HealingReviewDto) {
    return this.qaService.reviewHealing(id, 'rejected', body.reviewer);
  }

  @Post('healing')
  createHealing(@Body() body: CreateHealingDto) { return this.qaService.createHealing(body); }

  @Get('flows')
  getFlows() {
    return this.qaService.getFlows();
  }

  @Get('flows/:name')
  getFlow(@Param('name') name: string) {
    return this.qaService.getFlow(name);
  }

  @Get('facts')
  getFacts(@Query('category') category?: string) {
    return this.qaService.getFacts(category);
  }

  @Post('runs')
  runTests(@Body() body: CreateQaRunDto) {
    return this.qaService.runTests(body);
  }

  @Get('plans') listPlans() { return this.qaService.listPlans(); }
  @Post('plans') savePlan(@Body() body: SaveQaPlanDto) { return this.qaService.savePlan(body); }
  @Put('plans/:id') updatePlan(@Param('id', ParseUUIDPipe) id: string, @Body() body: SaveQaPlanDto) { return this.qaService.savePlan(body, id); }
  @Delete('plans/:id') deletePlan(@Param('id', ParseUUIDPipe) id: string) { return this.qaService.deletePlan(id); }
  @Post('plans/:id/run') runPlan(@Param('id', ParseUUIDPipe) id: string) { return this.qaService.runPlan(id); }

  @Get('context-counts')
  getContextCounts() {
    return this.qaService.getContextCounts();
  }
}
