import { MOTION_MIN_TRIM_SECONDS } from '@flowvis/contracts';

export interface TrimRange {
  start: number;
  end: number;
}

export interface TrimLimits {
  /** Giới hạn trên của video (giây nguyên, làm tròn xuống). */
  total: number;
  /** Độ dài đoạn tối đa = min(Cap, total). */
  maxLength: number;
  /** false khi Cap hoặc độ dài video (làm tròn xuống) nhỏ hơn độ dài tối thiểu. */
  usable: boolean;
}

export function computeTrimLimits(
  durationSeconds: number,
  capSeconds: number | null | undefined,
): TrimLimits {
  const total = Math.max(0, Math.floor(durationSeconds));
  const cap =
    typeof capSeconds === 'number' && capSeconds > 0
      ? Math.floor(capSeconds)
      : total;
  const maxLength = Math.min(cap, total);
  return { total, maxLength, usable: maxLength >= MOTION_MIN_TRIM_SECONDS };
}

export function defaultTrim(limits: TrimLimits): TrimRange {
  if (!limits.usable) return { start: 0, end: limits.maxLength };
  return { start: 0, end: Math.min(limits.maxLength, limits.total) };
}

/** Đưa đoạn bất kỳ về khoảng hợp lệ (dùng khi giới hạn đổi). */
export function normalizeTrim(range: TrimRange, limits: TrimLimits): TrimRange {
  const min = MOTION_MIN_TRIM_SECONDS;
  if (!limits.usable) return { start: 0, end: limits.maxLength };
  let end = Math.min(limits.total, Math.max(min, Math.round(range.end)));
  let start = Math.max(0, Math.round(range.start));
  if (end - start < min) start = end - min;
  if (end - start > limits.maxLength) end = start + limits.maxLength;
  if (start < 0) {
    start = 0;
    end = Math.min(limits.total, min);
  }
  return { start, end };
}

export function moveStart(
  range: TrimRange,
  value: number,
  limits: TrimLimits,
): TrimRange {
  const v = Math.round(value);
  let start = Math.min(Math.max(0, v), range.end - MOTION_MIN_TRIM_SECONDS);
  if (range.end - start > limits.maxLength) start = range.end - limits.maxLength;
  return { start, end: range.end };
}

export function moveEnd(
  range: TrimRange,
  value: number,
  limits: TrimLimits,
): TrimRange {
  const v = Math.round(value);
  let end = Math.max(
    Math.min(limits.total, v),
    range.start + MOTION_MIN_TRIM_SECONDS,
  );
  if (end - range.start > limits.maxLength) end = range.start + limits.maxLength;
  return { start: range.start, end };
}

/** Định dạng mm:ss từ số giây nguyên. */
export function formatClock(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
