import { z } from 'zod';
import { TopupPackIdSchema } from './wallet.js';

/** Trạng thái đơn nạp (Epic 3). */
export const TOPUP_STATUSES = [
  'awaiting_transfer',
  'pending',
  'approved',
  'rejected',
  'needs_review',
  'expired',
] as const;
export type TopupStatus = (typeof TOPUP_STATUSES)[number];
export const TopupStatusSchema = z.enum(TOPUP_STATUSES);

export const TOPUP_STATUS_LABELS_VI: Readonly<Record<TopupStatus, string>> = {
  awaiting_transfer: 'Chờ chuyển khoản',
  pending: 'Đang chờ duyệt',
  approved: 'Đã duyệt',
  rejected: 'Bị từ chối',
  needs_review: 'Cần xem xét',
  expired: 'Đã hết hạn',
};

const UNKNOWN_TOPUP_STATUS_LABEL_VI = 'Không xác định';

export function getTopupStatusLabelVi(
  status: TopupStatus | (string & {}) | null | undefined,
): string {
  if (status && Object.prototype.hasOwnProperty.call(TOPUP_STATUS_LABELS_VI, status)) {
    return TOPUP_STATUS_LABELS_VI[status as TopupStatus];
  }
  return UNKNOWN_TOPUP_STATUS_LABEL_VI;
}

const TopupBaseShape = {
  id: z.string().uuid(),
  code: z.string().min(1),
  pack: TopupPackIdSchema,
  status: TopupStatusSchema,
  amountVnd: z.number().int().positive(),
  credits: z.number().int().positive(),
  transferContent: z.string().min(1),
  qrPayload: z.string().min(1),
  bankCode: z.string().min(1),
  accountNumber: z.string().min(1),
  accountName: z.string().min(1),
  qrExpiresAt: z.string().datetime(),
  approveBy: z.string().datetime().nullable().optional(),
  bankRef: z.string().min(1).nullable().optional(),
  rejectReason: z.string().min(1).nullable().optional(),
  note: z.string().min(1).nullable().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
};

type TopupInvariantInput = {
  code: string;
  transferContent: string;
  status: TopupStatus;
  approveBy?: string | null;
  bankRef?: string | null;
  rejectReason?: string | null;
  note?: string | null;
};

function checkTopupInvariants(t: TopupInvariantInput, ctx: z.RefinementCtx): void {
  const issue = (path: string, message: string) =>
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: [path], message });
  if (t.transferContent !== `NAP ${t.code}`) {
    issue('transferContent', 'Nội dung chuyển khoản phải có dạng "NAP <code>"');
  }
  if (t.status === 'pending' && t.approveBy == null) {
    issue('approveBy', 'Đơn pending bắt buộc có approveBy');
  }
  if (t.status === 'approved' && t.bankRef == null) {
    issue('bankRef', 'Đơn approved bắt buộc có bankRef');
  }
  if (t.status !== 'approved' && t.bankRef != null) {
    issue('bankRef', 'bankRef chỉ có khi đơn approved');
  }
  if (t.status === 'needs_review' && t.note == null) {
    issue('note', 'Đơn needs_review bắt buộc có note');
  }
  if (t.status !== 'needs_review' && t.note != null) {
    issue('note', 'note chỉ có khi đơn needs_review');
  }
  if (t.status === 'rejected' && t.rejectReason == null) {
    issue('rejectReason', 'Đơn rejected bắt buộc có rejectReason');
  }
  if (t.status !== 'rejected' && t.rejectReason != null) {
    issue('rejectReason', 'rejectReason chỉ có khi đơn rejected');
  }
}

/** Đơn nạp (phía người dùng). Số tiền, credit do server quyết định. */
export const TopupSchema = z.object(TopupBaseShape).superRefine(checkTopupInvariants);
export type Topup = z.infer<typeof TopupSchema>;

/** Đơn nạp phía Admin: chỉ `userId`, không lộ email. */
export const AdminTopupSchema = z
  .object({
    ...TopupBaseShape,
    userId: z.string().uuid(),
    isOverdue: z.boolean(),
  })
  .superRefine((t, ctx) => {
    checkTopupInvariants(t, ctx);
    if (t.isOverdue && t.status !== 'pending') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['isOverdue'],
        message: 'Chỉ đơn pending mới có thể quá hạn duyệt (isOverdue)',
      });
    }
  });
export type AdminTopup = z.infer<typeof AdminTopupSchema>;

export const TopupIdParamsSchema = z.object({ id: z.string().uuid() });
export type TopupIdParams = z.infer<typeof TopupIdParamsSchema>;

/** POST /topups — số tiền do server quyết định, không nhận từ client. */
export const TopupCreateRequestSchema = z
  .object({
    pack: TopupPackIdSchema,
  })
  .strict();
export type TopupCreateRequest = z.infer<typeof TopupCreateRequestSchema>;
export const TopupCreateResponseSchema = TopupSchema;
export type TopupCreateResponse = Topup;

/** POST /topups/{id}/confirm-transfer — body rỗng, idempotent. */
export const TopupConfirmTransferRequestSchema = z.object({}).strict().optional();
export type TopupConfirmTransferRequest = z.infer<typeof TopupConfirmTransferRequestSchema>;
export const TopupConfirmTransferResponseSchema = TopupSchema;
export type TopupConfirmTransferResponse = Topup;

/** GET /topups — cursor, mới nhất trước (như GET /tasks). */
export const TopupListQuerySchema = z.object({
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().min(1).optional(),
});
export type TopupListQuery = z.infer<typeof TopupListQuerySchema>;

function pagedResponse<T extends z.ZodTypeAny>(item: T, noun: string) {
  return z
    .object({
      items: z.array(item),
      pageSize: z.number().int().min(1).max(100),
      hasMore: z.boolean(),
      nextCursor: z.string().min(1).nullable(),
    })
    .superRefine((res, ctx) => {
      if (res.items.length > res.pageSize) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['items'],
          message: `Số ${noun} không được vượt quá pageSize`,
        });
      }
      if (res.hasMore && res.items.length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['hasMore'],
          message: 'Trang rỗng không được có hasMore = true',
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
}

export const TopupListResponseSchema = pagedResponse(TopupSchema, 'đơn nạp');
export type TopupListResponse = z.infer<typeof TopupListResponseSchema>;

/** GET /topups/{id} — cùng hình dạng phản hồi tạo đơn để FE dựng lại QR. */
export const TopupGetResponseSchema = TopupSchema;
export type TopupGetResponse = Topup;

/* ---------------------------- Admin ---------------------------- */

/** GET /admin/topups */
export const AdminTopupListQuerySchema = z.object({
  status: TopupStatusSchema.optional(),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().min(1).optional(),
});
export type AdminTopupListQuery = z.infer<typeof AdminTopupListQuerySchema>;
export const AdminTopupListResponseSchema = pagedResponse(AdminTopupSchema, 'đơn nạp');
export type AdminTopupListResponse = z.infer<typeof AdminTopupListResponseSchema>;

const bankRefField = z
  .string({ required_error: 'Vui lòng nhập mã giao dịch ngân hàng (bank_ref).' })
  .trim()
  .min(1, 'Vui lòng nhập mã giao dịch ngân hàng (bank_ref).')
  .max(128, 'Mã giao dịch ngân hàng tối đa 128 ký tự.');

/** POST /admin/topups/{id}/approve */
export const AdminTopupApproveRequestSchema = z.object({ bankRef: bankRefField }).strict();
export type AdminTopupApproveRequest = z.infer<typeof AdminTopupApproveRequestSchema>;
export const AdminTopupApproveResponseSchema = AdminTopupSchema;
export type AdminTopupApproveResponse = AdminTopup;

/** POST /admin/topups/{id}/approve-expired — duyệt đơn đã expired. */
export const AdminTopupApproveExpiredRequestSchema = AdminTopupApproveRequestSchema;
export type AdminTopupApproveExpiredRequest = AdminTopupApproveRequest;
export const AdminTopupApproveExpiredResponseSchema = AdminTopupSchema;
export type AdminTopupApproveExpiredResponse = AdminTopup;

/** POST /admin/topups/{id}/reject */
export const AdminTopupRejectRequestSchema = z
  .object({
    rejectReason: z
      .string({ required_error: 'Vui lòng nhập lý do từ chối.' })
      .trim()
      .min(1, 'Vui lòng nhập lý do từ chối.')
      .max(500, 'Lý do từ chối tối đa 500 ký tự.'),
  })
  .strict();
export type AdminTopupRejectRequest = z.infer<typeof AdminTopupRejectRequestSchema>;
export const AdminTopupRejectResponseSchema = AdminTopupSchema;
export type AdminTopupRejectResponse = AdminTopup;

/** POST /admin/topups/{id}/needs-review */
export const AdminTopupNeedsReviewRequestSchema = z
  .object({
    note: z
      .string({ required_error: 'Vui lòng nhập ghi chú.' })
      .trim()
      .min(1, 'Vui lòng nhập ghi chú.')
      .max(500, 'Ghi chú tối đa 500 ký tự.'),
  })
  .strict();
export type AdminTopupNeedsReviewRequest = z.infer<typeof AdminTopupNeedsReviewRequestSchema>;
export const AdminTopupNeedsReviewResponseSchema = AdminTopupSchema;
export type AdminTopupNeedsReviewResponse = AdminTopup;

/** POST /admin/topups/{id}/return-to-pending — body rỗng. */
export const AdminTopupReturnToPendingRequestSchema = z.object({}).strict().optional();
export type AdminTopupReturnToPendingRequest = z.infer<
  typeof AdminTopupReturnToPendingRequestSchema
>;
export const AdminTopupReturnToPendingResponseSchema = AdminTopupSchema;
export type AdminTopupReturnToPendingResponse = AdminTopup;
