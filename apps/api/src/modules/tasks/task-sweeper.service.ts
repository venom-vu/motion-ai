import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Interval } from '@nestjs/schedule';
import type { ReasonCode } from '@flowvis/contracts';
import type { Job, Queue } from 'bullmq';
import { NOTIFIER_PORT, type NotifierPort } from '../../ports/index.js';
import { AlertService } from '../ops/alert.service.js';
import { FREE_WAIT_MS, ORPHAN_MS, TaskWorkerService } from './task-worker.service.js';
import { TASKS_QUEUE, TasksService, type SweepRow } from './tasks.service.js';

export const SWEEP_INTERVAL_MS = 30_000;
export const QUEUED_GRACE_MS = 30_000;
export const MAX_ENQUEUE_ATTEMPTS = 5;
const BATCH = 100;

/** Bộ quét Task treo và hạn chót (AD-6). Chỉ chạy ở tiến trình worker. */
@Injectable()
export class TaskSweeperService {
  private readonly logger = new Logger(TaskSweeperService.name);
  private running = false;

  constructor(
    private readonly tasks: TasksService,
    private readonly worker: TaskWorkerService,
    @InjectQueue(TASKS_QUEUE) private readonly queue: Queue,
    @Inject(NOTIFIER_PORT) private readonly notifier: NotifierPort,
    private readonly alerts: AlertService,
  ) {}

  @Interval(SWEEP_INTERVAL_MS)
  async scheduledSweep(): Promise<void> {
    if (process.env.MOTION_PROCESS_ROLE !== 'worker') return;
    await this.sweep();
  }

  /** Một chu kỳ quét; không chạy chồng nhau. Gọi trực tiếp được trong test. */
  async sweep(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.safe('free-expired', () => this.sweepFreeExpired());
      await this.safe('queued', () => this.sweepQueued());
      await this.safe('running-expired', () => this.sweepRunningExpired());
      await this.safe('running-live', () => this.sweepRunningLive());
      await this.safe('alerts', () => this.alerts.retryPending());
      await this.safe('breaker', () => this.tasks.emitTerminal());
    } finally {
      this.running = false;
    }
  }

  private async safe(name: string, fn: () => Promise<void>): Promise<void> {
    try {
      await fn();
    } catch (err) {
      this.logger.error(`Bộ quét nhánh ${name} lỗi: ${String(err)}`);
    }
  }

  /**
   * Trả job còn sống (đang chờ/chạy/hoãn). Job completed/failed bị xóa và coi như không có.
   */
  private async liveJob(taskId: string): Promise<{ job: Job; state: string } | null> {
    const job = await this.queue.getJob(taskId);
    if (!job) return null;
    const state = await job.getState();
    if (state === 'completed' || state === 'failed') {
      await job.remove().catch((err) => this.logger.warn(`Không xóa được job ${taskId}: ${String(err)}`));
      return null;
    }
    return { job, state };
  }

  private enqueue(row: SweepRow) {
    return this.queue.add(
      'process',
      { taskId: row.id },
      { jobId: row.id, priority: row.priority, removeOnComplete: true, removeOnFail: true },
    );
  }

  /** Task FREE chờ quá 15 phút: queued→timed_out/FREE_WAIT_EXPIRED (RELEASED trong transition). */
  private async sweepFreeExpired(): Promise<void> {
    for (const row of await this.tasks.sweepFreeExpired(FREE_WAIT_MS, BATCH)) {
      try {
        const { applied } = await this.tasks.transition(row.id, 'queued', 'timed_out', 'FREE_WAIT_EXPIRED');
        if (!applied) continue;
        await this.cleanup(row.id);
        await this.notifier
          .notify({
            kind: 'task.free_wait_expired',
            severity: 'info',
            message: 'Task FREE chờ quá 15 phút, đã hoàn credit; người dùng có thể thử lại hoặc nạp credit.',
            data: { taskId: row.id, userId: row.user_id },
          })
          .catch((err) => this.logger.warn(`Không gửi được thông báo Task ${row.id}: ${String(err)}`));
      } catch (err) {
        this.logger.warn(`Bộ quét Task FREE hết hạn ${row.id} lỗi: ${String(err)}`);
      }
    }
  }

  private async sweepQueued(): Promise<void> {
    for (const row of await this.tasks.sweepQueued(QUEUED_GRACE_MS, BATCH)) {
      try {
        if (await this.liveJob(row.id)) continue;
        if (row.enqueue_attempts >= MAX_ENQUEUE_ATTEMPTS) {
          const { applied } = await this.tasks.transition(row.id, 'queued', 'failed', 'INTERNAL_ERROR');
          if (applied) await this.cleanup(row.id);
          continue;
        }
        if (!(await this.tasks.bumpEnqueueAttempts(row.id))) continue;
        await this.enqueue(row);
      } catch (err) {
        this.logger.warn(`Bộ quét Task queued ${row.id} lỗi: ${String(err)}`);
      }
    }
  }

  private async sweepRunningExpired(): Promise<void> {
    const now = Date.now();
    for (const row of await this.tasks.sweepRunningExpired(BATCH)) {
      try {
        if (row.deadline_at) {
          await this.expire(row.id, 'RH_TIMEOUT', { orphanForMs: ORPHAN_MS });
        } else if (row.gate_deadline && row.gate_deadline.getTime() <= now) {
          await this.expire(row.id, 'RH_GATE_TIMEOUT');
        } else {
          const live = await this.liveJob(row.id);
          // Job còn trong hàng (waiting/delayed/active) là đang chờ slot worker, không phải chết;
          // hạn chót cuối cùng vẫn là gate_deadline.
          if (live) continue;
          await this.expire(row.id, 'PREP_TIMEOUT');
        }
      } catch (err) {
        this.logger.warn(`Bộ quét Task running quá hạn ${row.id} lỗi: ${String(err)}`);
      }
    }
  }

  private async sweepRunningLive(): Promise<void> {
    for (const row of await this.tasks.sweepRunningLive(BATCH)) {
      try {
        if (await this.liveJob(row.id)) continue;
        await this.enqueue(row);
      } catch (err) {
        this.logger.warn(`Bộ quét khôi phục Task ${row.id} lỗi: ${String(err)}`);
      }
    }
  }

  private async expire(taskId: string, reason: ReasonCode, opts: { orphanForMs?: number } = {}): Promise<void> {
    const { applied } = await this.tasks.transition(taskId, 'running', 'timed_out', reason, opts);
    if (applied) await this.cleanup(taskId);
  }

  /** Sau CAS kết thúc: xóa job còn sót và hủy AbortSignal của Task. */
  private async cleanup(taskId: string): Promise<void> {
    try {
      const job = await this.queue.getJob(taskId);
      if (job) await job.remove();
    } catch (err) {
      this.logger.warn(`Không xóa được job ${taskId}: ${String(err)}`);
    }
    this.worker.abortTask(taskId);
  }
}
