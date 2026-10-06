import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { HarnessRun } from './harness.entity';
import { HarnessService } from './harness.service';
import { HarnessController, HarnessWorkerController, HarnessOperatorGuard, HarnessWorkerGuard } from './harness.controller';
import { HarnessExecution } from './execution.entity';
import { HarnessExecutionService } from './execution.service';
import { HarnessExecutionController, HarnessExecutorController, HarnessExecutorGuard } from './execution.controller';

@Module({ imports: [TypeOrmModule.forFeature([HarnessRun, HarnessExecution])], controllers: [HarnessController, HarnessWorkerController, HarnessExecutionController, HarnessExecutorController],
  providers: [HarnessService, HarnessOperatorGuard, HarnessWorkerGuard, HarnessExecutionService, HarnessExecutorGuard], exports: [HarnessService, HarnessExecutionService] })
export class HarnessModule {}
