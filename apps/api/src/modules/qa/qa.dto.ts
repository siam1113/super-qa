import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsIn, IsInt, IsNumber, IsObject, IsOptional, IsString, IsUUID, Length, Max, Min, ValidateNested } from 'class-validator';

export class QaStepDto {
  @IsString() @Length(1, 4000) action: string;
  @IsString() @Length(1, 4000) expected: string;
}

export class CreateQaCaseDto {
  @IsOptional() @IsArray() @ArrayMaxSize(50) @IsString({ each: true }) @Length(1, 4000, { each: true }) preconditions?: string[];
  @IsString() @Length(1, 300) title: string;
  @IsOptional() @IsIn(['P0', 'P1', 'P2', 'P3']) priority?: string;
  @IsOptional() @IsString() @Length(0, 200) owner?: string;
  @IsOptional() @IsString() @Length(0, 200) flow?: string;
  @IsOptional() @IsIn(['low', 'medium', 'high', 'critical']) risk?: string;
  @IsOptional() @IsIn(['automated', 'manual', 'partial']) automation?: string;
  @IsOptional() @IsIn(['draft', 'ready', 'approved', 'rejected']) reviewStatus?: string;
  @IsOptional() @IsIn(['smoke', 'regression', 'sanity', 'functional', 'integration', 'exploratory', 'performance', 'security', 'acceptance']) category?: string;
  @IsOptional() @IsIn(['boundary-value', 'equivalence-partitioning', 'decision-table', 'state-transition', 'exploratory', 'error-guessing', 'pairwise', 'use-case']) technique?: string;
  @IsOptional() @IsIn(['blocker', 'critical', 'major', 'minor', 'trivial']) severity?: string;
  @IsOptional() @IsIn(['web', 'mobile', 'desktop', 'api', 'backend']) platform?: string;
  @IsOptional() @IsString() @Length(0, 500) baseUrl?: string;
  @IsOptional() @IsArray() @ArrayMaxSize(20) @IsString({ each: true }) @Length(1, 100, { each: true }) tags?: string[];
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(50) @ValidateNested({ each: true }) @Type(() => QaStepDto) steps: QaStepDto[];
}

export class UpdateQaCaseDto extends CreateQaCaseDto {
  @IsInt() @Min(1) revision: number;
}

export class ImportArtifactCasesDto {
  @IsUUID() artifactId: string;
}

export class GenerateQaCasesDto {
  @IsIn(['instruction', 'ticket', 'exploration']) mode: 'instruction' | 'ticket' | 'exploration';
  @IsOptional() @IsString() @Length(1, 4000) instructions?: string;
  @IsOptional() @IsUUID() documentId?: string;
  @IsOptional() @IsInt() @Min(1) @Max(8) count?: number;
  // Exploration mode only: drives a real explore_app run against this
  // environment's baseUrl instead of just summarizing catalogued coverage.
  @IsOptional() @IsUUID() environmentId?: string;
  // Client-generated id so the wizard can open its live-exploration viewer
  // before this request resolves; becomes the agents runtime's live run id.
  @IsOptional() @IsUUID() explorationRunId?: string;
  // Exploration mode only: optional relative path to start the crawl from
  // instead of the environment's base URL (e.g. "/checkout"). Validated
  // strictly by the explore_app skill itself; an invalid path just degrades
  // to no exploration summary, same as any other exploration failure.
  @IsOptional() @IsString() @Length(1, 500) explorationStartPath?: string;
}

export class RefineQaCaseDto {
  @IsOptional() @IsUUID() testCaseId?: string;
  @IsOptional() @IsString() @Length(1, 300) externalTitle?: string;
  @IsOptional() @IsString() @Length(1, 8000) externalDescription?: string;
  @IsString() @Length(1, 4000) instructions: string;
  @IsOptional() @IsArray() @ArrayMaxSize(10) @IsString({ each: true }) @Length(1, 2000, { each: true }) links?: string[];
}

export class ImportArtifactCasesByRequestDto {
  @IsUUID() projectId: string;
  @IsUUID() requestId: string;
}

export class ReviewQaCaseDto {
  @IsInt() @Min(1) revision: number;
  @IsIn(['approved', 'rejected']) status: 'approved' | 'rejected';
  @IsString() @Length(1, 200) reviewer: string;
}

export class CreateQaRunDto {
  @IsOptional() @IsUUID() requestId?: string;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(100) @IsUUID('all', { each: true }) testIds: string[];
  @IsOptional() @IsString() @Length(1, 100) environment?: string;
  @IsOptional() @IsString() @Length(1, 100) browser?: string;
}

export class StepResultDto {
  @IsString() @Length(1, 8000) actual: string;
  @IsBoolean() passed: boolean;
  @IsString() @Length(1, 2000) evidence: string;
}

export class RecordQaResultDto {
  @IsString() @Length(1, 200) reporter: string;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(50) @ValidateNested({ each: true }) @Type(() => StepResultDto) steps: StepResultDto[];
  @IsNumber() @Min(0) @Max(86400) duration: number;
}

export class CreateHealingDto {
  @IsString() @Length(1, 4000) issue: string;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(100) @IsUUID('all', { each: true }) affectedTests: string[];
  @IsString() @Length(1, 2000) currentLocator: string;
  @IsString() @Length(1, 2000) suggestedLocator: string;
  @IsOptional() @IsString() @Length(0, 4000) rootCause?: string;
  @IsOptional() @IsString() @Length(0, 200) owner?: string;
}

export class HealingReviewDto {
  @IsString() @Length(1, 200) reviewer: string;
}

export class RunWithAgentDto {
  @IsOptional() @IsString() @Length(1, 100) environment?: string;
  @IsOptional() @IsString() @Length(1, 100) browser?: string;
}

export class AgentExecutionResultDto {
  @IsString() @Length(1, 100) agentRunId: string;
  @IsString() @Length(1, 50) status: string;
  @IsObject() result: Record<string, unknown>;
}

export class SaveQaPlanDto {
  @IsString() @Length(1, 200) name: string;
  @IsOptional() @IsString() @Length(0, 4000) description?: string;
  @IsArray() @ArrayMaxSize(100) @IsUUID('all', { each: true }) testIds: string[];
  @IsOptional() @IsString() @Length(1, 100) environment?: string;
  @IsOptional() @IsString() @Length(1, 100) browser?: string;
}
