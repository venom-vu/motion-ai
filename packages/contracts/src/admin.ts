import { z } from 'zod';
import { UserRoleSchema } from './auth.js';
import { pagedResponse } from './topups.js';
import { TaskPipelineSchema, TaskStatusSchema } from './tasks.js';
import { AccountTierSchema, LedgerEntrySchema } from './wallet.js';

const REASON_EMPTY_VI = 'Vui lòng nhập lý do.';
/** Lý do: chuỗi sau trim, không rỗng. */
const reasonField = z
  .string({ required_error: REASON_EMPTY_VI, invalid_type_error: REASON_EMPTY_VI })
  .trim()
  .min(1, REASON_EMPTY_VI)
  .max(500, 'Lý do tối đa 500 ký tự.');

const isoDate = z.string().datetime();

export const AdminUserIdParamsSchema = z.object({ id: z.string().uuid() });
export type AdminUserIdParams = z.infer<typeof AdminUserIdParamsSchema>;

export const AdminUserSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  role: UserRoleSchema,
  tier: AccountTierSchema,
  balance: z.number().int().nonnegative(),
  held: z.number().int().nonnegative(),
  lockedAt: isoDate.nullable(),
  createdAt: isoDate,
});
export type AdminUser = z.infer<typeof AdminUserSchema>;

/** GET /admin/users?email= */
export const AdminUserSearchQuerySchema = z.object({
  email: z.string().trim().min(1, 'Vui lòng nhập email cần tìm.'),
});
export type AdminUserSearchQuery = z.infer<typeof AdminUserSearchQuerySchema>;
/** Trả đúng một tài khoản; không tìm thấy trả 404 (ApiError). */
export const AdminUserSearchResponseSchema = AdminUserSchema;
export type AdminUserSearchResponse = AdminUser;

/** GET /admin/users/{id} */
export const AdminUserGetResponseSchema = AdminUserSchema;
export type AdminUserGetResponse = AdminUser;

/** GET /admin/users/{id}/ledger — mới nhất trước. */
export const AdminUserLedgerQuerySchema = z.object({
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().min(1).optional(),
});
export type AdminUserLedgerQuery = z.infer<typeof AdminUserLedgerQuerySchema>;
export const AdminUserLedgerResponseSchema = pagedResponse(LedgerEntrySchema, 'bút toán');
export type AdminUserLedgerResponse = z.infer<typeof AdminUserLedgerResponseSchema>;

/** POST /admin/users/{id}/lock | unlock */
export const AdminUserLockRequestSchema = z.object({ reason: reasonField }).strict();
export type AdminUserLockRequest = z.infer<typeof AdminUserLockRequestSchema>;
export const AdminUserUnlockRequestSchema = AdminUserLockRequestSchema;
export type AdminUserUnlockRequest = AdminUserLockRequest;
export const AdminUserLockResponseSchema = AdminUserSchema;
export type AdminUserLockResponse = AdminUser;
export const AdminUserUnlockResponseSchema = AdminUserSchema;
export type AdminUserUnlockResponse = AdminUser;

/** POST /admin/users/{id}/adjust — idempotent theo requestId; giới hạn do server (ADMIN_ADJUST_MAX). */
export const AdminAdjustRequestSchema = z
  .object({
    amount: z
      .number({ invalid_type_error: 'Số credit phải là số nguyên khác 0.', required_error: 'Vui lòng nhập số credit.' })
      .int('Số credit phải là số nguyên khác 0.')
      .safe('Số credit quá lớn.')
      .refine((n) => n !== 0, 'Số credit phải khác 0.'),
    reason: reasonField,
    requestId: z.string({ required_error: 'Thiếu requestId.' }).uuid('requestId phải là UUID.'),
  })
  .strict();
export type AdminAdjustRequest = z.infer<typeof AdminAdjustRequestSchema>;
export const AdminAdjustResponseSchema = z.object({
  user: AdminUserSchema,
  entry: LedgerEntrySchema,
});
export type AdminAdjustResponse = z.infer<typeof AdminAdjustResponseSchema>;

/** GET /admin/tasks/lookup — đúng một trong taskId | shareUrl. */
export const AdminTaskLookupQuerySchema = z
  .object({
    taskId: z.string().uuid('taskId phải là UUID.').optional(),
    shareUrl: z.string().trim().url('shareUrl không hợp lệ.').optional(),
  })
  .strict()
  .superRefine((q, ctx) => {
    if ((q.taskId == null) === (q.shareUrl == null)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [],
        message: 'Chỉ nhập một trong taskId hoặc shareUrl.',
      });
    }
  });
export type AdminTaskLookupQuery = z.infer<typeof AdminTaskLookupQuerySchema>;

export const AdminTaskLookupResponseSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  userEmail: z.string().email(),
  pipeline: TaskPipelineSchema,
  status: TaskStatusSchema,
  creditCost: z.number().int().positive(),
  filesRemovedAt: isoDate.nullable(),
  createdAt: isoDate,
});
export type AdminTaskLookupResponse = z.infer<typeof AdminTaskLookupResponseSchema>;

/** POST /admin/tasks/{id}/takedown — idempotent; chỉ Task đã kết thúc. */
export const AdminTaskTakedownRequestSchema = z.object({ reason: reasonField }).strict();
export type AdminTaskTakedownRequest = z.infer<typeof AdminTaskTakedownRequestSchema>;
export const AdminTaskTakedownResponseSchema = z.object({
  taskId: z.string().uuid(),
  filesRemovedAt: isoDate,
});
export type AdminTaskTakedownResponse = z.infer<typeof AdminTaskTakedownResponseSchema>;
