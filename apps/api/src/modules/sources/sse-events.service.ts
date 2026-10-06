import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { Observable, Subject } from 'rxjs';
import { WorkerWakeupService } from '../../common/worker-wakeup.service';

interface MessageEvent {
  data: string | object;
  id?: string;
  type?: string;
  retry?: number;
}

interface SseClient {
  id: string;
  subject: Subject<MessageEvent>;
  connectedAt: Date;
  lastHeartbeat: Date;
}

interface JobEventPayload {
  jobId: string;
  sourceId: string;
  data?: any;
  log?: any;
  stage?: string;
}

@Injectable()
export class SseEventsService {
  private readonly logger = new Logger(SseEventsService.name);
  private readonly clients = new Map<string, SseClient>();
  private heartbeatInterval: NodeJS.Timeout | null = null;
  private eventIdCounter = 0;
  private readonly stopSubscriptions: Array<() => void>;

  constructor(wakeups: WorkerWakeupService) {
    const stopJob = wakeups.subscribe('source_event_available', (payload: any) => {
      if (payload?.reconnected) {
        this.broadcast({ type: 'connected', data: { resync: true, timestamp: new Date().toISOString() } });
        return;
      }
      if (!payload?.jobId || !payload?.sourceId) return;
      this.broadcast({
        id: String(++this.eventIdCounter),
        type: 'job-update',
        data: { jobId: payload.jobId, sourceId: payload.sourceId, update: payload.data || {} },
      });
    });
    const stopSource = wakeups.subscribe('source_change_available', (payload: any) => {
      if (payload?.reconnected) return;
      if (!payload?.sourceId) return;
      this.broadcast({ id: String(++this.eventIdCounter), type: 'source-update', data: payload });
    });
    this.stopSubscriptions = [stopJob, stopSource];
  }

  /**
   * Create a new SSE connection for a client
   */
  createConnection(clientId?: string): Observable<MessageEvent> {
    const id = clientId || this.generateClientId();

    // Check if client already exists
    if (this.clients.has(id)) {
      this.logger.warn(`Client ${id} already connected, returning existing connection`);
      const existingClient = this.clients.get(id);
      if (existingClient) {
        return existingClient.subject.asObservable();
      }
    }

    const subject = new Subject<MessageEvent>();
    const client: SseClient = {
      id,
      subject,
      connectedAt: new Date(),
      lastHeartbeat: new Date(),
    };

    this.clients.set(id, client);
    this.startHeartbeat();
    this.logger.log(`Client ${id} connected. Total clients: ${this.clients.size}`);

    // Return observable that completes when subject completes
    return new Observable<MessageEvent>((observer) => {
      const subscription = subject.subscribe(observer);
      this.sendToClient(id, {
        type: 'connected',
        data: { clientId: id, timestamp: new Date().toISOString() },
      });

      // Cleanup on unsubscribe
      return () => {
        subscription.unsubscribe();
        this.disconnectClient(id);
      };
    });
  }

  /**
   * Disconnect a client
   */
  private disconnectClient(clientId: string) {
    const client = this.clients.get(clientId);
    if (client) {
      client.subject.complete();
      this.clients.delete(clientId);
      this.logger.log(`Client ${clientId} disconnected. Total clients: ${this.clients.size}`);
    }

    // Stop heartbeat if no clients
    if (this.clients.size === 0 && this.heartbeatInterval) {
      this.stopHeartbeat();
    }
  }

  /**
   * Send event to specific client
   */
  private sendToClient(clientId: string, event: MessageEvent) {
    const client = this.clients.get(clientId);
    if (client) {
      try {
        client.subject.next(event);
      } catch (error) {
        this.logger.error(`Error sending event to client ${clientId}:`, error);
        this.disconnectClient(clientId);
      }
    }
  }

  /**
   * Broadcast event to all connected clients
   */
  private broadcast(event: MessageEvent) {
    if (this.clients.size === 0) {
      return;
    }

    this.logger.debug(`Broadcasting ${event.type} to ${this.clients.size} clients`);

    this.clients.forEach((client, clientId) => {
      this.sendToClient(clientId, event);
    });
  }

  /**
   * Handle job log events
   */
  @OnEvent('job.log')
  handleLogEvent(payload: JobEventPayload) {
    this.logger.debug(`Received job.log event for job ${payload.jobId}`);

    this.broadcast({
      id: String(++this.eventIdCounter),
      type: 'log-update',
      data: {
        jobId: payload.jobId,
        sourceId: payload.sourceId,
        log: payload.log,
      },
    });
  }

  /**
   * Handle job progress events
   */
  @OnEvent('job.progress')
  handleProgressEvent(payload: JobEventPayload) {
    this.logger.debug(`Received job.progress event for job ${payload.jobId}`);

    this.broadcast({
      id: String(++this.eventIdCounter),
      type: 'job-update',
      data: {
        jobId: payload.jobId,
        sourceId: payload.sourceId,
        update: payload.data,
      },
    });
  }

  /**
   * Handle stage start events
   */
  @OnEvent('job.stage.start')
  handleStageStartEvent(payload: JobEventPayload) {
    this.logger.debug(`Received job.stage.start event for job ${payload.jobId}`);

    this.broadcast({
      id: String(++this.eventIdCounter),
      type: 'job-update',
      data: {
        jobId: payload.jobId,
        sourceId: payload.sourceId,
        update: payload.data,
      },
    });
  }

  /**
   * Handle stage complete events
   */
  @OnEvent('job.stage.complete')
  handleStageCompleteEvent(payload: JobEventPayload) {
    this.logger.debug(`Received job.stage.complete event for job ${payload.jobId}`);

    this.broadcast({
      id: String(++this.eventIdCounter),
      type: 'job-update',
      data: {
        jobId: payload.jobId,
        sourceId: payload.sourceId,
        update: payload.data,
      },
    });
  }

  /**
   * Handle stage fail events
   */
  @OnEvent('job.stage.fail')
  handleStageFailEvent(payload: JobEventPayload) {
    this.logger.debug(`Received job.stage.fail event for job ${payload.jobId}`);

    this.broadcast({
      id: String(++this.eventIdCounter),
      type: 'job-update',
      data: {
        jobId: payload.jobId,
        sourceId: payload.sourceId,
        update: payload.data,
      },
    });
  }

  /**
   * Handle job complete events
   */
  @OnEvent('job.complete')
  handleCompleteEvent(payload: JobEventPayload) {
    this.logger.debug(`Received job.complete event for job ${payload.jobId}`);

    this.broadcast({
      id: String(++this.eventIdCounter),
      type: 'job-update',
      data: {
        jobId: payload.jobId,
        sourceId: payload.sourceId,
        update: payload.data,
      },
    });
  }

  /**
   * Handle job cancel events
   */
  @OnEvent('job.cancel')
  handleCancelEvent(payload: JobEventPayload) {
    this.logger.debug(`Received job.cancel event for job ${payload.jobId}`);

    this.broadcast({
      id: String(++this.eventIdCounter),
      type: 'job-update',
      data: {
        jobId: payload.jobId,
        sourceId: payload.sourceId,
        update: payload.data,
      },
    });
  }

  /**
   * Start heartbeat mechanism
   */
  private startHeartbeat() {
    if (this.heartbeatInterval) {
      return;
    }

    this.heartbeatInterval = setInterval(() => {
      if (this.clients.size === 0) {
        return;
      }

      this.logger.debug(`Sending heartbeat to ${this.clients.size} clients`);

      const now = new Date();
      this.clients.forEach((client, clientId) => {
        client.lastHeartbeat = now;
        this.sendToClient(clientId, {
          type: 'heartbeat',
          data: {
            timestamp: now.toISOString(),
            clients: this.clients.size,
          },
        });
      });
    }, 30000); // 30 seconds

    this.logger.log('Heartbeat mechanism started');
  }

  /**
   * Stop heartbeat mechanism
   */
  private stopHeartbeat() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
      this.logger.log('Heartbeat mechanism stopped');
    }
  }

  /**
   * Generate unique client ID
   */
  private generateClientId(): string {
    return `client-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Get number of connected clients (for monitoring)
   */
  getConnectedClientsCount(): number {
    return this.clients.size;
  }

  /**
   * Cleanup on service destroy
   */
  onModuleDestroy() {
    this.stopSubscriptions.forEach(stop => stop());
    this.logger.log('Shutting down SSE Events Service');

    // Disconnect all clients
    this.clients.forEach((client, clientId) => {
      this.disconnectClient(clientId);
    });

    // Stop heartbeat
    this.stopHeartbeat();
  }
}
