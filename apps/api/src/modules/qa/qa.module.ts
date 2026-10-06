import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { QaController } from './qa.controller';
import { QaService } from './qa.service';
import { QaGenerationProcessor } from './qa-generation.processor';
import { SourcesModule } from '../sources/sources.module';
import { BusinessModule } from '../business/business.module';
import { AgentsModule } from '../agents/agents.module';
import { TypeOrmModule } from '@nestjs/typeorm';
import { QaTestCase, QaRun, QaExecution, QaHealingSuggestion, QaExecutionPlan, QaGenerationRun } from './qa.entity';

@Module({
  imports: [
    SourcesModule,
    BusinessModule,
    AgentsModule,
    BullModule.registerQueue({ name: 'qa-generation' }),
    TypeOrmModule.forFeature([QaTestCase, QaRun, QaExecution, QaHealingSuggestion, QaExecutionPlan, QaGenerationRun]),
  ],
  controllers: [QaController],
  providers: [QaService, QaGenerationProcessor],
  exports: [QaService],
})
export class QaModule {}
