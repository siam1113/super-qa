import { Injectable } from '@nestjs/common';
import pdfParse = require('pdf-parse');
import WordExtractor = require('word-extractor');
import { BaseConnector, ConnectorDocument, ConnectorSyncResult, ConnectorTestResult } from './connector.interface';
import { SourceConfig } from '../entities/source.entity';
import { StorageService } from '../../storage/storage.service';

// mammoth ships no TypeScript types and no @types package exists; this is the one
// function this connector actually calls, typed just enough to use safely.
interface MammothModule {
  extractRawText(input: { buffer: Buffer }): Promise<{ value: string; messages: unknown[] }>;
}

export interface UploadedFileRef {
  key: string;
  filename: string;
  mimeType: string;
  size: number;
  uploadedAt: string;
}

const DOCX_EXTENSIONS = new Set(['.docx']);
const DOC_EXTENSIONS = new Set(['.doc']);
const PDF_EXTENSIONS = new Set(['.pdf']);

function extensionOf(filename: string): string {
  const match = filename.toLowerCase().match(/\.[a-z0-9]+$/);
  return match ? match[0] : '';
}

/**
 * The "Upload from computer" source: unlike every other connector, it doesn't pull from an
 * external API — fetchDocuments() just re-reads whatever files attachFiles() (sources.service.ts)
 * already uploaded to blob storage and extracts their text, synchronously, right here. Everything
 * downstream (chunking, embedding, extraction) is the same generic pipeline every other source uses.
 */
@Injectable()
export class UploadConnector extends BaseConnector {
  constructor(private readonly storage: StorageService) {
    super();
  }

  async testConnection(): Promise<ConnectorTestResult> {
    return { success: true, message: 'Ready to process uploaded files', permissions: ['Read uploaded files'] };
  }

  async getPermissions(): Promise<string[]> {
    return ['Read uploaded files'];
  }

  async fetchDocuments(config: SourceConfig): Promise<ConnectorSyncResult> {
    const files = ((config.additionalConfig?.files as UploadedFileRef[] | undefined) || []);
    const documents: ConnectorDocument[] = [];
    for (const file of files) {
      try {
        const buffer = await this.storage.downloadBuffer(file.key);
        const content = await this.extractText(file.filename, file.mimeType, buffer);
        documents.push({
          externalId: file.key,
          type: 'file',
          title: file.filename,
          content: content.trim() || `This file (${file.filename}) had no extractable text.`,
          metadata: { filename: file.filename, mimeType: file.mimeType, size: file.size, uploadedAt: file.uploadedAt },
        });
      } catch (error) {
        documents.push({
          externalId: file.key,
          type: 'file',
          title: file.filename,
          content: `Could not extract text from this file: ${error instanceof Error ? error.message : 'unknown error'}`,
          metadata: { filename: file.filename, mimeType: file.mimeType, extractionFailed: true },
        });
      }
    }
    return { documents, hasMore: false };
  }

  private async extractText(filename: string, mimeType: string, buffer: Buffer): Promise<string> {
    const extension = extensionOf(filename);
    if (DOCX_EXTENSIONS.has(extension) || mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
      const mammoth: MammothModule = require('mammoth');
      const result = await mammoth.extractRawText({ buffer });
      return result.value;
    }
    if (DOC_EXTENSIONS.has(extension) || mimeType === 'application/msword') {
      const document = await new WordExtractor().extract(buffer);
      return document.getBody();
    }
    if (PDF_EXTENSIONS.has(extension) || mimeType === 'application/pdf') {
      const result = await pdfParse(buffer);
      return result.text;
    }
    // Plain text, Markdown, or anything else we were told to accept: decode as UTF-8 text.
    return buffer.toString('utf-8');
  }
}
