import assert from 'node:assert/strict';
import { existsSync, readdirSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { BackupService, BACKUP_KEEP, BACKUP_KEY_RE, backupKey } from '../dist/modules/ops/backup.service.js';
import { pgConnectionFromUrl } from '../dist/modules/ops/backup-pg.js';

const SECRET = 'S3cr3tP@ss';
// DATABASE_URL thật, lấy trước khi beforeEach ghi đè bằng URL giả (dùng cho test tích hợp pg_dump).
const REAL_DATABASE_URL = process.env.DATABASE_URL;
const URL_ = `postgresql://u:${SECRET}@db:5432/flowvis?schema=public`;

function makeSettings() {
  const s = { last: null, okAt: null, stale: { alerted: false, watchSince: null } };
  return {
    s,
    saveLastBackup: async (r) => { s.last = r; if (r.result === 'success') s.okAt = r.at; },
    getLastBackupSuccessAt: async () => (s.okAt ? new Date(s.okAt) : null),
    getBackupStaleState: async () => ({ ...s.stale }),
    setBackupStaleState: async (v) => { s.stale = { ...v }; },
  };
}
function makeAlerts() {
  const seen = new Set();
  const events = [];
  return { events, raise: async (k, e) => { if (seen.has(k)) return false; seen.add(k); events.push(e); return true; } };
}
function makeStorage(initial = []) {
  const objs = new Map(initial.map((k) => [k, 3]));
  const st = {
    objs, puts: [], deleted: [], failPut: false, headSize: null,
    putObject: async (k, b) => { if (st.failPut) throw new Error(`boom ${SECRET}`); objs.set(k, b.length); st.puts.push(k); return '"e"'; },
    head: async (k) => (objs.has(k) ? { sizeBytes: st.headSize ?? objs.get(k), etag: 'e' } : null),
    list: async (p) => [...objs].filter(([k]) => k.startsWith(p)).map(([key, sizeBytes]) => ({ key, sizeBytes })),
    delete: async (k) => { objs.delete(k); st.deleted.push(k); },
  };
  return st;
}
function okRunner(calls, { dumpFail = false, verifyFail = false, empty = false } = {}) {
  return async (file, args, env) => {
    calls.push({ file, args, env });
    if (file === 'pg_dump') {
      if (dumpFail) throw new Error(`pg_dump failed ${SECRET} ${URL_}`);
      await writeFile(args.find((a) => a.startsWith('--file=')).slice(7), empty ? '' : 'DUMPDATA');
    } else if (verifyFail) throw new Error('bad');
  };
}
const tmpDirs = () => readdirSync(tmpdir()).filter((n) => n.startsWith('flowvis-backup-'));

describe('Story 6.7: sao lưu PostgreSQL', () => {
  let prevUrl, prevRole, before;
  beforeEach(() => { prevUrl = process.env.DATABASE_URL; prevRole = process.env.MOTION_PROCESS_ROLE; process.env.DATABASE_URL = URL_; before = tmpDirs().length; });
  afterEach(() => { process.env.DATABASE_URL = prevUrl; if (prevRole === undefined) delete process.env.MOTION_PROCESS_ROLE; else process.env.MOTION_PROCESS_ROLE = prevRole; });

  it('thành công: giữ 7 bản, xóa dư, last_backup success, dọn thư mục tạm', async () => {
    const old = Array.from({ length: 9 }, (_, i) => `db-backup/2026010${i + 1}T030000Z.dump`);
    const st = makeStorage(old); const set = makeSettings(); const al = makeAlerts(); const calls = [];
    const svc = new BackupService(set, al, st, okRunner(calls));
    const r = await svc.backup(new Date('2026-11-11T20:00:00Z'));
    assert.equal(r.ok, true);
    assert.equal(st.objs.size, BACKUP_KEEP);
    assert.ok(st.objs.has(r.key));
    assert.deepEqual(st.deleted.sort(), old.slice(0, 3));
    assert.equal(set.s.last.result, 'success');
    assert.equal(set.s.last.sizeBytes, 8);
    assert.equal(al.events.length, 0);
    assert.equal(tmpDirs().length, before);
    const dump = calls.find((c) => c.file === 'pg_dump');
    assert.ok(dump.args.every((a) => !a.includes(SECRET)));
    assert.equal(dump.env.PGPASSWORD, SECRET);
    assert.equal(dump.env.DATABASE_URL, undefined);
  });

  for (const [name, runnerOpts, mut, step] of [
    ['pg_dump lỗi', { dumpFail: true }, null, 'dump'],
    ['dump rỗng', { empty: true }, null, 'verify'],
    ['pg_restore --list lỗi', { verifyFail: true }, null, 'verify'],
    ['upload lỗi', {}, (st) => { st.failPut = true; }, 'upload'],
    ['HEAD lệch size', {}, (st) => { st.headSize = 999; }, 'confirm'],
  ]) {
    it(`${name}: không xóa bản cũ, một cảnh báo bước ${step}, không lộ bí mật`, async () => {
      const old = ['db-backup/20260101T030000Z.dump'];
      const st = makeStorage(old); mut?.(st);
      const set = makeSettings(); const al = makeAlerts();
      const svc = new BackupService(set, al, st, okRunner([], runnerOpts));
      const r = await svc.backup(new Date());
      assert.equal(r.ok, false);
      assert.equal(r.step, step);
      assert.deepEqual(st.deleted, []);
      assert.ok(st.objs.has(old[0]));
      assert.equal(set.s.last.result, 'failed');
      assert.equal(set.s.last.sizeBytes, null);
      assert.equal(al.events.length, 1);
      const text = JSON.stringify(al.events[0]);
      assert.ok(text.includes(step));
      assert.ok(!text.includes(SECRET) && !text.includes('postgresql://'));
      assert.equal(tmpDirs().length, before);
    });
  }

  it('retention lỗi: last_backup vẫn success, mốc success tiến, một cảnh báo retention, không xóa bản nào', async () => {
    const st = makeStorage(Array.from({ length: 8 }, (_, i) => `db-backup/2026010${i + 1}T030000Z.dump`));
    st.delete = async () => { throw new Error('x'); };
    const set = makeSettings(); const al = makeAlerts();
    const svc = new BackupService(set, al, st, okRunner([]));
    const r = await svc.backup(new Date('2026-11-11T00:00:00Z'));
    assert.equal(r.ok, true);
    assert.equal(st.puts.length, 1);
    assert.ok(st.objs.has(st.puts[0]));
    assert.equal(set.s.last.result, 'success');
    assert.equal(set.s.last.sizeBytes, 8);
    assert.equal(set.s.okAt, '2026-11-11T00:00:00.000Z');
    assert.equal(al.events.length, 1);
    assert.equal(al.events[0].data.step, 'retention');
    assert.equal(st.objs.size, 9);
  });

  it('khóa lạ (manual.dump, ngày tương lai) không được đếm hay xóa; hợp lệ cũ nhất bị xóa', async () => {
    const valid = Array.from({ length: 7 }, (_, i) => `db-backup/2026010${i + 1}T030000Z.dump`);
    const stray = ['db-backup/manual.dump', 'db-backup/zzzz.dump'];
    const st = makeStorage([...valid, ...stray]);
    const svc = new BackupService(makeSettings(), makeAlerts(), st, okRunner([]));
    const r = await svc.backup(new Date('2026-11-11T00:00:00Z'));
    assert.equal(r.ok, true);
    assert.deepEqual(st.deleted, [valid[0]]);
    for (const k of stray) assert.ok(st.objs.has(k));
  });

  it('BACKUP_KEY_RE chỉ khớp khóa do backupKey sinh ra', () => {
    assert.ok(BACKUP_KEY_RE.test(backupKey(new Date('2026-11-11T03:00:00Z'))));
    assert.ok(!BACKUP_KEY_RE.test('db-backup/manual.dump'));
  });

  it('không chạy ngoài worker', async () => {
    process.env.MOTION_PROCESS_ROLE = 'api';
    const calls = []; const svc = new BackupService(makeSettings(), makeAlerts(), makeStorage(), okRunner(calls));
    await svc.scheduledBackup(); await svc.scheduledStaleCheck();
    assert.equal(calls.length, 0);
  });

  it('cờ chống chạy chồng', async () => {
    let release; const gate = new Promise((r) => { release = r; });
    const calls = [];
    const inner = okRunner(calls);
    const svc = new BackupService(makeSettings(), makeAlerts(), makeStorage(), async (f, a, e) => { await gate; return inner(f, a, e); });
    const p = svc.backup(); const second = await svc.backup();
    assert.equal(second.ok, false);
    release(); assert.equal((await p).ok, true);
  });

  it('cảnh báo 36 giờ: một lần, gửi lại chỉ sau khi có success', async () => {
    const set = makeSettings(); const al = makeAlerts();
    const svc = new BackupService(set, al, makeStorage(), okRunner([]));
    const t0 = new Date('2026-11-01T00:00:00Z');
    await svc.checkStale(t0);
    assert.ok(set.s.stale.watchSince);
    await svc.checkStale(new Date(t0.getTime() + 35 * 3600_000));
    assert.equal(al.events.length, 0);
    await svc.checkStale(new Date(t0.getTime() + 37 * 3600_000));
    await svc.checkStale(new Date(t0.getTime() + 40 * 3600_000));
    assert.equal(al.events.length, 1);
    set.s.okAt = new Date(t0.getTime() + 41 * 3600_000).toISOString();
    await svc.checkStale(new Date(t0.getTime() + 42 * 3600_000));
    assert.equal(set.s.stale.alerted, false);
    await svc.checkStale(new Date(t0.getTime() + 80 * 3600_000));
    assert.equal(al.events.length, 2);
  });

  it('pgConnectionFromUrl bỏ ?schema= và tách mật khẩu', () => {
    const c = pgConnectionFromUrl(URL_);
    assert.equal(c.database, 'flowvis');
    assert.equal(c.env.PGPASSWORD, SECRET);
    assert.equal(c.env.PGHOST, 'db');
  });

  it('lifecycle configure-bucket không có quy tắc khớp db-backup/', async () => {
    const { readFile } = await import('node:fs/promises');
    const src = await readFile(new URL('../src/scripts/configure-bucket.ts', import.meta.url), 'utf8');
    const prefixes = [...src.matchAll(/Prefix:\s*'([^']*)'/g)].map((m) => m[1]);
    assert.deepEqual(prefixes.sort(), ['in-raw/', 'in/', 'out/']);
    assert.ok(prefixes.every((p) => p !== '' && !'db-backup/'.startsWith(p)));
    assert.ok(!/Filter:\s*\{\s*\}/.test(src));
  });

  it('tích hợp pg_dump thật (bỏ qua nếu thiếu binary)', async (t) => {
    const { spawnSync } = await import('node:child_process');
    const { mkdtemp, rm, stat } = await import('node:fs/promises');
    const { join } = await import('node:path');
    const { childEnv, execFileRunner } = await import('../dist/modules/ops/backup-pg.js');
    if (spawnSync('pg_dump', ['--version']).error || spawnSync('pg_restore', ['--version']).error) {
      return t.skip('Không có pg_dump/pg_restore trên máy này');
    }
    const dbUrl = REAL_DATABASE_URL;
    if (!dbUrl) return t.skip('Không có DATABASE_URL');
    const conn = pgConnectionFromUrl(dbUrl);
    const dir = await mkdtemp(join(tmpdir(), 'flowvis-pgit-'));
    try {
      const file = join(dir, 'db.dump');
      const env = childEnv(conn.env);
      await execFileRunner('pg_dump', ['--format=custom', `--file=${file}`, `--dbname=${conn.database}`], env);
      assert.ok((await stat(file)).size > 0);
      await execFileRunner('pg_restore', ['--list', file], env);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
    assert.equal(existsSync(dir), false);
  });
});
