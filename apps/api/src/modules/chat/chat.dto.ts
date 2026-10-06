import { ArrayMaxSize, ArrayUnique, IsArray, IsIn, IsInt, IsNumber, IsObject, IsOptional, IsString, IsUUID, Length, Matches, Max, Min } from 'class-validator';
import { OPENAI_LIVE_VOICES } from './voice.provider';
import { chatPromptScenarios } from './chat.entity';

export class AgentDto {
  @IsString() @Length(1, 60) @Matches(/^[\p{L}\p{N}][\p{L}\p{N} _-]*$/u) name: string;
  @IsOptional() @IsIn(['fox', 'panda', 'koala', 'frog', 'penguin', 'owl', 'tiger', 'octopus', 'whale', 'butterfly', 'turtle', 'unicorn']) avatar?: string | null;
  @IsOptional() @IsArray() @ArrayMaxSize(10) @ArrayUnique() @IsString({ each: true }) @Length(1, 60, { each: true }) @Matches(/^[\p{L}\p{N}][\p{L}\p{N} _-]*$/u, { each: true }) aliases?: string[];
}

export class AgentModelDto {
  @IsIn(['default', 'openai', 'anthropic', 'ollama']) provider: 'default' | 'openai' | 'anthropic' | 'ollama';
  @IsString() @Length(0, 200) model: string;
}

export class AgentLimitsDto {
  // null resets to the platform default (see runtimeSettings().defaultMaxIterations).
  @IsOptional() @IsInt() @Min(1) @Max(20) maxIterations?: number | null;
}

export class AgentTemperatureDto {
  // null resets to the platform default (see runtimeSettings().defaultTemperature).
  @IsOptional() @IsNumber() @Min(0) @Max(1) temperature?: number | null;
}

export class AgentMemoryDto {
  @IsIn(['preference', 'decision', 'workflow', 'constraint']) category: 'preference' | 'decision' | 'workflow' | 'constraint';
  @IsString() @Length(1, 2000) content: string;
  @IsOptional() @IsInt() @Min(1) @Max(5) importance?: number;
  @IsOptional() @IsString() @Length(10, 40) expiresAt?: string | null;
}

export class AgentMemoryContextDto {
  @IsString() @Length(1, 8000) query: string;
}

export class AgentVoicePreviewDto {
  @IsIn([...OPENAI_LIVE_VOICES]) voice: string;
}

export class PromptDto {
  @IsString() @Length(1, 60) name: string;
  @IsString() @Length(1, 4000) content: string;
}

export class PromptInstallDto {
  @IsIn(chatPromptScenarios) scenario: 'conversation' | 'meeting';
  @IsOptional() @IsUUID() promptId?: string | null;
}

export class AgentRuntimeDto {
  @IsString() @Length(1, 8000) message: string;
  @IsOptional() @IsUUID() sessionId?: string | null;
  @IsOptional() @IsUUID() meetingContextId?: string | null;
}

export class ConversationDto {
  @IsIn(['direct', 'group']) kind: 'direct' | 'group';
  @IsString() @Length(1, 100) title: string;
  @IsArray() @ArrayMaxSize(50) @ArrayUnique() @IsUUID('4', { each: true }) memberIds: string[];
  @IsOptional() @IsUUID() agentId?: string | null;
  @IsOptional() @IsArray() @ArrayMaxSize(10) @ArrayUnique() @IsUUID('4', { each: true }) agentIds?: string[];
  @IsOptional() @IsObject() agentInstructions?: Record<string, string>;
  @IsString() @Length(0, 4000) instructions: string;
}

export class ConversationPolicyDto {
  @IsOptional() @IsUUID() agentId?: string | null;
  @IsOptional() @IsArray() @ArrayMaxSize(10) @ArrayUnique() @IsUUID('4', { each: true }) agentIds?: string[];
  @IsOptional() @IsObject() agentInstructions?: Record<string, string>;
  @IsString() @Length(0, 4000) instructions: string;
  @IsArray() @ArrayMaxSize(50) @ArrayUnique() @IsUUID('4', { each: true }) memberIds: string[];
}

export class MessageDto {
  @IsUUID() requestId: string;
  @IsString() @Length(1, 8000) text: string;
  @IsOptional() @IsUUID() replyToId?: string;
  @IsOptional() @IsUUID() meetingContextId?: string;
}

export class InstallationDto {
  @IsIn(['slack', 'teams']) provider: 'slack' | 'teams';
  @IsOptional() @IsIn(['read_only', 'read_reply']) accessMode?: 'read_only' | 'read_reply';
  @IsOptional() @IsString() @Length(1, 100) name?: string;
  @IsString() @Length(1, 200) providerId: string;
  @IsString() @Length(1, 200) botId: string;
  @IsString() @Length(10, 4096) token: string;
  @IsOptional() @IsString() @Length(10, 4096) signingSecret?: string;
}

export class InstallationAccessDto {
  @IsIn(['read_only', 'read_reply']) accessMode: 'read_only' | 'read_reply';
}

export class ExternalConversationDto {
  @IsString() @Length(1, 100) title: string;
  @IsString() @Length(1, 500) externalId: string;
  @IsArray() @ArrayMaxSize(50) @ArrayUnique() @IsUUID('4', { each: true }) memberIds: string[];
  @IsString() @Length(0, 4000) instructions: string;
}
