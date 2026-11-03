import {
  HttpException,
  HttpStatus,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
import {
  ApiErrorCode,
  getApiErrorMessageVi,
  type TopupPackId,
} from '@motion-ai/contracts';
import type { PrismaTransactionClient } from '../../infra/prisma.service.js';

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

@Injectable()
export class WalletService {
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
  ): Promise<{ balance: bigint; held: bigint }> {
    const rows = await tx.$queryRaw<
      Array<{ balance: bigint; held: bigint }>
    >`SELECT balance, held FROM users WHERE id = ${userId}::uuid FOR UPDATE`;
    if (rows.length !== 1) {
      throw new WalletConflictException('Không tìm thấy người dùng');
    }
    return { balance: BigInt(rows[0].balance), held: BigInt(rows[0].held) };
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
  ): Promise<void> {
    await tx.$executeRaw`UPDATE users SET balance = balance + ${balanceDelta}, held = held + ${heldDelta} WHERE id = ${userId}::uuid`;
  }

  async hold(
    tx: PrismaTransactionClient,
    userId: string,
    taskId: string,
    amount: Amount,
  ): Promise<void> {
    this.assertTx(tx);
    this.assertId(userId, 'userId');
    this.assertId(taskId, 'taskId');
    const value = this.toPositive(amount);
    const { balance } = await this.lockUser(tx, userId);
    if (balance < value) {
      throw new InsufficientCreditException();
    }
    await this.insertEntry(tx, {
      userId,
      type: 'HOLD',
      amount: -value,
      taskId,
    });
    await this.applyDelta(tx, userId, -value, value);
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
    await this.lockUser(tx, hold.userId);
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
      await this.applyDelta(tx, hold.userId, 0n, -value);
    } else {
      await this.insertEntry(tx, {
        userId: hold.userId,
        type: 'RELEASED',
        amount: value,
        taskId,
      });
      await this.applyDelta(tx, hold.userId, value, -value);
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
    await this.lockUser(tx, userId);
    await this.insertEntry(tx, { userId, type: 'GRANT', amount: value });
    await this.applyDelta(tx, userId, value, 0n);
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
    await this.lockUser(tx, userId);
    await this.insertEntry(tx, {
      userId,
      type: 'TOPUP',
      amount: value,
      pack,
      topupId,
    });
    await this.applyDelta(tx, userId, value, 0n);
  }
}
