import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import type { ReasonCode } from '@flowvis/contracts';
import { Worker } from 'bullmq';
import { RedisService } from '../../infra/redis.service.js';
import {
  RESULT_INGESTOR,
  RUNNING_HUB_PORT,
  RunningHubError,
  RunningHubNetworkError,
  STORAGE_PORT,
  type ResultIngestor,
  type RunningHubNodeInfo,
  type RunningHubPort,
  type StoragePort,
} from '../../ports/index.js';
import { mapRunningHubFailure, type PipelineConfig } from '../pipelines/pipeline-config.js';
import { PipelinesService } from '../pipelines/pipelines.service.js';
import { PRICING_CONFIG } from '../wallet/tier.js';
import { clampCoins } from './result-ingestor.js';
import { isTerminal } from './task-transitions.js';
import { TASKS_QUEUE, TasksService } from './tasks.service.js';

export const WORKER_CONCURRENCY = 2;
const RH_CALL_TIMEOUT_MS = 10_000;
const DEFAULT_DEADLINE_MS = 180_000;

/** Hạn chót RunningHub; chỉ cho phép ghi đè (RH_DEADLINE_MS) khi NODE_ENV === 'test'. */
export function deadlineMs(): number {
  if (process.env.NODE_ENV !== 'test') return DEFAULT_DEADLINE_MS;
  const n = Number.parseInt(process.env.RH_DEADLINE_MS ?? '', 10);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_DEADLINE_MS;
}
export const ORPHAN_MS = 10 * 60_000;
export const FREE_WAIT_MS = 15 * 60_000;
const FREE_PRIORITY = PRICING_CONFIG.tiers.find((t) => t.tier === 'FREE')!.priority;

type TaskRow = NonNullable<Awaited<ReturnType<TasksService['getWorkerRow']>>>;

function envInt(name: string, def: number): number {
  const n = Number.parseInt(process.env[name] ?? '', 10);
  return Number.isFinite(n) && n > 0 ? n : def;
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const t = setTimeout(done, ms);
    function done(): void {
      clearTimeout(t);
      signal.removeEventListener('abort', done);
      resolve();
    }
    signal.addEventListener('abort', done, { once: true });
  });
}

/** Mutex trong tiến trình bao quanh đếm cổng + ghi deadline_at. */
class Mutex {
  private tail: Promise<void> = Promise.resolve();
  async run<T>(fn: () => Promise<T>): Promise<T> {
    const prev = this.tail;
    let release!: () => void;
    this.tail = new Promise<void>((r) => (release = r));
    await prev;
    try {
      return await fn();
    } finally {
      release();
    }
  }
}

@Injectable()
export class TaskWorkerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TaskWorkerService.name);
  private worker: Worker | null = null;
  private readonly shutdown = new AbortController();
  private readonly gateMutex = new Mutex();
  private readonly controllers = new Map<string, AbortController>();

  constructor(
    private readonly tasks: TasksService,
    private readonly pipelines: PipelinesService,
    private readonly redis: RedisService,
    @Inject(RUNNING_HUB_PORT) private readonly rh: RunningHubPort,
    @Inject(STORAGE_PORT) private readonly storage: StoragePort,
    @Inject(RESULT_INGESTOR) private readonly ingestor: ResultIngestor,
  ) {}

  onModuleInit(): void {
    if (process.env.MOTION_PROCESS_ROLE !== 'worker') return;
    this.worker = new Worker(
      TASKS_QUEUE,
      async (job) => {
        const taskId = (job.data as { taskId?: string } | undefined)?.taskId;
        if (!taskId) return;
        const ctrl = new AbortController();
        this.controllers.set(taskId, ctrl);
        try {
          await this.processTask(taskId, AbortSignal.any([this.shutdown.signal, ctrl.signal]));
        } catch (err) {
          this.logger.error(`Xử lý Task ${taskId} lỗi: ${String(err)}`);
          throw err;
        } finally {
          if (this.controllers.get(taskId) === ctrl) this.controllers.delete(taskId);
        }
      },
      { connection: this.redis.getWorkerConnectionOptions(), concurrency: WORKER_CONCURRENCY },
    );
    this.worker.on('error', (err) => this.logger.error(`BullMQ worker lỗi: ${String(err)}`));
  }

  async onModuleDestroy(): Promise<void> {
    this.shutdown.abort();
    if (this.worker) {
      const w = this.worker;
      this.worker = null;
      await w.close();
    }
  }

  /** Hủy AbortSignal riêng của Task (bộ quét gọi sau khi kết thúc Task). Trả true nếu có job đang chạy. */
  abortTask(taskId: string): boolean {
    const ctrl = this.controllers.get(taskId);
    if (!ctrl) return false;
    ctrl.abort();
    return true;
  }

  /** Hàm xử lý job (AD-5/AD-6). Gọi trực tiếp được trong test. */
  async processTask(taskId: string, signal: AbortSignal = new AbortController().signal): Promise<void> {
    let row = await this.tasks.getWorkerRow(taskId);
    if (!row || isTerminal(row.status as never)) return;

    if (row.status === 'queued') {
      const snap = (row.tierSnapshot ?? {}) as { priority?: number };
      if (snap.priority === FREE_PRIORITY && Date.now() - row.queuedAt.getTime() >= FREE_WAIT_MS) {
        await this.tasks.transition(taskId, 'queued', 'timed_out', 'FREE_WAIT_EXPIRED');
        return;
      }
      const { applied } = await this.tasks.transition(taskId, 'queued', 'running');
      if (!applied) {
        row = await this.tasks.getWorkerRow(taskId);
        if (!row || row.status !== 'running') return;
      } else {
        row = await this.tasks.getWorkerRow(taskId);
        if (!row) return;
      }
    }
    if (row.status !== 'running') return;
    this.logger.log(`Task ${taskId}: bắt đầu xử lý pipeline ${row.pipeline}`);

    const now = Date.now();
    if (row.runninghubTaskId) return this.poll(row, signal);
    if (row.submitStartedAt) {
      await this.finish(taskId, 'failed', 'RH_SUBMIT_UNKNOWN', { orphanForMs: ORPHAN_MS });
      return;
    }
    if (row.deadlineAt) {
      if (row.deadlineAt.getTime() <= now) {
        await this.finish(taskId, 'timed_out', 'RH_TIMEOUT');
        return;
      }
      return this.runFromUpload(row, signal, true);
    }
    if (row.prepDeadlineAt && row.prepDeadlineAt.getTime() <= now) {
      await this.finish(taskId, 'timed_out', 'PREP_TIMEOUT');
      return;
    }
    return this.runFromUpload(row, signal, false);
  }

  private finish(
    taskId: string,
    to: 'failed' | 'timed_out',
    reason: ReasonCode,
    opts: { gpuCoins?: number; orphanForMs?: number } = {},
  ) {
    this.logger.warn(`Task ${taskId}: kết thúc ${to} (${reason})`);
    return this.tasks.transition(taskId, 'running', to, reason, opts);
  }

  private timeoutSignal(signal: AbortSignal): AbortSignal {
    return AbortSignal.any([signal, AbortSignal.timeout(RH_CALL_TIMEOUT_MS)]);
  }

  /** (a) chuẩn bị, (b) cổng, (c) upload, (d) submit, rồi poll. */
  private async runFromUpload(row: TaskRow, signal: AbortSignal, gatePassed: boolean): Promise<void> {
    const taskId = row.id;
    const config = this.pipelines.getConfig(row.pipeline);
    const workflowId = config ? this.pipelines.getWorkflowId(config) : null;
    if (!config || !workflowId) {
      await this.finish(taskId, 'failed', 'RH_ERROR');
      return;
    }

    // (a)
    let inputs: Record<string, Buffer>;
    try {
      inputs = await this.loadInputs(row, config, signal);
    } catch (err) {
      if (signal.aborted) return;
      this.logger.warn(`Không đọc được input của Task ${taskId}: ${String(err)}`);
      await this.finish(taskId, 'failed', 'INPUT_FETCH_ERROR');
      return;
    }

    // (b) + (c: ghi deadline_at)
    if (!gatePassed) {
      const passed = await this.passGate(row, signal);
      if (!passed) return;
    }
    if (signal.aborted) return;

    // (c) upload
    const nodeInfo: RunningHubNodeInfo[] = [];
    try {
      for (const m of config.inputs) {
        const bytes = inputs[m.inputKey];
        const name = await this.rh.uploadFile(bytes, `${taskId}-${m.inputKey}`, this.timeoutSignal(signal));
        this.logger.log(`Task ${taskId}: đã upload ${m.inputKey} (${bytes.length} byte) -> ${name}`);
        nodeInfo.push({ nodeId: m.nodeId, fieldName: m.fieldName, fieldValue: name });
      }
    } catch (err) {
      if (signal.aborted) return;
      this.logger.warn(`Upload RunningHub lỗi cho Task ${taskId}: ${String(err)}`);
      await this.finish(taskId, 'failed', 'RH_ERROR');
      return;
    }

    // (d) submit
    if (!(await this.tasks.markSubmitStarted(taskId))) return;
    this.logger.log(
      `Task ${taskId}: gửi workflow ${workflowId} với ${nodeInfo.length} node (${nodeInfo
        .map((n) => `${n.nodeId}/${n.fieldName}`)
        .join(', ')})`,
    );
    let rhId: string;
    try {
      rhId = await this.submitWithRetry(workflowId, nodeInfo, signal);
    } catch (err) {
      if (signal.aborted) return;
      if (err instanceof SubmitFailure) {
        this.logger.warn(`Task ${taskId}: submit thất bại (${err.reason}): ${err.detail}`);
        await this.finish(
          taskId,
          'failed',
          err.reason,
          err.reason === 'RH_SUBMIT_UNKNOWN' ? { orphanForMs: ORPHAN_MS } : {},
        );
        return;
      }
      throw err;
    }
    this.logger.log(`Task ${taskId}: RunningHub nhận task ${rhId}`);
    if (!(await this.tasks.setRunninghubTaskId(taskId, rhId))) return;
    const fresh = await this.tasks.getWorkerRow(taskId);
    if (!fresh) return;
    return this.poll(fresh, signal);
  }

  private async loadInputs(row: TaskRow, config: PipelineConfig, signal?: AbortSignal): Promise<Record<string, Buffer>> {
    const keys = (row.inputKeys ?? {}) as Record<string, string>;
    const out: Record<string, Buffer> = {};
    for (const m of config.inputs) {
      const key = keys[m.inputKey];
      if (!key) throw new Error(`Thiếu input ${m.inputKey}`);
      out[m.inputKey] = await this.storage.getObject(key, signal);
    }
    return config.prepare ? config.prepare(out) : out;
  }

  /** Trả true khi đã qua cổng (deadline_at đã ghi). */
  private async passGate(row: TaskRow, signal: AbortSignal): Promise<boolean> {
    const taskId = row.id;
    const max = envInt('RH_MAX_CONCURRENT', 2);
    const retryMs = envInt('RH_GATE_RETRY_MS', 5000);
    for (;;) {
      if (signal.aborted) return false;
      const result = await this.gateMutex.run(async () => {
        if ((await this.tasks.countGateOccupied()) >= max) return 'full' as const;
        return (await this.tasks.setDeadlineIfNull(taskId, deadlineMs())) ? ('passed' as const) : ('gone' as const);
      });
      if (result === 'passed') return true;
      if (result === 'gone') return false;
      const cur = await this.tasks.getWorkerRow(taskId);
      if (!cur || cur.status !== 'running') return false;
      if (cur.gateDeadline && cur.gateDeadline.getTime() <= Date.now()) {
        await this.finish(taskId, 'timed_out', 'RH_GATE_TIMEOUT');
        return false;
      }
      await sleep(retryMs, signal);
    }
  }

  private async submitWithRetry(
    workflowId: string,
    nodeInfo: RunningHubNodeInfo[],
    signal: AbortSignal,
  ): Promise<string> {
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        return await this.rh.submit(workflowId, nodeInfo, this.timeoutSignal(signal));
      } catch (err) {
        if (err instanceof RunningHubNetworkError) {
          this.logger.warn(`submit lần ${attempt}/2 lỗi mạng (requestSent=${err.requestSent}): ${err.message}`);
          if (err.requestSent) throw new SubmitFailure('RH_SUBMIT_UNKNOWN', err.message);
          if (attempt === 2) throw new SubmitFailure('RH_ERROR', err.message);
          continue;
        }
        if (err instanceof RunningHubError) throw new SubmitFailure('RH_ERROR', err.message);
        if (signal.aborted) throw err;
        // Timeout hoặc lỗi lạ: request có thể đã gửi.
        throw new SubmitFailure('RH_SUBMIT_UNKNOWN', String(err));
      }
    }
    throw new SubmitFailure('RH_ERROR');
  }

  private async poll(initial: TaskRow, signal: AbortSignal): Promise<void> {
    const taskId = initial.id;
    const rhId = initial.runninghubTaskId as string;
    const intervalMs = envInt('RH_POLL_INTERVAL_MS', 3000);
    let lastStatus = '';
    for (;;) {
      if (signal.aborted) return;
      const row = await this.tasks.getWorkerRow(taskId);
      if (!row || row.status !== 'running') return;
      if (row.deadlineAt && row.deadlineAt.getTime() <= Date.now()) {
        await this.finish(taskId, 'timed_out', 'RH_TIMEOUT', { orphanForMs: ORPHAN_MS });
        return;
      }
      try {
        const out = await this.rh.outputs(rhId, this.timeoutSignal(signal));
        if (out.status !== lastStatus) {
          lastStatus = out.status;
          this.logger.log(`Task ${taskId}: RunningHub ${rhId} trạng thái ${out.status}`);
        }
        if (out.status === 'SUCCESS') {
          const gpuCoins = clampCoins(out.consumeMoney);
          this.logger.log(`Task ${taskId}: RunningHub SUCCESS, tải kết quả từ ${out.fileUrl ?? '(thiếu fileUrl)'}`);
          if (!out.fileUrl) {
            this.logger.warn(`RunningHub SUCCESS nhưng thiếu fileUrl cho Task ${taskId}`);
            await this.finish(taskId, 'failed', 'OUTPUT_UPLOAD_ERROR', { gpuCoins });
            return;
          }
          try {
            await this.ingestor.ingest(
              { id: row.id, userId: row.userId, pipeline: row.pipeline },
              out.fileUrl,
              out.consumeMoney,
              signal,
            );
            const after = await this.tasks.getWorkerRow(taskId);
            if (after && after.status === 'running') {
              this.logger.warn(`Ingestor không chuyển trạng thái Task ${taskId}`);
              await this.finish(taskId, 'failed', 'OUTPUT_UPLOAD_ERROR', { gpuCoins });
            }
          } catch (err) {
            if (signal.aborted) return;
            this.logger.warn(`Nhập kết quả Task ${taskId} lỗi: ${String(err)}`);
            await this.finish(taskId, 'failed', 'OUTPUT_UPLOAD_ERROR', { gpuCoins });
          }
          return;
        }
        if (out.status === 'FAILED') {
          this.logger.warn(`Task ${taskId}: RunningHub báo FAILED: ${out.errorMessage ?? '(không có thông báo)'}`);
          const gpuCoins = clampCoins(out.consumeMoney);
          await this.finish(taskId, 'failed', mapRunningHubFailure(out.errorMessage), { gpuCoins });
          return;
        }
      } catch (err) {
        if (signal.aborted) return;
        if (err instanceof RunningHubError) {
          this.logger.warn(`Task ${taskId}: RunningHub ${rhId} lỗi khi truy vấn: ${err.message}`);
          // Không biết job còn chạy hay không: giữ slot cổng như RH_TIMEOUT / RH_SUBMIT_UNKNOWN.
          await this.finish(taskId, 'failed', 'RH_ERROR', { orphanForMs: ORPHAN_MS });
          return;
        }
        // Lỗi mạng/timeout khi poll là tạm thời; thử lại tới deadline_at.
        this.logger.warn(`Poll Task ${taskId} lỗi tạm thời: ${String(err)}`);
      }
      await sleep(intervalMs, signal);
    }
  }
}

class SubmitFailure extends Error {
  constructor(
    readonly reason: 'RH_ERROR' | 'RH_SUBMIT_UNKNOWN',
    readonly detail: string = '',
  ) {
    super(reason);
  }
}
