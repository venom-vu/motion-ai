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

const VN_OFFSET_MS = 7 * 60 * 60 * 1000;

/** 49000 -> "49.000đ". */
function formatVnd(amount: number): string {
  return `${String(amount).replace(/\B(?=(\d{3})+(?!\d))/g, '.')}đ`;
}

/** Giờ Việt Nam (UTC+7, không DST), dạng "11:31 08/11/2026". */
function formatVnTime(d: Date | null): string {
  if (!d) return 'n/a';
  const t = new Date(d.getTime() + VN_OFFSET_MS);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(t.getUTCHours())}:${p(t.getUTCMinutes())} ${p(t.getUTCDate())}/${p(t.getUTCMonth() + 1)}/${t.getUTCFullYear()}`;
}

/** Thông báo Discord cho đơn nạp. Chỉ ghi các cột thông báo của bảng topups (module topups sở hữu). */
@Injectable()
export class TopupNotifierService {
  private readonly logger = new Logger(TopupNotifierService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(NOTIFIER_PORT) private readonly notifier: NotifierPort,
  ) {}

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
        message: `Đơn nạp ${r.code} chờ duyệt: gói ${r.pack}, ${formatVnd(r.amount_vnd)}, hạn duyệt ${formatVnTime(r.approve_by)} (giờ VN)`,
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
          // Dùng hết lượt thử để bộ quét không gửi lại cùng một thông báo tối đa MAX_NOTIFY_ATTEMPTS lần nữa.
          await this.prisma.$executeRaw`
            UPDATE topups SET notify_attempts = ${MAX_NOTIFY_ATTEMPTS} WHERE id = ${id}::uuid AND notified_at IS NULL`.catch(() => undefined);
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

  /**
   * Cảnh báo đơn pending quá approve_by. Mỗi đơn: nhận lượt (đếm + giãn cách, như notifyPending), gửi, rồi mới đặt
   * overdue_notified_at. Discord lỗi hoặc tiến trình chết giữa chừng thì lượt sau thử lại, tối đa MAX_NOTIFY_ATTEMPTS lần.
   */
  async alertOverdue(): Promise<void> {
    const candidates = await this.prisma.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM topups
      WHERE status = 'pending' AND approve_by < now() AND overdue_notified_at IS NULL
        AND overdue_notify_attempts < ${MAX_NOTIFY_ATTEMPTS}
      ORDER BY approve_by LIMIT 100`;
    for (const c of candidates) {
      let claimed: Array<ClaimedRow & { overdue_notify_attempts: number }>;
      try {
        claimed = await this.prisma.$queryRaw<Array<ClaimedRow & { overdue_notify_attempts: number }>>`
          UPDATE topups SET overdue_notify_attempts = overdue_notify_attempts + 1, overdue_notify_attempted_at = now()
          WHERE id = ${c.id}::uuid AND status = 'pending' AND approve_by < now() AND overdue_notified_at IS NULL
            AND overdue_notify_attempts < ${MAX_NOTIFY_ATTEMPTS}
            AND (overdue_notify_attempted_at IS NULL
                 OR overdue_notify_attempted_at < now() - make_interval(secs => ${NOTIFY_RETRY_INTERVAL_SECONDS}))
          RETURNING id, code, pack, amount_vnd, approve_by, overdue_notify_attempts`;
      } catch (err) {
        // Chưa nhận được đơn này: lần quét sau thử lại, các đơn khác vẫn xử lý.
        this.logger.error(`Nhận cảnh báo quá hạn đơn nạp ${c.id} lỗi: ${String(err)}`);
        continue;
      }
      for (const r of claimed) {
        try {
          await this.notifier.notify({
            kind: 'TOPUP_OVERDUE',
            severity: 'warn',
            message: `Đơn nạp ${r.code} đã quá hạn duyệt: gói ${r.pack}, ${formatVnd(r.amount_vnd)}, hạn duyệt ${formatVnTime(r.approve_by)} (giờ VN)`,
          });
        } catch (err) {
          this.logger.error(`Cảnh báo quá hạn đơn nạp ${r.id} lỗi (lượt ${r.overdue_notify_attempts}/${MAX_NOTIFY_ATTEMPTS}): ${String(err)}`);
          if (r.overdue_notify_attempts >= MAX_NOTIFY_ATTEMPTS) {
            this.logger.error(`Đơn nạp ${r.id} cảnh báo quá hạn thất bại ${MAX_NOTIFY_ATTEMPTS} lần, bỏ qua.`);
          }
          continue;
        }
        try {
          await this.prisma.$executeRaw`
            UPDATE topups SET overdue_notified_at = now() WHERE id = ${r.id}::uuid AND overdue_notified_at IS NULL`;
        } catch (err) {
          // Đã gửi nhưng không ghi được: dùng hết lượt để không gửi trùng nhiều lần.
          this.logger.error(`Đã gửi cảnh báo quá hạn đơn nạp ${r.id} nhưng không ghi được overdue_notified_at: ${String(err)}`);
          await this.prisma.$executeRaw`
            UPDATE topups SET overdue_notify_attempts = ${MAX_NOTIFY_ATTEMPTS} WHERE id = ${r.id}::uuid AND overdue_notified_at IS NULL`.catch(() => undefined);
        }
      }
    }
  }
}
