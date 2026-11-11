import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  ApiErrorCode,
  getApiErrorMessageVi,
  getValidationReasonMessageVi,
  type AdminAdjustRequest,
  type AdminAdjustResponse,
  type AdminUser,
  type AdminUserLedgerResponse,
  type LedgerEntry,
  type ValidationReason,
} from '@flowvis/contracts';
import { PrismaService, type PrismaTransactionClient } from '../../infra/prisma.service.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { AuditService } from '../audit/audit.service.js';
import { AuthService } from '../auth/auth.service.js';
import { InsufficientCreditException, WalletService } from '../wallet/wallet.service.js';
import { tierFromPack } from '../wallet/tier.js';

const DEFAULT_ADJUST_MAX = 30000;

export function resolveAdjustMax(): number {
  const raw = process.env.ADMIN_ADJUST_MAX;
  if (raw === undefined || !/^\d+$/.test(raw.trim())) return DEFAULT_ADJUST_MAX;
  const n = Number(raw.trim());
  return Number.isSafeInteger(n) && n > 0 ? n : DEFAULT_ADJUST_MAX;
}

function validation(reason: ValidationReason): BadRequestException {
  return new BadRequestException({
    code: ApiErrorCode.VALIDATION_FAILED,
    message: getValidationReasonMessageVi(reason),
    details: { reason },
  });
}

function notFound(): NotFoundException {
  return new NotFoundException({ code: ApiErrorCode.NOT_FOUND, message: getApiErrorMessageVi(ApiErrorCode.NOT_FOUND) });
}

interface UserRow {
  id: string;
  email: string;
  role: string;
  tierPack: string | null;
  balance: bigint;
  held: bigint;
  lockedAt: Date | null;
  createdAt: Date;
}

function toAdminUser(u: UserRow): AdminUser {
  return {
    id: u.id,
    email: u.email,
    role: u.role as AdminUser['role'],
    tier: tierFromPack(u.tierPack),
    balance: Number(u.balance),
    held: Number(u.held),
    lockedAt: u.lockedAt ? u.lockedAt.toISOString() : null,
    createdAt: u.createdAt.toISOString(),
  };
}

@Injectable()
export class AdminUsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly auth: AuthService,
    private readonly wallet: WalletService,
  ) {}

  private async load(client: PrismaService | PrismaTransactionClient, where: { id?: string; email?: string }): Promise<AdminUser> {
    const u =
      where.id !== undefined
        ? await client.user.findUnique({ where: { id: where.id } })
        : await client.user.findFirst({ where: { email: { equals: where.email, mode: 'insensitive' } } });
    if (!u) throw notFound();
    return toAdminUser(u);
  }

  findByEmail(email: string): Promise<AdminUser> {
    return this.load(this.prisma, { email: email.trim() });
  }

  get(id: string): Promise<AdminUser> {
    return this.load(this.prisma, { id });
  }

  async ledger(id: string, pageSize: number, cursor?: string): Promise<AdminUserLedgerResponse> {
    await this.load(this.prisma, { id });
    return this.wallet.listLedger(id, pageSize, cursor);
  }

  async lock(adminId: string, id: string, reason: string): Promise<AdminUser> {
    return this.prisma.$transaction(async (tx) => {
      const { before, after } = await this.auth.lockAccount(tx, id);
      await this.audit.record(tx, {
        adminId,
        action: 'user.lock',
        target: `user:${id}`,
        beforeAfter: { before: { lockedAt: before ? before.toISOString() : null }, after: { lockedAt: after.toISOString() }, reason },
      });
      return this.load(tx, { id });
    });
  }

  async unlock(adminId: string, id: string, reason: string): Promise<AdminUser> {
    return this.prisma.$transaction(async (tx) => {
      const { before } = await this.auth.unlockAccount(tx, id);
      await this.audit.record(tx, {
        adminId,
        action: 'user.unlock',
        target: `user:${id}`,
        beforeAfter: { before: { lockedAt: before ? before.toISOString() : null }, after: { lockedAt: null }, reason },
      });
      return this.load(tx, { id });
    });
  }

  private async replay(adminId: string, id: string, req: AdminAdjustRequest): Promise<AdminAdjustResponse | null> {
    const found = await this.audit.findByRequestId(req.requestId);
    if (!found) return null;
    if (found.action !== 'wallet.adjust' || found.target !== `user:${id}` || found.adminId !== adminId) {
      throw this.requestIdConflict();
    }
    const ba = found.beforeAfter as { result?: AdminAdjustResponse; amount?: number; reason?: string } | null;
    if (!ba?.result || ba.amount !== req.amount || ba.reason !== req.reason) throw this.requestIdConflict();
    return ba.result;
  }

  private requestIdConflict(): BadRequestException {
    return new BadRequestException({
      code: ApiErrorCode.VALIDATION_FAILED,
      message: getApiErrorMessageVi(ApiErrorCode.VALIDATION_FAILED),
    });
  }

  async adjust(adminId: string, id: string, req: AdminAdjustRequest): Promise<AdminAdjustResponse> {
    await this.load(this.prisma, { id });
    const prior = await this.replay(adminId, id, req);
    if (prior) return prior;
    if (Math.abs(req.amount) > resolveAdjustMax()) throw validation('ADJUST_OVER_LIMIT');
    try {
      return await this.prisma.$transaction(async (tx) => {
        const res = await this.wallet.adjust(tx, id, req.amount);
        const user = await this.load(tx, { id });
        const entry: LedgerEntry = res.entry;
        const result: AdminAdjustResponse = { user, entry };
        await this.audit.record(tx, {
          adminId,
          action: 'wallet.adjust',
          target: `user:${id}`,
          requestId: req.requestId,
          beforeAfter: {
            reason: req.reason,
            requestId: req.requestId,
            amount: req.amount,
            entryId: entry.id,
            ...(entry.taskId ? { taskId: entry.taskId } : {}),
            before: { balance: res.balanceBefore },
            after: { balance: res.balanceAfter },
            result: result as unknown as Prisma.InputJsonValue,
          },
        });
        return result;
      });
    } catch (err) {
      // Mọi lỗi trong transaction: nếu lần gọi trước cùng requestId đã commit thì phát lại kết quả đó.
      const prior2 = await this.replay(adminId, id, req);
      if (prior2) return prior2;
      if (err instanceof InsufficientCreditException) throw validation('ADJUST_INSUFFICIENT_BALANCE');
      throw err;
    }
  }
}
