import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';
import { ProcessingModule } from '../processing/processing.module';
import { AutonomyModule } from '../autonomy/autonomy.module';

@Module({
  imports: [
    BullModule.registerQueue({
      name: 'document-processing',
    }),
    ProcessingModule,
    AutonomyModule,
  ],
  controllers: [HealthController],
  providers: [HealthService],
})
export class HealthModule {}
