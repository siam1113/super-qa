import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, Equals, IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, IsUUID, Length, Matches, Max, Min, ValidateNested } from 'class-validator';

export class ActionBindingDto {
  @IsIn(['click', 'fill', 'check']) operation: 'click' | 'fill' | 'check';
  @IsOptional() @IsString() @Length(0, 1000) value?: string;
}

export class SubmitExecutionDto {
  @IsUUID() requestId: string;
  @IsUUID() proposalRunId: string;
  @Matches(/^[a-zA-Z0-9_-]{1,100}$/) targetId: string;
  @IsString() @Length(1, 200) actor: string;
  @Equals(true) preconditionsConfirmed: boolean;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(20) @ValidateNested({ each: true }) @Type(() => ActionBindingDto) bindings: ActionBindingDto[];
  @IsOptional() @IsUUID() retryOf?: string;
}

export class BrowserObservationDto {
  @IsInt() @Min(1) @Max(20) caseStep: number;
  @IsBoolean() actionCompleted: boolean;
  @IsString() @Length(0, 1000) actual: string;
  @IsIn(['', 'action_error', 'assertion_missing', 'page_error', 'output_limit']) error: string;
}

export class BrowserReportDto {
  @IsUUID() token: string;
  @IsString() @Length(1, 500) runnerVersion: string;
  @IsIn(['', 'infrastructure_error', 'timeout', 'policy_error']) error: string;
  @IsArray() @ArrayMaxSize(20) @ValidateNested({ each: true }) @Type(() => BrowserObservationDto) observations: BrowserObservationDto[];
  @IsString() @Length(0, 64000) screenshot: string;
}
