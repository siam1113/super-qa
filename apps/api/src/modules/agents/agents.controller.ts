import { Controller, Get } from '@nestjs/common';
@Controller('agents')
export class AgentsController {
  @Get() listAgents() { return [
    { id:'executor', name:'Executor', capabilities:['run-tests','stream-events','collect-artifacts'] },
    { id:'healer', name:'Healer', capabilities:['locator-repair','root-cause-analysis','open-pr'] },
    { id:'context-manager', name:'Context Manager', capabilities:['source-sync','fact-builder','knowledge-graph'] },
    { id:'test-case-manager', name:'Test Case Manager', capabilities:['coverage-analysis','test-generation','reviews'] }
  ]; }
}
