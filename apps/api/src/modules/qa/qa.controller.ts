import { Controller, Get } from '@nestjs/common';
import { QaService } from './qa.service';
@Controller('qa')
export class QaController {
  constructor(private readonly qa: QaService) {}
  @Get('dashboard') dashboard() { return this.qa.dashboard(); }
  @Get('test-cases') testCases() { return this.qa.findTestCases(); }
  @Get('executions') executions() { return this.qa.findExecutions(); }
  @Get('flows') flows() { return this.qa.findFlows(); }
  @Get('facts') facts() { return this.qa.findFacts(); }
  @Get('actions') actions() { return this.qa.findActions(); }
  @Get('dom-snapshots') domSnapshots() { return this.qa.findDomSnapshots(); }
  @Get('data-setup') dataSetup() { return this.qa.findDataSetup(); }
}
