import { Body, CanActivate, Controller, ExecutionContext, Get, Injectable, Param, ParseUUIDPipe, Post, UseGuards, UsePipes, ValidationPipe } from '@nestjs/common';
import { authorize, HarnessOperatorGuard } from './harness.controller';
import { HarnessExecutionService } from './execution.service';
import { BrowserReportDto, SubmitExecutionDto } from './execution.dto';

@Injectable()
export class HarnessExecutorGuard implements CanActivate {
  canActivate(context: ExecutionContext) { return authorize(context, 'HARNESS_EXECUTOR_KEY'); }
}

@Controller('harness/executions')
@UseGuards(HarnessOperatorGuard)
@UsePipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }))
export class HarnessExecutionController {
  constructor(private readonly executions: HarnessExecutionService) {}
  @Post() submit(@Body() input: SubmitExecutionDto) { return this.executions.submit(input); }
  @Get(':id') status(@Param('id', ParseUUIDPipe) id: string) { return this.executions.status(id); }
  @Get(':id/artifact') artifact(@Param('id', ParseUUIDPipe) id: string) { return this.executions.artifact(id); }
  @Post(':id/cancel') cancel(@Param('id', ParseUUIDPipe) id: string) { return this.executions.cancel(id); }
}

@Controller('harness/executor')
@UseGuards(HarnessExecutorGuard)
@UsePipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }))
export class HarnessExecutorController {
  constructor(private readonly executions: HarnessExecutionService) {}
  @Post('claim') claim() { return this.executions.claim(); }
  @Get(':id') status(@Param('id', ParseUUIDPipe) id: string) { return this.executions.status(id); }
  @Post(':id/complete') complete(@Param('id', ParseUUIDPipe) id: string, @Body() input: BrowserReportDto) { return this.executions.complete(id, input); }
}
