import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bull';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ThrottlerModule } from '@nestjs/throttler';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ThrottlerGuard } from '@nestjs/throttler';
import { databaseConfig } from './config/database.config';
import { TimeoutInterceptor } from './common/timeout.interceptor';
import { CommonModule } from './common/common.module';
import { QaModule } from './modules/qa/qa.module';
import { SourcesModule } from './modules/sources/sources.module';
import { DocumentsModule } from './modules/documents/documents.module';
import { ProcessingModule } from './modules/processing/processing.module';
import { RetrievalModule } from './modules/retrieval/retrieval.module';
import { StorageModule } from './modules/storage/storage.module';
import { GraphModule } from './modules/graph/graph.module';
import { BusinessModule } from './modules/business/business.module';
import { EnvironmentsModule } from './modules/environments/environments.module';
import { AgentsModule } from './modules/agents/agents.module';
import { TracesModule } from './modules/traces/traces.module';
import { HealthModule } from './modules/health/health.module';
import { HarnessModule } from './modules/harness/harness.module';
import { AutonomyModule } from './modules/autonomy/autonomy.module';
import { AutonomyLockdownGuard } from './modules/autonomy/autonomy.controller';
import { ChatModule } from './modules/chat/chat.module';
import { OnboardingModule } from './modules/onboarding/onboarding.module';
import { OutpostModule } from './modules/outpost/outpost.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    TypeOrmModule.forRoot(databaseConfig),
    BullModule.forRoot({
      redis: {
        host: process.env.REDIS_HOST || 'localhost',
        port: parseInt(process.env.REDIS_PORT || '6379', 10),
      },
    }),
    // Event emitter for SSE and real-time updates
    EventEmitterModule.forRoot({
      wildcard: true,
      delimiter: '.',
      maxListeners: 10,
    }),
    // Global rate limiting - prevents request flooding
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        throttlers: [
          {
            ttl: config.get<number>('RATE_LIMIT_TTL', 60) * 1000, // Convert to ms
            limit: config.get<number>('RATE_LIMIT_MAX', 100),
          },
        ],
      }),
    }),
    HealthModule,
    CommonModule,
    StorageModule,
    GraphModule,
    QaModule,
    HarnessModule,
    AutonomyModule,
    ChatModule,
    OnboardingModule,
    SourcesModule,
    DocumentsModule,
    ProcessingModule,
    RetrievalModule,
    BusinessModule,
    EnvironmentsModule,
    AgentsModule,
    TracesModule,
    OutpostModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: AutonomyLockdownGuard },
    // Global rate limiting guard
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
    // Global request timeout interceptor
    {
      provide: APP_INTERCEPTOR,
      useClass: TimeoutInterceptor,
    },
  ],
})
export class AppModule {}
