import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bull';
import { BusinessModule } from '../business/business.module';
import { Source } from '../sources/entities/source.entity';
import { SyncJob } from '../sources/entities/sync-job.entity';
import { SyncWork } from './entities/sync-work.entity';
import { PipelineService } from './pipeline.service';
import { PipelineStore } from './pipeline.store';
import { ChunkingService } from '../processing/chunking.service';
import { EmbeddingService } from '../processing/embedding.service';

@Module({
  imports: [TypeOrmModule.forFeature([Source, SyncJob, SyncWork]), BullModule.registerQueue({ name: 'pipeline' }), BusinessModule],
  providers: [PipelineStore, PipelineService, ChunkingService, EmbeddingService],
  exports: [PipelineStore],
})
export class PipelineModule {}
