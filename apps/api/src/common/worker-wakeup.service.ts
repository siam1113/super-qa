import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { EventEmitter } from 'events';

interface PgNotificationClient extends EventEmitter {
  connect(): Promise<void>;
  query(sql: string): Promise<unknown>;
  end(): Promise<void>;
}
const PgClient = require('pg').Client as new (options: Record<string, unknown>) => PgNotificationClient;

export type WorkerChannel = 'chat_work_available' | 'pipeline_work_available' | 'calendar_work_available' | 'agent_task_available' | 'source_event_available' | 'source_change_available';

/** PostgreSQL notifications wake workers; durable rows remain the source of truth. */
@Injectable()
export class WorkerWakeupService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WorkerWakeupService.name);
  private readonly events = new EventEmitter();
  private client?: PgNotificationClient;
  private stopped = false;
  private reconnectTimer?: ReturnType<typeof setTimeout>;

  constructor() { this.events.setMaxListeners(0); }

  async onModuleInit() { await this.connect(); }

  async onModuleDestroy() {
    this.stopped = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    const client = this.client;
    this.client = undefined;
    if (client) await client.end().catch(() => undefined);
  }

  async wait(channel: WorkerChannel, fallbackMs?: number, signal?: AbortSignal): Promise<void> {
    await new Promise<void>(resolve => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        if (timer) clearTimeout(timer);
        this.events.off(channel, finish);
        signal?.removeEventListener('abort', finish);
        resolve();
      };
      const timer = fallbackMs === undefined ? undefined : setTimeout(finish, fallbackMs);
      this.events.once(channel, finish);
      if (signal?.aborted) finish();
      else signal?.addEventListener('abort', finish, { once: true });
    });
  }

  wake(channel: WorkerChannel) { this.events.emit(channel); }

  subscribe(channel: WorkerChannel, listener: (payload: any) => void): () => void {
    const event = `${channel}:notification`;
    this.events.on(event, listener);
    return () => this.events.off(event, listener);
  }

  private async connect() {
    if (this.stopped || this.client) return;
    const client = new PgClient({
      host: process.env.DATABASE_HOST || 'localhost',
      port: parseInt(process.env.DATABASE_PORT || '5432', 10),
      user: process.env.DATABASE_USER || 'qaagent',
      password: process.env.DATABASE_PASSWORD || 'qaagent123',
      database: process.env.DATABASE_NAME || 'qaagent',
      application_name: 'ultimate-qa-worker-wakeup',
    });
    client.on('notification', (message: { channel?: string; payload?: string }) => {
      if (message.channel === 'chat_work_available' || message.channel === 'pipeline_work_available') {
        this.events.emit(message.channel);
      }
      if (message.channel === 'calendar_work_available') this.events.emit(message.channel);
      if (message.channel === 'agent_task_available') this.events.emit(message.channel);
      if (message.channel === 'source_event_available') this.events.emit(message.channel);
      if (message.channel === 'source_change_available') this.events.emit(message.channel);
      if (['chat_work_available', 'calendar_work_available', 'agent_task_available', 'source_event_available', 'source_change_available'].includes(message.channel || '')) {
        let payload: unknown = message.payload;
        try { payload = JSON.parse(message.payload || 'null'); } catch {}
        this.events.emit(`${message.channel}:notification`, payload);
      }
    });
    client.on('error', (error: Error) => {
      this.logger.warn(`Worker notification connection lost: ${error.message}`);
      if (this.client === client) this.client = undefined;
      void client.end().catch(() => undefined);
      this.scheduleReconnect();
    });
    try {
      await client.connect();
      await client.query('LISTEN chat_work_available');
      await client.query('LISTEN pipeline_work_available');
      await client.query('LISTEN calendar_work_available');
      await client.query('LISTEN agent_task_available');
      await client.query('LISTEN source_event_available');
      await client.query('LISTEN source_change_available');
      if (this.stopped) return void client.end();
      this.client = client;
      // Notifications are not durable; reconcile persisted work after every reconnect.
      this.wake('chat_work_available');
      this.wake('pipeline_work_available');
      this.wake('calendar_work_available');
      this.wake('agent_task_available');
      this.wake('source_event_available');
      this.wake('source_change_available');
      for (const channel of ['chat_work_available', 'calendar_work_available', 'agent_task_available', 'source_event_available', 'source_change_available'] as const) {
        this.events.emit(`${channel}:notification`, { reconnected: true });
      }
    } catch (error) {
      await client.end().catch(() => undefined);
      this.logger.warn(`Worker notifications unavailable; recovery scans remain active: ${(error as Error).message}`);
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect() {
    if (this.stopped || this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      void this.connect();
    }, 5000);
    this.reconnectTimer.unref();
  }
}
