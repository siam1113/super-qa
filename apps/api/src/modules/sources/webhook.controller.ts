import {
  Controller,
  Post,
  Body,
  Headers,
  Param,
  RawBodyRequest,
  Req,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { Request } from 'express';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import * as crypto from 'crypto';
import { Source } from './entities/source.entity';
import { GitHubConnector } from './connectors/github.connector';
import { JiraConnector } from './connectors/jira.connector';
import { ConfluenceConnector } from './connectors/confluence.connector';
import { ISourceConnector } from './connectors/connector.interface';

@Controller('webhooks')
export class WebhookController {
  private readonly logger = new Logger(WebhookController.name);
  private connectors: Map<string, ISourceConnector>;

  constructor(
    @InjectRepository(Source)
    private sourceRepository: Repository<Source>,
    @InjectQueue('sync')
    private syncQueue: Queue,
  ) {
    this.connectors = new Map();
    this.connectors.set('github', new GitHubConnector());
    this.connectors.set('jira', new JiraConnector());
    this.connectors.set('confluence', new ConfluenceConnector());
  }

  /**
   * GitHub webhook handler
   */
  @Post('github/:sourceId')
  async handleGitHubWebhook(
    @Param('sourceId') sourceId: string,
    @Headers() headers: Record<string, string>,
    @Body() payload: any,
    @Req() req: RawBodyRequest<Request>,
  ) {
    this.logger.log(`Received GitHub webhook for source ${sourceId}`);

    // Find source
    const source = await this.sourceRepository.findOne({
      where: { id: sourceId, type: 'github' },
    });

    if (!source) {
      throw new BadRequestException('Source not found');
    }

    // Verify webhook signature if secret is configured
    if (source.webhookConfig?.secret) {
      const signature = headers['x-hub-signature-256'];
      const rawBody = req.rawBody?.toString() || JSON.stringify(payload);

      if (!this.verifyGitHubSignature(rawBody, signature, source.webhookConfig.secret)) {
        throw new BadRequestException('Invalid webhook signature');
      }
    }

    // Process webhook
    const connector = this.connectors.get('github') as GitHubConnector;
    const documents = await connector.handleWebhook(payload, headers);

    if (documents.length > 0) {
      // Queue for processing
      await this.syncQueue.add('webhook-update', {
        sourceId,
        documents,
      });

      this.logger.log(`Queued ${documents.length} documents from GitHub webhook`);
    }

    return { received: true, documents: documents.length };
  }

  /**
   * Jira webhook handler
   */
  @Post('jira/:sourceId')
  async handleJiraWebhook(
    @Param('sourceId') sourceId: string,
    @Headers() headers: Record<string, string>,
    @Body() payload: any,
  ) {
    this.logger.log(`Received Jira webhook for source ${sourceId}`);

    // Find source
    const source = await this.sourceRepository.findOne({
      where: { id: sourceId, type: 'jira' },
    });

    if (!source) {
      throw new BadRequestException('Source not found');
    }

    // Process webhook
    const documents = this.processJiraWebhook(payload);

    if (documents.length > 0) {
      await this.syncQueue.add('webhook-update', {
        sourceId,
        documents,
      });

      this.logger.log(`Queued ${documents.length} documents from Jira webhook`);
    }

    return { received: true, documents: documents.length };
  }

  /**
   * Confluence webhook handler
   */
  @Post('confluence/:sourceId')
  async handleConfluenceWebhook(
    @Param('sourceId') sourceId: string,
    @Headers() headers: Record<string, string>,
    @Body() payload: any,
  ) {
    this.logger.log(`Received Confluence webhook for source ${sourceId}`);

    // Find source
    const source = await this.sourceRepository.findOne({
      where: { id: sourceId, type: 'confluence' },
    });

    if (!source) {
      throw new BadRequestException('Source not found');
    }

    // Process webhook
    const documents = this.processConfluenceWebhook(payload);

    if (documents.length > 0) {
      await this.syncQueue.add('webhook-update', {
        sourceId,
        documents,
      });

      this.logger.log(`Queued ${documents.length} documents from Confluence webhook`);
    }

    return { received: true, documents: documents.length };
  }

  /**
   * Generic webhook handler (for custom integrations)
   */
  @Post(':provider/:sourceId')
  async handleGenericWebhook(
    @Param('provider') provider: string,
    @Param('sourceId') sourceId: string,
    @Headers() headers: Record<string, string>,
    @Body() payload: any,
  ) {
    this.logger.log(`Received ${provider} webhook for source ${sourceId}`);

    const source = await this.sourceRepository.findOne({
      where: { id: sourceId },
    });

    if (!source) {
      throw new BadRequestException('Source not found');
    }

    const connector = this.connectors.get(provider);
    if (!connector?.handleWebhook) {
      throw new BadRequestException(`No webhook handler for ${provider}`);
    }

    const documents = await connector.handleWebhook(payload, headers);

    if (documents.length > 0) {
      await this.syncQueue.add('webhook-update', {
        sourceId,
        documents,
      });
    }

    return { received: true, documents: documents.length };
  }

  /**
   * Verify GitHub webhook signature
   */
  private verifyGitHubSignature(
    payload: string,
    signature: string,
    secret: string,
  ): boolean {
    if (!signature) return false;

    const expectedSignature = 'sha256=' +
      crypto.createHmac('sha256', secret).update(payload).digest('hex');

    return crypto.timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(expectedSignature),
    );
  }

  /**
   * Process Jira webhook payload
   */
  private processJiraWebhook(payload: any): any[] {
    const documents: any[] = [];
    const webhookEvent = payload.webhookEvent;

    if (webhookEvent?.startsWith('jira:issue_')) {
      const issue = payload.issue;
      if (issue) {
        documents.push({
          externalId: issue.key,
          type: 'issue',
          title: issue.fields?.summary || issue.key,
          content: issue.fields?.description || '',
          url: `${payload.issue?.self?.split('/rest/')[0]}/browse/${issue.key}`,
          updatedAt: new Date(issue.fields?.updated || Date.now()),
          metadata: {
            key: issue.key,
            status: issue.fields?.status?.name,
            priority: issue.fields?.priority?.name,
            assignee: issue.fields?.assignee?.displayName,
            reporter: issue.fields?.reporter?.displayName,
            labels: issue.fields?.labels || [],
            issueType: issue.fields?.issuetype?.name,
            webhookEvent,
          },
        });
      }
    }

    return documents;
  }

  /**
   * Process Confluence webhook payload
   */
  private processConfluenceWebhook(payload: any): any[] {
    const documents: any[] = [];
    const eventType = payload.eventType;

    if (eventType?.includes('page')) {
      const page = payload.page;
      if (page) {
        // Strip HTML from body
        const content = page.body?.storage?.value || page.body?.view?.value || '';
        const plainContent = content.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();

        documents.push({
          externalId: page.id,
          type: 'wiki',
          title: page.title,
          content: plainContent,
          url: page._links?.webui
            ? `${payload.baseUrl || ''}${page._links.webui}`
            : undefined,
          updatedAt: new Date(page.version?.when || Date.now()),
          metadata: {
            pageId: page.id,
            spaceKey: page.space?.key,
            spaceName: page.space?.name,
            version: page.version?.number,
            status: page.status,
            webhookEvent: eventType,
          },
        });
      }
    }

    return documents;
  }
}
