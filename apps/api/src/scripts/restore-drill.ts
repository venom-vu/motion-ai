import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import pg from 'pg';
import { BACKUP_KEY_RE, BACKUP_PREFIX } from '../modules/ops/backup.service.js';
import { childEnv, execFileRunner, pgConnectionFromUrl } from '../modules/ops/backup-pg.js';
import { S3StorageAdapter } from '../modules/storage/s3-storage.adapter.js';

/**
 * Restore-drill: tải bản sao lưu mới nhất từ R2, khôi phục vào CSDL tạm, đối chiếu sổ cái,
 * rồi xóa CSDL tạm. In JSON {ok,durationMs,checked}; thoát 0/1.
 */
async function drill(): Promise<{ ok: boolean; checked: number; mismatches: number }> {
  process.env.MOTION_PROCESS_ROLE = 'script';
  const storage = new S3StorageAdapter();
  const keys = (await storage.list(BACKUP_PREFIX)).map((i) => i.key).filter((k) => BACKUP_KEY_RE.test(k)).sort();
  const latest = keys[keys.length - 1];
  if (!latest) throw new Error('Không có bản sao lưu trên R2');
  const conn = pgConnectionFromUrl(process.env.DATABASE_URL);
  const tempDb = `restore_drill_${Date.now()}`;
  const dir = await mkdtemp(path.join(tmpdir(), 'flowvis-drill-'));
  const admin = new pg.Client({ connectionString: process.env.DATABASE_URL?.split('?')[0] });
  let created = false;
  try {
    const file = path.join(dir, 'db.dump');
    await writeFile(file, await storage.getObject(latest));
    await admin.connect();
    await admin.query(`CREATE DATABASE "${tempDb}"`);
    created = true;
    await execFileRunner(
      'pg_restore',
      ['--no-owner', '--no-privileges', `--dbname=${tempDb}`, file],
      childEnv(conn.env),
    );
    const u = new URL(process.env.DATABASE_URL!.split('?')[0]);
    u.pathname = `/${tempDb}`;
    const check = new pg.Client({ connectionString: u.toString() });
    await check.connect();
    try {
      const res = await check.query(`
        SELECT u.id,
          u.balance = COALESCE((SELECT SUM(l.amount) FROM ledger_entries l WHERE l.user_id = u.id), 0) AS balance_ok,
          u.held = COALESCE((SELECT -SUM(h.amount) FROM ledger_entries h
            WHERE h.user_id = u.id AND h.type = 'HOLD'
              AND NOT EXISTS (SELECT 1 FROM ledger_entries s
                WHERE s.task_id = h.task_id AND s.type IN ('CAPTURED','RELEASED'))), 0) AS held_ok
        FROM users u`);
      const bad = res.rows.filter((r) => !r.balance_ok || !r.held_ok).length;
      return { ok: bad === 0, checked: res.rows.length, mismatches: bad };
    } finally {
      await check.end();
    }
  } finally {
    if (created) await admin.query(`DROP DATABASE IF EXISTS "${tempDb}" WITH (FORCE)`).catch(() => undefined);
    await admin.end().catch(() => undefined);
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

const started = Date.now();
drill().then(
  (r) => {
    console.log(JSON.stringify({ ok: r.ok, durationMs: Date.now() - started, checked: r.checked }));
    process.exit(r.ok ? 0 : 1);
  },
  (err: unknown) => {
    console.log(JSON.stringify({ ok: false, durationMs: Date.now() - started, checked: 0 }));
    console.error(err instanceof Error ? err.message : 'restore-drill lỗi');
    process.exit(1);
  },
);
