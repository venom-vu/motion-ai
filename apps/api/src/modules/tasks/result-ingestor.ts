import crypto from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { ReasonCode } from '@motion-ai/contracts';
import sharp, { type ChannelStats, type Metadata } from 'sharp';
import {
  STORAGE_PORT,
  type IngestTask,
  type ResultIngestor,
  type StoragePort,
} from '../../ports/index.js';
import { PipelinesService } from '../pipelines/pipelines.service.js';
import { TasksService } from './tasks.service.js';

export const OUTPUT_MAX_BYTES = 20 * 1024 * 1024;
export const OUTPUT_FETCH_TIMEOUT_MS = 30_000;
export const OUTPUT_MAX_ATTEMPTS = 3;
const BLACK_MAX = 8;
const MAX_GPU_COINS = 2147483647;
const JPEG_WEBP_QUALITY = 95;

export const EXIF_SOFTWARE = 'AI Generator';
export const EXIF_COMMENT = 'AI-Generated Content';

const FORMAT_TO_MIME: Readonly<Record<string, string>> = {
  png: 'image/png',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
};

type FetchFn = (url: string, init: { signal: AbortSignal }) => Promise<Response>;

class OutputInvalidError extends Error {}
class OutputAbortedError extends Error {}
class OutputRetriesExhaustedError extends Error {}

function retryDelayMs(): number {
  const n = Number.parseInt(process.env.RH_OUTPUT_RETRY_MS ?? '', 10);
  return Number.isFinite(n) && n >= 0 ? n : 1000;
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted || ms <= 0) return resolve();
    const t = setTimeout(done, ms);
    function done(): void {
      clearTimeout(t);
      signal.removeEventListener('abort', done);
      resolve();
    }
    signal.addEventListener('abort', done, { once: true });
  });
}

/** Làm tròn và kẹp consumeMoney vào 0..2147483647 (cột `gpu_coins` kiểu int4). */
export function clampCoins(consumeMoney: number | undefined): number | undefined {
  if (typeof consumeMoney !== 'number' || !Number.isFinite(consumeMoney)) return undefined;
  return Math.min(MAX_GPU_COINS, Math.max(0, Math.round(consumeMoney)));
}

/** Kích thước hiển thị (sau xoay EXIF orientation 5-8) của ảnh. */
function displaySize(meta: Metadata): { width: number; height: number } {
  const o = meta.orientation ?? 1;
  const rotated = o >= 5 && o <= 8;
  return {
    width: (rotated ? meta.height : meta.width) ?? 0,
    height: (rotated ? meta.width : meta.height) ?? 0,
  };
}

/**
 * Nhập kết quả RunningHub về R2 (AD-7): tải về, kiểm tra, ghi EXIF, lưu `out/<userId>/<uuid>`,
 * rồi `running→succeeded` qua tasks.transition (tự CAPTURED). Mọi lỗi sau SUCCESS là failed + RELEASED.
 */
@Injectable()
export class ResultIngestorService implements ResultIngestor {
  private readonly logger = new Logger(ResultIngestorService.name);
  /** Có thể thay trong test; mặc định đọc `globalThis.fetch` tại thời điểm gọi. */
  fetchFn: FetchFn = (url, init) => globalThis.fetch(url, init);

  constructor(
    private readonly tasks: TasksService,
    private readonly pipelines: PipelinesService,
    @Inject(STORAGE_PORT) private readonly storage: StoragePort,
  ) {}

  async ingest(
    task: IngestTask,
    fileUrl: string | undefined,
    consumeMoney: number | undefined,
    signal: AbortSignal,
  ): Promise<void> {
    const gpuCoins = clampCoins(consumeMoney);
    const row = await this.tasks.getWorkerRow(task.id);
    if (!row || row.status !== 'running') return;
    const deadlineAt = row.deadlineAt ?? null;

    const fail = (reason: ReasonCode) =>
      this.tasks.transition(task.id, 'running', 'failed', reason, { gpuCoins });

    let url: URL;
    try {
      url = new URL(fileUrl ?? '');
    } catch {
      await fail('OUTPUT_UPLOAD_ERROR');
      return;
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      await fail('OUTPUT_UPLOAD_ERROR');
      return;
    }

    // 1. Tải về
    let downloaded: Buffer;
    try {
      downloaded = await this.withRetry(task.id, 'tải kết quả', deadlineAt, signal, () =>
        this.download(url.toString(), signal),
      );
    } catch (err) {
      if (err instanceof OutputAbortedError) throw err;
      await fail('OUTPUT_UPLOAD_ERROR');
      return;
    }

    // 2. Kiểm tra + mã hóa lại có EXIF (không thử lại)
    let encoded: { data: Buffer; contentType: string };
    try {
      encoded = await this.validateAndEncode(downloaded, row.pipeline, row.inputKeys, signal);
    } catch (err) {
      if (err instanceof OutputInvalidError) {
        this.logger.warn(`Kết quả Task ${task.id} không hợp lệ: ${err.message}`);
        await fail('OUTPUT_INVALID');
        return;
      }
      this.logger.warn(`Không kiểm tra được kết quả Task ${task.id}: ${String(err)}`);
      await fail('OUTPUT_UPLOAD_ERROR');
      return;
    }

    // 3. Ghi R2
    const resultKey = `out/${row.userId}/${crypto.randomUUID()}`;
    try {
      await this.withRetry(task.id, 'ghi R2', deadlineAt, signal, () =>
        this.storage.putObject(resultKey, encoded.data, encoded.contentType, signal),
      );
    } catch (err) {
      await this.safeDelete(resultKey);
      if (err instanceof OutputAbortedError) throw err;
      await fail('OUTPUT_UPLOAD_ERROR');
      return;
    }

    // 4. Chốt
    try {
      const { applied } = await this.tasks.transition(task.id, 'running', 'succeeded', null, {
        resultKey,
        gpuCoins,
      });
      if (!applied) await this.safeDelete(resultKey);
    } catch (err) {
      await this.safeDelete(resultKey);
      throw err;
    }
  }

  /** Thử tối đa OUTPUT_MAX_ATTEMPTS lần; không bắt đầu lần mới khi quá deadline_at hoặc signal đã hủy. */
  private async withRetry<T>(
    taskId: string,
    what: string,
    deadlineAt: Date | null,
    signal: AbortSignal,
    op: () => Promise<T>,
  ): Promise<T> {
    for (let attempt = 1; attempt <= OUTPUT_MAX_ATTEMPTS; attempt++) {
      if (signal.aborted) throw new OutputAbortedError();
      if (deadlineAt && deadlineAt.getTime() <= Date.now()) {
        throw new OutputRetriesExhaustedError(`quá deadline_at khi ${what}`);
      }
      try {
        return await op();
      } catch (err) {
        if (signal.aborted) throw new OutputAbortedError();
        this.logger.warn(`Task ${taskId}: ${what} lỗi lần ${attempt}/${OUTPUT_MAX_ATTEMPTS}: ${String(err)}`);
        if (attempt === OUTPUT_MAX_ATTEMPTS) {
          throw new OutputRetriesExhaustedError(`hết lượt thử khi ${what}`);
        }
        await sleep(retryDelayMs(), signal);
      }
    }
    throw new OutputRetriesExhaustedError(`hết lượt thử khi ${what}`);
  }

  private async download(url: string, signal: AbortSignal): Promise<Buffer> {
    const res = await this.fetchFn(url, {
      signal: AbortSignal.any([signal, AbortSignal.timeout(OUTPUT_FETCH_TIMEOUT_MS)]),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const declared = Number(res.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > OUTPUT_MAX_BYTES) {
      await res.body?.cancel().catch(() => {});
      throw new Error('Kết quả vượt quá 20 MB');
    }
    if (!res.body) {
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length > OUTPUT_MAX_BYTES) throw new Error('Kết quả vượt quá 20 MB');
      return buf;
    }
    const reader = res.body.getReader();
    const chunks: Buffer[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > OUTPUT_MAX_BYTES) {
        await reader.cancel().catch(() => {});
        throw new Error('Kết quả vượt quá 20 MB');
      }
      chunks.push(Buffer.from(value));
    }
    return Buffer.concat(chunks);
  }

  private async validateAndEncode(
    bytes: Buffer,
    pipeline: string,
    inputKeys: unknown,
    signal?: AbortSignal,
  ): Promise<{ data: Buffer; contentType: string }> {
    if (bytes.length === 0) throw new OutputInvalidError('ảnh rỗng');

    let meta: Metadata;
    try {
      meta = await sharp(bytes).metadata();
    } catch {
      throw new OutputInvalidError('không giải mã được');
    }
    const contentType = meta.format ? FORMAT_TO_MIME[meta.format] : undefined;
    if (!meta.format || !contentType) throw new OutputInvalidError('định dạng không hỗ trợ');
    const size = displaySize(meta);
    if (!size.width || !size.height) throw new OutputInvalidError('kích thước không hợp lệ');

    let channels: ChannelStats[];
    try {
      // stats() giải mã toàn bộ ảnh nên ảnh hỏng/cắt cụt sẽ ném lỗi ở đây.
      channels = (await sharp(bytes).stats()).channels;
    } catch {
      throw new OutputInvalidError('không giải mã được');
    }

    const colorChannels = channels.slice(0, channels.length >= 3 ? 3 : 1);
    if (colorChannels.length === 0 || colorChannels.every((c) => c.max <= BLACK_MAX)) {
      throw new OutputInvalidError('ảnh toàn đen');
    }

    const refKey = this.pipelines.getConfig(pipeline)?.referenceInputKey;
    if (refKey) {
      const key = ((inputKeys ?? {}) as Record<string, string | undefined>)[refKey];
      if (!key) throw new Error(`Thiếu ảnh tham chiếu ${refKey}`);
      const refMeta = await sharp(await this.storage.getObject(key, signal)).metadata();
      const ref = displaySize(refMeta);
      if (ref.width !== size.width || ref.height !== size.height) {
        throw new OutputInvalidError(
          `kích thước ${size.width}x${size.height} khác ảnh tham chiếu ${ref.width}x${ref.height}`,
        );
      }
    }

    // rotate() áp EXIF orientation vào điểm ảnh để kích thước đã kiểm tra khớp ảnh lưu.
    let pipe = sharp(bytes)
      .rotate()
      .keepIccProfile()
      .withExif({ IFD0: { Software: EXIF_SOFTWARE }, IFD2: { UserComment: EXIF_COMMENT } });
    if (meta.format === 'png') pipe = pipe.png();
    else if (meta.format === 'jpeg') pipe = pipe.jpeg({ quality: JPEG_WEBP_QUALITY });
    else pipe = pipe.webp({ quality: JPEG_WEBP_QUALITY });
    return { data: await pipe.toBuffer(), contentType };
  }

  private async safeDelete(key: string): Promise<void> {
    try {
      await this.storage.delete(key);
    } catch (err) {
      this.logger.warn(`Không xóa được ${key}: ${String(err)}`);
    }
  }
}
