import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, RawBodyRequest, Req, UseGuards, UsePipes, ValidationPipe } from '@nestjs/common';
import { Request } from 'express';
import { ChatGuard } from './chat.controller';
import { ChatActor } from './chat.service';
import { ActivityMessageDto, EntryDto, JoinMeetingDto, MeetingDto, PeerDto, PollDto, RunDto, SignalDto } from './meeting.dto';
import { MeetingService } from './meeting.service';

type MeetingRequest = Request & { chatActor: ChatActor };

@Controller('chat')
@UseGuards(ChatGuard)
@UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }))
export class MeetingController {
  constructor(private readonly meetings: MeetingService) {}
  @Get('meetings/active') active(@Req() request: MeetingRequest) { return this.meetings.active(request.chatActor); }
  @Get('meetings/feed') feed(@Req() request: MeetingRequest) { return this.meetings.feed(request.chatActor); }
  @Get('conversations/:id/meetings') list(@Req() request: MeetingRequest, @Param('id', ParseUUIDPipe) id: string) { return this.meetings.list(request.chatActor, id); }
  @Post('meetings') create(@Req() request: MeetingRequest, @Body() body: MeetingDto) { return this.meetings.create(request.chatActor, body); }
  @Get('meetings/:id') detail(@Req() request: MeetingRequest, @Param('id', ParseUUIDPipe) id: string) { return this.meetings.detail(request.chatActor, id); }
  @Post('meetings/:id/join') join(@Req() request: MeetingRequest, @Param('id', ParseUUIDPipe) id: string, @Body() body: JoinMeetingDto) { return this.meetings.join(request.chatActor, id, body); }
  @Post('meetings/:id/poll') poll(@Req() request: MeetingRequest, @Param('id', ParseUUIDPipe) id: string, @Body() body: PollDto) { return this.meetings.poll(request.chatActor, id, body); }
  @Post('meetings/:id/signal') signal(@Req() request: MeetingRequest, @Param('id', ParseUUIDPipe) id: string, @Body() body: SignalDto) { return this.meetings.signal(request.chatActor, id, body); }
  @Post('meetings/:id/leave') leave(@Req() request: MeetingRequest, @Param('id', ParseUUIDPipe) id: string, @Body() body: PeerDto) { return this.meetings.leave(request.chatActor, id, body.sessionId); }
  @Post('meetings/:id/end') end(@Req() request: MeetingRequest, @Param('id', ParseUUIDPipe) id: string) { return this.meetings.end(request.chatActor, id); }
  @Post('meetings/:id/entries') entry(@Req() request: MeetingRequest, @Param('id', ParseUUIDPipe) id: string, @Body() body: EntryDto) { return this.meetings.entry(request.chatActor, id, body); }
  @Post('meetings/:id/activity') postActivity(@Req() request: MeetingRequest, @Param('id', ParseUUIDPipe) id: string, @Body() body: ActivityMessageDto) { return this.meetings.postActivity(request.chatActor, id, body); }
  @Post('meetings/:id/runs') run(@Req() request: MeetingRequest, @Param('id', ParseUUIDPipe) id: string, @Body() body: RunDto) { return this.meetings.enqueue(request.chatActor, id, body); }
  @Post('meetings/:id/runs/:runId/publish') publish(@Req() request: MeetingRequest, @Param('id', ParseUUIDPipe) id: string, @Param('runId', ParseUUIDPipe) runId: string) { return this.meetings.publish(request.chatActor, id, runId); }
  @Post('meetings/:id/runs/:runId/play') play(@Req() request: MeetingRequest, @Param('id', ParseUUIDPipe) id: string, @Param('runId', ParseUUIDPipe) runId: string, @Body() body: PeerDto) { return this.meetings.play(request.chatActor, id, runId, body.sessionId); }
  @Post('meetings/:id/sync') sync(@Req() request: MeetingRequest, @Param('id', ParseUUIDPipe) id: string) { return this.meetings.sync(request.chatActor, id); }
}

@Controller('meeting-hooks')
export class MeetingHookController {
  constructor(private readonly meetings: MeetingService) {}
  @Post('recall') @HttpCode(200)
  callback(@Req() request: RawBodyRequest<Request>) { return this.meetings.callback(request.rawBody, request.headers); }
}
