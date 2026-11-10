import type { ReasonCode } from '@flowvis/contracts';
import type { RunningHubRunMode } from '../../ports/index.js';

export interface PipelineInputMapping {
  /** Khóa trong tasks.input_keys. */
  readonly inputKey: string;
  readonly nodeId: string;
  readonly fieldName: string;
}

export interface PipelineParamMapping {
  /** Khóa trong tasks.params. */
  readonly paramKey: string;
  readonly nodeId: string;
  readonly fieldName: string;
  /** Hệ số nhân cho giá trị số trước khi gửi (vd. intensity 1-10 -> strength LoRA). */
  readonly scale?: number;
}

export interface PipelineConfig {
  readonly pipeline: string;
  /** Tên biến môi trường chứa workflow ID RunningHub. */
  readonly workflowEnvVar: string;
  /** Tên biến môi trường chọn cách gọi RunningHub: `ai-app` hoặc `workflow`. */
  readonly runModeEnvVar: string;
  /** Cách gọi khi biến `runModeEnvVar` để trống. */
  readonly defaultRunMode: RunningHubRunMode;
  readonly inputs: readonly PipelineInputMapping[];
  /** Tham số từ tasks.params truyền cho workflow (giá trị dạng chuỗi). */
  readonly params?: readonly PipelineParamMapping[];
  /** true: thiếu biến môi trường workflow thì api/worker không khởi động. */
  readonly requiredAtStartup?: boolean;
  /** Khóa trong tasks.input_keys của ảnh tham chiếu: ảnh kết quả phải cùng kích thước (sau xoay EXIF) với ảnh này. */
  readonly referenceInputKey?: string;
  /** Bước chuẩn bị tùy chọn (vd. cắt video); nhận bytes theo inputKey. */
  readonly prepare?: (inputs: Record<string, Buffer>) => Promise<Record<string, Buffer>>;
}

export const PIPELINE_CONFIGS: Readonly<Record<string, PipelineConfig>> = {
  face_swap: {
    pipeline: 'face_swap',
    workflowEnvVar: 'RUNNINGHUB_WORKFLOW_FACESWAP',
    runModeEnvVar: 'RUNNINGHUB_MODE_FACESWAP',
    defaultRunMode: 'ai-app',
    // [ASSUMPTION] nodeId/fieldName (137 = nguồn, 10 = đích) chưa được xác nhận bằng một lần chạy thật; phải đối chiếu với AI App trên RunningHub.
    inputs: [
      { inputKey: 'sourceKey', nodeId: '137', fieldName: 'image' },
      { inputKey: 'targetKey', nodeId: '10', fieldName: 'image' },
    ],
    referenceInputKey: 'targetKey',
  },
  body_retouch: {
    pipeline: 'body_retouch',
    workflowEnvVar: 'RUNNINGHUB_WORKFLOW_BODY_RESHAPE',
    runModeEnvVar: 'RUNNINGHUB_MODE_BODY_RESHAPE',
    defaultRunMode: 'workflow',
    requiredAtStartup: true,
    // Theo workflow Flux Kontext + LoRA "kontext_big_breasts_and_butts": node 198 = LoadImage (ảnh đầu vào).
    // Prompt (node 6), LoRA (node 202) và KSampler cố định trong workflow nên không truyền từ API.
    // intensity (1-10, mặc định 5) -> strength_model của LoRA (node 202): 5 => 1.0 (mặc định workflow), 10 => 2.0.
    inputs: [{ inputKey: 'imageKey', nodeId: '198', fieldName: 'image' }],
    params: [{ paramKey: 'intensity', nodeId: '202', fieldName: 'strength_model', scale: 0.2 }],
    referenceInputKey: 'imageKey',
  },
  motion_control: {
    pipeline: 'motion_control',
    workflowEnvVar: 'RUNNINGHUB_WORKFLOW_MOTION',
    runModeEnvVar: 'RUNNINGHUB_MODE_MOTION',
    defaultRunMode: 'workflow',
    requiredAtStartup: true,
    // Mapping node RunningHub, bước cắt ffmpeg và nhập kết quả: Story 5.4-5.6.
    inputs: [],
  },
};

/** Ánh xạ lỗi FAILED của RunningHub theo tiền tố (không phân biệt hoa thường). */
export const RH_FAILURE_PREFIX_MAP: ReadonlyArray<{ prefix: string; reason: ReasonCode }> = [
  { prefix: 'NO_FACE', reason: 'NO_FACE' },
  { prefix: 'NO_POSE', reason: 'NO_POSE' },
];

/** Từ khóa (chữ thường) cho lỗi hết tiền RunningHub. */
export const RH_BUDGET_KEYWORDS: readonly string[] = [
  'insufficient',
  'not enough',
  'out of coins',
  'balance',
  'hết tiền',
];

/** Điền chuỗi lỗi thật ở Epic 6. */
export const RH_CONTENT_BLOCKED_PREFIXES: readonly string[] = [];

export function mapRunningHubFailure(errorMessage: string | undefined): ReasonCode {
  const msg = (errorMessage ?? '').trim();
  const upper = msg.toUpperCase();
  for (const { prefix, reason } of RH_FAILURE_PREFIX_MAP) {
    if (upper.startsWith(prefix)) return reason;
  }
  for (const p of RH_CONTENT_BLOCKED_PREFIXES) {
    if (upper.startsWith(p.toUpperCase())) return 'CONTENT_BLOCKED';
  }
  const lower = msg.toLowerCase();
  if (RH_BUDGET_KEYWORDS.some((k) => lower.includes(k))) return 'RH_BUDGET';
  return 'RH_ERROR';
}
