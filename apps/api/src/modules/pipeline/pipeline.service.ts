import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { InjectQueue, Process, Processor } from '@nestjs/bull';
import { InjectRepository } from '@nestjs/typeorm';
import { Job, Queue } from 'bull';
import { Repository } from 'typeorm';
import { PipelineStore, LeaseLostError, SyncRequest, processingConfiguration } from './pipeline.store';
import { Source } from '../sources/entities/source.entity';
import { GitHubConnector } from '../sources/connectors/github.connector';
import { JiraConnector } from '../sources/connectors/jira.connector';
import { ConfluenceConnector } from '../sources/connectors/confluence.connector';
import { UploadConnector } from '../sources/connectors/upload.connector';
import { ConnectorDocument, ISourceConnector } from '../sources/connectors/connector.interface';
import { ChunkingService } from '../processing/chunking.service';
import { EmbeddingService } from '../processing/embedding.service';
import { BusinessExtractionService } from '../business/business-extraction.service';
import { WorkerWakeupService } from '../../common/worker-wakeup.service';
import { StorageService } from '../storage/storage.service';

export interface PipelineDelivery { jobId: string; token: string }

async function bounded<T>(operation: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  try {
    return await Promise.race([operation, new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error('Pipeline operation exceeded 90 seconds')), 90000);
    })]);
  } finally {
    clearTimeout(timer!);
  }
}

@Injectable()
@Processor('pipeline')
export class PipelineService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PipelineService.name);
  private dispatching = false;
  private stopped = false;
  private readonly connectors: Map<string, ISourceConnector>;

  constructor(
    private readonly store: PipelineStore,
    @InjectQueue('pipeline') private readonly queue: Queue,
    @InjectRepository(Source) private readonly sources: Repository<Source>,
    private readonly chunking: ChunkingService,
    private readonly embeddings: EmbeddingService,
    private readonly extraction: BusinessExtractionService,
    private readonly wakeups: WorkerWakeupService,
    private readonly storage: StorageService,
  ) {
    this.connectors = new Map<string, ISourceConnector>([
      ['github', new GitHubConnector()], ['jira', new JiraConnector()], ['confluence', new ConfluenceConnector()],
      ['upload', new UploadConnector(this.storage)],
    ]);
  }

  onModuleInit(): void {
    void this.dispatchLoop();
  }

  onModuleDestroy(): void { this.stopped = true; this.wakeups.wake('pipeline_work_available'); }

  private async dispatchLoop() {
    while (!this.stopped) {
      const waitController = new AbortController();
      // LISTEN/NOTIFY is a fast path, not a correctness dependency: migrations or
      // notifications can be unavailable, so periodically reconcile queued rows.
      const nextWake = this.wakeups.wait('pipeline_work_available', 5000, waitController.signal);
      const filledBatch = await this.dispatch();
      if (filledBatch && !this.stopped) { waitController.abort(); continue; }
      if (!this.stopped) await nextWake;
      else waitController.abort();
    }
  }

  async dispatch(): Promise<boolean> {
    if (this.dispatching) return false;
    this.dispatching = true;
    try {
      const deliveries = await this.store.claim();
      for (const delivery of deliveries) {
        await this.queue.add('run-sync', delivery, { jobId: delivery.token, removeOnComplete: true, removeOnFail: true });
      }
      return deliveries.length === 10;
    } catch (error) {
      this.logger.error(`Pipeline dispatch will retry: ${error.message}`);
      return false;
    } finally {
      this.dispatching = false;
    }
  }

  @Process({ name: 'run-sync', concurrency: 2 })
  async execute(delivery: Job<PipelineDelivery>): Promise<void> {
    const { jobId, token } = delivery.data;
    let heartbeat: ReturnType<typeof setInterval> | undefined;
    let leaseLost = false;
    try {
      if (!await this.store.begin(jobId, token)) return;
      heartbeat = setInterval(() => {
        void this.store.renew(jobId, token).catch(() => { leaseLost = true; });
      }, 30000);
      heartbeat.unref();
      const job = await this.store.read(jobId);
      if (job.metadata?.processingConfiguration !== processingConfiguration()) {
        throw new Error('Pipeline configuration changed; cancel this sync and start a new one');
      }
      await this.store.addLog(jobId, 'info', `Worker started attempt ${job.attempts} (${job.request?.mode || 'full'}${job.request?.forceExtract ? ', force extract' : ''}).`, 'pulling');
      const source = await this.sources.findOneByOrFail({ id: job.sourceId });
      if (!job.metadata?.manifestReady) {
        await this.store.addLog(jobId, 'info', job.request?.forceExtract
          ? 'Scanning the full source for unchanged documents to re-extract.'
          : 'Discovering source documents.', 'pulling');
        const documents = await this.discover(source, job.request || {}, async () => {
          if (leaseLost) throw new LeaseLostError();
          await this.store.renew(jobId, token);
        });
        await this.store.addLog(jobId, 'info', `Source discovery returned ${documents.length} documents.`, 'pulling');
        await this.store.saveManifest(jobId, token, documents);
      }
      const rows = await this.store.work(jobId);
      const manifest = await this.store.read(jobId);
      await this.store.addLog(jobId, 'info', `Manifest ready: ${rows.length} documents queued for extraction; ${manifest.metadata?.documentsForcedExtract || 0} unchanged documents selected for force extract.`, 'indexing');
      await this.store.addLog(jobId, 'info', `Preparing embeddings for ${rows.filter(work => work.chunks === null).length} documents.`, 'indexing');
      for (const work of rows) {
        if (leaseLost) throw new LeaseLostError();
        await this.store.renew(jobId, token);
        if (work.chunks !== null) continue;
        const chunks = work.snapshot.type === 'code' ? this.chunking.chunkCode(work.snapshot.content) : this.chunking.chunk(work.snapshot.content);
        const vectors: number[][] = [];
        for (let offset = 0; offset < chunks.length; offset += 64) {
          await this.store.renew(jobId, token);
          const batch = chunks.slice(offset, offset + 64);
          const result = await bounded(this.embeddings.embed(batch.map(chunk => chunk.content)));
          if (result.length !== batch.length || result.some(vector => vector.length !== this.embeddings.getDimension() || vector.some(value => !Number.isFinite(value)) || !vector.some(value => value !== 0))) {
            throw new Error('Embedding provider returned invalid vectors');
          }
          vectors.push(...result);
        }
        await this.store.saveOutput(jobId, token, work.id, { chunks: chunks.map((chunk, index) => ({
          content: chunk.content, index: chunk.index, embedding: vectors[index],
        })) });
      }
      await this.store.addLog(jobId, 'info', 'Indexing stage finished; context extraction is starting.', 'extracting');
      for (const [index, work] of rows.entries()) {
        if (leaseLost) throw new LeaseLostError();
        await this.store.renew(jobId, token);
        if (work.extraction !== null) continue;
        await this.store.addLog(jobId, 'info', `Extracting document ${index + 1} of ${rows.length}${job.request?.forceExtract ? ' (force extract)' : ''}.`, 'extracting');
        const result = await bounded(this.extraction.extractFromDocument({
          ...work.snapshot, id: work.documentId, sourceId: source.id, revisionHash: work.revisionHash,
        }, Boolean(job.request?.forceExtract)));
        if (!result || !Array.isArray(result.items) || !Array.isArray(result.relationships)) throw new Error('Invalid extraction result');
        await this.store.addLog(jobId, 'info', `Document ${index + 1}: ${result.report?.candidates ?? result.items.length} candidates, ${result.items.length} accepted.`, 'extracting');
        await this.store.saveOutput(jobId, token, work.id, { extraction: result });
      }
      await this.store.publish(jobId, token);
      await this.store.addLog(jobId, 'info', 'Sync completed and extracted context was published.', 'populating');
    } catch (error) {
      if (!(error instanceof LeaseLostError)) {
        try { await this.store.retry(jobId, token, error); }
        catch (retryError) { if (!(retryError instanceof LeaseLostError)) throw retryError; }
      }
    } finally {
      if (heartbeat) clearInterval(heartbeat);
    }
  }

  private async discover(source: Source, request: SyncRequest, checkLease: () => Promise<void>): Promise<ConnectorDocument[]> {
    if (request.documents) return request.documents;
    const connector = this.connectors.get(source.type);
    if (!connector) throw new Error(`Unsupported connector: ${source.type}`);
    const selected = request.mode === 'selective' ? new Set(request.externalIds) : null;
    const documents = new Map<string, ConnectorDocument>();
    const seenCursors = new Set<string>();
    let pages = 0;
    let contentBytes = 0;
    let cursor: string | undefined;
    do {
      await checkLease();
      const page = await bounded(connector.fetchDocuments(source.config, {
        cursor, incremental: request.mode === 'incremental',
        since: request.mode === 'incremental' && source.syncState?.lastSyncedAt ? new Date(source.syncState.lastSyncedAt) : undefined,
      }));
      pages++;
      for (const document of page.documents) {
        contentBytes += Buffer.byteLength(document.content, 'utf8');
        if (!selected || selected.has(document.externalId)) documents.set(document.externalId, document);
      }
      if (pages > 1000 || documents.size > 10000 || contentBytes > 50 * 1024 * 1024) {
        throw new Error('Sync discovery exceeded the batch limit; narrow the source scope');
      }
      if (selected && [...selected].every(id => documents.has(id))) break;
      if (!page.hasMore) break;
      if (!page.cursor || seenCursors.has(page.cursor)) throw new Error('Connector pagination did not advance');
      seenCursors.add(page.cursor);
      cursor = page.cursor;
    } while (cursor);
    if (selected && [...selected].some(id => !documents.has(id))) throw new Error('Some selected documents were not returned by the source');
    return [...documents.values()];
  }
}
