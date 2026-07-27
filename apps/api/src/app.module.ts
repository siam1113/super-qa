import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bull';
import { databaseConfig } from './config/database.config';
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
    StorageModule,
    GraphModule,
    QaModule,
    SourcesModule,
    DocumentsModule,
    ProcessingModule,
    RetrievalModule,
    BusinessModule,
    EnvironmentsModule,
    AgentsModule,
    TracesModule,
  ],
})
export class AppModule {}
