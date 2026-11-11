import { Inject, Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { RUNNING_HUB_PORT, type RunningHubPort } from '../../ports/index.js';
import { AlertService } from '../ops/alert.service.js';
import { SettingsService } from '../ops/settings.service.js';

export const BALANCE_INTERVAL_MS = 10 * 60_000;
export const BALANCE_FAIL_STREAK = 3;
const READ_TIMEOUT_MS = 10_000;

function alertThreshold(): number {
  const n = Number(process.env.RH_BALANCE_ALERT_COINS);
  return Number.isFinite(n) && n >= 0 && process.env.RH_BALANCE_ALERT_COINS?.trim() ? n : 27000;
}

/** Đọc số dư RunningHub định kỳ (chỉ tiến trình worker) và cảnh báo khi thấp hoặc không đọc được. */
@Injectable()
export class RhBalanceService {
  private readonly logger = new Logger(RhBalanceService.name);
  private running = false;

  constructor(
    @Inject(RUNNING_HUB_PORT) private readonly rh: RunningHubPort,
    private readonly settings: SettingsService,
    private readonly alerts: AlertService,
  ) {}

  @Interval(BALANCE_INTERVAL_MS)
  async scheduledCheck(): Promise<void> {
    if (process.env.MOTION_PROCESS_ROLE !== 'worker') return;
    await this.check();
  }

  /** Một lần đọc số dư; không ném lỗi. Gọi trực tiếp được trong test. */
  async check(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const state = await this.settings.getRhBalanceState();
      let coins: number;
      try {
        coins = await this.rh.getBalance(AbortSignal.timeout(READ_TIMEOUT_MS));
        if (!Number.isFinite(coins) || coins < 0) throw new Error('Số dư không hợp lệ');
      } catch (err) {
        state.failStreak += 1;
        this.logger.warn(`Không đọc được số dư RunningHub (lần ${state.failStreak}): ${String(err)}`);
        if (state.failStreak >= BALANCE_FAIL_STREAK && !state.failAlerted) {
          state.failAlerted = await this.alerts.raise(`rh_balance_unreadable:${new Date().toISOString()}`, {
            kind: 'ops.rh_balance_unreadable',
            severity: 'warn',
            message: 'Không đọc được số dư RunningHub.',
            data: { consecutiveFailures: state.failStreak },
          });
        }
        await this.settings.setRhBalanceState(state);
        return;
      }
      state.failStreak = 0;
      state.failAlerted = false;
      await this.settings.saveRhBalance({ coins, readAt: new Date().toISOString() });
      const threshold = alertThreshold();
      if (coins < threshold) {
        if (!state.lowAlerted) {
          state.lowAlerted = await this.alerts.raise(`rh_balance_low:${new Date().toISOString()}`, {
            kind: 'ops.rh_balance_low',
            severity: 'warn',
            message: `Số dư RunningHub còn ${coins} coin, dưới ngưỡng ${threshold}.`,
            data: { coins, threshold },
          });
        }
      } else {
        state.lowAlerted = false;
      }
      await this.settings.setRhBalanceState(state);
    } catch (err) {
      this.logger.error(`Job số dư RunningHub lỗi: ${String(err)}`);
    } finally {
      this.running = false;
    }
  }
}
