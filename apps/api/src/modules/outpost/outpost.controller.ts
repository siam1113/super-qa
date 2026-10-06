import { BadRequestException, Body, Controller, Get, Param, Patch, Post, UsePipes, ValidationPipe } from '@nestjs/common';
import { IsArray, IsBoolean, IsIn, IsObject, IsOptional, IsString, IsUUID, MaxLength, MinLength, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { OutpostService } from './outpost.service';
import { OutpostAutonomyLevel, OutpostTrigger } from './outpost.entity';

class TriggerDto {
  @IsIn(['schedule', 'event']) type: 'schedule' | 'event';
  @IsOptional() @IsString() cron?: string;
  @IsOptional() @IsString() event?: string;

  toOutpostTrigger(): OutpostTrigger {
    if (this.type === 'schedule') {
      if (!this.cron) throw new BadRequestException('A schedule trigger requires a cron expression');
      return { type: 'schedule', cron: this.cron };
    }
    if (!this.event) throw new BadRequestException('An event trigger requires an event name');
    return { type: 'event', event: this.event };
  }
}

class CreateActivityDto {
  @IsString() @MinLength(2) @MaxLength(200) name: string;
  @IsOptional() @IsString() @MaxLength(2000) description?: string;
  @IsString() @MinLength(2) @MaxLength(80) skill: string;
  @IsOptional() @IsObject() inputs?: Record<string, unknown>;
  @IsOptional() @IsString() @MaxLength(8000) instructions?: string;
  @IsArray() @ValidateNested({ each: true }) @Type(() => TriggerDto) triggers: TriggerDto[];
  @IsIn(['observer', 'suggest', 'act']) autonomyLevel: OutpostAutonomyLevel;
  @IsUUID() createdBy: string;
}

class SetEnabledDto { @IsBoolean() enabled: boolean; }
class SetAutonomyDto { @IsIn(['observer', 'suggest', 'act']) autonomyLevel: OutpostAutonomyLevel; }
class SetInputsDto { @IsObject() inputs: Record<string, unknown>; }
class SetApprovalDto { @IsBoolean() approved: boolean; }

@Controller('agents/:agentId/outpost')
@UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
export class OutpostController {
  constructor(private readonly outpost: OutpostService) {}

  @Get('activities')
  listActivities(@Param('agentId') agentId: string) {
    return this.outpost.listActivities(agentId);
  }

  @Post('activities')
  createActivity(@Param('agentId') agentId: string, @Body() input: CreateActivityDto) {
    return this.outpost.createCustom(agentId, { ...input, triggers: input.triggers.map(trigger => trigger.toOutpostTrigger()) });
  }

  @Patch('activities/:activityId/enabled')
  setEnabled(@Param('activityId') activityId: string, @Body() input: SetEnabledDto) {
    return this.outpost.setEnabled(activityId, input.enabled);
  }

  @Patch('activities/:activityId/autonomy')
  setAutonomy(@Param('activityId') activityId: string, @Body() input: SetAutonomyDto) {
    return this.outpost.setAutonomyLevel(activityId, input.autonomyLevel);
  }

  @Patch('activities/:activityId/inputs')
  setInputs(@Param('activityId') activityId: string, @Body() input: SetInputsDto) {
    return this.outpost.setInputs(activityId, input.inputs);
  }

  @Post('activities/:activityId/run')
  runNow(@Param('activityId') activityId: string) {
    return this.outpost.runNow(activityId);
  }

  @Get('activities/:activityId/runs')
  listRuns(@Param('activityId') activityId: string) {
    return this.outpost.listRuns(activityId);
  }

  @Get('runs')
  listRecentRuns(@Param('agentId') agentId: string) {
    return this.outpost.listRecentRuns(agentId);
  }

  @Patch('runs/:runId/approval')
  setApproval(@Param('runId') runId: string, @Body() input: SetApprovalDto) {
    return this.outpost.setApproval(runId, input.approved);
  }
}
