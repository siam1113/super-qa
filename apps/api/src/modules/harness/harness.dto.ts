import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsIn, IsInt, IsObject, IsOptional, IsString, IsUUID, Length, Matches, Max, Min, ValidateNested } from 'class-validator';

export class EvidenceReferenceDto {
  @IsUUID() documentId: string;
  @Matches(/^[a-f0-9]{64}$/) revisionHash: string;
}

export class HarnessBudgetDto {
  @IsInt() @Min(1) @Max(3) modelCalls: number;
  @IsInt() @Min(2048) @Max(64000) inputTokens: number;
  @IsInt() @Min(128) @Max(16000) outputTokens: number;
  @IsInt() @Min(128) @Max(4096) outputTokensPerCall: number;
  @IsInt() @Min(10) @Max(600) wallSeconds: number;
  @IsInt() @Min(1) @Max(10000000000) costNanoUsd: number;
}

export class SubmitHarnessDto {
  @IsUUID() requestId: string;
  @IsString() @Length(1, 100) workspaceId: string;
  @IsString() @Length(1, 100) applicationId: string;
  @IsString() @Length(1, 100) environment: string;
  @IsString() @Length(1, 200) actor: string;
  @IsIn(['qae', 'aue']) role: 'qae' | 'aue';
  @IsString() @Length(1, 2000) objective: string;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(4) @ValidateNested({ each: true }) @Type(() => EvidenceReferenceDto) evidence: EvidenceReferenceDto[];
  @IsObject() @ValidateNested() @Type(() => HarnessBudgetDto) budget: HarnessBudgetDto;
  @IsOptional() @IsUUID() caseId?: string;
  @IsOptional() @IsInt() @Min(1) caseRevision?: number;
}

export class HarnessUsageDto {
  @IsInt() @Min(0) @Max(10000000) inputTokens: number;
  @IsInt() @Min(0) @Max(10000000) outputTokens: number;
}

export class CompleteHarnessDto {
  @IsUUID() token: string;
  @IsIn(['proposal', 'blocked', 'failed']) outcome: 'proposal' | 'blocked' | 'failed';
  @IsOptional() @IsObject() proposal?: Record<string, unknown>;
  @IsString() @Length(1, 500) reason: string;
  @IsOptional() @IsObject() @ValidateNested() @Type(() => HarnessUsageDto) usage?: HarnessUsageDto;
}

export class ReviewHarnessDto {
  @IsIn(['approved', 'rejected']) decision: 'approved' | 'rejected';
  @IsString() @Length(1, 200) reviewer: string;
}
