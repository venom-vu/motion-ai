import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import type { ReasonCode } from '@flowvis/contracts';
import type { StoragePort } from '../../ports/index.js';

export const TRIM_FPS = 24;
export const TRIM_DURATION_TOLERANCE = 0.5;
export const FETCH_ATTEMPTS = 3;
export const DISK_FACTOR = 3;
const TRIM_DIR_PREFIX = 'flowvis-trim';
const MAX_OUTPUT_BYTES = 4 * 1024 * 1024;

/** Lỗi bước chuẩn bị mang sẵn reasonCode để worker kết thúc Task. */
export class PrepareError extends Error {
  constructor(
    readonly reason: ReasonCode,
    detail = '',
  ) {
    super(detail || reason);
  }
}

/** Ngữ cảnh cho PipelineConfig.prepare. */
export interface PrepareContext {
  readonly row: { id: string; inputKeys: unknown; params: unknown };
  readonly storage: StoragePort;
  readonly signal: AbortSignal;
}

function abortError(): Error {
  const e = new Error('Aborted');
  e.name = 'AbortError';
  return e;
}

/** Mutex FIFO; chờ khóa có thể bị hủy bằng AbortSignal. */
export class FifoLock {
  private held = false;
  private readonly waiters: Array<() => void> = [];

  async run<T>(signal: AbortSignal, fn: () => Promise<T>): Promise<T> {
    await this.acquire(signal);
    try {
      return await fn();
    } finally {
      this.release();
    }
  }

  private acquire(signal: AbortSignal): Promise<void> {
    if (signal.aborted) return Promise.reject(abortError());
    if (!this.held) {
      this.held = true;
      return Promise.resolve();
    }
    return new Promise<void>((resolve, reject) => {
      const grant = (): void => {
        signal.removeEventListener('abort', onAbort);
        resolve();
      };
      const onAbort = (): void => {
        const i = this.waiters.indexOf(grant);
        if (i >= 0) this.waiters.splice(i, 1);
        reject(abortError());
      };
      this.waiters.push(grant);
      signal.addEventListener('abort', onAbort, { once: true });
    });
  }

  private release(): void {
    const next = this.waiters.shift();
    if (next) next(); // giữ nguyên held = true cho người kế tiếp
    else this.held = false;
  }
}

/** Mảng đối số cố định; chỉ số và đường dẫn do server sinh. */
export function buildFfmpegArgs(input: string, output: string, trimStart: number, seconds: number): string[] {
  return [
    '-hide_banner',
    '-loglevel',
    'error',
    '-y',
    '-ss',
    String(trimStart),
    '-i',
    input,
    '-t',
    String(seconds),
    '-an',
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-r',
    String(TRIM_FPS),
    '-vf',
    'scale=trunc(iw/2)*2:trunc(ih/2)*2',
    '-pix_fmt',
    'yuv420p',
    '-movflags',
    '+faststart',
    output,
  ];
}

export function buildLocalFfprobeArgs(file: string): string[] {
  return ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file];
}

export function parseFps(raw: unknown): number {
  const [n, d] = String(raw ?? '').split('/').map(Number);
  if (!Number.isFinite(n) || !Number.isFinite(d ?? 1) || (d ?? 1) === 0) return NaN;
  return n! / (d ?? 1);
}

/** Hàm thuần: đúng một luồng video, 24 FPS, độ dài = seconds ± 0,5 giây. */
export function evaluateTrimmedProbe(json: unknown, seconds: number): boolean {
  const data = (json ?? {}) as {
    format?: { duration?: string | number };
    streams?: Array<{ codec_type?: string; r_frame_rate?: string; avg_frame_rate?: string }>;
  };
  const streams = data.streams ?? [];
  if (streams.length !== 1 || streams[0]!.codec_type !== 'video') return false;
  const fps = parseFps(streams[0]!.r_frame_rate);
  if (!Number.isFinite(fps) || Math.abs(fps - TRIM_FPS) > 0.01) return false;
  if (data.format?.duration == null) return false;
  const duration = Number(data.format.duration);
  return Number.isFinite(duration) && Math.abs(duration - seconds) <= TRIM_DURATION_TOLERANCE;
}

export function run(cmd: string, args: string[], signal: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { signal, maxBuffer: MAX_OUTPUT_BYTES, killSignal: 'SIGKILL' }, (err, stdout) => {
      if (err) reject(err);
      else resolve(stdout);
    });
  });
}

export interface VideoTrimOptions {
  tmpRoot?: string;
  /** Số byte trống thay thế (test). */
  freeBytes?: () => Promise<number>;
}

export class VideoTrimService {
  private readonly lock = new FifoLock();
  readonly tmpRoot: string;

  constructor(private readonly opts: VideoTrimOptions = {}) {
    this.tmpRoot = opts.tmpRoot ?? path.join(os.tmpdir(), TRIM_DIR_PREFIX);
  }

  /** Chạy việc dưới khóa ffmpeg dùng chung (mỗi lúc chỉ một ffmpeg trong tiến trình worker). */
  runExclusive<T>(signal: AbortSignal, fn: () => Promise<T>): Promise<T> {
    return this.lock.run(signal, fn);
  }

  /** Xóa mọi thư mục tạm còn sót (gọi khi worker khởi động). */
  async cleanupStale(): Promise<void> {
    await fs.promises.rm(this.tmpRoot, { recursive: true, force: true });
  }

  async prepare(ctx: PrepareContext): Promise<Record<string, Buffer>> {
    const { row, storage, signal } = ctx;
    const keys = (row.inputKeys ?? {}) as Record<string, string | undefined>;
    const params = (row.params ?? {}) as Record<string, unknown>;
    const videoKey = keys.videoKey;
    const characterKey = keys.characterKey;
    const { trimStart, seconds } = params;
    if (
      !videoKey ||
      !characterKey ||
      !Number.isInteger(trimStart) ||
      !Number.isInteger(seconds) ||
      (trimStart as number) < 0 ||
      (seconds as number) <= 0
    ) {
      throw new PrepareError('INTERNAL_ERROR', 'Thiếu input hoặc tham số cắt');
    }
    return this.lock.run(signal, () =>
      this.trim(storage, signal, row.id, videoKey, characterKey, trimStart as number, seconds as number),
    );
  }

  private async fetchWithRetry(storage: StoragePort, key: string, signal: AbortSignal): Promise<Buffer> {
    let last: unknown;
    for (let i = 0; i < FETCH_ATTEMPTS; i++) {
      if (signal.aborted) throw abortError();
      try {
        return await storage.getObject(key, signal);
      } catch (err) {
        if (signal.aborted) throw abortError();
        last = err;
      }
    }
    throw new PrepareError('INPUT_FETCH_ERROR', String(last));
  }

  /** Lỗi đĩa cục bộ là INTERNAL_ERROR, không phải lỗi tải. */
  private async fsOp<T>(signal: AbortSignal, op: string, fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      if (signal.aborted) throw abortError();
      throw new PrepareError('INTERNAL_ERROR', `Lỗi đĩa cục bộ (${op}): ${String(err)}`);
    }
  }

  private async freeBytes(): Promise<number> {
    if (this.opts.freeBytes) return this.opts.freeBytes();
    const s = await fs.promises.statfs(this.tmpRoot);
    return Number(s.bavail) * Number(s.bsize);
  }

  private async trim(
    storage: StoragePort,
    signal: AbortSignal,
    taskId: string,
    videoKey: string,
    characterKey: string,
    trimStart: number,
    seconds: number,
  ): Promise<Record<string, Buffer>> {
    await this.fsOp(signal, 'mkdir', () => fs.promises.mkdir(this.tmpRoot, { recursive: true }));
    let head;
    try {
      head = await storage.head(videoKey);
    } catch (err) {
      if (signal.aborted) throw abortError();
      throw new PrepareError('INPUT_FETCH_ERROR', String(err));
    }
    if (!head) throw new PrepareError('INPUT_FETCH_ERROR', 'Không thấy video');
    let free: number;
    try {
      free = await this.freeBytes();
    } catch (err) {
      if (signal.aborted) throw abortError();
      throw new PrepareError('INTERNAL_ERROR', `Không đo được đĩa trống: ${String(err)}`);
    }
    if (free < DISK_FACTOR * head.sizeBytes) throw new PrepareError('INTERNAL_ERROR', 'Thiếu đĩa trống');

    const dir = await this.fsOp(signal, 'mkdtemp', () =>
      fs.promises.mkdtemp(path.join(this.tmpRoot, `${taskId.replace(/[^A-Za-z0-9-]/g, '')}-`)),
    );
    try {
      const name = crypto.randomUUID();
      const inFile = path.join(dir, `${name}-in`);
      const outFile = path.join(dir, `${name}-out.mp4`);
      const video = await this.fetchWithRetry(storage, videoKey, signal);
      await this.fsOp(signal, 'writeFile', () => fs.promises.writeFile(inFile, video));

      try {
        await run('nice', ['-n', '19', 'ffmpeg', ...buildFfmpegArgs(inFile, outFile, trimStart, seconds)], signal);
      } catch (err) {
        if (signal.aborted) throw abortError();
        throw new PrepareError('FFMPEG_ERROR', `ffmpeg lỗi: ${String(err)}`);
      }
      let probe: unknown;
      try {
        probe = JSON.parse(await run('ffprobe', buildLocalFfprobeArgs(outFile), signal));
      } catch (err) {
        if (signal.aborted) throw abortError();
        throw new PrepareError('FFMPEG_ERROR', `ffprobe lỗi: ${String(err)}`);
      }
      if (!evaluateTrimmedProbe(probe, seconds)) throw new PrepareError('FFMPEG_ERROR', 'File cắt sai thông số');
      const trimmed = await this.fsOp(signal, 'readFile', () => fs.promises.readFile(outFile));
      const character = await this.fetchWithRetry(storage, characterKey, signal);
      return { videoKey: trimmed, characterKey: character };
    } finally {
      await fs.promises.rm(dir, { recursive: true, force: true });
    }
  }
}

/** Dùng chung trong tiến trình worker: một khóa ffmpeg duy nhất. */
export const videoTrim = new VideoTrimService();
