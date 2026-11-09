import type { ReasonCode } from '@flowvis/contracts';

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
}

export interface PipelineConfig {
  readonly pipeline: string;
  /** Tên biến môi trường chứa workflow ID RunningHub. */
  readonly workflowEnvVar: string;
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
    requiredAtStartup: true,
    // [ASSUMPTION] nodeId/fieldName chưa được xác nhận bằng một lần chạy thật; phải đối chiếu với AI App trên RunningHub.
    inputs: [{ inputKey: 'imageKey', nodeId: '10', fieldName: 'image' }],
    params: [{ paramKey: 'intensity', nodeId: '20', fieldName: 'intensity' }],
    referenceInputKey: 'imageKey',
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
