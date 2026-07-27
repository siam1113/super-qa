import {
  Controller,
  Get,
  Delete,
  Param,
  Query,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import { StorageService } from '../storage/storage.service';

interface TraceData {
  traceId: string;
  runId: string;
  testId: string;
  testName: string;
  environment: string;
  browser: string;
  status: string;
  startedAt: string;
  completedAt: string;
  durationMs: number;
  steps: any[];
  stepCount: number;
  passedSteps: number;
  failedSteps: number;
  screenshotCount: number;
  consoleLogCount: number;
  networkRequestCount: number;
  metadata: Record<string, any>;
}

interface TraceSummary {
  key: string;
  traceId: string;
  testId: string;
  status: string;
  durationMs: number;
  timestamp: string;
}

@Controller('traces')
export class TracesController {
  private readonly logger = new Logger(TracesController.name);

  constructor(private readonly storageService: StorageService) {}

  /**
   * Get a trace by ID.
   * Searches for the trace file in storage.
   */
  @Get(':traceId')
  async getTrace(@Param('traceId') traceId: string): Promise<TraceData> {
    // Search for trace file in storage
    const files = await this.storageService.listFiles(`traces/`, 1000);

    // Find file that contains the traceId
    const traceFile = files.find((f) => f.key.includes(traceId));

    if (!traceFile) {
      throw new NotFoundException(`Trace not found: ${traceId}`);
    }

    // Download and parse the trace
    const buffer = await this.storageService.downloadBuffer(traceFile.key);
    const content = buffer.toString('utf-8');

    try {
      return JSON.parse(content);
    } catch {
      throw new NotFoundException(`Invalid trace data: ${traceId}`);
    }
  }

  /**
   * List traces for a specific test.
   */
  @Get('test/:testId')
  async getTracesByTest(
    @Param('testId') testId: string,
    @Query('limit') limit?: string,
  ): Promise<{ traces: TraceSummary[]; count: number }> {
    const maxKeys = limit ? parseInt(limit, 10) : 50;
    const files = await this.storageService.listFiles(`traces/${testId}/`, maxKeys);

    const traces: TraceSummary[] = [];

    for (const file of files.slice(0, maxKeys)) {
      try {
        const buffer = await this.storageService.downloadBuffer(file.key);
        const data = JSON.parse(buffer.toString('utf-8'));

        traces.push({
          key: file.key,
          traceId: data.traceId || this.extractTraceId(file.key),
          testId: data.testId || testId,
          status: data.status || 'unknown',
          durationMs: data.durationMs || 0,
          timestamp: data.startedAt || file.lastModified.toISOString(),
        });
      } catch {
        // Skip invalid trace files
        this.logger.warn(`Could not parse trace file: ${file.key}`);
      }
    }

    // Sort by timestamp descending (newest first)
    traces.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

    return { traces, count: traces.length };
  }

  /**
   * List traces for a specific run.
   */
  @Get('run/:runId')
  async getTracesByRun(
    @Param('runId') runId: string,
    @Query('limit') limit?: string,
  ): Promise<{ traces: TraceSummary[]; count: number }> {
    const maxKeys = limit ? parseInt(limit, 10) : 100;
    const files = await this.storageService.listFiles(`traces/`, maxKeys * 2);

    const traces: TraceSummary[] = [];

    for (const file of files) {
      // Check if file contains run ID
      if (!file.key.includes(runId)) continue;

      try {
        const buffer = await this.storageService.downloadBuffer(file.key);
        const data = JSON.parse(buffer.toString('utf-8'));

        if (data.runId === runId) {
          traces.push({
            key: file.key,
            traceId: data.traceId || this.extractTraceId(file.key),
            testId: data.testId || 'unknown',
            status: data.status || 'unknown',
            durationMs: data.durationMs || 0,
            timestamp: data.startedAt || file.lastModified.toISOString(),
          });
        }
      } catch {
        // Skip invalid trace files
      }

      if (traces.length >= parseInt(limit || '100', 10)) break;
    }

    return { traces, count: traces.length };
  }

  /**
   * Get screenshots for a trace.
   */
  @Get(':traceId/screenshots')
  async getTraceScreenshots(
    @Param('traceId') traceId: string,
  ): Promise<{ screenshots: Array<{ key: string; url: string; type: string }> }> {
    // First find the trace to get the test ID
    const trace = await this.getTrace(traceId);

    // List screenshots for this test
    const files = await this.storageService.listFiles(
      `screenshots/${trace.testId}/`,
      100,
    );

    const endpoint = process.env.S3_ENDPOINT || 'http://localhost:9000';
    const bucket = process.env.S3_BUCKET || 'qa-agent-files';

    const screenshots = files.map((f) => ({
      key: f.key,
      url: `${endpoint}/${bucket}/${f.key}`,
      type: f.key.includes('_before_') ? 'before' : f.key.includes('_after_') ? 'after' : 'unknown',
    }));

    return { screenshots };
  }

  /**
   * Get console logs for a trace.
   */
  @Get(':traceId/logs')
  async getTraceLogs(@Param('traceId') traceId: string): Promise<{
    consoleLogs: any[];
    networkRequests: any[];
  }> {
    const trace = await this.getTrace(traceId);

    const consoleLogs: any[] = [];
    const networkRequests: any[] = [];

    // Extract logs from trace data
    if (trace.steps) {
      for (const step of trace.steps) {
        if (step.actions) {
          for (const action of step.actions) {
            if (action.consoleLogs) {
              consoleLogs.push(...action.consoleLogs);
            }
            if (action.networkRequests) {
              networkRequests.push(...action.networkRequests);
            }
          }
        }
      }
    }

    return { consoleLogs, networkRequests };
  }

  /**
   * Delete a trace and its associated artifacts.
   */
  @Delete(':traceId')
  async deleteTrace(
    @Param('traceId') traceId: string,
  ): Promise<{ success: boolean; deletedFiles: number }> {
    // Find the trace first
    const trace = await this.getTrace(traceId);
    let deletedFiles = 0;

    // Delete trace file
    const traceFiles = await this.storageService.listFiles(`traces/`, 1000);
    for (const file of traceFiles) {
      if (file.key.includes(traceId)) {
        await this.storageService.deleteFile(file.key);
        deletedFiles++;
      }
    }

    // Delete associated screenshots
    const screenshotFiles = await this.storageService.listFiles(
      `screenshots/${trace.testId}/`,
      1000,
    );
    for (const file of screenshotFiles) {
      // Only delete screenshots associated with this trace
      await this.storageService.deleteFile(file.key);
      deletedFiles++;
    }

    this.logger.log(`Deleted trace ${traceId} and ${deletedFiles} associated files`);

    return { success: true, deletedFiles };
  }

  /**
   * Get trace statistics.
   */
  @Get()
  async getTraceStats(): Promise<{
    totalTraces: number;
    totalScreenshots: number;
    totalLogs: number;
    storageUsed: { traces: number; screenshots: number; logs: number };
  }> {
    const traceFiles = await this.storageService.listFiles('traces/', 10000);
    const screenshotFiles = await this.storageService.listFiles('screenshots/', 10000);
    const logFiles = await this.storageService.listFiles('logs/', 10000);

    return {
      totalTraces: traceFiles.length,
      totalScreenshots: screenshotFiles.length,
      totalLogs: logFiles.length,
      storageUsed: {
        traces: traceFiles.reduce((sum, f) => sum + f.size, 0),
        screenshots: screenshotFiles.reduce((sum, f) => sum + f.size, 0),
        logs: logFiles.reduce((sum, f) => sum + f.size, 0),
      },
    };
  }

  /**
   * Extract trace ID from file key.
   */
  private extractTraceId(key: string): string {
    // Expected format: traces/{testId}/{runId}_{timestamp}.json
    const filename = key.split('/').pop() || '';
    const match = filename.match(/^([^_]+)/);
    return match ? match[1] : filename;
  }
}
