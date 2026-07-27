import { Injectable, Logger, NotFoundException } from '@nestjs/common';
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
} from './types';

const AGENTS_API_URL = process.env.AGENTS_API_URL || 'http://localhost:8000';

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
    // Try to proxy to Python agents service
    try {
      const response = await fetch(`${AGENTS_API_URL}/agents/${agentType}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: request.message,
          sessionId: request.sessionId,
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
    } catch (error) {
      this.logger.warn(`Agent service unavailable: ${error.message}`);
    }

    // Fallback response when agents service is not available
    return this.generateFallbackResponse(agentType, request);
  }

  /**
   * Create a new session
   */
  async createSession(agentType: AgentType): Promise<AgentSession> {
    // Try to create session in Python service first
    try {
      const response = await fetch(`${AGENTS_API_URL}/agents/${agentType}/sessions`, {
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
      const response = await fetch(`${AGENTS_API_URL}/sessions/${sessionId}`);
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
      await fetch(`${AGENTS_API_URL}/sessions/${sessionId}`, {
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
    try {
      let session = await this.sessionRepository.findOne({
        where: { id: sessionId },
      });

      if (!session) {
        session = this.sessionRepository.create({
          id: sessionId,
          agentType,
          status: 'idle',
          messages: [],
          context: {},
        });
        await this.sessionRepository.save(session);
      }
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
