import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  buildFfmpegArgs,
  buildLocalFfprobeArgs,
  evaluateTrimmedProbe,
  run,
} from '../modules/tasks/video-trim.service.js';

/**
 * Bước 2 cổng trước khi bật VietQR (Story 6.11): cắt một clip bằng đúng lệnh sản xuất của Story 5.4
 * (`nice -n 19 ffmpeg` + `buildFfmpegArgs`), rồi ffprobe kiểm tra như worker.
 * Dùng: node apps/api/dist/scripts/prelaunch-trim.js <file> [--start 0] [--seconds 20]
 * In JSON một dòng; thoát 0 cắt đạt, 1 ffmpeg/ffprobe lỗi hoặc file cắt sai thông số, 2 lỗi tham số/đầu vào.
 */
const TIMEOUT_MS = 10 * 60_000;
const SAMPLE_MS = 250;

class UsageError extends Error {}

function parseArgs(argv: string[]): { input: string; start: number; seconds: number } {
  let input: string | undefined;
  let start = 0;
  let seconds = 20;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === '--start' || a === '--seconds') {
      const n = Number(argv[++i]);
      if (!Number.isInteger(n) || n < 0 || (a === '--seconds' && n <= 0)) {
        throw new UsageError(`${a} phải là số nguyên giây hợp lệ.`);
      }
      if (a === '--start') start = n;
      else seconds = n;
    } else if (!input) {
      input = a;
    } else {
      throw new UsageError(`Đối số thừa: ${a}`);
    }
  }
  if (!input) throw new UsageError('Thiếu đường dẫn clip nguồn.');
  return { input: path.resolve(input), start, seconds };
}

async function dirBytes(dir: string): Promise<number> {
  let total = 0;
  for (const name of await fs.promises.readdir(dir).catch(() => [] as string[])) {
    const st = await fs.promises.stat(path.join(dir, name)).catch(() => null);
    if (st?.isFile()) total += st.size;
  }
  return total;
}

async function main(): Promise<number> {
  process.env.MOTION_PROCESS_ROLE = 'script';
  let args: ReturnType<typeof parseArgs>;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error((err as Error).message);
    console.log(JSON.stringify({ ok: false, error: 'USAGE' }));
    return 2;
  }
  const inStat = await fs.promises.stat(args.input).catch(() => null);
  if (!inStat?.isFile()) {
    console.error(`Không tìm thấy clip nguồn: ${args.input}`);
    console.log(JSON.stringify({ ok: false, error: 'INPUT_NOT_FOUND' }));
    return 2;
  }

  const fsStat = await fs.promises.statfs(os.tmpdir());
  const freeBytesBefore = fsStat.bavail * fsStat.bsize;
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'flowvis-prelaunch-trim-'));
  const signal = AbortSignal.timeout(TIMEOUT_MS);
  let maxTmpBytes = 0;
  let sampling = true;
  const sampler = (async () => {
    while (sampling) {
      maxTmpBytes = Math.max(maxTmpBytes, await dirBytes(dir));
      await new Promise((r) => setTimeout(r, SAMPLE_MS));
    }
  })();

  try {
    // Như worker: file nguồn nằm trong thư mục tạm cùng file kết quả.
    const inFile = path.join(dir, 'clip-in');
    const outFile = path.join(dir, 'clip-out.mp4');
    await fs.promises.copyFile(args.input, inFile);
    const started = performance.now();
    let trimError: string | null = null;
    try {
      await run('nice', ['-n', '19', 'ffmpeg', ...buildFfmpegArgs(inFile, outFile, args.start, args.seconds)], signal);
    } catch (err) {
      trimError = signal.aborted ? 'TIMEOUT' : `ffmpeg lỗi: ${(err as Error).message}`;
    }
    const trimMs = Math.round(performance.now() - started);
    maxTmpBytes = Math.max(maxTmpBytes, await dirBytes(dir));

    let probeOk = false;
    let durationSeconds: number | null = null;
    if (!trimError) {
      try {
        const probe = JSON.parse(await run('ffprobe', buildLocalFfprobeArgs(outFile), signal)) as {
          format?: { duration?: string | number };
        };
        probeOk = evaluateTrimmedProbe(probe, args.seconds);
        const d = Number(probe.format?.duration);
        durationSeconds = Number.isFinite(d) ? d : null;
      } catch (err) {
        trimError = `ffprobe lỗi: ${(err as Error).message}`;
      }
    }
    const outputBytes = (await fs.promises.stat(outFile).catch(() => null))?.size ?? 0;
    const ok = !trimError && probeOk;
    console.log(
      JSON.stringify({
        ok,
        trimMs,
        start: args.start,
        seconds: args.seconds,
        inputBytes: inStat.size,
        outputBytes,
        maxTmpBytes,
        freeBytesBefore,
        probeOk,
        durationSeconds,
        ...(trimError ? { error: trimError } : {}),
      }),
    );
    return ok ? 0 : 1;
  } finally {
    sampling = false;
    await sampler.catch(() => undefined);
    await fs.promises.rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

main().then(
  (code) => process.exit(code),
  (err: unknown) => {
    console.error(err instanceof Error ? err.message : 'prelaunch-trim lỗi');
    process.exit(2);
  },
);
