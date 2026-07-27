import { Module, Global } from '@nestjs/common';
import { GraphService } from './graph.service';
import { GraphController } from './graph.controller';

@Global()
@Module({
  providers: [GraphService],
  controllers: [GraphController],
  exports: [GraphService],
})
export class GraphModule {}
