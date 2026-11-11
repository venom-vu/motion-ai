import { Injectable } from '@nestjs/common';
import type { PrismaTransactionClient } from '../../infra/prisma.service.js';
import { PrismaService } from '../../infra/prisma.service.js';

export const SETTING_KEYS = {
  intakePaused: 'intake_paused',
  rhBudgetExhausted: 'rh_budget_exhausted',
  breakerResetAt: 'breaker_reset_at',
  lastBreakerTrigger: 'last_breaker_trigger',
  rhBalance: 'rh_balance',
  rhBalanceState: 'rh_balance_state',
} as const;

export const ALERT_KEY_PREFIX = 'alert:';

export interface RhBalanceReading {
  coins: number;
  readAt: string;
}

export interface RhBalanceState {
  failStreak: number;
  failAlerted: boolean;
  lowAlerted: boolean;
}

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

  async getRhBalance(): Promise<RhBalanceReading | null> {
    const v = await this.read(this.prisma, SETTING_KEYS.rhBalance);
    if (!v || typeof v !== 'object') return null;
    const { coins, readAt } = v as Partial<RhBalanceReading>;
    return typeof coins === 'number' && typeof readAt === 'string' ? { coins, readAt } : null;
  }

  async getRhBalanceState(): Promise<RhBalanceState> {
    const v = (await this.read(this.prisma, SETTING_KEYS.rhBalanceState)) as Partial<RhBalanceState> | null;
    return {
      failStreak: typeof v?.failStreak === 'number' ? v.failStreak : 0,
      failAlerted: v?.failAlerted === true,
      lowAlerted: v?.lowAlerted === true,
    };
  }

  async setRhBalanceState(state: RhBalanceState): Promise<void> {
    await this.writeJson(SETTING_KEYS.rhBalanceState, state);
  }

  async saveRhBalance(reading: RhBalanceReading): Promise<void> {
    await this.writeJson(SETTING_KEYS.rhBalance, reading);
  }

  /** Trạng thái một cảnh báo (khóa không gồm tiền tố). */
  async getAlertState<T>(key: string): Promise<T | null> {
    const v = await this.read(this.prisma, ALERT_KEY_PREFIX + key);
    return v && typeof v === 'object' ? (v as T) : null;
  }

  async setAlertState(key: string, state: unknown): Promise<void> {
    await this.writeJson(ALERT_KEY_PREFIX + key, state);
  }

  /** Các cảnh báo đang chờ gửi (tối đa `limit`). */
  async listPendingAlerts<T>(limit = 50): Promise<Array<{ key: string; state: T }>> {
    const rows = await this.prisma.$queryRaw<Array<{ key: string; value: T }>>`
      SELECT key, value FROM settings
      WHERE key LIKE ${ALERT_KEY_PREFIX + '%'} AND value->>'pending' = 'true'
      ORDER BY updated_at LIMIT ${limit}`;
    return rows.map((r) => ({ key: r.key.slice(ALERT_KEY_PREFIX.length), state: r.value }));
  }

  private async writeJson(key: string, value: unknown): Promise<void> {
    await this.prisma.$executeRaw`
      INSERT INTO settings (key, value, updated_at) VALUES (${key}, ${JSON.stringify(value)}::jsonb, now())
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`;
  }

  /** Bật `rh_budget_exhausted` và `intake_paused`. Trả true chỉ khi `rh_budget_exhausted` chuyển tắt -> bật. */
  async markRhBudgetExhausted(): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`
        INSERT INTO settings (key, value, updated_at) VALUES (${SETTING_KEYS.intakePaused}, 'true'::jsonb, now())
        ON CONFLICT (key) DO UPDATE SET value = 'true'::jsonb, updated_at = now()
        WHERE settings.value IS DISTINCT FROM 'true'::jsonb`;
      const rows = await tx.$queryRaw<Array<{ key: string }>>`
        INSERT INTO settings (key, value, updated_at) VALUES (${SETTING_KEYS.rhBudgetExhausted}, 'true'::jsonb, now())
        ON CONFLICT (key) DO UPDATE SET value = 'true'::jsonb, updated_at = now()
        WHERE settings.value IS DISTINCT FROM 'true'::jsonb
        RETURNING key`;
      return rows.length > 0;
    });
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
