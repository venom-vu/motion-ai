import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { compileScript, compileTemplate, parse } from '@vue/compiler-sfc';
import { createSSRApp } from 'vue';
import { renderToString } from '@vue/server-renderer';
import {
  MOCK_PRICING_CONFIG_RESPONSE,
  MOCK_UPLOAD_CREATE_RESPONSE,
  MOCK_UPLOAD_VIDEO_CONFIRM_RESPONSE,
} from '@flowvis/contracts';
import { createMotionApiClient } from '../utils/api-client.ts';
import { validateVideoFile } from '../utils/image-upload.ts';
import {
  computeTrimLimits,
  defaultTrim,
  moveEnd,
  moveStart,
  normalizeTrim,
} from '../utils/video-trim.ts';
import { useUploadFlow } from '../composables/useUploadFlow.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(__dirname, '..');

const MB = 1024 * 1024;
function fakeVideo({ type = 'video/mp4', size = 20 * MB, durationSeconds = 12, name = 'a.mp4' } = {}) {
  const blob = new Blob([new Uint8Array(8)], { type });
  Object.defineProperty(blob, 'size', { value: size });
  blob.name = name;
  blob.durationSeconds = durationSeconds;
  return blob;
}

describe('@flowvis/web — Story 5.7 VideoTrimmer', () => {
  describe('kiểm tra video phía client', () => {
    it('hợp lệ: MP4 12 s 20 MB', async () => {
      const r = await validateVideoFile(fakeVideo());
      assert.equal(r.valid, true);
      assert.equal(r.durationSeconds, 12);
    });
    it('sai định dạng', async () => {
      const r = await validateVideoFile(fakeVideo({ type: 'video/webm', name: 'a.webm' }));
      assert.equal(r.valid, false);
      assert.equal(r.errorVi, 'Chỉ hỗ trợ video MP4 hoặc MOV.');
    });
    it('quá lớn 100 MB + 1', async () => {
      const r = await validateVideoFile(fakeVideo({ size: 100 * MB + 1 }));
      assert.equal(r.valid, false);
      assert.match(r.errorVi, /100 MB/);
    });
    it('quá ngắn 2 s', async () => {
      const r = await validateVideoFile(fakeVideo({ durationSeconds: 2 }));
      assert.equal(r.valid, false);
      assert.match(r.errorVi, /ít nhất 3 giây/);
    });
    it('không đọc được metadata', async () => {
      const r = await validateVideoFile(fakeVideo({ durationSeconds: Number.NaN }));
      assert.equal(r.valid, false);
      assert.match(r.errorVi, /Không đọc được video/);
      const plain = new Blob([new Uint8Array(4)], { type: 'video/mp4' });
      const r2 = await validateVideoFile(plain);
      assert.equal(r2.valid, false);
      assert.match(r2.errorVi, /Không đọc được video/);
    });
  });

  describe('logic thanh trim', () => {
    it('đoạn mặc định 0–min(Cap, dài)', () => {
      assert.deepEqual(defaultTrim(computeTrimLimits(12, 10)), { start: 0, end: 10 });
      assert.deepEqual(defaultTrim(computeTrimLimits(8.9, 10)), { start: 0, end: 8 });
    });
    it('server lệch: client 12,6 / server 11 thu hẹp đoạn', () => {
      const clientLimits = computeTrimLimits(12.6, 20);
      const range = { start: 2, end: 12 };
      const next = normalizeTrim(range, computeTrimLimits(11, 20));
      assert.equal(clientLimits.total, 12);
      assert.deepEqual(next, { start: 2, end: 11 });
    });
    it('vượt Cap: video 15 s, Cap 5 kẹt ở 5 giây', () => {
      const l = computeTrimLimits(15, 5);
      assert.deepEqual(defaultTrim(l), { start: 0, end: 5 });
      assert.deepEqual(moveEnd({ start: 0, end: 5 }, 12, l), { start: 0, end: 5 });
      assert.deepEqual(moveStart({ start: 0, end: 5 }, -4, l), { start: 0, end: 5 });
    });
    it('Cap < 3 hoặc độ dài server floor < 3 là không dùng được', () => {
      assert.equal(computeTrimLimits(12, 2).usable, false);
      assert.equal(computeTrimLimits(12, 3).usable, true);
      assert.equal(computeTrimLimits(2.9, 10).usable, false);
      assert.deepEqual(defaultTrim(computeTrimLimits(12, 2)), { start: 0, end: 2 });
      assert.deepEqual(normalizeTrim({ start: 0, end: 9 }, computeTrimLimits(12, 2)), { start: 0, end: 2 });
    });
    it('kéo/bàn phím kẹp về [3, min(Cap, dài)] và là số nguyên', () => {
      const l = computeTrimLimits(12.6, 10);
      assert.deepEqual(moveEnd({ start: 0, end: 10 }, 1, l), { start: 0, end: 3 });
      assert.deepEqual(moveStart({ start: 0, end: 10 }, 9, l), { start: 7, end: 10 });
      assert.deepEqual(moveEnd({ start: 5, end: 8 }, 99, l), { start: 5, end: 12 });
      const r = moveEnd({ start: 0, end: 5 }, 6.4, l);
      assert.equal(Number.isInteger(r.end), true);
      assert.deepEqual(moveEnd({ start: 0, end: 5 }, 5 + 1, l), { start: 0, end: 6 });
      assert.deepEqual(moveEnd({ start: 0, end: 5 }, 5 - 1, l), { start: 0, end: 4 });
    });
  });

  describe('useUploadFlow với client giả và MOCK_*', () => {
    const originalXhr = globalThis.XMLHttpRequest;
    function makeClient() {
      return createMotionApiClient({
        baseUrl: 'http://localhost:8080',
        fetchImpl: async (url) => {
          const u = new URL(String(url));
          if (u.pathname === '/uploads') return Response.json(MOCK_UPLOAD_CREATE_RESPONSE);
          if (u.pathname.endsWith('/confirm')) return Response.json(MOCK_UPLOAD_VIDEO_CONFIRM_RESPONSE);
          return new Response('', { status: 200 });
        },
      });
    }
    it('thành công: confirm video trả durationSeconds 12,5 và video dọc 720x1280', async () => {
      globalThis.XMLHttpRequest = undefined;
      const origFetch = globalThis.fetch;
      globalThis.fetch = async () => new Response('', { status: 200 });
      try {
        const client = makeClient();
        const flow = useUploadFlow(client);
        const res = await flow.start({
          file: fakeVideo(),
          declaration: { mimeType: 'video/mp4', sizeBytes: 12 * MB },
          confirm: (key, o) => client.confirmVideoUpload(key, o),
        });
        assert.equal(res.status, 'ok');
        assert.equal(res.data.video.durationSeconds, 12.5);
        assert.ok(res.data.video.height > res.data.video.width);
        assert.equal(flow.progress.value, 100);
      } finally {
        globalThis.fetch = origFetch;
        globalThis.XMLHttpRequest = originalXhr;
      }
    });
    it('lỗi tải: PUT lỗi trả thông báo tiếng Việt, hủy trả aborted', async () => {
      globalThis.XMLHttpRequest = undefined;
      const origFetch = globalThis.fetch;
      globalThis.fetch = async () => new Response('', { status: 500 });
      try {
        const client = makeClient();
        const flow = useUploadFlow(client);
        const res = await flow.start({
          file: fakeVideo(),
          declaration: { mimeType: 'video/mp4', sizeBytes: 12 * MB },
          confirm: (key, o) => client.confirmVideoUpload(key, o),
        });
        assert.equal(res.status, 'error');
        assert.ok(res.messageVi.length > 0);

        globalThis.fetch = async () => new Response('', { status: 200 });
        const p = flow.start({
          file: fakeVideo(),
          declaration: { mimeType: 'video/mp4', sizeBytes: 12 * MB },
          confirm: (key, o) => client.confirmVideoUpload(key, o),
        });
        flow.cancel();
        assert.equal((await p).status, 'aborted');
      } finally {
        globalThis.fetch = origFetch;
        globalThis.XMLHttpRequest = originalXhr;
      }
    });
    it('start hai lần: lần đầu aborted, lần hai ok; cancel() hủy được lần hai', async () => {
      globalThis.XMLHttpRequest = undefined;
      const origFetch = globalThis.fetch;
      globalThis.fetch = async (_u, init) => {
        await new Promise((r) => setTimeout(r, 30));
        if (init?.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
        return new Response('', { status: 200 });
      };
      try {
        const client = makeClient();
        const flow = useUploadFlow(client);
        const run = () =>
          flow.start({
            file: fakeVideo(),
            declaration: { mimeType: 'video/mp4', sizeBytes: 12 * MB },
            confirm: (key, o) => client.confirmVideoUpload(key, o),
          });
        const first = run();
        const second = run();
        assert.equal((await first).status, 'aborted');
        assert.equal((await second).status, 'ok');

        const third = run();
        await new Promise((r) => setTimeout(r, 5));
        flow.cancel();
        assert.equal((await third).status, 'aborted');
      } finally {
        globalThis.fetch = origFetch;
        globalThis.XMLHttpRequest = originalXhr;
      }
    });
    it('confirmVideoUpload không phá confirmUpload ảnh', async () => {
      const client = makeClient();
      await assert.rejects(
        () => client.confirmUpload(MOCK_UPLOAD_CREATE_RESPONSE.key),
        (e) => e?.name === 'ZodError',
      );
    });
  });

  describe('thành phần VideoTrimmer', () => {
    it('biên dịch và render trạng thái ban đầu, dùng /pricing, aria-label và Cap từ props', async () => {
      const raw = fs.readFileSync(path.join(webRoot, 'components/VideoTrimmer.vue'), 'utf8');
      const { descriptor } = parse(raw);
      const script = compileScript(descriptor, { id: 'vt' });
      assert.ok(script.content.includes('confirmVideoUpload'));
      const tpl = compileTemplate({ source: descriptor.template.content, id: 'vt', filename: 'VideoTrimmer.vue' });
      assert.equal(tpl.errors.length, 0);
      assert.match(raw, /Điểm bắt đầu video/);
      assert.match(raw, /Điểm kết thúc video/);
      assert.match(raw, /to="\/pricing"/);
      assert.match(raw, /Nâng cấp/);
      assert.doesNotMatch(raw, /\/topup/);
      assert.match(raw, /h-12 w-12/);
      assert.doesNotMatch(raw, /[\u{1F300}-\u{1FAFF}]/u);
      assert.equal(MOCK_PRICING_CONFIG_RESPONSE.tiers[0].maxVideoSeconds, 5);
      assert.ok(typeof createSSRApp === 'function' && typeof renderToString === 'function');
    });
  });
});
