import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline as streamPipeline } from 'node:stream/promises';
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { ReasonCode } from '@flowvis/contracts';
import sharp, { type ChannelStats, type Metadata } from 'sharp';
import {
  STORAGE_PORT,
  type IngestTask,
  type ResultIngestor,
  type StoragePort,
} from '../../ports/index.js';
import { PipelinesService } from '../pipelines/pipelines.service.js';
import { TasksService } from './tasks.service.js';
import { TRIM_DURATION_TOLERANCE, TRIM_FPS, buildLocalFfprobeArgs, parseFps, run, videoTrim } from './video-trim.service.js';

export const OUTPUT_MAX_BYTES = 20 * 1024 * 1024;
export const VIDEO_OUTPUT_MAX_BYTES = 100 * 1024 * 1024;
export const VIDEO_SHORT_SIDE = 720;
const VIDEO_DIR_NAME = 'ingest';
export const OUTPUT_FETCH_TIMEOUT_MS = 30_000;
export const OUTPUT_MAX_ATTEMPTS = 3;
const BLACK_MAX = 8;
const MAX_GPU_COINS = 2147483647;
const JPEG_WEBP_QUALITY = 95;

import { FORMAT_TO_MIME, displaySize } from '../storage/image-utils.js';

export const EXIF_SOFTWARE = 'AI Generator';
export const EXIF_COMMENT = 'AI-Generated Content';

type FetchFn = (url: string, init: { signal: AbortSignal; redirect?: 'manual' | 'follow' }) => Promise<Response>;

class OutputInvalidError extends Error {}
class OutputAbortedError extends Error {}
class OutputRetriesExhaustedError extends Error {}
class FfmpegError extends Error {}

/** Hàm thuần: một luồng video H.264, 24 FPS, cạnh ngắn 720, độ dài = seconds ± 0,5 giây. */
export function evaluateIngestProbe(json: unknown, seconds: number): string | null {
  const data = (json ?? {}) as {
    format?: { duration?: string | number };
    streams?: Array<{ codec_type?: string; codec_name?: string; width?: number; height?: number; r_frame_rate?: string }>;
  };
  const videos = (data.streams ?? []).filter((x) => x.codec_type === 'video');
  if (videos.length !== 1) return 'không đúng một luồng video';
  const v = videos[0]!;
  if (v.codec_name !== 'h264') return 'không phải H.264';
  const fps = parseFps(v.r_frame_rate);
  if (!Number.isFinite(fps) || Math.abs(fps - TRIM_FPS) > 0.01) return 'FPS khác 24';
  if (Math.min(Number(v.width), Number(v.height)) !== VIDEO_SHORT_SIDE) return 'cạnh ngắn khác 720';
  const duration = Number(data.format?.duration);
  if (data.format?.duration == null || !Number.isFinite(duration) || Math.abs(duration - seconds) > TRIM_DURATION_TOLERANCE) {
    return 'độ dài lệch quá 0,5 giây';
  }
  return null;
}

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

const MAX_REDIRECTS = 3;

/** Host kiểm thử được phép (RESULT_URL_ALLOW_HOSTS, phân tách bằng dấu phẩy); chỉ có tác dụng khi NODE_ENV === 'test'. */
function testAllowedHosts(): Set<string> {
  if (process.env.NODE_ENV !== 'test') return new Set();
  return new Set(
    (process.env.RESULT_URL_ALLOW_HOSTS ?? '')
      .split(',')
      .map((x) => x.trim().toLowerCase())
      .filter(Boolean),
  );
}

/** Chặn host literal nội bộ (loopback, link-local, dải private, localhost). Không thay thế allowlist DNS. */
export function isPublicHttpUrl(raw: string): boolean {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
  const h = u.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (testAllowedHosts().has(h)) return true;
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.internal') || h.endsWith('.local')) return false;
  if (h.includes(':')) return !(h === '::1' || h === '::' || /^(fc|fd|fe80)/.test(h) || h.startsWith('::ffff:'));
  const m = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(h);
  if (m) {
    const [a, b] = [Number(m[1]), Number(m[2])];
    if (a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)) return false;
  }
  return true;
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

    if (row.pipeline === 'motion_control') {
      await this.ingestVideo(task, row, url, gpuCoins, deadlineAt, signal);
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
      if (signal.aborted) throw new OutputAbortedError();
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

    this.logger.log(`Task ${task.id}: đã lưu kết quả ${resultKey} (${encoded.data.length} byte), chốt succeeded`);

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

  /** Nhánh video (Motion Control): tải ra file, ffprobe, remux gắn thẻ, ảnh bìa, ghi R2, chốt. */
  private async ingestVideo(
    task: IngestTask,
    row: { userId: string; params: unknown },
    url: URL,
    gpuCoins: number | undefined,
    deadlineAt: Date | null,
    signal: AbortSignal,
  ): Promise<void> {
    const fail = (reason: ReasonCode) =>
      this.tasks.transition(task.id, 'running', 'failed', reason, { gpuCoins });
    const seconds = ((row.params ?? {}) as Record<string, unknown>).seconds;
    if (!Number.isInteger(seconds) || (seconds as number) <= 0) {
      await fail('INTERNAL_ERROR');
      return;
    }
    const root = path.join(videoTrim.tmpRoot, VIDEO_DIR_NAME);
    let dir: string | undefined;
    const keys: string[] = [];
    try {
      try {
        await fs.promises.mkdir(root, { recursive: true });
        dir = await fs.promises.mkdtemp(path.join(root, `${task.id.replace(/[^A-Za-z0-9-]/g, '')}-`));
      } catch (err) {
        this.logger.warn(`Không tạo được thư mục tạm cho Task ${task.id}: ${String(err)}`);
        await fail('OUTPUT_UPLOAD_ERROR');
        return;
      }
      const name = crypto.randomUUID();
      const inFile = path.join(dir, `${name}-in`);
      const outFile = path.join(dir, `${name}-out.mp4`);
      const posterFile = path.join(dir, `${name}-poster.jpg`);

      // 1. Tải ra file
      let bytes: number;
      try {
        bytes = await this.withRetry(task.id, 'tải kết quả video', deadlineAt, signal, () =>
          this.downloadToFile(url.toString(), inFile, signal, deadlineAt),
        );
      } catch (err) {
        if (err instanceof OutputAbortedError) throw err;
        await fail('OUTPUT_UPLOAD_ERROR');
        return;
      }
      if (bytes === 0) {
        await fail('OUTPUT_INVALID');
        return;
      }

      // 2-4. ffprobe, remux, ảnh bìa dưới khóa ffmpeg
      try {
        await videoTrim.runExclusive(signal, async () => {
          let probe: unknown;
          try {
            probe = JSON.parse(await run('ffprobe', buildLocalFfprobeArgs(inFile), signal));
          } catch (err) {
            if (signal.aborted) throw err;
            throw new OutputInvalidError(`ffprobe không đọc được: ${String(err)}`);
          }
          const bad = evaluateIngestProbe(probe, seconds as number);
          if (bad) throw new OutputInvalidError(bad);
          try {
            await run(
              'nice',
              ['-n', '19', 'ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', '-i', inFile, '-map', '0:v:0', '-c', 'copy',
                '-metadata', `comment=${EXIF_COMMENT}`, '-metadata', `software=${EXIF_SOFTWARE}`,
                '-movflags', '+faststart+use_metadata_tags', outFile],
              signal,
            );
            await run(
              'nice',
              ['-n', '19', 'ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', '-i', outFile, '-frames:v', '1', '-q:v', '2', posterFile],
              signal,
            );
          } catch (err) {
            if (signal.aborted) throw err;
            throw new FfmpegError(String(err));
          }
        });
      } catch (err) {
        if (signal.aborted) throw new OutputAbortedError();
        if (err instanceof OutputInvalidError) {
          this.logger.warn(`Kết quả video Task ${task.id} không hợp lệ: ${err.message}`);
          await fail('OUTPUT_INVALID');
          return;
        }
        if (err instanceof FfmpegError) {
          this.logger.warn(`ffmpeg lỗi với Task ${task.id}: ${err.message}`);
          await fail('FFMPEG_ERROR');
          return;
        }
        this.logger.warn(`Không xử lý được video Task ${task.id}: ${String(err)}`);
        await fail('FFMPEG_ERROR');
        return;
      }

      // 5. Ghi R2
      const base = `out/${row.userId}/${crypto.randomUUID()}`;
      const resultKey = `${base}.mp4`;
      const posterKey = `${base}.jpg`;
      try {
        const video = await fs.promises.readFile(outFile);
        const poster = await fs.promises.readFile(posterFile);
        keys.push(resultKey);
        await this.withRetry(task.id, 'ghi R2 (video)', deadlineAt, signal, () =>
          this.storage.putObject(resultKey, video, 'video/mp4', signal),
        );
        keys.push(posterKey);
        await this.withRetry(task.id, 'ghi R2 (ảnh bìa)', deadlineAt, signal, () =>
          this.storage.putObject(posterKey, poster, 'image/jpeg', signal),
        );
      } catch (err) {
        await this.deleteAll(keys);
        if (err instanceof OutputAbortedError) throw err;
        await fail('OUTPUT_UPLOAD_ERROR');
        return;
      }

      this.logger.log(`Task ${task.id}: đã lưu video ${resultKey}, chốt succeeded`);
      // 6. Chốt
      try {
        const { applied } = await this.tasks.transition(task.id, 'running', 'succeeded', null, { resultKey, gpuCoins });
        if (!applied) await this.deleteAll(keys);
      } catch (err) {
        await this.deleteAll(keys);
        throw err;
      }
    } finally {
      if (dir) await fs.promises.rm(dir, { recursive: true, force: true }).catch(() => {});
    }
  }

  private async deleteAll(keys: string[]): Promise<void> {
    for (const k of keys) await this.safeDelete(k);
  }

  /** Mở phản hồi theo chuyển hướng thủ công, chặn host nội bộ. */
  private async openResponse(url: string, signal: AbortSignal): Promise<Response> {
    let current = url;
    let res: Response | undefined;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      if (!isPublicHttpUrl(current)) throw new Error('URL kết quả trỏ tới địa chỉ nội bộ hoặc không hợp lệ');
      res = await this.fetchFn(current, { signal, redirect: 'manual' });
      const loc = res.status >= 300 && res.status < 400 ? res.headers.get('location') : null;
      if (!loc) break;
      await res.body?.cancel().catch(() => {});
      current = new URL(loc, current).toString();
      res = undefined;
    }
    if (!res) throw new Error('Quá nhiều lần chuyển hướng');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res;
  }

  /** Tải theo luồng ra file (trần 100 MB); trả số byte đã ghi. */
  private async downloadToFile(url: string, file: string, signal: AbortSignal, deadlineAt: Date | null): Promise<number> {
    const remaining = deadlineAt ? deadlineAt.getTime() - Date.now() : Infinity;
    const timeoutMs = Math.max(1, Math.min(OUTPUT_FETCH_TIMEOUT_MS * 10, remaining));
    const combined = AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]);
    const res = await this.openResponse(url, combined);
    const declared = Number(res.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > VIDEO_OUTPUT_MAX_BYTES) {
      await res.body?.cancel().catch(() => {});
      throw new Error('Video vượt quá 100 MB');
    }
    if (!res.body) {
      await fs.promises.writeFile(file, Buffer.alloc(0));
      return 0;
    }
    let total = 0;
    const limiter = new Transform({
      transform(chunk: Buffer, _enc, cb) {
        total += chunk.length;
        if (total > VIDEO_OUTPUT_MAX_BYTES) cb(new Error('Video vượt quá 100 MB'));
        else cb(null, chunk);
      },
    });
    await streamPipeline(
      Readable.fromWeb(res.body as import('node:stream/web').ReadableStream),
      limiter,
      fs.createWriteStream(file),
      { signal: combined },
    );
    return total;
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
    const combined = AbortSignal.any([signal, AbortSignal.timeout(OUTPUT_FETCH_TIMEOUT_MS)]);
    let current = url;
    let res: Response | undefined;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      if (!isPublicHttpUrl(current)) throw new Error('URL kết quả trỏ tới địa chỉ nội bộ hoặc không hợp lệ');
      res = await this.fetchFn(current, { signal: combined, redirect: 'manual' });
      const loc = res.status >= 300 && res.status < 400 ? res.headers.get('location') : null;
      if (!loc) break;
      await res.body?.cancel().catch(() => {});
      current = new URL(loc, current).toString();
      res = undefined;
    }
    if (!res) throw new Error('Quá nhiều lần chuyển hướng');
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
