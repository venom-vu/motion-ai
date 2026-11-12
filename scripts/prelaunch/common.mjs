// Phần có tác dụng phụ dùng chung cho các bước (chạy lệnh, compose, in kết quả). Hàm thuần nằm ở lib.mjs.
import { execFile, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { EXIT_ERROR, lastJsonLine, readThresholds, splitCommand } from './lib.mjs';

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const API_DIST = path.join(REPO_ROOT, 'apps', 'api', 'dist', 'scripts');
const DEFAULT_COMPOSE = 'docker compose -f deploy/compose.yml --env-file deploy/.env';

/** In kết quả JSON một dòng rồi thoát. */
export function finish(step, code, data) {
  console.log(JSON.stringify({ step, pass: code === 0, exitCode: code, at: new Date().toISOString(), ...data }));
  process.exit(code);
}

/** Lỗi chạy (exit 2) kèm thông báo tiếng Việt ra stderr. */
export function fail(step, message, extra = {}) {
  console.error(message);
  finish(step, EXIT_ERROR, { error: message, ...extra });
}

/** Ngưỡng đã ghi đè; biến sai định dạng là lỗi chạy. */
export function thresholdsOrExit(step) {
  const { thresholds, invalid } = readThresholds(process.env);
  if (invalid.length > 0) fail(step, `Biến ngưỡng không hợp lệ: ${invalid.join(', ')}.`);
  return thresholds;
}

export function composeCommand() {
  const parts = splitCommand(process.env.PRELAUNCH_COMPOSE || DEFAULT_COMPOSE);
  return { cmd: parts[0], base: parts.slice(1) };
}

/** Chạy lệnh (không qua shell), trả {code, stdout, stderr}. Không ném khi mã thoát ≠ 0. */
export function exec(cmd, args, { timeoutMs = 15 * 60_000, env = process.env, input } = {}) {
  return new Promise((resolve) => {
    const child = execFile(
      cmd,
      args,
      { cwd: REPO_ROOT, env, timeout: timeoutMs, maxBuffer: 32 * 1024 * 1024, killSignal: 'SIGKILL' },
      (err, stdout, stderr) => {
        const code = err ? (typeof err.code === 'number' ? err.code : EXIT_ERROR) : 0;
        resolve({ code, stdout: String(stdout ?? ''), stderr: String(stderr ?? ''), spawnError: err && typeof err.code !== 'number' ? err.message : null });
      },
    );
    if (input != null) child.stdin?.end(input);
  });
}

/** Chạy lệnh và chuyển stderr ra màn hình (log tiến trình), giữ stdout để đọc JSON. */
export function execStreaming(cmd, args, { timeoutMs = 15 * 60_000, env = process.env } = {}) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd: REPO_ROOT, env, stdio: ['ignore', 'pipe', 'inherit'] });
    let stdout = '';
    child.stdout.on('data', (d) => (stdout += d));
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({ code: EXIT_ERROR, stdout, spawnError: err.message });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? EXIT_ERROR, stdout, spawnError: null });
    });
  });
}

/**
 * Chạy một CLI đã build của apps/api: cục bộ (`node apps/api/dist/scripts/<name>.js`) hoặc trong container
 * (`<compose> exec -T <service> node apps/api/dist/scripts/<name>.js`). Trả {code, json, spawnError}.
 */
export async function runApiCli(name, args = [], { useCompose = false, service = 'nestjs-worker', timeoutMs } = {}) {
  let cmd;
  let argv;
  if (useCompose) {
    const c = composeCommand();
    cmd = c.cmd;
    argv = [...c.base, 'exec', '-T', service, 'node', `apps/api/dist/scripts/${name}.js`, ...args];
  } else {
    const file = path.join(API_DIST, `${name}.js`);
    if (!fs.existsSync(file)) {
      return { code: EXIT_ERROR, json: null, spawnError: `Chưa build ${path.relative(REPO_ROOT, file)}; chạy "pnpm --filter @flowvis/api run build".` };
    }
    cmd = process.execPath;
    argv = [file, ...args];
  }
  const r = await execStreaming(cmd, argv, { timeoutMs });
  return { code: r.code, json: lastJsonLine(r.stdout), spawnError: r.spawnError };
}

export function hasFlag(name) {
  return process.argv.slice(2).includes(name);
}

export function flagValue(name) {
  const argv = process.argv.slice(2);
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
}

export function positionalArgs() {
  const out = [];
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
      if (['--start', '--seconds', '--manifest', '--service'].includes(argv[i])) i++;
      continue;
    }
    out.push(argv[i]);
  }
  return out;
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
