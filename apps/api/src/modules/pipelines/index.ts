import { Module } from '@nestjs/common';
import { PipelinesService } from './pipelines.service.js';

export * from './pipeline-config.js';
export * from './pipelines.service.js';

@Module({
  providers: [PipelinesService],
  exports: [PipelinesService],
})
export class PipelinesModule {}
