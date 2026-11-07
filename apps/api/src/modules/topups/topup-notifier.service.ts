import { Inject, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../infra/prisma.service.js';
import { NOTIFIER_PORT, type NotifierPort } from '../../ports/index.js';

export const MAX_NOTIFY_ATTEMPTS = 5;
export const NOTIFY_RETRY_INTERVAL_SECONDS = 60;

interface ClaimedRow {
  id: string;
  code: string;
  pack: string;
  amount_vnd: number;
  approve_by: Date | null;
  notify_attempts?: number;
}

/** Thông báo Discord cho đơn nạp. Chỉ ghi các cột thông báo của bảng topups (module topups sở hữu). */
@Injectable()
export class TopupNotifierService {
  private readonly logger = new Logger(TopupNotifierService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(NOTIFIER_PORT) private readonly notifier: NotifierPort,
  ) {}

  private payload(r: ClaimedRow) {
    return {
      topupId: r.id,
      code: r.code,
      pack: r.pack,
      amountVnd: r.amount_vnd,
      approveBy: r.approve_by ? r.approve_by.toISOString() : null,
    };
  }

  /** Nhận phiên gửi (UPDATE có điều kiện) rồi gửi; thành công thì đặt notified_at. Trả true nếu đã gửi. */
  async notifyPending(id: string): Promise<boolean> {
    const claimed = await this.prisma.$queryRaw<ClaimedRow[]>`
      UPDATE topups SET notify_attempts = notify_attempts + 1, notify_attempted_at = now()
      WHERE id = ${id}::uuid AND status = 'pending' AND notified_at IS NULL
        AND notify_attempts < ${MAX_NOTIFY_ATTEMPTS}
        AND (notify_attempted_at IS NULL
             OR notify_attempted_at < now() - make_interval(secs => ${NOTIFY_RETRY_INTERVAL_SECONDS}))
      RETURNING id, code, pack, amount_vnd, approve_by, notify_attempts`;
    if (claimed.length === 0) return false;
    const r = claimed[0];
    try {
      await this.notifier.notify({
        kind: 'TOPUP_PENDING',
        severity: 'info',
        message: `Đơn nạp ${r.code} chờ duyệt: gói ${r.pack}, ${r.amount_vnd} VNĐ, hạn duyệt ${r.approve_by?.toISOString() ?? 'n/a'}`,
        data: this.payload(r),
      });
    } catch (err) {
      // Lượt thứ MAX_NOTIFY_ATTEMPTS thất bại: ghi log lỗi đúng một lần (trạng thái nằm ở DB, sống qua khởi động lại).
      if ((r.notify_attempts ?? 0) >= MAX_NOTIFY_ATTEMPTS) {
        this.logger.error(`Đơn nạp ${r.id} thông báo Discord thất bại ${MAX_NOTIFY_ATTEMPTS} lần, bỏ qua.`);
      }
      throw err;
    }
    // Đã gửi thành công: ghi notified_at, thử lại vài lần để lỗi DB thoáng qua không gây gửi trùng.
    for (let attempt = 1; ; attempt++) {
      try {
        await this.prisma.$executeRaw`
          UPDATE topups SET notified_at = now() WHERE id = ${id}::uuid AND notified_at IS NULL`;
        break;
      } catch (err) {
        if (attempt >= 3) {
          this.logger.error(`Đã gửi thông báo đơn nạp ${id} nhưng không ghi được notified_at: ${String(err)}`);
          break;
        }
      }
    }
    return true;
  }

  /** Gửi lại mọi đơn pending chưa thông báo; đơn hết lượt thì log lỗi một lần. */
  async retryPending(): Promise<void> {
    const rows = await this.prisma.$queryRaw<Array<{ id: string; notify_attempts: number }>>`
      SELECT id, notify_attempts FROM topups
      WHERE status = 'pending' AND notified_at IS NULL AND notify_attempts < ${MAX_NOTIFY_ATTEMPTS}
      ORDER BY created_at LIMIT 100`;
    for (const row of rows) {
      try {
        await this.notifyPending(row.id);
      } catch (err) {
        this.logger.error(`Thử lại thông báo đơn nạp ${row.id} lỗi: ${String(err)}`);
      }
    }
  }

  /** Gửi đúng một cảnh báo cho đơn pending quá approve_by. Nhận từng đơn một để sự cố giữa chừng chỉ ảnh hưởng một đơn. */
  async alertOverdue(): Promise<void> {
    const candidates = await this.prisma.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM topups
      WHERE status = 'pending' AND approve_by < now() AND overdue_notified_at IS NULL
      ORDER BY approve_by LIMIT 100`;
    for (const c of candidates) {
      let claimed: ClaimedRow[];
      try {
        claimed = await this.prisma.$queryRaw<ClaimedRow[]>`
          UPDATE topups SET overdue_notified_at = now()
          WHERE id = ${c.id}::uuid AND status = 'pending' AND approve_by < now() AND overdue_notified_at IS NULL
          RETURNING id, code, pack, amount_vnd, approve_by`;
      } catch (err) {
        // Chưa nhận được đơn này (overdue_notified_at vẫn NULL): lần quét sau thử lại, các đơn khác vẫn xử lý.
        this.logger.error(`Nhận cảnh báo quá hạn đơn nạp ${c.id} lỗi: ${String(err)}`);
        continue;
      }
      for (const r of claimed) {
        try {
          await this.notifier.notify({
            kind: 'TOPUP_OVERDUE',
            severity: 'warn',
            message: `Đơn nạp ${r.code} đã quá hạn duyệt: gói ${r.pack}, ${r.amount_vnd} VNĐ, hạn duyệt ${r.approve_by?.toISOString() ?? 'n/a'}`,
            data: this.payload(r),
          });
        } catch (err) {
          this.logger.error(`Cảnh báo quá hạn đơn nạp ${r.id} lỗi: ${String(err)}`);
          // Hoàn tác phiên nhận để lần quét sau gửi lại; không để mất cảnh báo vì Discord lỗi tạm thời.
          try {
            await this.prisma.$executeRaw`
              UPDATE topups SET overdue_notified_at = NULL WHERE id = ${r.id}::uuid AND status = 'pending'`;
          } catch (revertErr) {
            this.logger.error(`Hoàn tác cảnh báo quá hạn đơn nạp ${r.id} lỗi: ${String(revertErr)}`);
          }
        }
      }
    }
  }
}
