import crypto from 'node:crypto';
import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import {
  ApiErrorCode,
  getApiErrorMessageVi,
  type FaceSwapCreateRequest,
  type Task,
  type TierSnapshot,
} from '@motion-ai/contracts';
import type { Queue } from 'bullmq';
import { PrismaService } from '../../infra/prisma.service.js';
import { AccountLockedException } from '../auth/guards/account-locked.guard.js';
import { UploadsService } from '../storage/uploads.service.js';
import { PRICING_CONFIG } from '../wallet/tier.js';
import { WalletService } from '../wallet/wallet.service.js';

export const TASKS_QUEUE = 'tasks';
export const MAX_ACTIVE_TASKS_PER_USER = 3;

export class TaskLimitException extends HttpException {
  constructor() {
    super(
      { code: ApiErrorCode.TASK_LIMIT, message: getApiErrorMessageVi(ApiErrorCode.TASK_LIMIT) },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}

@Injectable()
export class TasksService {
  private readonly logger = new Logger(TasksService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly wallet: WalletService,
    private readonly uploads: UploadsService,
    @InjectQueue(TASKS_QUEUE) private readonly queue: Queue,
  ) {}

  async createFaceSwap(userId: string, req: FaceSwapCreateRequest): Promise<Task> {
    const owned = await this.uploads.areConfirmedKeysOwnedBy(userId, [
      req.sourceKey,
      req.targetKey,
    ]);
    if (!owned) {
      throw new BadRequestException({
        code: ApiErrorCode.VALIDATION_FAILED,
        message: getApiErrorMessageVi(ApiErrorCode.VALIDATION_FAILED),
      });
    }

    const taskId = crypto.randomUUID();
    const amount = PRICING_CONFIG.pipelines.faceSwapCredits;

    const { snapshot, task } = await this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<Array<{ tos_version: string; locked_at: Date | null }>>`
        SELECT tos_version, locked_at FROM users WHERE id = ${userId}::uuid FOR UPDATE`;
      if (rows.length !== 1) {
        throw new BadRequestException({
          code: ApiErrorCode.VALIDATION_FAILED,
          message: getApiErrorMessageVi(ApiErrorCode.VALIDATION_FAILED),
        });
      }
      if (rows[0].locked_at !== null) throw new AccountLockedException();
      const active = await tx.task.count({
        where: { userId, status: { in: ['queued', 'running'] } },
      });
      if (active >= MAX_ACTIVE_TASKS_PER_USER) throw new TaskLimitException();

      const snapshot: TierSnapshot = await this.wallet.hold(tx, userId, taskId, amount);
      const task = await tx.task.create({
        data: {
          id: taskId,
          userId,
          pipeline: 'face_swap',
          status: 'queued',
          tierSnapshot: snapshot as unknown as object,
          consent: req.consent,
          tosVersion: rows[0].tos_version,
          inputKeys: { sourceKey: req.sourceKey, targetKey: req.targetKey },
          params: {},
          holdAmount: amount,
        },
      });
      return { snapshot, task };
    });

    try {
      await this.queue.add(
        'process',
        { taskId },
        {
          jobId: taskId,
          priority: snapshot.priority,
          removeOnComplete: true,
          removeOnFail: true,
        },
      );
    } catch (err) {
      this.logger.error(`Không enqueue được Task ${taskId}: ${String(err)}`);
    }

    let queuePosition = 1;
    try {
      queuePosition = await this.queuePosition(taskId);
    } catch (err) {
      this.logger.warn(`Không tính được vị trí hàng đợi của Task ${taskId}: ${String(err)}`);
    }
    return {
      id: task.id,
      pipeline: 'face_swap',
      status: 'queued',
      queuePosition,
      creditCost: task.holdAmount,
      createdAt: task.createdAt.toISOString(),
      updatedAt: task.updatedAt.toISOString(),
    };
  }

  /** Vị trí (bắt đầu từ 1) theo (priority, queued_at, id) trong số Task queued, so với chính dòng trong DB. */
  private async queuePosition(taskId: string): Promise<number> {
    const rows = await this.prisma.$queryRaw<Array<{ n: bigint }>>`
      SELECT COUNT(*)::bigint AS n FROM tasks t
      WHERE t.status = 'queued'
        AND ((t.tier_snapshot->>'priority')::int, t.queued_at, t.id)
          <= (SELECT (r.tier_snapshot->>'priority')::int, r.queued_at, r.id FROM tasks r WHERE r.id = ${taskId}::uuid)`;
    return Math.max(1, Number(rows[0]?.n ?? 1n));
  }
}
