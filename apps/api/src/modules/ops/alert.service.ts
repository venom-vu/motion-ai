import { Inject, Injectable, Logger } from '@nestjs/common';
import { NOTIFIER_PORT, type NotifierEvent, type NotifierPort } from '../../ports/index.js';
import { SettingsService } from './settings.service.js';

export const ALERT_MAX_ATTEMPTS = 5;
export const ALERT_RETRY_GAP_MS = 60_000;

interface AlertState {
  pending: boolean;
  attempts: number;
  lastAttemptAt: string | null;
  sentAt: string | null;
  gaveUp?: boolean;
  event: NotifierEvent;
}

/**
 * Cảnh báo có trạng thái (lưu trong settings): gửi ngay, thất bại thì bộ quét thử lại
 * tối đa 5 lần, cách nhau ít nhất 60 giây; không gửi lặp khi đã gửi.
 */
@Injectable()
export class AlertService {
  private readonly logger = new Logger(AlertService.name);

  constructor(
    private readonly settings: SettingsService,
    @Inject(NOTIFIER_PORT) private readonly notifier: NotifierPort,
  ) {}

  /**
   * Tạo cảnh báo (khóa đã có thì bỏ qua) rồi thử gửi ngay. Không bao giờ ném lỗi.
   * Trả true khi hàng cảnh báo đã được lưu (gửi lỗi vẫn được thử lại sau); false khi không lưu được hoặc khóa đã có.
   */
  async raise(key: string, event: NotifierEvent): Promise<boolean> {
    try {
      if (await this.settings.getAlertState<AlertState>(key)) return false;
      const state: AlertState = { pending: true, attempts: 0, lastAttemptAt: null, sentAt: null, event };
      await this.settings.setAlertState(key, state);
      try {
        await this.attempt(key, state);
      } catch (err) {
        this.logger.error(`Không ghi được trạng thái cảnh báo ${key}: ${String(err)}`);
      }
      return true;
    } catch (err) {
      this.logger.error(`Không tạo được cảnh báo ${key}: ${String(err)}`);
      return false;
    }
  }

  /** Thử lại các cảnh báo đang chờ (gọi ở chu kỳ quét). */
  async retryPending(now = Date.now()): Promise<void> {
    for (const { key, state } of await this.settings.listPendingAlerts<AlertState>()) {
      if (state.attempts >= ALERT_MAX_ATTEMPTS) continue;
      let last = 0;
      if (state.lastAttemptAt) {
        const t = new Date(state.lastAttemptAt).getTime();
        last = Number.isFinite(t) ? t : now;
      }
      if (now - last < ALERT_RETRY_GAP_MS) continue;
      try {
        await this.attempt(key, state);
      } catch (err) {
        this.logger.error(`Thử lại cảnh báo ${key} lỗi: ${String(err)}`);
      }
    }
  }

  private async attempt(key: string, state: AlertState): Promise<void> {
    const next: AlertState = { ...state, attempts: state.attempts + 1, lastAttemptAt: new Date().toISOString() };
    try {
      await this.notifier.notify(state.event);
      next.pending = false;
      next.sentAt = new Date().toISOString();
    } catch (err) {
      if (next.attempts >= ALERT_MAX_ATTEMPTS) {
        next.pending = false;
        next.gaveUp = true;
        this.logger.error(`Cảnh báo ${key} thất bại sau ${next.attempts} lần, dừng thử: ${String(err)}`);
      } else {
        this.logger.warn(`Gửi cảnh báo ${key} lần ${next.attempts} lỗi: ${String(err)}`);
      }
    }
    await this.settings.setAlertState(key, next);
  }
}
