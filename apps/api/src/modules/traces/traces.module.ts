import { Module } from '@nestjs/common';
import { TracesController } from './traces.controller';

@Module({
  controllers: [TracesController],
})
export class TracesModule {}
