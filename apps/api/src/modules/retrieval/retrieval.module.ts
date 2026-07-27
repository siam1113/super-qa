import { Module } from '@nestjs/common';
import { RetrievalController } from './retrieval.controller';
import { RetrievalService } from './retrieval.service';
import { ProcessingModule } from '../processing/processing.module';
import { DocumentsModule } from '../documents/documents.module';

@Module({
  imports: [ProcessingModule, DocumentsModule],
  controllers: [RetrievalController],
  providers: [RetrievalService],
  exports: [RetrievalService],
})
export class RetrievalModule {}
