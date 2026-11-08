import crypto from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  ApiErrorCode,
  MAX_OPEN_TOPUPS,
  TOS_VERSION,
  getApiErrorMessageVi,
  type AdminTopup,
  type AdminTopupListQuery,
  type AdminTopupListResponse,
  type Topup,
  type TopupCreateRequest,
  type TopupListQuery,
  type TopupListResponse,
  type TopupPackId,
  type TopupStatus,
} from '@motion-ai/contracts';
import { PrismaService, type PrismaTransactionClient } from '../../infra/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { WalletService } from '../wallet/wallet.service.js';
import { AccountLockedException } from '../auth/guards/account-locked.guard.js';
import { PRICING_CONFIG } from '../wallet/tier.js';
import { computeApproveBy } from './approve-by.js';
import { TopupNotifierService } from './topup-notifier.service.js';
import { buildVietQrPayload } from './vietqr.js';

export const QR_TTL_MS = 15 * 60 * 1000;

/** TTL QR; `TOPUP_QR_TTL_MS` chỉ có hiệu lực khi NODE_ENV=test (smoke test rút ngắn hạn). */
export function qrTtlMs(): number {
  if (process.env.NODE_ENV !== 'test') return QR_TTL_MS;
  const v = Number(process.env.TOPUP_QR_TTL_MS);
  return Number.isInteger(v) && v > 0 ? v : QR_TTL_MS;
}

/** Đồng hồ tính `approve_by`; `TOPUP_FAKE_NOW` (ISO) chỉ có hiệu lực khi NODE_ENV=test. */
export function topupClock(): Date {
  if (process.env.NODE_ENV === 'test' && process.env.TOPUP_FAKE_NOW) {
    const d = new Date(process.env.TOPUP_FAKE_NOW);
    if (!Number.isNaN(d.getTime())) return d;
  }
  return new Date();
}
export const OPEN_TOPUP_STATUSES = ['awaiting_transfer', 'pending', 'needs_review'] as const;
/** Bảng chữ in hoa bỏ ký tự dễ nhầm (0/O, 1/I/L). */
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 8;
const CODE_RETRIES = 5;
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function generateTopupCode(): string {
  let out = '';
  for (let i = 0; i < CODE_LENGTH; i++) out += CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)];
  return out;
}

export class TopupLimitException extends HttpException {
  constructor() {
    super(
      { code: ApiErrorCode.TOPUP_LIMIT, message: getApiErrorMessageVi(ApiErrorCode.TOPUP_LIMIT) },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}

export interface BankAccountConfig {
  bin: string;
  accountNo: string;
  accountName: string;
}

export function readBankAccountConfig(env: NodeJS.ProcessEnv = process.env): BankAccountConfig {
  const bin = env.TOPUP_BANK_BIN?.trim();
  const accountNo = env.TOPUP_BANK_ACCOUNT_NO?.trim();
  const accountName = env.TOPUP_BANK_ACCOUNT_NAME?.trim();
  if (!bin || !accountNo || !accountName || !/^\d{6}$/.test(bin) || !/^\d{6,19}$/.test(accountNo)) {
    // Chi tiết chỉ ghi log vận hành; không lộ tên biến môi trường cho client.
    new Logger('TopupsService').error(
      'Thiếu hoặc sai định dạng cấu hình tài khoản nhận tiền: TOPUP_BANK_BIN (6 chữ số), TOPUP_BANK_ACCOUNT_NO (6-19 chữ số), TOPUP_BANK_ACCOUNT_NAME.',
    );
    throw new InternalServerErrorException({
      code: 'INTERNAL_ERROR',
      message: 'Tạm thời chưa thể tạo hoặc hiển thị mã nạp tiền. Vui lòng thử lại sau.',
    });
  }
  return { bin, accountNo, accountName };
}

interface TopupRow {
  id: string;
  code: string;
  pack: string;
  amountVnd: number;
  status: string;
  qrExpiresAt: Date;
  approveBy: Date | null;
  bankRef: string | null;
  rejectReason: string | null;
  note: string | null;
  createdAt: Date;
  updatedAt: Date;
}

@Injectable()
export class TopupsService {
  private readonly logger = new Logger(TopupsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifier: TopupNotifierService,
    private readonly wallet: WalletService,
    private readonly audit: AuditService,
  ) {}

  private apiError(Ex: new (r: { code: string; message: string }) => Error, code: ApiErrorCode): Error {
    return new Ex({ code, message: getApiErrorMessageVi(code) });
  }

  /**
   * Đơn đang mở cần thông tin tài khoản thật để hiển thị QR. Đơn đã kết thúc không cần,
   * nên thiếu cấu hình không được làm hỏng lịch sử và thao tác Admin.
   */
  private resolveBank(status: string, bank?: BankAccountConfig | null, lenient = false): BankAccountConfig {
    if (bank) return bank;
    if (!lenient && (OPEN_TOPUP_STATUSES as readonly string[]).includes(status)) return readBankAccountConfig();
    try {
      return readBankAccountConfig();
    } catch {
      return { bin: '-', accountNo: '-', accountName: '-' };
    }
  }

  toDto(row: TopupRow, bankInput?: BankAccountConfig | null, lenient = false): Topup {
    const bank = this.resolveBank(row.status, bankInput, lenient);
    const pack = PRICING_CONFIG.topupPacks.find((p) => p.id === row.pack);
    if (!pack) throw new Error(`Gói nạp không hợp lệ: ${row.pack}`);
    const transferContent = `NAP ${row.code}`;
    return {
      id: row.id,
      code: row.code,
      pack: row.pack as TopupPackId,
      status: row.status as TopupStatus,
      amountVnd: row.amountVnd,
      credits: pack.credits,
      transferContent,
      qrPayload:
        bank.bin === '-'
          ? '-'
          : buildVietQrPayload({
              bin: bank.bin,
              accountNo: bank.accountNo,
              amountVnd: row.amountVnd,
              content: transferContent,
            }),
      bankCode: bank.bin,
      accountNumber: bank.accountNo,
      accountName: bank.accountName,
      qrExpiresAt: row.qrExpiresAt.toISOString(),
      approveBy: row.approveBy ? row.approveBy.toISOString() : null,
      bankRef: row.bankRef,
      rejectReason: row.rejectReason,
      note: row.note,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  async create(userId: string, req: TopupCreateRequest): Promise<Topup> {
    const bank = readBankAccountConfig();
    const pack = PRICING_CONFIG.topupPacks.find((p) => p.id === req.pack);
    if (!pack) throw this.apiError(BadRequestException, ApiErrorCode.VALIDATION_FAILED);

    for (let attempt = 0; ; attempt++) {
      const code = generateTopupCode();
      try {
        const row = await this.prisma.$transaction(async (tx) => {
          const users = await tx.$queryRaw<Array<{ locked_at: Date | null }>>`
            SELECT locked_at FROM users WHERE id = ${userId}::uuid FOR UPDATE`;
          if (users.length !== 1) throw this.apiError(NotFoundException, ApiErrorCode.NOT_FOUND);
          if (users[0].locked_at) throw new AccountLockedException();
          // Đơn quá hạn QR không được chiếm chỗ dù bộ quét ở worker chưa chạy tới.
          await tx.$executeRaw`
            UPDATE topups SET status = 'expired', updated_at = now()
            WHERE user_id = ${userId}::uuid AND status = 'awaiting_transfer' AND qr_expires_at <= now()`;
          const open = await tx.topup.count({
            where: { userId, status: { in: [...OPEN_TOPUP_STATUSES] } },
          });
          if (open >= MAX_OPEN_TOPUPS) throw new TopupLimitException();
          return tx.topup.create({
            data: {
              id: crypto.randomUUID(),
              userId,
              code,
              pack: pack.id,
              amountVnd: pack.priceVnd,
              status: 'awaiting_transfer',
              qrExpiresAt: new Date(Date.now() + qrTtlMs()),
              tosVersion: TOS_VERSION,
            },
          });
        });
        return this.toDto(row, bank);
      } catch (err) {
        const e = err as { code?: unknown; meta?: { target?: unknown } };
        // Với adapter pg, P2002 không có `meta.target`; tên ràng buộc nằm trong `driverAdapterError`.
        const meta = JSON.stringify(e.meta ?? '');
        if (e.code === 'P2002' && meta.includes('topups_code_key') && attempt < CODE_RETRIES) continue;
        throw err;
      }
    }
  }

  async getById(userId: string, id: string): Promise<Topup> {
    const row = await this.prisma.topup.findUnique({ where: { id } });
    if (!row) throw this.apiError(NotFoundException, ApiErrorCode.NOT_FOUND);
    if (row.userId !== userId) throw this.apiError(ForbiddenException, ApiErrorCode.FORBIDDEN);
    return this.toDto(row);
  }

  /** awaiting_transfer → pending (CAS); idempotent nếu đã pending. */
  async confirmTransfer(userId: string, id: string): Promise<Topup> {
    const found = await this.prisma.topup.findUnique({ where: { id } });
    if (!found) throw this.apiError(NotFoundException, ApiErrorCode.NOT_FOUND);
    if (found.userId !== userId) throw this.apiError(ForbiddenException, ApiErrorCode.FORBIDDEN);

    const approveBy = computeApproveBy(topupClock());
    const won = await this.prisma.$queryRaw<Array<{ id: string }>>`
      UPDATE topups SET status = 'pending', approve_by = ${approveBy}, updated_at = now()
      WHERE id = ${id}::uuid AND status = 'awaiting_transfer' AND qr_expires_at > now()
      RETURNING id`;
    if (won.length === 0) {
      const cur = await this.prisma.topup.findUnique({ where: { id } });
      if (!cur) throw this.apiError(NotFoundException, ApiErrorCode.NOT_FOUND);
      if (cur.status === 'pending') return this.toDto(cur);
      if (cur.status === 'awaiting_transfer') {
        // Quá hạn QR: ghi expired (CAS) rồi mới báo lỗi.
        const expired = await this.prisma.$executeRaw`
          UPDATE topups SET status = 'expired', updated_at = now()
          WHERE id = ${id}::uuid AND status = 'awaiting_transfer' AND qr_expires_at <= now()`;
        if (expired === 0) {
          // Có bên khác đổi trạng thái giữa hai lần đọc: đọc lại để báo đúng kết quả cuối.
          const latest = await this.prisma.topup.findUnique({ where: { id } });
          if (latest?.status === 'pending') return this.toDto(latest);
          const lapsed =
            latest?.status === 'expired' ||
            (latest?.status === 'awaiting_transfer' && latest.qrExpiresAt.getTime() <= Date.now());
          if (!lapsed) {
            throw this.apiError(ConflictException, ApiErrorCode.TOPUP_STATE_INVALID);
          }
        }
        throw this.apiError(ConflictException, ApiErrorCode.TOPUP_QR_EXPIRED);
      }
      throw this.apiError(ConflictException, ApiErrorCode.TOPUP_STATE_INVALID);
    }
    // Không chặn yêu cầu của người dùng; lỗi chỉ ghi log, bộ quét sẽ thử lại.
    void this.notifier
      .notifyPending(id)
      .catch((err) => this.logger.error(`Thông báo đơn nạp ${id} lỗi: ${String(err)}`));
    const row = await this.prisma.topup.findUnique({ where: { id } });
    if (!row) throw this.apiError(NotFoundException, ApiErrorCode.NOT_FOUND);
    return this.toDto(row);
  }

  /** Bộ quét: đổi mọi đơn awaiting_transfer quá hạn QR sang expired bằng một UPDATE có điều kiện. */
  async expireOverdue(): Promise<number> {
    return this.prisma.$executeRaw`
      UPDATE topups SET status = 'expired', updated_at = now()
      WHERE status = 'awaiting_transfer' AND qr_expires_at <= now()`;
  }

  async list(userId: string, query: TopupListQuery): Promise<TopupListResponse> {
    const pageSize = query.pageSize ?? 20;
    const cursor = query.cursor;
    if (cursor) {
      const owner = UUID_REGEX.test(cursor)
        ? await this.prisma.topup.findFirst({ where: { id: cursor, userId }, select: { id: true } })
        : null;
      if (!owner) throw this.apiError(BadRequestException, ApiErrorCode.VALIDATION_FAILED);
    }
    const rows = await this.prisma.topup.findMany({
      where: { userId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: pageSize + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    const hasMore = rows.length > pageSize;
    const items = hasMore ? rows.slice(0, pageSize) : rows;
    return {
      items: items.map((r) => this.toDto(r)),
      pageSize,
      hasMore,
      nextCursor: hasMore && items.length > 0 ? items[items.length - 1].id : null,
    };
  }
  // ---------------------------------------------------------------- Admin

  toAdminDto(row: TopupRow & { userId: string }, bank?: BankAccountConfig | null): AdminTopup {
    return {
      // Admin duyệt đơn không cần QR: thiếu cấu hình không được chặn hàng chờ duyệt.
      ...this.toDto(row, bank, true),
      userId: row.userId,
      isOverdue: row.status === 'pending' && row.approveBy !== null && row.approveBy.getTime() < Date.now(),
    };
  }

  async adminList(query: AdminTopupListQuery): Promise<AdminTopupListResponse> {
    const pageSize = query.pageSize ?? 20;
    const cursor = query.cursor;
    if (cursor) {
      const found = UUID_REGEX.test(cursor)
        ? await this.prisma.topup.findUnique({ where: { id: cursor }, select: { id: true } })
        : null;
      if (!found) throw this.apiError(BadRequestException, ApiErrorCode.VALIDATION_FAILED);
    }
    const rows = await this.prisma.topup.findMany({
      where: query.status ? { status: query.status } : {},
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: pageSize + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    const hasMore = rows.length > pageSize;
    const items = hasMore ? rows.slice(0, pageSize) : rows;
    return {
      items: items.map((r) => this.toAdminDto(r)),
      pageSize,
      hasMore,
      nextCursor: hasMore && items.length > 0 ? items[items.length - 1].id : null,
    };
  }

  /** CAS trong transaction: trả dòng trước khi đổi, hoặc ném NOT_FOUND / TOPUP_STATE_INVALID. */
  private async casTransition(
    tx: PrismaTransactionClient,
    id: string,
    from: readonly string[],
    data: { status: string; bankRef?: string; rejectReason?: string; note?: string | null; approveBy?: Date; overdueNotifiedAt?: null; overdueNotifyAttempts?: number },
  ) {
    // Khóa dòng để `before` của audit đúng là trạng thái nguồn mà CAS chuyển đi (READ COMMITTED).
    const locked = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM topups WHERE id = ${id}::uuid FOR UPDATE`;
    if (locked.length === 0) throw this.apiError(NotFoundException, ApiErrorCode.NOT_FOUND);
    const before = await tx.topup.findUnique({ where: { id } });
    if (!before) throw this.apiError(NotFoundException, ApiErrorCode.NOT_FOUND);
    const res = await tx.topup.updateMany({ where: { id, status: { in: [...from] } }, data });
    if (res.count === 0) throw this.apiError(ConflictException, ApiErrorCode.TOPUP_STATE_INVALID);
    return before;
  }

  private isBankRefDuplicate(err: unknown): boolean {
    const e = err as { code?: unknown };
    if (e?.code !== 'P2002') return false;
    let text = '';
    try {
      text = JSON.stringify(err, Object.getOwnPropertyNames(err as object));
    } catch {
      text = String(err);
    }
    return text.includes('topups_bank_ref_key');
  }

  private async adminTransition(
    id: string,
    run: (tx: PrismaTransactionClient) => Promise<void>,
  ): Promise<AdminTopup> {
    try {
      await this.prisma.$transaction(run);
    } catch (err) {
      if (this.isBankRefDuplicate(err)) throw this.apiError(ConflictException, ApiErrorCode.BANK_REF_DUPLICATE);
      throw err;
    }
    const row = await this.prisma.topup.findUnique({ where: { id } });
    if (!row) throw this.apiError(NotFoundException, ApiErrorCode.NOT_FOUND);
    return this.toAdminDto(row);
  }

  private async doApprove(
    adminId: string,
    id: string,
    bankRef: string,
    from: 'pending_or_review' | 'expired',
  ): Promise<AdminTopup> {
    const sources = from === 'expired' ? ['expired'] : ['pending', 'needs_review'];
    // Mã giao dịch ngân hàng không phân biệt hoa thường: FT1 và ft1 là cùng một giao dịch.
    bankRef = bankRef.trim().toUpperCase();
    return this.adminTransition(id, async (tx) => {
      const before = await this.casTransition(tx, id, sources, { status: 'approved', bankRef, note: null });
      const pack = PRICING_CONFIG.topupPacks.find((p) => p.id === before.pack);
      if (!pack) throw new Error(`Gói nạp không hợp lệ: ${before.pack}`);
      await this.wallet.topup(tx, before.userId, id, pack.credits, pack.id as TopupPackId);
      await this.audit.record(tx, {
        adminId,
        action: from === 'expired' ? 'topup.approve_expired' : 'topup.approve',
        target: `topup:${id}`,
        beforeAfter: { before: { status: before.status, bankRef: before.bankRef }, after: { status: 'approved', bankRef }, credits: pack.credits },
      });
    });
  }

  approve(adminId: string, id: string, bankRef: string): Promise<AdminTopup> {
    return this.doApprove(adminId, id, bankRef, 'pending_or_review');
  }

  approveExpired(adminId: string, id: string, bankRef: string): Promise<AdminTopup> {
    return this.doApprove(adminId, id, bankRef, 'expired');
  }

  reject(adminId: string, id: string, rejectReason: string): Promise<AdminTopup> {
    return this.adminTransition(id, async (tx) => {
      const before = await this.casTransition(tx, id, ['pending', 'needs_review'], { status: 'rejected', rejectReason, note: null });
      await this.audit.record(tx, {
        adminId,
        action: 'topup.reject',
        target: `topup:${id}`,
        beforeAfter: { before: { status: before.status }, after: { status: 'rejected', rejectReason } },
      });
    });
  }

  markNeedsReview(adminId: string, id: string, note: string): Promise<AdminTopup> {
    return this.adminTransition(id, async (tx) => {
      const before = await this.casTransition(tx, id, ['pending'], { status: 'needs_review', note });
      await this.audit.record(tx, {
        adminId,
        action: 'topup.needs_review',
        target: `topup:${id}`,
        beforeAfter: { before: { status: before.status }, after: { status: 'needs_review', note } },
      });
    });
  }

  returnToPending(adminId: string, id: string): Promise<AdminTopup> {
    return this.adminTransition(id, async (tx) => {
      // Hạn duyệt tính lại từ lúc quay về hàng chờ; giữ giá trị cũ sẽ khiến đơn quá hạn ngay.
      const approveBy = computeApproveBy(topupClock());
      const before = await this.casTransition(tx, id, ['needs_review'], { status: 'pending', note: null, approveBy, overdueNotifiedAt: null, overdueNotifyAttempts: 0 });
      await this.audit.record(tx, {
        adminId,
        action: 'topup.return_to_pending',
        target: `topup:${id}`,
        beforeAfter: { before: { status: before.status, note: before.note }, after: { status: 'pending', approveBy: approveBy.toISOString() } },
      });
    });
  }
}
