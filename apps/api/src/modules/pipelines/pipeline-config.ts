import type { ReasonCode } from '@flowvis/contracts';
import type { RunningHubRunMode } from '../../ports/index.js';
import { videoTrim, type PrepareContext } from '../tasks/video-trim.service.js';

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
  /** Node có giá trị cố định, luôn gửi kèm (vd. tắt lưu bản trung gian, tốc độ khung hình). */
  readonly fixedNodes?: readonly { readonly nodeId: string; readonly fieldName: string; readonly fieldValue: string }[];
  /** true: thiếu biến môi trường workflow thì api/worker không khởi động. */
  readonly requiredAtStartup?: boolean;
  /** Khóa trong tasks.input_keys của ảnh tham chiếu: ảnh kết quả phải cùng kích thước (sau xoay EXIF) với ảnh này. */
  readonly referenceInputKey?: string;
  /** Bước chuẩn bị tùy chọn (vd. cắt video); tự lấy input, trả bytes theo inputKey. Chạy trước cổng RunningHub, trong hạn prep_deadline_at. */
  readonly prepare?: (ctx: PrepareContext) => Promise<Record<string, Buffer>>;
  /** Hạn xử lý RunningHub (ms) tính từ lúc qua cổng; mặc định 180000. */
  readonly deadlineMs?: number;
}

export const PIPELINE_CONFIGS: Readonly<Record<string, PipelineConfig>> = {
  face_swap: {
    pipeline: 'face_swap',
    workflowEnvVar: 'RUNNINGHUB_WORKFLOW_FACESWAP',
    runModeEnvVar: 'RUNNINGHUB_MODE_FACESWAP',
    defaultRunMode: 'ai-app',
    // AI App Face Swap: node 137 = Reference image (ảnh đích, giữ bố cục và kích thước), node 10 = Face image (ảnh nguồn, khuôn mặt).
    inputs: [
      { inputKey: 'targetKey', nodeId: '137', fieldName: 'image' },
      { inputKey: 'sourceKey', nodeId: '10', fieldName: 'image' },
    ],
    referenceInputKey: 'targetKey',
  },
  body_retouch: {
    pipeline: 'body_retouch',
    workflowEnvVar: 'RUNNINGHUB_WORKFLOW_BODY_RESHAPE',
    runModeEnvVar: 'RUNNINGHUB_MODE_BODY_RESHAPE',
    defaultRunMode: 'ai-app',
    requiredAtStartup: true,
    // AI App Body Reshape chỉ có một node đầu vào: node 4 = LoadImage (ảnh). Không còn node LoRA nên `intensity` không truyền sang RunningHub.
    inputs: [{ inputKey: 'imageKey', nodeId: '4', fieldName: 'image' }],
    referenceInputKey: 'imageKey',
  },
  motion_control: {
    pipeline: 'motion_control',
    workflowEnvVar: 'RUNNINGHUB_WORKFLOW_MOTION',
    runModeEnvVar: 'RUNNINGHUB_MODE_MOTION',
    defaultRunMode: 'workflow',
    requiredAtStartup: true,
    // AI App Motion Control chỉ có hai node đầu vào: node 64 = ảnh nhân vật, node 65 = video chuyển động.
    inputs: [
      { inputKey: 'characterKey', nodeId: '64', fieldName: 'image' },
      { inputKey: 'videoKey', nodeId: '65', fieldName: 'video' },
    ],
    deadlineMs: 360_000,
    prepare: (ctx) => videoTrim.prepare(ctx),
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
