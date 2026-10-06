import { SourcesService } from '../../src/modules/sources/sources.service';

describe('sync progress counter query results', () => {
  it('reads RETURNING rows from TypeORM UPDATE query results', async () => {
    const metadata = { documentsProcessed: 2, documentsToProcess: 3, documentsExtracted: 1, documentsPopulated: 1, businessItemsExtracted: 4 };
    const query = jest.fn().mockResolvedValue([[{ metadata }], 1]);
    const service = new SourcesService({} as any, { query } as any, {} as any, {} as any, {} as any);

    await expect(service.incrementDocumentsProcessed('sync-job')).resolves.toEqual({ documentsProcessed: 2, documentsToProcess: 3 });
    await expect(service.incrementDocumentsExtracted('sync-job')).resolves.toEqual({ documentsExtracted: 1, documentsToProcess: 3 });
    await expect(service.incrementDocumentsPopulated('sync-job', 0)).resolves.toEqual({ documentsPopulated: 1, businessItemsExtracted: 4, documentsToProcess: 3 });
    expect(query).toHaveBeenCalledTimes(3);
  });
});
