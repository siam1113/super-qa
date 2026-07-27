import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bull';
import { Source } from './entities/source.entity';
import { SyncJob } from './entities/sync-job.entity';
import { SourcesController } from './sources.controller';
import { OAuthController } from './oauth.controller';
import { WebhookController } from './webhook.controller';
import { SourcesService } from './sources.service';
import { OAuthService } from './oauth.service';
import { SyncProcessor } from './sync.processor';
import { DocumentsModule } from '../documents/documents.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Source, SyncJob]),
    BullModule.registerQueue({
      name: 'sync',
    }),
    forwardRef(() => DocumentsModule),
  ],
  controllers: [SourcesController, OAuthController, WebhookController],
  providers: [SourcesService, OAuthService, SyncProcessor],
  exports: [SourcesService, OAuthService],
})
export class SourcesModule {}
