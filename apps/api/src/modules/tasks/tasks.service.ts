import crypto from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  Inject,
  NotFoundException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import {
  ApiErrorCode,
  getApiErrorMessageVi,
  BodyRetouchCreateRequestSchema,
  type BodyRetouchCreateRequest,
  type FaceSwapCreateRequest,
  type ReasonCode,
  type Task,
  type TaskListQuery,
  type TaskListResponse,
  type TaskResultResponse,
  type TaskStatus,
  type TierSnapshot,
} from '@flowvis/contracts';
import type { Queue } from 'bullmq';
import { PrismaService } from '../../infra/prisma.service.js';
import { RedisService } from '../../infra/redis.service.js';
import { assertValidTransition, isTerminal } from './task-transitions.js';
import { AccountLockedException } from '../auth/guards/account-locked.guard.js';
import { STORAGE_PORT, type StoragePort } from '../../ports/index.js';
import { PipelinesService } from '../pipelines/pipelines.service.js';
import { UploadsService } from '../storage/uploads.service.js';
import { PRICING_CONFIG } from '../wallet/tier.js';
import { WalletService } from '../wallet/wallet.service.js';

export const TASKS_QUEUE = 'tasks';
export const MAX_ACTIVE_TASKS_PER_USER = 3;
/** Giới hạn chờ enqueue để phản hồi tạo Task luôn dưới 2 giây khi Redis treo; bộ quét sẽ enqueue lại. */
export const ENQUEUE_TIMEOUT_MS = 1500;
export const RESULT_URL_TTL_SECONDS = 600;

export interface SweepRow {
  id: string;
  user_id?: string;
  enqueue_attempts: number;
  priority: number;
  deadline_at: Date | null;
  prep_deadline_at: Date | null;
  gate_deadline: Date | null;
}

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
    private readonly redis: RedisService,
    private readonly pipelines: PipelinesService,
    @Inject(STORAGE_PORT) private readonly storage: StoragePort,
  ) {}

  /**
   * Cửa duy nhất đổi trạng thái Task (compare-and-set). Trả applied=false khi Task không còn ở `from`.
   */
  async transition(
    taskId: string,
    from: TaskStatus,
    to: TaskStatus,
    reasonCode?: ReasonCode | null,
    opts: { resultKey?: string; gpuCoins?: number; orphanForMs?: number } = {},
  ): Promise<{ applied: boolean }> {
    assertValidTransition(from, to, reasonCode);
    const resultKey = opts.resultKey ?? null;
    const gpuCoins = opts.gpuCoins ?? null;
    const orphanMs = opts.orphanForMs ?? null;
    if (gpuCoins !== null && !Number.isInteger(gpuCoins)) throw new Error('gpuCoins phải là số nguyên');
    if (orphanMs !== null && !(Number.isInteger(orphanMs) && orphanMs >= 0)) {
      throw new Error('orphanForMs phải là số nguyên không âm');
    }
    const terminal = isTerminal(to);
    const toRunning = to === 'running';
    if (to === 'succeeded') {
      if (!resultKey || !/^out\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(resultKey)) {
        throw new Error('Chuyển sang succeeded cần resultKey dạng out/<userId>/<uuid>');
      }
    } else if (resultKey !== null) {
      throw new Error('resultKey chỉ dùng khi chuyển sang succeeded');
    }

    const result = await this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<Array<{ id: string; user_id: string }>>`
        UPDATE tasks
        SET status = ${to}, reason_code = ${reasonCode ?? null}, result_key = ${resultKey}, updated_at = now(),
          finished_at = CASE WHEN ${terminal}::boolean THEN now() ELSE finished_at END,
          running_at = CASE WHEN ${toRunning}::boolean THEN now() ELSE running_at END,
          prep_deadline_at = CASE WHEN ${toRunning}::boolean THEN now() + interval '120 seconds' ELSE prep_deadline_at END,
          gate_deadline = CASE WHEN ${toRunning}::boolean THEN now() + interval '15 minutes' ELSE gate_deadline END,
          gpu_coins = COALESCE(${gpuCoins}::int, gpu_coins),
          rh_orphan_until = CASE WHEN ${orphanMs}::int IS NOT NULL
            THEN now() + (${orphanMs}::int * interval '1 millisecond') ELSE rh_orphan_until END
        WHERE id = ${taskId}::uuid AND status = ${from}
        RETURNING id, user_id`;
      if (rows.length === 0) return { applied: false };
      if (resultKey !== null && !resultKey.startsWith(`out/${rows[0].user_id}/`)) {
        throw new Error('resultKey không thuộc chủ Task');
      }
      if (to === 'succeeded') await this.wallet.capture(tx, taskId);
      else if (to === 'failed' || to === 'timed_out' || to === 'cancelled') {
        await this.wallet.release(tx, taskId);
      }
      return { applied: true };
    });
    if (result.applied && isTerminal(to)) {
      // Chỉ là gợi ý nên không chờ: Redis treo không được làm trễ phản hồi sau khi DB đã commit.
      void this.redis.client.set(`task:terminal:${taskId}`, '1', 'EX', 30, 'NX').catch(() => {});
    }
    return result;
  }

  /** Bộ quét: Task queued quá `olderThanMs` kể từ queued_at. */
  async sweepQueued(olderThanMs: number, limit = 100) {
    return this.prisma.$queryRaw<SweepRow[]>`
      SELECT id, enqueue_attempts, (tier_snapshot->>'priority')::int AS priority,
        deadline_at, prep_deadline_at, gate_deadline
      FROM tasks
      WHERE status = 'queued' AND queued_at < now() - (${olderThanMs}::int * interval '1 millisecond')
      ORDER BY queued_at LIMIT ${limit}`;
  }

  /** Bộ quét: Task FREE (Priority của Tier Snapshot) queued quá `waitMs` kể từ queued_at. */
  async sweepFreeExpired(waitMs: number, limit = 100) {
    const freePriority = PRICING_CONFIG.tiers.find((t) => t.tier === 'FREE')!.priority;
    return this.prisma.$queryRaw<SweepRow[]>`
      SELECT id, user_id, enqueue_attempts, (tier_snapshot->>'priority')::int AS priority,
        deadline_at, prep_deadline_at, gate_deadline
      FROM tasks
      WHERE status = 'queued' AND (tier_snapshot->>'priority')::int = ${freePriority}::int
        AND queued_at < now() - (${waitMs}::int * interval '1 millisecond')
      ORDER BY queued_at LIMIT ${limit}`;
  }

  /** Bộ quét: Task running có hạn chót nào đó đã qua (deadline_at, gate_deadline hoặc prep_deadline_at). */
  async sweepRunningExpired(limit = 100) {
    return this.prisma.$queryRaw<SweepRow[]>`
      SELECT id, enqueue_attempts, (tier_snapshot->>'priority')::int AS priority,
        deadline_at, prep_deadline_at, gate_deadline
      FROM tasks
      WHERE status = 'running' AND (deadline_at <= now()
        OR (deadline_at IS NULL AND (gate_deadline <= now() OR prep_deadline_at <= now()))) IS TRUE
      ORDER BY running_at LIMIT ${limit}`;
  }

  /** Bộ quét: Task running chưa quá hạn (để kiểm tra job còn sống). */
  async sweepRunningLive(limit = 100) {
    return this.prisma.$queryRaw<SweepRow[]>`
      SELECT id, enqueue_attempts, (tier_snapshot->>'priority')::int AS priority,
        deadline_at, prep_deadline_at, gate_deadline
      FROM tasks
      WHERE status = 'running' AND (deadline_at <= now()
        OR (deadline_at IS NULL AND (gate_deadline <= now() OR prep_deadline_at <= now()))) IS NOT TRUE
      ORDER BY running_at LIMIT ${limit}`;
  }

  /** Tăng enqueue_attempts khi Task còn queued. Trả true nếu áp dụng. */
  async bumpEnqueueAttempts(taskId: string): Promise<boolean> {
    const n = await this.prisma.$executeRaw`
      UPDATE tasks SET enqueue_attempts = enqueue_attempts + 1 WHERE id = ${taskId}::uuid AND status = 'queued'`;
    return n > 0;
  }

  /** Đọc Task cho worker (chỉ đọc). */
  async getWorkerRow(taskId: string) {
    return this.prisma.task.findUnique({ where: { id: taskId } });
  }

  /** Số slot RunningHub đang bị chiếm: Task running đã qua cổng + Task kết thúc còn orphan. */
  async countGateOccupied(): Promise<number> {
    const rows = await this.prisma.$queryRaw<Array<{ n: bigint }>>`
      SELECT COUNT(*)::bigint AS n FROM tasks
      WHERE (status = 'running' AND deadline_at IS NOT NULL)
         OR (status IN ('succeeded','failed','timed_out','cancelled') AND rh_orphan_until > now())`;
    return Number(rows[0]?.n ?? 0n);
  }

  /** Đặt deadline_at = COALESCE(deadline_at, now()+ms) khi Task còn running. Trả true nếu Task còn running. */
  async setDeadlineIfNull(taskId: string, ms: number): Promise<boolean> {
    const n = await this.prisma.$executeRaw`
      UPDATE tasks SET deadline_at = COALESCE(deadline_at, now() + (${ms}::int * interval '1 millisecond')),
        updated_at = now()
      WHERE id = ${taskId}::uuid AND status = 'running'`;
    return n > 0;
  }

  /** Đặt submit_started_at một lần duy nhất; false nếu đã đặt hoặc Task không còn running. */
  async markSubmitStarted(taskId: string): Promise<boolean> {
    const n = await this.prisma.$executeRaw`
      UPDATE tasks SET submit_started_at = now(), updated_at = now()
      WHERE id = ${taskId}::uuid AND status = 'running' AND submit_started_at IS NULL`;
    return n > 0;
  }

  async setRunninghubTaskId(taskId: string, rhId: string): Promise<boolean> {
    const n = await this.prisma.$executeRaw`
      UPDATE tasks SET runninghub_task_id = ${rhId}, updated_at = now()
      WHERE id = ${taskId}::uuid AND status = 'running' AND runninghub_task_id IS NULL`;
    return n > 0;
  }

  async cancel(userId: string, taskId: string): Promise<Task> {
    const row = await this.prisma.task.findUnique({ where: { id: taskId } });
    if (!row || row.userId !== userId) throw this.apiError(NotFoundException, ApiErrorCode.NOT_FOUND);
    if (row.status !== 'queued') throw this.apiError(ConflictException, ApiErrorCode.CONFLICT);
    const { applied } = await this.transition(taskId, 'queued', 'cancelled', 'USER_CANCEL');
    if (!applied) throw this.apiError(ConflictException, ApiErrorCode.CONFLICT);
    try {
      const job = await this.queue.getJob(taskId);
      await job?.remove();
    } catch (err) {
      this.logger.warn(`Không xóa được job của Task ${taskId}: ${String(err)}`);
    }
    return this.getById(userId, taskId);
  }

  async getById(userId: string, taskId: string): Promise<Task> {
    const row = await this.prisma.task.findUnique({ where: { id: taskId } });
    if (!row || row.userId !== userId) throw this.apiError(NotFoundException, ApiErrorCode.NOT_FOUND);
    const queued = row.status === 'queued';
    return {
      id: row.id,
      pipeline: row.pipeline as Task['pipeline'],
      status: row.status as TaskStatus,
      reasonCode: (row.reasonCode as ReasonCode | null) ?? null,
      queuePosition: queued ? await this.queuePosition(row.id) : null,
      resultKey: row.resultKey ?? null,
      creditCost: row.holdAmount,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  async list(userId: string, query: TaskListQuery): Promise<TaskListResponse> {
    const pageSize = query.pageSize ?? 20;
    const cursor = query.cursor;

    const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (cursor) {
      if (!UUID_REGEX.test(cursor)) {
        throw this.apiError(BadRequestException, ApiErrorCode.VALIDATION_FAILED);
      }
      const cursorOwner = await this.prisma.task.findFirst({
        where: { id: cursor, userId },
        select: { id: true },
      });
      if (!cursorOwner) {
        throw this.apiError(BadRequestException, ApiErrorCode.VALIDATION_FAILED);
      }
    }

    let rows;
    try {
      rows = await this.prisma.task.findMany({
        where: { userId },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: pageSize + 1,
        ...(cursor
          ? {
              cursor: { id: cursor },
              skip: 1,
            }
          : {}),
      });
    } catch (err) {
      if ((err as { code?: unknown }).code === 'P2025') {
        throw this.apiError(BadRequestException, ApiErrorCode.VALIDATION_FAILED);
      }
      throw err;
    }

    const hasMore = rows.length > pageSize;
    const items = hasMore ? rows.slice(0, pageSize) : rows;
    const nextCursor = hasMore && items.length > 0 ? items[items.length - 1].id : null;

    const mappedItems: Task[] = await Promise.all(
      items.map(async (row) => {
        const queued = row.status === 'queued';
        let queuePos: number | null = null;
        if (queued) {
          try {
            queuePos = await this.queuePosition(row.id);
          } catch {
            queuePos = 1;
          }
        }
        return {
          id: row.id,
          pipeline: row.pipeline as Task['pipeline'],
          status: row.status as TaskStatus,
          reasonCode: (row.reasonCode as ReasonCode | null) ?? null,
          queuePosition: queuePos,
          resultKey: row.resultKey ?? null,
          creditCost: row.holdAmount,
          createdAt: row.createdAt.toISOString(),
          updatedAt: row.updatedAt.toISOString(),
        };
      }),
    );

    return {
      items: mappedItems,
      pageSize,
      hasMore,
      nextCursor,
    };
  }

  /** URL ký ngắn hạn tới kết quả và (nếu còn) ảnh gốc. Không bao giờ trả link RunningHub. */
  async getResult(userId: string, taskId: string): Promise<TaskResultResponse> {
    const row = await this.prisma.task.findUnique({ where: { id: taskId } });
    if (!row || row.userId !== userId) throw this.apiError(NotFoundException, ApiErrorCode.NOT_FOUND);
    if (row.status !== 'succeeded' || !row.resultKey) {
      throw this.apiError(ConflictException, ApiErrorCode.CONFLICT);
    }
    const resultUrl = await this.storage.presignGet(row.resultKey, RESULT_URL_TTL_SECONDS);

    let sourceUrl: string | null = null;
    const refKey = this.pipelines.getConfig(row.pipeline)?.referenceInputKey;
    const sourceKey = refKey
      ? ((row.inputKeys ?? {}) as Record<string, string | undefined>)[refKey]
      : undefined;
    if (sourceKey) {
      try {
        if (await this.storage.head(sourceKey)) {
          sourceUrl = await this.storage.presignGet(sourceKey, RESULT_URL_TTL_SECONDS);
        }
      } catch (err) {
        this.logger.warn(`Không kiểm tra được ảnh gốc của Task ${taskId}: ${String(err)}`);
      }
    }
    return { resultUrl, sourceUrl };
  }

  private apiError(
    Ctor: new (body: { code: ApiErrorCode; message: string }) => Error,
    code: ApiErrorCode,
  ): Error {
    return new Ctor({ code, message: getApiErrorMessageVi(code) });
  }

  async createFaceSwap(userId: string, req: FaceSwapCreateRequest): Promise<Task> {
    return this.createPipelineTask(userId, {
      pipeline: 'face_swap',
      amount: PRICING_CONFIG.pipelines.faceSwapCredits,
      inputKeys: { sourceKey: req.sourceKey, targetKey: req.targetKey },
      params: {},
    });
  }

  async createBodyRetouch(userId: string, req: BodyRetouchCreateRequest): Promise<Task> {
    // Phòng thủ: parse lại để áp mặc định intensity=5 và chặn giá trị sai khi gọi từ nơi khác controller.
    const parsed = BodyRetouchCreateRequestSchema.safeParse(req);
    if (!parsed.success) {
      throw new BadRequestException({
        code: ApiErrorCode.VALIDATION_FAILED,
        message: getApiErrorMessageVi(ApiErrorCode.VALIDATION_FAILED),
      });
    }
    return this.createPipelineTask(userId, {
      pipeline: 'body_retouch',
      amount: PRICING_CONFIG.pipelines.bodyRetouchCredits,
      inputKeys: { imageKey: parsed.data.imageKey },
      params: { intensity: parsed.data.intensity },
    });
  }

  private async createPipelineTask(
    userId: string,
    spec: {
      pipeline: 'face_swap' | 'body_retouch';
      amount: number;
      inputKeys: Record<string, string>;
      params: Record<string, unknown>;
    },
  ): Promise<Task> {
    const owned = await this.uploads.areConfirmedKeysOwnedBy(userId, Object.values(spec.inputKeys));
    if (!owned) {
      throw new BadRequestException({
        code: ApiErrorCode.VALIDATION_FAILED,
        message: getApiErrorMessageVi(ApiErrorCode.VALIDATION_FAILED),
      });
    }

    const taskId = crypto.randomUUID();
    const amount = spec.amount;

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
          pipeline: spec.pipeline,
          status: 'queued',
          tierSnapshot: snapshot as unknown as object,
          consent: true, // đã đồng ý ToS một lần lúc đăng nhập
          tosVersion: rows[0].tos_version,
          inputKeys: spec.inputKeys,
          params: spec.params as object,
          holdAmount: amount,
        },
      });
      return { snapshot, task };
    });

    let timer: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        this.queue.add(
          'process',
          { taskId },
          {
            jobId: taskId,
            priority: snapshot.priority,
            removeOnComplete: true,
            removeOnFail: true,
          },
        ),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error(`enqueue quá ${ENQUEUE_TIMEOUT_MS}ms`)),
            ENQUEUE_TIMEOUT_MS,
          );
        }),
      ]);
    } catch (err) {
      this.logger.error(`Không enqueue được Task ${taskId}: ${String(err)}`);
    } finally {
      clearTimeout(timer);
    }

    let queuePosition = 1;
    try {
      queuePosition = await this.queuePosition(taskId);
    } catch (err) {
      this.logger.warn(`Không tính được vị trí hàng đợi của Task ${taskId}: ${String(err)}`);
    }
    return {
      id: task.id,
      pipeline: spec.pipeline,
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
