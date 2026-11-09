import { Injectable, type OnModuleInit } from '@nestjs/common';
import { PIPELINE_CONFIGS, type PipelineConfig } from './pipeline-config.js';

@Injectable()
export class PipelinesService implements OnModuleInit {
  /** Thiếu biến workflow bắt buộc thì không khởi động (api và worker cùng nạp module này). */
  onModuleInit(): void {
    const missing = Object.values(PIPELINE_CONFIGS)
      .filter((c) => c.requiredAtStartup && !this.getWorkflowId(c))
      .map((c) => c.workflowEnvVar);
    if (missing.length) {
      throw new Error(`Thiếu biến môi trường bắt buộc: ${missing.join(', ')}`);
    }
  }

  getConfig(pipeline: string): PipelineConfig | null {
    return PIPELINE_CONFIGS[pipeline] ?? null;
  }

  getWorkflowId(config: PipelineConfig): string | null {
    const v = process.env[config.workflowEnvVar]?.trim();
    return v ? v : null;
  }
}
