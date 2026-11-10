import { execFile } from 'node:child_process';
import { Injectable } from '@nestjs/common';
import type { ValidationReason } from '@flowvis/contracts';

export const FFPROBE_TIMEOUT_MS = 10_000;
export const FFPROBE_MAX_CONCURRENCY = 2;
export const MIN_VIDEO_SECONDS = 3;
const MAX_OUTPUT_BYTES = 4 * 1024 * 1024;

export interface VideoProbeMeta {
  durationSeconds: number;
  width: number;
  height: number;
}

export type VideoProbeVerdict =
  | { ok: true; meta: VideoProbeMeta }
  | { ok: false; reason: Extract<ValidationReason, 'VIDEO_UNREADABLE' | 'VIDEO_TOO_SHORT'> };

/** Lỗi không đọc được video (ffprobe lỗi, quá hạn, JSON hỏng). */
export class VideoProbeFailedError extends Error {}

/** Mảng đối số cố định; URL ký là phần tử riêng cuối cùng, không qua shell. */
export function buildFfprobeArgs(url: string): string[] {
  return [
    '-v',
    'error',
    '-protocol_whitelist',
    'https,tls,tcp',
    '-print_format',
    'json',
    '-show_format',
    '-show_streams',
    url,
  ];
}

interface ProbeStream {
  codec_type?: string;
  disposition?: { attached_pic?: number };
  width?: number;
  height?: number;
  tags?: { rotate?: string };
  side_data_list?: { rotation?: number }[];
}
interface ProbeJson {
  format?: { format_name?: string; duration?: string | number };
  streams?: ProbeStream[];
}

/** Hàm thuần: đánh giá JSON của ffprobe. */
export function evaluateProbe(json: unknown): VideoProbeVerdict {
  const data = (json ?? {}) as ProbeJson;
  const unreadable = { ok: false, reason: 'VIDEO_UNREADABLE' } as const;
  const formats = String(data.format?.format_name ?? '').split(',');
  if (!formats.some((f) => f === 'mov' || f === 'mp4')) return unreadable;
  const video = (data.streams ?? []).find(
    (s) => s.codec_type === 'video' && s.disposition?.attached_pic !== 1,
  );
  if (!video) return unreadable;
  const w = Number(video.width);
  const h = Number(video.height);
  if (!Number.isInteger(w) || !Number.isInteger(h) || w <= 0 || h <= 0) return unreadable;
  const duration = Number(data.format?.duration);
  if (data.format?.duration == null || !Number.isFinite(duration) || duration <= 0) return unreadable;
  if (duration < MIN_VIDEO_SECONDS) return { ok: false, reason: 'VIDEO_TOO_SHORT' };

  const rotRaw = video.side_data_list?.find((d) => typeof d.rotation === 'number')?.rotation
    ?? Number(video.tags?.rotate ?? 0);
  const rot = Number.isFinite(rotRaw) ? Math.abs(Math.round(rotRaw)) % 180 : 0;
  const swap = rot === 90;
  return {
    ok: true,
    meta: {
      durationSeconds: Math.floor(duration),
      width: swap ? h : w,
      height: swap ? w : h,
    },
  };
}

@Injectable()
export class VideoProbeService {
  private active = 0;
  private readonly waiters: (() => void)[] = [];

  private async acquire(): Promise<void> {
    if (this.active < FFPROBE_MAX_CONCURRENCY) {
      this.active++;
      return;
    }
    // Chuyển lượt trực tiếp cho người chờ (active giữ nguyên).
    await new Promise<void>((resolve) => this.waiters.push(resolve));
  }

  private release(): void {
    const next = this.waiters.shift();
    if (next) next();
    else this.active--;
  }

  /** Chạy ffprobe (tối đa 2 đồng thời) và đánh giá kết quả. */
  async probeUrl(getUrl: () => Promise<string>): Promise<VideoProbeVerdict> {
    await this.acquire();
    try {
      let json: unknown;
      try {
        // Ký URL sau khi có lượt chạy: TTL ngắn không bị tiêu hao khi chờ hàng đợi.
        json = await this.runFfprobe(await getUrl());
      } catch (err) {
        if (err instanceof VideoProbeFailedError) return { ok: false, reason: 'VIDEO_UNREADABLE' };
        throw err;
      }
      return evaluateProbe(json);
    } finally {
      this.release();
    }
  }

  protected runFfprobe(url: string): Promise<unknown> {
    return new Promise((resolve, reject) => {
      execFile(
        'ffprobe',
        buildFfprobeArgs(url),
        { timeout: FFPROBE_TIMEOUT_MS, killSignal: 'SIGKILL', maxBuffer: MAX_OUTPUT_BYTES, shell: false },
        (err, stdout) => {
          if (err) {
            const e = err as NodeJS.ErrnoException & { killed?: boolean; code?: string | number };
            if (e.code === 'ENOENT') return reject(err);
            return reject(new VideoProbeFailedError(e.killed ? 'timeout' : 'ffprobe failed'));
          }
          try {
            resolve(JSON.parse(stdout));
          } catch {
            reject(new VideoProbeFailedError('invalid json'));
          }
        },
      );
    });
  }
}
