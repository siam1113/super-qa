import { Injectable } from '@nestjs/common';
import { Observable } from 'rxjs';
import { WorkerWakeupService } from '../../common/worker-wakeup.service';

interface ChatEvent {
  data: object;
  type: string;
}

@Injectable()
export class ChatRealtimeService {
  constructor(private readonly wakeups: WorkerWakeupService) {}

  stream(projectId: string): Observable<ChatEvent> {
    return new Observable<ChatEvent>(subscriber => {
      const emit = (payload: any) => {
        if (payload?.reconnected) {
          subscriber.next({ type: 'connected', data: { ready: true, resync: true } });
          return;
        }
        if (payload?.projectId !== projectId) return;
        subscriber.next({ type: 'change', data: {
          table: payload.table,
          conversationId: payload.conversationId,
          meetingId: payload.meetingId,
          id: payload.id,
        } });
      };
      const unsubscribeChat = this.wakeups.subscribe('chat_work_available', emit);
      const unsubscribeCalendar = this.wakeups.subscribe('calendar_work_available', emit);
      subscriber.next({ type: 'connected', data: { ready: true } });
      const heartbeat = setInterval(() => subscriber.next({ type: 'heartbeat', data: { at: Date.now() } }), 30000);
      return () => {
        clearInterval(heartbeat);
        unsubscribeChat();
        unsubscribeCalendar();
      };
    });
  }

  taskStream(agentType: string): Observable<ChatEvent> {
    return new Observable<ChatEvent>(subscriber => {
      const emit = (payload: any) => {
        if (payload?.reconnected) {
          subscriber.next({ type: 'connected', data: { ready: true, resync: true } });
          return;
        }
        if (payload?.agentType !== agentType) return;
        subscriber.next({ type: 'change', data: { id: payload.id } });
      };
      const unsubscribe = this.wakeups.subscribe('agent_task_available', emit);
      subscriber.next({ type: 'connected', data: { ready: true } });
      return unsubscribe;
    });
  }
}
