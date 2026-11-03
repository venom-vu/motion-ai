import net from 'node:net';

/** Dải IP Cloudflare (https://www.cloudflare.com/ips/), cố định trong mã. */
export const CLOUDFLARE_CIDRS: readonly string[] = [
  '173.245.48.0/20',
  '103.21.244.0/22',
  '103.22.200.0/22',
  '103.31.4.0/22',
  '141.101.64.0/18',
  '108.162.192.0/18',
  '190.93.240.0/20',
  '188.114.96.0/20',
  '197.234.240.0/22',
  '198.41.128.0/17',
  '162.158.0.0/15',
  '104.16.0.0/13',
  '104.24.0.0/14',
  '172.64.0.0/13',
  '131.0.72.0/22',
  '2400:cb00::/32',
  '2606:4700::/32',
  '2803:f800::/32',
  '2405:b500::/32',
  '2405:8100::/32',
  '2a06:98c0::/29',
  '2c0f:f248::/32',
];

const MAPPED_PREFIX = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i;

/** Trả về IPv4 thuần nếu là IPv4 hoặc IPv4-mapped IPv6; ngược lại null. */
function toIpv4(ip: string): string | null {
  if (net.isIPv4(ip)) return ip;
  const m = MAPPED_PREFIX.exec(ip);
  return m && net.isIPv4(m[1]!) ? m[1]! : null;
}

/** Chuẩn hóa: IPv4 → `::ffff:a.b.c.d`, IPv6 → chữ thường. Không hợp lệ → null. */
export function normalizeIp(raw: string | undefined | null): string | null {
  const ip = (raw ?? '').trim();
  if (!ip) return null;
  const v4 = toIpv4(ip);
  if (v4) return `::ffff:${v4}`;
  if (net.isIPv6(ip)) return ip.toLowerCase();
  return null;
}

export function buildBlockList(cidrs: readonly string[]): net.BlockList {
  const list = new net.BlockList();
  for (const cidr of cidrs) {
    const parts = cidr.trim().split('/');
    const base = parts[0]?.trim();
    if (!base) continue;
    const baseFamily = net.isIPv4(base) ? 'ipv4' : net.isIPv6(base) ? 'ipv6' : null;
    if (!baseFamily) continue;
    const maxPrefix = baseFamily === 'ipv4' ? 32 : 128;
    const prefix =
      parts[1] !== undefined
        ? Number(parts[1])
        : maxPrefix;
    if (!Number.isInteger(prefix) || prefix < 0 || prefix > maxPrefix) continue;
    try {
      list.addSubnet(base, prefix, baseFamily);
    } catch {
      // Bỏ qua dải CIDR sai cú pháp để không ném lỗi ra ngoài
    }
  }
  return list;
}

export function isIpInCidrs(ip: string, cidrs: readonly string[]): boolean {
  const v4 = toIpv4(ip);
  const family = v4 ? 'ipv4' : net.isIPv6(ip) ? 'ipv6' : null;
  if (!family) return false;
  const target = v4 ?? ip;
  const list = buildBlockList(cidrs);
  return list.check(target, family);
}

export function getTrustedProxyCidrs(): string[] {
  const extra = (process.env.TRUSTED_PROXY_CIDRS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  return [...CLOUDFLARE_CIDRS, ...extra];
}

let cachedTrustedProxyKey = '';
let cachedTrustedBlockList: net.BlockList | null = null;

export function getTrustedProxyBlockList(): net.BlockList {
  const extra = process.env.TRUSTED_PROXY_CIDRS ?? '';
  if (!cachedTrustedBlockList || cachedTrustedProxyKey !== extra) {
    cachedTrustedProxyKey = extra;
    cachedTrustedBlockList = buildBlockList(getTrustedProxyCidrs());
  }
  return cachedTrustedBlockList;
}

export interface ClientIpRequest {
  headers?: Record<string, string | string[] | undefined>;
  ip?: string;
  socket?: { remoteAddress?: string };
}

/**
 * IP khách: chỉ tin `CF-Connecting-IP` khi địa chỉ kết nối nằm trong dải tin cậy.
 * Dùng `socket.remoteAddress` (không phải `req.ip`) để không bị ảnh hưởng bởi X-Forwarded-For.
 */
export function resolveClientIp(req: ClientIpRequest): string {
  const connection = normalizeIp(req.socket?.remoteAddress ?? req.ip) ?? 'unknown';
  if (connection !== 'unknown') {
    const v4 = toIpv4(connection);
    const family = v4 ? 'ipv4' : net.isIPv6(connection) ? 'ipv6' : null;
    if (family && getTrustedProxyBlockList().check(v4 ?? connection, family)) {
      const headerKey = Object.keys(req.headers ?? {}).find(
        (k) => k.toLowerCase() === 'cf-connecting-ip',
      );
      const header = headerKey ? req.headers?.[headerKey] : undefined;
      const rawValue = Array.isArray(header) ? header[0] : header;
      const value = rawValue ? rawValue.split(',')[0]?.trim() : undefined;
      const fromHeader = normalizeIp(value);
      if (fromHeader) return fromHeader;
    }
  }
  return connection;
}
