import { ArrayMaxSize, Equals, IsArray, IsBoolean, IsIn, IsInt, IsObject, IsOptional, IsString, IsUUID, Length, Max, Min, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export class MeetingAgentParticipantDto {
  @IsUUID() agentId: string;
  @IsString() @Length(1, 1000) role: string;
}

export class MeetingDto {
  @IsUUID() requestId: string;
  @IsUUID() conversationId: string;
  @IsUUID() agentId: string;
  @IsIn(['notes', 'active']) mode: 'notes' | 'active';
  @IsIn(['native', 'teams', 'google_meet']) provider: 'native' | 'teams' | 'google_meet';
  @IsOptional() @IsString() @Length(1, 2000) url?: string;
  @IsOptional() @IsArray() @ArrayMaxSize(4) @IsUUID('all', { each: true }) participantMemberIds?: string[];
  @IsOptional() @IsArray() @ArrayMaxSize(2) @ValidateNested({ each: true }) @Type(() => MeetingAgentParticipantDto) agentParticipants?: MeetingAgentParticipantDto[];
  @IsOptional() @IsBoolean() shareTranscriptWithAgents?: boolean;
  @Equals(true) consent: true;
}
export class JoinMeetingDto {
  @IsUUID() sessionId: string;
  @Equals(true) consent: true;
}
export class PeerDto { @IsUUID() sessionId: string; }
export class SignalDto extends PeerDto {
  @IsUUID() requestId: string;
  @IsUUID() recipient: string;
  @IsObject() payload: { type: string; sdp?: string; candidate?: object };
}
export class EntryDto extends PeerDto {
  @IsUUID() requestId: string;
  @IsString() @Length(1, 2000) text: string;
  @IsIn(['manual', 'browser_caption']) source: 'manual' | 'browser_caption';
}
export class RunDto {
  @IsUUID() requestId: string;
  @IsIn(['notes', 'reply']) kind: 'notes' | 'reply';
  @IsString() @Length(0, 1000) prompt: string;
}
export class PollDto extends PeerDto {
  @IsInt() @Min(0) @Max(2147483647) after: number;
}
export class ActivityMessageDto {
  @IsUUID() requestId: string;
  @IsString() @Length(1, 4000) text: string;
  @IsOptional() @IsUUID() replyToId?: string;
}
