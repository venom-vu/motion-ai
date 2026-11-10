import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  FifoLock,
  PrepareError,
  VideoTrimService,
  buildFfmpegArgs,
  evaluateTrimmedProbe,
} from '../dist/modules/tasks/video-trim.service.js';
import { PIPELINE_CONFIGS } from '../dist/modules/pipelines/index.js';

const fx = (n) => path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', n);
const mkRoot = () => fs.mkdtempSync(path.join(os.tmpdir(), 'trim-test-'));
const sig = () => new AbortController().signal;

function storageOf(files, opts = {}) {
  return {
    async head(k) { return files[k] ? { sizeBytes: files[k].length, etag: 'e' } : null; },
    async getObject(k, s) {
      opts.onGet?.(k);
      if (opts.failVideo && k === 'in/v') throw new Error('boom');
      if (s?.aborted) throw new Error('aborted');
      return files[k];
    },
  };
}
const row = (params = { trimStart: 1, seconds: 3 }) => ({
  id: 'task-1',
  inputKeys: { characterKey: 'in/c', videoKey: 'in/v' },
  params,
});
const probe = (f) =>
  JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', f]).toString());

describe('Story 5.4: cắt video bằng ffmpeg', () => {
  it('buildFfmpegArgs: đối số cố định, -an, 24 FPS', () => {
    const a = buildFfmpegArgs('/i', '/o.mp4', 2, 5);
    assert.deepEqual(a.slice(a.indexOf('-ss'), a.indexOf('-ss') + 2), ['-ss', '2']);
    assert.ok(a.includes('-an') && a.includes('libx264') && a.includes('veryfast'));
    assert.equal(a[a.indexOf('-r') + 1], '24');
    assert.equal(a.at(-1), '/o.mp4');
  });

  it('evaluateTrimmedProbe: ranh giới', () => {
    const ok = { streams: [{ codec_type: 'video', r_frame_rate: '24/1' }], format: { duration: '5.3' } };
    assert.equal(evaluateTrimmedProbe(ok, 5), true);
    assert.equal(evaluateTrimmedProbe({ ...ok, format: { duration: '6.2' } }, 5), false);
    assert.equal(evaluateTrimmedProbe({ ...ok, streams: [{ codec_type: 'video', r_frame_rate: '30/1' }] }, 5), false);
    assert.equal(evaluateTrimmedProbe({ ...ok, streams: [...ok.streams, { codec_type: 'audio' }] }, 5), false);
    assert.equal(evaluateTrimmedProbe({}, 5), false);
    for (const r of ['0/0', 'abc', undefined]) {
      assert.equal(evaluateTrimmedProbe({ ...ok, streams: [{ codec_type: 'video', r_frame_rate: r }] }, 5), false, String(r));
    }
  });

  it('cắt hợp lệ ra 24 FPS, 1 luồng, đúng độ dài; xóa thư mục tạm', async () => {
    const root = mkRoot();
    const svc = new VideoTrimService({ tmpRoot: root });
    const out = await svc.prepare({
      row: row(),
      storage: storageOf({ 'in/v': fs.readFileSync(fx('ok.mp4')), 'in/c': Buffer.from('img') }),
      signal: sig(),
    });
    assert.equal(out.characterKey.toString(), 'img');
    const f = path.join(os.tmpdir(), `trim-out-${process.pid}.mp4`);
    fs.writeFileSync(f, out.videoKey);
    assert.equal(evaluateTrimmedProbe(probe(f), 3), true);
    fs.rmSync(f);
    assert.deepEqual(fs.readdirSync(root), []);
  });

  it('video xoay 90: file ra đúng chiều (width < height)', async () => {
    const root = mkRoot();
    const work = mkRoot();
    const y = path.join(work, 'y.mp4');
    const rot = path.join(work, 'rot.mp4');
    const ff = (...a) => execFileSync('ffmpeg', ['-v', 'error', '-y', ...a]);
    ff('-f', 'lavfi', '-i', 'testsrc=s=320x180:d=6:r=30', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', y);
    ff('-display_rotation:v:0', '90', '-i', y, '-c', 'copy', rot);
    const svc = new VideoTrimService({ tmpRoot: root });
    const out = await svc.prepare({
      row: row(),
      storage: storageOf({ 'in/v': fs.readFileSync(rot), 'in/c': Buffer.from('i') }),
      signal: sig(),
    });
    const f = path.join(work, 'out.mp4');
    fs.writeFileSync(f, out.videoKey);
    const v = probe(f).streams[0];
    assert.equal(v.width, 180);
    assert.equal(v.height, 320);
    assert.deepEqual(fs.readdirSync(root), []);
  });

  it('video kích thước lẻ 321x181: cắt thành công', async () => {
    const work = mkRoot();
    const src = path.join(work, 'odd.mp4');
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=s=321x181:d=6:r=30', '-c:v', 'libx264', '-pix_fmt', 'yuv444p', src]);
    const svc = new VideoTrimService({ tmpRoot: mkRoot() });
    const out = await svc.prepare({
      row: row(),
      storage: storageOf({ 'in/v': fs.readFileSync(src), 'in/c': Buffer.from('i') }),
      signal: sig(),
    });
    assert.ok(out.videoKey.length > 0);
  });

  it('ffmpeg lỗi (file hỏng) => FFMPEG_ERROR, dọn thư mục', async () => {
    const root = mkRoot();
    const svc = new VideoTrimService({ tmpRoot: root });
    await assert.rejects(
      svc.prepare({ row: row(), storage: storageOf({ 'in/v': Buffer.from('xxxx'), 'in/c': Buffer.from('i') }), signal: sig() }),
      (e) => e instanceof PrepareError && e.reason === 'FFMPEG_ERROR',
    );
    assert.deepEqual(fs.readdirSync(root), []);
  });

  it('sai lệch độ dài (video ngắn hơn đoạn cắt) => FFMPEG_ERROR', async () => {
    const svc = new VideoTrimService({ tmpRoot: mkRoot() });
    await assert.rejects(
      svc.prepare({
        row: row({ trimStart: 2, seconds: 5 }),
        storage: storageOf({ 'in/v': fs.readFileSync(fx('ok.mp4')), 'in/c': Buffer.from('i') }),
        signal: sig(),
      }),
      (e) => e instanceof PrepareError && e.reason === 'FFMPEG_ERROR',
    );
  });

  it('tải lỗi 3 lần => INPUT_FETCH_ERROR', async () => {
    const root = mkRoot();
    let gets = 0;
    const svc = new VideoTrimService({ tmpRoot: root });
    await assert.rejects(
      svc.prepare({
        row: row(),
        storage: storageOf({ 'in/v': Buffer.from('x'), 'in/c': Buffer.from('i') }, { failVideo: true, onGet: () => gets++ }),
        signal: sig(),
      }),
      (e) => e instanceof PrepareError && e.reason === 'INPUT_FETCH_ERROR',
    );
    assert.equal(gets, 3);
    assert.deepEqual(fs.readdirSync(root), []);
  });

  it('lỗi đĩa cục bộ (mkdir) => INTERNAL_ERROR', async () => {
    const file = path.join(mkRoot(), 'plain-file');
    fs.writeFileSync(file, 'x');
    const svc = new VideoTrimService({ tmpRoot: path.join(file, 'sub') });
    await assert.rejects(
      svc.prepare({ row: row(), storage: storageOf({ 'in/v': Buffer.from('x'), 'in/c': Buffer.from('i') }), signal: sig() }),
      (e) => e instanceof PrepareError && e.reason === 'INTERNAL_ERROR' && /mkdir/.test(e.message),
    );
  });

  it('thiếu đĩa => INTERNAL_ERROR, không tải', async () => {
    let gets = 0;
    const svc = new VideoTrimService({ tmpRoot: mkRoot(), freeBytes: async () => 10 });
    await assert.rejects(
      svc.prepare({
        row: row(),
        storage: storageOf({ 'in/v': Buffer.alloc(100), 'in/c': Buffer.from('i') }, { onGet: () => gets++ }),
        signal: sig(),
      }),
      (e) => e instanceof PrepareError && e.reason === 'INTERNAL_ERROR',
    );
    assert.equal(gets, 0);
  });

  it('hủy khi đang tải: dừng, dọn thư mục', async () => {
    const root = mkRoot();
    const svc = new VideoTrimService({ tmpRoot: root });
    const ac = new AbortController();
    const p = svc.prepare({
      row: row(),
      storage: storageOf({ 'in/v': fs.readFileSync(fx('ok.mp4')), 'in/c': Buffer.from('i') }, { onGet: () => ac.abort() }),
      signal: ac.signal,
    });
    await assert.rejects(p, (e) => e.name === 'AbortError' || /abort/i.test(String(e)));
    assert.deepEqual(fs.readdirSync(root), []);
  });

  it('FifoLock: không chồng nhau, đúng thứ tự FIFO', async () => {
    const lock = new FifoLock();
    const log = [];
    let active = 0;
    const job = (n) => lock.run(sig(), async () => {
      assert.equal(++active, 1);
      log.push(n);
      await new Promise((r) => setTimeout(r, 20));
      active--;
    });
    await Promise.all([job(1), job(2), job(3)]);
    assert.deepEqual(log, [1, 2, 3]);
  });

  it('FifoLock: hủy khi đang chờ khóa', async () => {
    const lock = new FifoLock();
    const ac = new AbortController();
    const first = lock.run(sig(), () => new Promise((r) => setTimeout(r, 50)));
    const waiting = lock.run(ac.signal, async () => 'x');
    ac.abort();
    await assert.rejects(waiting, (e) => e.name === 'AbortError');
    await first;
    assert.equal(await lock.run(sig(), async () => 'ok'), 'ok');
  });

  it('cleanupStale xóa thư mục sót', async () => {
    const root = mkRoot();
    fs.mkdirSync(path.join(root, 'old-1'));
    await new VideoTrimService({ tmpRoot: root }).cleanupStale();
    assert.equal(fs.existsSync(root), false);
  });

  it('chỉ motion_control có prepare', () => {
    assert.equal(typeof PIPELINE_CONFIGS.motion_control.prepare, 'function');
    assert.equal(PIPELINE_CONFIGS.face_swap.prepare, undefined);
    assert.equal(PIPELINE_CONFIGS.body_retouch.prepare, undefined);
  });
});
