import { Source, SourceConfig } from '../entities/source.entity';

export interface ConnectorAttachment {
  name: string;
  url: string;
  mimeType: string;
  size?: number;
  content?: Buffer; // Populated if downloaded
}

export interface ConnectorDocument {
  externalId: string;
  type: 'requirement' | 'code' | 'issue' | 'pr' | 'wiki' | 'test_case' | 'api_spec' | 'comment';
  title: string;
  content: string;
  url?: string;
  metadata?: Record<string, unknown>;
  attachments?: ConnectorAttachment[];
  updatedAt?: Date; // For incremental sync
}

export interface ConnectorTestResult {
  success: boolean;
  message: string;
  permissions?: string[];
}

export interface SyncOptions {
  incremental?: boolean;      // Only fetch changed documents
  since?: Date;               // Fetch documents updated after this date
  cursor?: string;            // Pagination cursor
  includeAttachments?: boolean; // Download attachments
}

export interface ConnectorSyncResult {
  documents: ConnectorDocument[];
  hasMore: boolean;
  cursor?: string;
  syncedAt?: Date;            // Timestamp for incremental sync
  totalAvailable?: number;    // Total documents available (if known)
}

export interface ISourceConnector {
  /**
   * Test the connection to the source
   */
  testConnection(config: SourceConfig): Promise<ConnectorTestResult>;

  /**
   * Fetch documents from the source
   * @param config Source configuration
   * @param options Sync options including cursor and incremental settings
   */
  fetchDocuments(config: SourceConfig, options?: SyncOptions): Promise<ConnectorSyncResult>;

  /**
   * Get permissions available for this source
   */
  getPermissions(config: SourceConfig): Promise<string[]>;

  /**
   * Handle incoming webhook payload (optional)
   */
  handleWebhook?(payload: any, headers: Record<string, string>): Promise<ConnectorDocument[]>;
}

export abstract class BaseConnector implements ISourceConnector {
  abstract testConnection(config: SourceConfig): Promise<ConnectorTestResult>;
  abstract fetchDocuments(config: SourceConfig, options?: SyncOptions): Promise<ConnectorSyncResult>;
  abstract getPermissions(config: SourceConfig): Promise<string[]>;

  // Default webhook handler - can be overridden
  async handleWebhook(payload: any, headers: Record<string, string>): Promise<ConnectorDocument[]> {
    return [];
  }
}
