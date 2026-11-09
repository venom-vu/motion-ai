import crypto from 'node:crypto';

/** Số credit tặng khi đăng ký hợp lệ (FR12). */
export const SIGNUP_GRANT_AMOUNT = 500n;
/** Số tài khoản nhận thưởng tối đa trên mỗi IP trong cửa sổ thời gian. */
export const SIGNUP_GRANT_MAX_PER_IP = 3;
/** Cửa sổ đếm theo IP: 24 giờ. */
export const SIGNUP_GRANT_IP_WINDOW_MS = 24 * 60 * 60 * 1000;

const DEV_ANTI_ABUSE_SECRET =
  'flowvis-anti-abuse-dev-secret-change-me-in-production-min-32-chars';
const MIN_SECRET_LENGTH = 32;

/**
 * Khóa HMAC chống lạm dụng. Production bắt buộc đặt `ANTI_ABUSE_SECRET` riêng (>= 32 ký tự):
 * không dùng chung với JWT_SECRET và không rơi về hằng số công khai trong mã nguồn.
 */
export function getAntiAbuseSecret(): string {
  const secret = process.env.ANTI_ABUSE_SECRET;
  if (process.env.NODE_ENV === 'production') {
    if (!secret || secret.length < MIN_SECRET_LENGTH) {
      throw new Error(
        `ANTI_ABUSE_SECRET là bắt buộc ở production và phải dài tối thiểu ${MIN_SECRET_LENGTH} ký tự`,
      );
    }
    return secret;
  }
  return secret || DEV_ANTI_ABUSE_SECRET;
}

/** HMAC-SHA256 hex (64 ký tự) với khóa bí mật phía server. */
export function hmacHex(value: string, secret: string = getAntiAbuseSecret()): string {
  return crypto.createHmac('sha256', secret).update(value).digest('hex');
}

/** Cookie định danh thiết bị do server cấp và ký (không tin `deviceId` do client tự gửi). */
export const DEVICE_COOKIE_NAME = 'motion_device';

export function signDeviceId(deviceId: string): string {
  return `${deviceId}.${hmacHex(`device-cookie:${deviceId}`).slice(0, 32)}`;
}

/** Trả về deviceId nếu chữ ký hợp lệ, ngược lại null. */
export function verifyDeviceCookie(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const dot = value.lastIndexOf('.');
  if (dot <= 0) return null;
  const id = value.slice(0, dot);
  if (!/^[0-9a-f]{32}$/.test(id)) return null;
  const expected = Buffer.from(signDeviceId(id));
  const actual = Buffer.from(value);
  if (expected.length !== actual.length) return null;
  return crypto.timingSafeEqual(expected, actual) ? id : null;
}

export function issueDeviceCookie(): { deviceId: string; cookieValue: string } {
  const deviceId = crypto.randomBytes(16).toString('hex');
  return { deviceId, cookieValue: signDeviceId(deviceId) };
}
