import { execFile } from 'node:child_process';

export interface PgConnection {
  /** Biến môi trường PG* (chứa mật khẩu; không bao giờ ghi log). */
  env: Record<string, string>;
  database: string;
}

/** Suy kết nối `pg_*` từ DATABASE_URL (bỏ `?schema=`); mật khẩu chỉ đi qua biến môi trường. */
export function pgConnectionFromUrl(databaseUrl: string | undefined): PgConnection {
  if (!databaseUrl) throw new Error('Thiếu DATABASE_URL');
  let u: URL;
  try {
    u = new URL(databaseUrl.split('?')[0]);
  } catch {
    throw new Error('DATABASE_URL không hợp lệ');
  }
  const database = decodeURIComponent(u.pathname.replace(/^\//, ''));
  const env: Record<string, string> = {
    PGHOST: u.hostname,
    PGPORT: u.port || '5432',
    PGUSER: decodeURIComponent(u.username),
    PGPASSWORD: decodeURIComponent(u.password),
    PGDATABASE: database,
  };
  return { env, database };
}

/** Môi trường tối thiểu cho tiến trình con: không thừa kế DATABASE_URL hay khóa R2. */
export function childEnv(pg: Record<string, string>): NodeJS.ProcessEnv {
  return { PATH: process.env.PATH ?? '/usr/bin:/bin', LANG: 'C', ...pg };
}

export type CommandRunner = (
  file: string,
  args: readonly string[],
  env: NodeJS.ProcessEnv,
) => Promise<void>;

/** Chạy lệnh bằng execFile (không shell). Lỗi ném ra không mang theo stderr/đối số. */
export const execFileRunner: CommandRunner = (file, args, env) =>
  new Promise((resolve, reject) => {
    execFile(file, [...args], { env, maxBuffer: 1024 * 1024, timeout: 30 * 60_000 }, (err) => {
      if (err) reject(new Error(`${file} thất bại (${String((err as { code?: unknown }).code ?? 'lỗi')})`));
      else resolve();
    });
  });
