import { AutonomyService } from '../autonomy/autonomy.service';
import { BadRequestException, Body, CanActivate, Controller, Delete, ExecutionContext, ForbiddenException, Get, HttpCode, HttpException, Injectable, Param, ParseUUIDPipe, Patch, Post, Query, RawBodyRequest, Req, Res, Sse, UnauthorizedException, UseGuards, UsePipes, ValidationPipe } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { Request, Response } from 'express';
import { Observable } from 'rxjs';
import { DataSource } from 'typeorm';
import { AuthService } from '../autonomy/auth.service';
import { QaOrgMember } from '../autonomy/identity.entity';
import { ChatActor, ChatService } from './chat.service';
import { AgentDto, AgentModelDto, AgentLimitsDto, AgentMemoryContextDto, AgentMemoryDto, AgentRuntimeDto, AgentTemperatureDto, AgentVoicePreviewDto, ConversationDto, ConversationPolicyDto, ExternalConversationDto, InstallationAccessDto, InstallationDto, MessageDto, PromptDto, PromptInstallDto } from './chat.dto';
import { ChatConnectors } from './chat.connectors';
import { ChatRealtimeService } from './chat-realtime.service';
import { VoiceService } from './voice.service';

@Injectable()
export class ChatGuard implements CanActivate {
  constructor(private readonly auth: AuthService, private readonly database: DataSource) {}
  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<Request & { chatActor: ChatActor }>();
    if (request.method !== 'GET' && request.headers.origin && request.headers.origin !== (process.env.AUTH_PUBLIC_URL || 'http://localhost:3000').replace(/\/$/, '')) throw new ForbiddenException('Invalid request origin');
    const cookie = (request.headers.cookie || '').split(';').map(value => value.trim()).find(value => value.startsWith('qa_session='))?.slice(11);
    const key = await this.auth.authenticateSession(cookie);
    const member = await this.database.manager.findOneBy(QaOrgMember, { keyId: key.id, projectId: key.projectId, active: true });
    if (!member) throw new UnauthorizedException();
    request.chatActor = { memberId: member.id, projectId: key.projectId, keyId: key.id };
    return true;
  }
}

type ChatRequest = Request & { chatActor: ChatActor };

@Controller('chat')
@UseGuards(ChatGuard)
@UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }))
export class ChatController {
  constructor(private readonly chat: ChatService, private readonly connectors: ChatConnectors, private readonly realtime: ChatRealtimeService, private readonly autonomy: AutonomyService, private readonly voice: VoiceService) {}
  @Sse('events') events(@Req() request: ChatRequest): Observable<{ type: string; data: object }> { return this.realtime.stream(request.chatActor.projectId); }
  @Get('directory') directory(@Req() request: ChatRequest) { return this.chat.directory(request.chatActor); }
  @Post('agents/:id') updateAgent(@Req() request: ChatRequest, @Param('id', ParseUUIDPipe) id: string, @Body() input: AgentDto) { return this.chat.saveAgent(request.chatActor, input, id); }
  @Get('agents/:id/settings') agentSettings(@Req() request: ChatRequest, @Param('id', ParseUUIDPipe) id: string) { return this.chat.agentSettings(request.chatActor, id); }
  @Get('agents/:id/workflow-artifacts/:requestId/job') async workflowJob(@Req() request: ChatRequest, @Param('id', ParseUUIDPipe) id: string, @Param('requestId', ParseUUIDPipe) requestId: string) {
    const access = await this.chat.workflowJobAccess(request.chatActor, id, requestId);
    const run = await this.autonomy.status(access.key, access.jobId);
    return { id: run.id, status: run.status, deadline: run.deadline, results: run.results, cleanupReceipt: run.cleanupReceipt };
  }
  @Get('agents/:id/workflow-artifacts') workflowArtifacts(@Req() request: ChatRequest, @Param('id', ParseUUIDPipe) id: string) { return this.chat.workflowArtifacts(request.chatActor, id); }
  @Get('agents/:id/workflow-artifacts/:requestId') workflowArtifact(@Req() request: ChatRequest, @Param('id', ParseUUIDPipe) id: string, @Param('requestId', ParseUUIDPipe) requestId: string) { return this.chat.workflowArtifacts(request.chatActor, id, requestId); }
  @Post('agents/:id/model') agentModel(@Req() request: ChatRequest, @Param('id', ParseUUIDPipe) id: string, @Body() input: AgentModelDto) { return this.chat.saveAgentModel(request.chatActor, id, input); }
  @Post('agents/:id/limits') agentLimits(@Req() request: ChatRequest, @Param('id', ParseUUIDPipe) id: string, @Body() input: AgentLimitsDto) { return this.chat.saveAgentLimits(request.chatActor, id, input); }
  @Post('agents/:id/temperature') agentTemperature(@Req() request: ChatRequest, @Param('id', ParseUUIDPipe) id: string, @Body() input: AgentTemperatureDto) { return this.chat.saveAgentTemperature(request.chatActor, id, input); }
  @Post('agents/:id/voice-preview') voicePreview(@Req() request: ChatRequest, @Param('id', ParseUUIDPipe) id: string, @Body() input: AgentVoicePreviewDto) { return this.voice.preview(request.chatActor, id, input.voice); }
  @Get('prompts') prompts(@Req() request: ChatRequest) { return this.chat.listPrompts(request.chatActor); }
  @Post('prompts') createPrompt(@Req() request: ChatRequest, @Body() input: PromptDto) { return this.chat.createPrompt(request.chatActor, input); }
  @Patch('prompts/:id') updatePrompt(@Req() request: ChatRequest, @Param('id', ParseUUIDPipe) id: string, @Body() input: PromptDto) { return this.chat.updatePrompt(request.chatActor, id, input); }
  @Delete('prompts/:id') deletePrompt(@Req() request: ChatRequest, @Param('id', ParseUUIDPipe) id: string) { return this.chat.deletePrompt(request.chatActor, id); }
  @Post('agents/:id/prompts/install') installPrompt(@Req() request: ChatRequest, @Param('id', ParseUUIDPipe) id: string, @Body() input: PromptInstallDto) { return this.chat.installPrompt(request.chatActor, id, input.scenario, input.promptId || null); }
  @Get('agents/:id/memories') memories(@Req() request: ChatRequest, @Param('id', ParseUUIDPipe) id: string, @Query('includeArchived') includeArchived?: string) { return this.chat.agentMemories(request.chatActor, id, includeArchived === 'true'); }
  @Post('agents/:id/runtime-chat') agentRuntimeChat(@Req() request: ChatRequest, @Param('id', ParseUUIDPipe) id: string, @Body() input: AgentRuntimeDto) { return this.chat.runAgentChat(request.chatActor, id, input); }
  @Post('agents/:id/runtime-chat/stream')
  async agentRuntimeChatStream(@Req() request: ChatRequest, @Param('id', ParseUUIDPipe) id: string, @Body() input: AgentRuntimeDto, @Res() res: Response) {
    const stream = await this.chat.runAgentChatStream(request.chatActor, id, input);
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    stream.on('error', () => { if (!res.writableEnded) res.end(); });
    res.on('close', () => stream.destroy());
    stream.pipe(res);
  }
  @Get('agents/:id/memories/:memoryId/revisions') memoryRevisions(@Req() request: ChatRequest, @Param('id', ParseUUIDPipe) id: string, @Param('memoryId', ParseUUIDPipe) memoryId: string) { return this.chat.agentMemoryRevisions(request.chatActor, id, memoryId); }
  @Post('agents/:id/memories') createMemory(@Req() request: ChatRequest, @Param('id', ParseUUIDPipe) id: string, @Body() input: AgentMemoryDto) { return this.chat.createAgentMemory(request.chatActor, id, input); }
  @Patch('agents/:id/memories/:memoryId') updateMemory(@Req() request: ChatRequest, @Param('id', ParseUUIDPipe) id: string, @Param('memoryId', ParseUUIDPipe) memoryId: string, @Body() input: AgentMemoryDto) { return this.chat.updateAgentMemory(request.chatActor, id, memoryId, input); }
  @Delete('agents/:id/memories/:memoryId/permanent') deleteMemory(@Req() request: ChatRequest, @Param('id', ParseUUIDPipe) id: string, @Param('memoryId', ParseUUIDPipe) memoryId: string) { return this.chat.deleteAgentMemory(request.chatActor, id, memoryId); }
  @Delete('agents/:id/memories/:memoryId') archiveMemory(@Req() request: ChatRequest, @Param('id', ParseUUIDPipe) id: string, @Param('memoryId', ParseUUIDPipe) memoryId: string) { return this.chat.archiveAgentMemory(request.chatActor, id, memoryId); }
  @Post('agents/:id/memories/:memoryId/restore') restoreMemory(@Req() request: ChatRequest, @Param('id', ParseUUIDPipe) id: string, @Param('memoryId', ParseUUIDPipe) memoryId: string) { return this.chat.restoreAgentMemory(request.chatActor, id, memoryId); }
  @Post('agents/:id/memories/context') memoryContext(@Req() request: ChatRequest, @Param('id', ParseUUIDPipe) id: string, @Body() input: AgentMemoryContextDto) { return this.chat.retrieveAgentMemories(request.chatActor, id, input.query); }
  @Get('conversations') list(@Req() request: ChatRequest) { return this.chat.conversations(request.chatActor); }
  @Post('conversations')
  async create(@Req() request: RawBodyRequest<ChatRequest>, @Body() parsedInput: unknown) {
    let input = parsedInput;
    if ((!input || typeof input !== 'object' || !Object.keys(input).length) && request.rawBody?.length) {
      try { input = JSON.parse(request.rawBody.toString('utf8')) as unknown; }
      catch { throw new BadRequestException('Conversation request body must be valid JSON'); }
    }
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new BadRequestException('Conversation request body must be a JSON object');
    const values = input as Record<string, unknown>;
    console.info('[chat-create-api]', JSON.stringify({ keys: Object.keys(values).sort(), rawBytes: request.rawBody?.length || 0, contentLength: request.headers['content-length'] || null, contentType: request.headers['content-type'] || null, transferEncoding: request.headers['transfer-encoding'] || null, forwarder: request.headers['x-chat-forwarder'] || null, kind: values.kind, titleType: typeof values.title, memberIdsType: Array.isArray(values.memberIds) ? 'array' : typeof values.memberIds, memberCount: Array.isArray(values.memberIds) ? values.memberIds.length : null, instructionsType: typeof values.instructions, agentIdsType: Array.isArray(values.agentIds) ? 'array' : typeof values.agentIds, agentCount: Array.isArray(values.agentIds) ? values.agentIds.length : null }));
    const dto = plainToInstance(ConversationDto, input);
    const errors = await validate(dto, { whitelist: true, forbidNonWhitelisted: true });
    if (errors.length) throw new BadRequestException(errors.flatMap(error => Object.values(error.constraints || {})));
    return this.chat.createConversation(request.chatActor, dto);
  }
  @Get('conversations/:id') detail(@Req() request: ChatRequest, @Param('id', ParseUUIDPipe) id: string, @Query('before', new ParseUUIDPipe({ optional: true })) before?: string) { return this.chat.detail(request.chatActor, id, before); }
  @Post('conversations/:id/policy') policy(@Req() request: ChatRequest, @Param('id', ParseUUIDPipe) id: string, @Body() input: ConversationPolicyDto) { return this.chat.policy(request.chatActor, id, input); }
  @Post('conversations/:id/messages') send(@Req() request: ChatRequest, @Param('id', ParseUUIDPipe) id: string, @Body() input: MessageDto) { return this.chat.send(request.chatActor, id, input); }
  @Post('conversations/:id/messages/:messageId/task') task(@Req() request: ChatRequest, @Param('id', ParseUUIDPipe) id: string, @Param('messageId', ParseUUIDPipe) messageId: string) { return this.chat.createTask(request.chatActor, id, messageId); }
  @Post('conversations/:id/tasks/:taskId/done') done(@Req() request: ChatRequest, @Param('id', ParseUUIDPipe) id: string, @Param('taskId', ParseUUIDPipe) taskId: string) { return this.chat.completeTask(request.chatActor, id, taskId); }
  @Get('installations') installations(@Req() request: ChatRequest) { return this.connectors.list(request.chatActor); }
  // Static paths declared ahead of the "installations/:id/..." routes below so they aren't swallowed by ParseUUIDPipe.
  @Get('installations/slack/install-url') slackInstallUrl(@Req() request: ChatRequest) { return this.connectors.createSlackInstallUrl(request.chatActor); }
  @Get('installations/:id/secret') revealInstallationSecret(@Req() request: ChatRequest, @Param('id', ParseUUIDPipe) id: string) { return this.connectors.revealSecret(request.chatActor, id); }
  @Get('installations/teams/connect-url') teamsConnectUrl(@Req() request: ChatRequest) { return this.connectors.createTeamsConnectUrl(request.chatActor); }
  @Post('installations') connect(@Req() request: ChatRequest, @Body() input: InstallationDto) { return this.connectors.connect(request.chatActor, input); }
  @Patch('installations/:id/access') updateInstallationAccess(@Req() request: ChatRequest, @Param('id', ParseUUIDPipe) id: string, @Body() input: InstallationAccessDto) { return this.connectors.updateAccess(request.chatActor, id, input); }
  @Post('installations/:id/disconnect') disconnect(@Req() request: ChatRequest, @Param('id', ParseUUIDPipe) id: string) { return this.connectors.disconnect(request.chatActor, id); }
  @Post('installations/:id/conversations') bind(@Req() request: ChatRequest, @Param('id', ParseUUIDPipe) id: string, @Body() input: ExternalConversationDto) { return this.connectors.bind(request.chatActor, id, input); }
}

@Controller('chat-hooks')
export class ChatHookController {
  constructor(private readonly connectors: ChatConnectors) {}
  @Post('slack/:id') @HttpCode(200)
  slack(@Param('id', ParseUUIDPipe) id: string, @Req() request: RawBodyRequest<Request>) { return this.connectors.inbound('slack', id, request.body, request.rawBody, request.headers); }
  // The single shared Slack app's one Events API Request URL for every installed workspace, so there is
  // no per-installation ID to put in the URL; the installation is instead resolved from the event's team ID.
  @Post('slack') @HttpCode(200)
  slackShared(@Req() request: RawBodyRequest<Request>) { return this.connectors.inbound('slack', null, request.body, request.rawBody, request.headers); }
  // Slack redirects the installing admin's own browser here after "Add to Slack" — not a signed
  // provider payload, so it is handled separately from the two Events API routes above.
  @Get('slack/oauth/callback')
  async slackOAuthCallback(@Query('code') code: string, @Query('state') state: string, @Query('error') error: string, @Res() res: Response) {
    const integrations = (process.env.AUTH_PUBLIC_URL || 'http://localhost:3000').replace(/\/$/, '') + '/integrations';
    if (error) return res.redirect(integrations + '?error=' + encodeURIComponent('Slack installation was cancelled.'));
    try {
      await this.connectors.completeSlackInstall(code, state);
      return res.redirect(integrations + '?installation_connected=slack');
    } catch (failure) {
      return res.redirect(integrations + '?error=' + encodeURIComponent(failure instanceof HttpException ? failure.message : 'Slack installation failed.'));
    }
  }
  @Post('teams/:id') @HttpCode(200)
  teams(@Param('id', ParseUUIDPipe) id: string, @Req() request: Request) { return this.connectors.inbound('teams', id, request.body, undefined, request.headers); }
  // A single shared Teams app has one Azure Bot messaging endpoint for every client tenant, so there is
  // no per-installation ID to put in the URL; the installation is instead resolved from the activity's tenant ID.
  @Post('teams') @HttpCode(200)
  teamsShared(@Req() request: Request) { return this.connectors.inbound('teams', null, request.body, undefined, request.headers); }
  // Microsoft redirects the installing admin's own browser here after org-wide admin consent — not a
  // signed provider payload, so it is handled separately from the inbound Teams webhook routes above.
  @Get('teams/consent')
  async teamsConsent(@Query('tenant') tenant: string, @Query('admin_consent') adminConsent: string, @Query('state') state: string, @Query('error') error: string, @Query('error_description') errorDescription: string, @Res() res: Response) {
    const integrations = (process.env.AUTH_PUBLIC_URL || 'http://localhost:3000').replace(/\/$/, '') + '/integrations';
    try {
      await this.connectors.completeTeamsConsent({ tenant, admin_consent: adminConsent, state, error, error_description: errorDescription });
      return res.redirect(integrations + '?installation_connected=teams');
    } catch (failure) {
      return res.redirect(integrations + '?error=' + encodeURIComponent(failure instanceof HttpException ? failure.message : 'Microsoft Teams installation failed.'));
    }
  }
}
