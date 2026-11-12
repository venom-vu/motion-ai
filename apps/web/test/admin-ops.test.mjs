import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { compileScript, compileTemplate, parse } from '@vue/compiler-sfc';
import { createSSRApp } from 'vue';
import { renderToString } from '@vue/server-renderer';
import {
  MOCK_ADMIN_AUDIT_RESPONSE,
  MOCK_ADMIN_STATS_RESPONSE,
  MOCK_ADMIN_TASK_LOOKUP_RESPONSE,
  MOCK_ADMIN_USER,
  MOCK_ADMIN_USER_LEDGER_RESPONSE,
  MOCK_OPS_STATUS_BUDGET_EXHAUSTED,
  MOCK_OPS_STATUS_NORMAL,
  MOCK_OPS_STATUS_PAUSED,
} from '@flowvis/contracts';
import {
  MotionApiClientError,
  createMotionApiClient,
  resolveAdminErrorMessageVi,
} from '../utils/api-client.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(__dirname, '..');

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

function recorder(body) {
  const calls = [];
  const client = createMotionApiClient({
    baseUrl: 'http://t.example',
    fetchImpl: async (url, init) => {
      calls.push({ url: String(url), method: init?.method ?? 'GET', body: init?.body ? JSON.parse(init.body) : null });
      return json(typeof body === 'function' ? body(String(url)) : body);
    },
  });
  return { client, calls };
}

describe('Story 6.8: api-client admin ops', () => {
  it('getOpsStatus và resumeOps', async () => {
    const a = recorder(MOCK_OPS_STATUS_PAUSED);
    assert.equal((await a.client.getOpsStatus()).intakePaused, true);
    assert.equal(a.calls[0].url, 'http://t.example/admin/ops/status');
    const b = recorder(MOCK_OPS_STATUS_NORMAL);
    await b.client.resumeOps();
    assert.equal(b.calls[0].method, 'POST');
    assert.equal(b.calls[0].url, 'http://t.example/admin/ops/resume');
    assert.deepEqual(b.calls[0].body, {});
  });

  it('getAdminStats gửi giá thử làm query', async () => {
    const { client, calls } = recorder(MOCK_ADMIN_STATS_RESPONSE);
    await client.getAdminStats({
      from: '2026-11-01T00:00:00.000Z',
      to: '2026-11-11T00:00:00.000Z',
      scope: 'benchmark',
      motionPricePerSecond: 40,
      imagePrice: 90,
    });
    const u = new URL(calls[0].url);
    assert.equal(u.pathname, '/admin/stats');
    assert.equal(u.searchParams.get('scope'), 'benchmark');
    assert.equal(u.searchParams.get('motionPricePerSecond'), '40');
    assert.equal(u.searchParams.get('imagePrice'), '90');
    assert.equal(calls[0].method, 'GET');
  });

  it('tài khoản: search, ledger, lock, unlock, adjust', async () => {
    const id = MOCK_ADMIN_USER.id;
    const s = recorder(MOCK_ADMIN_USER);
    await s.client.searchAdminUser('user@example.com');
    assert.equal(s.calls[0].url, 'http://t.example/admin/users?email=user%40example.com');
    const l = recorder(MOCK_ADMIN_USER_LEDGER_RESPONSE);
    await l.client.getAdminUserLedger(id, { cursor: 'c1' });
    assert.match(l.calls[0].url, new RegExp(`/admin/users/${id}/ledger\\?pageSize=20&cursor=c1`));
    const k = recorder(MOCK_ADMIN_USER);
    await k.client.lockUser(id, { reason: 'spam' });
    await k.client.unlockUser(id, { reason: 'ok' });
    assert.match(k.calls[0].url, /\/lock$/);
    assert.match(k.calls[1].url, /\/unlock$/);
    assert.deepEqual(k.calls[0].body, { reason: 'spam' });
    await assert.rejects(() => k.client.lockUser(id, { reason: '  ' }));
    const rid = '90000000-0000-4000-8000-0000000000c1';
    const adj = recorder({ user: MOCK_ADMIN_USER, entry: MOCK_ADMIN_USER_LEDGER_RESPONSE.items[0] });
    await adj.client.adjustUser(id, { amount: 300, reason: 'bù', requestId: rid });
    assert.deepEqual(adj.calls[0].body, { amount: 300, reason: 'bù', requestId: rid });
    await assert.rejects(() => adj.client.adjustUser(id, { amount: 0, reason: 'x', requestId: rid }));
    await assert.rejects(() => adj.client.adjustUser(id, { amount: 1.5, reason: 'x', requestId: rid }));
    assert.equal(adj.calls.length, 1);
  });

  it('lookup đúng một tham số, takedown, audit', async () => {
    const t = recorder(MOCK_ADMIN_TASK_LOOKUP_RESPONSE);
    await t.client.lookupAdminTask({ taskId: MOCK_ADMIN_TASK_LOOKUP_RESPONSE.id });
    await t.client.lookupAdminTask({ shareUrl: 'https://flowvis.example/s/abc' });
    assert.match(t.calls[0].url, /\?taskId=/);
    assert.doesNotMatch(t.calls[0].url, /shareUrl/);
    assert.match(t.calls[1].url, /\?shareUrl=/);
    await assert.rejects(() => t.client.lookupAdminTask({}));
    const d = recorder({ taskId: MOCK_ADMIN_TASK_LOOKUP_RESPONSE.id, filesRemovedAt: '2026-11-11T00:00:00.000Z' });
    await d.client.takedownTask(MOCK_ADMIN_TASK_LOOKUP_RESPONSE.id, { reason: 'vi phạm' });
    assert.match(d.calls[0].url, /\/takedown$/);
    const a = recorder(MOCK_ADMIN_AUDIT_RESPONSE);
    await a.client.listAdminAudit({ action: 'ADJUST', target: 'user:1', cursor: 'z' });
    const u = new URL(a.calls[0].url);
    assert.equal(u.searchParams.get('action'), 'ADJUST');
    assert.equal(u.searchParams.get('target'), 'user:1');
    assert.equal(u.searchParams.get('cursor'), 'z');
  });

  it('thông báo tiếng Việt cho 4 details.reason mới', () => {
    const expected = {
      REASON_REQUIRED: 'Vui lòng nhập lý do.',
      TASK_NOT_FINISHED: 'Tác vụ chưa kết thúc nên chưa thể gỡ nội dung.',
      ADJUST_OVER_LIMIT: 'Số credit điều chỉnh vượt quá giới hạn cho phép.',
      ADJUST_INSUFFICIENT_BALANCE: 'Số dư tài khoản không đủ để trừ số credit này.',
    };
    for (const [reason, msg] of Object.entries(expected)) {
      const err = new MotionApiClientError({ status: 400, code: 'VALIDATION_FAILED', details: { reason } });
      assert.equal(resolveAdminErrorMessageVi(err), msg);
    }
  });

  it('lỗi server qua client mang details.reason', async () => {
    const client = createMotionApiClient({
      baseUrl: 'http://t.example',
      fetchImpl: async () => json({ code: 'VALIDATION_FAILED', message: 'x', details: { reason: 'ADJUST_OVER_LIMIT' } }, 400),
    });
    await assert.rejects(
      () => client.adjustUser(MOCK_ADMIN_USER.id, { amount: 99999999, reason: 'r', requestId: '90000000-0000-4000-8000-0000000000c1' }),
      (e) => resolveAdminErrorMessageVi(e) === 'Số credit điều chỉnh vượt quá giới hạn cho phép.',
    );
  });
});

describe('Story 6.8: composable useAdminOps', () => {
  let mod;
  let ctx;
  const ctxPath = path.join(webRoot, 'test', `.tmp-ops-ctx-${process.pid}.ts`);
  const harnessPath = path.join(webRoot, 'test', `.tmp-ops-harness-${process.pid}.ts`);

  before(async () => {
    fs.writeFileSync(
      ctxPath,
      `export let mockClient: any = {};
export function setMockClient(c: any) { mockClient = c; }
export const useApiClient = () => ({ get client() { return mockClient; } });
`,
    );
    let code = fs.readFileSync(path.join(webRoot, 'composables/useAdminOps.ts'), 'utf8');
    code = code
      .replace("from '~/composables/useApiClient'", `from './${path.basename(ctxPath)}'`)
      .replace("from '~/utils/api-client'", "from '../utils/api-client.ts'");
    fs.writeFileSync(harnessPath, code);
    ctx = await import(pathToFileURL(ctxPath).href);
    mod = await import(pathToFileURL(harnessPath).href);
  });
  after(() => {
    fs.rmSync(ctxPath, { force: true });
    fs.rmSync(harnessPath, { force: true });
  });

  it('validateAdjustForm chặn 0, 1.5, lý do rỗng', () => {
    assert.equal(mod.validateAdjustForm('0', 'x').ok, false);
    assert.equal(mod.validateAdjustForm('1.5', 'x').amountError, 'Số credit phải là số nguyên khác 0.');
    assert.equal(mod.validateAdjustForm('5', '  ').reasonError, 'Vui lòng nhập lý do.');
    assert.deepEqual(mod.validateAdjustForm('-20', ' bù '), { ok: true, amount: -20, reason: 'bù' });
  });

  it('classifyLookupInput trả đúng một tham số', () => {
    assert.deepEqual(mod.classifyLookupInput(' 70000000-0000-4000-8000-000000000003 '), { taskId: '70000000-0000-4000-8000-000000000003' });
    assert.deepEqual(mod.classifyLookupInput('https://x.example/s/1'), { shareUrl: 'https://x.example/s/1' });
    assert.equal(mod.classifyLookupInput('  '), null);
  });

  it('isStaleAt', () => {
    const now = Date.parse('2026-11-11T03:00:00.000Z');
    assert.equal(mod.isStaleAt('2026-11-11T02:55:00.000Z', 30 * 60 * 1000, now), false);
    assert.equal(mod.isStaleAt('2026-11-11T02:00:00.000Z', 30 * 60 * 1000, now), true);
    assert.equal(mod.isStaleAt(null, 1, now), false);
  });

  it('resume chỉ gọi khi có cờ; cập nhật status', async () => {
    let resumed = 0;
    ctx.setMockClient({
      getOpsStatus: async () => MOCK_OPS_STATUS_NORMAL,
      resumeOps: async () => { resumed++; return MOCK_OPS_STATUS_NORMAL; },
    });
    const o = mod.useAdminOps();
    await o.refreshStatus();
    assert.equal(o.canResume(), false);
    assert.equal(await o.resumeIntake(), false);
    assert.equal(resumed, 0);

    ctx.setMockClient({
      getOpsStatus: async () => MOCK_OPS_STATUS_BUDGET_EXHAUSTED,
      resumeOps: async () => { resumed++; return MOCK_OPS_STATUS_NORMAL; },
    });
    const o2 = mod.useAdminOps();
    await o2.refreshStatus();
    assert.equal(o2.canResume(), true);
    assert.equal(await o2.resumeIntake(), true);
    assert.equal(resumed, 1);
    assert.equal(o2.status.value.intakePaused, false);
  });

  it('adjust dùng lại requestId khi bấm lại sau lỗi, sinh mới sau thành công', async () => {
    const ids = [];
    let fail = true;
    ctx.setMockClient({
      searchAdminUser: async () => MOCK_ADMIN_USER,
      getAdminUserLedger: async () => MOCK_ADMIN_USER_LEDGER_RESPONSE,
      adjustUser: async (_id, req) => {
        ids.push(req.requestId);
        if (fail) throw new MotionApiClientError({ status: 400, code: 'VALIDATION_FAILED', details: { reason: 'ADJUST_OVER_LIMIT' } });
        return { user: { ...MOCK_ADMIN_USER, balance: 4500 }, entry: MOCK_ADMIN_USER_LEDGER_RESPONSE.items[0] };
      },
    });
    const o = mod.useAdminOps();
    await o.searchUser('user@example.com');
    const rid = o.openAdjustForm();
    assert.equal(await o.adjustUser(300, 'bù'), false);
    assert.equal(o.userActionErrorVi.value, 'Số credit điều chỉnh vượt quá giới hạn cho phép.');
    fail = false;
    assert.equal(await o.adjustUser(300, 'bù'), true);
    assert.deepEqual(ids, [rid, rid]);
    assert.equal(o.user.value.balance, 4500);
    assert.equal(o.adjustRequestId.value, null);
  });

  it('adjust chống gửi chồng khi đang gửi', async () => {
    let calls = 0;
    let release;
    ctx.setMockClient({
      searchAdminUser: async () => MOCK_ADMIN_USER,
      getAdminUserLedger: async () => MOCK_ADMIN_USER_LEDGER_RESPONSE,
      adjustUser: () => { calls++; return new Promise((r) => { release = () => r({ user: MOCK_ADMIN_USER, entry: MOCK_ADMIN_USER_LEDGER_RESPONSE.items[0] }); }); },
    });
    const o = mod.useAdminOps();
    await o.searchUser('a@b.c');
    o.openAdjustForm();
    const p1 = o.adjustUser(5, 'x');
    const second = await o.adjustUser(5, 'x');
    assert.equal(second, false);
    release();
    await p1;
    assert.equal(calls, 1);
  });

  it('lock/takedown bắt buộc lý do và takedown chặn Task chưa kết thúc', async () => {
    let locks = 0;
    let takedowns = 0;
    ctx.setMockClient({
      searchAdminUser: async () => MOCK_ADMIN_USER,
      getAdminUserLedger: async () => MOCK_ADMIN_USER_LEDGER_RESPONSE,
      lockUser: async () => { locks++; return { ...MOCK_ADMIN_USER, lockedAt: '2026-11-11T00:00:00.000Z' }; },
      lookupAdminTask: async () => ({ ...MOCK_ADMIN_TASK_LOOKUP_RESPONSE, status: 'running' }),
      takedownTask: async () => { takedowns++; return { taskId: MOCK_ADMIN_TASK_LOOKUP_RESPONSE.id, filesRemovedAt: '2026-11-11T00:00:00.000Z' }; },
    });
    const o = mod.useAdminOps();
    await o.searchUser('a@b.c');
    assert.equal(await o.lockUser('  '), false);
    assert.equal(locks, 0);
    assert.equal(await o.lockUser('spam'), true);
    assert.ok(o.user.value.lockedAt);
    await o.lookupTask(MOCK_ADMIN_TASK_LOOKUP_RESPONSE.id);
    assert.equal(await o.takedown('vi phạm'), false);
    assert.equal(takedowns, 0);
  });

  it('adjust: sửa amount/reason sau lỗi thì sinh requestId mới, y hệt thì dùng lại', async () => {
    const ids = [];
    ctx.setMockClient({
      searchAdminUser: async () => MOCK_ADMIN_USER,
      getAdminUserLedger: async () => MOCK_ADMIN_USER_LEDGER_RESPONSE,
      adjustUser: async (_id, req) => {
        ids.push(req.requestId);
        throw new MotionApiClientError({ status: 400, code: 'VALIDATION_FAILED', details: { reason: 'ADJUST_OVER_LIMIT' } });
      },
    });
    const o = mod.useAdminOps();
    await o.searchUser('a@b.c');
    o.openAdjustForm();
    await o.adjustUser(10, 'a');
    await o.adjustUser(10, 'a');
    await o.adjustUser(20, 'a');
    await o.adjustUser(20, 'b');
    assert.equal(ids[0], ids[1]);
    assert.notEqual(ids[2], ids[1]);
    assert.notEqual(ids[3], ids[2]);
  });

  it('ledger lỗi khi tìm tài khoản vẫn giữ user và báo tiếng Việt', async () => {
    ctx.setMockClient({
      searchAdminUser: async () => MOCK_ADMIN_USER,
      getAdminUserLedger: async () => { throw new MotionApiClientError({ status: 500, code: 'INTERNAL_ERROR' }); },
    });
    const o = mod.useAdminOps();
    await o.searchUser('a@b.c');
    assert.equal(o.user.value.id, MOCK_ADMIN_USER.id);
    assert.equal(o.userErrorVi.value, null);
    assert.match(o.userActionErrorVi.value, /sổ cái/);
  });

  it('kết quả muộn của user/task cũ không ghi đè user/task mới', async () => {
    const other = { ...MOCK_ADMIN_USER, id: '90000000-0000-4000-8000-000000000002', email: 'o@example.com' };
    let release;
    let who = MOCK_ADMIN_USER;
    ctx.setMockClient({
      searchAdminUser: async () => who,
      getAdminUserLedger: async () => MOCK_ADMIN_USER_LEDGER_RESPONSE,
      lockUser: () => new Promise((r) => { release = () => r({ ...MOCK_ADMIN_USER, lockedAt: '2026-11-11T00:00:00.000Z' }); }),
      lookupAdminTask: async () => MOCK_ADMIN_TASK_LOOKUP_RESPONSE,
      takedownTask: () => new Promise((r) => { release = () => r({ taskId: MOCK_ADMIN_TASK_LOOKUP_RESPONSE.id, filesRemovedAt: '2026-11-11T00:00:00.000Z' }); }),
    });
    const o = mod.useAdminOps();
    await o.searchUser('a@b.c');
    const p = o.lockUser('spam');
    who = other;
    await o.searchUser('o@example.com');
    release();
    await p;
    assert.equal(o.user.value.id, other.id);
    assert.equal(o.user.value.lockedAt, null);

    await o.lookupTask(MOCK_ADMIN_TASK_LOOKUP_RESPONSE.id);
    const t = o.takedown('vi phạm');
    o.task.value = { ...MOCK_ADMIN_TASK_LOOKUP_RESPONSE, id: '70000000-0000-4000-8000-0000000000ff' };
    release();
    await t;
    assert.equal(o.task.value.filesRemovedAt, null);
  });

  it('resume khi không có cờ đặt thông báo tiếng Việt và không gọi API; poll cũ không ghi đè sau resume', async () => {
    let resumed = 0;
    let releasePoll;
    ctx.setMockClient({
      getOpsStatus: async () => MOCK_OPS_STATUS_NORMAL,
      resumeOps: async () => { resumed++; return MOCK_OPS_STATUS_NORMAL; },
    });
    const o = mod.useAdminOps();
    await o.refreshStatus();
    assert.equal(await o.resumeIntake(), false);
    assert.equal(o.resumeErrorVi.value, 'Hệ thống đang nhận Task bình thường.');
    assert.equal(resumed, 0);

    ctx.setMockClient({
      getOpsStatus: () => new Promise((r) => { releasePoll = () => r(MOCK_OPS_STATUS_PAUSED); }),
      resumeOps: async () => { resumed++; return MOCK_OPS_STATUS_NORMAL; },
    });
    const o2 = mod.useAdminOps();
    o2.status.value = MOCK_OPS_STATUS_PAUSED;
    const poll = o2.refreshStatus();
    assert.equal(await o2.resumeIntake(), true);
    releasePoll();
    await poll;
    assert.equal(o2.status.value.intakePaused, false);
  });

  it('loadMoreLedger bỏ kết quả khi user đã đổi', async () => {
    const other = { ...MOCK_ADMIN_USER, id: '90000000-0000-4000-8000-000000000002' };
    let who = MOCK_ADMIN_USER;
    let release;
    ctx.setMockClient({
      searchAdminUser: async () => who,
      getAdminUserLedger: (_id, q) => q?.cursor
        ? new Promise((r) => { release = () => r(MOCK_ADMIN_USER_LEDGER_RESPONSE); })
        : Promise.resolve({ ...MOCK_ADMIN_USER_LEDGER_RESPONSE, hasMore: true, nextCursor: 'c' }),
    });
    const o = mod.useAdminOps();
    await o.searchUser('a@b.c');
    const p = o.loadMoreLedger();
    who = other;
    await o.searchUser('o@example.com');
    const before = o.ledger.value.length;
    release();
    await p;
    assert.equal(o.ledger.value.length, before);
  });

  it('lookupTask báo lỗi tiếng Việt khi không tìm thấy', async () => {
    ctx.setMockClient({
      lookupAdminTask: async () => { throw new MotionApiClientError({ status: 404, code: 'NOT_FOUND' }); },
    });
    const o = mod.useAdminOps();
    await o.lookupTask('https://x.example/s/1');
    assert.ok(o.taskErrorVi.value);
    assert.equal(o.task.value, null);
  });

  it('unlockUser gọi client.unlockUser và cập nhật user', async () => {
    const unlocked = { ...MOCK_ADMIN_USER, lockedAt: null };
    const seen = [];
    ctx.setMockClient({
      searchAdminUser: async () => ({ ...MOCK_ADMIN_USER, lockedAt: '2026-11-10T09:00:00.000Z' }),
      getAdminUserLedger: async () => MOCK_ADMIN_USER_LEDGER_RESPONSE,
      lockUser: async () => { seen.push('lock'); return MOCK_ADMIN_USER; },
      unlockUser: async (_id, body) => { seen.push(['unlock', body.reason]); return unlocked; },
    });
    const o = mod.useAdminOps();
    await o.searchUser('a@b.c');
    assert.equal(await o.unlockUser(' xong '), true);
    assert.deepEqual(seen, [['unlock', 'xong']]);
    assert.equal(o.user.value.lockedAt, null);
  });

  it('takedown thành công cập nhật task.filesRemovedAt', async () => {
    const at = '2026-11-11T00:00:00.000Z';
    ctx.setMockClient({
      lookupAdminTask: async () => MOCK_ADMIN_TASK_LOOKUP_RESPONSE,
      takedownTask: async () => ({ taskId: MOCK_ADMIN_TASK_LOOKUP_RESPONSE.id, filesRemovedAt: at }),
    });
    const o = mod.useAdminOps();
    await o.lookupTask(MOCK_ADMIN_TASK_LOOKUP_RESPONSE.id);
    assert.equal(await o.takedown('vi phạm'), true);
    assert.equal(o.task.value.filesRemovedAt, at);
  });

  it('loadMoreLedger nối trang kế', async () => {
    const second = { ...MOCK_ADMIN_USER_LEDGER_RESPONSE.items[0], id: '90000000-0000-4000-8000-000000000012' };
    ctx.setMockClient({
      searchAdminUser: async () => MOCK_ADMIN_USER,
      getAdminUserLedger: async (_id, q) => q?.cursor
        ? { items: [second], pageSize: 20, hasMore: false, nextCursor: null }
        : { ...MOCK_ADMIN_USER_LEDGER_RESPONSE, hasMore: true, nextCursor: 'c' },
    });
    const o = mod.useAdminOps();
    await o.searchUser('a@b.c');
    await o.loadMoreLedger();
    assert.equal(o.ledger.value.length, 2);
    assert.equal(o.ledgerHasMore.value, false);
  });

  it('fetchStats lưu kết quả và báo lỗi tiếng Việt', async () => {
    let fail = false;
    ctx.setMockClient({
      getAdminStats: async () => {
        if (fail) throw new MotionApiClientError({ status: 500, code: 'INTERNAL_ERROR' });
        return MOCK_ADMIN_STATS_RESPONSE;
      },
    });
    const o = mod.useAdminOps();
    const q = { from: MOCK_ADMIN_STATS_RESPONSE.from, to: MOCK_ADMIN_STATS_RESPONSE.to, scope: 'real' };
    await o.fetchStats(q);
    assert.equal(o.stats.value.scope, 'real');
    fail = true;
    await o.fetchStats(q);
    assert.ok(o.statsErrorVi.value);
  });

  it('nhật ký: phản hồi cũ đến sau bị bỏ', async () => {
    const e = MOCK_ADMIN_AUDIT_RESPONSE.items[0];
    const releases = [];
    ctx.setMockClient({
      listAdminAudit: () => new Promise((r) => releases.push(r)),
    });
    const o = mod.useAdminOps();
    const p1 = o.fetchAudit(true);
    const p2 = o.fetchAudit(true);
    releases[1]({ items: [e], pageSize: 20, hasMore: false, nextCursor: null });
    await p2;
    releases[0]({ items: [{ ...e, id: '90000000-0000-4000-8000-000000000099' }], pageSize: 20, hasMore: false, nextCursor: null });
    await p1;
    assert.equal(o.auditItems.value.length, 1);
    assert.ok(o.auditItems.value.every((x) => x.id !== '90000000-0000-4000-8000-000000000099'));
  });

  it('audit lọc và tải thêm theo cursor', async () => {
    const queries = [];
    ctx.setMockClient({
      listAdminAudit: async (q) => {
        queries.push(q);
        return q.cursor
          ? { items: [{ ...MOCK_ADMIN_AUDIT_RESPONSE.items[0], id: '90000000-0000-4000-8000-000000000022' }], pageSize: 20, hasMore: false, nextCursor: null }
          : { ...MOCK_ADMIN_AUDIT_RESPONSE, hasMore: true, nextCursor: 'n1' };
      },
    });
    const o = mod.useAdminOps();
    o.auditAction.value = 'ADJUST';
    await o.fetchAudit(true);
    await o.fetchAudit(false);
    assert.equal(queries[0].action, 'ADJUST');
    assert.equal(queries[1].cursor, 'n1');
    assert.equal(o.auditItems.value.length, 2);
    assert.equal(o.auditHasMore.value, false);
  });
});

describe('Story 6.8: trang /admin/ops (SSR)', () => {
  const raw = fs.readFileSync(path.join(webRoot, 'pages/admin/ops.vue'), 'utf8');

  async function render(setupData) {
    const { descriptor } = parse(raw);
    const compiled = compileTemplate({
      id: `ops-${Date.now()}`,
      filename: 'pages/admin/ops.vue',
      source: descriptor.template.content,
      ssr: true,
    });
    assert.equal(compiled.errors.length, 0, compiled.errors.join('; '));
    const tmp = path.join(webRoot, 'test', `.tmp-ops-page-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`);
    fs.writeFileSync(tmp, compiled.code);
    try {
      const { ssrRender } = await import(pathToFileURL(tmp).href);
      const noop = () => {};
      const app = createSSRApp({
        ssrRender,
        setup() {
          return {
            isMePending: false, isAdmin: true, openAuthDialog: noop, btn: '', input: '', card: '',
            status: null, statusErrorVi: null, isStatusLoading: false, isResuming: false, canResume: false,
            balanceStale: false, backupStale: false, notificationVi: null,
            stats: null, isStatsLoading: false, statsErrorVi: null, statsFormErrorVi: null,
            statsFrom: '', statsTo: '', statsScope: 'real', trialMotionPrice: '', trialImagePrice: '',
            user: null, ledger: [], ledgerHasMore: false, userErrorVi: null, isUserLoading: false,
            isUserActionLoading: false, emailQuery: '', userReason: '', userReasonErrorVi: null,
            adjustFormOpen: false, adjustAmount: '', adjustReason: '', adjustAmountErrorVi: null, adjustReasonErrorVi: null,
            task: null, taskErrorVi: null, isTaskLoading: false, isTakedownLoading: false, lookupInput: '',
            takedownReason: '', takedownReasonErrorVi: null, taskFinished: true, canTakedown: true,
            auditItems: [], auditAction: '', auditTarget: '', auditHasMore: false, isAuditLoading: false,
            isAuditLoadingMore: false, auditErrorVi: null, confirmKind: null, confirmErrorVi: null,
            pendingAdjust: null, adjustBalanceAfter: null, isBusy: false,
            ops: { refreshStatus: noop, fetchAudit: noop, lookupTask: noop, loadMoreLedger: noop },
            submitStats: noop, submitSearch: noop, openAdjustForm: noop, requestAdjust: noop,
            requestLockToggle: noop, requestTakedown: noop, closeConfirm: noop, runConfirm: noop,
            formatNumberVi: String, formatVndVi: String, formatTopupTimestampVi: String,
            pct: String, secs: String,
            ...setupData,
          };
        },
      });
      app.component('Icon', { props: ['name'], ssrRender(_c, push) { push('<span></span>'); } });
      app.component('NuxtLink', { props: ['to'], ssrRender(c, push, _p, _a, _s, slots) { push(`<a href="${c.to}">`); slots.default?.(); push('</a>'); } });
      return await renderToString(app);
    } finally {
      fs.rmSync(tmp, { force: true });
    }
  }

  it('non-admin thấy 403 và không lộ dữ liệu', async () => {
    const html = await render({ isAdmin: false, status: MOCK_OPS_STATUS_PAUSED });
    assert.match(html, /data-testid="admin-forbidden-state"/);
    assert.match(html, /403/);
    assert.doesNotMatch(html, /ops-status-section/);
    assert.doesNotMatch(html, /ERROR_RATE/);
  });

  it('tạm dừng: thẻ hiển thị và nút mở lại bật', async () => {
    const html = await render({ status: MOCK_OPS_STATUS_PAUSED, canResume: true });
    assert.match(html, /Đang tạm dừng/);
    assert.match(html, /ERROR_RATE_15_PERCENT/);
    assert.doesNotMatch(html, /data-testid="ops-resume-button"[^>]*disabled/);
  });

  it('hết ngân sách + dữ liệu cũ có nhãn cảnh báo', async () => {
    const html = await render({ status: MOCK_OPS_STATUS_BUDGET_EXHAUSTED, canResume: true, balanceStale: true, backupStale: true });
    assert.match(html, /Đã hết ngân sách/);
    assert.match(html, /ops-balance-stale/);
    assert.match(html, /ops-backup-stale/);
  });

  it('bình thường: nút mở lại bị vô hiệu', async () => {
    const html = await render({ status: MOCK_OPS_STATUS_NORMAL, canResume: false });
    assert.match(html, /data-testid="ops-resume-button"[^>]*disabled/);
  });

  it('Task đang chạy: nút gỡ vô hiệu kèm giải thích; có dòng token chia sẻ', async () => {
    const html = await render({
      task: { ...MOCK_ADMIN_TASK_LOOKUP_RESPONSE, status: 'running' },
      taskFinished: false,
      canTakedown: false,
    });
    assert.match(html, /data-testid="ops-takedown-button"[^>]*disabled/);
    assert.match(html, /ops-takedown-unfinished/);
    assert.match(html, /Token chia sẻ sẽ bị thu hồi khi gỡ/);
    const removed = await render({
      task: { ...MOCK_ADMIN_TASK_LOOKUP_RESPONSE, filesRemovedAt: '2026-11-11T00:00:00.000Z' },
      canTakedown: false,
    });
    assert.doesNotMatch(removed, /Token chia sẻ sẽ bị thu hồi khi gỡ/);
  });

  it('hộp xác nhận mở lại nêu rủi ro và số dư lần đọc cuối', async () => {
    const html = await render({ status: MOCK_OPS_STATUS_BUDGET_EXHAUSTED, confirmKind: 'resume' });
    assert.match(html, /thất bại nhanh/);
    assert.match(html, /Số dư RunningHub lần đọc cuối/);
  });

  it('hộp xác nhận khóa nêu email tài khoản', async () => {
    const html = await render({ user: MOCK_ADMIN_USER, confirmKind: 'lock', userReason: 'spam' });
    assert.match(html, /Tài khoản: user@example\.com/);
  });

  it('hộp xác nhận bù credit nêu số dư trước và sau', async () => {
    const html = await render({
      user: MOCK_ADMIN_USER,
      confirmKind: 'adjust',
      pendingAdjust: { amount: 300, reason: 'bù' },
      adjustBalanceAfter: 4500,
    });
    assert.match(html, /Số dư trước: 4200/);
    assert.match(html, /số dư sau: 4500/);
  });
});

describe('Story 6.8: audit load-more dùng bộ lọc đã áp dụng', () => {
  it('đổi ô lọc sau lần tải đầu không ảnh hưởng tải thêm', async () => {
    const ctxPath = path.join(webRoot, 'test', `.tmp-ops-ctx2-${process.pid}.ts`);
    const hPath = path.join(webRoot, 'test', `.tmp-ops-h2-${process.pid}.ts`);
    fs.writeFileSync(ctxPath, `export let c: any = {}; export function setC(x: any) { c = x; }
export const useApiClient = () => ({ get client() { return c; } });`);
    fs.writeFileSync(
      hPath,
      fs
        .readFileSync(path.join(webRoot, 'composables/useAdminOps.ts'), 'utf8')
        .replace("from '~/composables/useApiClient'", `from './${path.basename(ctxPath)}'`)
        .replace("from '~/utils/api-client'", "from '../utils/api-client.ts'"),
    );
    try {
      const c = await import(pathToFileURL(ctxPath).href);
      const m = await import(pathToFileURL(hPath).href);
      const qs = [];
      c.setC({
        listAdminAudit: async (q) => {
          qs.push(q);
          return { ...MOCK_ADMIN_AUDIT_RESPONSE, hasMore: true, nextCursor: 'n1' };
        },
      });
      const o = m.useAdminOps();
      o.auditAction.value = 'ADJUST';
      o.auditTarget.value = 'user:1';
      await o.fetchAudit(true);
      o.auditAction.value = 'LOCK';
      o.auditTarget.value = 'x';
      await o.fetchAudit(false);
      assert.equal(qs[1].cursor, 'n1');
      assert.equal(qs[1].action, 'ADJUST');
      assert.equal(qs[1].target, 'user:1');
    } finally {
      fs.rmSync(ctxPath, { force: true });
      fs.rmSync(hPath, { force: true });
    }
  });
});

describe('Story 6.8: script setup thật của pages/admin/ops.vue', () => {
  const pageSource = fs.readFileSync(path.join(webRoot, 'pages/admin/ops.vue'), 'utf8');
  let dir;
  let setupFn;
  const origSetInterval = globalThis.setInterval;

  const calls = () => globalThis.__ops.calls;
  const fresh = (opts = {}) => {
    globalThis.__ops = { calls: [], role: 'admin', result: true, ...opts };
    return setupFn({}, { expose() {} });
  };

  before(async () => {
    globalThis.setInterval = (...a) => {
      const t = origSetInterval(...a);
      t.unref?.();
      return t;
    };
    dir = fs.mkdtempSync(path.join(webRoot, 'test', '.tmp-ops-page-'));
    const w = (name, code) => fs.writeFileSync(path.join(dir, name), code, 'utf8');
    w('imports.mjs', `import { ref } from 'vue';
export const definePageMeta = () => {};
export const useAsyncData = () => ({ status: ref('success'), pending: ref(false), data: ref({ role: globalThis.__ops.role }) });`);
    w('vue-stub.mjs', `export * from 'vue'; export const onMounted = (fn) => fn(); export const onBeforeUnmount = () => {};`);
    w('use-api-client.mjs', `export const ME_KEY = 'me'; export const useApiClient = () => ({ client: {} });`);
    w('use-auth-dialog.mjs', `export const useAuthDialog = () => ({ open() {} });`);
    w('catalog.mjs', `export const formatNumberVi = String; export const formatVndVi = String;`);
    w('topup-utils.mjs', `export const formatTopupTimestampVi = String;`);
    w('use-admin-ops.mjs', `import { ref } from 'vue';
export const BACKUP_STALE_MS = 1; export const RH_BALANCE_STALE_MS = 1;
export const isStaleAt = () => false;
export const isTaskFinished = (s) => s !== 'queued' && s !== 'running';
export const validateAdjustForm = (a, r) => ({ ok: true, amount: Number(a), reason: r.trim() });
const rec = (name, ret) => async (...args) => { globalThis.__ops.calls.push([name, ...args]); return ret === undefined ? globalThis.__ops.result : ret; };
export const useAdminOps = () => {
  const o = globalThis.__ops;
  const names = ['statusErrorVi','isStatusLoading','isResuming','resumeErrorVi','stats','isStatsLoading','statsErrorVi','ledger','ledgerHasMore','userErrorVi','isUserLoading','isUserActionLoading','userActionErrorVi','taskErrorVi','isTaskLoading','isTakedownLoading','takedownErrorVi','auditItems','auditAction','auditTarget','auditHasMore','isAuditLoading','isAuditLoadingMore','auditErrorVi'];
  const r = Object.fromEntries(names.map((n) => [n, ref(n === 'ledger' || n === 'auditItems' ? [] : (n.startsWith('is') || n.endsWith('HasMore')) ? false : (n === 'stats' ? null : null))]));
  return {
    ...r,
    status: ref(o.status ?? null), user: ref(o.user ?? { id: 'u1', email: 'a@b.c', balance: 100 }), task: ref(o.task ?? null),
    refreshStatus: rec('refreshStatus', undefined), startStatusPolling: () => o.calls.push(['startStatusPolling']), stopStatusPolling() {},
    fetchStats: rec('fetchStats', undefined), fetchAudit: rec('fetchAudit', undefined),
    resumeIntake: rec('resumeIntake'), adjustUser: rec('adjustUser'), lockUser: rec('lockUser'), unlockUser: rec('unlockUser'), takedown: rec('takedown'),
    openAdjustForm: () => o.calls.push(['openAdjustForm']), searchUser: rec('searchUser', undefined), lookupTask: rec('lookupTask', undefined), loadMoreLedger: rec('loadMoreLedger', undefined),
  };
};`);
    const { descriptor } = parse(pageSource);
    let code = compileScript(descriptor, { id: 'ops-page-test' }).content;
    const map = {
      vue: 'vue-stub.mjs',
      '#imports': 'imports.mjs',
      '~/composables/useApiClient': 'use-api-client.mjs',
      '~/composables/useAdminOps': 'use-admin-ops.mjs',
      '~/composables/useAuthDialog': 'use-auth-dialog.mjs',
      '~/utils/catalog': 'catalog.mjs',
      '~/utils/topup': 'topup-utils.mjs',
    };
    for (const [spec, file] of Object.entries(map)) {
      const prev = code;
      code = code.split(`'${spec}'`).join(JSON.stringify(pathToFileURL(path.join(dir, file)).href));
      assert.notEqual(code, prev, `import ${spec} phải được thay`);
    }
    const tmp = path.join(webRoot, 'test', `.tmp-ops-page-${process.pid}.ts`);
    fs.writeFileSync(tmp, code, 'utf8');
    try {
      setupFn = (await import(pathToFileURL(tmp).href)).default.setup;
    } finally {
      fs.rmSync(tmp, { force: true });
    }
  });

  after(() => {
    globalThis.setInterval = origSetInterval;
    fs.rmSync(dir, { recursive: true, force: true });
    delete globalThis.__ops;
  });

  const names = (c) => c.map((x) => x[0]);

  it('non-admin: start() không chạy, không gọi API ops nào', () => {
    const s = fresh({ role: 'user' });
    assert.equal(s.isAdmin.value, false);
    assert.deepEqual(calls(), []);
  });

  it('admin: start() gọi refreshStatus, fetchStats và fetchAudit', () => {
    fresh();
    const n = names(calls());
    for (const x of ['refreshStatus', 'startStatusPolling', 'fetchStats', 'fetchAudit']) {
      assert.ok(n.includes(x), `thiếu ${x}`);
    }
  });

  it('resume: xác nhận gọi resumeIntake, đóng hộp, tải lại nhật ký', async () => {
    const s = fresh();
    globalThis.__ops.calls.length = 0;
    s.confirmKind.value = 'resume';
    await s.runConfirm();
    assert.deepEqual(names(calls()), ['resumeIntake', 'fetchAudit']);
    assert.equal(s.confirmKind.value, null);
  });

  it('adjust: gọi adjustUser(amount, reason), đóng form, tải lại nhật ký', async () => {
    const s = fresh();
    globalThis.__ops.calls.length = 0;
    s.pendingAdjust.value = { amount: -20, reason: 'bù' };
    s.confirmKind.value = 'adjust';
    await s.runConfirm();
    assert.deepEqual(calls(), [['adjustUser', -20, 'bù'], ['fetchAudit', true]]);
    assert.equal(s.adjustFormOpen.value, false);
  });

  it('lock / unlock / takedown gọi đúng hàm với lý do và tải lại nhật ký', async () => {
    for (const [kind, ref_, fn] of [
      ['lock', 'userReason', 'lockUser'],
      ['unlock', 'userReason', 'unlockUser'],
      ['takedown', 'takedownReason', 'takedown'],
    ]) {
      const s = fresh();
      globalThis.__ops.calls.length = 0;
      s[ref_].value = 'vi phạm';
      s.confirmKind.value = kind;
      await s.runConfirm();
      assert.deepEqual(calls(), [[fn, 'vi phạm'], ['fetchAudit', true]], kind);
      assert.equal(s.confirmKind.value, null);
    }
  });

  it('thao tác thất bại: giữ hộp xác nhận, không tải lại nhật ký', async () => {
    const s = fresh({ result: false });
    globalThis.__ops.calls.length = 0;
    s.userReason.value = 'x';
    s.confirmKind.value = 'lock';
    await s.runConfirm();
    assert.deepEqual(names(calls()), ['lockUser']);
    assert.equal(s.confirmKind.value, 'lock');
  });

  it('lock/unlock/takedown thiếu lý do không mở hộp xác nhận', () => {
    const s = fresh();
    s.requestLockToggle('lock');
    assert.equal(s.confirmKind.value, null);
    assert.ok(s.userReasonErrorVi.value);
  });
});
