import { Version3Client } from 'jira.js';
import {
  BaseConnector,
  ConnectorTestResult,
  ConnectorSyncResult,
  ConnectorDocument,
  SyncOptions,
} from './connector.interface';
import { SourceConfig } from '../entities/source.entity';

export class JiraConnector extends BaseConnector {
  private getClient(config: SourceConfig): Version3Client {
    const token = config.authType === 'oauth' ? config.oauth?.accessToken : config.token;
    if (!token) {
      throw new Error('No authentication token provided');
    }
    if (!config.baseUrl) {
      throw new Error('Jira base URL not specified');
    }

    return new Version3Client({
      host: config.baseUrl,
      authentication: {
        basic: {
          email: config.additionalConfig?.email as string || '',
          apiToken: token,
        },
      },
    });
  }

  async testConnection(config: SourceConfig): Promise<ConnectorTestResult> {
    try {
      const client = this.getClient(config);
      const myself = await client.myself.getCurrentUser();

      return {
        success: true,
        message: `Connected as ${myself.displayName || myself.emailAddress}`,
        permissions: ['read:issues', 'write:issues'],
      };
    } catch (error: unknown) {
      const err = error as Error;
      return {
        success: false,
        message: err.message || 'Failed to connect to Jira',
      };
    }
  }

  async fetchDocuments(config: SourceConfig, options?: SyncOptions): Promise<ConnectorSyncResult> {
    const client = this.getClient(config);
    const documents: ConnectorDocument[] = [];

    const startAt = options?.cursor ? parseInt(options.cursor, 10) : 0;
    const maxResults = 50;

    // Build JQL query
    let jql = 'ORDER BY updated DESC';
    if (config.project) {
      jql = `project = "${config.project}" ${jql}`;
    }

    // Add incremental sync filter if since date provided
    if (options?.since) {
      const sinceDate = options.since.toISOString().split('T')[0];
      jql = jql.replace('ORDER BY', `AND updated >= "${sinceDate}" ORDER BY`);
    }

    const searchResults = await client.issueSearch.searchForIssuesUsingJql({
      jql,
      startAt,
      maxResults,
      fields: ['summary', 'description', 'status', 'priority', 'assignee', 'reporter', 'labels', 'created', 'updated'],
    });

    for (const issue of searchResults.issues || []) {
      const description = issue.fields?.description;
      const descriptionText = typeof description === 'string' ? description : '';

      documents.push({
        externalId: issue.key,
        type: 'issue',
        title: issue.fields?.summary || issue.key,
        content: descriptionText,
        url: `${config.baseUrl}/browse/${issue.key}`,
        metadata: {
          key: issue.key,
          status: issue.fields?.status?.name,
          priority: issue.fields?.priority?.name,
          assignee: issue.fields?.assignee?.displayName,
          reporter: issue.fields?.reporter?.displayName,
          labels: issue.fields?.labels || [],
          createdAt: issue.fields?.created,
          updatedAt: issue.fields?.updated,
        },
      });
    }

    const total = searchResults.total || 0;
    const hasMore = startAt + documents.length < total;

    return {
      documents,
      hasMore,
      cursor: hasMore ? String(startAt + maxResults) : undefined,
    };
  }

  async getPermissions(config: SourceConfig): Promise<string[]> {
    const result = await this.testConnection(config);
    return result.permissions || [];
  }
}
