import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { DataSource } from 'typeorm';
import { EmbeddingService } from '../processing/embedding.service';
import { ConfigService } from '@nestjs/config';

export interface HealthCheckResult {
  status: 'healthy' | 'unhealthy' | 'degraded';
  message?: string;
  details?: Record<string, any>;
  timestamp: string;
}

type ClientService = { id: string; name: string; status: 'healthy' | 'unhealthy'; detail: string; checkedAt: string };

@Injectable()
export class HealthService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(HealthService.name);
  private statusTimer?: NodeJS.Timeout;
  private statusCheck?: Promise<ClientService[]>;
  private readonly observedUnhealthySince = new Map<string, string>();

  constructor(
    @InjectDataSource()
    private dataSource: DataSource,
    @InjectQueue('document-processing')
    private processingQueue: Queue,
    private embeddingService: EmbeddingService,
    private configService: ConfigService,
  ) {}

  onModuleInit() {
    void this.captureStatus().catch(() => undefined);
    this.statusTimer = setInterval(() => void this.captureStatus().catch(() => undefined), 60_000);
    this.statusTimer.unref();
  }

  onModuleDestroy() {
    if (this.statusTimer) clearInterval(this.statusTimer);
  }

  async clientStatus() {
    const services = await this.captureStatus();
    let timeline: unknown[] = [];
    try {
      timeline = await this.dataSource.query(`SELECT id, service, status, message, "startedAt", "resolvedAt"
        FROM qa_service_status_incidents
        WHERE "startedAt" >= now() - INTERVAL '30 days'
        ORDER BY "startedAt" DESC LIMIT 100`);
    } catch { /* Current feature health remains useful when history storage is unavailable. */ }
    return { checkedAt: new Date().toISOString(), services, timeline };
  }

  private async captureStatus() {
    if (this.statusCheck) return this.statusCheck;
    this.statusCheck = (async () => {
      const [database, queue, agents] = await Promise.all([
        this.checkDatabase(), this.checkRedis(), this.checkAgentRuntime(),
      ]);
      const checkedAt = new Date().toISOString();
      const healthy = (checks: HealthCheckResult[]) => checks.every(check => check.status === 'healthy');
      const services: ClientService[] = [
        { id: 'chat', name: 'Chat', status: healthy([database]) ? 'healthy' : 'unhealthy', detail: healthy([database]) ? 'Ready for conversations and meetings.' : 'Chat may be temporarily unavailable.', checkedAt },
        { id: 'pipelines', name: 'Pipelines', status: healthy([database, queue]) ? 'healthy' : 'unhealthy', detail: healthy([database, queue]) ? 'Ready to sync and process knowledge.' : 'Syncs or processing may be delayed.', checkedAt },
        { id: 'agents', name: 'Agents', status: healthy([database, agents]) ? 'healthy' : 'unhealthy', detail: healthy([database, agents]) ? 'Agent runtime is responding.' : 'Agent tasks may be delayed or unavailable.', checkedAt },
      ];
      await this.recordStatus(services).catch(() => undefined);
      return services;
    })().finally(() => { this.statusCheck = undefined; });
    return this.statusCheck;
  }

  private async recordStatus(services: Array<{ id: string; status: string }>) {
    const messages: Record<string, string> = {
      chat: 'Chat was temporarily unavailable.',
      pipelines: 'Pipelines were temporarily unavailable.',
      agents: 'Agents were temporarily unavailable.',
    };
    for (const service of services) {
      if (service.status === 'unhealthy' && !this.observedUnhealthySince.has(service.id)) {
        this.observedUnhealthySince.set(service.id, new Date().toISOString());
      }
    }
    for (const service of services) {
      if (service.status === 'unhealthy') {
        await this.dataSource.query(`INSERT INTO qa_service_status_incidents (service, status, message)
          VALUES ($1, 'unhealthy', $2)
          ON CONFLICT (service) WHERE "resolvedAt" IS NULL DO NOTHING`, [service.id, messages[service.id]]);
      } else {
        const recovered = await this.dataSource.query(`UPDATE qa_service_status_incidents SET "resolvedAt" = now()
          WHERE service = $1 AND "resolvedAt" IS NULL RETURNING id`, [service.id]);
        const observedStart = this.observedUnhealthySince.get(service.id);
        if (!recovered.length && observedStart) {
          await this.dataSource.query(`INSERT INTO qa_service_status_incidents (service, status, message, "startedAt", "resolvedAt")
            VALUES ($1, 'unhealthy', $2, $3, now())`, [service.id, messages[service.id], observedStart]);
        }
        this.observedUnhealthySince.delete(service.id);
      }
    }
  }

  private async checkAgentRuntime(): Promise<HealthCheckResult> {
    try {
      const response = await fetch((process.env.AGENTS_API_URL || 'http://localhost:8000').replace(/\/$/, '') + '/health', { cache: 'no-store', signal: AbortSignal.timeout(2500) });
      const body = await response.json() as { status?: string };
      return { status: response.ok && body.status === 'healthy' ? 'healthy' : 'unhealthy', timestamp: new Date().toISOString() };
    } catch {
      return { status: 'unhealthy', timestamp: new Date().toISOString() };
    }
  }

  /**
   * Overall health check
   */
  async check(): Promise<HealthCheckResult> {
    try {
      const [db, redis, embedding] = await Promise.all([
        this.checkDatabase(),
        this.checkRedis(),
        this.checkEmbedding(),
      ]);

      const allHealthy = [db, redis, embedding].every((r) => r.status === 'healthy');
      const anyUnhealthy = [db, redis, embedding].some((r) => r.status === 'unhealthy');

      return {
        status: anyUnhealthy ? 'unhealthy' : allHealthy ? 'healthy' : 'degraded',
        timestamp: new Date().toISOString(),
        details: {
          database: db,
          redis: redis,
          embedding: embedding,
        },
      };
    } catch (error) {
      this.logger.error(`Health check failed: ${error.message}`);
      return {
        status: 'unhealthy',
        message: error.message,
        timestamp: new Date().toISOString(),
      };
    }
  }

  /**
   * Check database connectivity
   */
  async checkDatabase(): Promise<HealthCheckResult> {
    try {
      const startTime = Date.now();
      await this.dataSource.query('SELECT 1');
      const duration = Date.now() - startTime;

      return {
        status: 'healthy',
        timestamp: new Date().toISOString(),
        details: {
          responseTime: `${duration}ms`,
          connected: this.dataSource.isInitialized,
        },
      };
    } catch (error) {
      this.logger.error(`Database health check failed: ${error.message}`);
      return {
        status: 'unhealthy',
        message: error.message,
        timestamp: new Date().toISOString(),
      };
    }
  }

  /**
   * Check Redis/Bull queue connectivity
   */
  async checkRedis(): Promise<HealthCheckResult> {
    try {
      const startTime = Date.now();
      const jobCounts = await this.processingQueue.getJobCounts();
      const duration = Date.now() - startTime;

      return {
        status: 'healthy',
        timestamp: new Date().toISOString(),
        details: {
          responseTime: `${duration}ms`,
          jobs: jobCounts,
        },
      };
    } catch (error) {
      this.logger.error(`Redis health check failed: ${error.message}`);
      return {
        status: 'unhealthy',
        message: error.message,
        timestamp: new Date().toISOString(),
      };
    }
  }

  /**
   * Check embedding service connectivity
   */
  async checkEmbedding(): Promise<HealthCheckResult> {
    try {
      const provider = this.configService.get('EMBEDDING_PROVIDER') || 'local';
      const model = this.configService.get('EMBEDDING_MODEL') || 'text-embedding-3-small';

      // For OpenAI, check API connectivity
      if (provider === 'openai') {
        const apiKey = this.configService.get('OPENAI_API_KEY');
        if (!apiKey) {
          return {
            status: 'unhealthy',
            message: 'OpenAI API key not configured',
            timestamp: new Date().toISOString(),
            details: { provider, model },
          };
        }

        // Test with a simple embedding
        const startTime = Date.now();
        try {
          await this.embeddingService.embed(['Health check test']);
          const duration = Date.now() - startTime;

          return {
            status: 'healthy',
            timestamp: new Date().toISOString(),
            details: {
              provider,
              model,
              responseTime: `${duration}ms`,
            },
          };
        } catch (error) {
          this.logger.error(`Embedding generation failed: ${error.message}`);

          // Provide specific error messages
          let message = error.message;
          if (error.message.includes('fetch failed')) {
            message = 'Network error - cannot reach OpenAI API';
          } else if (error.message.includes('401')) {
            message = 'Authentication failed - invalid API key';
          } else if (error.message.includes('429')) {
            message = 'Rate limit exceeded';
          }

          return {
            status: 'unhealthy',
            message,
            timestamp: new Date().toISOString(),
            details: { provider, model, error: error.message },
          };
        }
      }

      // For local/huggingface, just return configured
      return {
        status: 'healthy',
        timestamp: new Date().toISOString(),
        details: {
          provider,
          model: provider === 'local' ? 'hash-based (testing only)' : model,
        },
      };
    } catch (error) {
      this.logger.error(`Embedding health check failed: ${error.message}`);
      return {
        status: 'unhealthy',
        message: error.message,
        timestamp: new Date().toISOString(),
      };
    }
  }
}
