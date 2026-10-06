import { RetrievalService } from '../../src/modules/retrieval/retrieval.service';

describe('scoped retrieval evidence', () => {
  const sourceIds = ['allowed'];
  const chunk = (id: string, content = 'Users must log in.') => ({
    id, content, documentId: 'document', embedding: [1, 0], metadata: { revisionHash: 'revision' },
    document: { id: 'document', sourceId: 'allowed', processedHash: 'revision', contentHash: 'hash', title: 'Login', type: 'issue', url: null },
  });
  const embeddings = { embedOne: jest.fn().mockResolvedValue([1, 0]) };
  const documents = { searchByEmbedding: jest.fn() };
  const service = new RetrievalService(embeddings as any, documents as any);

  beforeEach(() => { jest.clearAllMocks(); documents.searchByEmbedding.mockResolvedValue([chunk('first')]); });

  it('requires explicit nonempty source scope before embedding', async () => {
    await expect(service.search('login')).rejects.toThrow();
    await expect(service.search('login', { sourceIds: [] })).rejects.toThrow();
    expect(embeddings.embedOne).not.toHaveBeenCalled();
  });

  it('passes scope and type filters to ranking and returns revisioned quotes', async () => {
    const result = await service.search('login', { sourceIds, documentTypes: ['issue'] });
    expect(documents.searchByEmbedding).toHaveBeenCalledWith([1, 0], 10, { sourceIds, documentTypes: ['issue'] });
    expect(result.chunks[0].citation).toMatchObject({ sourceId: 'allowed', documentId: 'document', chunkId: 'first', revisionHash: 'revision', quote: 'Users must log in.' });
    expect(result.context).toContain(result.chunks[0].citation.id);
  });

  it('excludes stale or out-of-scope chunks even from a faulty adapter', async () => {
    documents.searchByEmbedding.mockResolvedValue([
      { ...chunk('stale'), metadata: { revisionHash: 'old' } },
      { ...chunk('foreign'), document: { ...chunk('foreign').document, sourceId: 'other' } },
    ]);
    expect((await service.search('login', { sourceIds })).chunks).toEqual([]);
  });

  it('includes citation overhead in the budget and skips oversized chunks', async () => {
    documents.searchByEmbedding.mockResolvedValue([chunk('large', 'x'.repeat(5000)), chunk('small')]);
    const result = await service.getEvidence('login', 200, { sourceIds });
    expect(result.chunks.map(value => value.id)).toEqual(['small']);
    expect(result.context.length).toBeLessThanOrEqual(800);
    expect(result.context).toContain(result.chunks[0].citation.id);
  });

  it.each([{ limit: 0 }, { limit: 1.5 }, { minSimilarity: NaN }, { documentTypes: [] }])('rejects invalid options %s', async options => {
    await expect(service.search('login', { sourceIds, ...options })).rejects.toThrow();
    expect(embeddings.embedOne).not.toHaveBeenCalled();
  });

  it('fails malformed query embeddings rather than reporting no evidence', async () => {
    embeddings.embedOne.mockResolvedValueOnce([0, 0]);
    await expect(service.search('login', { sourceIds })).rejects.toThrow('embedding');
  });
});
