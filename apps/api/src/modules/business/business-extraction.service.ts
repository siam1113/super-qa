import { Injectable, Logger } from '@nestjs/common';
import { BusinessService, CreateBusinessItemDto } from './business.service';
import { ExtractionProviderFactory, IExtractionProvider } from './extraction-providers';
import { extractGrounded, ExtractionReport } from './grounded-extraction';

export interface ExtractionResult {
  report?: ExtractionReport;
  items: CreateBusinessItemDto[];
  relationships: Array<{
    fromName: string;
    toName: string;
    type: string;
  }>;
}

interface DocumentInput {
  revisionHash?: string;
  id: string;
  title: string;
  content: string;
  type: string;
  sourceId: string;
  metadata?: Record<string, any>;
}

@Injectable()
export class BusinessExtractionService {
  private readonly logger = new Logger(BusinessExtractionService.name);
  private readonly provider: IExtractionProvider;

  constructor(
    private readonly businessService: BusinessService,
    private readonly providerFactory: ExtractionProviderFactory,
  ) {
    this.provider = this.providerFactory.getProvider();
    this.logger.log(`Using extraction provider: ${this.provider.getName()}`);
  }

  /**
   * Extract business knowledge from a document
   */
  async extractFromDocument(document: DocumentInput, forceExtract = false): Promise<ExtractionResult> {
    return extractGrounded(document, this.providerFactory.getProvider(), forceExtract);
  }

  /**
   * Save extracted items to database
   */
  async saveExtractedItems(
    extraction: ExtractionResult,
  ): Promise<{ saved: number; relationships: number }> {
    let saved = 0;
    let relCount = 0;
    const itemMap = new Map<string, string>(); // name -> id

    // Save items
    for (const item of extraction.items) {
      try {
        const savedItem = await this.businessService.upsert(item);
        itemMap.set(item.name, savedItem.id);
        saved++;
      } catch (error) {
        this.logger.warn(`Failed to save item ${item.name}: ${error.message}`);
        throw error;
      }
    }

    // Create relationships
    for (const rel of extraction.relationships) {
      const fromId = itemMap.get(rel.fromName);
      const toId = itemMap.get(rel.toName);

      if (fromId && toId) {
        try {
          await this.businessService.createRelationship({
            type: rel.type as any,
            fromItemId: fromId,
            toItemId: toId,
          });
          relCount++;
        } catch (error) {
          if (error.code !== '23505') throw error;
        }
      }
    }

    return { saved, relationships: relCount };
  }
}
