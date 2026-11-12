import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import {
  AdminAdjustResponseSchema,
  AdminAuditResponseSchema,
  AdminTaskLookupResponseSchema,
  AdminTaskTakedownResponseSchema,
  AdminTopupSchema,
  AdminUserSchema,
  FaceSwapCreateResponseSchema,
  MotionCreateResponseSchema,
  ShareInfoResponseSchema,
  MOCK_ADMIN_ADJUST_REQUEST,
  MOCK_ADMIN_AUDIT_RESPONSE,
  MOCK_ADMIN_TASK_LOOKUP_RESPONSE,
  MOCK_ADMIN_USER,
  MOCK_ADMIN_USER_LOCKED,
  MOCK_OPS_STATUS_BUDGET_EXHAUSTED,
  MOCK_OPS_STATUS_NORMAL,
  MOCK_OPS_STATUS_PAUSED,
  MOCK_SYSTEM_STATUS_NORMAL,
  MOCK_SYSTEM_STATUS_PAUSED,
  AdminAdjustRequestSchema,
  OpsStatusResponseSchema,
  SystemStatusResponseSchema,
  TaskResultResponseSchema,
  TaskShareResponseSchema,
  TopupSchema,
  WalletLedgerResponseSchema,
} from '@flowvis/contracts';
import {
  PORTS,
  close,
  makeClient,
  makeCompose,
  makePng,
  makeVideo,
  sleep,
  startFakeDiscord,
  startFakeGoogle,
  startFakeRunningHub,
  startFakeS3,
} from './helpers/smoke-fakes.mjs';

const RATE_RULE = 'ERROR_RATE_15_PERCENT_20_TASKS_30_MIN';
const CONSECUTIVE_RULE = 'CONSECUTIVE_5_SYSTEM_FAILURES';
const NODE = 'node';

// Chạy một đoạn ESM trong container worker, nạp AppModule bằng đường dẫn tuyệt đối (như reconcile.js).
const BACKUP_SCRIPT = `
import 'reflect-metadata';
const core = await import('@nestjs/core');
const NestFactory = core.NestFactory ?? core.default.NestFactory;
const { AppModule } = await import('/app/apps/api/dist/app.module.js');
const { BackupService } = await import('/app/apps/api/dist/modules/ops/backup.service.js');
const ctx = await NestFactory.createApplicationContext(AppModule, { logger: false });
try {
  const r = await ctx.get(BackupService, { strict: false }).backup();
  console.log('RESULT:' + JSON.stringify(r));
} finally {
  await ctx.close();
}
process.exit(0);
`;

describe('Smoke vận hành trên stack Compose (Story 6.10)', {
  skip:
    process.env.RUN_COMPOSE_E2E === '1'
      ? false
      : 'Đặt RUN_COMPOSE_E2E=1 để chạy (cần Docker, build image, dựng cả stack bốn container)',
}, () => {
  const project = 'flowvis-smoke-ops';
  const apiPort = '3107';
  const base = `http://127.0.0.1:${apiPort}`;
  const env = {
    ...process.env,
    PORT: apiPort,
    API_PUBLIC_URL: base,
    POSTGRES_PORT: '15438',
    REDIS_PORT: '16385',
    RH_DEADLINE_MS: '60000',
    RUNNINGHUB_BASE_URL: `http://host.docker.internal:${PORTS.rh}`,
    R2_ENDPOINT: `http://host.docker.internal:${PORTS.s3}`,
    GOOGLE_TOKEN_URL: `http://host.docker.internal:${PORTS.google}/token`,
    GOOGLE_USERINFO_URL: `http://host.docker.internal:${PORTS.google}/userinfo`,
    DISCORD_WEBHOOK_URL: `http://host.docker.internal:${PORTS.discord}/hook`,
    ADMIN_EMAILS: 'admin@smoke.test',
    NUXT_PUBLIC_REPORT_EMAIL: 'abuse@smoke.test',
  };
  delete env.DATABASE_URL;
  delete env.REDIS_URL;
  delete env.OPS_BREAKER_DISABLED; // breaker thật phải bật trong stack
  const compose = makeCompose(project, env);
  const c = makeClient(base);
  const { api, me, login, uploadFile, waitFor, poll } = c;

  const discord = [];
  const servers = [];
  let s3;
  let png;
  let admin;
  let ops;
  let opsKeys;
  let firstSuccess;
  const rh = {
    mode: 'success',
    resultExt: 'png',
    resultImage: null,
    resultVideo: Buffer.alloc(0),
    submits: 0,
    submitBodies: [],
    uploads: [],
  };
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'flowvis-smoke-ops-'));

  const discordCount = (kind) => discord.filter((m) => m.includes(kind)).length;
  const isDone = (t) => t.status !== 'queued' && t.status !== 'running';

  async function uploadPair(session) {
    return { sourceKey: await uploadFile(session, 'image/png', png), targetKey: await uploadFile(session, 'image/png', png) };
  }
  const createFace = (session, keys) => api(session, 'POST', '/tasks/face-swap', keys);
  async function runBatch(session, keys, n, mode) {
    rh.mode = mode;
    const ids = [];
    for (let i = 0; i < n; i += 1) {
      const res = await createFace(session, keys);
      assert.equal(res.status, 201, await res.clone().text());
      ids.push(FaceSwapCreateResponseSchema.parse(await res.json()).id);
    }
    const out = [];
    for (const id of ids) out.push(await waitFor(session, id, isDone, `batch ${mode}`, 120_000));
    return out;
  }
  async function becomeCreator(session, ref) {
    const r = await api(session, 'POST', '/topups', { pack: 'creator' });
    assert.equal(r.status, 201);
    const t = TopupSchema.parse(await r.json());
    assert.equal((await api(session, 'POST', `/topups/${t.id}/confirm-transfer`)).status, 200);
    const ap = await api(admin, 'POST', `/admin/topups/${t.id}/approve`, { bankRef: ref });
    assert.equal(ap.status, 200);
    assert.equal(AdminTopupSchema.parse(await ap.json()).status, 'approved');
  }
  async function systemStatus() {
    const res = await api(null, 'GET', '/system/status');
    assert.equal(res.status, 200);
    return SystemStatusResponseSchema.parse(await res.json());
  }
  async function opsStatus() {
    const res = await api(admin, 'GET', '/admin/ops/status');
    assert.equal(res.status, 200);
    const body = await res.json();
    return { body, parsed: OpsStatusResponseSchema.parse(body) };
  }
  async function resume() {
    const res = await api(admin, 'POST', '/admin/ops/resume');
    assert.equal(res.status, 200);
    const st = OpsStatusResponseSchema.parse(await res.json());
    assert.equal(st.intakePaused, false);
    assert.equal((await systemStatus()).intakePaused, false);
  }
  async function adminUser(email) {
    const res = await api(admin, 'GET', `/admin/users?email=${encodeURIComponent(email)}`);
    assert.equal(res.status, 200);
    return AdminUserSchema.parse(await res.json());
  }
  async function runInWorker(extraEnvArgs = [], node = NODE) {
    const out = await compose([
      'exec', '-T', '-w', '/app/apps/api', ...extraEnvArgs, '-e', 'MOTION_PROCESS_ROLE=script',
      'nestjs-worker', node, '--input-type=module', '-e', BACKUP_SCRIPT,
    ]);
    const line = out.split('\n').find((l) => l.startsWith('RESULT:'));
    assert.ok(line, `không có RESULT trong đầu ra: ${out}`);
    return JSON.parse(line.slice('RESULT:'.length));
  }
  const backupKeys = () => [...s3.objects.keys()].filter((k) => k.startsWith('db-backup/')).sort();

  before(async () => {
    png = await makePng();
    rh.resultImage = png;
    servers.push(await startFakeGoogle(), await startFakeRunningHub(rh), await startFakeDiscord(discord));
    s3 = await startFakeS3();
    servers.push(s3);
    await compose(['up', '-d', '--build', '--wait']);
    admin = await login('admin');
    assert.equal((await me(admin)).role, 'admin');
    ops = await login('ops');
    await becomeCreator(ops, 'OPS-REF-1');
    opsKeys = await uploadPair(ops);
  });

  after(async () => {
    try {
      await compose(['down', '-v']);
    } catch {
      // best-effort cleanup
    }
    for (const s of servers) await close(s);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('ngắt mạch: 5 lỗi hệ thống liên tiếp chặn 3 route tạo Task, phần còn lại vẫn dùng được, Discord đúng 1 cảnh báo', { timeout: 600_000 }, async () => {
    // Một Task thành công trước để có kết quả tải về khi đang tạm dừng.
    const [ok] = await runBatch(ops, opsKeys, 1, 'success');
    assert.equal(ok.status, 'succeeded');
    firstSuccess = ok;
    assert.equal((await systemStatus()).intakePaused, false);

    const f1 = await runBatch(ops, opsKeys, 3, 'error');
    assert.ok(f1.every((t) => t.status === 'failed' && t.reasonCode === 'RH_ERROR'));
    assert.equal((await systemStatus()).intakePaused, false, 'mới 3 lỗi liên tiếp');
    await runBatch(ops, opsKeys, 2, 'error');
    await poll(async () => (await systemStatus()).intakePaused, 'intakePaused true');

    const before = (await me(ops)).balance;
    const blocked = [
      await createFace(ops, opsKeys),
      await api(ops, 'POST', '/tasks/body-retouch', {}),
      await api(ops, 'POST', '/tasks/motion', {}),
    ];
    for (const r of blocked) {
      assert.equal(r.status, 503);
      assert.equal((await r.json()).code, 'PAUSED');
    }
    assert.equal((await me(ops)).balance, before, 'không HOLD cho yêu cầu bị chặn');

    // Đăng nhập, nạp, lịch sử, tải kết quả vẫn dùng được.
    const other = await login('paused-visitor');
    assert.ok(other.accessToken);
    const topup = await api(other, 'POST', '/topups', { pack: 'starter' });
    assert.equal(topup.status, 201);
    TopupSchema.parse(await topup.json());
    const ledger = await api(ops, 'GET', '/wallet/ledger?pageSize=50');
    assert.equal(ledger.status, 200);
    WalletLedgerResponseSchema.parse(await ledger.json());
    const resRes = await api(ops, 'GET', `/tasks/${firstSuccess.id}/result`);
    assert.equal(resRes.status, 200);
    const result = TaskResultResponseSchema.parse(await resRes.json());
    assert.equal((await fetch(c.toHost(result.resultUrl))).status, 200);

    await sleep(3000);
    assert.equal(discordCount('ops.breaker_triggered'), 1, `Discord: ${discord.join(' | ')}`);
    const { body, parsed } = await opsStatus();
    assert.equal(parsed.intakePaused, true);
    assert.equal(parsed.lastBreakerTrigger.rule, CONSECUTIVE_RULE);
    // Khớp hình dạng mock
    assert.deepEqual(Object.keys(body).sort(), Object.keys(MOCK_OPS_STATUS_PAUSED).sort());
  });

  it('mở lại: Admin resume cho tạo Task lại, lỗi cũ không kích hoạt lại ngay, có nhật ký', { timeout: 300_000 }, async () => {
    await resume();
    const [one] = await runBatch(ops, opsKeys, 1, 'success');
    assert.equal(one.status, 'succeeded');
    const [bad] = await runBatch(ops, opsKeys, 1, 'error');
    assert.equal(bad.status, 'failed');
    await sleep(2000);
    assert.equal((await systemStatus()).intakePaused, false, 'lỗi cũ không tính lại sau resume');
    const audit = await api(admin, 'GET', '/admin/audit?action=ops.resume');
    assert.equal(audit.status, 200);
    const parsed = AdminAuditResponseSchema.parse(await audit.json());
    assert.ok(parsed.items.length >= 1);
  });

  it('tỷ lệ 15%: 20 Task đủ điều kiện (4 lỗi hệ thống) kích hoạt breaker, 30 NO_POSE thì không', { timeout: 900_000 }, async () => {
    await resume(); // đặt lại mốc đếm
    discord.length = 0;
    await runBatch(ops, opsKeys, 3, 'success');
    await runBatch(ops, opsKeys, 3, 'success');
    await runBatch(ops, opsKeys, 3, 'success'); // 9 thành công
    const np1 = await runBatch(ops, opsKeys, 3, 'no_pose');
    assert.ok(np1.every((t) => t.status === 'failed' && t.reasonCode === 'NO_POSE'));
    await runBatch(ops, opsKeys, 3, 'error'); // 3 lỗi, mẫu 12 < 20
    await runBatch(ops, opsKeys, 3, 'no_pose');
    await runBatch(ops, opsKeys, 3, 'success');
    await runBatch(ops, opsKeys, 3, 'success'); // mẫu 18
    await runBatch(ops, opsKeys, 3, 'no_pose');
    await runBatch(ops, opsKeys, 1, 'success'); // mẫu 19, 16% nhưng chưa đủ 20
    await runBatch(ops, opsKeys, 1, 'no_pose');
    assert.equal((await systemStatus()).intakePaused, false, 'chưa đủ 20 Task đủ điều kiện');
    await runBatch(ops, opsKeys, 1, 'error'); // mẫu 20, 4 lỗi = 20% > 15%
    await poll(async () => (await systemStatus()).intakePaused, 'breaker tỷ lệ');
    const { parsed } = await opsStatus();
    assert.equal(parsed.lastBreakerTrigger.rule, RATE_RULE);
    assert.equal(parsed.lastBreakerTrigger.metrics.eligibleTasks, 20);
    assert.equal(parsed.lastBreakerTrigger.metrics.systemFailures, 4);
    await sleep(2500);
    assert.equal(discordCount('ops.breaker_triggered'), 1);

    await resume();
    for (let i = 0; i < 10; i += 1) {
      const t = await runBatch(ops, opsKeys, 3, 'no_pose');
      assert.ok(t.every((x) => x.reasonCode === 'NO_POSE'));
    }
    await sleep(2500);
    assert.equal((await systemStatus()).intakePaused, false, '30 NO_POSE không kích hoạt');
    assert.equal(discordCount('ops.breaker_triggered'), 1);
  });

  it('khóa tài khoản: JWT cũ bị ACCOUNT_LOCKED, refresh bị từ chối, mở khóa đăng nhập lại được', { timeout: 120_000 }, async () => {
    const locky = await login('locky');
    assert.ok(locky.refreshCookie);
    const keys = await uploadPair(locky);
    const target = await adminUser('locky@smoke.test');
    const reason = { reason: 'Vi phạm điều khoản (smoke)' };
    const lockRes = await api(admin, 'POST', `/admin/users/${target.id}/lock`, reason);
    assert.equal(lockRes.status, 200);
    assert.ok(AdminUserSchema.parse(await lockRes.json()).lockedAt);
    const bal = target.balance;

    const create = await createFace(locky, keys);
    assert.equal(create.status, 403);
    assert.equal((await create.json()).code, 'ACCOUNT_LOCKED');
    assert.equal((await adminUser('locky@smoke.test')).balance, bal, 'không HOLD');
    const refresh = await fetch(`${base}/auth/refresh`, { method: 'POST', headers: { Cookie: locky.refreshCookie } });
    const refreshBody = await refresh.text();
    assert.ok(refresh.status === 401 || refresh.status === 403, `refresh phải bị từ chối: ${refresh.status} ${refreshBody}`);

    const unlock = await api(admin, 'POST', `/admin/users/${target.id}/unlock`, reason);
    assert.equal(unlock.status, 200);
    assert.equal(AdminUserSchema.parse(await unlock.json()).lockedAt, null);
    const again = await login('locky');
    assert.equal((await me(again)).id, target.id);
    // Tài khoản này không còn credit thưởng (cùng IP): 402 chứng minh đã qua guard khóa; không được là 403 ACCOUNT_LOCKED.
    const ok = await createFace(again, keys);
    assert.equal(ok.status, 402);
    assert.equal((await ok.json()).code, 'INSUFFICIENT_CREDIT');
  });

  it('cộng bù: +300 một bút toán ADJUST, trừ vượt bị từ chối, gửi lại cùng requestId không ghi thêm, có admin_audit', { timeout: 120_000 }, async () => {
    const adj = await login('adj');
    const target = await adminUser('adj@smoke.test');
    const requestId = randomUUID();
    const req = { amount: 300, reason: 'Bù credit do lỗi hệ thống (smoke)', requestId };
    AdminAdjustRequestSchema.parse(req);
    const res = await api(admin, 'POST', `/admin/users/${target.id}/adjust`, req);
    assert.equal(res.status, 200, await res.clone().text());
    const first = AdminAdjustResponseSchema.parse(await res.json());
    assert.equal(first.entry.type, 'ADJUST');
    assert.equal(first.entry.amount, 300);
    assert.equal(first.user.balance, target.balance + 300);

    const over = await api(admin, 'POST', `/admin/users/${target.id}/adjust`, {
      amount: -(first.user.balance + 1000),
      reason: 'Trừ vượt số dư (smoke)',
      requestId: randomUUID(),
    });
    assert.equal(over.status, 400);
    assert.equal((await over.json()).details.reason, 'ADJUST_INSUFFICIENT_BALANCE');

    const replay = await api(admin, 'POST', `/admin/users/${target.id}/adjust`, req);
    assert.equal(replay.status, 200);
    assert.equal(AdminAdjustResponseSchema.parse(await replay.json()).entry.id, first.entry.id);

    assert.equal((await me(adj)).balance, target.balance + 300);
    const ledger = WalletLedgerResponseSchema.parse(await (await api(adj, 'GET', '/wallet/ledger?pageSize=50')).json());
    assert.equal(ledger.items.filter((i) => i.type === 'ADJUST').length, 1);

    const audit = await api(admin, 'GET', `/admin/audit?action=wallet.adjust&target=${encodeURIComponent(`user:${target.id}`)}`);
    const parsed = AdminAuditResponseSchema.parse(await audit.json());
    assert.equal(parsed.items.length, 1, 'gửi lại không ghi thêm nhật ký');
    assert.equal(parsed.items[0].requestId, requestId);
    assert.ok(parsed.items[0].reason);
  });

  it('gỡ nội dung: video đã chia sẻ, tìm theo shareUrl, gỡ, /s/* 404, khóa in/ và out/ biến mất khỏi R2, số dư không đổi', { timeout: 300_000 }, async () => {
    const tkd = await login('tkd');
    await becomeCreator(tkd, 'OPS-REF-2');
    // Video Motion Control (poster chỉ có cho kết quả .mp4): RH giả trả MP4 đúng 5 giây.
    const sample = makeVideo(path.join(tmp, 'tkd-sample.mp4'), 6);
    const prevMode = rh.mode;
    const prevExt = rh.resultExt;
    const prevVideo = rh.resultVideo;
    let t;
    try {
      rh.resultVideo = makeVideo(path.join(tmp, 'tkd-r5.mp4'), 5);
      rh.resultExt = 'mp4';
      rh.mode = 'success';
      const characterKey = await uploadFile(tkd, 'image/png', png);
      const videoKey = await uploadFile(tkd, 'video/mp4', sample);
      const cr = await api(tkd, 'POST', '/tasks/motion', { characterKey, videoKey, trimStart: 0, trimEnd: 5 });
      assert.equal(cr.status, 201, await cr.clone().text());
      const created = MotionCreateResponseSchema.parse(await cr.json());
      t = await waitFor(tkd, created.id, isDone, 'motion takedown', 120_000);
    } finally {
      rh.mode = prevMode;
      rh.resultExt = prevExt;
      rh.resultVideo = prevVideo;
    }
    assert.equal(t.status, 'succeeded', JSON.stringify(t));
    assert.equal(t.pipeline, 'motion_control');
    const shRes = await api(tkd, 'POST', `/tasks/${t.id}/share`);
    assert.ok(shRes.status === 200 || shRes.status === 201);
    const share = TaskShareResponseSchema.parse(await shRes.json());
    const noFollow = (p) => fetch(`${base}${p}`, { redirect: 'manual' });
    assert.equal((await noFollow(`/s/${share.token}`)).status, 302);
    const infoRes = await noFollow(`/s/${share.token}/info`);
    assert.equal(infoRes.status, 200);
    assert.equal(ShareInfoResponseSchema.parse(await infoRes.json()).mediaType, 'video');
    assert.equal((await noFollow(`/s/${share.token}/poster`)).status, 302, 'poster có trước khi gỡ');

    const uid = (await me(tkd)).id;
    const owned = () => [...s3.objects.keys()].filter((k) => k.startsWith(`in/${uid}/`) || k.startsWith(`out/${uid}/`));
    assert.ok(owned().length >= 3, `khóa trước khi gỡ: ${owned()}`);
    const balanceBefore = (await me(tkd)).balance;

    const lk = await api(admin, 'GET', `/admin/tasks/lookup?shareUrl=${encodeURIComponent(share.shareUrl)}`);
    assert.equal(lk.status, 200);
    const found = AdminTaskLookupResponseSchema.parse(await lk.json());
    assert.equal(found.id, t.id);
    assert.equal(found.filesRemovedAt, null);

    const td = await api(admin, 'POST', `/admin/tasks/${t.id}/takedown`, { reason: 'Nội dung vi phạm (smoke)' });
    assert.equal(td.status, 200);
    const done = AdminTaskTakedownResponseSchema.parse(await td.json());
    assert.ok(done.filesRemovedAt);
    for (const suffix of ['', '/info', '/poster']) {
      assert.equal((await noFollow(`/s/${share.token}${suffix}`)).status, 404, `sau gỡ ${suffix}`);
    }
    assert.deepEqual(owned(), [], 'khóa in/ và out/ đã bị xóa');
    const after = AdminTaskLookupResponseSchema.parse(
      await (await api(admin, 'GET', `/admin/tasks/lookup?taskId=${t.id}`)).json(),
    );
    assert.ok(after.filesRemovedAt);
    assert.equal((await me(tkd)).balance, balanceBefore, 'số dư không đổi');
    const again = await api(admin, 'POST', `/admin/tasks/${t.id}/takedown`, { reason: 'Gỡ lại (smoke)' });
    assert.equal(again.status, 200, 'idempotent');
  });

  it('sao lưu: giữ đúng 7 bản mới nhất; restore-drill đạt; pg_dump lỗi thì không xóa bản cũ và Discord đúng 1 cảnh báo', { timeout: 600_000 }, async () => {
    for (let i = 1; i <= 9; i += 1) {
      s3.objects.set(`db-backup/2026010${i}T030000Z.dump`, { body: Buffer.from('old'), etag: `"old${i}"`, contentType: 'application/octet-stream' });
    }
    assert.equal(backupKeys().length, 9);
    const r = await runInWorker();
    assert.equal(r.ok, true, JSON.stringify(r));
    const kept = backupKeys();
    assert.equal(kept.length, 7);
    assert.ok(kept.includes(r.key));
    assert.ok(!kept.includes('db-backup/20260101T030000Z.dump') && !kept.includes('db-backup/20260103T030000Z.dump'));
    assert.ok(kept.includes('db-backup/20260109T030000Z.dump'));
    const st = (await opsStatus()).parsed;
    assert.equal(st.lastBackup.result, 'success');

    // Restore-drill: khôi phục bản vừa tạo vào CSDL trống và đối chiếu sổ cái.
    const drill = await compose(['exec', '-T', 'nestjs-worker', 'node', 'apps/api/dist/scripts/restore-drill.js']);
    const line = drill.trim().split('\n').pop();
    const parsedDrill = JSON.parse(line);
    assert.equal(parsedDrill.ok, true, drill);
    assert.ok(parsedDrill.checked > 0);

    // pg_dump lỗi (PATH rỗng cho tiến trình con): không xóa bản cũ, một cảnh báo.
    const before = backupKeys();
    const failed = await runInWorker(['-e', 'PATH=/nonexistent'], '/usr/local/bin/node');
    assert.equal(failed.ok, false);
    assert.equal(failed.step, 'dump');
    assert.deepEqual(backupKeys(), before, 'không xóa bản cũ khi lỗi');
    await sleep(1500);
    assert.equal(discordCount('ops.backup_failed'), 1);
    assert.equal((await opsStatus()).parsed.lastBackup.result, 'failed');
  });

  it('sau khôi phục: xóa Redis, bộ quét dựng lại hàng đợi Task queued', { timeout: 600_000 }, async () => {
    rh.mode = 'success';
    await compose(['stop', 'nestjs-worker']);
    const res = await createFace(ops, opsKeys);
    assert.equal(res.status, 201);
    const task = FaceSwapCreateResponseSchema.parse(await res.json());
    await sleep(1000);
    await compose(['exec', '-T', 'redis-7', 'redis-cli', 'FLUSHALL']);
    await compose(['start', 'nestjs-worker']);
    const done = await waitFor(ops, task.id, isDone, 'Task queued được dựng lại', 240_000);
    assert.equal(done.status, 'succeeded');
  });

  it('đối soát: reconcile.js thoát 0 sau toàn bộ kịch bản', { timeout: 120_000 }, async () => {
    const out = await compose(['exec', '-T', 'nestjs-worker', 'node', 'apps/api/dist/scripts/reconcile.js']);
    assert.match(out, /"status":"ok"/);
  });
});

describe('Hợp đồng vận hành: mock khớp schema contracts (không cần Docker)', () => {
  it('MOCK_* vận hành parse qua schema', () => {
    for (const s of [MOCK_OPS_STATUS_NORMAL, MOCK_OPS_STATUS_PAUSED, MOCK_OPS_STATUS_BUDGET_EXHAUSTED]) {
      OpsStatusResponseSchema.parse(s);
    }
    for (const s of [MOCK_SYSTEM_STATUS_NORMAL, MOCK_SYSTEM_STATUS_PAUSED]) SystemStatusResponseSchema.parse(s);
    AdminUserSchema.parse(MOCK_ADMIN_USER);
    assert.ok(AdminUserSchema.parse(MOCK_ADMIN_USER_LOCKED).lockedAt);
    AdminAdjustRequestSchema.parse(MOCK_ADMIN_ADJUST_REQUEST);
    AdminTaskLookupResponseSchema.parse(MOCK_ADMIN_TASK_LOOKUP_RESPONSE);
    AdminAuditResponseSchema.parse(MOCK_ADMIN_AUDIT_RESPONSE);
  });
});
