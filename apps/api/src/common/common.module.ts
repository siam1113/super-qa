import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { CircuitBreakerService } from './circuit-breaker.service';
import { WorkerWakeupService } from './worker-wakeup.service';

@Global()
@Module({
  imports: [ConfigModule],
  providers: [CircuitBreakerService, WorkerWakeupService],
  exports: [CircuitBreakerService, WorkerWakeupService],
})
export class CommonModule {}
