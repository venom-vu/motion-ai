import { z } from 'zod';

/**
 * Mã lỗi API chuẩn cho toàn bộ hệ thống flowvis (Epic 1).
 */
export enum ApiErrorCode {
  PAUSED = 'PAUSED',
  INSUFFICIENT_CREDIT = 'INSUFFICIENT_CREDIT',
  TASK_LIMIT = 'TASK_LIMIT',
  ACCOUNT_LOCKED = 'ACCOUNT_LOCKED',
  CONSENT_REQUIRED = 'CONSENT_REQUIRED',
  VALIDATION_FAILED = 'VALIDATION_FAILED',
  RATE_LIMITED = 'RATE_LIMITED',
  EMAIL_LINKED_TO_OTHER_ACCOUNT = 'EMAIL_LINKED_TO_OTHER_ACCOUNT',
  NOT_FOUND = 'NOT_FOUND',
  FORBIDDEN = 'FORBIDDEN',
  CONFLICT = 'CONFLICT',
  TOPUP_LIMIT = 'TOPUP_LIMIT',
  BANK_REF_DUPLICATE = 'BANK_REF_DUPLICATE',
  TOPUP_STATE_INVALID = 'TOPUP_STATE_INVALID',
  TOPUP_QR_EXPIRED = 'TOPUP_QR_EXPIRED',
}

export const ApiErrorCodeSchema = z.nativeEnum(ApiErrorCode);

export const ApiErrorSchema = z.object({
  code: ApiErrorCodeSchema,
  message: z.string().min(1),
  details: z.record(z.string(), z.unknown()).optional(),
});

export interface ApiError {
  code: ApiErrorCode;
  message: string;
  details?: Record<string, unknown>;
}

/** Số đơn nạp tối đa ở `awaiting_transfer`, `pending`, `needs_review` của một người dùng. */
export const MAX_OPEN_TOPUPS = 3 as const;

/**
 * Bảng ánh xạ mã lỗi API sang thông báo tiếng Việt thân thiện cho người dùng.
 */
export const API_ERROR_MESSAGES_VI: Readonly<Record<ApiErrorCode, string>> = {
  [ApiErrorCode.PAUSED]:
    'Hệ thống đang tạm dừng tiếp nhận yêu cầu mới để bảo trì. Vui lòng thử lại sau.',
  [ApiErrorCode.INSUFFICIENT_CREDIT]:
    'Số dư credit không đủ để thực hiện tác vụ này. Vui lòng nạp thêm credit.',
  [ApiErrorCode.TASK_LIMIT]:
    'Bạn đã đạt giới hạn số tác vụ đang chạy đồng thời. Vui lòng đợi tác vụ hiện tại hoàn tất.',
  [ApiErrorCode.ACCOUNT_LOCKED]:
    'Tài khoản của bạn đã bị khóa. Vui lòng liên hệ bộ phận hỗ trợ.',
  [ApiErrorCode.CONSENT_REQUIRED]:
    'Bạn cần đồng ý với Điều khoản dịch vụ (ToS) phiên bản hiện hành trước khi tiếp tục.',
  [ApiErrorCode.VALIDATION_FAILED]:
    'Dữ liệu gửi lên không hợp lệ. Vui lòng kiểm tra lại thông tin.',
  [ApiErrorCode.RATE_LIMITED]:
    'Bạn thao tác quá nhanh. Vui lòng đợi ít phút rồi thử lại.',
  [ApiErrorCode.EMAIL_LINKED_TO_OTHER_ACCOUNT]:
    'Email này đã được liên kết với một tài khoản Google khác. Vui lòng đăng nhập bằng đúng tài khoản Google đã đăng ký.',
  [ApiErrorCode.NOT_FOUND]:
    'Không tìm thấy nội dung bạn yêu cầu hoặc liên kết đã bị thu hồi.',
  [ApiErrorCode.FORBIDDEN]:
    'Bạn không có quyền thực hiện thao tác này.',
  [ApiErrorCode.CONFLICT]:
    'Thao tác không phù hợp với trạng thái hiện tại của tác vụ. Vui lòng tải lại và thử lại.',
  [ApiErrorCode.TOPUP_LIMIT]:
    `Bạn đang có tối đa ${MAX_OPEN_TOPUPS} đơn nạp chưa hoàn tất. Vui lòng đợi các đơn đó được xử lý trước khi tạo đơn mới.`,
  [ApiErrorCode.BANK_REF_DUPLICATE]:
    'Mã giao dịch ngân hàng này đã được dùng cho một đơn nạp khác. Vui lòng kiểm tra lại.',
  [ApiErrorCode.TOPUP_STATE_INVALID]:
    'Đơn nạp không ở trạng thái phù hợp để thực hiện thao tác này. Vui lòng tải lại danh sách.',
  [ApiErrorCode.TOPUP_QR_EXPIRED]:
    'Mã QR đã hết hạn. Vui lòng tạo mã mới để tiếp tục nạp credit.',
};

/**
 * Trả về thông báo tiếng Việt thân thiện tương ứng với mã lỗi API.
 */
export function getApiErrorMessageVi(
  code: ApiErrorCode | (string & {}) | null | undefined,
): string {
  if (code && Object.prototype.hasOwnProperty.call(API_ERROR_MESSAGES_VI, code)) {
    return API_ERROR_MESSAGES_VI[code as ApiErrorCode];
  }
  return 'Đã xảy ra lỗi không xác định. Vui lòng thử lại sau.';
}
