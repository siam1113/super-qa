import {
  BaseConnector,
  ConnectorTestResult,
  ConnectorSyncResult,
  ConnectorDocument,
  SyncOptions,
} from './connector.interface';
import { SourceConfig } from '../entities/source.entity';

interface ConfluenceResponse {
  results: ConfluencePage[];
  _links?: {
    next?: string;
  };
  start?: number;
  limit?: number;
  size?: number;
}

interface ConfluencePage {
  id: string;
  title: string;
  type: string;
  status: string;
  body?: {
    storage?: {
      value: string;
    };
    view?: {
      value: string;
    };
  };
  _links?: {
    webui?: string;
  };
  space?: {
    key: string;
    name: string;
  };
  version?: {
    when: string;
  };
  history?: {
    createdDate: string;
  };
}

export class ConfluenceConnector extends BaseConnector {
  private getHeaders(config: SourceConfig): HeadersInit {
    const token = config.authType === 'oauth' ? config.oauth?.accessToken : config.token;
    if (!token) {
      throw new Error('No authentication token provided');
    }

    const email = config.additionalConfig?.email as string;
    if (!email) {
      throw new Error('Email not specified for Confluence authentication');
    }

    const auth = Buffer.from(`${email}:${token}`).toString('base64');
    return {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };
  }

  private getBaseUrl(config: SourceConfig): string {
    if (!config.baseUrl) {
      throw new Error('Confluence base URL not specified');
    }
    return config.baseUrl.replace(/\/$/, '');
  }

  async testConnection(config: SourceConfig): Promise<ConnectorTestResult> {
    try {
      const baseUrl = this.getBaseUrl(config);
      const headers = this.getHeaders(config);

      const response = await fetch(`${baseUrl}/wiki/rest/api/user/current`, {
        headers,
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`HTTP ${response.status}: ${text}`);
      }

      const user = await response.json();

      return {
        success: true,
        message: `Connected as ${user.displayName || user.email}`,
        permissions: ['read:pages'],
      };
    } catch (error: unknown) {
      const err = error as Error;
      return {
        success: false,
        message: err.message || 'Failed to connect to Confluence',
      };
    }
  }

  async fetchDocuments(config: SourceConfig, options?: SyncOptions): Promise<ConnectorSyncResult> {
    const baseUrl = this.getBaseUrl(config);
    const headers = this.getHeaders(config);
    const documents: ConnectorDocument[] = [];

    const start = options?.cursor ? parseInt(options.cursor, 10) : 0;
    const limit = 25;

    // Build query parameters
    const params = new URLSearchParams({
      start: String(start),
      limit: String(limit),
      expand: 'body.storage,space,version,history',
    });

    if (config.spaceKey) {
      params.set('spaceKey', config.spaceKey);
    }

    const response = await fetch(
      `${baseUrl}/wiki/rest/api/content?${params.toString()}`,
      { headers }
    );

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`HTTP ${response.status}: ${text}`);
    }

    const data: ConfluenceResponse = await response.json();

    for (const page of data.results || []) {
      // Strip HTML tags for plain text content
      const htmlContent = page.body?.storage?.value || page.body?.view?.value || '';
      const textContent = htmlContent.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();

      documents.push({
        externalId: page.id,
        type: 'wiki',
        title: page.title,
        content: textContent,
        url: page._links?.webui ? `${baseUrl}/wiki${page._links.webui}` : undefined,
        metadata: {
          type: page.type,
          status: page.status,
          spaceKey: page.space?.key,
          spaceName: page.space?.name,
          createdAt: page.history?.createdDate,
          updatedAt: page.version?.when,
        },
      });
    }

    const hasMore = !!data._links?.next;

    return {
      documents,
      hasMore,
      cursor: hasMore ? String(start + limit) : undefined,
    };
  }

  async getPermissions(config: SourceConfig): Promise<string[]> {
    const result = await this.testConnection(config);
    return result.permissions || [];
  }
}
