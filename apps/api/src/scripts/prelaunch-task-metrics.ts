import pg from 'pg';

/**
 * Bước 4 cổng trước khi bật VietQR (Story 6.11): đọc (chỉ SELECT) số liệu benchmark của các Task mà API công khai
 * không trả: `gpu_coins`, `queued_at`, `running_at`, `finished_at`, `params.seconds`.
 * Dùng: node apps/api/dist/scripts/prelaunch-task-metrics.js <taskId> [taskId...]
 * In JSON một dòng {ok, tasks:[...]}; thoát 0 đọc được đủ, 1 thiếu Task, 2 lỗi cấu hình/kết nối.
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface Row {
  id: string;
  pipeline: string;
  status: string;
  reason_code: string | null;
  gpu_coins: number | null;
  queued_at: Date | null;
  running_at: Date | null;
  finished_at: Date | null;
  params: Record<string, unknown> | null;
}

const iso = (d: Date | null): string | null => (d ? d.toISOString() : null);

async function main(): Promise<number> {
  process.env.MOTION_PROCESS_ROLE = 'script';
  const ids = process.argv.slice(2);
  if (ids.length === 0 || !ids.every((id) => UUID_RE.test(id))) {
    console.error('Cần ít nhất một taskId dạng UUID.');
    console.log(JSON.stringify({ ok: false, error: 'USAGE' }));
    return 2;
  }
  const url = process.env.DATABASE_URL?.trim();
  if (!url) {
    console.error('Thiếu biến môi trường DATABASE_URL.');
    console.log(JSON.stringify({ ok: false, error: 'CONFIG' }));
    return 2;
  }
  const client = new pg.Client({ connectionString: url.split('?')[0] });
  await client.connect();
  try {
    const res = await client.query<Row>(
      `SELECT id, pipeline, status, reason_code, gpu_coins, queued_at, running_at, finished_at, params
         FROM tasks WHERE id = ANY($1::uuid[])`,
      [ids],
    );
    const tasks = res.rows.map((r) => ({
      id: r.id,
      pipeline: r.pipeline,
      status: r.status,
      reasonCode: r.reason_code,
      gpuCoins: r.gpu_coins,
      queuedAt: iso(r.queued_at),
      runningAt: iso(r.running_at),
      finishedAt: iso(r.finished_at),
      seconds: typeof r.params?.seconds === 'number' ? r.params.seconds : null,
    }));
    const ok = tasks.length === ids.length;
    console.log(JSON.stringify({ ok, tasks }));
    return ok ? 0 : 1;
  } finally {
    await client.end().catch(() => undefined);
  }
}

main().then(
  (code) => process.exit(code),
  (err: unknown) => {
    console.error(err instanceof Error ? err.message : 'prelaunch-task-metrics lỗi');
    process.exit(2);
  },
);
