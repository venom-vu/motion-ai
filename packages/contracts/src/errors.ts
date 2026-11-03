import { z } from 'zod';

/**
 * Mã lỗi API chuẩn cho toàn bộ hệ thống Motion AI (Epic 1).
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
