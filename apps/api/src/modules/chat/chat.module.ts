import { Injectable, Logger, Module, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AutonomyModule } from '../autonomy/autonomy.module';
import { ChatController, ChatGuard, ChatHookController } from './chat.controller';
import { ChatConnectors } from './chat.connectors';
import { chatEntities } from './chat.entity';
import { ChatModel } from './chat.model';
import { ChatService } from './chat.service';
import { MeetingController, MeetingHookController } from './meeting.controller';
import { meetingEntities } from './meeting.entity';
import { MeetingService } from './meeting.service';
import { MEETING_SERVICE } from './meeting.tokens';
import { MeetingModel } from './meeting.model';
import { MeetingProvider } from './meeting.provider';
import { MeetingVoice } from './voice.entity';
import { VoiceProvider } from './voice.provider';
import { VoiceService } from './voice.service';
import { VoiceController, VoiceBridgeController } from './voice.controller';
import { SuperQaVoiceService } from './superqa-voice.service';
import { SuperQaVoiceController } from './superqa-voice.controller';
import { WorkerWakeupService } from '../../common/worker-wakeup.service';
import { ChatRealtimeService } from './chat-realtime.service';
import { AgentsModule } from '../agents/agents.module';

@Injectable()
class ChatWorker implements OnModuleInit, OnModuleDestroy {
  private active: Promise<void> | null = null;
  private stopped = false;
  private maintenanceTimer?: ReturnType<typeof setInterval>;
  private readonly logger = new Logger(ChatWorker.name);
  constructor(private readonly chat: ChatService, private readonly connectors: ChatConnectors, private readonly meetings: MeetingService, private readonly wakeups: WorkerWakeupService) {}
  onModuleInit() {
    if (process.env.CHAT_WORKER_ENABLED === 'false') return;
    void this.run();
    // Meeting provider state has time-based transitions, so keep a modest watchdog.
    this.maintenanceTimer = setInterval(() => void this.runMaintenance(), 10000);
    this.maintenanceTimer.unref();
  }
  private async tick() {
    try {
      let worked: boolean;
      do {
        worked = (await Promise.all([this.chat.processOne(), this.connectors.deliverOne(), this.meetings.processOne()])).some(Boolean);
      } while (worked && !this.stopped);
    }
    catch { this.logger.warn('Chat worker unavailable; durable work remains in the database'); }
  }
  private async runMaintenance() {
    try { await this.meetings.maintain(); }
    catch { this.logger.warn('Meeting recovery check failed; it will be retried'); }
  }
  private async run() {
    while (!this.stopped) {
      const nextWake = this.wakeups.wait('chat_work_available');
      if (!this.active) this.active = this.tick().finally(() => { this.active = null; });
      await this.active;
      if (!this.stopped) await nextWake;
    }
  }
  async onModuleDestroy() { this.stopped = true; this.wakeups.wake('chat_work_available'); if (this.maintenanceTimer) clearInterval(this.maintenanceTimer); await this.active; }
}

@Module({ imports: [AutonomyModule, AgentsModule, TypeOrmModule.forFeature([...chatEntities, ...meetingEntities, MeetingVoice])], controllers: [ChatController, ChatHookController, MeetingController, MeetingHookController, VoiceController, VoiceBridgeController, SuperQaVoiceController], providers: [ChatService, ChatConnectors, ChatModel, ChatGuard, ChatWorker, MeetingService, { provide: MEETING_SERVICE, useExisting: MeetingService }, MeetingModel, MeetingProvider, VoiceProvider, VoiceService, SuperQaVoiceService, ChatRealtimeService] })
export class ChatModule {}
