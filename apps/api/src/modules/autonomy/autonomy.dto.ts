import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsDefined, IsEmail, IsIn, IsInt, IsObject, IsOptional, IsString, IsUUID, Length, Max, Min, ValidateNested } from 'class-validator';

export class LoginDto { @IsEmail() email: string; @IsString() @Length(1, 256) password: string; }
export class AcceptInvitationDto { @IsString() @Length(40, 60) token: string; @IsString() @Length(12, 256) password: string; }
export class SelectAppDto { @IsUUID() projectId: string; }
export class InviteMemberDto { @IsEmail() email: string; @IsIn(['owner', 'admin', 'member']) role: string; }
export class EnrollProjectDto {
  @IsString() @Length(1, 100) name: string;
  @IsOptional() @IsString() @Length(1, 100) organizationName?: string;
  @IsOptional() @IsUUID() organizationId?: string;
  @IsEmail() @IsOptional() adminEmail?: string;
  @IsOptional() @IsString() @Length(1, 100) workspaceId?: string;
  @IsOptional() @IsString() @Length(1, 100) applicationId?: string;
  @IsOptional() @IsString() @Length(1, 100) environment?: string;
  @IsOptional() @IsArray() @ArrayMaxSize(10) @IsString({ each: true }) origins?: string[];
  @IsOptional() @IsArray() @ArrayMaxSize(10) @IsString({ each: true }) targets?: string[];
  @IsOptional() @IsArray() @ArrayMinSize(1) @ArrayMaxSize(100) @IsString({ each: true }) @Length(1, 200, { each: true }) requirements?: string[];
  @IsOptional() @IsInt() @Min(1) @Max(100) dailyRunLimit?: number;
}

export class CreateOrganizationDto extends EnrollProjectDto { @IsEmail() adminEmail: string; }

export class SupportIntegrationSettingsDto {
  @IsBoolean() enabled: boolean;
  @IsString() @Length(1, 40) provider: string;
  @IsOptional() @IsString() @Length(0, 300) baseUrl?: string;
  @IsOptional() @IsString() @Length(0, 120) workspace?: string;
  @IsOptional() @IsString() @Length(0, 120) queue?: string;
}

export class OrganizationSupportSettingsDto {
  @IsDefined() @ValidateNested() @Type(() => SupportIntegrationSettingsDto) ticketing: SupportIntegrationSettingsDto;
  @IsDefined() @ValidateNested() @Type(() => SupportIntegrationSettingsDto) liveChat: SupportIntegrationSettingsDto;
}

export class IssueKeyDto {
  @IsIn(['owner', 'admin', 'member', 'ci', 'runner']) role: string;
  @IsString() @Length(1, 100) label: string;
  @IsInt() @Min(1) @Max(90) days: number;
}

export class ProjectSettingsDto {
  @IsString() @Length(1, 100) name: string;
  @IsInt() @Min(1) @Max(100) dailyRunLimit: number;
}

export class CreateBenchmarkDto {
  @IsUUID() requestId: string;
  @IsObject() corpus: Record<string, unknown>;
}

export class CreateSuiteDto {
  @IsString() @Length(1, 100) name: string;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(10) @IsObject({ each: true }) checks: Array<Record<string, unknown>>;
  @IsOptional() @IsUUID() previousId?: string;
}

export class RepairPatchDto {
  @IsString() @Length(1, 300) path: string;
  @IsString() @Length(1, 20000) diff: string;
  @IsString() @Length(64, 64) baseContentHash: string;
}

export class StartAutonomousRunDto {
  @IsUUID() requestId: string;
  @IsUUID() suiteId: string;
  @IsOptional() @IsUUID() datasetRequestId?: string;
  @IsOptional() @IsString() @Length(64, 64) datasetContentHash?: string;
  @IsOptional() @ValidateNested() @Type(() => RepairPatchDto) repairPatch?: RepairPatchDto;
}

export class PauseProjectDto {
  @IsBoolean() paused: boolean;
}

export class ApiObservationDto {
  @IsString() @Length(1, 100) checkId: string;
  @IsIn(['', 'network_error', 'policy_error', 'invalid_json', 'timeout', 'response_limit']) error: string;
  @IsInt() @Min(0) @Max(599) status: number;
  @IsOptional() actual?: unknown;
}

export class LiveAssertionDto {
  @IsString() @Length(0, 1000) actual: string;
  @IsBoolean() visible: boolean;
}

export class LiveObservationDto {
  @IsString() @Length(1, 100) checkId: string;
  @IsString() @Length(64, 64) profileHash: string;
  @IsIn(['', 'policy_error', 'execution_error', 'cancelled', 'cleanup_error']) error: string;
  @IsIn(['clean', 'pending', 'not_started']) cleanup: string;
  @IsString() @Length(0, 64) artifactHash: string;
  @IsArray() @ArrayMaxSize(20) @ValidateNested({ each: true }) @Type(() => LiveAssertionDto) assertions: LiveAssertionDto[];
}

export class RepositoryAttemptDto {
  @IsInt() @Min(0) @Max(2) retry: number;
  @IsIn(['passed', 'failed', 'timedOut', 'skipped', 'interrupted']) status: string;
  @IsInt() @Min(0) @Max(300000) durationMs: number;
}

export class RepositoryTestDto {
  @IsString() @Length(64, 64) id: string;
  @IsArray() @ArrayMaxSize(3) @ValidateNested({ each: true }) @Type(() => RepositoryAttemptDto) attempts: RepositoryAttemptDto[];
}

export class RepositoryObservationDto {
  @IsOptional() @IsString() @Length(0, 200) revisionBefore?: string;
  @IsOptional() @IsString() @Length(0, 200) revisionAfter?: string;
  @IsString() @Length(1, 100) checkId: string;
  @IsString() @Length(64, 64) profileHash: string;
  @IsString() @Length(0, 40) revision: string;
  @IsString() @Length(0, 50) frameworkVersion: string;
  @IsIn(['', 'policy_error', 'execution_error', 'cancelled', 'timeout', 'report_error', 'cleanup_error', 'revision_error', 'repair_error']) error: string;
  @IsIn(['clean', 'pending', 'not_started']) cleanup: string;
  @IsIn(['clean', 'pending', 'not_started']) datasetCleanup: string;
  @IsString() @Length(0, 64) artifactHash: string;
  @IsInt() @Min(-1) @Max(255) exitCode: number;
  @IsArray() @ArrayMaxSize(100) @ValidateNested({ each: true }) @Type(() => RepositoryTestDto) tests: RepositoryTestDto[];
  @IsOptional() @IsString() @Length(0, 64) repairPatchHash?: string;
}

export class CleanupReceiptDto {
  @IsUUID() token: string;
  @IsIn(['clean', 'pending', 'not_started']) container: string;
  @IsIn(['clean', 'pending', 'not_started']) dataset: string;
}

export class ApiFlowAssertionDto {
  @IsString() @Length(1, 60) id: string;
  @IsBoolean() present: boolean;
  @IsOptional() actual?: unknown;
}
export class ApiFlowStepDto {
  @IsString() @Length(1, 60) id: string;
  @IsInt() @Min(0) @Max(599) status: number;
  @IsIn(['', 'not_run', 'response_or_transport_error']) error: string;
  @IsArray() @ArrayMaxSize(4) @ValidateNested({ each: true }) @Type(() => ApiFlowAssertionDto) assertions: ApiFlowAssertionDto[];
}
export class ApiFlowObservationDto {
  @IsString() @Length(1, 100) checkId: string;
  @IsString() @Length(64, 64) profileHash: string;
  @IsIn(['', 'policy_error', 'execution_error', 'cancelled', 'cleanup_error']) error: string;
  @IsString() @Length(0, 200) revisionBefore: string;
  @IsString() @Length(0, 200) revisionAfter: string;
  @IsIn(['clean', 'pending', 'not_started']) datasetCleanup: string;
  @IsString() @Length(0, 64) artifactHash: string;
  @IsArray() @ArrayMaxSize(6) @ValidateNested({ each: true }) @Type(() => ApiFlowStepDto) steps: ApiFlowStepDto[];
}

export class CompleteAutonomousRunDto {
  @IsUUID() token: string;
  @IsOptional() @IsArray() @ArrayMaxSize(1) @ValidateNested({ each: true }) @Type(() => ApiFlowObservationDto) apiFlowObservations?: ApiFlowObservationDto[];
  @IsArray() @ArrayMaxSize(10) @ValidateNested({ each: true }) @Type(() => ApiObservationDto) observations: ApiObservationDto[];
  @IsOptional() @IsArray() @ArrayMaxSize(10) @ValidateNested({ each: true }) @Type(() => LiveObservationDto) liveObservations?: LiveObservationDto[];
  @IsOptional() @IsArray() @ArrayMaxSize(1) @ValidateNested({ each: true }) @Type(() => RepositoryObservationDto) repositoryObservations?: RepositoryObservationDto[];
}
