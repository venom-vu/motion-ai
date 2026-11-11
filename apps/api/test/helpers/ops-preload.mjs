// Nạp trước mỗi tiến trình test: tắt ngắt mạch (các suite cố ý tạo lỗi hệ thống) và bỏ cờ tạm dừng còn sót.
process.env.OPS_BREAKER_DISABLED = '1';
process.env.NODE_ENV ??= 'test';
if (process.env.DATABASE_URL) {
  try {
    const pg = (await import('pg')).default;
    const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 2000 });
    await pool.query(`UPDATE settings SET value='false'::jsonb WHERE key IN ('intake_paused','rh_budget_exhausted')`).catch(() => {});
    await pool.end();
  } catch {
    // bảng settings chưa có (migration chưa chạy): bỏ qua
  }
}
