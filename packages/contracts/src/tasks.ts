import { z } from 'zod';
import { ConfirmedUploadKeySchema } from './uploads.js';

/** Giá Motion Control: 50 credit mỗi giây (nơi duy nhất giữ hằng 50 phía mã nguồn). */
export function motionPrice(seconds: number): number {
  if (!Number.isInteger(seconds) || seconds <= 0) {
    throw new RangeError('Số giây phải là số nguyên dương.');
  }
  return 50 * seconds;
}

/** Số giây Trim tối thiểu của Motion Control. */
export const MOTION_MIN_TRIM_SECONDS = 3;

export const TASK_PIPELINES = ['face_swap', 'body_retouch', 'motion_control'] as const;
export type TaskPipeline = (typeof TASK_PIPELINES)[number];
export const TaskPipelineSchema = z.enum(TASK_PIPELINES);

/** Pipeline có thể ghi đè thông báo lỗi. */
export const REASON_MESSAGE_PIPELINES = TASK_PIPELINES;
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
    NO_POSE: 'Không nhận diện được chuyển động cơ thể trong video mẫu',
    NO_FACE: 'Không nhận diện được nhân vật trong ảnh. Vui lòng chọn ảnh toàn thân rõ người.',
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
const TaskBaseSchema = z.object({
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
  });

function refineTask(
  t: z.infer<typeof TaskBaseSchema>,
  ctx: z.RefinementCtx,
): void {
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
}

export const TaskSchema = TaskBaseSchema.superRefine(refineTask);
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
  const zone = INTENSITY_LABEL_ZONES.find((item) => n >= item.min && n <= item.max);
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

/** POST /tasks/motion — giá, Cap và độ dài do server quyết định; không nhận credit/consent. */
const TrimSecondSchema = (label: string) =>
  z
    .number({ invalid_type_error: `${label} phải là số nguyên giây.` })
    .int(`${label} phải là số nguyên giây.`)
    .nonnegative(`${label} không được âm.`);
export const MotionCreateRequestSchema = z
  .object({
    characterKey: ConfirmedUploadKeySchema,
    videoKey: ConfirmedUploadKeySchema,
    trimStart: TrimSecondSchema('Điểm bắt đầu cắt'),
    trimEnd: TrimSecondSchema('Điểm kết thúc cắt'),
  })
  .strict();
export type MotionCreateRequest = z.infer<typeof MotionCreateRequestSchema>;
/** Task Motion kèm `price` (bằng `creditCost`, = `motionPrice(số giây)`). */
export const MotionCreateResponseSchema = TaskBaseSchema.extend({
  pipeline: z.literal('motion_control'),
  price: z.number().int().positive(),
}).superRefine((t, ctx) => {
  refineTask(t, ctx);
  if (t.price !== t.creditCost) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['price'],
      message: 'price phải bằng creditCost',
    });
  }
  if (t.price % motionPrice(1) !== 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['price'],
      message: 'price Motion phải là bội của giá mỗi giây',
    });
  }
});
export type MotionCreateResponse = z.infer<typeof MotionCreateResponseSchema>;

/** `details.reason` của VALIDATION_FAILED cho video/Trim. */
export const VALIDATION_REASONS = [
  'VIDEO_UNREADABLE',
  'VIDEO_TOO_SHORT',
  'TRIM_TOO_SHORT',
  'TRIM_EXCEEDS_CAP',
  'TRIM_OUT_OF_VIDEO',
  'TRIM_NOT_WHOLE_SECOND',
] as const;
export type ValidationReason = (typeof VALIDATION_REASONS)[number];
export const ValidationReasonSchema = z.enum(VALIDATION_REASONS);

export const ValidationDetailsSchema = z
  .object({
    reason: ValidationReasonSchema,
    cap: z.number().int().positive().optional(),
  })
  .superRefine((d, ctx) => {
    if (d.reason === 'TRIM_EXCEEDS_CAP' && d.cap == null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['cap'],
        message: 'TRIM_EXCEEDS_CAP bắt buộc có cap',
      });
    }
    if (d.reason !== 'TRIM_EXCEEDS_CAP' && d.cap != null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['cap'],
        message: 'cap chỉ dùng cho TRIM_EXCEEDS_CAP',
      });
    }
  });
export type ValidationDetails = z.infer<typeof ValidationDetailsSchema>;

export const VALIDATION_REASON_MESSAGES_VI: Readonly<Record<ValidationReason, string>> = {
  VIDEO_UNREADABLE: 'Không đọc được video. Vui lòng chọn video MP4 hoặc MOV khác.',
  VIDEO_TOO_SHORT: `Video quá ngắn, cần dài ít nhất ${MOTION_MIN_TRIM_SECONDS} giây.`,
  TRIM_TOO_SHORT: `Đoạn cắt cần dài ít nhất ${MOTION_MIN_TRIM_SECONDS} giây.`,
  TRIM_EXCEEDS_CAP: 'Gói của bạn cho phép tối đa {cap} giây',
  TRIM_OUT_OF_VIDEO: 'Đoạn cắt nằm ngoài độ dài của video.',
  TRIM_NOT_WHOLE_SECOND: 'Đoạn cắt phải tính theo từng giây nguyên.',
};

const API_VALIDATION_FALLBACK_VI = 'Dữ liệu không hợp lệ.';

export function getValidationReasonMessageVi(
  reason: ValidationReason | (string & {}) | null | undefined,
  cap?: number | null,
): string {
  if (!reason || !Object.prototype.hasOwnProperty.call(VALIDATION_REASON_MESSAGES_VI, reason)) {
    return API_VALIDATION_FALLBACK_VI;
  }
  if (reason === 'TRIM_EXCEEDS_CAP' && cap == null) return API_VALIDATION_FALLBACK_VI;
  return VALIDATION_REASON_MESSAGES_VI[reason as ValidationReason].replace(
    '{cap}',
    cap == null ? '' : String(cap),
  );
}

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
export const MEDIA_TYPES = ['image', 'video'] as const;
export const MediaTypeSchema = z.enum(MEDIA_TYPES);
export type MediaType = z.infer<typeof MediaTypeSchema>;

/** Video có `posterUrl` và `durationSeconds`; ảnh không có. `sourceUrl` của Motion luôn rỗng. */
export const TaskResultResponseSchema = z
  .object({
    /** Vắng mặt nghĩa là `image` (tương thích BE Epic 2–4 cho đến khi 5.6 điền trường này). */
    mediaType: MediaTypeSchema.optional(),
    resultUrl: z.string().url(),
    sourceUrl: z.string().url().nullable(),
    posterUrl: z.string().url().optional(),
    durationSeconds: z.number().int().positive().optional(),
  })
  .superRefine((r, ctx) => {
    const issue = (path: string, message: string) =>
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: [path], message });
    if (r.mediaType === 'video') {
      if (r.posterUrl == null) issue('posterUrl', 'Kết quả video bắt buộc có posterUrl');
      if (r.durationSeconds == null) issue('durationSeconds', 'Kết quả video bắt buộc có durationSeconds');
      if (r.sourceUrl != null) issue('sourceUrl', 'Kết quả video không có sourceUrl');
    } else {
      if (r.posterUrl != null) issue('posterUrl', 'Kết quả ảnh không có posterUrl');
      if (r.durationSeconds != null) issue('durationSeconds', 'Kết quả ảnh không có durationSeconds');
    }
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

/** GET /s/{token}/info */
export const ShareInfoResponseSchema = z
  .object({
    mediaType: MediaTypeSchema,
    durationSeconds: z.number().int().positive().optional(),
  })
  .superRefine((r, ctx) => {
    if (r.mediaType === 'video' && r.durationSeconds == null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['durationSeconds'],
        message: 'Chia sẻ video bắt buộc có durationSeconds',
      });
    }
    if (r.mediaType === 'image' && r.durationSeconds != null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['durationSeconds'],
        message: 'Chia sẻ ảnh không có durationSeconds',
      });
    }
  });
export type ShareInfoResponse = z.infer<typeof ShareInfoResponseSchema>;

/** GET /s/{token}/poster — thành công là chuyển hướng (không có body); 404 dùng ApiError. */
export const SharePosterParamsSchema = SharePublicParamsSchema;
export type SharePosterParams = SharePublicParams;
