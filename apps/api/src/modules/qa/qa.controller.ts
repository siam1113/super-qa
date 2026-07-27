import { Controller, Get, Post, Param, Query, Body } from '@nestjs/common';
import { QaService } from './qa.service';

@Controller('qa')
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

  @Get('test-cases/:id')
  getTestCase(@Param('id') id: string) {
    return this.qaService.getTestCase(id);
  }

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
  approveHealing(@Param('id') id: string) {
    return this.qaService.approveHealing(id);
  }

  @Post('healing/:id/reject')
  rejectHealing(@Param('id') id: string) {
    return this.qaService.rejectHealing(id);
  }

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
  runTests(@Body() body: { testIds?: string[] }) {
    return this.qaService.runTests(body.testIds);
  }

  @Get('context-counts')
  getContextCounts() {
    return this.qaService.getContextCounts();
  }
}
