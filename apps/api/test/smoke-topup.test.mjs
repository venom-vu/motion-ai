import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import http from 'node:http';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  AdminTopupListResponseSchema,
  AdminTopupSchema,
  AuthGoogleCallbackResponseSchema,
  AuthGoogleResponseSchema,
  MOCK_ADMIN_TOPUPS_BY_STATUS,
  MOCK_TOPUPS_BY_STATUS,
  MeResponseSchema,
  TOS_VERSION,
  TopupSchema,
  WalletLedgerResponseSchema,
} from '@motion-ai/contracts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const composeFiles = [
  path.join(repoRoot, 'deploy', 'compose.yml'),
  path.join(repoRoot, 'deploy', 'compose.smoke.yml'),
];

const GOOGLE_PORT = 3199;
const DISCORD_PORT = 3196;
const QR_TTL_MS = 8000;
// 23:30 giờ Việt Nam ngày 2030-01-01 -> hạn duyệt 08:15 sáng 2030-01-02 (01:15Z)
const FAKE_NOW = '2030-01-01T16:30:00.000Z';
const EXPECTED_APPROVE_BY = '2030-01-02T01:15:00.000Z';

function listen(server, port) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '0.0.0.0', () => resolve(server));
  });
}
const close = (s) => new Promise((r) => s.close(r));
const readBody = (req) =>
  new Promise((resolve) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
  });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function startFakeGoogle() {
  const tokens = new Map();
  return listen(
    http.createServer(async (req, res) => {
      const url = new URL(req.url, 'http://fake');
      res.setHeader('Content-Type', 'application/json');
      if (req.method === 'POST' && url.pathname === '/token') {
        const code = new URLSearchParams((await readBody(req)).toString()).get('code') ?? '';
        const token = `fake-access-${code}`;
        tokens.set(token, code);
        return res.end(JSON.stringify({ access_token: token, token_type: 'Bearer' }));
      }
      if (req.method === 'GET' && url.pathname === '/userinfo') {
        const code = tokens.get(String(req.headers.authorization ?? '').replace('Bearer ', ''));
        if (!code) {
          res.statusCode = 401;
          return res.end('{}');
        }
        return res.end(JSON.stringify({ sub: `sub-${code}`, email: `${code}@smoke.test`, name: `Smoke ${code}` }));
      }
      res.statusCode = 404;
      res.end('{}');
    }),
    GOOGLE_PORT,
  );
}

/** Discord webhook giả: ghi lại nội dung mọi thông báo. */
function startFakeDiscord(messages) {
  return listen(
    http.createServer(async (req, res) => {
      if (req.method === 'POST' && req.url === '/hook') {
        messages.push(JSON.parse((await readBody(req)).toString()).content);
        res.statusCode = 204;
        return res.end();
      }
      res.statusCode = 404;
      res.end();
    }),
    DISCORD_PORT,
  );
}

describe('Smoke nạp tiền FE-BE trên stack Compose (Story 3.8)', () => {
  it(
    'tạo đơn, xác nhận, Discord, duyệt, bank_ref trùng, ngoài giờ, hết hạn QR, duyệt đồng thời, đối soát',
    {
      skip:
        process.env.RUN_COMPOSE_E2E === '1'
          ? false
          : 'Đặt RUN_COMPOSE_E2E=1 để chạy (cần Docker, build image, dựng cả stack)',
      timeout: 1_200_000,
    },
    async () => {
      const project = 'motion-ai-smoke-tp';
      const apiPort = '3104';
      const base = `http://127.0.0.1:${apiPort}`;
      const env = {
        ...process.env,
        PORT: apiPort,
        API_PUBLIC_URL: base,
        POSTGRES_PORT: '15435',
        REDIS_PORT: '16382',
        ADMIN_EMAILS: 'admin@smoke.test,admin2@smoke.test',
        DISCORD_WEBHOOK_URL: `http://host.docker.internal:${DISCORD_PORT}/hook`,
        TOPUP_QR_TTL_MS: String(QR_TTL_MS),
        TOPUP_FAKE_NOW: FAKE_NOW,
        TOPUP_SWEEP_INTERVAL: '1000',
        GOOGLE_TOKEN_URL: `http://host.docker.internal:${GOOGLE_PORT}/token`,
        GOOGLE_USERINFO_URL: `http://host.docker.internal:${GOOGLE_PORT}/userinfo`,
      };
      delete env.DATABASE_URL;
      delete env.REDIS_URL;
      const compose = (args) =>
        execFileSync(
          'docker',
          ['compose', '-p', project, ...composeFiles.flatMap((f) => ['-f', f]), ...args],
          { cwd: repoRoot, env, encoding: 'utf8', stdio: 'pipe' },
        );

      const discord = [];
      const servers = [];
      try {
        servers.push(await startFakeGoogle(), await startFakeDiscord(discord));
        compose(['up', '-d', '--build', '--wait']);

        async function login(label) {
          const q = new URLSearchParams({ tosVersion: TOS_VERSION, deviceId: `device-${label}` });
          const r1 = await fetch(`${base}/auth/google?${q}`);
          assert.equal(r1.status, 200);
          const start = AuthGoogleResponseSchema.parse(await r1.json());
          const setCookie = r1.headers.getSetCookie().find((c) => c.startsWith('motion_device='));
          const cookie = setCookie ? setCookie.split(';')[0] : '';
          const state = new URL(start.redirectUrl).searchParams.get('state');
          const r2 = await fetch(`${base}/auth/google/callback?${new URLSearchParams({ code: label, state })}`, {
            headers: { Cookie: cookie },
          });
          assert.equal(r2.status, 200);
          return AuthGoogleCallbackResponseSchema.parse(await r2.json());
        }
        async function api(session, method, p, body) {
          const init = {
            method,
            headers: {
              Authorization: `Bearer ${session.accessToken}`,
              ...(body ? { 'Content-Type': 'application/json' } : {}),
            },
            body: body ? JSON.stringify(body) : undefined,
          };
          try {
            return await fetch(`${base}${p}`, init);
          } catch {
            // Socket keep-alive có thể bị đóng khi vòng lặp sự kiện bị chặn bởi lệnh docker đồng bộ.
            await sleep(500);
            return fetch(`${base}${p}`, init);
          }
        }
        async function me(session) {
          const res = await api(session, 'GET', '/me');
          assert.equal(res.status, 200);
          return MeResponseSchema.parse(await res.json());
        }
        async function createTopup(session, pack) {
          const res = await api(session, 'POST', '/topups', { pack, consent: true });
          assert.equal(res.status, 201);
          const t = TopupSchema.parse(await res.json());
          assert.equal(t.status, 'awaiting_transfer');
          return t;
        }
        const confirm = (session, id) => api(session, 'POST', `/topups/${id}/confirm-transfer`);
        async function getTopup(session, id) {
          const res = await api(session, 'GET', `/topups/${id}`);
          assert.equal(res.status, 200);
          return TopupSchema.parse(await res.json());
        }
        const adminPost = (session, id, action, body) =>
          api(session, 'POST', `/admin/topups/${id}/${action}`, body);
        async function topupLedger(session, topupId) {
          const res = await api(session, 'GET', '/wallet/ledger?pageSize=50');
          assert.equal(res.status, 200);
          const l = WalletLedgerResponseSchema.parse(await res.json());
          return l.items.filter((i) => i.topupId === topupId);
        }
        async function waitFor(fn, label, timeoutMs = 30_000) {
          const end = Date.now() + timeoutMs;
          while (Date.now() < end) {
            const v = await fn();
            if (v) return v;
            await sleep(300);
          }
          assert.fail(`${label}: quá thời gian chờ`);
        }

        const admin = await login('admin');
        const admin2 = await login('admin2');
        assert.equal((await me(admin)).role, 'admin');
        assert.equal((await me(admin2)).role, 'admin');

        // 1. Đường thành công + 3. ngoài khung giờ
        const alice = await login('alice');
        assert.equal((await me(alice)).role, 'user');
        assert.equal((await api(alice, 'GET', '/admin/topups')).status, 403, 'user không vào được /admin/**');
        const t1 = await createTopup(alice, 'pro');
        assert.equal(t1.amountVnd, 99000);
        assert.equal(t1.credits, 12000);
        assert.equal(t1.transferContent, `NAP ${t1.code}`);
        assert.equal(t1.bankCode, '970436');
        const c1 = await confirm(alice, t1.id);
        assert.equal(c1.status, 200);
        const pending1 = TopupSchema.parse(await c1.json());
        assert.equal(pending1.status, 'pending');
        assert.equal(pending1.approveBy, EXPECTED_APPROVE_BY, 'ngoài khung giờ: duyệt từ 08:15 sáng hôm sau');
        assert.equal((await confirm(alice, t1.id)).status, 200, 'xác nhận lặp lại idempotent');

        await waitFor(() => discord.filter((m) => m.includes(t1.code)).length >= 1, 'Discord nhận thông báo');
        await sleep(2500); // qua vài chu kỳ quét: không được gửi lại
        const msgs1 = discord.filter((m) => m.includes(t1.code));
        assert.equal(msgs1.length, 1, `Discord phải nhận đúng 1 thông báo, nhận ${msgs1.length}`);
        assert.ok(!msgs1[0].includes('alice@smoke.test'), 'thông báo không chứa email');
        assert.ok(!msgs1[0].includes('0000000000'), 'thông báo không chứa số tài khoản');

        // Quá qr_expires_at vẫn pending
        const waitMs = new Date(pending1.qrExpiresAt).getTime() - Date.now();
        if (waitMs > 0) await sleep(waitMs + 2500);
        assert.equal((await getTopup(alice, t1.id)).status, 'pending', 'pending không bao giờ tự expired');

        const list = AdminTopupListResponseSchema.parse(await (await api(admin, 'GET', '/admin/topups?status=pending')).json());
        const listed = list.items.find((i) => i.id === t1.id);
        assert.ok(listed && listed.isOverdue === false);

        const before = await me(alice);
        const ap1 = await adminPost(admin, t1.id, 'approve', { bankRef: 'REF-1' });
        assert.equal(ap1.status, 200);
        const approved1 = AdminTopupSchema.parse(await ap1.json());
        assert.equal(approved1.status, 'approved');
        assert.equal(approved1.bankRef, 'REF-1');
        const after = await me(alice);
        assert.equal(after.balance, before.balance + 12000);
        assert.equal(after.tier, 'Pro');
        const led1 = await topupLedger(alice, t1.id);
        assert.equal(led1.length, 1);
        assert.equal(led1[0].type, 'TOPUP');
        assert.equal(led1[0].amount, 12000);

        // 2. bank_ref trùng
        const t2 = await createTopup(alice, 'pro');
        assert.equal((await confirm(alice, t2.id)).status, 200);
        const dup = await adminPost(admin, t2.id, 'approve', { bankRef: 'REF-1' });
        assert.equal(dup.status, 409);
        assert.equal((await dup.json()).code, 'BANK_REF_DUPLICATE');
        assert.equal((await getTopup(alice, t2.id)).status, 'pending');
        assert.equal((await me(alice)).balance, after.balance, 'không cộng credit khi bank_ref trùng');
        assert.equal((await topupLedger(alice, t2.id)).length, 0);

        // needs_review -> return-to-pending: hạn duyệt tính lại từ đồng hồ giả
        const nr = await adminPost(admin, t2.id, 'needs-review', { note: 'Cần đối chiếu thêm' });
        assert.equal(nr.status, 200);
        assert.equal(AdminTopupSchema.parse(await nr.json()).status, 'needs_review');
        const back = await adminPost(admin, t2.id, 'return-to-pending');
        assert.equal(back.status, 200);
        const backDto = AdminTopupSchema.parse(await back.json());
        assert.equal(backDto.status, 'pending');
        assert.equal(backDto.approveBy, EXPECTED_APPROVE_BY, 'return-to-pending tính lại approve_by theo đồng hồ giả');

        // 4. QR hết hạn
        const bob = await login('bob');
        const bobBefore = (await me(bob)).balance;
        // Dừng worker để bộ quét không đổi trạng thái trước: xác nhận quá hạn QR phải trả TOPUP_QR_EXPIRED.
        compose(['stop', 'nestjs-worker']);
        const t3 = await createTopup(bob, 'starter');
        const t3b = await createTopup(bob, 'starter');
        await sleep(QR_TTL_MS + 1500);
        const late = await confirm(bob, t3.id);
        assert.equal(late.status, 409);
        assert.equal((await late.json()).code, 'TOPUP_QR_EXPIRED');
        assert.equal((await getTopup(bob, t3.id)).status, 'expired');
        const again = await confirm(bob, t3.id);
        assert.equal(again.status, 409);
        assert.equal((await again.json()).code, 'TOPUP_STATE_INVALID');
        // Bật lại worker: bộ quét đổi đơn awaiting_transfer quá hạn sang expired.
        compose(['start', 'nestjs-worker']);
        await waitFor(async () => (await getTopup(bob, t3b.id)).status === 'expired', 'bộ quét chuyển expired', 60_000);
        assert.equal((await me(bob)).balance, bobBefore, 'đơn expired không cộng credit');

        // 5. Duyệt đồng thời
        const carol = await login('carol');
        const carolBefore = (await me(carol)).balance;
        const t4 = await createTopup(carol, 'starter');
        assert.equal((await confirm(carol, t4.id)).status, 200);
        const [r1, r2] = await Promise.all([
          adminPost(admin, t4.id, 'approve', { bankRef: 'REF-C1' }),
          adminPost(admin2, t4.id, 'approve', { bankRef: 'REF-C2' }),
        ]);
        const statuses = [r1.status, r2.status].sort();
        assert.deepEqual(statuses, [200, 409]);
        const loser = r1.status === 409 ? r1 : r2;
        assert.equal((await loser.json()).code, 'TOPUP_STATE_INVALID');
        assert.equal((await me(carol)).balance, carolBefore + 5000, 'credit chỉ cộng một lần');
        assert.equal((await topupLedger(carol, t4.id)).length, 1);

        // Hợp đồng: MOCK_* và phản hồi thật cùng schema, khóa thật nằm trong khóa mock
        for (const t of Object.values(MOCK_TOPUPS_BY_STATUS)) TopupSchema.parse(t);
        for (const t of Object.values(MOCK_ADMIN_TOPUPS_BY_STATUS)) AdminTopupSchema.parse(t);
        // So khóa trên JSON thô (schema không strict nên parse sẽ âm thầm bỏ khóa lạ).
        const mockKeys = new Set(Object.values(MOCK_TOPUPS_BY_STATUS).flatMap((t) => Object.keys(t)));
        const rawTopup = await (await api(alice, 'GET', `/topups/${t1.id}`)).json();
        for (const k of Object.keys(rawTopup)) assert.ok(mockKeys.has(k), `khóa Topup thật lạ: ${k}`);
        const mockAdminKeys = new Set(Object.values(MOCK_ADMIN_TOPUPS_BY_STATUS).flatMap((t) => Object.keys(t)));
        const rawList = await (await api(admin, 'GET', '/admin/topups?status=approved')).json();
        const rawAdminItem = rawList.items.find((i) => i.id === t1.id);
        assert.ok(rawAdminItem, 'đơn đã duyệt phải có trong danh sách admin');
        for (const k of Object.keys(rawAdminItem)) assert.ok(mockAdminKeys.has(k), `khóa AdminTopup thật lạ: ${k}`);

        // Đối soát: thoát mã 0 nếu không lệch
        const out = compose(['exec', '-T', 'nestjs-worker', 'node', 'apps/api/dist/scripts/reconcile.js']);
        assert.match(out, /"status":"ok"/);
      } finally {
        try {
          compose(['down', '-v']);
        } catch {
          // best-effort cleanup
        }
        for (const s of servers) await close(s);
      }
    },
  );

  it('MOCK_* nạp tiền parse được qua schema contracts (không cần Docker)', () => {
    for (const t of Object.values(MOCK_TOPUPS_BY_STATUS)) TopupSchema.parse(t);
    for (const t of Object.values(MOCK_ADMIN_TOPUPS_BY_STATUS)) AdminTopupSchema.parse(t);
  });
});
