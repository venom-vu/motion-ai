import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { UploadsService } from './uploads.service.js';

@Injectable()
export class UploadsExpiryService {
  private readonly logger = new Logger(UploadsExpiryService.name);

  constructor(private readonly uploads: UploadsService) {}

  /** Chỉ tiến trình worker chạy job (AR14); cùng chu kỳ lifecycle in-raw/. */
  @Cron('0 * * * *')
  async scheduledExpire(): Promise<void> {
    if (process.env.MOTION_PROCESS_ROLE !== 'worker') return;
    try {
      const n = await this.uploads.expireStalePending();
      if (n > 0) this.logger.log(`Đã hết hạn ${n} bản ghi tải lên tạm`);
    } catch (err) {
      this.logger.error(`Job hết hạn tải lên thất bại: ${String(err)}`);
    }
  }
}
