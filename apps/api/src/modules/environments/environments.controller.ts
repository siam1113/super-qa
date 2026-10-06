import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { EnvironmentsService, CreateEnvironmentDto, UpdateEnvironmentDto } from './environments.service';
import { EnvironmentVariable } from './environment.entity';

@Controller('environments')
export class EnvironmentsController {
  constructor(private readonly environmentsService: EnvironmentsService) {}

  @Get()
  async findAll() {
    const environments = await this.environmentsService.findAll();
    return environments.map((env) => ({
      id: env.id,
      name: env.name,
      description: env.description,
      color: env.color,
      variables: env.variables.map((v) => ({
        ...v,
        value: v.isSecret ? '********' : v.value,
      })),
      isDefault: env.isDefault,
      baseUrl: env.baseUrl,
      maxRetries: env.maxRetries,
      retryDelayMs: env.retryDelayMs,
      createdAt: env.createdAt.toISOString(),
      updatedAt: env.updatedAt.toISOString(),
    }));
  }

  @Get(':id')
  async findOne(@Param('id') id: string) {
    const env = await this.environmentsService.findOne(id);
    return {
      id: env.id,
      name: env.name,
      description: env.description,
      color: env.color,
      variables: env.variables.map((v) => ({
        ...v,
        value: v.isSecret ? '********' : v.value,
      })),
      isDefault: env.isDefault,
      baseUrl: env.baseUrl,
      maxRetries: env.maxRetries,
      retryDelayMs: env.retryDelayMs,
      createdAt: env.createdAt.toISOString(),
      updatedAt: env.updatedAt.toISOString(),
    };
  }

  @Post()
  async create(@Body() dto: CreateEnvironmentDto) {
    const env = await this.environmentsService.create(dto);
    return {
      id: env.id,
      name: env.name,
      description: env.description,
      color: env.color,
      variables: env.variables,
      isDefault: env.isDefault,
      baseUrl: env.baseUrl,
      maxRetries: env.maxRetries,
      retryDelayMs: env.retryDelayMs,
      createdAt: env.createdAt.toISOString(),
      updatedAt: env.updatedAt.toISOString(),
    };
  }

  @Patch(':id')
  async update(@Param('id') id: string, @Body() dto: UpdateEnvironmentDto) {
    const env = await this.environmentsService.update(id, dto);
    return {
      id: env.id,
      name: env.name,
      description: env.description,
      color: env.color,
      variables: env.variables.map((v) => ({
        ...v,
        value: v.isSecret ? '********' : v.value,
      })),
      isDefault: env.isDefault,
      baseUrl: env.baseUrl,
      maxRetries: env.maxRetries,
      retryDelayMs: env.retryDelayMs,
      createdAt: env.createdAt.toISOString(),
      updatedAt: env.updatedAt.toISOString(),
    };
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async delete(@Param('id') id: string) {
    await this.environmentsService.delete(id);
  }

  @Post(':id/default')
  async setDefault(@Param('id') id: string) {
    const env = await this.environmentsService.setDefault(id);
    return {
      id: env.id,
      name: env.name,
      isDefault: env.isDefault,
    };
  }

  @Post(':id/variables')
  async addVariable(@Param('id') id: string, @Body() variable: EnvironmentVariable) {
    const env = await this.environmentsService.addVariable(id, variable);
    return {
      id: env.id,
      variables: env.variables.map((v) => ({
        ...v,
        value: v.isSecret ? '********' : v.value,
      })),
    };
  }

  @Patch(':id/variables/:key')
  async updateVariable(
    @Param('id') id: string,
    @Param('key') key: string,
    @Body() updates: Partial<EnvironmentVariable>,
  ) {
    const env = await this.environmentsService.updateVariable(id, key, updates);
    return {
      id: env.id,
      variables: env.variables.map((v) => ({
        ...v,
        value: v.isSecret ? '********' : v.value,
      })),
    };
  }

  @Delete(':id/variables/:key')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteVariable(@Param('id') id: string, @Param('key') key: string) {
    await this.environmentsService.deleteVariable(id, key);
  }
}
