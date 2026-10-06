import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  Sse,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { AgentsService, ChatRequest, CreateTaskDto, UpdateTaskDto } from './agents.service';
import { AgentType } from './types';
import { TaskStatus } from './entities/agent-task.entity';
import { WorkerWakeupService } from '../../common/worker-wakeup.service';
import { OutpostRun } from '../outpost/outpost.entity';

@Controller('agents')
export class AgentsController {
  constructor(
    private readonly agentsService: AgentsService,
    private readonly wakeups: WorkerWakeupService,
    @InjectRepository(OutpostRun) private readonly outpostRuns: Repository<OutpostRun>,
  ) {}

  /**
   * Get agent configurations
   */
  @Get('config')
  getConfigs() {
    return this.agentsService.getAllConfigs();
  }

  /**
   * Get specific agent config
   */
  @Get(':agentType/config')
  getConfig(@Param('agentType') agentType: AgentType) {
    const config = this.agentsService.getConfig(agentType);
    return {
      type: config.type,
      name: config.name,
      description: config.description,
      tools: config.tools,
    };
  }

  /**
   * Chat with an agent - proxies to agents service with database persistence
   */
  @Post(':agentType/chat')
  async chat(
    @Param('agentType') agentType: AgentType,
    @Body() request: ChatRequest,
  ) {
    return this.agentsService.chat(agentType, request);
  }

  /**
   * Get sessions for an agent
   */
  @Get(':agentType/sessions')
  async getSessions(@Param('agentType') agentType: AgentType) {
    const sessions = await this.agentsService.getSessionsByType(agentType);
    const sessionIds = sessions.map((session) => session.id);
    const pending = sessionIds.length
      ? await this.outpostRuns.find({ where: { sessionId: In(sessionIds), approvalStatus: 'pending' } })
      : [];
    const awaitingApproval = new Set(pending.map((run) => run.sessionId));
    return sessions.map((session) => ({
      id: session.id,
      agentType: session.agentType,
      status: session.status,
      messageCount: session.messages?.length || 0,
      preview: session.messages?.find((message) => message.role === 'user')?.content?.slice(0, 90) || '',
      needsHelpReason: session.status === 'needs_help' ? (session.context as { needsHelp?: { reason?: string } })?.needsHelp?.reason || null : null,
      needsApproval: awaitingApproval.has(session.id),
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
    }));
  }

  /**
   * Get a specific session
   */
  @Get('sessions/:sessionId')
  async getSession(@Param('sessionId') sessionId: string) {
    const session = await this.agentsService.getSession(sessionId);
    return {
      id: session.id,
      agentType: session.agentType,
      status: session.status,
      messages: session.messages,
      context: session.context,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
    };
  }

  /**
   * Delete a session
   */
  @Delete('sessions/:sessionId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteSession(@Param('sessionId') sessionId: string) {
    await this.agentsService.deleteSession(sessionId);
  }

  /**
   * Create a new session
   */
  @Post(':agentType/sessions')
  async createSession(@Param('agentType') agentType: AgentType) {
    const session = await this.agentsService.createSession(agentType);
    return {
      id: session.id,
      agentType: session.agentType,
      status: session.status,
      createdAt: session.createdAt,
    };
  }

  /**
   * List executions currently being streamed live by the agents runtime
   */
  @Get('executions/live')
  async getLiveExecutions() {
    return this.agentsService.getLiveExecutions();
  }

  // ============ Task Endpoints ============

  @Sse(':agentType/tasks/events')
  taskEvents(@Param('agentType') agentType: AgentType): Observable<{ type: string; data: object }> {
    return new Observable(subscriber => {
      const unsubscribe = this.wakeups.subscribe('agent_task_available', payload => {
        if (payload?.agentType === agentType) subscriber.next({ type: 'change', data: { id: payload.id } });
      });
      subscriber.next({ type: 'connected', data: { ready: true } });
      return unsubscribe;
    });
  }

  /**
   * Get all tasks for an agent type
   */
  @Get(':agentType/tasks')
  async getTasks(
    @Param('agentType') agentType: AgentType,
    @Query('status') status?: TaskStatus,
  ) {
    if (status) {
      const tasks = await this.agentsService.getTasksByStatus(agentType, status);
      return tasks;
    }
    const tasks = await this.agentsService.getTasksByType(agentType);
    return tasks;
  }

  /**
   * Get task statistics
   */
  @Get(':agentType/tasks/stats')
  async getTaskStats(@Param('agentType') agentType: AgentType) {
    return this.agentsService.getTaskStats(agentType);
  }

  /**
   * Create a new task
   */
  @Post(':agentType/tasks')
  async createTask(
    @Param('agentType') agentType: AgentType,
    @Body() body: Omit<CreateTaskDto, 'agentType'>,
  ) {
    const task = await this.agentsService.createTask({
      ...body,
      agentType,
    });
    return task;
  }

  /**
   * Get a specific task
   */
  @Get('tasks/:taskId')
  async getTask(@Param('taskId') taskId: string) {
    return this.agentsService.getTask(taskId);
  }

  /**
   * Update a task
   */
  @Patch('tasks/:taskId')
  async updateTask(
    @Param('taskId') taskId: string,
    @Body() body: UpdateTaskDto,
  ) {
    return this.agentsService.updateTask(taskId, body);
  }

  /**
   * Delete a task
   */
  @Delete('tasks/:taskId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteTask(@Param('taskId') taskId: string) {
    await this.agentsService.deleteTask(taskId);
  }

  /**
   * Start working on a task
   */
  @Post('tasks/:taskId/start')
  async startTask(@Param('taskId') taskId: string) {
    return this.agentsService.startTask(taskId);
  }

  /**
   * Complete a task
   */
  @Post('tasks/:taskId/complete')
  async completeTask(
    @Param('taskId') taskId: string,
    @Body() body?: { summary?: string; artifacts?: any[] },
  ) {
    return this.agentsService.completeTask(taskId, body);
  }

  /**
   * Block a task
   */
  @Post('tasks/:taskId/block')
  async blockTask(
    @Param('taskId') taskId: string,
    @Body() body: { reason: string },
  ) {
    return this.agentsService.blockTask(taskId, body.reason);
  }
}
