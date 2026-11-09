import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import net from 'node:net';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const apiRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(apiRoot, '../..');
const composePath = path.join(repoRoot, 'deploy', 'compose.yml');
const DB_URL =
  process.env.DATABASE_URL ||
  'postgresql://motion_user:change_me_local_password@localhost:5432/flowvis?schema=public';
const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

function checkTcpPort(host, port, timeoutMs = 1000) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    const done = (ok) => {
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false));
    socket.once('error', () => done(false));
    socket.connect(port, host);
  });
}

async function ensureInfra() {
  const d = new URL(DB_URL);
  const r = new URL(REDIS_URL);
  const [pgUp, redisUp] = await Promise.all([
    checkTcpPort(d.hostname || 'localhost', Number(d.port || 5432)),
    checkTcpPort(r.hostname || 'localhost', Number(r.port || 6379)),
  ]);
  if (!pgUp || !redisUp) {
    execFileSync(
      'docker',
      ['compose', '-f', composePath, 'up', '-d', '--wait', 'postgres-16', 'redis-7'],
      { cwd: repoRoot, stdio: 'inherit' },
    );
  }
  execFileSync('pnpm', ['run', 'prisma:migrate:deploy'], {
    cwd: apiRoot,
    env: { ...process.env, DATABASE_URL: DB_URL },
    stdio: 'inherit',
  });
}

describe('Story 1.11: script đối soát nhánh lệch', () => {
  let pool;
  const userId = crypto.randomUUID();

  before(async () => {
    await ensureInfra();
    pool = new pg.Pool({ connectionString: DB_URL });
    // balance = 7 nhưng không có dòng sổ cái nào (SUM = 0) => lệch.
    await pool.query(
      `INSERT INTO users (id, google_id, email, tos_version, balance, held, updated_at)
       VALUES ($1, $2, $3, 'test', 7, 0, now())`,
      [userId, `recon-${userId}`, `recon-${userId}@test.local`],
    );
  });

  after(async () => {
    if (pool) {
      await pool.query('DELETE FROM users WHERE id = $1', [userId]).catch(() => {});
      await pool.end();
    }
  });

  it('thoát mã 1 và in status mismatch kèm userId lệch', () => {
    let error;
    try {
      execFileSync('node', ['dist/scripts/reconcile.js'], {
        cwd: apiRoot,
        env: { ...process.env, DATABASE_URL: DB_URL, REDIS_URL },
        encoding: 'utf8',
        stdio: 'pipe',
      });
    } catch (err) {
      error = err;
    }
    assert.ok(error, 'script phải thoát với mã khác 0 khi có lệch');
    assert.equal(error.status, 1);
    const output = `${error.stdout ?? ''}${error.stderr ?? ''}`;
    assert.match(output, /"status":"mismatch"/);
    assert.ok(output.includes(userId), 'đầu ra phải nêu user lệch');
  });
});
