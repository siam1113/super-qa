import { ISourceConnector, ConnectorSyncResult, SyncOptions, ConnectorDocument } from '../../src/modules/sources/connectors/connector.interface';
import { mockGitHubDocuments, mockJiraDocuments, mockConfluenceDocuments } from '../fixtures/connector-documents.fixture';

export class MockGitHubConnector implements ISourceConnector {
  private documents: ConnectorDocument[] = mockGitHubDocuments;

  async testConnection(config: any): Promise<{ success: boolean; message: string; permissions?: string[] }> {
    if (!config.token) {
      return { success: false, message: 'Authentication token is required' };
    }
    return {
      success: true,
      message: 'Successfully connected to GitHub',
      permissions: ['read:issues', 'read:pull_requests', 'read:repository'],
    };
  }

  async fetchDocuments(config: any, options?: SyncOptions): Promise<ConnectorSyncResult> {
    // Simulate pagination
    const limit = options?.limit || 10;
    const cursor = options?.cursor ? parseInt(options.cursor) : 0;

    const startIndex = cursor;
    const endIndex = Math.min(startIndex + limit, this.documents.length);
    const pageDocuments = this.documents.slice(startIndex, endIndex);

    const hasMore = endIndex < this.documents.length;
    const nextCursor = hasMore ? endIndex.toString() : undefined;

    return {
      documents: pageDocuments,
      hasMore,
      cursor: nextCursor,
      syncedAt: new Date(),
    };
  }

  async getPermissions(config: any): Promise<string[]> {
    return ['read:issues', 'read:pull_requests', 'read:repository'];
  }

  setDocuments(documents: ConnectorDocument[]) {
    this.documents = documents;
  }
}

export class MockJiraConnector implements ISourceConnector {
  private documents: ConnectorDocument[] = mockJiraDocuments;

  async testConnection(config: any): Promise<{ success: boolean; message: string; permissions?: string[] }> {
    if (!config.token || !config.email) {
      return { success: false, message: 'Token and email are required' };
    }
    return {
      success: true,
      message: 'Successfully connected to Jira',
      permissions: ['read:jira-work'],
    };
  }

  async fetchDocuments(config: any, options?: SyncOptions): Promise<ConnectorSyncResult> {
    const limit = options?.limit || 10;
    const cursor = options?.cursor ? parseInt(options.cursor) : 0;

    const startIndex = cursor;
    const endIndex = Math.min(startIndex + limit, this.documents.length);
    const pageDocuments = this.documents.slice(startIndex, endIndex);

    const hasMore = endIndex < this.documents.length;
    const nextCursor = hasMore ? endIndex.toString() : undefined;

    return {
      documents: pageDocuments,
      hasMore,
      cursor: nextCursor,
      syncedAt: new Date(),
    };
  }

  async getPermissions(config: any): Promise<string[]> {
    return ['read:jira-work'];
  }

  setDocuments(documents: ConnectorDocument[]) {
    this.documents = documents;
  }
}

export class MockConfluenceConnector implements ISourceConnector {
  private documents: ConnectorDocument[] = mockConfluenceDocuments;

  async testConnection(config: any): Promise<{ success: boolean; message: string; permissions?: string[] }> {
    if (!config.token || !config.email) {
      return { success: false, message: 'Token and email are required' };
    }
    return {
      success: true,
      message: 'Successfully connected to Confluence',
      permissions: ['read:confluence-content.all'],
    };
  }

  async fetchDocuments(config: any, options?: SyncOptions): Promise<ConnectorSyncResult> {
    const limit = options?.limit || 10;
    const cursor = options?.cursor ? parseInt(options.cursor) : 0;

    const startIndex = cursor;
    const endIndex = Math.min(startIndex + limit, this.documents.length);
    const pageDocuments = this.documents.slice(startIndex, endIndex);

    const hasMore = endIndex < this.documents.length;
    const nextCursor = hasMore ? endIndex.toString() : undefined;

    return {
      documents: pageDocuments,
      hasMore,
      cursor: nextCursor,
      syncedAt: new Date(),
    };
  }

  async getPermissions(config: any): Promise<string[]> {
    return ['read:confluence-content.all'];
  }

  setDocuments(documents: ConnectorDocument[]) {
    this.documents = documents;
  }
}
