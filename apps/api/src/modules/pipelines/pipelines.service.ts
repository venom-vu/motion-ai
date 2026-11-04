import { Injectable } from '@nestjs/common';
import { PIPELINE_CONFIGS, type PipelineConfig } from './pipeline-config.js';

@Injectable()
export class PipelinesService {
  getConfig(pipeline: string): PipelineConfig | null {
    return PIPELINE_CONFIGS[pipeline] ?? null;
  }

  getWorkflowId(config: PipelineConfig): string | null {
    const v = process.env[config.workflowEnvVar]?.trim();
    return v ? v : null;
  }
}
