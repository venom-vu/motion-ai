import { Logger } from '@nestjs/common';
import type { NotifierEvent, NotifierPort } from '../../ports/index.js';
import { LogNotifierAdapter } from './log-notifier.adapter.js';

const MAX_CONTENT = 2000;
const TIMEOUT_MS = 5000;

/** Gửi thông báo qua Discord webhook. Ném lỗi khi mạng lỗi, timeout hoặc HTTP không phải 2xx. */
export class DiscordNotifierAdapter implements NotifierPort {
  readonly portName = 'NotifierPort' as const;

  constructor(
    private readonly webhookUrl: string,
    private readonly timeoutMs: number = TIMEOUT_MS,
  ) {}

  async notify(event: NotifierEvent): Promise<void> {
    let content = `[${event.severity ?? 'info'}] ${event.kind}: ${event.message}`;
    if (event.data && Object.keys(event.data).length > 0) content += `\n${JSON.stringify(event.data)}`;
    if (content.length > MAX_CONTENT) content = Array.from(content).slice(0, MAX_CONTENT - 1).join('') + '…';
    let res: Response;
    try {
      res = await fetch(this.webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content, allowed_mentions: { parse: [] } }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (err) {
      // Không đính kèm err gốc: thông điệp của fetch có thể chứa URL webhook.
      throw new Error(`Gửi Discord thất bại: ${(err as Error).name}`);
    }
    if (!res.ok) throw new Error(`Gửi Discord thất bại: HTTP ${res.status}`);
    await res.arrayBuffer().catch(() => undefined);
  }
}

export function createNotifierPort(): NotifierPort {
  const url = process.env.DISCORD_WEBHOOK_URL?.trim();
  if (!url) return new LogNotifierAdapter();
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error('protocol');
  } catch {
    // URL sai định dạng: dùng adapter log thay vì để mọi lần gửi đều lỗi (không in URL ra log).
    new Logger('Notifier').error('DISCORD_WEBHOOK_URL không hợp lệ, dùng adapter log.');
    return new LogNotifierAdapter();
  }
  return new DiscordNotifierAdapter(url);
}
