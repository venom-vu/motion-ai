import { ApiErrorCode } from '@flowvis/contracts';

export const MAINTENANCE_MESSAGE_VI =
  'Hệ thống đang bảo trì, tạm dừng nhận tác vụ mới';

export const REPORT_MAILTO_SUBJECT = 'Báo cáo vi phạm flowvis';
export const REPORT_MAILTO_BODY =
  'Vui lòng nêu mã tác vụ hoặc liên kết chia sẻ và mô tả vi phạm.';

/** mailto cố định: chỉ tiêu đề và hướng dẫn, không chèn dữ liệu người dùng. */
export function buildReportMailto(email: string): string {
  const to = email.trim();
  if (!to) return '#';
  return `mailto:${to}?subject=${encodeURIComponent(
    REPORT_MAILTO_SUBJECT,
  )}&body=${encodeURIComponent(REPORT_MAILTO_BODY)}`;
}

export function isPausedError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const e = error as { status?: unknown; code?: unknown };
  return e.status === 503 && e.code === ApiErrorCode.PAUSED;
}

/** Lỗi mạng giữ trạng thái trước; không ném lỗi. */
export async function resolveIntakePaused(
  fetchStatus: () => Promise<{ intakePaused: boolean }>,
  previous: boolean,
): Promise<boolean> {
  try {
    const res = await fetchStatus();
    return res.intakePaused === true;
  } catch {
    return previous;
  }
}
