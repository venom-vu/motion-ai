import { z } from 'zod';
import { pagedResponse } from './topups.js';
import { TASK_STATUSES, TaskPipelineSchema } from './tasks.js';
import { TopupPackIdSchema } from './wallet.js';

/** GET /system/status — công khai, chỉ một boolean (không lý do, không số liệu). */
export const SystemStatusResponseSchema = z.object({ intakePaused: z.boolean() }).strict();
export type SystemStatusResponse = z.infer<typeof SystemStatusResponseSchema>;

const isoDate = z.string().datetime();

/** GET /admin/ops/status */
export const OpsStatusResponseSchema = z.object({
  intakePaused: z.boolean(),
  rhBudgetExhausted: z.boolean(),
  lastBreakerTrigger: z
    .object({
      at: isoDate,
      rule: z.string().min(1),
      metrics: z.record(z.union([z.number(), z.string(), z.boolean(), z.null()])),
    })
    .nullable(),
  rhBalance: z.object({ coins: z.number().nonnegative(), readAt: isoDate }).nullable(),
  lastBackup: z
    .object({
      at: isoDate,
      result: z.enum(['success', 'failed']),
      sizeBytes: z.number().int().nonnegative().nullable(),
    })
    .nullable(),
});
export type OpsStatusResponse = z.infer<typeof OpsStatusResponseSchema>;

/** POST /admin/ops/resume — body rỗng, trả cùng hình dạng status. */
export const OpsResumeRequestSchema = z.object({}).strict();
export type OpsResumeRequest = z.infer<typeof OpsResumeRequestSchema>;
export const OpsResumeResponseSchema = OpsStatusResponseSchema;
export type OpsResumeResponse = OpsStatusResponse;

/* ------------------------------ Thống kê ------------------------------ */

export const STATS_SCOPES = ['real', 'benchmark'] as const;
export const StatsScopeSchema = z.enum(STATS_SCOPES);
export type StatsScope = z.infer<typeof StatsScopeSchema>;

export const STATS_SCENARIOS = ['retail', 'standardPack'] as const;
export const StatsScenarioSchema = z.enum(STATS_SCENARIOS);
export type StatsScenario = z.infer<typeof StatsScenarioSchema>;

const positiveIntQuery = (label: string) =>
  z.coerce
    .number({ invalid_type_error: `${label} phải là số nguyên dương.` })
    .int(`${label} phải là số nguyên dương.`)
    .positive(`${label} phải là số nguyên dương.`)
    .optional();

/** GET /admin/stats */
export const AdminStatsQuerySchema = z
  .object({
    from: z.string().datetime({ message: 'from phải là thời điểm ISO hợp lệ.' }),
    to: z.string().datetime({ message: 'to phải là thời điểm ISO hợp lệ.' }),
    scope: StatsScopeSchema.default('real'),
    motionPricePerSecond: positiveIntQuery('motionPricePerSecond'),
    imagePrice: positiveIntQuery('imagePrice'),
  })
  .superRefine((q, ctx) => {
    if (Date.parse(q.to) < Date.parse(q.from)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['to'],
        message: 'to không được sớm hơn from.',
      });
    }
  });
export type AdminStatsQuery = z.infer<typeof AdminStatsQuerySchema>;

const nonNegInt = z.number().int().nonnegative();
const nonNeg = z.number().nonnegative();

const StatusCountsSchema = z.object(
  Object.fromEntries(TASK_STATUSES.map((s) => [s, nonNegInt])) as Record<
    (typeof TASK_STATUSES)[number],
    typeof nonNegInt
  >,
);

const ScenarioCostSchema = z.object({ retail: nonNeg, standardPack: nonNeg });

export const AdminStatsPipelineSchema = z.object({
  pipeline: TaskPipelineSchema,
  taskCounts: StatusCountsSchema,
  /** 0..1; null khi chưa có Task đủ điều kiện. */
  successRate: z.number().min(0).max(1).nullable(),
  avgProcessingSeconds: nonNeg.nullable(),
  p95ProcessingSeconds: nonNeg.nullable(),
  avgGpuCoins: nonNeg.nullable(),
  wastedGpuCoins: nonNeg,
  /** Chi phí GPU trung bình mỗi Task, quy VNĐ theo hai kịch bản. */
  avgCostVnd: ScenarioCostSchema.nullable(),
});
export type AdminStatsPipeline = z.infer<typeof AdminStatsPipelineSchema>;

export const AdminStatsMarginSchema = z.object({
  pipeline: TaskPipelineSchema,
  pack: TopupPackIdSchema,
  scenario: StatsScenarioSchema,
  revenueVnd: nonNeg,
  costVnd: nonNeg,
  marginVnd: z.number(),
  /** Biên gộp tỷ lệ; null khi doanh thu bằng 0. */
  marginRate: z.number().nullable(),
});
export type AdminStatsMargin = z.infer<typeof AdminStatsMarginSchema>;

export const AdminStatsResponseSchema = z.object({
  from: isoDate,
  to: isoDate,
  scope: StatsScopeSchema,
  pipelines: z.array(AdminStatsPipelineSchema),
  margins: z.array(AdminStatsMarginSchema),
  successMetrics: z.object({
    /** SM-1..SM-4 */
    approvedTopups: nonNegInt,
    conversionRate: z.number().min(0).max(1).nullable(),
    gpuCostUsd: nonNeg,
  }),
});
export type AdminStatsResponse = z.infer<typeof AdminStatsResponseSchema>;

/* ------------------------------- Nhật ký ------------------------------- */

/** GET /admin/audit — chỉ đọc, không có endpoint sửa/xóa. */
export const AdminAuditQuerySchema = z.object({
  action: z.string().trim().min(1).optional(),
  target: z.string().trim().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().min(1).optional(),
});
export type AdminAuditQuery = z.infer<typeof AdminAuditQuerySchema>;

export const AdminAuditEntrySchema = z.object({
  id: z.string().uuid(),
  adminId: z.string().uuid(),
  action: z.string().min(1),
  target: z.string().min(1),
  reason: z.string().nullable(),
  requestId: z.string().uuid().nullable().optional(),
  createdAt: isoDate,
});
export type AdminAuditEntry = z.infer<typeof AdminAuditEntrySchema>;

export const AdminAuditResponseSchema = pagedResponse(AdminAuditEntrySchema, 'bản ghi nhật ký');
export type AdminAuditResponse = z.infer<typeof AdminAuditResponseSchema>;
