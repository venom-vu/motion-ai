import QRCode from 'qrcode';
import {
  TOPUP_STATUS_LABELS_VI,
  getTopupStatusLabelVi,
  type TopupStatus,
} from '@motion-ai/contracts';

export {
  TOPUP_STATUS_LABELS_VI,
  getTopupStatusLabelVi,
  type TopupStatus,
};

const VN_OFFSET_MS = 7 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const WINDOW_START_MS = 8 * HOUR_MS; // 08:00 UTC+7
const WINDOW_END_MS = 23 * HOUR_MS;   // 23:00 UTC+7

export const OFF_HOURS_MESSAGE_VI =
  'Đơn nạp được tạo ngoài khung giờ hỗ trợ (08:00 – 23:00). Đơn sẽ được duyệt từ 08:00 sáng hôm sau.';

/**
 * Kiểm tra xem một thời điểm có nằm ngoài khung làm việc [08:00, 23:00) giờ Việt Nam (UTC+7, không DST) hay không.
 */
export function isOutsideWorkingHoursVn(
  date: Date | string | number = new Date(),
): boolean {
  const ms =
    typeof date === 'string'
      ? Date.parse(date)
      : date instanceof Date
        ? date.getTime()
        : date;
  if (!Number.isFinite(ms)) {
    return false;
  }
  const local = ms + VN_OFFSET_MS;
  const dayStart = Math.floor(local / DAY_MS) * DAY_MS;
  const offset = local - dayStart;
  return offset < WINDOW_START_MS || offset >= WINDOW_END_MS;
}

/**
 * Có hiện banner "ngoài khung giờ" hay không.
 * - pending: dựa vào approveBy do server tính; SLA 15 phút, nên hạn duyệt còn xa hơn 15 phút nghĩa là đơn bị lùi sang khung giờ làm việc kế tiếp.
 * - trạng thái khác: dựa vào thời điểm tạo đơn.
 */
export function isApprovalDeferred(
  topup: { status: string; createdAt: string; approveBy?: string | null },
  now: number = Date.now(),
): boolean {
  if (topup.status === 'pending') {
    if (!topup.approveBy) {
      return false;
    }
    const approveMs = Date.parse(topup.approveBy);
    return Number.isFinite(approveMs) && approveMs - now > 15 * 60 * 1000;
  }
  return isOutsideWorkingHoursVn(topup.createdAt);
}

/**
 * Tính số giây còn lại từ mốc qrExpiresAt của server so với thời điểm hiện tại.
 */
export function getRemainingSeconds(
  qrExpiresAt: string,
  now: number = Date.now(),
): number {
  const expiresMs = Date.parse(qrExpiresAt);
  if (!Number.isFinite(expiresMs)) {
    return 0;
  }
  const diff = expiresMs - now;
  return Math.max(0, Math.floor(diff / 1000));
}

/**
 * Kiểm tra mã QR đã hết hạn dựa trên qrExpiresAt của server.
 */
export function isQrExpired(
  qrExpiresAt: string,
  now: number = Date.now(),
): boolean {
  const expiresMs = Date.parse(qrExpiresAt);
  if (!Number.isFinite(expiresMs)) {
    return true;
  }
  return expiresMs <= now;
}

/**
 * Định dạng số giây còn lại thành chuỗi mm:ss (ví dụ "14:45", "00:00").
 */
export function formatCountdown(totalSeconds: number): string {
  const clamped = Math.max(0, Math.floor(totalSeconds));
  const minutes = Math.floor(clamped / 60);
  const seconds = clamped % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

/**
 * Tạo chuỗi SVG mã QR an toàn cho cả SSR và Client từ chuỗi qrPayload.
 */
export async function generateQrSvg(
  qrPayload: string,
  options?: QRCode.QRCodeToStringOptions,
): Promise<string> {
  return QRCode.toString(qrPayload, {
    type: 'svg',
    margin: 1,
    errorCorrectionLevel: 'M',
    ...options,
  });
}

const VIETNAM_TIMESTAMP_FORMATTER = new Intl.DateTimeFormat('vi-VN', {
  dateStyle: 'short',
  timeStyle: 'short',
  timeZone: 'Asia/Ho_Chi_Minh',
});

/**
 * Định dạng thời gian theo chuẩn Việt Nam.
 */
export function formatTopupTimestampVi(isoString: string): string {
  if (!isoString) {
    return '-';
  }
  const d = new Date(isoString);
  if (Number.isNaN(d.getTime())) {
    return '-';
  }
  return VIETNAM_TIMESTAMP_FORMATTER.format(d);
}

/**
 * Lấy CSS class nhãn trạng thái đơn nạp theo bảng màu Slate Cyber.
 */
export function getTopupStatusBadgeClass(status: TopupStatus): string {
  switch (status) {
    case 'awaiting_transfer':
      return 'border-amber-500/40 bg-amber-500/10 text-amber-300';
    case 'pending':
      return 'border-cyan-500/40 bg-cyan-500/10 text-cyan-300';
    case 'approved':
      return 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300';
    case 'rejected':
      return 'border-rose-500/40 bg-rose-500/10 text-rose-300';
    case 'needs_review':
      return 'border-orange-500/40 bg-orange-500/10 text-orange-300';
    case 'expired':
      return 'border-slate-500/40 bg-slate-500/10 text-slate-400';
    default:
      return 'border-cyber-border bg-cyber-bg text-cyber-muted';
  }
}

