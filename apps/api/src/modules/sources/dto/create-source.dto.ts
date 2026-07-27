import { IsString, IsEnum, IsOptional, IsObject, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { SourceType, SyncMode, AuthType } from '../entities/source.entity';

class OAuthConfigDto {
  @IsString()
  accessToken: string;

  @IsString()
  refreshToken: string;

  @IsOptional()
  expiresAt?: Date;
}

class SourceConfigDto {
  @IsEnum(['token', 'oauth'])
  authType: AuthType;

  @IsOptional()
  @IsString()
  token?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => OAuthConfigDto)
  oauth?: OAuthConfigDto;

  @IsOptional()
  @IsString()
  baseUrl?: string;

  @IsOptional()
  @IsString()
  repository?: string;

  @IsOptional()
  @IsString()
  project?: string;

  @IsOptional()
  @IsString()
  spaceKey?: string;

  @IsOptional()
  @IsObject()
  additionalConfig?: Record<string, unknown>;
}

export class CreateSourceDto {
  @IsString()
  name: string;

  @IsEnum([
    'github',
    'jira',
    'confluence',
    'notion',
    'zephyr',
    'azure',
    'gitlab',
    'postman',
    'swagger',
    'database',
    'api',
  ])
  type: SourceType;

  @ValidateNested()
  @Type(() => SourceConfigDto)
  config: SourceConfigDto;

  @IsOptional()
  @IsEnum(['auto', 'manual'])
  syncMode?: SyncMode;
}
