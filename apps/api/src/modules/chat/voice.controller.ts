import { Body, Controller, Param, ParseUUIDPipe, Post, Req, UseGuards, UsePipes, ValidationPipe } from '@nestjs/common';
import { Equals, IsBoolean, IsIn, IsOptional, IsString, IsUUID, Length } from 'class-validator';
import { Request } from 'express';
import { ChatGuard } from './chat.controller';
import { ChatActor } from './chat.service';
import { VoiceService } from './voice.service';
import { OPENAI_LIVE_VOICES } from './voice.provider';

class OfferDto { @IsString() @Length(1, 48000) sdp: string; }
class NativeOfferDto extends OfferDto { @IsUUID() sessionId: string; @IsUUID() agentId: string; @Equals(true) consent: true; @IsOptional() @IsBoolean() reconnect?: boolean; @IsOptional() @IsString() @IsIn([...OPENAI_LIVE_VOICES]) voice?: string; }
class VoicePeerDto { @IsUUID() sessionId: string; @IsUUID() agentId: string; }

@Controller('chat/meetings')
@UseGuards(ChatGuard)
@UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }))
export class VoiceController {
  constructor(private readonly voice: VoiceService) {}
  @Post(':id/voice/start') start(@Req() request: Request & { chatActor: ChatActor }, @Param('id', ParseUUIDPipe) id: string, @Body() body: NativeOfferDto) { return this.voice.native(request.chatActor, id, body.sessionId, body.sdp, body.agentId, body.reconnect, body.voice); }
  @Post(':id/voice/pulse') pulse(@Req() request: Request & { chatActor: ChatActor }, @Param('id', ParseUUIDPipe) id: string, @Body() body: VoicePeerDto) { return this.voice.pulse(request.chatActor, id, body.sessionId, body.agentId); }
  @Post(':id/voice/stop') stop(@Req() request: Request & { chatActor: ChatActor }, @Param('id', ParseUUIDPipe) id: string, @Body() body: VoicePeerDto) { return this.voice.pulse(request.chatActor, id, body.sessionId, body.agentId, undefined, true); }
}

@Controller('meeting-voice')
@UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }))
export class VoiceBridgeController {
  constructor(private readonly voice: VoiceService) {}
  private token(request: Request) { const token = request.headers.authorization || ''; return /^Bearer [A-Za-z0-9_-]{43}$/.test(token) ? token.slice(7) : ''; }
  @Post(':id/start') start(@Req() request: Request, @Param('id', ParseUUIDPipe) id: string, @Body() body: OfferDto) { return this.voice.external(id, this.token(request), body.sdp); }
  @Post(':id/pulse') pulse(@Req() request: Request, @Param('id', ParseUUIDPipe) id: string) { return this.voice.pulse(null, id, null, null, this.token(request)); }
  @Post(':id/stop') stop(@Req() request: Request, @Param('id', ParseUUIDPipe) id: string) { return this.voice.pulse(null, id, null, null, this.token(request), true); }
}
