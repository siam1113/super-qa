import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager, In } from 'typeorm';
import { createHash, randomUUID } from 'crypto';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Source } from '../sources/entities/source.entity';
import { SyncJob, SYNC_STAGES, SyncStageName } from '../sources/entities/sync-job.entity';
import { ConnectorDocument } from '../sources/connectors/connector.interface';
import { Document } from '../documents/entities/document.entity';
import { Chunk } from '../documents/entities/chunk.entity';
import { BusinessItem, BusinessRelationship, RelationshipType } from '../business/entities/business-item.entity';
import { ExtractionResult } from '../business/business-extraction.service';
import { assertExtractionEvidence, EXTRACTION_VERSION } from '../business/grounded-extraction';
import { IndexedChunk, SyncWork } from './entities/sync-work.entity';
import { WorkerWakeupService } from '../../common/worker-wakeup.service';

export interface SyncRequest {
  mode?: 'full' | 'incremental' | 'selective';
  externalIds?: string[];
  forceReprocess?: boolean;
  forceExtract?: boolean;
  intents?: string[];
  documents?: ConnectorDocument[];
}

export class LeaseLostError extends Error {
  constructor() { super('Sync lease expired, superseded or cancelled'); }
}

const activeStatuses = ['queued', 'running'];
const leaseSeconds = 120;
const maxAttempts = 3;

function stableValue(value: any): any {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') {
    if (value instanceof Date) return value.toISOString();
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, stableValue(value[key])]));
  }
  return value;
}

export function revisionHash(document: ConnectorDocument): string {
  return createHash('sha256').update(JSON.stringify(stableValue({
    externalId: document.externalId, title: document.title, type: document.type,
    content: document.content, url: document.url || null, metadata: document.metadata || null,
    attachments: document.attachments?.map(({ name, url, mimeType }) => ({ name, url, mimeType })) || [],
  }))).digest('hex');
}

export function processingConfiguration(): string {
  return JSON.stringify({
    version: process.env.PIPELINE_PROCESSOR_VERSION || '1',
    extractionVersion: EXTRACTION_VERSION,
    embeddingProvider: process.env.EMBEDDING_PROVIDER || 'local',
    embeddingModel: process.env.EMBEDDING_MODEL || 'default',
    extractionProvider: process.env.EXTRACTION_PROVIDER || 'local',
    extractionModel: process.env.EXTRACTION_MODEL || 'default',
  });
}

@Injectable()
export class PipelineStore {
  constructor(
    @InjectDataSource() private readonly database: DataSource,
    private readonly events: EventEmitter2,
    private readonly wakeups: WorkerWakeupService,
  ) {}

  async start(sourceId: string, request: SyncRequest = {}, trigger: 'manual' | 'scheduled' | 'webhook' = 'manual'): Promise<SyncJob> {
    if (request.mode && !['full', 'incremental', 'selective'].includes(request.mode)) {
      throw new BadRequestException('Unsupported sync mode');
    }
    if (request.mode === 'selective' && (!Array.isArray(request.externalIds) || !request.externalIds.length || request.externalIds.some(id => typeof id !== 'string' || !id.trim()))) {
      throw new BadRequestException('Selective sync requires document IDs');
    }
    const job = await this.database.transaction(async manager => {
      const source = await manager.findOne(Source, { where: { id: sourceId }, lock: { mode: 'pessimistic_write' } });
      if (!source) throw new NotFoundException('Source not found');
      const existing = await manager.findOne(SyncJob, { where: { sourceId, status: In(activeStatuses) } });
      if (existing) throw new BadRequestException('Source already has an active sync');
      if (request.mode === 'incremental' && !request.forceExtract && !source.syncState?.lastSyncedAt) {
        throw new BadRequestException('Run a full sync before incremental sync');
      }
      // Incremental discovery deliberately omits unchanged documents. A force
      // extract must scan the full source to find those unchanged documents.
      const mode = request.forceExtract && request.mode === 'incremental' ? 'full' : request.mode || 'full';
      const normalizedRequest = {
        ...request,
        mode,
        forceReprocess: Boolean(request.forceReprocess),
        forceExtract: Boolean(request.forceExtract),
      };
      const job = manager.create(SyncJob, {
        sourceId, pipelineVersion: 1, request: normalizedRequest,
        status: 'queued', trigger, stages: SYNC_STAGES.map(name => ({ name, status: 'pending' as const })),
        metadata: {
          processingConfiguration: processingConfiguration(),
          syncMode: normalizedRequest.mode,
          forceReprocess: normalizedRequest.forceReprocess,
          forceExtract: normalizedRequest.forceExtract,
          selectedDocumentsCount: normalizedRequest.externalIds?.length,
        },
        logs: [],
      });
      source.status = 'syncing';
      source.errorMessage = null;
      await manager.save(Source, source);
      return manager.save(SyncJob, job);
    });
    // Wake this process after commit. Cross-process workers also recover through
    // the dispatcher's periodic scan, so Postgres notification triggers are optional.
    this.wakeups.wake('pipeline_work_available');
    return job;
  }

  async read(jobId: string): Promise<SyncJob> {
    const job = await this.database.getRepository(SyncJob).findOneBy({ id: jobId });
    if (!job) throw new NotFoundException('Sync job not found');
    return job;
  }

  async work(jobId: string): Promise<SyncWork[]> {
    return this.database.getRepository(SyncWork).find({ where: { syncJobId: jobId }, order: { externalId: 'ASC' } });
  }

  async addLog(jobId: string, level: SyncJob['logs'][number]['level'], message: string, stage?: SyncStageName): Promise<void> {
    const log = await this.locked(jobId, async (manager, job, source, now) => {
      const entry: SyncJob['logs'][number] = { timestamp: now.toISOString(), level, message, ...(stage ? { stage } : {}) };
      job.logs = [...(job.logs || []), entry].slice(-200);
      await manager.save(SyncJob, job);
      return { sourceId: source.id, entry };
    });
    this.events.emit('job.log', { jobId, sourceId: log.sourceId, log: log.entry });
  }

  private async locked<T>(jobId: string, operation: (manager: EntityManager, job: SyncJob, source: Source, now: Date) => Promise<T>): Promise<T> {
    const reference = await this.read(jobId);
    return this.database.transaction(async manager => {
      const source = await manager.findOne(Source, { where: { id: reference.sourceId }, lock: { mode: 'pessimistic_write' } });
      const job = await manager.findOne(SyncJob, { where: { id: jobId }, lock: { mode: 'pessimistic_write' } });
      if (!source || !job) throw new NotFoundException('Sync source or job no longer exists');
      const [{ now }] = await manager.query('SELECT clock_timestamp() AS now');
      return operation(manager, job, source, new Date(now));
    });
  }

  private assertLease(job: SyncJob, token: string, now: Date): void {
    if (!activeStatuses.includes(job.status) || job.leaseToken !== token || !job.leaseUntil || job.leaseUntil <= now) {
      throw new LeaseLostError();
    }
  }

  private stage(job: SyncJob, name: SyncStageName, status: 'running' | 'completed', now: Date, count?: number): void {
    const stage = job.stages.find(value => value.name === name)!;
    stage.startedAt ||= now;
    stage.status = status;
    if (status === 'completed') stage.completedAt = now;
    if (count !== undefined) stage.itemsProcessed = count;
    if (job.metadata?.documentsToProcess !== undefined && name !== 'pulling') stage.itemsTotal = job.metadata.documentsToProcess;
    job.currentStage = name;
  }

  private finishFailure(job: SyncJob, source: Source, message: string, now: Date): void {
    job.status = 'failed';
    job.errorMessage = message;
    job.completedAt = now;
    job.leaseToken = null;
    job.leaseUntil = null;
    for (const stage of job.stages) {
      if (stage.status === 'running') Object.assign(stage, { status: 'failed', completedAt: now, error: message });
      if (stage.status === 'pending') stage.status = 'skipped';
    }
    source.status = 'error';
    source.errorMessage = message;
  }

  async claim(): Promise<Array<{ jobId: string; token: string }>> {
    const candidates = await this.database.getRepository(SyncJob).createQueryBuilder('job')
      .where('job.pipelineVersion = 1 AND job.status IN (:...statuses)', { statuses: activeStatuses })
      .andWhere('(job.leaseUntil IS NULL OR job.leaseUntil <= clock_timestamp())')
      .andWhere('(job.nextAttemptAt IS NULL OR job.nextAttemptAt <= clock_timestamp())')
      .orderBy('job.createdAt', 'ASC').take(10).getMany();
    const deliveries: Array<{ jobId: string; token: string }> = [];
    for (const candidate of candidates) {
      const delivery = await this.locked(candidate.id, async (manager, job, source, now) => {
        if (!activeStatuses.includes(job.status) || (job.leaseUntil && job.leaseUntil > now) || (job.nextAttemptAt && job.nextAttemptAt > now)) return null;
        if (job.attempts >= maxAttempts) {
          this.finishFailure(job, source, 'Worker lease expired after maximum attempts', now);
          await manager.save(Source, source);
          await manager.save(SyncJob, job);
          return null;
        }
        job.leaseToken = randomUUID();
        job.leaseUntil = new Date(now.getTime() + leaseSeconds * 1000);
        await manager.save(SyncJob, job);
        return { jobId: job.id, token: job.leaseToken };
      });
      if (delivery) deliveries.push(delivery);
      else if ((await this.read(candidate.id)).status === 'failed') await this.emit(candidate.id);
    }
    return deliveries;
  }

  async begin(jobId: string, token: string): Promise<boolean> {
    return this.locked(jobId, async (manager, job, _source, now) => {
      this.assertLease(job, token, now);
      if (job.metadata?.activeToken === token) return false;
      job.status = 'running';
      job.startedAt ||= now;
      job.attempts++;
      job.metadata = { ...job.metadata, activeToken: token };
      if (!job.metadata.manifestReady) this.stage(job, 'pulling', 'running', now, 0);
      job.nextAttemptAt = null;
      await manager.save(SyncJob, job);
      return true;
    });
  }

  async renew(jobId: string, token: string): Promise<void> {
    await this.locked(jobId, async (manager, job, _source, now) => {
      this.assertLease(job, token, now);
      job.leaseUntil = new Date(now.getTime() + leaseSeconds * 1000);
      await manager.save(SyncJob, job);
    });
  }

  async saveManifest(jobId: string, token: string, documents: ConnectorDocument[]): Promise<void> {
    const types = new Set(['requirement', 'code', 'issue', 'pr', 'wiki', 'test_case', 'api_spec', 'comment', 'file']);
    if (documents.length > 10000 || Buffer.byteLength(JSON.stringify(documents), 'utf8') > 50 * 1024 * 1024) {
      throw new Error('Sync manifest exceeds the supported batch limit');
    }
    if (documents.some(document => typeof document.externalId !== 'string' || !document.externalId.trim() ||
      typeof document.title !== 'string' || typeof document.content !== 'string' || !types.has(document.type))) {
      throw new Error('Connector returned an invalid document');
    }
    await this.locked(jobId, async (manager, job, source, now) => {
      this.assertLease(job, token, now);
      if (job.metadata?.manifestReady) return;
      const unique = new Map(documents.map(document => [document.externalId, document]));
      let created = 0;
      let updated = 0;
      let skipped = 0;
      let forcedExtract = 0;
      for (const snapshot of unique.values()) {
        const existing = await manager.findOneBy(Document, { sourceId: source.id, externalId: snapshot.externalId });
        const hash = createHash('sha256').update(`${revisionHash(snapshot)}:${job.metadata?.processingConfiguration}`).digest('hex');
        const unchanged = existing?.processedHash === hash;
        if (!job.request?.forceReprocess && !job.request?.forceExtract && unchanged) { skipped++; continue; }
        const extractionOnly = Boolean(job.request?.forceExtract && !job.request?.forceReprocess && unchanged);
        if (extractionOnly) forcedExtract++;
        else if (existing) updated++;
        else created++;
        await manager.save(SyncWork, manager.create(SyncWork, {
          syncJobId: job.id, externalId: snapshot.externalId, documentId: existing?.id || randomUUID(), revisionHash: hash, snapshot,
          // A non-null empty chunk receipt lets the worker skip embeddings. Publication
          // recognizes this unchanged revision and leaves its persisted chunks intact.
          chunks: extractionOnly ? [] : null,
        }));
      }
      job.metadata = { ...job.metadata, manifestReady: true, documentsToProcess: created + updated + forcedExtract, documentsProcessed: 0,
        documentsExtracted: 0, documentsNew: created, documentsUpdated: updated, documentsForcedExtract: forcedExtract,
        documentsSkipped: skipped, documentsTotal: unique.size, forceExtract: Boolean(job.request?.forceExtract),
        discoveryWatermark: job.startedAt!.toISOString() };
      this.stage(job, 'pulling', 'completed', now, unique.size);
      this.stage(job, 'processing', 'completed', now, unique.size);
      this.stage(job, 'indexing', 'running', now, 0);
      await manager.save(SyncJob, job);
    });
    await this.emit(jobId);
  }

  async saveOutput(jobId: string, token: string, workId: string, output: { chunks: IndexedChunk[] } | { extraction: ExtractionResult }): Promise<void> {
    await this.locked(jobId, async (manager, job, _source, now) => {
      this.assertLease(job, token, now);
      const work = await manager.findOneBy(SyncWork, { id: workId, syncJobId: jobId });
      if (!work) throw new Error('Work is not in this sync manifest');
      const indexing = 'chunks' in output;
      if (indexing ? work.chunks !== null : work.extraction !== null) return;
      if (!indexing && work.chunks === null) throw new Error('Extraction requires indexing receipt');
      if ('extraction' in output) assertExtractionEvidence(output.extraction, {
        id: work.documentId, sourceId: job.sourceId, content: work.snapshot.content, revisionHash: work.revisionHash, type: work.snapshot.type, metadata: work.snapshot.metadata,
      });
      Object.assign(work, output);
      await manager.save(SyncWork, work);
      const counts = await manager.getRepository(SyncWork).createQueryBuilder('work')
        .select('COUNT(*)', 'total')
        .addSelect('COUNT(work.chunks)', 'indexed')
        .addSelect('COUNT(work.extraction)', 'extracted')
        .where('work.syncJobId = :jobId', { jobId }).getRawOne();
      const indexed = Number(counts.indexed);
      const extracted = Number(counts.extracted);
      const total = Number(counts.total);
      job.metadata = { ...job.metadata, documentsProcessed: indexed, documentsExtracted: extracted };
      this.stage(job, 'indexing', indexed === total ? 'completed' : 'running', now, indexed);
      if (indexed === total) this.stage(job, 'extracting', extracted === total ? 'completed' : 'running', now, extracted);
      await manager.save(SyncJob, job);
    });
    await this.emit(jobId);
  }

  async publish(jobId: string, token: string): Promise<void> {
    await this.locked(jobId, async (manager, job, source, now) => {
      this.assertLease(job, token, now);
      const rows = await manager.findBy(SyncWork, { syncJobId: jobId });
      if (!job.metadata?.manifestReady || rows.length !== job.metadata.documentsToProcess || rows.some(row => row.chunks === null || row.extraction === null)) {
        throw new Error('Cannot publish without all document receipts');
      }
      const savedItemIds = new Set<string>();
      let preservedReviewedItems = 0;
      let preservedManualItems = 0;
      let unresolvedRelationships = 0;
      for (const work of rows) {
        const snapshot = work.snapshot;
        assertExtractionEvidence(work.extraction!, {
          id: work.documentId, sourceId: source.id, content: snapshot.content, revisionHash: work.revisionHash, type: snapshot.type, metadata: snapshot.metadata,
        });
        const previousDocument = await manager.findOneBy(Document, { id: work.documentId });
        const preserveChunks = Boolean(job.request?.forceExtract && !job.request?.forceReprocess &&
          previousDocument?.processedHash === work.revisionHash);
        await manager.save(Document, manager.create(Document, {
          id: work.documentId, sourceId: source.id, externalId: work.externalId, type: snapshot.type, title: snapshot.title,
          content: snapshot.content, url: snapshot.url || null,
          metadata: snapshot.attachments?.length ? { ...snapshot.metadata,
            attachments: snapshot.attachments.map(({ name, url, mimeType }) => ({ name, url, mimeType })),
          } : snapshot.metadata || null,
          contentHash: createHash('sha256').update(snapshot.content).digest('hex'), processedHash: work.revisionHash,
        }));
        if (!preserveChunks) {
          await manager.delete(Chunk, { documentId: work.documentId });
          for (const chunk of work.chunks!) {
            await manager.save(Chunk, manager.create(Chunk, {
              documentId: work.documentId, chunkIndex: chunk.index, content: chunk.content, embedding: chunk.embedding,
              metadata: { syncJobId: job.id, revisionHash: work.revisionHash },
            }));
          }
        }
        const names = new Map<string, string[]>();
        const retainedIds = new Set<string>();
        for (const item of work.extraction!.items) {
          const existing = await manager.findOneBy(BusinessItem, { sourceId: source.id, documentId: work.documentId, type: item.type, name: item.name });
          if (existing && (existing.verificationStatus !== 'unverified' || !existing.tags.includes('auto-extracted'))) {
            if (existing.verificationStatus !== 'unverified') preservedReviewedItems++;
            else preservedManualItems++;
            if ((existing.verificationStatus !== 'unverified' || existing.metadata?.revisionHash) && existing.metadata?.revisionHash !== work.revisionHash) {
              existing.metadata = { ...existing.metadata, evidenceStatus: 'needs-review', currentRevisionHash: work.revisionHash };
              await manager.save(BusinessItem, existing);
            }
            retainedIds.add(existing.id);
            continue;
          }
          const saved = await manager.save(BusinessItem, manager.create(BusinessItem, {
            ...item, id: existing?.id, sourceId: source.id, documentId: work.documentId,
            metadata: { ...item.metadata, syncJobId: job.id, revisionHash: work.revisionHash },
          }));
          names.set(item.name, [...new Set([...(names.get(item.name) || []), saved.id])]);
          savedItemIds.add(saved.id);
          retainedIds.add(saved.id);
        }
        const previousItems = await manager.findBy(BusinessItem, { sourceId: source.id, documentId: work.documentId });
        for (const previous of previousItems) {
          if (retainedIds.has(previous.id)) continue;
          if (previous.verificationStatus === 'unverified' && previous.tags.includes('auto-extracted')) {
            await manager.delete(BusinessItem, previous.id);
          } else if (previous.verificationStatus !== 'unverified' && previous.metadata?.revisionHash !== work.revisionHash) {
            previous.metadata = { ...previous.metadata, evidenceStatus: 'needs-review', currentRevisionHash: work.revisionHash };
            await manager.save(BusinessItem, previous);
          }
        }
        for (const relationship of work.extraction!.relationships) {
          const from = names.get(relationship.fromName);
          const to = names.get(relationship.toName);
          if (from?.length !== 1 || to?.length !== 1) { unresolvedRelationships++; continue; }
          const value = { fromItemId: from[0], toItemId: to[0], type: relationship.type as RelationshipType };
          if (!await manager.findOneBy(BusinessRelationship, value)) await manager.save(BusinessRelationship, manager.create(BusinessRelationship, value));
        }
      }
      for (const name of SYNC_STAGES.slice(2)) this.stage(job, name, 'completed', now, rows.length);
      job.status = 'completed';
      job.completedAt = now;
      job.currentStage = null;
      job.leaseToken = null;
      job.leaseUntil = null;
      job.errorMessage = null;
      const reports = rows.map(row => row.extraction?.report);
      const extractionSummary = {
        version: EXTRACTION_VERSION,
        provider: reports[0]?.provider || 'unknown',
        candidates: reports.reduce((total, report) => total + (report?.candidates || 0), 0),
        accepted: reports.reduce((total, report) => total + (report?.accepted || 0), 0),
        rejected: reports.reduce((total, report) => total + (report?.rejected || 0), 0),
        excludedLines: reports.reduce((total, report) => total + (report?.excludedLines || 0), 0),
        providerCalls: reports.reduce((total, report) => total + (report?.providerCalls || 0), 0),
        inputTokens: reports.reduce((total, report) => total + (report?.inputTokens || 0), 0),
        outputTokens: reports.reduce((total, report) => total + (report?.outputTokens || 0), 0),
        usageComplete: reports.every(report => report?.usageComplete === true),
      };
      job.metadata = { ...job.metadata, businessItemsExtracted: savedItemIds.size, preservedReviewedItems, preservedManualItems, unresolvedRelationships, extractionSummary };
      job.stats = { documentsTotal: job.metadata.documentsTotal, documentsNew: job.metadata.documentsNew,
        documentsUpdated: job.metadata.documentsUpdated, documentsDeleted: 0, businessItemsExtracted: savedItemIds.size };
      source.status = 'connected';
      source.lastSync = now;
      source.errorMessage = null;
      source.itemsCount = await manager.countBy(Document, { sourceId: source.id });
      if (job.request?.mode !== 'selective' && !job.request?.documents) {
        source.syncState = { ...source.syncState, lastSyncedAt: new Date(job.metadata.discoveryWatermark), lastCursor: undefined };
      }
      await manager.save(Source, source);
      await manager.save(SyncJob, job);
    });
    await this.emit(jobId, 'job.complete');
  }

  async retry(jobId: string, token: string, error: Error): Promise<void> {
    const log = await this.locked(jobId, async (manager, job, source, now) => {
      this.assertLease(job, token, now);
      job.errorMessage = error.message;
      const entry: SyncJob['logs'][number] = { timestamp: now.toISOString(), level: 'error', stage: job.currentStage || undefined, message: `Attempt ${job.attempts}: ${error.message}` };
      job.logs = [...job.logs, entry].slice(-200) as SyncJob['logs'];
      job.leaseToken = null;
      job.leaseUntil = null;
      job.nextAttemptAt = new Date(now.getTime() + 1000 * 2 ** job.attempts);
      if (job.attempts >= maxAttempts) this.finishFailure(job, source, error.message, now);
      await manager.save(Source, source);
      await manager.save(SyncJob, job);
      return { sourceId: source.id, entry };
    });
    this.events.emit('job.log', { jobId, sourceId: log.sourceId, log: log.entry });
    await this.emit(jobId);
  }

  async cancel(jobId: string): Promise<SyncJob> {
    const result = await this.locked(jobId, async (manager, job, source, now) => {
      if (!activeStatuses.includes(job.status)) throw new BadRequestException('Can only cancel an active sync');
      job.status = 'cancelled';
      job.completedAt = now;
      job.leaseToken = null;
      job.leaseUntil = null;
      for (const stage of job.stages) if (stage.status !== 'completed') stage.status = 'skipped';
      source.status = source.lastSync ? 'connected' : 'disconnected';
      source.errorMessage = null;
      await manager.save(Source, source);
      return manager.save(SyncJob, job);
    });
    await this.emit(jobId, 'job.cancel');
    return result;
  }

  private async emit(jobId: string, event = 'job.progress'): Promise<void> {
    const job = await this.read(jobId);
    this.events.emit(event, { jobId, sourceId: job.sourceId, data: {
      status: job.status, currentStage: job.currentStage, stages: job.stages, stats: job.stats,
      errorMessage: job.errorMessage, completedAt: job.completedAt,
    } });
  }
}
