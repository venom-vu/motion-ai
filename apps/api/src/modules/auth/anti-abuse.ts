import crypto from 'node:crypto';

/** Số credit tặng khi đăng ký hợp lệ (FR12). */
export const SIGNUP_GRANT_AMOUNT = 500n;
/** Số tài khoản nhận thưởng tối đa trên mỗi IP trong cửa sổ thời gian. */
export const SIGNUP_GRANT_MAX_PER_IP = 3;
/** Cửa sổ đếm theo IP: 24 giờ. */
export const SIGNUP_GRANT_IP_WINDOW_MS = 24 * 60 * 60 * 1000;

const DEV_ANTI_ABUSE_SECRET =
  'motion-ai-anti-abuse-dev-secret-change-me-in-production-min-32-chars';

export function getAntiAbuseSecret(): string {
  return (
    process.env.ANTI_ABUSE_SECRET ||
    process.env.JWT_SECRET ||
    DEV_ANTI_ABUSE_SECRET
  );
}

/** HMAC-SHA256 hex (64 ký tự) với khóa bí mật phía server. */
export function hmacHex(value: string, secret: string = getAntiAbuseSecret()): string {
  return crypto.createHmac('sha256', secret).update(value).digest('hex');
}
