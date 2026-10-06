import { ProcessingService } from '../../src/modules/processing/processing.service';
import { ChunkingService } from '../../src/modules/processing/chunking.service';
import { Logger } from '@nestjs/common';

describe('Processing scope and failure reporting', () => {
  let service: ProcessingService;
  let sources: any;
  let documents: any;
  let extraction: any;

  beforeEach(() => {
    Logger.overrideLogger(false);
    const document = { id: 'selected', sourceId: 'source', type: 'issue', title: 'Login', content: 'Password required' };
    const metadata = { documentIds: ['selected'], documentsToProcess: 1 };
    sources = {
      getSyncJob: jest.fn().mockResolvedValue({ status: 'running', sourceId: 'source', metadata }),
      getSyncJobMetadata: jest.fn().mockResolvedValue(metadata),
      incrementDocumentsProcessed: jest.fn().mockResolvedValue({ documentsProcessed: 1, documentsToProcess: 1 }),
    };
    for (const method of ['startStage', 'addLog', 'updateStageProgress', 'completeStage', 'failStage', 'completeJob', 'setSyncJobMetadata']) {
      sources[method] = jest.fn().mockResolvedValue(undefined);
    }
    documents = {
      getDocumentWithChunks: jest.fn().mockResolvedValue(document),
      saveChunks: jest.fn().mockResolvedValue(undefined),
      findByManifest: jest.fn().mockResolvedValue([document]),
      findAll: jest.fn().mockResolvedValue({ documents: [document, { ...document, id: 'unrelated' }] }),
    };
    extraction = {
      extractFromDocument: jest.fn().mockResolvedValue({ items: [], relationships: [] }),
    };
    service = new ProcessingService(new ChunkingService(), { embed: jest.fn().mockResolvedValue([[1, 0]]) } as any,
      documents, extraction, sources);
  });

  it('extracts only the persisted manifest, never a source-wide first page', async () => {
    await service.processDocument('selected', 'job');
    expect(documents.findByManifest).toHaveBeenCalledWith('source', ['selected']);
    expect(documents.findAll).not.toHaveBeenCalled();
    expect(extraction.extractFromDocument).toHaveBeenCalledTimes(1);
    expect(sources.completeJob).toHaveBeenCalledTimes(1);
  });

  it('does not turn an extraction provider failure into a successful empty sync', async () => {
    extraction.extractFromDocument.mockRejectedValue(new Error('provider unavailable'));
    await expect(service.processDocument('selected', 'job')).rejects.toThrow('provider unavailable');
    expect(sources.failStage).toHaveBeenCalledWith('job', 'extracting', 'provider unavailable');
    expect(sources.completeJob).not.toHaveBeenCalled();
  });
});
