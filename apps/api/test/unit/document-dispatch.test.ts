import { DocumentsService } from '../../src/modules/documents/documents.service';
import { Logger } from '@nestjs/common';

describe('Document dispatch boundaries', () => {
  const document = { externalId: 'issue-1', type: 'issue' as const, title: 'Login', content: 'Login requires a password' };
  let repository: any;
  let queue: any;
  let service: DocumentsService;

  beforeEach(() => {
    Logger.overrideLogger(false);
    const query: any = {};
    for (const method of ['leftJoin', 'where', 'andWhere', 'select']) {
      query[method] = jest.fn().mockReturnValue(query);
    }
    query.getMany = jest.fn().mockResolvedValue([{ id: 'document-1' }, { id: 'unrelated-document' }]);
    repository = {
      createQueryBuilder: jest.fn().mockReturnValue(query),
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn((value) => value),
      save: jest.fn(async (value) => ({ ...value, id: 'document-1' })),
      find: jest.fn().mockResolvedValue([{ id: 'document-1', sourceId: 'source-1' }]),
    };
    queue = { add: jest.fn().mockResolvedValue({}) };
    service = new DocumentsService(repository, { delete: jest.fn() } as any, queue,
      { syncDocument: jest.fn() } as any, {} as any);
  });

  it('stores a sync batch without dispatching workers before metadata exists', async () => {
    const result = await service.upsertDocuments('source-1', [document], undefined, false, { deferQueue: true });
    expect(queue.add).not.toHaveBeenCalled();
    expect(result.documentIds).toEqual(['document-1']);
    expect(result.queued).toBe(0);
  });

  it('preserves immediate dispatch for webhook callers', async () => {
    const result = await service.upsertDocuments('source-1', [document]);
    expect(queue.add).toHaveBeenCalledTimes(1);
    expect(result.queued).toBe(1);
  });

  it('queues only the explicit manifest and deduplicates document IDs', async () => {
    const count = await service.queueDocumentsForProcessing('source-1', 'job-1', ['document-1', 'document-1']);
    expect(count).toBe(1);
    expect(queue.add).toHaveBeenCalledWith('process-document', {
      documentId: 'document-1', syncJobId: 'job-1',
    }, { jobId: 'sync-job-1-document-document-1' });
  });

  it('rejects a manifest containing missing or foreign-source documents', async () => {
    repository.find.mockResolvedValue([]);
    await expect(service.queueDocumentsForProcessing('source-1', 'job-1', ['foreign']))
      .rejects.toThrow('manifest');
    expect(queue.add).not.toHaveBeenCalled();
  });
});
