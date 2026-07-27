import { Module } from '@nestjs/common';
import { QaController } from './qa.controller';
import { QaService } from './qa.service';
import { SourcesModule } from '../sources/sources.module';
import { BusinessModule } from '../business/business.module';

@Module({
  imports: [SourcesModule, BusinessModule],
  controllers: [QaController],
  providers: [QaService],
  exports: [QaService],
})
export class QaModule {}
