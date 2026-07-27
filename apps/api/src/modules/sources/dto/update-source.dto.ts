import { IsString, IsEnum, IsOptional, IsObject, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { SyncMode, AuthType } from '../entities/source.entity';

class OAuthConfigDto {
  @IsOptional()
  @IsString()
  accessToken?: string;

  @IsOptional()
  @IsString()
  refreshToken?: string;

  @IsOptional()
  expiresAt?: Date;
}

class SourceConfigUpdateDto {
  @IsOptional()
  @IsEnum(['token', 'oauth'])
  authType?: AuthType;

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

export class UpdateSourceDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => SourceConfigUpdateDto)
  config?: SourceConfigUpdateDto;

  @IsOptional()
  @IsEnum(['auto', 'manual'])
  syncMode?: SyncMode;
}
