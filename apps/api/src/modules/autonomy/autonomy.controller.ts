import { Body, CanActivate, Controller, ExecutionContext, ForbiddenException, Get, Injectable, Param, ParseUUIDPipe, Post, Req, UseGuards, UsePipes, ValidationPipe } from '@nestjs/common';
import { AutonomyService } from './autonomy.service';
import { CleanupReceiptDto, CompleteAutonomousRunDto, CreateBenchmarkDto, CreateSuiteDto, EnrollProjectDto, IssueKeyDto, PauseProjectDto, ProjectSettingsDto, StartAutonomousRunDto } from './autonomy.dto';
import { ProjectKey } from './autonomy.entity';
import { IsUUID } from 'class-validator';

export class BrowserDispatchDto { @IsUUID() token: string; }

@Injectable()
export class ProjectGuard implements CanActivate {
  constructor(private readonly service: AutonomyService) {}
  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest();
    const cookie = (request.headers.cookie || '').split(';').map((value: string) => value.trim()).find((value: string) => value.startsWith('qa_session='))?.slice('qa_session='.length);
    request.projectKey = await this.service.authenticate(request.headers.authorization, cookie);
    return true;
  }
}

@Injectable()
export class AutonomyLockdownGuard implements CanActivate {
  canActivate(context: ExecutionContext) {
    if (process.env.AUTONOMY_LOCKDOWN !== 'true' && process.env.NODE_ENV !== 'production') return true;
    const controller = context.getClass().name;
    if (['WorkflowArtifactController', 'AutonomyController', 'AuthController', 'HarnessController', 'HarnessWorkerController', 'HarnessExecutionController', 'HarnessExecutorController', 'HealthController', 'ChatController', 'ChatHookController', 'MeetingController', 'MeetingHookController', 'VoiceController', 'VoiceBridgeController', 'SuperQaVoiceController', 'OutpostController'].includes(controller)) return true;
    throw new ForbiddenException('Legacy routes disabled in autonomy lockdown');
  }
}

@Controller('autonomy')
@UseGuards(ProjectGuard)
@UsePipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }))
export class AutonomyController {
  constructor(private readonly service: AutonomyService) {}
  @Post('runs/:id/cleanup') cleanup(@Req() request: { projectKey: ProjectKey }, @Param('id', ParseUUIDPipe) id: string, @Body() input: CleanupReceiptDto) { return this.service.cleanup(request.projectKey, id, input); }
  @Get('suites/:id') describeSuite(@Req() request: { projectKey: ProjectKey }, @Param('id', ParseUUIDPipe) id: string) { return this.service.describeSuite(request.projectKey, id); }
  @Get() overview(@Req() request: { projectKey: ProjectKey }) { return this.service.overview(request.projectKey); }
  @Get('settings') settings(@Req() request: { projectKey: ProjectKey }) { return this.service.settings(request.projectKey); }
  @Post('settings') updateSettings(@Req() request: { projectKey: ProjectKey }, @Body() input: ProjectSettingsDto) { return this.service.updateSettings(request.projectKey, input); }
  @Get('benchmarks') benchmarks(@Req() request: { projectKey: ProjectKey }) { return this.service.benchmarks(request.projectKey); }
  @Post('benchmarks') createBenchmark(@Req() request: { projectKey: ProjectKey }, @Body() input: CreateBenchmarkDto) { return this.service.createBenchmark(request.projectKey, input); }
  @Get('benchmarks/:id') benchmark(@Req() request: { projectKey: ProjectKey }, @Param('id', ParseUUIDPipe) id: string) { return this.service.benchmark(request.projectKey, id); }
  @Post('benchmarks/:id/approve') approveBenchmark(@Req() request: { projectKey: ProjectKey }, @Param('id', ParseUUIDPipe) id: string) { return this.service.benchmarkAction(request.projectKey, id, 'approve'); }
  @Post('benchmarks/:id/resume') resumeBenchmark(@Req() request: { projectKey: ProjectKey }, @Param('id', ParseUUIDPipe) id: string) { return this.service.benchmarkAction(request.projectKey, id, 'resume'); }
  @Post('benchmarks/:id/pause') pauseBenchmark(@Req() request: { projectKey: ProjectKey }, @Param('id', ParseUUIDPipe) id: string) { return this.service.benchmarkAction(request.projectKey, id, 'pause'); }
  @Post('benchmarks/:id/advance') advanceBenchmark(@Req() request: { projectKey: ProjectKey }, @Param('id', ParseUUIDPipe) id: string) { return this.service.benchmarkAction(request.projectKey, id, 'advance'); }
  @Post('keys') issue(@Req() request: { projectKey: ProjectKey }, @Body() input: IssueKeyDto) { return this.service.issueKey(request.projectKey, input); }
  @Post('keys/:id/revoke') revoke(@Req() request: { projectKey: ProjectKey }, @Param('id', ParseUUIDPipe) id: string) { return this.service.revoke(request.projectKey, id); }
  @Post('pause') pause(@Req() request: { projectKey: ProjectKey }, @Body() input: PauseProjectDto) { return this.service.pause(request.projectKey, input.paused); }
  @Post('suites') createSuite(@Req() request: { projectKey: ProjectKey }, @Body() input: CreateSuiteDto) { return this.service.createSuite(request.projectKey, input); }
  @Post('suites/:id/approve') approve(@Req() request: { projectKey: ProjectKey }, @Param('id', ParseUUIDPipe) id: string) { return this.service.approve(request.projectKey, id); }
  @Post('runs') start(@Req() request: { projectKey: ProjectKey }, @Body() input: StartAutonomousRunDto) { return this.service.start(request.projectKey, input); }
  @Post('claim') claim(@Req() request: { projectKey: ProjectKey }) { return this.service.claim(request.projectKey); }
  @Get('runs/:id') status(@Req() request: { projectKey: ProjectKey }, @Param('id', ParseUUIDPipe) id: string) { return this.service.status(request.projectKey, id); }
  @Post('runs/:id/cancel') cancel(@Req() request: { projectKey: ProjectKey }, @Param('id', ParseUUIDPipe) id: string) { return this.service.cancel(request.projectKey, id); }
  @Post('runs/:id/browser/:checkId') browser(@Req() request: { projectKey: ProjectKey }, @Param('id', ParseUUIDPipe) id: string, @Param('checkId') checkId: string, @Body() input: BrowserDispatchDto) { return this.service.dispatchBrowser(request.projectKey, id, checkId, input.token); }
  @Post('runs/:id/complete') complete(@Req() request: { projectKey: ProjectKey }, @Param('id', ParseUUIDPipe) id: string, @Body() input: CompleteAutonomousRunDto) { return this.service.complete(request.projectKey, id, input); }
}
