import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BusinessItem, BusinessRelationship } from './entities/business-item.entity';
import { BusinessService } from './business.service';
import { BusinessController } from './business.controller';
import { BusinessExtractionService } from './business-extraction.service';
import { GraphModule } from '../graph/graph.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([BusinessItem, BusinessRelationship]),
    forwardRef(() => GraphModule),
  ],
  controllers: [BusinessController],
  providers: [BusinessService, BusinessExtractionService],
  exports: [BusinessService, BusinessExtractionService],
})
export class BusinessModule {}
