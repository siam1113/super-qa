import { IsUUID } from 'class-validator';

export class GenerateTestCasesDto {
  @IsUUID() sourceId: string;
}

export class CompleteOnboardingDto {
  @IsUUID() projectId: string;
}
