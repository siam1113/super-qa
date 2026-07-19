import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MongoDbModule } from './database/mongodb.module';
import { WorkspaceModule } from './modules/workspace/workspace.module';
import { QaModule } from './modules/qa/qa.module';
import { AgentsModule } from './modules/agents/agents.module';
import { IntegrationsModule } from './modules/integrations/integrations.module';
@Module({ imports: [ConfigModule.forRoot({ isGlobal: true }), MongoDbModule, WorkspaceModule, QaModule, AgentsModule, IntegrationsModule] })
export class AppModule {}
