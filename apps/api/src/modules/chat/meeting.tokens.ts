// String DI token for MeetingService, used by ChatService to avoid a circular runtime import
// (ChatService -> MeetingService -> ChatService) while MeetingService itself stays a normal import.
export const MEETING_SERVICE = 'MEETING_SERVICE';
