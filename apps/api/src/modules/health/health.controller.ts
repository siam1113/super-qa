import { Controller, Get, UseGuards } from '@nestjs/common';
import { HealthService } from './health.service';
import { ProjectGuard } from '../autonomy/autonomy.controller';
import { SuperAdminGuard } from '../autonomy/auth.controller';

@Controller('health')
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Get('live')
  live() {
    return { status: 'healthy', component: 'api', timestamp: new Date().toISOString() };
  }

  @Get()
  @UseGuards(ProjectGuard)
  async check() {
    return this.healthService.check();
  }

  @Get('embedding')
  @UseGuards(ProjectGuard)
  async checkEmbedding() {
    return this.healthService.checkEmbedding();
  }

  @Get('database')
  @UseGuards(ProjectGuard)
  async checkDatabase() {
    return this.healthService.checkDatabase();
  }

  @Get('redis')
  @UseGuards(ProjectGuard)
  async checkRedis() {
    return this.healthService.checkRedis();
  }

  @Get('services')
  @UseGuards(ProjectGuard)
  async services() {
    return this.healthService.clientStatus();
  }

  @Get('admin-services')
  @UseGuards(SuperAdminGuard)
  async adminServices() {
    return this.healthService.clientStatus();
  }
}
