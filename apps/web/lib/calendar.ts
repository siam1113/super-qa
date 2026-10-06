import { Conversation } from './chat';
import { Meeting } from './meetings';

export type MeetingTiming = { startedAt: string; endedAt: string | null; durationSeconds: number | null };
export type MeetingFeed = { meetings: Meeting[]; meetingTimings: Record<string, MeetingTiming>; meetingHighlights: Record<string, string[]>; conversations: Conversation[]; configured: { meetingBot: boolean } };
