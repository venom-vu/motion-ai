import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { TopupsService } from './topups.service.js';

export const TOPUP_SWEEP_INTERVAL_MS = 30_000;

/** Bộ quét đơn nạp hết hạn QR. Chỉ chạy ở tiến trình worker. */
@Injectable()
export class TopupSweeperService {
  private readonly logger = new Logger(TopupSweeperService.name);
  private running = false;

  constructor(private readonly topups: TopupsService) {}

  @Interval(TOPUP_SWEEP_INTERVAL_MS)
  async scheduledSweep(): Promise<void> {
    if (process.env.MOTION_PROCESS_ROLE !== 'worker') return;
    await this.sweepExpired();
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
