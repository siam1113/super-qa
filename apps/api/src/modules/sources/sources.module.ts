import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bull';
import { Source } from './entities/source.entity';
import { SyncJob } from './entities/sync-job.entity';
import { SourcesController } from './sources.controller';
import { OAuthController } from './oauth.controller';
import { WebhookController } from './webhook.controller';
import { SourcesService } from './sources.service';
import { SyncProcessor } from './sync.processor';
import { GitHubConnector } from './connectors/github.connector';
import { JiraConnector } from './connectors/jira.connector';
import { ConfluenceConnector } from './connectors/confluence.connector';
import { UploadConnector } from './connectors/upload.connector';
import { SseEventsService } from './sse-events.service';
import { OAuthService } from './oauth.service';
import { DocumentsModule } from '../documents/documents.module';
import { CommonModule } from '../../common/common.module';
import { PipelineModule } from '../pipeline/pipeline.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Source, SyncJob]),
    BullModule.registerQueue({
      name: 'sync',
    }),
    forwardRef(() => DocumentsModule),
    CommonModule,
    PipelineModule,
  ],
  controllers: [SourcesController, OAuthController, WebhookController],
  providers: [
    SourcesService,
    SseEventsService,
    OAuthService,
    SyncProcessor,
    { provide: 'GitHubConnector', useClass: GitHubConnector },
    { provide: 'JiraConnector', useClass: JiraConnector },
    { provide: 'ConfluenceConnector', useClass: ConfluenceConnector },
    { provide: 'UploadConnector', useClass: UploadConnector },
  ],
  exports: [SourcesService, OAuthService],
})
export class SourcesModule {}
