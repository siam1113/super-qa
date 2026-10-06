import { Logger } from '@nestjs/common';
import { SyncProcessor } from '../../src/modules/sources/sync.processor';
import { DocumentsService } from '../../src/modules/documents/documents.service';
import { GitHubConnector } from '../../src/modules/sources/connectors/github.connector';

describe('Sync processor dispatch contract', () => {
  let sources: any;
  let processor: SyncProcessor;
  let queue: any;
  let metadata: any;
  let fetchDocuments: jest.SpyInstance;

  beforeEach(() => {
    Logger.overrideLogger(false);
    metadata = undefined;
    const records: any[] = [];
    const repository: any = {
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn((value) => value),
      save: jest.fn(async (value) => {
        const saved = { ...value, id: `document-${records.length + 1}` };
        records.push(saved);
        return saved;
      }),
      find: jest.fn(async () => records),
    };
    queue = { add: jest.fn(async (_name, data) => {
      expect(metadata.documentIds).toContain(data.documentId);
      expect(data.syncJobId).toBe('job');
    }) };
    const documents = new DocumentsService(repository, { delete: jest.fn() } as any,
      queue, { syncDocument: jest.fn() } as any, {} as any);
    sources = {};
    for (const method of ['addLog', 'initializeJobStages', 'startStage', 'completeStage', 'updateStageProgress', 'updateSourceAfterSync', 'completeJob', 'failStage', 'updateSyncJob']) {
      sources[method] = jest.fn().mockResolvedValue(undefined);
    }
    sources.getSyncJob = jest.fn().mockResolvedValue({ stages: [] });
    sources.setMetadataAndCompleteStage = jest.fn(async (_id, value) => { metadata = value; });
    processor = new SyncProcessor({ findOne: jest.fn().mockResolvedValue({
      id: 'source', type: 'github', config: {}, itemsCount: 0,
      syncState: { lastSyncedAt: '2026-09-01T00:00:00Z' },
    }) } as any, sources, documents, new GitHubConnector(), {} as any, {} as any);
    fetchDocuments = jest.spyOn(GitHubConnector.prototype, 'fetchDocuments').mockResolvedValue({
      documents: [{ externalId: 'issue-1', type: 'issue', title: 'Login', content: 'Password required' }],
      hasMore: false,
    });
  });

  afterEach(() => jest.restoreAllMocks());

  it('stores metadata before dispatch and waits for downstream completion', async () => {
    await processor.handleSync({ data: { sourceId: 'source', syncJobId: 'job', mode: 'full' } } as any);
    expect(queue.add).toHaveBeenCalledTimes(1);
    expect(metadata.documentsToProcess).toBe(1);
    expect(sources.completeJob).not.toHaveBeenCalled();
  });

  it('honors incremental mode even when the legacy boolean is absent', async () => {
    await processor.handleSync({ data: { sourceId: 'source', syncJobId: 'job', mode: 'incremental' } } as any);
    expect(fetchDocuments).toHaveBeenCalledWith({}, expect.objectContaining({
      incremental: true, since: new Date('2026-09-01T00:00:00Z'),
    }));
  });

  it('finishes an empty batch without dispatch', async () => {
    fetchDocuments.mockResolvedValue({ documents: [], hasMore: false });
    await processor.handleSync({ data: { sourceId: 'source', syncJobId: 'job', mode: 'full' } } as any);
    expect(queue.add).not.toHaveBeenCalled();
    expect(sources.completeJob).toHaveBeenCalledTimes(1);
  });
});
