export type MeetingAttendee = { name: string; email: string; response: string };
export type Meeting = { id: string; conversationId: string; createdBy: string; agentId: string; agentParticipants?: { agentId: string; role: string }[]; participantMemberIds?: string[]; shareTranscriptWithAgents?: boolean; title: string; scheduledStart: string | null; scheduledEnd: string | null; attendees: MeetingAttendee[]; mode: 'notes' | 'active'; liveVoice: boolean; provider: 'native' | 'teams' | 'google_meet'; status: string; stopped: boolean; error: string | null; url: string | null; createdAt: string; liveAt?: string | null };
export type MeetingEntry = { id: string; sequence: number; speaker: string; text: string; source: string; createdAt: string };
export type MeetingRun = { id: string; kind: string; status: string; error: string | null; delivery: string | null; publishedMessageId: string | null; voiceAt: string | null; result: { summary: string; reply: string | null; items: { kind: string; text: string; evidence: string[] }[] } | null };
export type MeetingActivityEntry = { id: string; sequence: number; kind: 'human_joined' | 'human_left' | 'agent_joined' | 'agent_left' | 'meeting_ended' | 'message'; authorId: string | null; authorKind: 'member' | 'agent' | 'system' | null; authorName: string | null; text: string | null; replyToId: string | null; createdAt: string };
export type MeetingDetail = { meeting: Meeting; entries: MeetingEntry[]; runs: MeetingRun[]; peers?: { memberId: string; name: string }[]; voices?: { agentId: string; status: string; seconds: number; finalized: boolean; error: string | null }[]; activity?: MeetingActivityEntry[] };
export type CallPeer = { sessionId: string; memberId: string; name: string };

// Rough estimate (~4 chars/token), the standard approximation for English GPT tokenization;
// no exact tokenizer is used here since this only drives an informational UI count.
export const estimateTokenCount = (text: string) => Math.ceil(text.length / 4);
