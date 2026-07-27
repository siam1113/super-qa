import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Environment, EnvironmentVariable } from './environment.entity';

export interface CreateEnvironmentDto {
  name: string;
  description?: string;
  color?: string;
  variables?: EnvironmentVariable[];
}

export interface UpdateEnvironmentDto {
  name?: string;
  description?: string;
  color?: string;
  variables?: EnvironmentVariable[];
}

@Injectable()
export class EnvironmentsService {
  constructor(
    @InjectRepository(Environment)
    private environmentRepository: Repository<Environment>,
  ) {}

  async findAll(): Promise<Environment[]> {
    return this.environmentRepository.find({
      order: { isDefault: 'DESC', name: 'ASC' },
    });
  }

  async findOne(id: string): Promise<Environment> {
    const environment = await this.environmentRepository.findOne({ where: { id } });
    if (!environment) {
      throw new NotFoundException(`Environment with ID ${id} not found`);
    }
    return environment;
  }

  async findDefault(): Promise<Environment | null> {
    return this.environmentRepository.findOne({ where: { isDefault: true } });
  }

  async create(dto: CreateEnvironmentDto): Promise<Environment> {
    // If this is the first environment, make it default
    const count = await this.environmentRepository.count();
    
    const environment = this.environmentRepository.create({
      name: dto.name,
      description: dto.description || null,
      color: dto.color || '#3B82F6',
      variables: dto.variables || [],
      isDefault: count === 0,
    });

    return this.environmentRepository.save(environment);
  }

  async update(id: string, dto: UpdateEnvironmentDto): Promise<Environment> {
    const environment = await this.findOne(id);

    if (dto.name !== undefined) {
      environment.name = dto.name;
    }
    if (dto.description !== undefined) {
      environment.description = dto.description;
    }
    if (dto.color !== undefined) {
      environment.color = dto.color;
    }
    if (dto.variables !== undefined) {
      environment.variables = dto.variables;
    }

    return this.environmentRepository.save(environment);
  }

  async delete(id: string): Promise<void> {
    const environment = await this.findOne(id);
    const wasDefault = environment.isDefault;
    
    await this.environmentRepository.remove(environment);

    // If we deleted the default, set another one as default
    if (wasDefault) {
      const first = await this.environmentRepository.findOne({
        order: { createdAt: 'ASC' },
      });
      if (first) {
        first.isDefault = true;
        await this.environmentRepository.save(first);
      }
    }
  }

  async setDefault(id: string): Promise<Environment> {
    // Remove default from current default
    await this.environmentRepository.update({}, { isDefault: false });

    // Set new default
    const environment = await this.findOne(id);
    environment.isDefault = true;
    return this.environmentRepository.save(environment);
  }

  async addVariable(id: string, variable: EnvironmentVariable): Promise<Environment> {
    const environment = await this.findOne(id);
    
    // Check if variable already exists
    const exists = environment.variables.some((v) => v.key === variable.key);
    if (exists) {
      throw new Error(`Variable ${variable.key} already exists`);
    }

    environment.variables.push(variable);
    return this.environmentRepository.save(environment);
  }

  async updateVariable(
    id: string,
    key: string,
    updates: Partial<EnvironmentVariable>,
  ): Promise<Environment> {
    const environment = await this.findOne(id);
    
    const varIndex = environment.variables.findIndex((v) => v.key === key);
    if (varIndex === -1) {
      throw new NotFoundException(`Variable ${key} not found`);
    }

    environment.variables[varIndex] = {
      ...environment.variables[varIndex],
      ...updates,
    };

    return this.environmentRepository.save(environment);
  }

  async deleteVariable(id: string, key: string): Promise<Environment> {
    const environment = await this.findOne(id);
    environment.variables = environment.variables.filter((v) => v.key !== key);
    return this.environmentRepository.save(environment);
  }

  /**
   * Get variables for an environment, optionally masking secrets
   */
  async getVariables(id: string, maskSecrets = true): Promise<EnvironmentVariable[]> {
    const environment = await this.findOne(id);
    
    if (maskSecrets) {
      return environment.variables.map((v) => ({
        ...v,
        value: v.isSecret ? '********' : v.value,
      }));
    }

    return environment.variables;
  }
}
