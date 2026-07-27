import { Octokit } from '@octokit/rest';
import {
  BaseConnector,
  ConnectorTestResult,
  ConnectorSyncResult,
  ConnectorDocument,
  SyncOptions,
} from './connector.interface';
import { SourceConfig } from '../entities/source.entity';

export class GitHubConnector extends BaseConnector {
  private getClient(config: SourceConfig): Octokit {
    const token = config.authType === 'oauth' ? config.oauth?.accessToken : config.token;
    if (!token) {
      throw new Error('No authentication token provided');
    }
    return new Octokit({ auth: token });
  }

  private parseRepository(config: SourceConfig): { owner: string; repo: string } {
    const repo = config.repository;
    if (!repo) {
      throw new Error('Repository not specified');
    }
    const [owner, repoName] = repo.split('/');
    if (!owner || !repoName) {
      throw new Error('Invalid repository format. Expected "owner/repo"');
    }
    return { owner, repo: repoName };
  }

  async testConnection(config: SourceConfig): Promise<ConnectorTestResult> {
    try {
      const octokit = this.getClient(config);
      const { owner, repo } = this.parseRepository(config);

      // Try to access the repository
      const { data } = await octokit.repos.get({ owner, repo });

      return {
        success: true,
        message: `Connected to ${data.full_name}`,
        permissions: data.permissions
          ? Object.entries(data.permissions)
              .filter(([, value]) => value)
              .map(([key]) => `repo:${key}`)
          : ['read:code'],
      };
    } catch (error: unknown) {
      const err = error as Error;
      return {
        success: false,
        message: err.message || 'Failed to connect to GitHub',
      };
    }
  }

  async fetchDocuments(config: SourceConfig, options?: SyncOptions): Promise<ConnectorSyncResult> {
    const octokit = this.getClient(config);
    const { owner, repo } = this.parseRepository(config);
    const documents: ConnectorDocument[] = [];

    const page = options?.cursor ? parseInt(options.cursor, 10) : 1;
    const perPage = 30;

    // Build query params for incremental sync
    const sinceParam = options?.incremental && options.since
      ? { since: options.since.toISOString() }
      : {};

    // Fetch issues
    const { data: issues } = await octokit.issues.listForRepo({
      owner,
      repo,
      state: 'all',
      per_page: perPage,
      page,
      sort: 'updated',
      direction: 'desc',
      ...sinceParam,
    });

    for (const issue of issues) {
      // Skip pull requests (they're returned by issues API too)
      if (issue.pull_request) continue;

      documents.push({
        externalId: `issue-${issue.number}`,
        type: 'issue',
        title: issue.title,
        content: issue.body || '',
        url: issue.html_url,
        updatedAt: new Date(issue.updated_at),
        metadata: {
          number: issue.number,
          state: issue.state,
          labels: issue.labels.map((l) => (typeof l === 'string' ? l : l.name)),
          assignees: issue.assignees?.map((a) => a.login) || [],
          createdAt: issue.created_at,
          updatedAt: issue.updated_at,
          linkedIssues: this.extractLinkedIssues(issue.body || ''),
        },
      });
    }

    // Fetch pull requests
    const { data: pulls } = await octokit.pulls.list({
      owner,
      repo,
      state: 'all',
      per_page: perPage,
      page,
      sort: 'updated',
      direction: 'desc',
    });

    // Filter PRs for incremental sync
    const filteredPulls = options?.incremental && options.since
      ? pulls.filter(pr => new Date(pr.updated_at) > options.since!)
      : pulls;

    for (const pr of filteredPulls) {
      documents.push({
        externalId: `pr-${pr.number}`,
        type: 'pr',
        title: pr.title,
        content: pr.body || '',
        url: pr.html_url,
        updatedAt: new Date(pr.updated_at),
        metadata: {
          number: pr.number,
          state: pr.state,
          merged: pr.merged_at !== null,
          base: pr.base.ref,
          head: pr.head.ref,
          createdAt: pr.created_at,
          updatedAt: pr.updated_at,
          linkedIssues: this.extractLinkedIssues(pr.body || ''),
        },
      });
    }

    // Check if there are more pages
    const hasMore = issues.length === perPage || pulls.length === perPage;

    return {
      documents,
      hasMore,
      cursor: hasMore ? String(page + 1) : undefined,
      syncedAt: new Date(),
    };
  }

  /**
   * Extract linked issue numbers from text (e.g., "Fixes #123", "Closes #456")
   */
  private extractLinkedIssues(text: string): string[] {
    const patterns = [
      /(?:fix(?:es)?|close(?:s)?|resolve(?:s)?)\s+#(\d+)/gi,
      /#(\d+)/g,
    ];

    const issues: string[] = [];
    for (const pattern of patterns) {
      const matches = text.matchAll(pattern);
      for (const match of matches) {
        issues.push(`issue-${match[1]}`);
      }
    }

    return [...new Set(issues)];
  }

  async getPermissions(config: SourceConfig): Promise<string[]> {
    const result = await this.testConnection(config);
    return result.permissions || [];
  }

  /**
   * Handle GitHub webhook payload
   */
  async handleWebhook(payload: any, headers: Record<string, string>): Promise<ConnectorDocument[]> {
    const event = headers['x-github-event'];
    const documents: ConnectorDocument[] = [];

    switch (event) {
      case 'issues':
        if (payload.action === 'opened' || payload.action === 'edited' || payload.action === 'closed') {
          const issue = payload.issue;
          documents.push({
            externalId: `issue-${issue.number}`,
            type: 'issue',
            title: issue.title,
            content: issue.body || '',
            url: issue.html_url,
            updatedAt: new Date(issue.updated_at),
            metadata: {
              number: issue.number,
              state: issue.state,
              labels: issue.labels?.map((l: any) => l.name) || [],
              assignees: issue.assignees?.map((a: any) => a.login) || [],
              createdAt: issue.created_at,
              updatedAt: issue.updated_at,
              webhookAction: payload.action,
            },
          });
        }
        break;

      case 'pull_request':
        if (['opened', 'edited', 'closed', 'merged'].includes(payload.action)) {
          const pr = payload.pull_request;
          documents.push({
            externalId: `pr-${pr.number}`,
            type: 'pr',
            title: pr.title,
            content: pr.body || '',
            url: pr.html_url,
            updatedAt: new Date(pr.updated_at),
            metadata: {
              number: pr.number,
              state: pr.state,
              merged: pr.merged_at !== null,
              base: pr.base?.ref,
              head: pr.head?.ref,
              createdAt: pr.created_at,
              updatedAt: pr.updated_at,
              webhookAction: payload.action,
              linkedIssues: this.extractLinkedIssues(pr.body || ''),
            },
          });
        }
        break;

      case 'issue_comment':
        if (payload.action === 'created' || payload.action === 'edited') {
          const comment = payload.comment;
          const issue = payload.issue;
          documents.push({
            externalId: `comment-${comment.id}`,
            type: 'comment',
            title: `Comment on #${issue.number}`,
            content: comment.body || '',
            url: comment.html_url,
            updatedAt: new Date(comment.updated_at),
            metadata: {
              commentId: comment.id,
              issueNumber: issue.number,
              author: comment.user?.login,
              createdAt: comment.created_at,
              updatedAt: comment.updated_at,
              webhookAction: payload.action,
            },
          });
        }
        break;
    }

    return documents;
  }
}
