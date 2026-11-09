import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { TopupNotifierService } from './topup-notifier.service.js';
import { TopupsService } from './topups.service.js';

export const TOPUP_SWEEP_INTERVAL_MS = 30_000;

/** `TOPUP_SWEEP_INTERVAL` (ms) chỉ có hiệu lực khi NODE_ENV=test. */
export function topupSweepIntervalMs(): number {
  if (process.env.NODE_ENV !== 'test') return TOPUP_SWEEP_INTERVAL_MS;
  const v = Number(process.env.TOPUP_SWEEP_INTERVAL);
  return Number.isInteger(v) && v >= 200 ? v : TOPUP_SWEEP_INTERVAL_MS;
}

/** Bộ quét đơn nạp hết hạn QR. Chỉ chạy ở tiến trình worker. */
@Injectable()
export class TopupSweeperService {
  private readonly logger = new Logger(TopupSweeperService.name);
  private running = false;

  private notifying = false;

  constructor(
    private readonly topups: TopupsService,
    private readonly notifier: TopupNotifierService,
  ) {}

  @Interval(topupSweepIntervalMs())
  async scheduledSweep(): Promise<void> {
    if (process.env.MOTION_PROCESS_ROLE !== 'worker') return;
    try {
      await this.sweepExpired();
    } catch (err) {
      this.logger.error(`Bộ quét hết hạn lỗi: ${String(err)}`);
    }
    await this.sweepNotifications();
  }

  /** Gửi lại thông báo pending còn thiếu và cảnh báo quá approve_by. */
  async sweepNotifications(): Promise<void> {
    if (this.notifying) return;
    this.notifying = true;
    try {
      try {
        await this.notifier.retryPending();
      } catch (err) {
        this.logger.error(`Gửi lại thông báo đơn nạp lỗi: ${String(err)}`);
      }
      try {
        await this.notifier.alertOverdue();
      } catch (err) {
        this.logger.error(`Cảnh báo quá hạn đơn nạp lỗi: ${String(err)}`);
      }
    } finally {
      this.notifying = false;
    }
  }

  /** Đổi mọi đơn awaiting_transfer quá qr_expires_at sang expired; trả số đơn đã đổi. */
  async sweepExpired(): Promise<number> {
    if (this.running) return 0;
    this.running = true;
    try {
      const n = await this.topups.expireOverdue();
      if (n > 0) this.logger.log(`Đã chuyển ${n} đơn nạp hết hạn QR sang expired.`);
      return n;
    } catch (err) {
      this.logger.error(`Bộ quét đơn nạp hết hạn lỗi: ${String(err)}`);
      return 0;
    } finally {
      this.running = false;
    }
  }
}
