import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  InternalServerErrorException,
  Optional,
} from '@nestjs/common';
import {
  ApiErrorCode,
  LEDGER_ENTRY_LABELS_VI,
  getApiErrorMessageVi,
  type AccountTier,
  type LedgerEntry,
  type LedgerEntryType,
  type TierSnapshot,
  type TopupPackId,
  type WalletLedgerResponse,
} from '@flowvis/contracts';
import {
  PrismaService,
  type PrismaTransactionClient,
} from '../../infra/prisma.service.js';
import {
  computeTierPack,
  isTopupPack,
  snapshotFromPack,
  tierFromPack,
} from './tier.js';

export class InsufficientCreditException extends HttpException {
  constructor() {
    super(
      {
        code: ApiErrorCode.INSUFFICIENT_CREDIT,
        message: getApiErrorMessageVi(ApiErrorCode.INSUFFICIENT_CREDIT),
      },
      HttpStatus.PAYMENT_REQUIRED,
    );
  }
}

/** Lỗi nghiệp vụ ví (thiếu HOLD, đã chốt, trùng bút toán...). */
export class WalletConflictException extends HttpException {
  constructor(message: string) {
    super({ message }, HttpStatus.CONFLICT);
  }
}

type Amount = number | bigint;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    (err as { code?: unknown }).code === 'P2002'
  );
}

function toSafeNumber(value: bigint, label: string): number {
  if (value > BigInt(Number.MAX_SAFE_INTEGER) || value < BigInt(Number.MIN_SAFE_INTEGER)) {
    throw new InternalServerErrorException(
      `${label} vượt quá Number.MAX_SAFE_INTEGER`,
    );
  }
  return Number(value);
}

interface LockedUser {
  balance: bigint;
  held: bigint;
  tierPack: string | null;
}

export interface WalletSummary {
  tier: AccountTier;
  balance: number;
  held: number;
}

@Injectable()
export class WalletService {
  constructor(
    @Optional() @Inject(PrismaService) private readonly prisma?: PrismaService,
  ) {}

  private assertTx(tx: PrismaTransactionClient | undefined | null): void {
    if (
      !tx ||
      typeof tx.$queryRaw !== 'function' ||
      typeof (tx as { $connect?: unknown }).$connect === 'function'
    ) {
      throw new InternalServerErrorException(
        'WalletService yêu cầu transaction client (tx)',
      );
    }
  }

  private assertId(value: string | undefined | null, label: string): void {
    if (typeof value !== 'string' || !UUID_RE.test(value)) {
      throw new WalletConflictException(`${label} không hợp lệ`);
    }
  }

  private toPositive(amount: Amount): bigint {
    if (typeof amount === 'number' && !Number.isSafeInteger(amount)) {
      throw new WalletConflictException('Số credit phải là số nguyên');
    }
    const value = BigInt(amount);
    if (value <= 0n) {
      throw new WalletConflictException('Số credit phải lớn hơn 0');
    }
    return value;
  }

  /** Khóa đúng một dòng users và trả về balance/held hiện tại. */
  private async lockUser(
    tx: PrismaTransactionClient,
    userId: string,
  ): Promise<LockedUser> {
    const rows = await tx.$queryRaw<
      Array<{ balance: bigint; held: bigint; tier_pack: string | null }>
    >`SELECT balance, held, tier_pack FROM users WHERE id = ${userId}::uuid FOR UPDATE`;
    if (rows.length !== 1) {
      throw new WalletConflictException('Không tìm thấy người dùng');
    }
    return {
      balance: BigInt(rows[0].balance),
      held: BigInt(rows[0].held),
      tierPack: rows[0].tier_pack,
    };
  }

  /** Ghi bút toán; P2002 được ném ngay (không truy vấn tiếp) để rollback. */
  private async insertEntry(
    tx: PrismaTransactionClient,
    data: {
      userId: string;
      type: string;
      amount: bigint;
      taskId?: string;
      topupId?: string;
      pack?: string;
    },
  ): Promise<void> {
    try {
      await tx.ledgerEntry.create({ data });
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new WalletConflictException(
          'Bút toán trùng lặp, giao dịch bị hủy',
        );
      }
      throw err;
    }
  }

  private async applyDelta(
    tx: PrismaTransactionClient,
    userId: string,
    balanceDelta: bigint,
    heldDelta: bigint,
    locked: LockedUser,
    recomputeTier?: { topupPack?: TopupPackId },
  ): Promise<void> {
    if (!recomputeTier) {
      await tx.$executeRaw`UPDATE users SET balance = balance + ${balanceDelta}, held = held + ${heldDelta} WHERE id = ${userId}::uuid`;
      return;
    }
    const total =
      locked.balance + locked.held + balanceDelta + heldDelta;
    const tierPack = computeTierPack({
      current: locked.tierPack,
      total,
      topupPack: recomputeTier.topupPack,
    });
    await tx.$executeRaw`UPDATE users SET balance = balance + ${balanceDelta}, held = held + ${heldDelta}, tier_pack = ${tierPack} WHERE id = ${userId}::uuid`;
  }

  async hold(
    tx: PrismaTransactionClient,
    userId: string,
    taskId: string,
    amount: Amount,
  ): Promise<TierSnapshot> {
    this.assertTx(tx);
    this.assertId(userId, 'userId');
    this.assertId(taskId, 'taskId');
    const value = this.toPositive(amount);
    const locked = await this.lockUser(tx, userId);
    const { balance } = locked;
    if (balance < value) {
      throw new InsufficientCreditException();
    }
    await this.insertEntry(tx, {
      userId,
      type: 'HOLD',
      amount: -value,
      taskId,
    });
    await this.applyDelta(tx, userId, -value, value, locked);
    return snapshotFromPack(locked.tierPack);
  }

  private async settle(
    tx: PrismaTransactionClient,
    taskId: string,
    kind: 'CAPTURED' | 'RELEASED',
  ): Promise<void> {
    this.assertTx(tx);
    this.assertId(taskId, 'taskId');
    const hold = await tx.ledgerEntry.findFirst({
      where: { taskId, type: 'HOLD' },
    });
    if (!hold) {
      throw new WalletConflictException('Không tìm thấy HOLD của tác vụ');
    }
    const locked = await this.lockUser(tx, hold.userId);
    const settled = await tx.ledgerEntry.findFirst({
      where: { taskId, type: { in: ['CAPTURED', 'RELEASED'] } },
    });
    if (settled) {
      throw new WalletConflictException('Tác vụ đã được chốt hoặc hoàn');
    }
    const value = -hold.amount;
    if (kind === 'CAPTURED') {
      await this.insertEntry(tx, {
        userId: hold.userId,
        type: 'CAPTURED',
        amount: 0n,
        taskId,
      });
      await this.applyDelta(tx, hold.userId, 0n, -value, locked, {});
    } else {
      await this.insertEntry(tx, {
        userId: hold.userId,
        type: 'RELEASED',
        amount: value,
        taskId,
      });
      await this.applyDelta(tx, hold.userId, value, -value, locked);
    }
  }

  async capture(tx: PrismaTransactionClient, taskId: string): Promise<void> {
    return this.settle(tx, taskId, 'CAPTURED');
  }

  async release(tx: PrismaTransactionClient, taskId: string): Promise<void> {
    return this.settle(tx, taskId, 'RELEASED');
  }

  async grant(
    tx: PrismaTransactionClient,
    userId: string,
    amount: Amount,
  ): Promise<void> {
    this.assertTx(tx);
    this.assertId(userId, 'userId');
    const value = this.toPositive(amount);
    const locked = await this.lockUser(tx, userId);
    await this.insertEntry(tx, { userId, type: 'GRANT', amount: value });
    await this.applyDelta(tx, userId, value, 0n, locked, {});
  }

  async topup(
    tx: PrismaTransactionClient,
    userId: string,
    topupId: string,
    amount: Amount,
    pack: TopupPackId,
  ): Promise<void> {
    this.assertTx(tx);
    this.assertId(userId, 'userId');
    this.assertId(topupId, 'topupId');
    const value = this.toPositive(amount);
    const locked = await this.lockUser(tx, userId);
    await this.insertEntry(tx, {
      userId,
      type: 'TOPUP',
      amount: value,
      pack,
      topupId,
    });
    await this.applyDelta(tx, userId, value, 0n, locked, { topupPack: pack });
  }

  /** ADJUST tối thiểu: amount khác 0, không cho balance âm, rồi tính lại Tier. */
  async adjust(
    tx: PrismaTransactionClient,
    userId: string,
    amount: Amount,
  ): Promise<void> {
    this.assertTx(tx);
    this.assertId(userId, 'userId');
    if (typeof amount === 'number' && !Number.isSafeInteger(amount)) {
      throw new WalletConflictException('Số credit phải là số nguyên');
    }
    let value: bigint;
    try {
      value = BigInt(amount);
    } catch {
      throw new WalletConflictException('Số credit phải là số nguyên');
    }
    if (value === 0n) {
      throw new WalletConflictException('Số credit điều chỉnh phải khác 0');
    }
    const locked = await this.lockUser(tx, userId);
    if (locked.balance + value < 0n) {
      throw new InsufficientCreditException();
    }
    await this.insertEntry(tx, { userId, type: 'ADJUST', amount: value });
    await this.applyDelta(tx, userId, value, 0n, locked, {});
  }

  private requirePrisma(): PrismaService {
    if (!this.prisma) {
      throw new InternalServerErrorException('WalletService thiếu PrismaService');
    }
    return this.prisma;
  }

  async getSummary(userId: string): Promise<WalletSummary> {
    this.assertId(userId, 'userId');
    const user = await this.requirePrisma().user.findUnique({
      where: { id: userId },
      select: { balance: true, held: true, tierPack: true },
    });
    if (!user) throw new WalletConflictException('Không tìm thấy người dùng');
    return {
      tier: tierFromPack(user.tierPack),
      balance: toSafeNumber(user.balance, 'balance'),
      held: toSafeNumber(user.held, 'held'),
    };
  }

  async listLedger(
    userId: string,
    pageSize: number,
    cursor?: string,
  ): Promise<WalletLedgerResponse> {
    this.assertId(userId, 'userId');
    const prisma = this.requirePrisma();
    let before: { createdAt: Date; id: string } | null = null;
    if (cursor !== undefined) {
      before = this.decodeCursor(cursor);
    }
    const rows = before
      ? await prisma.$queryRaw<LedgerRow[]>`SELECT id, user_id, type, amount, task_id, topup_id, pack, date_trunc('milliseconds', created_at) AS created_at FROM ledger_entries WHERE user_id = ${userId}::uuid AND (date_trunc('milliseconds', created_at), id) < (${before.createdAt}, ${before.id}::uuid) ORDER BY date_trunc('milliseconds', created_at) DESC, id DESC LIMIT ${pageSize + 1}`
      : await prisma.$queryRaw<LedgerRow[]>`SELECT id, user_id, type, amount, task_id, topup_id, pack, date_trunc('milliseconds', created_at) AS created_at FROM ledger_entries WHERE user_id = ${userId}::uuid ORDER BY date_trunc('milliseconds', created_at) DESC, id DESC LIMIT ${pageSize + 1}`;
    const hasMore = rows.length > pageSize;
    const page = rows.slice(0, pageSize);
    const items: LedgerEntry[] = page.map((r) => ({
      id: r.id,
      userId: r.user_id,
      type: r.type as LedgerEntryType,
      labelVi: LEDGER_ENTRY_LABELS_VI[r.type as LedgerEntryType],
      amount: toSafeNumber(BigInt(r.amount), 'amount'),
      taskId: r.task_id,
      topupId: r.topup_id,
      pack: isTopupPack(r.pack) ? r.pack : null,
      createdAt: r.created_at.toISOString(),
    }));
    const last = page[page.length - 1];
    return {
      items,
      pageSize,
      hasMore,
      nextCursor:
        hasMore && last ? this.encodeCursor(last.created_at, last.id) : null,
    };
  }

  private encodeCursor(createdAt: Date, id: string): string {
    return Buffer.from(`${createdAt.toISOString()}|${id}`).toString(
      'base64url',
    );
  }

  private decodeCursor(cursor: string): { createdAt: Date; id: string } {
    const invalid = () =>
      new BadRequestException({
        code: ApiErrorCode.VALIDATION_FAILED,
        message: getApiErrorMessageVi(ApiErrorCode.VALIDATION_FAILED),
      });
    if (cursor.length > 128 || !/^[A-Za-z0-9_-]+$/.test(cursor)) throw invalid();
    const [iso, id, ...rest] = Buffer.from(cursor, 'base64url')
      .toString('utf8')
      .split('|');
    if (rest.length || !iso || !id || !UUID_RE.test(id)) throw invalid();
    const createdAt = new Date(iso);
    if (Number.isNaN(createdAt.getTime()) || createdAt.toISOString() !== iso) {
      throw invalid();
    }
    return { createdAt, id };
  }
}

interface LedgerRow {
  id: string;
  user_id: string;
  type: string;
  amount: bigint;
  task_id: string | null;
  topup_id: string | null;
  pack: string | null;
  created_at: Date;
}
