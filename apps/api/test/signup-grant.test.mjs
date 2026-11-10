import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import net from 'node:net';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { ApiErrorCode, getApiErrorMessageVi, TOS_VERSION } from '@flowvis/contracts';
import pg from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../dist/generated/prisma/client.js';
import { bootstrapApi } from '../dist/main.js';
import { GoogleOAuthService } from '../dist/modules/auth/google-oauth.service.js';
import { RedisService } from '../dist/infra/redis.service.js';
import { WalletService } from '../dist/modules/wallet/wallet.service.js';
import {
  resolveClientIp,
  normalizeIp,
  isIpInCidrs,
  CLOUDFLARE_CIDRS,
} from '../dist/modules/auth/client-ip.js';
import {
  hmacHex,
  getAntiAbuseSecret,
  SIGNUP_GRANT_MAX_PER_IP,
} from '../dist/modules/auth/anti-abuse.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const apiRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(apiRoot, '../..');
const composePath = path.join(repoRoot, 'deploy', 'compose.yml');

const DEFAULT_DATABASE_URL =
  process.env.DATABASE_URL ||
  'postgresql://motion_user:change_me_local_password@localhost:5432/flowvis?schema=public';
const DEFAULT_REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

function checkTcpPort(host, port, timeoutMs = 1000) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    const onDone = (ok) => {
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => onDone(true));
    socket.once('timeout', () => onDone(false));
    socket.once('error', () => onDone(false));
    socket.connect(port, host);
  });
}

async function ensureInfraRunning() {
  const dbUrl = new URL(DEFAULT_DATABASE_URL);
  const redisUrl = new URL(DEFAULT_REDIS_URL);

  const [pgUp, redisUp] = await Promise.all([
    checkTcpPort(dbUrl.hostname || 'localhost', Number(dbUrl.port || 5432)),
    checkTcpPort(redisUrl.hostname || 'localhost', Number(redisUrl.port || 6379)),
  ]);

  if (!pgUp || !redisUp) {
    execFileSync(
      'docker',
      [
        'compose',
        '-f',
        composePath,
        'up',
        '-d',
        '--wait',
        'postgres-16',
        'redis-7',
      ],
      {
        cwd: repoRoot,
        stdio: 'inherit',
      },
    );
  }

  execFileSync('pnpm', ['run', 'prisma:migrate:deploy'], {
    cwd: apiRoot,
    env: { ...process.env, DATABASE_URL: DEFAULT_DATABASE_URL },
    stdio: 'inherit',
  });
}

process.env.RUNNINGHUB_WORKFLOW_BODY_RESHAPE ??= 'wf-body';
process.env.RUNNINGHUB_WORKFLOW_MOTION ??= 'wf-motion';

describe('Story 1.8: [BE] Tặng 500 credit và chống lạm dụng', () => {
  let app;
  let baseUrl;
  let prisma;
  let pool;
  let googleOAuthService;
  let walletService;

  const testRunId = crypto.randomBytes(4).toString('hex');
  const createdUserIds = [];

  const pendingProfiles = new Map();

  before(async () => {
    process.env.DATABASE_URL = DEFAULT_DATABASE_URL;
    process.env.REDIS_URL = DEFAULT_REDIS_URL;
    process.env.PORT = '0';
    process.env.JWT_SECRET = 'test-jwt-secret-at-least-32-chars-long-ok';
    process.env.ANTI_ABUSE_SECRET = 'test-anti-abuse-secret-at-least-32-chars-long-ok';
    process.env.ADMIN_EMAILS = 'admin@flowvis.vn';
    process.env.FRONTEND_URL = 'http://localhost:3000';
    process.env.COOKIE_SECURE = 'true';
    process.env.TRUSTED_PROXY_CIDRS = '127.0.0.1/32,::1/128';
    process.env.AUTH_THROTTLE_LIMIT = '20';
    process.env.AUTH_THROTTLE_TTL_MS = '60000';

    await ensureInfraRunning();

    pool = new pg.Pool({ connectionString: DEFAULT_DATABASE_URL });
    const adapter = new PrismaPg(pool);
    prisma = new PrismaClient({ adapter });

    app = await bootstrapApi();
    const address = app.getHttpServer().address();
    baseUrl = `http://127.0.0.1:${address.port}`;

    // Bộ đếm throttle nằm trong Redis nên sống qua các lần chạy: xóa để test độc lập.
    const redis = app.get(RedisService).client;
    const staleKeys = await redis.keys('throttle:*');
    if (staleKeys.length > 0) await redis.del(...staleKeys);

    googleOAuthService = app.get(GoogleOAuthService);
    walletService = app.get(WalletService);

    // Cấu hình mock Google OAuth endpoint an toàn cho kiểm thử song song
    googleOAuthService.setFetchImpl(async (input, init) => {
      const urlStr = String(input);
      if (urlStr.includes('oauth2.googleapis.com/token')) {
        const params = new URLSearchParams(String(init?.body ?? ''));
        const code = params.get('code') ?? '';
        const profile = pendingProfiles.get(code);
        const token = `token-${code}`;
        if (profile) {
          pendingProfiles.set(token, profile);
        }
        return new Response(
          JSON.stringify({ access_token: token }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      if (urlStr.includes('googleapis.com/oauth2/v3/userinfo')) {
        const authHeader = String(
          init?.headers?.Authorization ??
            (init?.headers && typeof init.headers.get === 'function'
              ? init.headers.get('Authorization')
              : '') ??
            '',
        );
        const token = authHeader.replace(/^Bearer\s+/i, '');
        const profile = pendingProfiles.get(token);
        if (profile) {
          return new Response(
            JSON.stringify({
              sub: profile.googleId,
              email: profile.email,
              name: `User ${profile.googleId}`,
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          );
        }
      }
      return new Response('not found', { status: 404 });
    });
  });

  after(async () => {
    if (pool && createdUserIds.length > 0) {
      try {
        await pool.query('DELETE FROM ledger_entries WHERE user_id = ANY($1::uuid[])', [
          createdUserIds,
        ]);
        await pool.query('DELETE FROM signup_grants WHERE user_id = ANY($1::uuid[])', [
          createdUserIds,
        ]);
        await pool.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [createdUserIds]);
      } catch {
        // ignore cleanup error
      }
    }
    if (prisma) {
      try {
        await prisma.user.deleteMany({
          where: { email: { contains: testRunId } },
        });
      } catch {
        // ignore cleanup error
      }
      await prisma.$disconnect();
    }
    if (pool) {
      await pool.end();
    }
    if (app) {
      await app.close();
    }
  });

  /**
   * Helper: Giả lập đăng ký người dùng mới qua HTTP API với Google OAuth.
   */
  // Mô phỏng cookie jar của trình duyệt: mỗi `deviceId` logic = một trình duyệt, giữ cookie server cấp.
  const deviceJar = new Map();

  /** deviceId do server cấp (phần trước dấu chấm của cookie) ứng với một "trình duyệt" logic. */
  function serverDeviceId(deviceId) {
    const cookie = deviceJar.get(deviceId);
    assert.ok(cookie, `Chưa có cookie thiết bị cho ${deviceId}`);
    return decodeURIComponent(cookie.split('=')[1]).split('.')[0];
  }

  /** Lấy cookie thiết bị trước (tuần tự) để các đăng ký song song cùng một trình duyệt. */
  async function warmDevice(deviceId) {
    const res = await fetch(
      `${baseUrl}/auth/google?tosVersion=${TOS_VERSION}&deviceId=${encodeURIComponent(deviceId)}`,
      { headers: { 'CF-Connecting-IP': `203.0.113.${crypto.randomInt(1, 250)}` } },
    );
    for (const sc of res.headers.getSetCookie()) {
      if (sc.startsWith('motion_device=')) deviceJar.set(deviceId, sc.split(';')[0]);
    }
  }

  async function registerViaApi({
    email,
    googleId,
    deviceId,
    clientIp,
    extraHeaders = {},
  }) {
    // 1. Lấy redirect URL chứa state hợp lệ
    const jarCookie = deviceJar.get(deviceId);
    const authRes = await fetch(
      `${baseUrl}/auth/google?tosVersion=${TOS_VERSION}&deviceId=${encodeURIComponent(deviceId)}`,
      {
        headers: {
          ...(clientIp ? { 'CF-Connecting-IP': clientIp } : {}),
          ...(jarCookie ? { Cookie: jarCookie } : {}),
          ...extraHeaders,
        },
      },
    );
    assert.equal(authRes.status, 200, 'Khởi tạo OAuth phải thành công');
    for (const sc of authRes.headers.getSetCookie()) {
      if (sc.startsWith('motion_device=')) deviceJar.set(deviceId, sc.split(';')[0]);
    }
    const authData = await authRes.json();
    const redirectUrl = new URL(authData.redirectUrl);
    const state = redirectUrl.searchParams.get('state');

    // 2. Đăng ký mock Google OAuth profile theo code để an toàn khi chạy song song
    const code = `code-${googleId}-${crypto.randomBytes(4).toString('hex')}`;
    pendingProfiles.set(code, { googleId, email });

    // 3. Gọi Google callback
    const cbRes = await fetch(
      `${baseUrl}/auth/google/callback?code=${encodeURIComponent(code)}&state=${encodeURIComponent(state)}`,
      {
        headers: clientIp ? { 'CF-Connecting-IP': clientIp, ...extraHeaders } : extraHeaders,
      },
    );

    const body = await cbRes.json();
    return { status: cbRes.status, body };
  }

  // =========================================================================
  // 1. CSDL, Migration & Catalog
  // =========================================================================
  describe('CSDL, Migration & Catalog (signup_grants)', () => {
    it('bảng signup_grants có cấu trúc cột và kiểu dữ liệu chuẩn', async () => {
      const res = await pool.query(`
        SELECT column_name, data_type, is_nullable
        FROM information_schema.columns
        WHERE table_name = 'signup_grants'
      `);
      const cols = Object.fromEntries(
        res.rows.map((r) => [r.column_name, { type: r.data_type, nullable: r.is_nullable }]),
      );

      assert.ok(cols.user_id, 'Phải có cột user_id');
      assert.equal(cols.user_id.type, 'uuid');
      assert.equal(cols.user_id.nullable, 'NO');

      assert.ok(cols.fingerprint_hash, 'Phải có cột fingerprint_hash');
      assert.equal(cols.fingerprint_hash.type, 'text');
      assert.equal(cols.fingerprint_hash.nullable, 'NO');

      assert.ok(cols.ip_hash, 'Phải có cột ip_hash');
      assert.equal(cols.ip_hash.type, 'text');
      assert.equal(cols.ip_hash.nullable, 'NO');

      assert.ok(cols.granted, 'Phải có cột granted');
      assert.equal(cols.granted.type, 'bigint');
      assert.equal(cols.granted.nullable, 'NO');

      assert.ok(cols.created_at, 'Phải có cột created_at');
      assert.match(cols.created_at.type, /timestamp with time zone/i);
      assert.equal(cols.created_at.nullable, 'NO');
    });

    it('khóa ngoại user_id tham chiếu users(id) với ON DELETE CASCADE', async () => {
      const res = await pool.query(`
        SELECT
          tc.constraint_name,
          rc.delete_rule
        FROM information_schema.table_constraints AS tc
        JOIN information_schema.referential_constraints AS rc
          ON tc.constraint_name = rc.constraint_name
        WHERE tc.table_name = 'signup_grants' AND tc.constraint_type = 'FOREIGN KEY'
      `);
      assert.ok(res.rows.length >= 1, 'Phải có foreign key constraint');
      assert.equal(res.rows[0].delete_rule, 'CASCADE', 'Delete rule phải là CASCADE');
    });

    it('ràng buộc CHECK từ chối giá trị granted âm', async () => {
      const fakeUserId = crypto.randomUUID();
      // Tạo user tạm
      await pool.query(
        `INSERT INTO users (id, google_id, email, role, tos_version, tos_accepted_at, created_at, updated_at)
         VALUES ($1, $2, $3, 'user', '2026-11-01', NOW(), NOW(), NOW())`,
        [fakeUserId, `gid-chk-${fakeUserId}`, `chk-${fakeUserId}@test.vn`],
      );
      createdUserIds.push(fakeUserId);

      await assert.rejects(
        async () => {
          await pool.query(
            `INSERT INTO signup_grants (user_id, fingerprint_hash, ip_hash, granted)
             VALUES ($1, 'fphash', 'iphash', -100)`,
            [fakeUserId],
          );
        },
        (err) => {
          assert.equal(err.code, '23514', 'Phải vi phạm check constraint (code 23514)');
          return true;
        },
      );
    });

    it('chỉ mục duy nhất một phần từ chối hai dòng granted > 0 cùng fingerprint_hash', async () => {
      const u1 = crypto.randomUUID();
      const u2 = crypto.randomUUID();
      await pool.query(
        `INSERT INTO users (id, google_id, email, role, tos_version, tos_accepted_at, created_at, updated_at)
         VALUES ($1, $2, $3, 'user', '2026-11-01', NOW(), NOW(), NOW()),
                ($4, $5, $6, 'user', '2026-11-01', NOW(), NOW(), NOW())`,
        [u1, `gid-${u1}`, `u1-${u1}@test.vn`, u2, `gid-${u2}`, `u2-${u2}@test.vn`],
      );
      createdUserIds.push(u1, u2);

      const dupFpHash = `fp-dup-${crypto.randomBytes(8).toString('hex')}`;
      await pool.query(
        `INSERT INTO signup_grants (user_id, fingerprint_hash, ip_hash, granted)
         VALUES ($1, $2, 'ip1', 500)`,
        [u1, dupFpHash],
      );

      // Dòng thứ hai với granted > 0 cùng fingerprint_hash phải bị lỗi unique (23505)
      await assert.rejects(
        async () => {
          await pool.query(
            `INSERT INTO signup_grants (user_id, fingerprint_hash, ip_hash, granted)
             VALUES ($1, $2, 'ip2', 500)`,
            [u2, dupFpHash],
          );
        },
        (err) => {
          assert.equal(err.code, '23505', 'Phải vi phạm partial unique index (code 23505)');
          return true;
        },
      );

      // Nhưng dòng thứ hai với granted = 0 cùng fingerprint_hash thì ĐƯỢC PHÉP
      await pool.query(
        `INSERT INTO signup_grants (user_id, fingerprint_hash, ip_hash, granted)
         VALUES ($1, $2, 'ip2', 0)`,
        [u2, dupFpHash],
      );
      const row = await pool.query('SELECT granted FROM signup_grants WHERE user_id = $1', [u2]);
      assert.equal(row.rows[0].granted, '0');
    });

    it('chỉ mục (ip_hash, created_at) tồn tại trên bảng signup_grants', async () => {
      const res = await pool.query(
        `SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'signup_grants'`,
      );
      const idxs = res.rows.map((r) => r.indexdef);
      assert.ok(
        idxs.some((def) => def.includes('ip_hash') && def.includes('created_at')),
        'Phải có chỉ mục trên (ip_hash, created_at)',
      );
    });

    it('xóa user tự động xóa cascade signup_grants', async () => {
      const u = crypto.randomUUID();
      await pool.query(
        `INSERT INTO users (id, google_id, email, role, tos_version, tos_accepted_at, created_at, updated_at)
         VALUES ($1, $2, $3, 'user', '2026-11-01', NOW(), NOW(), NOW())`,
        [u, `gid-del-${u}`, `del-${u}@test.vn`],
      );
      await pool.query(
        `INSERT INTO signup_grants (user_id, fingerprint_hash, ip_hash, granted)
         VALUES ($1, 'fphash-del', 'iphash-del', 500)`,
        [u],
      );

      await pool.query('DELETE FROM users WHERE id = $1', [u]);
      const res = await pool.query('SELECT * FROM signup_grants WHERE user_id = $1', [u]);
      assert.equal(res.rows.length, 0, 'signup_grants phải bị xóa cascade khi user bị xóa');
    });
  });

  // =========================================================================
  // 2. Client IP & Anti-abuse Units (client-ip.ts, anti-abuse.ts)
  // =========================================================================
  describe('Client IP Resolution & Anti-abuse Utilities', () => {
    it('normalizeIp chuẩn hóa IPv4 thành ::ffff:a.b.c.d và IPv6 thành chữ thường', () => {
      assert.equal(normalizeIp('1.2.3.4'), '::ffff:1.2.3.4');
      assert.equal(normalizeIp('::ffff:1.2.3.4'), '::ffff:1.2.3.4');
      assert.equal(normalizeIp('2606:4700::1'), '2606:4700::1');
      assert.equal(normalizeIp('2606:4700:0:0:0:0:0:1'), '2606:4700:0:0:0:0:0:1');
      assert.equal(normalizeIp('   10.20.30.40   '), '::ffff:10.20.30.40');
      assert.equal(normalizeIp('not-an-ip'), null);
      assert.equal(normalizeIp(''), null);
      assert.equal(normalizeIp(undefined), null);
    });

    it('isIpInCidrs nhận diện chính xác dải IP Cloudflare và IP ngoài dải', () => {
      // Thuộc dải Cloudflare 173.245.48.0/20
      assert.equal(isIpInCidrs('173.245.48.10', CLOUDFLARE_CIDRS), true);
      assert.equal(isIpInCidrs('::ffff:173.245.48.10', CLOUDFLARE_CIDRS), true);

      // Thuộc dải Cloudflare IPv6 2400:cb00::/32
      assert.equal(isIpInCidrs('2400:cb00:1::1', CLOUDFLARE_CIDRS), true);

      // Không thuộc Cloudflare
      assert.equal(isIpInCidrs('8.8.8.8', CLOUDFLARE_CIDRS), false);
      assert.equal(isIpInCidrs('127.0.0.1', CLOUDFLARE_CIDRS), false);
    });

    it('resolveClientIp chỉ tin CF-Connecting-IP khi kết nối đến từ dải tin cậy', () => {
      // 1. Kết nối từ dải không tin cậy (ví dụ 203.0.113.1): BỎ QUA header CF-Connecting-IP
      const untrustedReq = {
        socket: { remoteAddress: '203.0.113.1' },
        headers: { 'cf-connecting-ip': '198.51.100.99' },
      };
      assert.equal(
        resolveClientIp(untrustedReq),
        '::ffff:203.0.113.1',
        'Phải bỏ qua header khi kết nối từ IP không tin cậy',
      );

      // 2. Kết nối từ Cloudflare (173.245.48.1): DÙNG header CF-Connecting-IP
      const trustedCfReq = {
        socket: { remoteAddress: '173.245.48.1' },
        headers: { 'cf-connecting-ip': '198.51.100.99' },
      };
      assert.equal(
        resolveClientIp(trustedCfReq),
        '::ffff:198.51.100.99',
        'Phải tin header khi kết nối từ Cloudflare',
      );

      // 3. Kết nối từ Cloudflare nhưng thiếu header hoặc header rác: DÙNG kết nối
      const noHeaderReq = {
        socket: { remoteAddress: '173.245.48.1' },
        headers: {},
      };
      assert.equal(resolveClientIp(noHeaderReq), '::ffff:173.245.48.1');

      // 4. Header CF-Connecting-IP dạng viết hoa/thường hỗn hợp
      const mixedHeaderReq = {
        socket: { remoteAddress: '173.245.48.1' },
        headers: { 'CF-Connecting-IP': '203.0.113.88' },
      };
      assert.equal(resolveClientIp(mixedHeaderReq), '::ffff:203.0.113.88');

      // 5. Header CF-Connecting-IP chứa danh sách IP phân tách bằng dấu phẩy
      const commaHeaderReq = {
        socket: { remoteAddress: '173.245.48.1' },
        headers: { 'cf-connecting-ip': '198.51.100.99, 10.0.0.1' },
      };
      assert.equal(resolveClientIp(commaHeaderReq), '::ffff:198.51.100.99');
    });

    it('isIpInCidrs an toàn khi gặp prefix âm hoặc vượt quá giới hạn 32/128', () => {
      // Prefix âm hoặc quá lớn không ném RangeError mà bỏ qua an toàn
      assert.doesNotThrow(() => {
        isIpInCidrs('192.168.1.1', ['192.168.1.0/-5', '192.168.1.0/33', '10.0.0.0/999']);
      });
      assert.equal(
        isIpInCidrs('192.168.1.1', ['192.168.1.0/-1', '192.168.1.0/35']),
        false,
      );
    });

    it('hmacHex sinh mã băm 64 ký tự hex có tính quyết định và không lộ dữ liệu gốc', () => {
      const secret = getAntiAbuseSecret();
      const hash1 = hmacHex('device:dev_abc_123', secret);
      const hash2 = hmacHex('device:dev_abc_123', secret);
      const hash3 = hmacHex('device:dev_xyz_999', secret);

      assert.match(hash1, /^[0-9a-f]{64}$/, 'Phải là chuỗi hex 64 ký tự');
      assert.equal(hash1, hash2, 'Cùng input phải ra cùng hash');
      assert.notEqual(hash1, hash3, 'Khác input phải ra hash khác nhau');
      assert.ok(!hash1.includes('dev_abc_123'), 'Không được chứa dữ liệu gốc');
    });
  });

  // =========================================================================
  // 3. Nghiệp vụ Tặng 500 Credit & Chống Lạm Dụng End-to-End
  // =========================================================================
  describe('Nghiệp vụ tặng 500 credit và quy tắc chống lạm dụng', () => {
    it('Thiết bị và IP mới: tặng đúng 500 credit, ghi 1 bút toán GRANT và 1 dòng signup_grants', async () => {
      const email = `newuser-${crypto.randomBytes(4).toString('hex')}@flowvis.vn`;
      const googleId = `gid-${crypto.randomBytes(4).toString('hex')}`;
      const deviceId = `dev-${crypto.randomBytes(6).toString('hex')}`;
      const clientIp = `192.0.2.${Math.floor(Math.random() * 200) + 1}`;

      const res = await registerViaApi({ email, googleId, deviceId, clientIp });
      assert.equal(res.status, 200);
      assert.equal(res.body.isNewUser, true);
      assert.equal(res.body.grantedCredits, 500);

      // Kiểm tra user trong DB
      const user = await prisma.user.findUnique({
        where: { email },
        include: { signupGrant: true, ledgerEntries: true },
      });
      assert.ok(user, 'User phải được tạo');
      createdUserIds.push(user.id);

      assert.equal(user.balance, 500n, 'Số dư phải là 500 credit');
      assert.equal(user.held, 0n, 'Held phải là 0');

      // Kiểm tra signup_grants
      assert.ok(user.signupGrant, 'Phải có bản ghi signup_grants');
      assert.equal(user.signupGrant.granted, 500n);
      assert.match(user.signupGrant.fingerprintHash, /^[0-9a-f]{64}$/);
      assert.match(user.signupGrant.ipHash, /^[0-9a-f]{64}$/);

      // Kiểm tra ledger_entries
      assert.equal(user.ledgerEntries.length, 1, 'Phải có đúng 1 bút toán ledger');
      assert.equal(user.ledgerEntries[0].type, 'GRANT');
      assert.equal(user.ledgerEntries[0].amount, 500n);
    });

    it('Thiết bị đã nhận: user tạo với balance = 0, granted = 0, không có bút toán GRANT', async () => {
      const sharedDeviceId = `dev-reused-${crypto.randomBytes(6).toString('hex')}`;
      const ip1 = `198.51.100.1`;
      const ip2 = `198.51.100.2`;

      // 1. Tài khoản thứ nhất nhận 500 credit
      const email1 = `u1-${crypto.randomBytes(4).toString('hex')}@flowvis.vn`;
      const gid1 = `gid-1-${crypto.randomBytes(4).toString('hex')}`;
      const res1 = await registerViaApi({
        email: email1,
        googleId: gid1,
        deviceId: sharedDeviceId,
        clientIp: ip1,
      });
      assert.equal(res1.status, 200);
      const user1 = await prisma.user.findUnique({
        where: { email: email1 },
        include: { signupGrant: true, ledgerEntries: true },
      });
      createdUserIds.push(user1.id);
      assert.equal(user1.balance, 500n);
      assert.equal(user1.signupGrant?.granted, 500n);
      assert.equal(user1.ledgerEntries.length, 1);

      // 2. Tài khoản thứ hai cùng deviceId (khác IP, khác email)
      const email2 = `u2-${crypto.randomBytes(4).toString('hex')}@flowvis.vn`;
      const gid2 = `gid-2-${crypto.randomBytes(4).toString('hex')}`;
      const res2 = await registerViaApi({
        email: email2,
        googleId: gid2,
        deviceId: sharedDeviceId,
        clientIp: ip2,
      });
      assert.equal(res2.status, 200);
      assert.equal(res2.body.isNewUser, true);
      assert.equal(res2.body.grantedCredits, 0);

      const user2 = await prisma.user.findUnique({
        where: { email: email2 },
        include: { signupGrant: true, ledgerEntries: true },
      });
      createdUserIds.push(user2.id);

      assert.equal(user2.balance, 0n, 'Tài khoản thứ hai trên thiết bị cũ phải có balance = 0');
      assert.equal(user2.held, 0n);
      assert.ok(user2.signupGrant, 'Vẫn phải có bản ghi signup_grants');
      assert.equal(user2.signupGrant.granted, 0n, 'granted phải bằng 0');
      assert.equal(user2.ledgerEntries.length, 0, 'Không được có bút toán GRANT');
    });

    it('IP đạt giới hạn 3 tài khoản trong 24h: tài khoản thứ 4 cùng IP nhận 0 credit', async () => {
      const fixedIp = `203.0.113.${Math.floor(Math.random() * 200) + 10}`;

      // Tạo 3 tài khoản đầu tiên cùng IP nhưng khác thiết bị -> cả 3 nhận 500
      for (let i = 1; i <= SIGNUP_GRANT_MAX_PER_IP; i++) {
        const email = `ip3-${i}-${crypto.randomBytes(3).toString('hex')}@flowvis.vn`;
        const gid = `gid-ip3-${i}-${crypto.randomBytes(3).toString('hex')}`;
        const deviceId = `dev-ip3-${i}-${crypto.randomBytes(5).toString('hex')}`;
        const res = await registerViaApi({ email, googleId: gid, deviceId, clientIp: fixedIp });
        assert.equal(res.status, 200);
        const user = await prisma.user.findUnique({
          where: { email },
          include: { signupGrant: true },
        });
        createdUserIds.push(user.id);
        assert.equal(user.balance, 500n, `Tài khoản thứ ${i} cùng IP phải nhận 500 credit`);
        assert.equal(user.signupGrant?.granted, 500n);
      }

      // Tài khoản thứ 4 cùng IP (thiết bị mới)
      const email4 = `ip3-4-${crypto.randomBytes(3).toString('hex')}@flowvis.vn`;
      const gid4 = `gid-ip3-4-${crypto.randomBytes(3).toString('hex')}`;
      const deviceId4 = `dev-ip3-4-${crypto.randomBytes(5).toString('hex')}`;
      const res4 = await registerViaApi({ email: email4, googleId: gid4, deviceId: deviceId4, clientIp: fixedIp });
      assert.equal(res4.status, 200);
      assert.equal(res4.body.isNewUser, true);
      assert.equal(res4.body.grantedCredits, 0);

      const user4 = await prisma.user.findUnique({
        where: { email: email4 },
        include: { signupGrant: true, ledgerEntries: true },
      });
      createdUserIds.push(user4.id);

      assert.equal(user4.balance, 0n, 'Tài khoản thứ 4 cùng IP trong 24h phải nhận 0 credit');
      assert.equal(user4.signupGrant?.granted, 0n);
      assert.equal(user4.ledgerEntries.length, 0);
    });

    it('IP đã đủ 3 tài khoản nhưng quá 24h: lại được nhận 500 credit', async () => {
      const agedIp = `198.18.0.${Math.floor(Math.random() * 200) + 10}`;

      // Tạo 3 tài khoản ban đầu trên IP này
      const usersToAge = [];
      for (let i = 1; i <= 3; i++) {
        const email = `aged-${i}-${crypto.randomBytes(3).toString('hex')}@flowvis.vn`;
        const gid = `gid-aged-${i}-${crypto.randomBytes(3).toString('hex')}`;
        const deviceId = `dev-aged-${i}-${crypto.randomBytes(5).toString('hex')}`;
        const res = await registerViaApi({ email, googleId: gid, deviceId, clientIp: agedIp });
        assert.equal(res.status, 200);
        const user = await prisma.user.findUnique({ where: { email } });
        createdUserIds.push(user.id);
        usersToAge.push(user.id);
      }

      // Dịch chuyển thời gian tạo của 3 bản ghi signup_grants về 25 giờ trước
      await pool.query(
        `UPDATE signup_grants
         SET created_at = NOW() - INTERVAL '25 hours'
         WHERE user_id = ANY($1::uuid[])`,
        [usersToAge],
      );

      // Tạo tài khoản thứ 4 trên IP này (thiết bị mới) -> vì 3 grant trước đã quá 24h, phải nhận 500!
      const email4 = `aged-4-${crypto.randomBytes(3).toString('hex')}@flowvis.vn`;
      const gid4 = `gid-aged-4-${crypto.randomBytes(3).toString('hex')}`;
      const deviceId4 = `dev-aged-4-${crypto.randomBytes(5).toString('hex')}`;
      const res4 = await registerViaApi({ email: email4, googleId: gid4, deviceId: deviceId4, clientIp: agedIp });
      assert.equal(res4.status, 200);
      assert.equal(res4.body.isNewUser, true);
      assert.equal(res4.body.grantedCredits, 500);

      const user4 = await prisma.user.findUnique({
        where: { email: email4 },
        include: { signupGrant: true },
      });
      createdUserIds.push(user4.id);

      assert.equal(user4.balance, 500n, 'IP có grant cũ hơn 24h phải được nhận lại 500 credit');
      assert.equal(user4.signupGrant?.granted, 500n);
    });

    it('User đã tồn tại đăng nhập lại: không tặng thêm credit và không ghi thêm signup_grants', async () => {
      const email = `relogin-${crypto.randomBytes(4).toString('hex')}@flowvis.vn`;
      const googleId = `gid-relogin-${crypto.randomBytes(4).toString('hex')}`;
      const deviceId = `dev-relogin-${crypto.randomBytes(4).toString('hex')}`;
      const clientIp = `192.0.2.77`;

      // Đăng ký lần đầu
      const res1 = await registerViaApi({ email, googleId, deviceId, clientIp });
      assert.equal(res1.body.isNewUser, true);
      assert.equal(res1.body.grantedCredits, 500);
      const user = await prisma.user.findUnique({ where: { email } });
      createdUserIds.push(user.id);
      assert.equal(user.balance, 500n);

      const grantsCountBefore = await prisma.signupGrant.count({
        where: { userId: user.id },
      });
      assert.equal(grantsCountBefore, 1);

      // Đăng nhập lại lần 2
      const res2 = await registerViaApi({
        email,
        googleId,
        deviceId: `another-device-${crypto.randomBytes(4).toString('hex')}`,
        clientIp: `192.0.2.88`,
      });
      assert.equal(res2.body.isNewUser, false, 'Đăng nhập lại phải trả về isNewUser = false');
      assert.equal(res2.body.grantedCredits, undefined, 'Đăng nhập lại không có grantedCredits');

      const userAfter = await prisma.user.findUnique({ where: { email } });
      assert.equal(userAfter.balance, 500n, 'Số dư credit không được thay đổi');

      const grantsCountAfter = await prisma.signupGrant.count({
        where: { userId: user.id },
      });
      assert.equal(grantsCountAfter, 1, 'Không được tạo thêm bản ghi signup_grants');
    });

    it('Không có giới hạn trần tổng: nhiều tài khoản khác nhau hoàn toàn đều nhận 500 credit', async () => {
      for (let i = 0; i < 5; i++) {
        const email = `scale-${i}-${crypto.randomBytes(3).toString('hex')}@flowvis.vn`;
        const gid = `gid-scale-${i}-${crypto.randomBytes(3).toString('hex')}`;
        const deviceId = `dev-scale-${i}-${crypto.randomBytes(5).toString('hex')}`;
        const clientIp = `198.51.100.${100 + i}`;

        const res = await registerViaApi({ email, googleId: gid, deviceId, clientIp });
        assert.equal(res.status, 200);
        const user = await prisma.user.findUnique({ where: { email } });
        createdUserIds.push(user.id);
        assert.equal(user.balance, 500n);
      }
    });
  });

  // =========================================================================
  // 4. Chống Đua Đồng Thời (Concurrency & Advisory Lock)
  // =========================================================================
  describe('Chống đua đồng thời (Concurrency & Advisory Locks)', () => {
    it('5 đăng ký song song cùng IP, thiết bị khác nhau: đúng 3 nhận 500, 2 nhận 0', async () => {
      const concurrentIp = `203.0.113.${Math.floor(Math.random() * 200) + 1}`;
      const promises = [];

      for (let i = 0; i < 5; i++) {
        const email = `conc-ip-${i}-${crypto.randomBytes(3).toString('hex')}@flowvis.vn`;
        const gid = `gid-conc-ip-${i}-${crypto.randomBytes(3).toString('hex')}`;
        const deviceId = `dev-conc-ip-${i}-${crypto.randomBytes(5).toString('hex')}`;
        promises.push(
          registerViaApi({ email, googleId: gid, deviceId, clientIp: concurrentIp }),
        );
      }

      const results = await Promise.all(promises);
      for (const res of results) {
        assert.equal(res.status, 200, 'Tất cả 5 đăng ký phải thành công (HTTP 200)');
      }

      const ipHash = hmacHex(`ip:::ffff:${concurrentIp}`);
      const grants = await prisma.signupGrant.findMany({
        where: { ipHash },
      });
      assert.equal(grants.length, 5, 'Phải ghi đúng 5 dòng signup_grants');

      for (const g of grants) {
        createdUserIds.push(g.userId);
      }

      const granted500 = grants.filter((g) => g.granted === 500n);
      const granted0 = grants.filter((g) => g.granted === 0n);

      assert.equal(
        granted500.length,
        3,
        `Đúng 3 tài khoản nhận 500 credit (thực tế: ${granted500.length})`,
      );
      assert.equal(
        granted0.length,
        2,
        `Đúng 2 tài khoản nhận 0 credit (thực tế: ${granted0.length})`,
      );
    });

    it('5 đăng ký song song cùng thiết bị, IP khác nhau: đúng 1 nhận 500, 4 nhận 0', async () => {
      const sharedDeviceId = `dev-conc-${crypto.randomBytes(6).toString('hex')}`;
      await warmDevice(sharedDeviceId);
      const promises = [];

      for (let i = 0; i < 5; i++) {
        const email = `conc-dev-${i}-${crypto.randomBytes(3).toString('hex')}@flowvis.vn`;
        const gid = `gid-conc-dev-${i}-${crypto.randomBytes(3).toString('hex')}`;
        const clientIp = `192.0.2.${150 + i}`;
        promises.push(
          registerViaApi({ email, googleId: gid, deviceId: sharedDeviceId, clientIp }),
        );
      }

      const results = await Promise.all(promises);
      for (const res of results) {
        assert.equal(res.status, 200, 'Tất cả 5 đăng ký phải thành công');
      }

      const fingerprintHash = hmacHex(`device:${serverDeviceId(sharedDeviceId)}`);
      const grants = await prisma.signupGrant.findMany({
        where: { fingerprintHash },
      });
      assert.equal(grants.length, 5);

      for (const g of grants) {
        createdUserIds.push(g.userId);
      }

      const granted500 = grants.filter((g) => g.granted === 500n);
      const granted0 = grants.filter((g) => g.granted === 0n);

      assert.equal(
        granted500.length,
        1,
        `Đúng 1 tài khoản nhận 500 credit (thực tế: ${granted500.length})`,
      );
      assert.equal(
        granted0.length,
        4,
        `Đúng 4 tài khoản nhận 0 credit (thực tế: ${granted0.length})`,
      );
    });
  });

  // =========================================================================
  // 5. Rollback Nguyên Tử & Connection Pool Reusability
  // =========================================================================
  describe('Rollback nguyên tử và connection pool', () => {
    it('khi walletService.grant ném lỗi: rollback toàn bộ, không sót user/grant, pool dùng lại bình thường', async () => {
      const email = `rollback-${crypto.randomBytes(4).toString('hex')}@flowvis.vn`;
      const googleId = `gid-rollback-${crypto.randomBytes(4).toString('hex')}`;
      const deviceId = `dev-rollback-${crypto.randomBytes(4).toString('hex')}`;
      const clientIp = `192.0.2.222`;

      // Giả lập lỗi ở walletService.grant
      const originalGrant = walletService.grant;
      let grantCalled = false;
      walletService.grant = async () => {
        grantCalled = true;
        throw new Error('Simulated wallet grant failure');
      };

      try {
        const res = await registerViaApi({ email, googleId, deviceId, clientIp });
        assert.notEqual(res.status, 200, 'Đăng ký phải thất bại khi walletService ném lỗi');
      } finally {
        walletService.grant = originalGrant;
      }

      assert.ok(grantCalled, 'walletService.grant phải được gọi');

      // Xác nhận user và signup_grants không tồn tại trong DB (toàn bộ transaction bị rollback)
      const user = await prisma.user.findUnique({ where: { email } });
      assert.equal(user, null, 'User không được tồn tại trong DB sau rollback');

      const fingerprintHash = hmacHex(`device:${serverDeviceId(deviceId)}`);
      const grant = await prisma.signupGrant.findFirst({ where: { fingerprintHash } });
      assert.equal(grant, null, 'signup_grants không được tồn tại trong DB sau rollback');

      // Xác nhận Connection Pool vẫn hoạt động bình thường cho truy vấn tiếp theo
      const poolCheck = await pool.query('SELECT 1 AS ok');
      assert.equal(poolCheck.rows[0].ok, 1, 'Connection pool phải tái sử dụng bình thường sau rollback');

      const prismaCheck = await prisma.user.count();
      assert.ok(typeof prismaCheck === 'number', 'Prisma client phải hoạt động bình thường sau rollback');
    });
  });

  // =========================================================================
  // 6. Rate Limiting (@nestjs/throttler)
  // =========================================================================
  describe('Giới hạn tần suất route đăng nhập (@nestjs/throttler)', () => {
    it('vượt giới hạn AUTH_THROTTLE_LIMIT trả về HTTP 429 với code RATE_LIMITED', async () => {
      const throttledIp = `198.51.100.${100 + crypto.randomInt(0, 50)}`;
      const limit = 20; // Khớp với AUTH_THROTTLE_LIMIT

      // Gửi 20 request hợp lệ từ throttledIp -> tất cả thành công
      for (let i = 0; i < limit; i++) {
        const res = await fetch(
          `${baseUrl}/auth/google?tosVersion=${TOS_VERSION}&deviceId=dev_throttle`,
          {
            headers: { 'CF-Connecting-IP': throttledIp },
          },
        );
        assert.equal(
          res.status,
          200,
          `Request thứ ${i + 1} phải thành công trước khi chạm giới hạn`,
        );
      }

      // Request thứ 21 từ cùng throttledIp -> phải bị HTTP 429 RATE_LIMITED
      const throttledRes = await fetch(
        `${baseUrl}/auth/google?tosVersion=${TOS_VERSION}&deviceId=dev_throttle`,
        {
          headers: { 'CF-Connecting-IP': throttledIp },
        },
      );
      assert.equal(throttledRes.status, 429, 'Request vượt giới hạn phải trả 429');
      const body = await throttledRes.json();
      assert.equal(body.code, ApiErrorCode.RATE_LIMITED);
      assert.equal(body.message, getApiErrorMessageVi(ApiErrorCode.RATE_LIMITED));

      // Request từ một IP khác (không vượt giới hạn) -> phải THÀNH CÔNG (không bị ảnh hưởng)
      const otherIpRes = await fetch(
        `${baseUrl}/auth/google?tosVersion=${TOS_VERSION}&deviceId=dev_throttle`,
        {
          headers: { 'CF-Connecting-IP': '198.51.100.251' },
        },
      );
      assert.equal(
        otherIpRes.status,
        200,
        'Request từ IP khác không được bị giới hạn bởi IP bị phạt',
      );

      // Route công khai không gắn throttler guard (như /health) -> không bị giới hạn
      const healthRes = await fetch(`${baseUrl}/health`, {
        headers: { 'CF-Connecting-IP': throttledIp },
      });
      assert.equal(healthRes.status, 200, 'Route /health không được bị giới hạn tần suất');
    });

    it('vượt giới hạn AUTH_THROTTLE_LIMIT trên POST /auth/refresh trả về HTTP 429 RATE_LIMITED', async () => {
      const throttledIp = `198.51.100.${150 + crypto.randomInt(0, 50)}`;
      const limit = 20;

      // Gửi 20 request tới POST /auth/refresh từ throttledIp (không có cookie -> 401 Unauthorized nhưng đã qua guard)
      for (let i = 0; i < limit; i++) {
        const res = await fetch(`${baseUrl}/auth/refresh`, {
          method: 'POST',
          headers: { 'CF-Connecting-IP': throttledIp },
        });
        assert.equal(
          res.status,
          401,
          `Request thứ ${i + 1} phải qua guard (nhận 401 do thiếu cookie)`,
        );
      }

      // Request thứ 21 từ cùng throttledIp -> phải bị HTTP 429 RATE_LIMITED
      const throttledRes = await fetch(`${baseUrl}/auth/refresh`, {
        method: 'POST',
        headers: { 'CF-Connecting-IP': throttledIp },
      });
      assert.equal(throttledRes.status, 429, 'Request thứ 21 phải trả 429 RATE_LIMITED');
      const body = await throttledRes.json();
      assert.equal(body.code, ApiErrorCode.RATE_LIMITED);
      assert.equal(body.message, getApiErrorMessageVi(ApiErrorCode.RATE_LIMITED));
    });
  });

  describe('Bổ sung sau review: email trùng, signup đồng thời, throttler Redis, cảnh báo proxy', () => {
    it('email đã gắn googleId khác: 409 EMAIL_LINKED_TO_OTHER_ACCOUNT và không ghi đè googleId', async () => {
      const email = `link-${crypto.randomBytes(4).toString('hex')}@flowvis.vn`;
      const gid1 = `gid-link-1-${crypto.randomBytes(4).toString('hex')}`;
      const gid2 = `gid-link-2-${crypto.randomBytes(4).toString('hex')}`;

      const first = await registerViaApi({
        email,
        googleId: gid1,
        deviceId: `dev-link-${crypto.randomBytes(4).toString('hex')}`,
        clientIp: '198.51.100.31',
      });
      assert.equal(first.status, 200);
      const owner = await prisma.user.findUnique({ where: { email } });
      createdUserIds.push(owner.id);

      const second = await registerViaApi({
        email,
        googleId: gid2,
        deviceId: `dev-link-b-${crypto.randomBytes(4).toString('hex')}`,
        clientIp: '198.51.100.32',
      });
      assert.equal(second.status, 409);
      assert.equal(second.body.code, ApiErrorCode.EMAIL_LINKED_TO_OTHER_ACCOUNT);

      const after = await prisma.user.findUnique({ where: { email } });
      assert.equal(after.googleId, gid1, 'googleId gốc không được bị ghi đè');
      assert.equal(after.balance, owner.balance, 'credit không bị ảnh hưởng');
    });

    it('5 callback đồng thời của cùng một tài khoản: không có 500, đúng 1 user và 1 lần tặng', async () => {
      const email = `same-${crypto.randomBytes(4).toString('hex')}@flowvis.vn`;
      const gid = `gid-same-${crypto.randomBytes(4).toString('hex')}`;
      const deviceId = `dev-same-${crypto.randomBytes(4).toString('hex')}`;
      await warmDevice(deviceId);

      const results = await Promise.all(
        Array.from({ length: 5 }, (_, i) =>
          registerViaApi({ email, googleId: gid, deviceId, clientIp: `203.0.113.${20 + i}` }),
        ),
      );
      for (const r of results) {
        assert.equal(r.status, 200, `Không được lỗi: ${JSON.stringify(r.body)}`);
      }
      assert.equal(results.filter((r) => r.body.isNewUser === true).length, 1);

      const users = await prisma.user.findMany({
        where: { email },
        include: { ledgerEntries: true, signupGrant: true },
      });
      assert.equal(users.length, 1);
      createdUserIds.push(users[0].id);
      assert.equal(users[0].balance, 500n);
      assert.equal(users[0].ledgerEntries.length, 1);
      assert.ok(users[0].signupGrant);
    });

    it('RedisThrottlerStorage: đếm, chặn khi vượt limit, tách theo key và theo blockDuration', async () => {
      const { RedisThrottlerStorage } = await import(
        '../dist/modules/auth/redis-throttler.storage.js'
      );
      const storage = new RedisThrottlerStorage(app.get(RedisService));
      const key = `test-${crypto.randomBytes(6).toString('hex')}`;

      for (let i = 1; i <= 3; i++) {
        const r = await storage.increment(key, 5000, 3, 0, 'default');
        assert.equal(r.totalHits, i);
        assert.equal(r.isBlocked, false);
        assert.ok(r.timeToExpire > 0 && r.timeToExpire <= 5000);
      }
      const blocked = await storage.increment(key, 5000, 3, 0, 'default');
      assert.equal(blocked.isBlocked, true);
      assert.equal(blocked.totalHits, 4);

      const other = await storage.increment(`${key}-other`, 5000, 3, 0, 'default');
      assert.equal(other.isBlocked, false);

      const blockKey = `${key}-blk`;
      await storage.increment(blockKey, 5000, 1, 60_000, 'default');
      const overLimit = await storage.increment(blockKey, 5000, 1, 60_000, 'default');
      assert.equal(overLimit.isBlocked, true);
      assert.ok(overLimit.timeToBlockExpire > 0);
      const again = await storage.increment(blockKey, 5000, 1, 60_000, 'default');
      assert.equal(again.isBlocked, true, 'đang trong thời gian block thì tiếp tục bị chặn');

      const redis = app.get(RedisService).client;
      const keys = await redis.keys(`throttle:default:${key}*`);
      if (keys.length) await redis.del(...keys);
    });

    it('RedisThrottlerStorage: Redis lỗi thì fail-open, không ném lỗi', async () => {
      const { RedisThrottlerStorage } = await import(
        '../dist/modules/auth/redis-throttler.storage.js'
      );
      const broken = {
        client: {
          pttl: async () => {
            throw new Error('redis down');
          },
        },
      };
      const storage = new RedisThrottlerStorage(broken);
      const r = await storage.increment('k', 1000, 1, 0, 'default');
      assert.equal(r.isBlocked, false);
    });

    it('resolveClientIp cảnh báo đúng một lần khi kết nối từ địa chỉ nội bộ không tin cậy', async () => {
      const { resolveClientIp: resolve, resetClientIpWarningForTests } = await import(
        '../dist/modules/auth/client-ip.js'
      );
      resetClientIpWarningForTests();
      const warnings = [];
      const original = console.warn;
      console.warn = (...args) => warnings.push(args.join(' '));
      try {
        const ip = resolve({ socket: { remoteAddress: '10.1.2.3' }, headers: {} });
        resolve({ socket: { remoteAddress: '10.1.2.4' }, headers: {} });
        assert.equal(ip, '::ffff:10.1.2.3');
        assert.equal(warnings.length, 1);
        assert.match(warnings[0], /TRUSTED_PROXY_CIDRS/);

        resetClientIpWarningForTests();
        warnings.length = 0;
        resolve({ socket: { remoteAddress: '8.8.8.8' }, headers: {} });
        assert.equal(warnings.length, 0, 'IP công khai không cần cảnh báo');
      } finally {
        console.warn = original;
      }
    });
  });
});

describe('Story 1.8 review fixes: cookie thiết bị, secret, IPv6, relink', () => {
  it('verifyDeviceCookie từ chối cookie giả mạo hoặc sai chữ ký', async () => {
    const { issueDeviceCookie, verifyDeviceCookie } = await import('../dist/modules/auth/anti-abuse.js');
    const { deviceId, cookieValue } = issueDeviceCookie();
    assert.equal(verifyDeviceCookie(cookieValue), deviceId);
    assert.equal(verifyDeviceCookie(`${'a'.repeat(32)}.${'b'.repeat(32)}`), null);
    assert.equal(verifyDeviceCookie(`${deviceId}.deadbeef`), null);
    assert.equal(verifyDeviceCookie('random-client-value'), null);
    assert.equal(verifyDeviceCookie(undefined), null);
  });

  it('getAntiAbuseSecret fail-closed ở production khi thiếu hoặc quá ngắn', async () => {
    const { getAntiAbuseSecret } = await import('../dist/modules/auth/anti-abuse.js');
    const prevEnv = process.env.NODE_ENV;
    const prevSecret = process.env.ANTI_ABUSE_SECRET;
    try {
      process.env.NODE_ENV = 'production';
      delete process.env.ANTI_ABUSE_SECRET;
      assert.throws(() => getAntiAbuseSecret(), /ANTI_ABUSE_SECRET/);
      process.env.ANTI_ABUSE_SECRET = 'short';
      assert.throws(() => getAntiAbuseSecret(), /ANTI_ABUSE_SECRET/);
      process.env.ANTI_ABUSE_SECRET = 'x'.repeat(40);
      assert.equal(getAntiAbuseSecret(), 'x'.repeat(40));
    } finally {
      process.env.NODE_ENV = prevEnv;
      process.env.ANTI_ABUSE_SECRET = prevSecret;
    }
  });

  it('ipRateKey gộp IPv6 theo /64 và giữ nguyên IPv4', async () => {
    const { ipRateKey } = await import('../dist/modules/auth/client-ip.js');
    assert.equal(ipRateKey('2001:db8:1:2:aaaa::1'), ipRateKey('2001:db8:1:2:bbbb:cccc::9'));
    assert.notEqual(ipRateKey('2001:db8:1:2::1'), ipRateKey('2001:db8:1:3::1'));
    assert.equal(ipRateKey('203.0.113.7'), '::ffff:203.0.113.7');
    assert.equal(ipRateKey('not-an-ip'), 'unknown');
  });
});
