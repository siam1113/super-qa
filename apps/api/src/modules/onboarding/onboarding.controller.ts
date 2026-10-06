import { Body, Controller, Param, ParseUUIDPipe, Post, UsePipes, ValidationPipe } from '@nestjs/common';
import { OnboardingService } from './onboarding.service';
import { GenerateTestCasesDto, CompleteOnboardingDto } from './onboarding.dto';

@Controller('onboarding')
@UsePipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }))
export class OnboardingController {
  constructor(private readonly onboardingService: OnboardingService) {}

  @Post('generate-test-cases')
  generateTestCases(@Body() body: GenerateTestCasesDto) {
    return this.onboardingService.generateTestCases(body.sourceId);
  }

  @Post('execute/:testCaseId')
  executeTestCase(@Param('testCaseId', ParseUUIDPipe) testCaseId: string) {
    return this.onboardingService.executeTestCase(testCaseId);
  }

  @Post('complete')
  complete(@Body() body: CompleteOnboardingDto) {
    return this.onboardingService.complete(body.projectId);
  }
}
