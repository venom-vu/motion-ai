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
  /** Giá trị dùng khi tasks.params thiếu khóa (Task tạo trước khi có tham số này). */
  readonly fallback?: string;
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

/** Prompt mặc định khi người dùng để trống (workflow gốc dùng tiếng Trung). */
const DEFAULT_MOTION_PROMPT = '美女跳舞';

export const PIPELINE_CONFIGS: Readonly<Record<string, PipelineConfig>> = {
  face_swap: {
    pipeline: 'face_swap',
    workflowEnvVar: 'RUNNINGHUB_WORKFLOW_FACESWAP',
    runModeEnvVar: 'RUNNINGHUB_MODE_FACESWAP',
    defaultRunMode: 'ai-app',
    // [ASSUMPTION] AI App Face Swap có hai node ảnh, curl mẫu không ghi mô tả: giả định node 470 = ảnh đích (giữ bố cục, kích thước), node 475 = ảnh nguồn (khuôn mặt). Nếu kết quả bị ngược thì hoán đổi hai nodeId.
    inputs: [
      { inputKey: 'targetKey', nodeId: '470', fieldName: 'image' },
      { inputKey: 'sourceKey', nodeId: '475', fieldName: 'image' },
    ],
    referenceInputKey: 'targetKey',
  },
  body_retouch: {
    pipeline: 'body_retouch',
    workflowEnvVar: 'RUNNINGHUB_WORKFLOW_BODY_RESHAPE',
    runModeEnvVar: 'RUNNINGHUB_MODE_BODY_RESHAPE',
    defaultRunMode: 'ai-app',
    requiredAtStartup: true,
    // AI App nâng ngực (2095511080751996930): node 4 = LoadImage (ảnh), node 56 = strength_model của LoRA (intensity 1-10 x 0.1 -> 0.1-1.0; mặc định 5 -> 0.5).
    inputs: [{ inputKey: 'imageKey', nodeId: '4', fieldName: 'image' }],
    params: [{ paramKey: 'intensity', nodeId: '56', fieldName: 'strength_model', scale: 0.1 }],
    referenceInputKey: 'imageKey',
  },
  motion_control: {
    pipeline: 'motion_control',
    workflowEnvVar: 'RUNNINGHUB_WORKFLOW_MOTION',
    runModeEnvVar: 'RUNNINGHUB_MODE_MOTION',
    defaultRunMode: 'ai-app',
    requiredAtStartup: true,
    // AI App Motion Control (2108650752700166145): node 30 = ảnh nhân vật, node 33 = video chuyển động.
    inputs: [
      { inputKey: 'characterKey', nodeId: '30', fieldName: 'image' },
      { inputKey: 'videoKey', nodeId: '33', fieldName: 'video' },
    ],
    // Tham số người dùng chọn: 134/135 = rộng/cao theo khung hình, 277 = prompt (mặc định dọc 576x1024).
    params: [
      { paramKey: 'width', nodeId: '134', fieldName: 'value', fallback: '576' },
      { paramKey: 'height', nodeId: '135', fieldName: 'value', fallback: '1024' },
      { paramKey: 'prompt', nodeId: '277', fieldName: 'text', fallback: DEFAULT_MOTION_PROMPT },
    ],
    // Node cố định: 278 = fps.
    fixedNodes: [{ nodeId: '278', fieldName: 'value', fieldValue: '24' }],
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
