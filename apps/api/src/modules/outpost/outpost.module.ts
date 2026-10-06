import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bull';
import { OutpostActivity, OutpostRun } from './outpost.entity';
import { ChatAgent, ChatConversation, ChatMessage } from '../chat/chat.entity';
import { QaOrgMember } from '../autonomy/identity.entity';
import { OutpostService } from './outpost.service';
import { OutpostController } from './outpost.controller';
import { AgentsModule } from '../agents/agents.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([OutpostActivity, OutpostRun, ChatAgent, ChatConversation, ChatMessage, QaOrgMember]),
    BullModule.registerQueue({ name: 'outpost' }),
    AgentsModule,
  ],
  controllers: [OutpostController],
  providers: [OutpostService],
  exports: [OutpostService],
})
export class OutpostModule {}
