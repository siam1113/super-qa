import { Octokit } from '@octokit/rest';
import {
  BaseConnector,
  ConnectorTestResult,
  ConnectorSyncResult,
  ConnectorDocument,
  ConnectorRepository,
  SyncOptions,
} from './connector.interface';
import { SourceConfig } from '../entities/source.entity';

type GitHubCursor = { phase: 'tracking'; page: number } | { phase: 'code'; offset: number };

const CODE_PAGE_SIZE = 20;
const MAX_CODE_FILE_BYTES = 200 * 1024;

const CODE_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.vue', '.svelte',
  '.py', '.rb', '.go', '.java', '.kt', '.scala', '.rs', '.c', '.h', '.cpp', '.hpp', '.cs', '.swift', '.php',
  '.sh', '.bash', '.sql', '.graphql', '.proto',
  '.html', '.css', '.scss', '.less',
  '.json', '.yml', '.yaml', '.toml', '.md', '.mdx',
]);

const EXCLUDED_PATH_SEGMENTS = [
  'node_modules/', 'dist/', 'build/', 'vendor/', '.git/', 'coverage/',
  '__pycache__/', '.venv/', 'venv/', 'target/', '.next/', 'out/',
];

const EXCLUDED_FILENAMES = new Set([
  'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', 'composer.lock', 'Gemfile.lock', 'poetry.lock',
]);

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

  private decodeCursor(raw?: string): GitHubCursor {
    if (!raw) return { phase: 'tracking', page: 1 };
    try {
      const parsed = JSON.parse(raw);
      if (parsed?.phase === 'code') return { phase: 'code', offset: Number(parsed.offset) || 0 };
    } catch {
      // Fall through to the tracking default below.
    }
    return { phase: 'tracking', page: 1 };
  }

  private isEligibleCodePath(path: string): boolean {
    const extension = path.includes('.') ? path.slice(path.lastIndexOf('.')).toLowerCase() : '';
    if (!CODE_EXTENSIONS.has(extension)) return false;
    const filename = path.slice(path.lastIndexOf('/') + 1);
    if (EXCLUDED_FILENAMES.has(filename)) return false;
    return !EXCLUDED_PATH_SEGMENTS.some(segment => path.includes(segment));
  }

  /**
   * Repository source files, as a distinct pagination phase after issues/PRs exhaust.
   * The tree listing is re-fetched per page rather than cached across calls: each
   * fetchDocuments call must be independently resumable from just its cursor.
   */
  private async fetchCodeDocuments(octokit: Octokit, owner: string, repo: string, offset: number): Promise<ConnectorSyncResult> {
    const { data: repoData } = await octokit.repos.get({ owner, repo });
    const branch = repoData.default_branch;
    const { data: tree } = await octokit.git.getTree({ owner, repo, tree_sha: branch, recursive: 'true' });

    const eligible = tree.tree.filter(entry =>
      entry.type === 'blob' && entry.path && this.isEligibleCodePath(entry.path) &&
      (entry.size === undefined || entry.size <= MAX_CODE_FILE_BYTES));

    const page = eligible.slice(offset, offset + CODE_PAGE_SIZE);
    const documents: ConnectorDocument[] = [];

    for (const entry of page) {
      if (!entry.path || !entry.sha) continue;
      const { data: file } = await octokit.repos.getContent({ owner, repo, path: entry.path, ref: branch });
      if (Array.isArray(file) || file.type !== 'file' || typeof file.content !== 'string') continue;
      const content = Buffer.from(file.content, 'base64').toString('utf8');
      if (content.includes(String.fromCharCode(0))) continue; // Binary file slipped past the extension filter.

      documents.push({
        externalId: `code-${entry.path}`,
        type: 'code',
        title: entry.path,
        content,
        url: `https://github.com/${owner}/${repo}/blob/${branch}/${entry.path}`,
        updatedAt: new Date(),
        metadata: { path: entry.path, sha: entry.sha, size: entry.size },
      });
    }

    const hasMore = offset + CODE_PAGE_SIZE < eligible.length;
    return {
      documents,
      hasMore,
      cursor: hasMore ? JSON.stringify({ phase: 'code', offset: offset + CODE_PAGE_SIZE }) : undefined,
      syncedAt: new Date(),
    };
  }

  async fetchDocuments(config: SourceConfig, options?: SyncOptions): Promise<ConnectorSyncResult> {
    const octokit = this.getClient(config);
    const { owner, repo } = this.parseRepository(config);
    const cursor = this.decodeCursor(options?.cursor);

    if (cursor.phase === 'code') {
      return this.fetchCodeDocuments(octokit, owner, repo, cursor.offset);
    }

    const documents: ConnectorDocument[] = [];

    const page = cursor.page;
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

    // Check if there are more issue/PR pages; once exhausted, move into the code phase.
    const trackingHasMore = issues.length === perPage || pulls.length === perPage;
    const cursorPayload = trackingHasMore ? { phase: 'tracking', page: page + 1 } : { phase: 'code', offset: 0 };

    return {
      documents,
      hasMore: true,
      cursor: JSON.stringify(cursorPayload),
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
   * List repositories visible to the stored credentials, most recently updated first.
   * Used to let the user pick a repository after connecting (or add more later)
   * instead of typing "owner/repo" by hand.
   */
  async listRepositories(config: SourceConfig): Promise<ConnectorRepository[]> {
    const octokit = this.getClient(config);
    const perPage = 100;
    const maxPages = 5; // up to 500 repositories
    const repositories: ConnectorRepository[] = [];

    for (let page = 1; page <= maxPages; page++) {
      const { data } = await octokit.repos.listForAuthenticatedUser({
        per_page: perPage,
        page,
        sort: 'updated',
        affiliation: 'owner,collaborator,organization_member',
      });

      for (const repo of data) {
        repositories.push({
          fullName: repo.full_name,
          private: repo.private,
          description: repo.description ?? null,
          updatedAt: repo.updated_at ?? null,
          defaultBranch: repo.default_branch,
        });
      }

      if (data.length < perPage) break;
    }

    return repositories;
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
