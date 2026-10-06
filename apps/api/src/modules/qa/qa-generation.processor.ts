import { Process, Processor } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { Job } from 'bull';
import { QaService } from './qa.service';

interface GenerationJobData {
  runId: string;
}

@Processor('qa-generation')
export class QaGenerationProcessor {
  private readonly logger = new Logger(QaGenerationProcessor.name);

  constructor(private readonly qaService: QaService) {}

  @Process('generate')
  async handleGenerate(job: Job<GenerationJobData>) {
    this.logger.log(`Running generation job: ${job.data.runId}`);
    await this.qaService.runGenerationJob(job.data.runId);
  }

  @Process('refine')
  async handleRefine(job: Job<GenerationJobData>) {
    this.logger.log(`Running refinement job: ${job.data.runId}`);
    await this.qaService.runRefinementJob(job.data.runId);
  }
}
