import { DiscordNotifierAdapter } from '../modules/ops/discord-notifier.adapter.js';

/**
 * Bước 1 cổng trước khi bật VietQR (Story 6.11): gửi một tin thử qua DiscordNotifierAdapter, đo độ trễ.
 * Không rơi về LogNotifierAdapter. In JSON một dòng {ok,latencyMs}; thoát 0 gửi được, 1 gửi lỗi, 2 thiếu/sai cấu hình.
 */
function webhookUrl(): string | null {
  const raw = process.env.DISCORD_WEBHOOK_URL?.trim();
  if (!raw) return null;
  try {
    const u = new URL(raw);
    return u.protocol === 'https:' || u.protocol === 'http:' ? raw : null;
  } catch {
    return null;
  }
}

async function main(): Promise<number> {
  process.env.MOTION_PROCESS_ROLE = 'script';
  const url = webhookUrl();
  if (!url) {
    console.error('Thiếu hoặc sai DISCORD_WEBHOOK_URL (cần URL http/https).');
    console.log(JSON.stringify({ ok: false, latencyMs: null, error: 'CONFIG' }));
    return 2;
  }
  const sentAt = new Date().toISOString();
  const started = performance.now();
  try {
    await new DiscordNotifierAdapter(url, 10_000).notify({
      kind: 'prelaunch.discord_test',
      severity: 'info',
      message: `Tin thử cổng trước khi bật VietQR (bước 1), gửi lúc ${sentAt}`,
    });
  } catch (err) {
    // Thông điệp của adapter không chứa URL webhook.
    const latencyMs = Math.round(performance.now() - started);
    console.log(JSON.stringify({ ok: false, latencyMs, sentAt, error: (err as Error).message }));
    return 1;
  }
  const latencyMs = Math.round(performance.now() - started);
  console.log(JSON.stringify({ ok: true, latencyMs, sentAt }));
  return 0;
}

main().then(
  (code) => process.exit(code),
  (err: unknown) => {
    console.error(err instanceof Error ? err.message : 'prelaunch-notify lỗi');
    process.exit(2);
  },
);
