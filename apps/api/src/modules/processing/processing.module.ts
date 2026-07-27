import { Module, forwardRef } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { ChunkingService } from './chunking.service';
import { EmbeddingService } from './embedding.service';
import { ProcessingService } from './processing.service';
import { ProcessingProcessor } from './processing.processor';
import { DocumentsModule } from '../documents/documents.module';
import { BusinessModule } from '../business/business.module';

@Module({
  imports: [
    BullModule.registerQueue({
      name: 'processing',
    }),
    forwardRef(() => DocumentsModule),
    forwardRef(() => BusinessModule),
  ],
  providers: [
    ChunkingService,
    EmbeddingService,
    ProcessingService,
    ProcessingProcessor,
  ],
  exports: [ChunkingService, EmbeddingService, ProcessingService],
})
export class ProcessingModule {}
