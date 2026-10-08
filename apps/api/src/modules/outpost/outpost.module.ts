import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bull';
import { OutpostActivity, OutpostRun } from './outpost.entity';
import { ChatAgent } from '../chat/chat.entity';
import { OutpostService } from './outpost.service';
import { OutpostController } from './outpost.controller';
import { AgentsModule } from '../agents/agents.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([OutpostActivity, OutpostRun, ChatAgent]),
    BullModule.registerQueue({ name: 'outpost' }),
    AgentsModule,
  ],
  controllers: [OutpostController],
  providers: [OutpostService],
  exports: [OutpostService],
})
export class OutpostModule {}
