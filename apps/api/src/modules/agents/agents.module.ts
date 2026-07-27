import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AgentsController } from './agents.controller';
import { AgentsService } from './agents.service';
import { AgentSession } from './entities/agent-session.entity';
import { AgentTask } from './entities/agent-task.entity';

@Module({
  imports: [TypeOrmModule.forFeature([AgentSession, AgentTask])],
  controllers: [AgentsController],
  providers: [AgentsService],
  exports: [AgentsService],
})
export class AgentsModule {}
