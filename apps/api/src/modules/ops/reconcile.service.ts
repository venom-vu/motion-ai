import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../infra/prisma.service.js';
import { NOTIFIER_PORT, type NotifierPort } from '../../ports/index.js';

export interface LedgerMismatch {
  userId: string;
  balance: string;
  expectedBalance: string;
  held: string;
  expectedHeld: string;
}

@Injectable()
export class ReconcileService {
  private readonly logger = new Logger(ReconcileService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(NOTIFIER_PORT) private readonly notifier: NotifierPort,
  ) {}

  /** Chỉ tiến trình worker chạy job (AR14). */
  @Cron('0 3 * * *', { timeZone: 'Asia/Ho_Chi_Minh' })
  async scheduledReconcile(): Promise<void> {
    if (process.env.MOTION_PROCESS_ROLE !== 'worker') return;
    try {
      await this.reconcile();
    } catch (err) {
      this.logger.error(`Job đối soát thất bại: ${String(err)}`);
      try {
        await this.notifier.notify({
          kind: 'RECONCILE_FAILED',
          severity: 'error',
          message: `Job đối soát thất bại: ${String(err)}`,
        });
      } catch {
        // Không để lỗi cảnh báo che lỗi gốc.
      }
    }
  }

  /**
   * balance = SUM(amount); held = tổng HOLD chưa có CAPTURED/RELEASED.
   * Trả về danh sách user lệch và báo mỗi user một lần.
   */
  async reconcile(): Promise<LedgerMismatch[]> {
    const rows = await this.prisma.$queryRaw<
      Array<{
        id: string;
        balance: bigint;
        held: bigint;
        sum_amount: bigint;
        open_hold: bigint;
      }>
    >`SELECT u.id, u.balance, u.held,
        COALESCE((SELECT SUM(l.amount) FROM ledger_entries l WHERE l.user_id = u.id), 0)::bigint AS sum_amount,
        COALESCE((SELECT -SUM(h.amount) FROM ledger_entries h
          WHERE h.user_id = u.id AND h.type = 'HOLD'
            AND NOT EXISTS (SELECT 1 FROM ledger_entries s
              WHERE s.task_id = h.task_id AND s.type IN ('CAPTURED','RELEASED'))), 0)::bigint AS open_hold
      FROM users u`;
    const mismatches: LedgerMismatch[] = [];
    for (const r of rows) {
      if (BigInt(r.balance) !== BigInt(r.sum_amount) || BigInt(r.held) !== BigInt(r.open_hold)) {
        mismatches.push({
          userId: r.id,
          balance: String(r.balance),
          expectedBalance: String(r.sum_amount),
          held: String(r.held),
          expectedHeld: String(r.open_hold),
        });
      }
    }
    for (const m of mismatches) {
      this.logger.error(`Lệch sổ cái user ${m.userId}: ${JSON.stringify(m)}`);
      try {
        await this.notifier.notify({
          kind: 'LEDGER_MISMATCH',
          severity: 'error',
          message: `Lệch sổ cái user ${m.userId}`,
          data: { ...m },
        });
      } catch (err) {
        this.logger.error(`Không gửi được cảnh báo: ${String(err)}`);
      }
    }
    return mismatches;
  }
}
