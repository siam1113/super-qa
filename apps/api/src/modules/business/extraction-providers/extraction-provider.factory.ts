import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { IExtractionProvider } from './extraction-provider.interface';
import { LocalExtractionProvider } from './local-extraction.provider';
import { AnthropicExtractionProvider } from './anthropic-extraction.provider';
import { OpenAIExtractionProvider } from './openai-extraction.provider';

export type ExtractionProviderType = 'local' | 'openai' | 'anthropic';

/**
 * Factory for creating extraction providers based on configuration
 */
@Injectable()
export class ExtractionProviderFactory {
  private readonly logger = new Logger(ExtractionProviderFactory.name);
  private provider: IExtractionProvider;

  constructor(private readonly configService: ConfigService) {
    this.provider = this.createProvider();
  }

  /**
   * Get the configured extraction provider
   */
  getProvider(): IExtractionProvider {
    return this.provider;
  }

  /**
   * Create extraction provider based on configuration
   */
  private createProvider(): IExtractionProvider {
    const providerType = this.configService.get<ExtractionProviderType>(
      'EXTRACTION_PROVIDER',
      'local',
    );

    this.logger.log(`Initializing extraction provider: ${providerType}`);

    switch (providerType) {
      case 'local':
        return new LocalExtractionProvider();

      case 'openai': {
        const apiKey = this.configService.get<string>('OPENAI_API_KEY');
        if (!apiKey) {
          throw new Error('OPENAI_API_KEY is required for the configured extraction provider');
        }
        return new OpenAIExtractionProvider(this.configService);
      }

      case 'anthropic': {
        const apiKey = this.configService.get<string>('ANTHROPIC_API_KEY');
        if (!apiKey) {
          throw new Error('ANTHROPIC_API_KEY is required for the configured extraction provider');
        }
        return new AnthropicExtractionProvider(this.configService);
      }

      default:
        throw new Error(`Unknown extraction provider "${providerType}"`);
    }
  }

  /**
   * Change provider at runtime (useful for testing or switching providers)
   */
  switchProvider(providerType: ExtractionProviderType): void {
    this.logger.log(`Switching extraction provider to: ${providerType}`);

    switch (providerType) {
      case 'local':
        this.provider = new LocalExtractionProvider();
        break;

      case 'openai':
        this.provider = new OpenAIExtractionProvider(this.configService);
        break;

      case 'anthropic':
        this.provider = new AnthropicExtractionProvider(this.configService);
        break;

      default:
        throw new Error(`Invalid provider type: ${providerType}`);
    }
  }

  /**
   * Get current provider name
   */
  getCurrentProviderName(): string {
    return this.provider.getName();
  }
}
