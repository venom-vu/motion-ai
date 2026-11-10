import { Injectable, type OnModuleInit } from '@nestjs/common';
import type { RunningHubRunMode } from '../../ports/index.js';
import { PIPELINE_CONFIGS, type PipelineConfig } from './pipeline-config.js';

const RUN_MODE_ALIASES: Readonly<Record<string, RunningHubRunMode>> = {
  'ai-app': 'ai-app',
  ai_app: 'ai-app',
  aiapp: 'ai-app',
  'ai-model': 'ai-app',
  ai_model: 'ai-app',
  workflow: 'workflow',
};

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
    for (const c of Object.values(PIPELINE_CONFIGS)) this.getRunMode(c);
  }

  getConfig(pipeline: string): PipelineConfig | null {
    return PIPELINE_CONFIGS[pipeline] ?? null;
  }

  getWorkflowId(config: PipelineConfig): string | null {
    const v = process.env[config.workflowEnvVar]?.trim();
    return v ? v : null;
  }

  /** Cách gọi RunningHub của pipeline: `ai-app` hoặc `workflow`; giá trị lạ thì ném lỗi (không đoán). */
  getRunMode(config: PipelineConfig): RunningHubRunMode {
    const raw = process.env[config.runModeEnvVar]?.trim().toLowerCase();
    if (!raw) return config.defaultRunMode;
    const mode = RUN_MODE_ALIASES[raw];
    if (!mode) {
      throw new Error(`${config.runModeEnvVar} không hợp lệ: "${raw}" (chỉ nhận "ai-app" hoặc "workflow")`);
    }
    return mode;
  }
}
