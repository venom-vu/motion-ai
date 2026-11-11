import { Injectable } from '@nestjs/common';
import type { PrismaTransactionClient } from '../../infra/prisma.service.js';
import { PrismaService } from '../../infra/prisma.service.js';

export const SETTING_KEYS = {
  intakePaused: 'intake_paused',
  rhBudgetExhausted: 'rh_budget_exhausted',
  breakerResetAt: 'breaker_reset_at',
  lastBreakerTrigger: 'last_breaker_trigger',
} as const;

export interface BreakerTriggerRecord {
  at: string;
  rule: string;
  metrics: Record<string, number | string | boolean | null>;
}

/** Nơi duy nhất ghi bảng settings (AD-1). */
@Injectable()
export class SettingsService {
  constructor(private readonly prisma: PrismaService) {}

  private async read(db: Pick<PrismaService, '$queryRaw'> | PrismaTransactionClient, key: string): Promise<unknown> {
    const rows = await db.$queryRaw<Array<{ value: unknown }>>`SELECT value FROM settings WHERE key = ${key}`;
    return rows.length ? rows[0].value : null;
  }

  async isIntakePaused(): Promise<boolean> {
    return (await this.read(this.prisma, SETTING_KEYS.intakePaused)) === true;
  }

  async isRhBudgetExhausted(): Promise<boolean> {
    return (await this.read(this.prisma, SETTING_KEYS.rhBudgetExhausted)) === true;
  }

  async getBreakerResetAt(): Promise<Date | null> {
    const v = await this.read(this.prisma, SETTING_KEYS.breakerResetAt);
    if (typeof v !== 'string') return null;
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  async getLastBreakerTrigger(): Promise<BreakerTriggerRecord | null> {
    const v = await this.read(this.prisma, SETTING_KEYS.lastBreakerTrigger);
    return v && typeof v === 'object' ? (v as BreakerTriggerRecord) : null;
  }

  /**
   * Bật `intake_paused` và ghi `last_breaker_trigger` trong một transaction.
   * Trả true chỉ khi lần gọi này là lần chuyển false -> true (để gửi đúng một cảnh báo).
   */
  async pauseIntake(trigger: BreakerTriggerRecord): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<Array<{ key: string }>>`
        INSERT INTO settings (key, value, updated_at) VALUES (${SETTING_KEYS.intakePaused}, 'true'::jsonb, now())
        ON CONFLICT (key) DO UPDATE SET value = 'true'::jsonb, updated_at = now()
        WHERE settings.value IS DISTINCT FROM 'true'::jsonb
        RETURNING key`;
      if (rows.length === 0) return false;
      await tx.$executeRaw`
        INSERT INTO settings (key, value, updated_at) VALUES (${SETTING_KEYS.lastBreakerTrigger}, ${JSON.stringify(trigger)}::jsonb, now())
        ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`;
      return true;
    });
  }

  /** Mở lại nhận Task: tắt hai cờ và đặt mốc reset, trong transaction của bên gọi. */
  async resume(tx: PrismaTransactionClient): Promise<{ before: { intakePaused: boolean; rhBudgetExhausted: boolean } }> {
    const before = {
      intakePaused: (await this.read(tx, SETTING_KEYS.intakePaused)) === true,
      rhBudgetExhausted: (await this.read(tx, SETTING_KEYS.rhBudgetExhausted)) === true,
    };
    await tx.$executeRaw`
      INSERT INTO settings (key, value, updated_at) VALUES
        (${SETTING_KEYS.intakePaused}, 'false'::jsonb, now()),
        (${SETTING_KEYS.rhBudgetExhausted}, 'false'::jsonb, now()),
        (${SETTING_KEYS.breakerResetAt}, to_jsonb(to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')), now())
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`;
    return { before };
  }
}
