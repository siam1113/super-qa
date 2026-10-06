import { Module, Global } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { GraphService } from './graph.service';
import { GraphController } from './graph.controller';

@Global()
@Module({
  imports: [ConfigModule],
  providers: [GraphService],
  controllers: [GraphController],
  exports: [GraphService],
})
export class GraphModule {}
