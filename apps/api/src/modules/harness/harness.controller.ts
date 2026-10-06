import { Body, CanActivate, Controller, ExecutionContext, Get, Injectable, Param, ParseUUIDPipe, Post, ServiceUnavailableException, UnauthorizedException, UseGuards, UsePipes, ValidationPipe } from '@nestjs/common';
import { timingSafeEqual } from 'crypto';
import { HarnessService } from './harness.service';
import { CompleteHarnessDto, ReviewHarnessDto, SubmitHarnessDto } from './harness.dto';

export function authorize(context: ExecutionContext, variable: string): boolean {
  const expected = process.env[variable];
  if (!expected || expected.length < 32) throw new ServiceUnavailableException('Harness access key is not configured');
  const keys = ['HARNESS_OPERATOR_KEY', 'HARNESS_WORKER_KEY', 'HARNESS_EXECUTOR_KEY'].map(key => process.env[key]).filter(Boolean);
  if (new Set(keys).size !== keys.length) throw new ServiceUnavailableException('Harness capability keys must differ');
  const provided = context.switchToHttp().getRequest().headers['x-harness-key'];
  if (typeof provided !== 'string' || Buffer.byteLength(provided) !== Buffer.byteLength(expected) || !timingSafeEqual(Buffer.from(provided), Buffer.from(expected))) throw new UnauthorizedException();
  return true;
}

@Injectable()
export class HarnessOperatorGuard implements CanActivate {
  canActivate(context: ExecutionContext) { return authorize(context, 'HARNESS_OPERATOR_KEY'); }
}

@Injectable()
export class HarnessWorkerGuard implements CanActivate {
  canActivate(context: ExecutionContext) { return authorize(context, 'HARNESS_WORKER_KEY'); }
}

@Controller('harness/runs')
@UseGuards(HarnessOperatorGuard)
@UsePipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }))
export class HarnessController {
  constructor(private readonly harness: HarnessService) {}
  @Post() submit(@Body() input: SubmitHarnessDto) { return this.harness.submit(input); }
  @Get(':id') status(@Param('id', ParseUUIDPipe) id: string) { return this.harness.status(id); }
  @Post(':id/cancel') cancel(@Param('id', ParseUUIDPipe) id: string) { return this.harness.cancel(id); }
  @Post(':id/review') review(@Param('id', ParseUUIDPipe) id: string, @Body() input: ReviewHarnessDto) { return this.harness.review(id, input); }
}

@Controller('harness/worker')
@UseGuards(HarnessWorkerGuard)
@UsePipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }))
export class HarnessWorkerController {
  constructor(private readonly harness: HarnessService) {}
  @Post('claim') claim() { return this.harness.claim(); }
  @Get(':id') status(@Param('id', ParseUUIDPipe) id: string) { return this.harness.status(id); }
  @Post(':id/complete') complete(@Param('id', ParseUUIDPipe) id: string, @Body() input: CompleteHarnessDto) { return this.harness.complete(id, input); }
}
