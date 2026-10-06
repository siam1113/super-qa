import { BadRequestException, Body, ConflictException, Controller, Get, Headers, NotFoundException, Param, Post, ServiceUnavailableException, UnauthorizedException, UsePipes, ValidationPipe } from '@nestjs/common';
import { IsIn, IsString, IsUUID, Matches, MaxLength, MinLength } from 'class-validator';
import { createHash, createHmac, timingSafeEqual } from 'crypto';
import { DataSource } from 'typeorm';
import { QaAuditEvent, QaProject } from './autonomy.entity';
import { WorkflowArtifact } from './workflow-artifact.entity';

class PublishArtifactDto {
  @IsUUID() projectId: string;
  @IsUUID() requestId: string;
  @IsIn(['qae', 'aue']) agentType: string;
  @IsString() @Matches(/^[a-z][a-z0-9_]{0,79}$/) skill: string;
  @IsString() @MinLength(2) @MaxLength(1500000) resultJson: string;
}

class ReadArtifactParams {
  @IsUUID() projectId: string;
  @IsUUID() requestId: string;
}

@Controller('workflow-artifacts')
@UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }))
export class WorkflowArtifactController {
  constructor(private readonly database: DataSource) {}

  @Get(':projectId/:requestId')
  async read(@Param() input: ReadArtifactParams, @Headers('x-workflow-timestamp') timestamp = '', @Headers('x-workflow-signature') signature = '') {
    const key = process.env.AGENT_MEMORY_SIGNING_KEY || '';
    if (key.length < 32) throw new ServiceUnavailableException('Workflow retrieval is not configured');
    if (!/^\d{10,13}$/.test(timestamp) || Math.abs(Date.now() - Number(timestamp)) > 300000 || !/^[a-f0-9]{64}$/.test(signature)) throw new UnauthorizedException();
    const expected = createHmac('sha256', key).update('qa-workflow-read-v1\n' + [timestamp, input.projectId, input.requestId].join('\n')).digest();
    if (!timingSafeEqual(expected, Buffer.from(signature, 'hex'))) throw new UnauthorizedException();
    const record = await this.database.getRepository(WorkflowArtifact).findOneBy({ projectId: input.projectId, requestId: input.requestId });
    if (!record) throw new NotFoundException('Workflow artifact is unavailable in this app');
    return { requestId: record.requestId, contentHash: record.contentHash, resultJson: record.resultJson };
  }

  @Post()
  async publish(@Body() input: PublishArtifactDto, @Headers('x-workflow-timestamp') timestamp = '', @Headers('x-workflow-signature') signature = '') {
    const key = process.env.AGENT_MEMORY_SIGNING_KEY || '';
    if (key.length < 32) throw new ServiceUnavailableException('Workflow publication is not configured');
    if (!/^\d{10,13}$/.test(timestamp) || Math.abs(Date.now() - Number(timestamp)) > 300000 || !/^[a-f0-9]{64}$/.test(signature)) throw new UnauthorizedException();
    const signed = [timestamp, input.projectId, input.requestId, input.agentType, input.skill, input.resultJson].join('\n');
    const expected = createHmac('sha256', key).update('qa-workflow-artifact-v1\n' + signed).digest();
    if (!timingSafeEqual(expected, Buffer.from(signature, 'hex'))) throw new UnauthorizedException();
    if (Buffer.byteLength(input.resultJson) > 1500000) throw new BadRequestException('Artifact exceeds its byte budget');
    let result: Record<string, unknown>;
    try { result = JSON.parse(input.resultJson); } catch { throw new BadRequestException('Invalid artifact JSON'); }
    if (!result || typeof result !== 'object' || Array.isArray(result) || result.request_id !== input.requestId || result.agent_type !== input.agentType || result.skill !== input.skill || result.version !== 1 || !result.data || typeof result.data !== 'object' || Array.isArray(result.data) || !['completed', 'blocked', 'failed', 'interrupted'].includes(String(result.status)) || typeof result.summary !== 'string' || result.summary.length > 4000 || typeof result.created_at !== 'string' || !Number.isFinite(Date.parse(result.created_at))) throw new BadRequestException('Artifact metadata does not match its envelope');
    const contentHash = createHash('sha256').update(input.resultJson).digest('hex');
    return this.database.transaction(async manager => {
      const project = await manager.findOne(QaProject, { where: { id: input.projectId }, lock: { mode: 'pessimistic_write' } });
      if (!project) throw new UnauthorizedException('Unknown app scope');
      const previous = await manager.findOneBy(WorkflowArtifact, { projectId: project.id, requestId: input.requestId });
      if (previous) {
        if (previous.contentHash !== contentHash || previous.agentType !== input.agentType || previous.skill !== input.skill) throw new ConflictException('Artifact request ID already has different content');
        return { id: previous.id, requestId: previous.requestId, contentHash: previous.contentHash };
      }
      const artifact = await manager.save(manager.create(WorkflowArtifact, {
        projectId: project.id, requestId: input.requestId, agentType: input.agentType, skill: input.skill,
        schemaVersion: 1, contentHash, resultJson: input.resultJson, status: String(result.status),
        summary: result.summary as string, producedAt: new Date(result.created_at as string),
      }));
      await manager.save(manager.create(QaAuditEvent, { projectId: project.id, actor: 'agent-runtime:' + input.agentType,
        action: 'workflow.artifact.published', data: { artifactId: artifact.id, requestId: artifact.requestId, skill: artifact.skill, contentHash } }));
      return { id: artifact.id, requestId: artifact.requestId, contentHash };
    });
  }
}
