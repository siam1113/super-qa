import { Module } from '@nestjs/common';
import { OnboardingController } from './onboarding.controller';
import { OnboardingService } from './onboarding.service';
import { QaModule } from '../qa/qa.module';
import { BusinessModule } from '../business/business.module';
import { AgentsModule } from '../agents/agents.module';

@Module({
  imports: [QaModule, BusinessModule, AgentsModule],
  controllers: [OnboardingController],
  providers: [OnboardingService],
})
export class OnboardingModule {}
