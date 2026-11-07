const VN_OFFSET_MS = 7 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const WINDOW_START_MS = 8 * HOUR_MS;
const WINDOW_END_MS = 23 * HOUR_MS;
export const APPROVE_SLA_MS = 15 * 60 * 1000;

/**
 * Hạn duyệt = 15 phút sau thời điểm đầu tiên nằm trong khung [08:00, 23:00) giờ Việt Nam (UTC+7, không DST).
 * 08:00 thuộc khung, 23:00 không.
 */
export function computeApproveBy(now: Date): Date {
  const local = now.getTime() + VN_OFFSET_MS;
  const dayStart = Math.floor(local / DAY_MS) * DAY_MS;
  const offset = local - dayStart;
  let startLocal = local;
  if (offset < WINDOW_START_MS) startLocal = dayStart + WINDOW_START_MS;
  else if (offset >= WINDOW_END_MS) startLocal = dayStart + DAY_MS + WINDOW_START_MS;
  return new Date(startLocal - VN_OFFSET_MS + APPROVE_SLA_MS);
}
