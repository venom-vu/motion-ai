import { z } from 'zod';
import { ConfirmedUploadKeySchema } from './uploads.js';

export const TASK_PIPELINES = ['face_swap', 'body_retouch'] as const;
export type TaskPipeline = (typeof TASK_PIPELINES)[number];
export const TaskPipelineSchema = z.enum(TASK_PIPELINES);

/** Pipeline có thể ghi đè thông báo lỗi (mở rộng ở Epic 4, 5). */
export const REASON_MESSAGE_PIPELINES = [
  ...TASK_PIPELINES,
  'motion_control',
] as const;
export type ReasonMessagePipeline = (typeof REASON_MESSAGE_PIPELINES)[number];

export const TASK_STATUSES = [
  'queued',
  'running',
  'succeeded',
  'failed',
  'timed_out',
  'cancelled',
] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];
export const TaskStatusSchema = z.enum(TASK_STATUSES);

export const REASON_CODES = [
  'RH_ERROR',
  'RH_TIMEOUT',
  'RH_SUBMIT_UNKNOWN',
  'RH_BUDGET',
  'PREP_TIMEOUT',
  'RH_GATE_TIMEOUT',
  'FFMPEG_ERROR',
  'INPUT_FETCH_ERROR',
  'OUTPUT_UPLOAD_ERROR',
  'OUTPUT_INVALID',
  'INTERNAL_ERROR',
  'NO_POSE',
  'NO_FACE',
  'CONTENT_BLOCKED',
  'FREE_WAIT_EXPIRED',
  'USER_CANCEL',
] as const;
export type ReasonCode = (typeof REASON_CODES)[number];
/** Mã lý do hợp lệ cho Task `timed_out` (các mã còn lại thuộc `failed`). */
const TIMED_OUT_REASON_CODES: readonly ReasonCode[] = [
  'RH_TIMEOUT',
  'RH_GATE_TIMEOUT',
  'PREP_TIMEOUT',
  'FREE_WAIT_EXPIRED',
];
export const ReasonCodeSchema = z.enum(REASON_CODES);

const GENERIC_FAILURE_VI =
  'Xử lý không thành công do lỗi hệ thống. Credit đã được hoàn lại, vui lòng thử lại.';

export const REASON_CODE_MESSAGES_VI: Readonly<Record<ReasonCode, string>> = {
  RH_ERROR: GENERIC_FAILURE_VI,
  RH_TIMEOUT: 'Quá thời gian xử lý. Credit đã được hoàn lại, vui lòng thử lại.',
  RH_SUBMIT_UNKNOWN: GENERIC_FAILURE_VI,
  RH_BUDGET: GENERIC_FAILURE_VI,
  PREP_TIMEOUT: 'Quá thời gian chuẩn bị dữ liệu. Credit đã được hoàn lại, vui lòng thử lại.',
  RH_GATE_TIMEOUT: 'Hệ thống đang quá tải. Credit đã được hoàn lại, vui lòng thử lại sau.',
  FFMPEG_ERROR: 'Không xử lý được tệp đầu vào. Credit đã được hoàn lại, vui lòng chọn file khác.',
  INPUT_FETCH_ERROR: 'Không đọc được ảnh đầu vào. Credit đã được hoàn lại, vui lòng tải lại ảnh.',
  OUTPUT_UPLOAD_ERROR: GENERIC_FAILURE_VI,
  OUTPUT_INVALID: 'Kết quả tạo ra không hợp lệ. Credit đã được hoàn lại, vui lòng thử lại.',
  INTERNAL_ERROR: GENERIC_FAILURE_VI,
  NO_POSE: 'Không nhận diện được dáng người trong ảnh/video. Credit đã được hoàn lại.',
  NO_FACE: 'Không nhận diện được khuôn mặt trong ảnh',
  CONTENT_BLOCKED: 'Ảnh/video vi phạm tiêu chuẩn cộng đồng, vui lòng chọn file khác.',
  FREE_WAIT_EXPIRED:
    'Tác vụ đã chờ quá 15 phút trong hàng đợi miễn phí. Credit đã được hoàn lại, vui lòng thử lại.',
  USER_CANCEL: 'Bạn đã hủy tác vụ. Credit đã được hoàn lại.',
};

/** Ghi đè thông báo theo pipeline. */
export const REASON_CODE_PIPELINE_OVERRIDES_VI: Readonly<
  Partial<
    Record<ReasonMessagePipeline, Readonly<Partial<Record<ReasonCode, string>>>>
  >
> = {
  body_retouch: {
    NO_POSE: 'Không tìm thấy người trong ảnh. Vui lòng chọn ảnh có người rõ thân.',
  },
  motion_control: {
    NO_POSE:
      'Không nhận diện được chuyển động của người trong video, vui lòng chọn video thấy rõ người.',
  },
};

const UNKNOWN_REASON_MESSAGE_VI = 'Tác vụ không thành công. Vui lòng thử lại sau.';

export function getReasonCodeMessageVi(
  code: ReasonCode | (string & {}) | null | undefined,
  pipeline?: ReasonMessagePipeline | (string & {}) | null,
): string {
  if (!code || !Object.prototype.hasOwnProperty.call(REASON_CODE_MESSAGES_VI, code)) {
    return UNKNOWN_REASON_MESSAGE_VI;
  }
  const rc = code as ReasonCode;
  if (pipeline && Object.prototype.hasOwnProperty.call(REASON_CODE_PIPELINE_OVERRIDES_VI, pipeline)) {
    const o = REASON_CODE_PIPELINE_OVERRIDES_VI[pipeline as ReasonMessagePipeline]?.[rc];
    if (o) return o;
  }
  return REASON_CODE_MESSAGES_VI[rc];
}

/** Task với các bất biến trạng thái / reasonCode / queuePosition / resultKey. */
export const TaskSchema = z
  .object({
    id: z.string().uuid(),
    pipeline: TaskPipelineSchema,
    status: TaskStatusSchema,
    reasonCode: ReasonCodeSchema.nullable().optional(),
    queuePosition: z.number().int().positive().nullable().optional(),
    resultKey: z
      .string()
      .regex(
        new RegExp(
          '^out/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$',
        ), 'Khóa kết quả không hợp lệ.')
      .nullable()
      .optional(),
    creditCost: z.number().int().positive(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .superRefine((t, ctx) => {
    const issue = (path: string, message: string) =>
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: [path], message });
    const hasReason = t.reasonCode != null;
    const terminalFail =
      t.status === 'failed' || t.status === 'timed_out' || t.status === 'cancelled';
    if (terminalFail && !hasReason) {
      issue('reasonCode', `Task ${t.status} bắt buộc có reasonCode`);
    }
    if (!terminalFail && hasReason) {
      issue('reasonCode', `Task ${t.status} không được có reasonCode`);
    }
    if (t.status === 'cancelled' && hasReason && t.reasonCode !== 'USER_CANCEL') {
      issue('reasonCode', 'Task cancelled chỉ được có reasonCode USER_CANCEL');
    }
    if (t.reasonCode === 'USER_CANCEL' && t.status !== 'cancelled') {
      issue('reasonCode', 'USER_CANCEL chỉ dùng cho Task cancelled');
    }
    if (t.reasonCode === 'PREP_TIMEOUT' && t.status !== 'timed_out') {
      issue('reasonCode', 'PREP_TIMEOUT chỉ dùng cho Task timed_out');
    }
    if (t.reasonCode === 'FREE_WAIT_EXPIRED' && t.status !== 'timed_out') {
      issue('reasonCode', 'FREE_WAIT_EXPIRED chỉ dùng cho Task timed_out');
    }
    if (
      (t.reasonCode === 'RH_TIMEOUT' || t.reasonCode === 'RH_GATE_TIMEOUT') &&
      t.status !== 'timed_out'
    ) {
      issue('reasonCode', `${t.reasonCode} chỉ dùng cho Task timed_out`);
    }
    if (t.status === 'timed_out' && hasReason && !TIMED_OUT_REASON_CODES.includes(t.reasonCode!)) {
      issue('reasonCode', 'Task timed_out chỉ được có reasonCode hết hạn (RH_TIMEOUT, RH_GATE_TIMEOUT, PREP_TIMEOUT, FREE_WAIT_EXPIRED)');
    }
    if (t.status === 'queued' && t.queuePosition == null) {
      issue('queuePosition', 'Task queued bắt buộc có queuePosition');
    }
    if (t.status !== 'queued' && t.queuePosition != null) {
      issue('queuePosition', 'queuePosition chỉ có khi Task queued');
    }
    if (t.status === 'succeeded' && t.resultKey == null) {
      issue('resultKey', 'Task succeeded bắt buộc có resultKey');
    }
    if (t.status !== 'succeeded' && t.resultKey != null) {
      issue('resultKey', 'resultKey chỉ có khi Task succeeded');
    }
  });
export type Task = z.infer<typeof TaskSchema>;

export const TaskIdParamsSchema = z.object({ id: z.string().uuid() });
export type TaskIdParams = z.infer<typeof TaskIdParamsSchema>;

/** POST /tasks/face-swap — giá do server quyết định, không nhận credit từ client. */
export const FaceSwapCreateRequestSchema = z
  .object({
    sourceKey: ConfirmedUploadKeySchema,
    targetKey: ConfirmedUploadKeySchema,
  })
  .strict();
export type FaceSwapCreateRequest = z.infer<typeof FaceSwapCreateRequestSchema>;
export const FaceSwapCreateResponseSchema = TaskSchema;
export type FaceSwapCreateResponse = Task;

/** Mức điều chỉnh Body Retouch: số nguyên 1–10, mặc định 5. */
export const INTENSITY_MIN = 1;
export const INTENSITY_MAX = 10;
export const INTENSITY_DEFAULT = 5;
export const IntensitySchema = z
  .number({ invalid_type_error: 'Mức điều chỉnh phải là số nguyên từ 1 đến 10.' })
  .int('Mức điều chỉnh phải là số nguyên từ 1 đến 10.')
  .min(INTENSITY_MIN, 'Mức điều chỉnh tối thiểu là 1.')
  .max(INTENSITY_MAX, 'Mức điều chỉnh tối đa là 10.')
  .default(INTENSITY_DEFAULT);
export type Intensity = z.infer<typeof IntensitySchema>;

/** Ba vùng nhãn của thanh mức điều chỉnh (min/max gồm cả hai đầu). */
export const INTENSITY_LABEL_ZONES = [
  { min: 1, max: 3, label: 'Uốn nhẹ dáng' },
  { min: 4, max: 7, label: 'Tự nhiên' },
  { min: 8, max: 10, label: 'Đường cong tối đa' },
] as const;

/** Nhãn tiếng Việt theo mức; ngoài 1–10 hoặc không nguyên trả `null`. */
export function getIntensityLabelVi(n: number): string | null {
  if (!Number.isInteger(n)) return null;
  const zone = INTENSITY_LABEL_ZONES.find((zone) => n >= zone.min && n <= zone.max);
  return zone ? zone.label : null;
}

/** POST /tasks/body-retouch — không nhận credit/consent từ client (ToS đồng ý khi đăng nhập). */
export const BodyRetouchCreateRequestSchema = z
  .object({
    imageKey: ConfirmedUploadKeySchema,
    intensity: IntensitySchema,
  })
  .strict();
export type BodyRetouchCreateRequest = z.input<typeof BodyRetouchCreateRequestSchema>;
export const BodyRetouchCreateResponseSchema = TaskSchema;
export type BodyRetouchCreateResponse = Task;

/** GET /tasks — phân trang cursor, mới nhất trước. */
export const TaskListQuerySchema = z.object({
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().min(1).optional(),
});
export type TaskListQuery = z.infer<typeof TaskListQuerySchema>;

export const TaskListResponseSchema = z
  .object({
    items: z.array(TaskSchema),
    pageSize: z.number().int().min(1).max(100),
    hasMore: z.boolean(),
    nextCursor: z.string().min(1).nullable(),
  })
  .superRefine((res, ctx) => {
    if (res.items.length > res.pageSize) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['items'],
        message: 'Số Task không được vượt quá pageSize',
      });
    }
    if (res.hasMore !== (res.nextCursor !== null)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['nextCursor'],
        message: 'hasMore phải khớp với việc có nextCursor',
      });
    }
  });
export type TaskListResponse = z.infer<typeof TaskListResponseSchema>;

/** GET /tasks/{id} */
export const TaskGetResponseSchema = TaskSchema;
export type TaskGetResponse = Task;

/** POST /tasks/{id}/cancel — CONFLICT nếu Task đã running. */
export const TaskCancelResponseSchema = TaskSchema;
export type TaskCancelResponse = Task;

/** GET /tasks/{id}/result — CONFLICT nếu Task chưa succeeded. */
export const TaskResultResponseSchema = z.object({
  resultUrl: z.string().url(),
  sourceUrl: z.string().url().nullable(),
});
export type TaskResultResponse = z.infer<typeof TaskResultResponseSchema>;

/** POST /tasks/{id}/share, DELETE /tasks/{id}/share */
export const TaskShareResponseSchema = z.object({
  token: z.string().min(1),
  shareUrl: z.string().url(),
});
export type TaskShareResponse = z.infer<typeof TaskShareResponseSchema>;
export const TaskShareRevokeResponseSchema = z.object({ revoked: z.literal(true) });
export type TaskShareRevokeResponse = z.infer<typeof TaskShareRevokeResponseSchema>;

/** GET /s/{token} — thành công là chuyển hướng (không có body); 404 dùng ApiError. */
export const SharePublicParamsSchema = z.object({ token: z.string().min(1) });
export type SharePublicParams = z.infer<typeof SharePublicParamsSchema>;
