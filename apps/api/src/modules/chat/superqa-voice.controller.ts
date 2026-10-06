import { Body, Controller, Post, Req, UseGuards, UsePipes, ValidationPipe } from '@nestjs/common';
import { Request } from 'express';
import { IsIn, IsOptional, IsString, IsUUID, Length } from 'class-validator';
import { ChatGuard } from './chat.controller';
import { ChatActor } from './chat.service';
import { OPENAI_LIVE_VOICES } from './voice.provider';
import { SuperQaVoiceService } from './superqa-voice.service';

class StartDto {
  @IsString() @Length(1, 48000) sdp: string;
  @IsOptional() @IsString() @IsIn([...OPENAI_LIVE_VOICES]) voice?: string;
}
class SessionDto {
  @IsUUID() id: string;
}

type SuperQaVoiceRequest = Request & { chatActor: ChatActor };

@Controller('agents/superqa/voice')
@UseGuards(ChatGuard)
@UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }))
export class SuperQaVoiceController {
  constructor(private readonly voice: SuperQaVoiceService) {}
  @Post('start') start(@Req() request: SuperQaVoiceRequest, @Body() body: StartDto) { return this.voice.start(request.chatActor, body.sdp, body.voice); }
  @Post('pulse') pulse(@Req() request: SuperQaVoiceRequest, @Body() body: SessionDto) { return this.voice.pulse(request.chatActor, body.id); }
  @Post('stop') stop(@Req() request: SuperQaVoiceRequest, @Body() body: SessionDto) { return this.voice.pulse(request.chatActor, body.id, true); }
}
