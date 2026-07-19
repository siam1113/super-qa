import { Body, Controller, Get, Post } from '@nestjs/common';
import { QaService } from './qa.service';
import { GenerateTestsDto, HealingDecisionDto, RunRequestDto } from './dto';
@Controller('qa')
export class QaController {
  constructor(private readonly qa: QaService) {}
  @Get('workspace') workspace() { return this.qa.workspaceEnvelope(); }
  @Get('dashboard') dashboard() { return this.qa.dashboard(); }
  @Get('test-cases') testCases() { return this.qa.findTestCases(); }
  @Get('executions') executions() { return this.qa.findExecutions(); }
  @Get('flows') flows() { return this.qa.findFlows(); }
  @Get('facts') facts() { return this.qa.findFacts(); }
  @Get('actions') actions() { return this.qa.findActions(); }
  @Get('dom-snapshots') domSnapshots() { return this.qa.findDomSnapshots(); }
  @Get('data-setup') dataSetup() { return this.qa.findDataSetup(); }
  @Post('runs') startRun(@Body() request: RunRequestDto) { return this.qa.startRun(request); }
  @Post('healing-decisions') decideHealing(@Body() decision: HealingDecisionDto) { return this.qa.decideHealing(decision); }
  @Post('generated-tests') generateTests(@Body() request: GenerateTestsDto) { return this.qa.generateTests(request); }
}
