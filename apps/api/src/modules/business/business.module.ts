import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { BusinessItem, BusinessRelationship } from './entities/business-item.entity';
import { BusinessService } from './business.service';
import { BusinessController } from './business.controller';
import { BusinessExtractionService } from './business-extraction.service';
import { ExtractionProviderFactory } from './extraction-providers';
import { GraphModule } from '../graph/graph.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([BusinessItem, BusinessRelationship]),
    forwardRef(() => GraphModule),
    ConfigModule,
  ],
  controllers: [BusinessController],
  providers: [BusinessService, BusinessExtractionService, ExtractionProviderFactory],
  exports: [BusinessService, BusinessExtractionService, ExtractionProviderFactory],
})
export class BusinessModule {}
