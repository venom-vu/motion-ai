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
  type Topup,
  type TopupCreateRequest,
  type TopupListQuery,
  type TopupListResponse,
  type TopupPackId,
  type TopupStatus,
} from '@motion-ai/contracts';
import { PrismaService } from '../../infra/prisma.service.js';
import { AccountLockedException } from '../auth/guards/account-locked.guard.js';
import { PRICING_CONFIG } from '../wallet/tier.js';
import { computeApproveBy } from './approve-by.js';
import { TopupNotifierService } from './topup-notifier.service.js';
import { buildVietQrPayload } from './vietqr.js';

export const QR_TTL_MS = 15 * 60 * 1000;
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
  if (!bin || !accountNo || !accountName) {
    // Chi tiết chỉ ghi log vận hành; không lộ tên biến môi trường cho client.
    new Logger('TopupsService').error(
      'Thiếu cấu hình tài khoản nhận tiền: cần TOPUP_BANK_BIN, TOPUP_BANK_ACCOUNT_NO, TOPUP_BANK_ACCOUNT_NAME.',
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
  ) {}

  private apiError(Ex: new (r: { code: string; message: string }) => Error, code: ApiErrorCode): Error {
    return new Ex({ code, message: getApiErrorMessageVi(code) });
  }

  toDto(row: TopupRow, bank: BankAccountConfig = readBankAccountConfig()): Topup {
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
      qrPayload: buildVietQrPayload({
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
              qrExpiresAt: new Date(Date.now() + QR_TTL_MS),
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

    const approveBy = computeApproveBy(new Date());
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
          if (latest?.status !== 'expired') {
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
    const bank = items.length > 0 ? readBankAccountConfig() : undefined;
    return {
      items: items.map((r) => this.toDto(r, bank)),
      pageSize,
      hasMore,
      nextCursor: hasMore && items.length > 0 ? items[items.length - 1].id : null,
    };
  }
}
