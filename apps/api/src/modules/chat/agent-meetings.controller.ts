import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { MeetingService } from './meeting.service';

// Unguarded, read-only routes for the Python agents runtime (no session cookie, not a
// conversation member) — see meeting.service.ts's agentListMeetings/agentMeetingNotes
// for why projectId must be supplied explicitly rather than resolved from a guard.
@Controller('chat')
export class AgentMeetingsController {
  constructor(private readonly meetings: MeetingService) {}

  @Get('agent-meetings')
  list(@Query('projectId', ParseUUIDPipe) projectId: string, @Query('limit') limit?: string) {
    return this.meetings.agentListMeetings(projectId, limit ? parseInt(limit, 10) : undefined);
  }

  @Get('agent-meetings/:id/notes')
  notes(@Param('id', ParseUUIDPipe) id: string, @Query('projectId', ParseUUIDPipe) projectId: string) {
    return this.meetings.agentMeetingNotes(projectId, id);
  }
}
