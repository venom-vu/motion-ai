import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import net from 'node:net';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { ApiErrorCode, TOS_VERSION } from '@motion-ai/contracts';
import pg from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../dist/generated/prisma/client.js';
import { RedisService } from '../dist/infra/index.js';
import { bootstrapApi } from '../dist/main.js';
import { JwtService } from '@nestjs/jwt';
import { GoogleOAuthService } from '../dist/modules/auth/google-oauth.service.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const apiRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(apiRoot, '../..');
const composePath = path.join(repoRoot, 'deploy', 'compose.yml');

const DEFAULT_DATABASE_URL =
  process.env.DATABASE_URL ||
  'postgresql://motion_user:change_me_local_password@localhost:5432/motion_ai?schema=public';
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

describe('Story 1.5: [BE] Đăng nhập Google và phiên JWT', () => {
  let app;
  let baseUrl;
  let prisma;
  let pool;
  let googleOAuthService;
  let jwtService;
  let redisService;

  const testRunId = crypto.randomBytes(4).toString('hex');
  const adminEmail = `admin-${testRunId}@motionai.vn`;
  const regularEmail = `user-${testRunId}@motionai.vn`;
  const lockedEmail = `locked-${testRunId}@motionai.vn`;

  before(async () => {
    process.env.DATABASE_URL = DEFAULT_DATABASE_URL;
    process.env.REDIS_URL = DEFAULT_REDIS_URL;
    process.env.PORT = '0';
    process.env.JWT_SECRET = 'super-secret-test-jwt-key-with-at-least-32-chars-ok';
    process.env.ADMIN_EMAILS = `owner@motionai.vn, ${adminEmail}, test-admin@motionai.vn`;
    process.env.FRONTEND_URL = 'http://localhost:3000, https://motionai.vn';
    process.env.COOKIE_SECURE = 'true';

    await ensureInfraRunning();

    pool = new pg.Pool({ connectionString: DEFAULT_DATABASE_URL });
    const adapter = new PrismaPg(pool);
    prisma = new PrismaClient({ adapter });

    app = await bootstrapApi();
    const address = app.getHttpServer().address();
    baseUrl = `http://127.0.0.1:${address.port}`;

    googleOAuthService = app.get(GoogleOAuthService);
    jwtService = app.get(JwtService);
    redisService = app.get(RedisService);
  });

  after(async () => {
    if (prisma) {
      // Dọn dẹp dữ liệu kiểm thử
      try {
        await prisma.user.deleteMany({
          where: {
            email: {
              contains: testRunId,
            },
          },
        });
      } catch {
        // ignore
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

  describe('AC8: Ràng buộc cơ sở dữ liệu và cấu trúc bảng users, refresh_tokens', () => {
    it('bảng users (chưa có cột tier) và refresh_tokens', async () => {
      const userColumns = await pool.query(`
        SELECT column_name, data_type 
        FROM information_schema.columns 
        WHERE table_name = 'users'
      `);
      const colNames = userColumns.rows.map((r) => r.column_name);

      assert.ok(colNames.includes('id'), 'bảng users phải có cột id');
      assert.ok(colNames.includes('google_id'), 'bảng users phải có cột google_id');
      assert.ok(colNames.includes('email'), 'bảng users phải có cột email');
      assert.ok(colNames.includes('role'), 'bảng users phải có cột role');
      assert.ok(colNames.includes('tos_version'), 'bảng users phải có cột tos_version');
      assert.ok(colNames.includes('tos_accepted_at'), 'bảng users phải có cột tos_accepted_at');
      assert.ok(colNames.includes('locked_at'), 'bảng users phải có cột locked_at');
      assert.ok(colNames.includes('created_at'), 'bảng users phải có cột created_at');
      assert.ok(colNames.includes('updated_at'), 'bảng users phải có cột updated_at');

      // balance/held do Story 1.6 (wallet) thêm; tier thuộc Story 1.7
      assert.ok(!colNames.includes('tier'), 'bảng users tuyệt đối không có cột tier');

      const tokenColumns = await pool.query(`
        SELECT column_name, data_type 
        FROM information_schema.columns 
        WHERE table_name = 'refresh_tokens'
      `);
      const tokenColNames = tokenColumns.rows.map((r) => r.column_name);

      assert.ok(tokenColNames.includes('id'));
      assert.ok(tokenColNames.includes('user_id'));
      assert.ok(tokenColNames.includes('token_hash'));
      assert.ok(tokenColNames.includes('revoked_at'));
      assert.ok(tokenColNames.includes('expires_at'));
      assert.ok(tokenColNames.includes('created_at'));

      // Kiểm tra CHECK constraint users_role_valid_chk
      const roleChk = await pool.query(`
        SELECT constraint_name 
        FROM information_schema.check_constraints 
        WHERE constraint_name = 'users_role_valid_chk'
      `);
      assert.ok(
        roleChk.rows.length > 0,
        'bảng users phải có ràng buộc CHECK users_role_valid_chk',
      );
    });
  });

  describe('AC2: Kiểm tra ToS khi khởi tạo và xác thực (GET /auth/google)', () => {
    it('từ chối với HTTP 400 CONSENT_REQUIRED khi thiếu hoặc sai tosVersion', async () => {
      // 1. Sai tosVersion
      const resBadTos = await fetch(
        `${baseUrl}/auth/google?tosVersion=old-version&deviceId=dev_1`,
      );
      assert.equal(resBadTos.status, 400);
      const bodyBadTos = await resBadTos.json();
      assert.equal(bodyBadTos.code, ApiErrorCode.CONSENT_REQUIRED);

      // 2. Thiếu tosVersion
      const resMissingTos = await fetch(`${baseUrl}/auth/google?deviceId=dev_1`);
      assert.equal(resMissingTos.status, 400);
      const bodyMissingTos = await resMissingTos.json();
      assert.equal(bodyMissingTos.code, ApiErrorCode.CONSENT_REQUIRED);

      // 3. Thiếu deviceId (nhưng có tosVersion hợp lệ)
      const resMissingDev = await fetch(
        `${baseUrl}/auth/google?tosVersion=${TOS_VERSION}`,
      );
      assert.equal(resMissingDev.status, 400);
      const bodyMissingDev = await resMissingDev.json();
      assert.equal(bodyMissingDev.code, ApiErrorCode.VALIDATION_FAILED);
    });

    it('từ chối callback với HTTP 400 CONSENT_REQUIRED khi state chứa tosVersion không hợp lệ', async () => {
      const secret =
        process.env.JWT_SECRET ||
        'super-secret-test-jwt-key-with-at-least-32-chars-ok';
      const nonce = crypto.randomBytes(16).toString('hex');
      const payload = {
        nonce,
        tosVersion: 'old-tos-version-2025',
        deviceId: 'dev_test',
        createdAt: Date.now(),
      };
      const rawData = Buffer.from(JSON.stringify(payload)).toString('base64url');
      const signature = crypto
        .createHmac('sha256', secret)
        .update(rawData)
        .digest('base64url');
      const badState = `${rawData}.${signature}`;

      // Lưu nonce vào Redis
      await redisService.client.set(`oauth:state:${nonce}`, '1', 'EX', 600);

      const cbRes = await fetch(
        `${baseUrl}/auth/google/callback?code=mock_code&state=${encodeURIComponent(badState)}`,
      );
      assert.equal(cbRes.status, 400);
      const cbData = await cbRes.json();
      assert.equal(cbData.code, ApiErrorCode.CONSENT_REQUIRED);
    });

    it('trả về redirectUrl hợp lệ khi tosVersion = 2026-11-01 và có deviceId', async () => {
      const res = await fetch(
        `${baseUrl}/auth/google?tosVersion=${TOS_VERSION}&deviceId=dev_123`,
      );
      assert.equal(res.status, 200);
      const data = await res.json();
      assert.ok(data.redirectUrl, 'Phải có redirectUrl');
      assert.ok(data.redirectUrl.includes('accounts.google.com'));
      assert.ok(data.redirectUrl.includes('state='));
    });
  });

  describe('AC1, AC5: Đăng nhập Google thành công, tạo User, cấp Access JWT và Refresh Token qua cookie', () => {
    it('xử lý Google callback lỗi với HTTP 400 BadRequest khi state hợp lệ', async () => {
      // 1. Tạo state hợp lệ từ GET /auth/google
      const authRes = await fetch(
        `${baseUrl}/auth/google?tosVersion=${TOS_VERSION}&deviceId=dev_err_cb`,
      );
      const authData = await authRes.json();
      const redirectUrl = new URL(authData.redirectUrl);
      const state = redirectUrl.searchParams.get('state');

      const res = await fetch(
        `${baseUrl}/auth/google/callback?error=access_denied&error_description=User%20cancelled&state=${encodeURIComponent(state)}`,
      );
      assert.equal(res.status, 400);
      const data = await res.json();
      assert.ok(
        data.code === 'access_denied' || data.message.includes('access_denied'),
      );
    });

    it('từ chối callback với HTTP 400 khi state bị giả mạo hoặc không hợp lệ', async () => {
      const res = await fetch(
        `${baseUrl}/auth/google/callback?error=access_denied&state=fake_tampered_state`,
      );
      assert.equal(res.status, 400);
    });

    it('tạo người dùng mới role "user", Access JWT 15 phút, Refresh Token chỉ lưu hash và trả cookie Secure HttpOnly SameSite=Lax', async () => {
      // 1. Tạo state hợp lệ từ GET /auth/google
      const authRes = await fetch(
        `${baseUrl}/auth/google?tosVersion=${TOS_VERSION}&deviceId=dev_normal`,
      );
      const authData = await authRes.json();
      const redirectUrl = new URL(authData.redirectUrl);
      const state = redirectUrl.searchParams.get('state');

      // 2. Giả lập Google OAuth endpoint tại ranh giới HTTP
      const mockGoogleId = `gid-reg-${testRunId}`;
      googleOAuthService.setFetchImpl(async (input) => {
        const urlStr = String(input);
        if (urlStr.includes('oauth2.googleapis.com/token')) {
          return new Response(
            JSON.stringify({
              access_token: 'mock-google-access-token-123',
              id_token: 'mock-google-id-token-123',
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          );
        }
        if (urlStr.includes('googleapis.com/oauth2/v3/userinfo')) {
          return new Response(
            JSON.stringify({
              sub: mockGoogleId,
              email: regularEmail,
              name: 'Regular Test User',
              picture: 'https://lh3.googleusercontent.com/photo.jpg',
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          );
        }
        return new Response('Not Found', { status: 404 });
      });

      // 3. Gọi Google callback
      const callbackRes = await fetch(
        `${baseUrl}/auth/google/callback?code=mock_code_123&state=${encodeURIComponent(state)}`,
      );
      assert.equal(callbackRes.status, 200);
      const data = await callbackRes.json();

      assert.ok(data.accessToken, 'Phải có accessToken');
      assert.equal(data.tokenType, 'Bearer');
      assert.equal(data.expiresIn, 900);
      assert.equal(data.isNewUser, true);

      // Kiểm tra cookie header
      const setCookie = callbackRes.headers.get('set-cookie');
      assert.ok(setCookie, 'Phải có Set-Cookie header');
      assert.ok(setCookie.includes('refreshToken='), 'Cookie phải có tên refreshToken');
      assert.ok(setCookie.includes('HttpOnly') || setCookie.includes('httponly'), 'Phải có HttpOnly');
      assert.ok(setCookie.includes('Secure') || setCookie.includes('secure'), 'Phải có Secure');
      assert.ok(setCookie.includes('SameSite=Lax') || setCookie.includes('samesite=lax'), 'Phải có SameSite=Lax');
      assert.ok(setCookie.includes('Path=/') || setCookie.includes('path=/'), 'Phải có Path=/');

      // Kiểm tra bản ghi User trong PostgreSQL
      const user = await prisma.user.findUnique({
        where: { email: regularEmail },
      });
      assert.ok(user, 'User phải được tạo trong CSDL');
      assert.equal(user.googleId, mockGoogleId);
      assert.equal(user.role, 'user');
      assert.equal(user.tosVersion, TOS_VERSION);
      assert.ok(user.tosAcceptedAt);
      assert.equal(user.lockedAt, null);

      // Trích xuất raw refresh token từ cookie
      const match = setCookie.match(/refreshToken=([^;]+)/);
      assert.ok(match, 'Phải lấy được raw refresh token từ cookie');
      const rawToken = match[1];

      // Bắt buộc: raw refresh token KHÔNG ĐƯỢC nằm trong CSDL
      const rawInDb = await prisma.refreshToken.findFirst({
        where: { tokenHash: rawToken },
      });
      assert.equal(rawInDb, null, 'Raw refresh token không được lưu vào DB');

      // Chỉ lưu SHA-256 hash của refresh token
      const expectedHash = crypto.createHash('sha256').update(rawToken).digest('hex');
      const tokenRecord = await prisma.refreshToken.findUnique({
        where: { tokenHash: expectedHash },
      });
      assert.ok(tokenRecord, 'Hash của refresh token phải nằm trong CSDL');
      assert.equal(tokenRecord.userId, user.id);
      assert.equal(tokenRecord.revokedAt, null);
    });

    it('gán role "admin" khi email nằm trong ADMIN_EMAILS (AC5)', async () => {
      // 1. Lấy state
      const authRes = await fetch(
        `${baseUrl}/auth/google?tosVersion=${TOS_VERSION}&deviceId=dev_admin`,
      );
      const authData = await authRes.json();
      const state = new URL(authData.redirectUrl).searchParams.get('state');

      // 2. Mock Google profile với email admin (hoa thường hỗn hợp để kiểm tra case-insensitivity)
      const mixedCaseAdminEmail = adminEmail.toUpperCase();
      const mockAdminGid = `gid-adm-${testRunId}`;

      googleOAuthService.setFetchImpl(async (input) => {
        const urlStr = String(input);
        if (urlStr.includes('oauth2.googleapis.com/token')) {
          return new Response(
            JSON.stringify({ access_token: 'mock-admin-token' }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          );
        }
        if (urlStr.includes('googleapis.com/oauth2/v3/userinfo')) {
          return new Response(
            JSON.stringify({
              sub: mockAdminGid,
              email: mixedCaseAdminEmail,
              name: 'Admin Test User',
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          );
        }
        return new Response('Not Found', { status: 404 });
      });

      // 3. Callback
      const callbackRes = await fetch(
        `${baseUrl}/auth/google/callback?code=admin_code&state=${encodeURIComponent(state)}`,
      );
      assert.equal(callbackRes.status, 200);
      const data = await callbackRes.json();
      assert.equal(data.isNewUser, true);

      // Kiểm tra user trong DB
      const user = await prisma.user.findUnique({
        where: { email: adminEmail.toLowerCase() },
      });
      assert.ok(user);
      assert.equal(user.role, 'admin');

      // Gọi route admin bằng Bearer token của admin -> thành công 200
      const adminProbeRes = await fetch(`${baseUrl}/auth/admin-probe`, {
        headers: {
          Authorization: `Bearer ${data.accessToken}`,
        },
      });
      assert.equal(adminProbeRes.status, 200);
      const adminProbeData = await adminProbeRes.json();
      assert.equal(adminProbeData.role, 'admin');
    });

    it('từ chối route admin với HTTP 403 khi gọi bằng token của role "user" (AC5)', async () => {
      const user = await prisma.user.findUnique({
        where: { email: regularEmail },
      });
      assert.ok(user);
      assert.equal(user.role, 'user');

      // Tạo access token của user role 'user'
      const userAccessToken = jwtService.sign({
        sub: user.id,
        email: user.email,
        role: user.role,
      });

      const res = await fetch(`${baseUrl}/auth/admin-probe`, {
        headers: {
          Authorization: `Bearer ${userAccessToken}`,
        },
      });
      assert.equal(res.status, 403, 'User role "user" phải nhận HTTP 403 khi vào route admin');
    });

    it('đăng nhập lại cho người dùng cũ trả về isNewUser: false', async () => {
      const authRes = await fetch(
        `${baseUrl}/auth/google?tosVersion=${TOS_VERSION}&deviceId=dev_existing`,
      );
      const state = new URL((await authRes.json()).redirectUrl).searchParams.get('state');

      googleOAuthService.setFetchImpl(async (input) => {
        const urlStr = String(input);
        if (urlStr.includes('oauth2.googleapis.com/token')) {
          return new Response(
            JSON.stringify({ access_token: 'mock-relogin-token' }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          );
        }
        if (urlStr.includes('googleapis.com/oauth2/v3/userinfo')) {
          return new Response(
            JSON.stringify({
              sub: `gid-reg-${testRunId}`,
              email: regularEmail,
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          );
        }
        return new Response('Not Found', { status: 404 });
      });

      const callbackRes = await fetch(
        `${baseUrl}/auth/google/callback?code=relogin_code&state=${encodeURIComponent(state)}`,
      );
      assert.equal(callbackRes.status, 200);
      const data = await callbackRes.json();
      assert.equal(data.isNewUser, false, 'User cũ đăng nhập lại phải có isNewUser: false');
    });
  });

  describe('AC3: Làm mới phiên và xoay vòng Refresh Token (POST /auth/refresh)', () => {
    let currentRefreshToken;
    let currentAccessToken;

    before(async () => {
      // Đăng nhập lấy phiên ban đầu
      const authRes = await fetch(
        `${baseUrl}/auth/google?tosVersion=${TOS_VERSION}&deviceId=dev_refresh`,
      );
      const state = new URL((await authRes.json()).redirectUrl).searchParams.get('state');

      googleOAuthService.setFetchImpl(async () => {
        return new Response(
          JSON.stringify({
            access_token: 'tok',
            sub: `gid-reg-${testRunId}`,
            email: regularEmail,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      });

      const cbRes = await fetch(
        `${baseUrl}/auth/google/callback?code=cb_code&state=${encodeURIComponent(state)}`,
      );
      const cbData = await cbRes.json();
      currentAccessToken = cbData.accessToken;

      const setCookie = cbRes.headers.get('set-cookie');
      const match = setCookie.match(/refreshToken=([^;]+)/);
      currentRefreshToken = match[1];
    });

    it('cấp Access JWT mới, thu hồi token cũ và trả refresh token mới', async () => {
      const oldHash = crypto.createHash('sha256').update(currentRefreshToken).digest('hex');

      // Kiểm tra token cũ đang active
      const beforeRecord = await prisma.refreshToken.findUnique({
        where: { tokenHash: oldHash },
      });
      assert.equal(beforeRecord.revokedAt, null);

      // Gọi POST /auth/refresh với cookie chứa currentRefreshToken
      const refreshRes = await fetch(`${baseUrl}/auth/refresh`, {
        method: 'POST',
        headers: {
          Cookie: `refreshToken=${currentRefreshToken}`,
        },
      });
      assert.equal(refreshRes.status, 200);
      const refreshData = await refreshRes.json();

      assert.ok(refreshData.accessToken);
      assert.notEqual(refreshData.accessToken, currentAccessToken);
      assert.equal(refreshData.expiresIn, 900);

      // Token cũ đã bị thu hồi trong CSDL
      const afterRecord = await prisma.refreshToken.findUnique({
        where: { tokenHash: oldHash },
      });
      assert.ok(afterRecord.revokedAt !== null, 'Token cũ phải có revokedAt');

      // Cookie trả về refresh token mới
      const newCookie = refreshRes.headers.get('set-cookie');
      assert.ok(newCookie);
      const match = newCookie.match(/refreshToken=([^;]+)/);
      const newRefreshToken = match[1];
      assert.notEqual(newRefreshToken, currentRefreshToken);

      // Cập nhật currentRefreshToken để dùng cho test tiếp
      currentRefreshToken = newRefreshToken;
    });

    it('từ chối với HTTP 401 khi dùng lại refresh token đã bị thu hồi', async () => {
      // Dùng lại token ban đầu (đã bị thu hồi ở bước trên)
      const rawOldToken = `reused_old_token_${crypto.randomBytes(8).toString('hex')}`;
      const oldHash = crypto.createHash('sha256').update(rawOldToken).digest('hex');
      // Tạo một revoked token giả lập trong DB
      const user = await prisma.user.findUnique({ where: { email: regularEmail } });
      await prisma.refreshToken.create({
        data: {
          userId: user.id,
          tokenHash: oldHash,
          revokedAt: new Date(),
          expiresAt: new Date(Date.now() + 100000),
        },
      });

      const res = await fetch(`${baseUrl}/auth/refresh`, {
        method: 'POST',
        headers: {
          Cookie: `refreshToken=${rawOldToken}`,
        },
      });
      assert.equal(res.status, 401, 'Dùng lại token đã thu hồi phải trả 401');
    });

    it('từ chối với HTTP 401 khi thiếu cookie hoặc token không tồn tại', async () => {
      const resNoCookie = await fetch(`${baseUrl}/auth/refresh`, {
        method: 'POST',
      });
      assert.equal(resNoCookie.status, 401);

      const resFakeToken = await fetch(`${baseUrl}/auth/refresh`, {
        method: 'POST',
        headers: {
          Cookie: 'refreshToken=non_existent_fake_token',
        },
      });
      assert.equal(resFakeToken.status, 401);
    });

    it('từ chối với HTTP 401 khi refresh token đã hết hạn (expiresAt trong quá khứ)', async () => {
      const user = await prisma.user.findUnique({
        where: { email: regularEmail },
      });
      const expiredRawToken = crypto.randomBytes(32).toString('hex');
      const expiredHash = crypto
        .createHash('sha256')
        .update(expiredRawToken)
        .digest('hex');

      await prisma.refreshToken.create({
        data: {
          userId: user.id,
          tokenHash: expiredHash,
          expiresAt: new Date(Date.now() - 60000), // Hết hạn 1 phút trước
        },
      });

      const res = await fetch(`${baseUrl}/auth/refresh`, {
        method: 'POST',
        headers: {
          Cookie: `refreshToken=${expiredRawToken}`,
        },
      });
      assert.equal(res.status, 401, 'Token hết hạn phải trả 401');
    });
  });

  describe('AC4: Đăng xuất (POST /auth/logout)', () => {
    it('thu hồi refresh token trong CSDL và xóa cookie phiên', async () => {
      const user = await prisma.user.findUnique({ where: { email: regularEmail } });
      const rawToken = crypto.randomBytes(32).toString('hex');
      const hash = crypto.createHash('sha256').update(rawToken).digest('hex');

      await prisma.refreshToken.create({
        data: {
          userId: user.id,
          tokenHash: hash,
          expiresAt: new Date(Date.now() + 100000),
        },
      });

      const logoutRes = await fetch(`${baseUrl}/auth/logout`, {
        method: 'POST',
        headers: {
          Cookie: `refreshToken=${rawToken}`,
        },
      });
      assert.equal(logoutRes.status, 200);
      const data = await logoutRes.json();
      assert.equal(data.success, true);

      // Token đã bị thu hồi trong DB
      const tokenInDb = await prisma.refreshToken.findUnique({
        where: { tokenHash: hash },
      });
      assert.ok(tokenInDb.revokedAt !== null, 'Token phải được gán revokedAt sau logout');

      // Cookie bị xóa (Max-Age=0 hoặc ngày trong quá khứ)
      const setCookie = logoutRes.headers.get('set-cookie');
      assert.ok(setCookie);
      assert.ok(
        setCookie.includes('Max-Age=0') ||
          setCookie.includes('Expires=Thu, 01 Jan 1970') ||
          setCookie.includes('refreshToken=;'),
      );
    });
  });

  describe('AC6: Tài khoản bị khóa (locked_at !== null)', () => {
    let lockedUser;
    let lockedRefreshToken;
    let lockedAccessToken;

    before(async () => {
      lockedUser = await prisma.user.create({
        data: {
          googleId: `gid-locked-${testRunId}`,
          email: lockedEmail,
          role: 'user',
          tosVersion: TOS_VERSION,
          tosAcceptedAt: new Date(),
          lockedAt: new Date(), // Bị khóa
        },
      });

      lockedAccessToken = jwtService.sign({
        sub: lockedUser.id,
        email: lockedUser.email,
        role: lockedUser.role,
      });

      lockedRefreshToken = crypto.randomBytes(32).toString('hex');
      const hash = crypto.createHash('sha256').update(lockedRefreshToken).digest('hex');
      await prisma.refreshToken.create({
        data: {
          userId: lockedUser.id,
          tokenHash: hash,
          expiresAt: new Date(Date.now() + 100000),
        },
      });
    });

    it('từ chối đăng nhập Google với HTTP 403 ACCOUNT_LOCKED khi user bị khóa', async () => {
      const authRes = await fetch(
        `${baseUrl}/auth/google?tosVersion=${TOS_VERSION}&deviceId=dev_locked`,
      );
      const state = new URL((await authRes.json()).redirectUrl).searchParams.get('state');

      googleOAuthService.setFetchImpl(async (input) => {
        const urlStr = String(input);
        if (urlStr.includes('oauth2.googleapis.com/token')) {
          return new Response(
            JSON.stringify({ access_token: 'mock-locked-token' }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          );
        }
        if (urlStr.includes('googleapis.com/oauth2/v3/userinfo')) {
          return new Response(
            JSON.stringify({
              sub: lockedUser.googleId,
              email: lockedEmail,
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          );
        }
        return new Response('Not Found', { status: 404 });
      });

      const cbRes = await fetch(
        `${baseUrl}/auth/google/callback?code=locked_code&state=${encodeURIComponent(state)}`,
      );
      assert.equal(cbRes.status, 403);
      const data = await cbRes.json();
      assert.equal(data.code, ApiErrorCode.ACCOUNT_LOCKED);
    });

    it('từ chối làm mới phiên POST /auth/refresh với HTTP 403 ACCOUNT_LOCKED khi user bị khóa', async () => {
      const res = await fetch(`${baseUrl}/auth/refresh`, {
        method: 'POST',
        headers: {
          Cookie: `refreshToken=${lockedRefreshToken}`,
        },
      });
      assert.equal(res.status, 403);
      const data = await res.json();
      assert.equal(data.code, ApiErrorCode.ACCOUNT_LOCKED);
    });

    it('từ chối gọi route bảo vệ bằng AccountLockedGuard với HTTP 403 ACCOUNT_LOCKED', async () => {
      const res = await fetch(`${baseUrl}/auth/user-probe`, {
        headers: {
          Authorization: `Bearer ${lockedAccessToken}`,
        },
      });
      assert.equal(res.status, 403);
      const data = await res.json();
      assert.equal(data.code, ApiErrorCode.ACCOUNT_LOCKED);
    });

    it('từ chối với HTTP 401 khi token chứa sub không phải UUID hoặc người dùng không tồn tại', async () => {
      const nonUuidToken = jwtService.sign({
        sub: 'not-a-valid-uuid',
        email: 'invalid@example.com',
        role: 'user',
      });
      const resNonUuid = await fetch(`${baseUrl}/auth/user-probe`, {
        headers: {
          Authorization: `Bearer ${nonUuidToken}`,
        },
      });
      assert.equal(resNonUuid.status, 401);

      const nonExistentToken = jwtService.sign({
        sub: crypto.randomUUID(),
        email: 'deleted@example.com',
        role: 'user',
      });
      const resNonExistent = await fetch(`${baseUrl}/auth/user-probe`, {
        headers: {
          Authorization: `Bearer ${nonExistentToken}`,
        },
      });
      assert.equal(resNonExistent.status, 401);
    });
  });

  describe('AC7: Kiểm soát CORS theo FRONTEND_URL', () => {
    it('cho phép origin từ FRONTEND_URL với credentials: true', async () => {
      const res = await fetch(`${baseUrl}/health`, {
        headers: {
          Origin: 'http://localhost:3000',
        },
      });
      assert.equal(res.status, 200);
      assert.equal(
        res.headers.get('access-control-allow-origin'),
        'http://localhost:3000',
      );
      assert.equal(
        res.headers.get('access-control-allow-credentials'),
        'true',
      );
    });

    it('từ chối cấp header Access-Control-Allow-Origin cho origin lạ không thuộc FRONTEND_URL', async () => {
      const res = await fetch(`${baseUrl}/health`, {
        headers: {
          Origin: 'https://malicious-site.com',
        },
      });
      // Không cấp Access-Control-Allow-Origin cho domain lạ
      assert.equal(res.headers.get('access-control-allow-origin'), null);
    });
  });
});
