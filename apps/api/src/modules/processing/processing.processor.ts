import { Process, Processor } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { Job } from 'bull';
import { ProcessingService } from './processing.service';

interface ProcessDocumentData {
  documentId: string;
}

@Processor('processing')
export class ProcessingProcessor {
  private readonly logger = new Logger(ProcessingProcessor.name);

  constructor(private processingService: ProcessingService) {}

  @Process('process-document')
  async handleProcessDocument(job: Job<ProcessDocumentData>) {
    const { documentId } = job.data;
    this.logger.log(`Processing document job: ${documentId}`);

    try {
      await this.processingService.processDocument(documentId);
      this.logger.log(`Completed processing document: ${documentId}`);
    } catch (error) {
      this.logger.error(`Failed to process document ${documentId}: ${error.message}`);
      throw error;
    }
  }
}
