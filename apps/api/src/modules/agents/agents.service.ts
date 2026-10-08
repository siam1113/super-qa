import { BadRequestException, ForbiddenException, HttpException, Injectable, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { createHmac } from 'crypto';
import { Readable } from 'node:stream';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AgentSession } from './entities/agent-session.entity';
import { AgentTask, TaskStatus, TaskPriority } from './entities/agent-task.entity';
import {
  AgentType,
  AgentStatus,
  AgentMessage,
  AgentToolCall,
  AGENT_CONFIGS,
  AgentModelSelection,
  AgentRuntimeSettings,
} from './types';


export interface ChatRequest {
  message: string;
  sessionId?: string;
}

export interface ChatResponse {
  sessionId: string;
  messageId: string;
  response: string;
  toolCalls?: AgentToolCall[];
}

export interface CreateSessionDto {
  agentType: AgentType;
  metadata?: Record<string, unknown>;
}

export interface CreateTaskDto {
  title: string;
  description?: string;
  agentType: AgentType;
  priority?: TaskPriority;
  labels?: string[];
  metadata?: Record<string, unknown>;
}

export interface UpdateTaskDto {
  title?: string;
  description?: string;
  status?: TaskStatus;
  priority?: TaskPriority;
  labels?: string[];
  blockedReason?: string;
  metadata?: Record<string, unknown>;
}

@Injectable()
export class AgentsService {
  private readonly logger = new Logger(AgentsService.name);
  private get runtimeUrl() { return (process.env.AGENTS_API_URL || 'http://localhost:8000').replace(/\/$/, ''); }

  constructor(
    @InjectRepository(AgentSession)
    private sessionRepository: Repository<AgentSession>,
    @InjectRepository(AgentTask)
    private taskRepository: Repository<AgentTask>,
  ) {}

  /**
   * Chat with an agent - proxies to Python agents service
   */
  async chat(agentType: AgentType, request: ChatRequest): Promise<ChatResponse> {
    return this.chatWithMemories(agentType, request, []);
  }

  async runtimeSettings(agentType: AgentType): Promise<AgentRuntimeSettings> {
    try {
      const response = await fetch(`${this.runtimeUrl}/agents/${agentType}/settings`, { signal: AbortSignal.timeout(15000) });
      if (!response.ok) throw new Error('Runtime settings unavailable');
      const settings = await response.json() as AgentRuntimeSettings;
      if (settings.agentType !== agentType || !Array.isArray(settings.skills) || !Array.isArray(settings.tools) || !Array.isArray(settings.providers) || !settings.defaultModel || typeof settings.defaultMaxIterations !== 'number' || typeof settings.defaultTemperature !== 'number') throw new Error('Invalid runtime catalog');
      return settings;
    } catch {
      throw new ServiceUnavailableException('Agent settings could not be loaded. Check the agent runtime and try again.');
    }
  }

  /**
   * One real proxied turn against the Python agents service, or null if it could not
   * be completed (network failure, non-2xx not already thrown as an HttpException).
   * Shared by chatWithMemories (human console chat — may fall back to canned text
   * outside production) and chatForAutomation (callers that must never substitute
   * fake content for a real answer, e.g. a live meeting reply).
   */
  private async tryChatWithMemories(agentType: AgentType, request: ChatRequest, memories: Array<{ category: string; content: string }>, workflowScope?: { projectId: string; canExecute: boolean }, modelSelection?: AgentModelSelection | null, maxIterations?: number | null, meetingContext?: string, temperature?: number | null): Promise<ChatResponse | null> {
    const memoryKey = process.env.AGENT_MEMORY_SIGNING_KEY;
    if ((memories.length || workflowScope || modelSelection || maxIterations || meetingContext || temperature != null) && (!memoryKey || memoryKey.length < 32)) throw new ServiceUnavailableException('Agent context signing is not configured');
    const trustedMemories = memories.map(memory => ({ category: memory.category, content: memory.content }));
    const payload = { agentType, sessionId: request.sessionId || null, message: request.message, memories: trustedMemories, ...(meetingContext ? { meetingContext } : {}), ...(workflowScope ? { workflowScope } : {}), ...(modelSelection ? { modelSelection } : {}), ...(maxIterations ? { maxIterations } : {}), ...(temperature != null ? { temperature } : {}) };
    const signature = memoryKey ? createHmac('sha256', memoryKey).update(JSON.stringify(payload)).digest('hex') : undefined;
    // Try to proxy to Python agents service
    try {
      const response = await fetch(`${this.runtimeUrl}/agents/${agentType}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(signature ? { 'X-Agent-Memory-Signature': signature } : {}) },
        body: JSON.stringify({
          message: request.message,
          sessionId: request.sessionId || null,
          memories: trustedMemories,
          ...(meetingContext ? { meetingContext } : {}),
          ...(workflowScope ? { workflowScope } : {}),
          ...(modelSelection ? { modelSelection } : {}),
          ...(maxIterations ? { maxIterations } : {}),
          ...(temperature != null ? { temperature } : {}),
        }),
      });

      if (response.ok) {
        const data = await response.json();

        // Persist session to database if we got a response
        if (data.sessionId) {
          await this.syncSessionFromAgent(data.sessionId, agentType);
        }

        return {
          sessionId: data.sessionId,
          messageId: data.messageId,
          response: data.response,
          toolCalls: data.toolCalls,
        };
      }
      if (response.status === 403) throw new ForbiddenException('Start a new agent session for this app');
      if (response.status === 422) throw new BadRequestException('The agent request is invalid');
      if (response.status === 401) throw new ServiceUnavailableException('Agent context signing was rejected');
    } catch (error) {
      if (error instanceof HttpException) throw error;
      this.logger.warn(`Agent service unavailable: ${error.message}`);
    }
    return null;
  }

  async chatWithMemories(agentType: AgentType, request: ChatRequest, memories: Array<{ category: string; content: string }>, workflowScope?: { projectId: string; canExecute: boolean }, modelSelection?: AgentModelSelection | null, maxIterations?: number | null, meetingContext?: string, temperature?: number | null): Promise<ChatResponse> {
    const result = await this.tryChatWithMemories(agentType, request, memories, workflowScope, modelSelection, maxIterations, meetingContext, temperature);
    if (result) return result;
    if (process.env.NODE_ENV === 'production') throw new ServiceUnavailableException('Agent runtime is unavailable. Try again shortly.');
    // Fallback response when agents service is not available
    return this.generateFallbackResponse(agentType, request);
  }

  /**
   * Same proxied turn as chatWithMemories, but ALWAYS throws on failure, in every
   * environment — never the human-chat-widget's canned placeholder text. Use this for
   * automated callers acting on the agent's response as real, grounded content (e.g.
   * speaking it into a live meeting); chatWithMemories's dev-mode fallback would be
   * actively misleading there, not merely unhelpful.
   */
  async chatForAutomation(agentType: AgentType, request: ChatRequest, memories: Array<{ category: string; content: string }> = [], workflowScope?: { projectId: string; canExecute: boolean }, modelSelection?: AgentModelSelection | null, maxIterations?: number | null, meetingContext?: string, temperature?: number | null): Promise<ChatResponse> {
    const result = await this.tryChatWithMemories(agentType, request, memories, workflowScope, modelSelection, maxIterations, meetingContext, temperature);
    if (!result) throw new ServiceUnavailableException('Agent runtime is unavailable. Try again shortly.');
    return result;
  }

  /**
   * Same request as chatWithMemories, but proxies the runtime's server-sent event
   * stream (tool calls, tool results, reply text, then a final "done" event) straight
   * through instead of waiting for the whole turn. There is no non-streaming fallback:
   * a caller that reached this method has already committed to consuming a stream.
   */
  async chatStreamWithMemories(agentType: AgentType, request: ChatRequest, memories: Array<{ category: string; content: string }>, workflowScope?: { projectId: string; canExecute: boolean }, modelSelection?: AgentModelSelection | null, maxIterations?: number | null, meetingContext?: string, temperature?: number | null): Promise<Readable> {
    const memoryKey = process.env.AGENT_MEMORY_SIGNING_KEY;
    if ((memories.length || workflowScope || modelSelection || maxIterations || meetingContext || temperature != null) && (!memoryKey || memoryKey.length < 32)) throw new ServiceUnavailableException('Agent context signing is not configured');
    const trustedMemories = memories.map(memory => ({ category: memory.category, content: memory.content }));
    const payload = { agentType, sessionId: request.sessionId || null, message: request.message, memories: trustedMemories, ...(meetingContext ? { meetingContext } : {}), ...(workflowScope ? { workflowScope } : {}), ...(modelSelection ? { modelSelection } : {}), ...(maxIterations ? { maxIterations } : {}), ...(temperature != null ? { temperature } : {}) };
    const signature = memoryKey ? createHmac('sha256', memoryKey).update(JSON.stringify(payload)).digest('hex') : undefined;
    let response: Response;
    try {
      response = await fetch(`${this.runtimeUrl}/agents/${agentType}/chat/stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(signature ? { 'X-Agent-Memory-Signature': signature } : {}) },
        body: JSON.stringify({
          message: request.message,
          sessionId: request.sessionId || null,
          memories: trustedMemories,
          ...(meetingContext ? { meetingContext } : {}),
          ...(workflowScope ? { workflowScope } : {}),
          ...(modelSelection ? { modelSelection } : {}),
          ...(maxIterations ? { maxIterations } : {}),
          ...(temperature != null ? { temperature } : {}),
        }),
      });
    } catch (error) {
      throw new ServiceUnavailableException('Agent runtime is unavailable. Try again shortly.');
    }
    if (!response.ok || !response.body) {
      if (response.status === 403) throw new ForbiddenException('Start a new agent session for this app');
      if (response.status === 422) throw new BadRequestException('The agent request is invalid');
      if (response.status === 401) throw new ServiceUnavailableException('Agent context signing was rejected');
      throw new ServiceUnavailableException('Agent runtime is unavailable. Try again shortly.');
    }

    const stream = Readable.fromWeb(response.body as any);
    let buffer = '';
    stream.on('data', (chunk: Buffer) => {
      buffer += chunk.toString('utf8');
      let boundary: number;
      while ((boundary = buffer.indexOf('\n\n')) !== -1) {
        const line = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        if (!line.startsWith('data: ')) continue;
        try {
          const event = JSON.parse(line.slice(6));
          if (event?.type === 'done' && event.sessionId) void this.syncSessionFromAgent(event.sessionId, agentType);
        } catch {
          // Malformed event from the runtime; the client-facing stream still carries it verbatim.
        }
      }
    });
    return stream;
  }

  /**
   * Create a Console session and seed it with an assistant-authored opening
   * message, with no human turn involved — how Outpost turns a proactive
   * finding into a ready-made conversation the human can reply to directly.
   * Degrades gracefully to an unseeded session if the runtime call fails,
   * rather than failing the Outpost run that triggered it.
   */
  async seedConsoleSession(agentType: 'qae' | 'aue', content: string): Promise<AgentSession> {
    const session = await this.createSession(agentType);
    const key = process.env.QA_WORKFLOW_KEY;
    if (!key || key.length < 32) return session;
    try {
      const response = await fetch(`${this.runtimeUrl}/agents/${agentType}/sessions/${session.id}/seed`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-qa-workflow-key': key },
        body: JSON.stringify({ content }),
        signal: AbortSignal.timeout(10000),
      });
      if (!response.ok) return session;
      session.messages = [...session.messages, { id: session.id + ':seed', role: 'assistant', content, timestamp: new Date() }];
      return this.sessionRepository.save(session);
    } catch (error) {
      this.logger.debug(`Could not seed Console session: ${error.message}`);
      return session;
    }
  }

  /**
   * Run one named skill headlessly, with no chat session or human present —
   * the primitive Outpost activities use. Scoped to a project so the skill
   * resolves that project's configured resources, and gated by canExecute so
   * execution-effect skills only run when the activity's autonomy level allows it.
   */
  async runWorkflowSkill(agentType: 'qae' | 'aue', skill: string, inputs: Record<string, unknown>, requestId: string, projectId: string, canExecute: boolean, timeoutMs: number = 130000): Promise<{ status: string; summary: string; data: Record<string, unknown>; publication: string }> {
    const key = process.env.QA_WORKFLOW_KEY;
    if (!key || key.length < 32) throw new ServiceUnavailableException('QA workflow access is not configured');
    const response = await fetch(`${this.runtimeUrl}/workflows/runs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-qa-workflow-key': key },
      body: JSON.stringify({ request_id: requestId, agent_type: agentType, skill, inputs, allow_model: false, project_id: projectId, can_execute: canExecute }),
      // Default covers every other skill call unchanged; explore_app's agentic loop
      // needs more room (see QaService.exploreEnvironment, which passes a larger value).
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) throw new Error(`Workflow run failed with status ${response.status}`);
    return await response.json();
  }

  /**
   * List executions the agents runtime is currently streaming live.
   */
  async getLiveExecutions(): Promise<Array<{ runId: string; testId: string; testName: string; status: string; startedAt: string }>> {
    try {
      const response = await fetch(`${this.runtimeUrl}/executions/live`, { signal: AbortSignal.timeout(10000) });
      if (!response.ok) return [];
      return await response.json();
    } catch (error) {
      this.logger.debug(`Live executions unavailable: ${error.message}`);
      return [];
    }
  }

  /**
   * Start an agent-driven browser execution for a test case. Returns the run ID
   * immediately; the run continues in the background on the agents runtime.
   */
  async startExecution(testId: string, environment: string, browser: string): Promise<{ runId: string }> {
    try {
      const response = await fetch(`${this.runtimeUrl}/executions/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ testId, environment, browser }),
        signal: AbortSignal.timeout(15000),
      });
      if (response.status === 404) throw new NotFoundException('Test case not found');
      if (!response.ok) throw new Error(`Agent runtime returned ${response.status}`);
      return await response.json();
    } catch (error) {
      if (error instanceof HttpException) throw error;
      throw new ServiceUnavailableException('Agent runtime is unavailable. Try again shortly.');
    }
  }

  /**
   * Create a new session
   */
  async createSession(agentType: AgentType): Promise<AgentSession> {
    // Try to create session in Python service first
    try {
      const response = await fetch(`${this.runtimeUrl}/agents/${agentType}/sessions`, {
        method: 'POST',
      });

      if (response.ok) {
        const data = await response.json();
        // Create local session with same ID
        const session = this.sessionRepository.create({
          id: data.id,
          agentType,
          status: 'idle',
          messages: [],
          context: {},
        });
        return this.sessionRepository.save(session);
      }
    } catch (error) {
      this.logger.debug(`Creating local session only: ${error.message}`);
    }

    // Create local session only
    const session = this.sessionRepository.create({
      agentType,
      status: 'idle',
      messages: [],
      context: {},
    });
    return this.sessionRepository.save(session);
  }

  /**
   * Get session by ID
   */
  async getSession(sessionId: string): Promise<AgentSession> {
    // Try to get latest from Python service
    try {
      const response = await fetch(`${this.runtimeUrl}/sessions/${sessionId}`);
      if (response.ok) {
        const data = await response.json();
        await this.syncSessionData(sessionId, data);
      }
    } catch (error) {
      this.logger.debug(`Could not sync session from agent service: ${error.message}`);
    }

    const session = await this.sessionRepository.findOne({
      where: { id: sessionId },
    });

    if (!session) {
      throw new NotFoundException(`Session ${sessionId} not found`);
    }

    return session;
  }

  /**
   * Get sessions by agent type
   */
  async getSessionsByType(agentType: AgentType): Promise<AgentSession[]> {
    return this.sessionRepository.find({
      where: { agentType },
      order: { updatedAt: 'DESC' },
      take: 50,
    });
  }

  /**
   * Delete a session
   */
  async deleteSession(sessionId: string): Promise<void> {
    // Try to delete from Python service
    try {
      await fetch(`${this.runtimeUrl}/sessions/${sessionId}`, {
        method: 'DELETE',
      });
    } catch (error) {
      this.logger.debug(`Could not delete session from agent service: ${error.message}`);
    }

    await this.sessionRepository.delete(sessionId);
  }

  /**
   * Update session status
   */
  async updateStatus(sessionId: string, status: AgentStatus): Promise<AgentSession> {
    const session = await this.getSession(sessionId);
    session.status = status;
    return this.sessionRepository.save(session);
  }

  /**
   * Add message to session
   */
  async addMessage(sessionId: string, message: Omit<AgentMessage, 'id' | 'timestamp'>): Promise<AgentSession> {
    const session = await this.getSession(sessionId);

    const newMessage: AgentMessage = {
      id: crypto.randomUUID(),
      ...message,
      timestamp: new Date(),
    };

    session.messages = [...session.messages, newMessage];
    return this.sessionRepository.save(session);
  }

  /**
   * Get agent configuration
   */
  getConfig(agentType: AgentType) {
    const config = AGENT_CONFIGS[agentType];
    if (!config) {
      throw new NotFoundException(`Unknown agent type: ${agentType}`);
    }
    return config;
  }

  /**
   * Get all agent configurations
   */
  getAllConfigs() {
    return Object.entries(AGENT_CONFIGS).map(([type, config]) => ({
      type,
      name: config.name,
      description: config.description,
      tools: config.tools,
    }));
  }

  /**
   * Sync session from agent service
   */
  private async syncSessionFromAgent(sessionId: string, agentType: AgentType): Promise<void> {
    let data: any = null;
    try {
      const response = await fetch(`${this.runtimeUrl}/sessions/${sessionId}`);
      if (response.ok) data = await response.json();
    } catch (error) {
      this.logger.warn(`Could not fetch session from agent service: ${error.message}`);
    }

    try {
      let session = await this.sessionRepository.findOne({
        where: { id: sessionId },
      });

      if (!session) {
        session = this.sessionRepository.create({
          id: sessionId,
          agentType,
          status: data?.status || 'idle',
          messages: data?.messages || [],
          context: data?.context || {},
        });
      } else if (data) {
        session.messages = data.messages || session.messages;
        session.context = data.context || session.context;
        session.status = data.status || session.status;
      }
      await this.sessionRepository.save(session);
    } catch (error) {
      this.logger.warn(`Failed to sync session: ${error.message}`);
    }
  }

  /**
   * Sync session data from agent service response
   */
  private async syncSessionData(sessionId: string, data: any): Promise<void> {
    try {
      let session = await this.sessionRepository.findOne({
        where: { id: sessionId },
      });

      if (session) {
        session.messages = data.messages || session.messages;
        session.context = data.context || session.context;
        session.status = data.status || session.status;
        await this.sessionRepository.save(session);
      }
    } catch (error) {
      this.logger.warn(`Failed to sync session data: ${error.message}`);
    }
  }

  /**
   * Generate fallback response when agent service is unavailable
   */
  private async generateFallbackResponse(
    agentType: AgentType,
    request: ChatRequest,
  ): Promise<ChatResponse> {
    // Create or get session
    let session: AgentSession;
    if (request.sessionId) {
      try {
        session = await this.getSession(request.sessionId);
      } catch {
        session = await this.createSession(agentType);
      }
    } else {
      session = await this.createSession(agentType);
    }

    // Add user message
    await this.addMessage(session.id, {
      role: 'user',
      content: request.message,
    });

    // Generate response
    const responses: Record<AgentType, string[]> = {
      qae: [
        "I've analyzed your request from a QA perspective. Here are my recommendations:\n\n1. **Test Coverage**: Ensure both positive and negative scenarios are covered\n2. **Edge Cases**: Consider boundary values and limit testing\n3. **Integration Points**: Verify interactions with dependent systems\n\nWould you like me to elaborate on any specific area?",
        "Based on my analysis, I recommend focusing on:\n\n- **Functional Testing**: Verify core functionality\n- **Regression Testing**: Ensure existing features work\n- **User Experience**: Test from end-user perspective\n\nShall I help design specific test cases?",
      ],
      aue: [
        "From an automation perspective, I recommend:\n\n1. **Locator Strategy**: Use data-testid for stability\n2. **Wait Strategy**: Implement smart waits\n3. **Assertions**: Add meaningful assertions\n\n```javascript\nawait page.getByTestId('submit-button');\n```\n\nWant me to generate a complete script?",
        "Here's my automation approach:\n\n1. **Page Object Pattern**: Encapsulate interactions\n2. **Test Data**: Use fixtures\n3. **Error Handling**: Implement retry logic\n\nShall I create the structure?",
      ],
      superqa: [
        "I'm Super QA - your all-powerful platform assistant! I can help you with:\n\n- **Task Management**: Create and manage agent tasks\n- **Sync Jobs**: Start and monitor source syncs\n- **Environments**: Manage environments and variables\n- **Knowledge**: Search the business knowledge base\n\nWhat would you like me to do?",
        "I've completed your request. Here's the summary:\n\n✅ Task completed successfully\n\nIs there anything else you'd like me to help with?",
      ],
    };

    const agentResponses = responses[agentType] || responses.qae;
    const responseContent = agentResponses[Math.floor(Math.random() * agentResponses.length)];
    const messageId = crypto.randomUUID();

    // Add assistant message
    await this.addMessage(session.id, {
      role: 'assistant',
      content: responseContent,
    });

    return {
      sessionId: session.id,
      messageId,
      response: responseContent,
    };
  }

  // ============ Task Management ============

  /**
   * Create a new task for an agent
   */
  async createTask(dto: CreateTaskDto): Promise<AgentTask> {
    const task = this.taskRepository.create({
      title: dto.title,
      description: dto.description || null,
      agentType: dto.agentType,
      status: 'todo',
      priority: dto.priority || 'medium',
      labels: dto.labels || [],
      metadata: dto.metadata || null,
    });
    return this.taskRepository.save(task);
  }

  /**
   * Get task by ID
   */
  async getTask(taskId: string): Promise<AgentTask> {
    const task = await this.taskRepository.findOne({
      where: { id: taskId },
      relations: ['session'],
    });

    if (!task) {
      throw new NotFoundException(`Task ${taskId} not found`);
    }

    return task;
  }

  /**
   * Get tasks by agent type
   */
  async getTasksByType(agentType: AgentType): Promise<AgentTask[]> {
    return this.taskRepository.find({
      where: { agentType },
      order: { createdAt: 'DESC' },
    });
  }

  /**
   * Get tasks by status
   */
  async getTasksByStatus(agentType: AgentType, status: TaskStatus): Promise<AgentTask[]> {
    return this.taskRepository.find({
      where: { agentType, status },
      order: { priority: 'ASC', createdAt: 'DESC' },
    });
  }

  /**
   * Update a task
   */
  async updateTask(taskId: string, dto: UpdateTaskDto): Promise<AgentTask> {
    const task = await this.getTask(taskId);

    // Handle status transitions
    if (dto.status && dto.status !== task.status) {
      if (dto.status === 'in_progress' && !task.startedAt) {
        task.startedAt = new Date();
      }
      if (dto.status === 'done' || dto.status === 'cancelled') {
        task.completedAt = new Date();
      }
      if (dto.status === 'blocked' && dto.blockedReason) {
        task.blockedReason = dto.blockedReason;
      }
      if (dto.status !== 'blocked') {
        task.blockedReason = null;
      }
    }

    // Update fields
    if (dto.title !== undefined) task.title = dto.title;
    if (dto.description !== undefined) task.description = dto.description;
    if (dto.status !== undefined) task.status = dto.status;
    if (dto.priority !== undefined) task.priority = dto.priority;
    if (dto.labels !== undefined) task.labels = dto.labels;
    if (dto.metadata !== undefined) task.metadata = dto.metadata;

    return this.taskRepository.save(task);
  }

  /**
   * Delete a task
   */
  async deleteTask(taskId: string): Promise<void> {
    const task = await this.getTask(taskId);
    await this.taskRepository.remove(task);
  }

  /**
   * Start working on a task - creates a session and links it
   */
  async startTask(taskId: string): Promise<AgentTask> {
    const task = await this.getTask(taskId);

    if (task.status !== 'todo' && task.status !== 'blocked') {
      throw new Error(`Cannot start task in ${task.status} status`);
    }

    // Create a new session for this task
    const session = await this.createSession(task.agentType);

    task.sessionId = session.id;
    task.status = 'in_progress';
    task.startedAt = new Date();
    task.blockedReason = null;

    return this.taskRepository.save(task);
  }

  /**
   * Complete a task with result
   */
  async completeTask(
    taskId: string,
    result?: { summary?: string; artifacts?: any[] },
  ): Promise<AgentTask> {
    const task = await this.getTask(taskId);

    task.status = 'done';
    task.completedAt = new Date();
    if (result) {
      task.result = result;
    }

    return this.taskRepository.save(task);
  }

  /**
   * Block a task with reason
   */
  async blockTask(taskId: string, reason: string): Promise<AgentTask> {
    const task = await this.getTask(taskId);

    task.status = 'blocked';
    task.blockedReason = reason;

    return this.taskRepository.save(task);
  }

  /**
   * Get task statistics by agent type
   */
  async getTaskStats(agentType: AgentType): Promise<Record<TaskStatus, number>> {
    const result = await this.taskRepository
      .createQueryBuilder('task')
      .select('task.status', 'status')
      .addSelect('COUNT(*)', 'count')
      .where('task.agentType = :agentType', { agentType })
      .groupBy('task.status')
      .getRawMany();

    const stats: Record<TaskStatus, number> = {
      todo: 0,
      in_progress: 0,
      done: 0,
      cancelled: 0,
      blocked: 0,
    };

    for (const row of result) {
      stats[row.status as TaskStatus] = parseInt(row.count, 10);
    }

    return stats;
  }
}
