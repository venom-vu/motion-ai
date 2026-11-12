import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { compileScript, compileTemplate, parse } from '@vue/compiler-sfc';
import { createSSRApp, reactive, ref } from 'vue';
import { renderToString } from '@vue/server-renderer';
import {
  API_ERROR_MESSAGES_VI,
  ApiErrorCode,
  MOCK_ME_RESPONSE,
  MOCK_MOTION_CREATE_REQUEST,
  MOCK_MOTION_RESULT_RESPONSE,
  MOCK_MOTION_TASK_FAILED,
  MOCK_MOTION_TASK_QUEUED,
  MOCK_MOTION_TASK_SUCCEEDED,
  MOCK_MOTION_TASK_TIMED_OUT,
  MOCK_SHARE_INFO_IMAGE_RESPONSE,
  MOCK_SHARE_INFO_VIDEO_RESPONSE,
  getReasonCodeMessageVi,
  motionPrice,
} from '@flowvis/contracts';
import {
  MotionApiClientError,
  createMotionApiClient,
} from '../utils/api-client.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(webRoot, rel), 'utf8');

const apiClientUrl = pathToFileURL(path.join(webRoot, 'utils/api-client.ts')).href;
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'motion-ctl-'));

/** Nạp composable useMotionControl với client giả và cấu hình giá giả. */
globalThis.__sysStatus = ref(false);

async function loadComposable() {
  let code = read('composables/useMotionControl.ts');
  const stubs = {
    '~/composables/useApiClient': `export const useApiClient = () => ({ client: globalThis.__mc.client });`,
    '~/composables/usePricingConfig': `export const usePricingConfig = () => globalThis.__mc.pricing;`,
    '~/composables/useSystemStatus': `const intakePaused = globalThis.__sysStatus; export const useSystemStatus = () => ({ intakePaused, markPaused: () => { intakePaused.value = true; }, refresh: async () => {} });`,
    '~/utils/system-status': `export * from ${JSON.stringify(pathToFileURL(path.join(webRoot, 'utils/system-status.ts')).href)};`,
    '~/utils/api-client': `export * from ${JSON.stringify(apiClientUrl)};`,
  };
  for (const [spec, source] of Object.entries(stubs)) {
    const file = path.join(tmpDir, `${spec.replace(/[^a-z0-9]/gi, '_')}.mjs`);
    fs.writeFileSync(file, source, 'utf8');
    code = code.split(`'${spec}'`).join(JSON.stringify(pathToFileURL(file).href));
  }
  const tmp = path.join(webRoot, 'test', `.tmp-motion-ctl-${process.pid}-${Date.now()}.ts`);
  fs.writeFileSync(tmp, code, 'utf8');
  try {
    return await import(pathToFileURL(tmp).href);
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}

function setup({ me = MOCK_ME_RESPONSE, cap = 10, createImpl } = {}) {
  globalThis.__sysStatus.value = false;
  const meRef = ref(me);
  const capRef = ref(cap);
  const calls = { create: [], refresh: 0 };
  globalThis.__mc = {
    client: {
      createMotionControlTask: async (req) => {
        calls.create.push(req);
        return createImpl ? createImpl(req) : MOCK_MOTION_TASK_QUEUED;
      },
    },
    pricing: {
      me: meRef,
      currentTier: ref('PRO'),
      currentTierCapSeconds: capRef,
      refreshAll: async () => {
        calls.refresh += 1;
      },
    },
  };
  return { meRef, capRef, calls };
}

function fillValid(mc, { start = 0, end = 5 } = {}) {
  mc.characterKey.value = MOCK_MOTION_CREATE_REQUEST.characterKey;
  mc.onTrimChange({
    videoKey: MOCK_MOTION_CREATE_REQUEST.videoKey,
    trimStart: start,
    trimEnd: end,
    durationSeconds: 12,
  });
}

describe('@flowvis/web — Story 5.8 Motion Control', () => {
  let mod;
  before(async () => {
    mod = await loadComposable();
  });
  after(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    delete globalThis.__mc;
  });

  describe('api-client', () => {
    it('createMotionControlTask gửi POST /tasks/motion và parse MotionCreateResponse', async () => {
      const seen = [];
      const client = createMotionApiClient({
        baseUrl: 'http://api.test',
        fetchImpl: async (url, init) => {
          seen.push({ url, init });
          return new Response(JSON.stringify(MOCK_MOTION_TASK_QUEUED), {
            status: 201,
            headers: { 'Content-Type': 'application/json' },
          });
        },
      });
      const task = await client.createMotionControlTask(MOCK_MOTION_CREATE_REQUEST);
      assert.equal(seen[0].url, 'http://api.test/tasks/motion');
      assert.equal(seen[0].init.method, 'POST');
      assert.deepEqual(JSON.parse(seen[0].init.body), MOCK_MOTION_CREATE_REQUEST);
      assert.equal(task.pipeline, 'motion_control');
      assert.equal(task.price, task.creditCost);
    });

    it('createMotionControlTask từ chối request sai (consent thừa, trim âm) trước khi gọi mạng', async () => {
      let called = false;
      const client = createMotionApiClient({
        baseUrl: 'http://api.test',
        fetchImpl: async () => {
          called = true;
          return new Response('{}');
        },
      });
      await assert.rejects(() =>
        client.createMotionControlTask({ ...MOCK_MOTION_CREATE_REQUEST, consent: true }),
      );
      await assert.rejects(() =>
        client.createMotionControlTask({ ...MOCK_MOTION_CREATE_REQUEST, trimStart: -1 }),
      );
      assert.equal(called, false);
    });

    it('getShareInfo gọi GET /s/{token}/info và parse ảnh/video', async () => {
      const urls = [];
      const make = (body) =>
        createMotionApiClient({
          baseUrl: 'http://api.test',
          fetchImpl: async (url) => {
            urls.push(url);
            return new Response(JSON.stringify(body), { status: 200 });
          },
        });
      const video = await make(MOCK_SHARE_INFO_VIDEO_RESPONSE).getShareInfo('tok');
      const image = await make(MOCK_SHARE_INFO_IMAGE_RESPONSE).getShareInfo('tok');
      assert.equal(urls[0], 'http://api.test/s/tok/info');
      assert.equal(video.mediaType, 'video');
      assert.equal(video.durationSeconds, 5);
      assert.equal(image.mediaType, 'image');
    });

    it('getShareInfo 404 ném MotionApiClientError', async () => {
      const client = createMotionApiClient({
        baseUrl: 'http://api.test',
        fetchImpl: async () =>
          new Response(JSON.stringify({ code: 'NOT_FOUND', message: 'x' }), { status: 404 }),
      });
      await assert.rejects(() => client.getShareInfo('tok'), MotionApiClientError);
    });
  });

  describe('useMotionControl — giá trực tiếp và điều kiện nút Tạo', () => {
    it('kéo 3 -> 8 giây: giá = motionPrice(5) = 250 và số dư còn lại cập nhật', () => {
      setup();
      const mc = mod.useMotionControl();
      fillValid(mc, { start: 3, end: 8 });
      assert.equal(mc.price.value, motionPrice(5));
      assert.equal(mc.price.value, 250);
      assert.equal(mc.remainingBalance.value, MOCK_ME_RESPONSE.balance - 250);
      mc.onTrimChange({
        videoKey: MOCK_MOTION_CREATE_REQUEST.videoKey,
        trimStart: 3,
        trimEnd: 6,
        durationSeconds: 12,
      });
      assert.equal(mc.price.value, motionPrice(3));
      assert.equal(mc.remainingBalance.value, MOCK_ME_RESPONSE.balance - 150);
    });

    it('đủ điều kiện: nút bật; bấm 2 lần chỉ gửi 1 POST', async () => {
      const { calls } = setup();
      const mc = mod.useMotionControl();
      fillValid(mc);
      assert.equal(mc.canSubmit.value, true);
      await Promise.all([mc.submit(), mc.submit()]);
      assert.equal(calls.create.length, 1);
      assert.deepEqual(calls.create[0], {
        characterKey: MOCK_MOTION_CREATE_REQUEST.characterKey,
        videoKey: MOCK_MOTION_CREATE_REQUEST.videoKey,
        trimStart: 0,
        trimEnd: 5,
      });
      assert.equal(mc.activeTask.value.id, MOCK_MOTION_TASK_QUEUED.id);
      assert.equal(mc.isSubmitting.value, false);
    });

    it('thiếu điều kiện: chưa xong ảnh, chưa xong video, chưa đăng nhập, vượt Cap, Cap không dùng được', () => {
      setup();
      let mc = mod.useMotionControl();
      assert.equal(mc.canSubmit.value, false);
      mc.characterKey.value = MOCK_MOTION_CREATE_REQUEST.characterKey;
      assert.equal(mc.canSubmit.value, false, 'chưa có video');
      fillValid(mc);
      assert.equal(mc.canSubmit.value, true);
      mc.characterKey.value = null;
      assert.equal(mc.canSubmit.value, false, 'chưa có ảnh');

      setup({ me: null });
      mc = mod.useMotionControl();
      fillValid(mc);
      assert.equal(mc.canSubmit.value, false, 'chưa đăng nhập');

      setup({ cap: 4 });
      mc = mod.useMotionControl();
      fillValid(mc, { start: 0, end: 6 });
      assert.equal(mc.canSubmit.value, false, 'vượt Cap');

      setup({ cap: 2 });
      mc = mod.useMotionControl();
      fillValid(mc, { start: 0, end: 3 });
      assert.equal(mc.canSubmit.value, false, 'Cap < 3 không dùng được');
    });

    it('thiếu số dư: thông báo ngữ cảnh, không gửi, giữ nguyên form', async () => {
      const { calls } = setup({ me: { ...MOCK_ME_RESPONSE, balance: 100 } });
      const mc = mod.useMotionControl();
      fillValid(mc, { start: 0, end: 5 });
      assert.equal(mc.hasEnoughBalance.value, false);
      assert.equal(mc.canSubmit.value, false);
      assert.match(
        mc.insufficientNoteVi.value,
        /Bạn đang có 100 credit \(cần 250 cr để tạo đoạn 5s\)/,
      );
      await mc.submit();
      assert.equal(calls.create.length, 0);
      assert.equal(mc.characterKey.value, MOCK_MOTION_CREATE_REQUEST.characterKey);
    });
  });

  describe('useMotionControl — bảo trì (PAUSED)', () => {
    it('intakePaused=true: canSubmit=false và submit không gửi POST', async () => {
      const { calls } = setup();
      const mc = mod.useMotionControl();
      fillValid(mc);
      assert.equal(mc.canSubmit.value, true);
      globalThis.__sysStatus.value = true;
      assert.equal(mc.canSubmit.value, false);
      await mc.submit();
      assert.equal(calls.create.length, 0);
    });

    it('503 PAUSED: đặt intakePaused cục bộ, hiện thông báo và không làm mới ví', async () => {
      const { calls } = setup({
        createImpl: () => {
          throw new MotionApiClientError({ status: 503, code: ApiErrorCode.PAUSED });
        },
      });
      const mc = mod.useMotionControl();
      fillValid(mc);
      await mc.submit();
      assert.equal(globalThis.__sysStatus.value, true);
      assert.equal(mc.intakePaused.value, true);
      assert.equal(mc.submitErrorVi.value, API_ERROR_MESSAGES_VI[ApiErrorCode.PAUSED]);
      assert.equal(calls.refresh, 0);
      assert.equal(mc.canSubmit.value, false);
    });
  });

  describe('useMotionControl — lỗi tạo Task', () => {
    it('TRIM_EXCEEDS_CAP: gọi lại me/pricing, thu hẹp Cap và hiện "tối đa {cap} giây"', async () => {
      const { calls } = setup({
        createImpl: () => {
          throw new MotionApiClientError({
            status: 400,
            code: ApiErrorCode.VALIDATION_FAILED,
            details: { reason: 'TRIM_EXCEEDS_CAP', cap: 4 },
          });
        },
      });
      const mc = mod.useMotionControl();
      fillValid(mc, { start: 0, end: 8 });
      assert.equal(mc.capSeconds.value, 10);
      await mc.submit();
      assert.equal(calls.refresh >= 1, true);
      assert.equal(mc.capSeconds.value, 4);
      assert.equal(mc.submitErrorVi.value, 'Gói hiện tại của bạn cho phép tối đa 4 giây');
      assert.equal(mc.activeTask.value, null);
    });

    it('TRIM_EXCEEDS_CAP: lỗi tải lại me/pricing vẫn giữ thông báo', async () => {
      setup({
        createImpl: () => {
          throw new MotionApiClientError({
            status: 400,
            code: ApiErrorCode.VALIDATION_FAILED,
            details: { reason: 'TRIM_EXCEEDS_CAP', cap: 5 },
          });
        },
      });
      globalThis.__mc.pricing.refreshAll = async () => {
        throw new Error('network');
      };
      const mc = mod.useMotionControl();
      fillValid(mc, { start: 0, end: 8 });
      await mc.submit();
      assert.equal(mc.submitErrorVi.value, 'Gói hiện tại của bạn cho phép tối đa 5 giây');
    });

    for (const code of [
      ApiErrorCode.INSUFFICIENT_CREDIT,
      ApiErrorCode.TASK_LIMIT,
      ApiErrorCode.ACCOUNT_LOCKED,
      ApiErrorCode.PAUSED,
      ApiErrorCode.CONSENT_REQUIRED,
    ]) {
      it(`${code}: hiện thông báo tiếng Việt có sẵn`, async () => {
        setup({
          createImpl: () => {
            throw new MotionApiClientError({ status: 409, code });
          },
        });
        const mc = mod.useMotionControl();
        fillValid(mc);
        await mc.submit();
        assert.ok(mc.submitErrorVi.value);
        assert.match(mc.submitErrorVi.value, /[À-ỹ]/);
        assert.equal(mc.isSubmitting.value, false);
      });
    }

    it('details.reason khác (TRIM_OUT_OF_VIDEO) dùng bảng thông báo validation', async () => {
      setup({
        createImpl: () => {
          throw new MotionApiClientError({
            status: 400,
            code: ApiErrorCode.VALIDATION_FAILED,
            details: { reason: 'TRIM_OUT_OF_VIDEO' },
          });
        },
      });
      const mc = mod.useMotionControl();
      fillValid(mc);
      await mc.submit();
      assert.equal(mc.submitErrorVi.value, 'Đoạn cắt nằm ngoài độ dài của video.');
    });
  });

  describe('kết quả, thất bại, giao diện', () => {
    it('thất bại: thông báo riêng pipeline Motion cho NO_POSE, chung cho mã khác', () => {
      assert.equal(
        getReasonCodeMessageVi(MOCK_MOTION_TASK_FAILED.reasonCode, 'motion_control'),
        'Không nhận diện được chuyển động cơ thể trong video mẫu',
      );
      assert.ok(getReasonCodeMessageVi(MOCK_MOTION_TASK_TIMED_OUT.reasonCode, 'motion_control'));
    });

    it('MOCK_MOTION_RESULT_RESPONSE là video có poster và không có sourceUrl', () => {
      assert.equal(MOCK_MOTION_RESULT_RESPONSE.mediaType, 'video');
      assert.ok(MOCK_MOTION_RESULT_RESPONSE.posterUrl);
      assert.equal(MOCK_MOTION_RESULT_RESPONSE.sourceUrl, null);
    });

    it('/tasks/[id] SSR: kết quả video có <video poster controls playsinline>, không có thanh so sánh; ảnh vẫn dùng slider', async () => {
      const { descriptor } = parse(read('pages/tasks/[id].vue'), { filename: 'id.vue' });
      const compiled = compileTemplate({
        id: 'mc-task-id',
        filename: 'id.vue',
        source: descriptor.template.content,
        ssr: true,
        ssrCssVars: [],
      });
      assert.equal(compiled.errors.length, 0);
      const file = path.join(webRoot, 'test', `.tmp-mc-id-${process.pid}.mjs`);
      fs.writeFileSync(file, compiled.code, 'utf8');
      try {
        const { ssrRender } = await import(pathToFileURL(file).href);
        const render = async (result) => {
          const app = createSSRApp({
            ssrRender,
            setup() {
              const noop = () => {};
              return {
                isUnauthenticated: false,
                taskAsync: { pending: { value: false }, refresh: noop },
                currentTask: { id: 'a', pipeline: result.mediaType === 'video' ? 'motion_control' : 'face_swap', status: 'succeeded', createdAt: new Date().toISOString(), creditCost: 100 },
                taskErrorVi: null,
                isExpired: false,
                resultErrorVi: null,
                imageLoadFailed: false,
                resultAsync: { pending: { value: false }, data: { value: result }, refresh: noop },
                isVideoResult: result.mediaType === 'video',
                shareData: null,
                shareToastMessage: null,
                shareErrorVi: null,
                downloadErrorVi: null,
                isSharing: false,
                isRevokingShare: false,
                isDownloading: false,
                getPipelineLabelVi: (p) => p,
                getTaskStatusLabelVi: () => 'ok',
                formatTaskTimestampVi: () => '-',
                getPipelineRoute: () => '/motion-control',
                handleVideoError: noop,
                handleImageError: noop,
                handleRefreshResult: noop,
                handleDownloadImage: noop,
                handleShare: noop,
                handleRevokeShare: noop,
                handleCopyShareLink: noop,
                handleGoBack: noop,
                handleCreateNewTask: noop,
                openAuthDialog: noop,
              };
            },
          });
          app.component('Icon', { props: ['name'], ssrRender: (_c, push) => push('<i></i>') });
          app.component('NuxtLink', { props: ['to'], ssrRender: (_c, push) => push('<a></a>') });
          app.component('TaskProgressCard', { ssrRender: (_c, push) => push('<div></div>') });
          app.component('BeforeAfterSplitSlider', {
            ssrRender: (_c, push) => push('<div data-testid="slider-mock"></div>'),
          });
          return renderToString(app);
        };
        const videoHtml = await render(MOCK_MOTION_RESULT_RESPONSE);
        assert.match(videoHtml, /<video[^>]*playsinline/);
        assert.match(videoHtml, /controls/);
        assert.match(videoHtml, /poster="https:\/\/cdn\.example\.test\/out\/signed-motion-poster\.jpg"/);
        assert.match(videoHtml, /Tải về \(MP4\)/);
        assert.match(videoHtml, /Chia sẻ kết quả/);
        assert.doesNotMatch(videoHtml, /slider-mock/);
        const imageHtml = await render({
          resultUrl: 'https://cdn.example.test/a.jpg',
          sourceUrl: 'https://cdn.example.test/b.jpg',
        });
        assert.match(imageHtml, /slider-mock/);
        assert.doesNotMatch(imageHtml, /<video/);
      } finally {
        fs.rmSync(file, { force: true });
      }
    });

    it('mã nguồn: share page có og:image poster, og:video, getShareInfo; thẻ lịch sử có biểu tượng clapperboard', () => {
      const share = read('pages/share/[token].vue');
      assert.match(share, /getShareInfo/);
      assert.match(share, /\/poster/);
      assert.match(share, /og:video/);
      assert.match(share, /<video/);
      const card = read('components/TaskHistoryRow.vue');
      assert.match(card, /lucide:clapperboard/);
      assert.match(card, /posterUrl/);
      assert.match(card, /durationSeconds/);
      const progress = read('components/TaskProgressCard.vue');
      assert.match(progress, /Video thường mất vài phút, bạn có thể rời trang và quay lại từ Lịch sử/);
    });

    it('trang /motion-control và dialog: dùng VideoTrimmer, composable chung, không emoji, không mockMode, link nạp dẫn /pricing', () => {
      const page = read('pages/motion-control.vue');
      const dialog = read('components/FeatureWorkspaceDialog.vue');
      const composable = read('composables/useMotionControl.ts');
      assert.match(page, /<VideoTrimmer/);
      assert.match(page, /useMotionControl/);
      assert.match(dialog, /<VideoTrimmer/);
      assert.match(dialog, /useMotionControl/);
      assert.match(dialog, /\/motion-control/);
      assert.match(page, /to="\/pricing"/);
      assert.doesNotMatch(page + dialog + composable, /\/topup|mockMode|VietQRModal/);
      assert.doesNotMatch(composable, /\b50\b/);
      assert.doesNotMatch(page, /(?<![/\w-])50(?![\w%])\s*(credit|cr)/i);
      const emoji = /\p{Extended_Pictographic}/u;
      for (const src of [page, dialog, composable, read('pages/tasks/[id].vue')]) {
        assert.equal(emoji.test(src), false);
      }
      assert.match(page, /min-h-\[48px\]/);
    });
  });

  describe('hành vi sau review', () => {
    const catalogUrl = pathToFileURL(path.join(webRoot, 'utils/catalog.ts')).href;
    const tick = () => new Promise((r) => setTimeout(r, 0));

    /** Stub 'vue': bắt hook vòng đời và bỏ qua ngữ cảnh async để chạy setup ngoài component. */
    const vueStub = `export * from 'vue';
      export const onMounted = (fn) => { (globalThis.__hooks ??= { mounted: [], unmount: [] }).mounted.push(fn); };
      export const onBeforeUnmount = (fn) => { (globalThis.__hooks ??= { mounted: [], unmount: [] }).unmount.push(fn); };
      export const withAsyncContext = (get) => [get(), () => {}];`;

    /** Biên dịch <script setup>, thay import alias bằng stub rồi nạp module. */
    async function loadSetup(rel, stubs) {
      const { descriptor } = parse(read(rel));
      let code = compileScript(descriptor, { id: `t-${rel}` }).content;
      stubs = { vue: vueStub, ...stubs };
      const dir = fs.mkdtempSync(path.join(webRoot, 'test', '.tmp-mc-sfc-'));
      try {
        for (const [spec, source] of Object.entries(stubs)) {
          const file = path.join(dir, `${spec.replace(/[^a-z0-9]/gi, '_')}.mjs`);
          fs.writeFileSync(file, source, 'utf8');
          const next = code.split(`'${spec}'`).join(JSON.stringify(pathToFileURL(file).href));
          if (spec !== 'vue') assert.notEqual(next, code, `import ${spec} phải được thay trong ${rel}`);
          code = next;
        }
        // Stub 'vue' re-export từ 'vue' thật: giữ nguyên chỉ định này trong file stub.
        const tmp = path.join(dir, `${path.basename(rel)}.ts`);
        fs.writeFileSync(tmp, code, 'utf8');
        return (await import(pathToFileURL(tmp).href)).default;
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    }

    async function ssrRenderOf(rel) {
      const { descriptor } = parse(read(rel));
      const compiled = compileTemplate({
        id: `ssr-${rel}`,
        filename: path.basename(rel),
        source: descriptor.template.content,
        ssr: true,
        ssrCssVars: [],
      });
      assert.equal(compiled.errors.length, 0);
      const file = path.join(webRoot, 'test', `.tmp-mc-ssr-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`);
      fs.writeFileSync(file, compiled.code, 'utf8');
      try {
        return (await import(pathToFileURL(file).href)).ssrRender;
      } finally {
        fs.rmSync(file, { force: true });
      }
    }

    function decorate(app) {
      app.component('Icon', {
        props: ['name'],
        ssrRender: (c, push) => push(`<i data-icon="${c.name}"></i>`),
      });
      app.component('NuxtLink', { props: ['to'], ssrRender: (_c, push) => push('<a></a>') });
      app.component('TaskProgressCard', { ssrRender: (_c, push) => push('<div></div>') });
      app.component('ImageUploader', {
        props: ['idPrefix'],
        ssrRender: (c, push) => push(`<div data-uploader="${c.idPrefix}"></div>`),
      });
      app.component('VideoTrimmer', {
        props: ['idPrefix'],
        ssrRender: (c, push) => push(`<div data-trimmer="${c.idPrefix}"></div>`),
      });
      return app;
    }

    it('(a) FeatureWorkspaceDialog motion-control: render VideoTrimmer + uploader nhân vật, canSubmit theo composable, submit phát sự kiện', async () => {
      const comp = await loadSetup('components/FeatureWorkspaceDialog.vue', {
        '~/components/ImageUploader.vue': 'export default {};',
        '~/components/TaskProgressCard.vue': 'export default {};',
        '~/composables/useApiClient': 'export const useApiClient = () => ({ client: {} });',
        '~/composables/useAuthDialog': 'export const useAuthDialog = () => ({ open: () => {} });',
        '~/composables/usePricingConfig': 'export const usePricingConfig = () => ({ refreshAll: async () => {} });',
        '~/composables/useMotionControl': 'export const useMotionControl = () => globalThis.__fwd.motion;',
        '~/utils/api-client': `export { ApiErrorCode, INTENSITY_DEFAULT, INTENSITY_LABEL_ZONES, INTENSITY_MAX, INTENSITY_MIN, IntensitySchema, getIntensityLabelVi, resolveApiErrorMessageVi } from ${JSON.stringify(apiClientUrl)};`,
        '~/utils/catalog': `export { calculateFeatureEstimatedCredits, formatNumberVi } from ${JSON.stringify(catalogUrl)};`,
      });
      const submitCalls = [];
      const motion = {
        isAuthenticated: ref(true),
        isSubmitting: ref(false),
        characterKey: ref(MOCK_MOTION_CREATE_REQUEST.characterKey),
        capSeconds: ref(10),
        seconds: ref(5),
        price: ref(250),
        hasEnoughBalance: ref(true),
        canSubmit: ref(true),
        insufficientNoteVi: ref(null),
        submitErrorVi: ref(null),
        onTrimChange: () => {},
        submit: async () => {
          submitCalls.push(1);
          return MOCK_MOTION_TASK_QUEUED;
        },
        reset: () => {},
        clearState: () => {},
      };
      globalThis.__fwd = { motion };
      const feature = {
        id: 'motion-control',
        titleVi: 'Motion',
        categoryLabelVi: 'Video',
        icon: 'lucide:clapperboard',
        billingMode: 'per_second',
        unitCredits: 50,
        priceBadgeVi: 'x',
        tierCapSeconds: 10,
        inputRequirementVi: 'y',
        beforeLabelVi: 'a',
        afterLabelVi: 'b',
        outputFormatVi: 'c',
      };
      const emitted = [];
      const props = reactive({ open: true, feature, userTier: 'PRO', userBalance: 1000 });
      const state = comp.setup(props, { emit: (e, p) => emitted.push([e, p]), expose() {} });

      assert.equal(state.canSubmit.value, true);
      motion.canSubmit.value = false;
      assert.equal(state.canSubmit.value, false, 'canSubmit theo composable');
      motion.canSubmit.value = true;

      // SSR: có VideoTrimmer và uploader nhân vật Motion, không có uploader ảnh cũ
      const ssrRender = await ssrRenderOf('components/FeatureWorkspaceDialog.vue');
      const html = await renderToString(
        decorate(
          createSSRApp({ ssrRender, setup: () => ({ ...props, ...state, props }) }),
        ),
      );
      assert.match(html, /data-trimmer="workspace-motion-video"/);
      assert.match(html, /data-uploader="workspace-motion-character"/);
      assert.doesNotMatch(html, /data-uploader="workspace-input"/);

      await state.handleSubmit();
      assert.equal(submitCalls.length, 1);
      const evt = emitted.find(([e]) => e === 'submit');
      assert.deepEqual(evt[1], {
        featureId: 'motion-control',
        seconds: 5,
        estimatedCredits: 250,
        uploadedKey: MOCK_MOTION_CREATE_REQUEST.characterKey,
      });
      delete globalThis.__fwd;
    });

    it('(b) TaskHistoryRow video: có thumb, poster src, độ dài; getTaskResult reject thì dùng icon clapperboard', async () => {
      const ssrRender = await ssrRenderOf('components/TaskHistoryRow.vue');
      const make = async (getTaskResult) => {
        globalThis.__hooks = { mounted: [], unmount: [] };
        globalThis.__hc = { client: { getTaskResult } };
        const comp = await loadSetup('components/TaskHistoryRow.vue', {
          '~/composables/useApiClient': 'export const useApiClient = () => ({ client: globalThis.__hc.client });',
          '~/utils/task-format': `export * from ${JSON.stringify(pathToFileURL(path.join(webRoot, 'utils/task-format.ts')).href)};`,
          '~/utils/status-badge': `export * from ${JSON.stringify(pathToFileURL(path.join(webRoot, 'utils/status-badge.ts')).href)};`,
        });
        const props = reactive({
          task: { ...MOCK_MOTION_TASK_SUCCEEDED, createdAt: new Date().toISOString() },
          cancelling: false,
        });
        const state = comp.setup(props, { emit() {}, expose() {} });
        for (const fn of globalThis.__hooks.mounted) await fn();
        await tick();
        return { props, state };
      };
      const render = ({ props, state }) =>
        renderToString(
          decorate(
            createSSRApp({
              ssrRender,
              setup: () => ({ ...state, task: props.task, cancelling: false, emit() {} }),
            }),
          ),
        );

      const ok = await make(async () => MOCK_MOTION_RESULT_RESPONSE);
      const okHtml = await render(ok);
      assert.match(okHtml, /data-testid="task-video-thumb-/);
      assert.match(okHtml, /<img[^>]*src="https:\/\/cdn\.example\.test\/out\/signed-motion-poster\.jpg"/);
      assert.match(okHtml, /data-testid="task-video-duration"[^>]*>\s*5s/);

      const bad = await make(async () => {
        throw new Error('x');
      });
      const badHtml = await render(bad);
      assert.match(badHtml, /data-icon="lucide:clapperboard"/);
      assert.doesNotMatch(badHtml, /<img/);

      // Kết quả của lần gọi cũ bị bỏ khi id đã đổi.
      let resolveOld;
      const stale = await make(
        () => new Promise((resolve) => {
          resolveOld = resolve;
        }),
      );
      stale.props.task = { ...stale.props.task, id: '72000000-0000-4000-8000-0000000000bb' };
      resolveOld(MOCK_MOTION_RESULT_RESPONSE);
      await tick();
      assert.equal(stale.state.videoInfo.value, null);
      delete globalThis.__hc;
      delete globalThis.__hooks;
    });

    async function runSharePage(getShareInfo) {
      const comp = await loadSetup('pages/share/[token].vue', {
        '#imports': `export const setResponseStatus = () => {};
          export const useAsyncData = async (_k, fn, opts) => { let v; try { v = await fn(); } catch (e) { return { data: { value: opts.default() }, error: { value: e } }; } return { data: { value: v }, error: { value: null } }; };
          export const useHead = () => {};
          export const useRequestEvent = () => null;
          export const useRequestURL = () => ({ origin: 'https://flowvis.test' });
          export const useRoute = () => ({ params: { token: 'A'.repeat(43) } });
          export const useRuntimeConfig = () => ({ public: { apiBaseUrl: 'http://api.test' } });`,
        '~/composables/useApiClient': 'export const useApiClient = () => ({ client: globalThis.__sp.client });',
      });
      globalThis.__sp = { client: { getShareInfo } };
      try {
        // $fetch là global của Nuxt: mô phỏng bằng hàm có thuộc tính raw
        globalThis.$fetch = Object.assign(async () => ({}), { raw: async () => ({ status: 302 }) });
        const state = await comp.setup({}, { emit() {}, expose() {} });
        return state;
      } finally {
        delete globalThis.$fetch;
        delete globalThis.__sp;
      }
    }

    it('(c) share page: getShareInfo lỗi hai lần -> ảnh; lỗi một lần rồi thành công -> video', async () => {
      let calls = 0;
      const failTwice = await runSharePage(async () => {
        calls += 1;
        throw new Error('down');
      });
      assert.equal(calls, 2);
      assert.equal(failTwice.isVideo.value, false);

      let n = 0;
      const flaky = await runSharePage(async () => {
        n += 1;
        if (n === 1) throw new Error('blip');
        return MOCK_SHARE_INFO_VIDEO_RESPONSE;
      });
      assert.equal(n, 2);
      assert.equal(flaky.isVideo.value, true);
      assert.equal(flaky.videoDurationSeconds.value, 5);
    });

    it('(d) useMotionControl: reset() xóa form (canSubmit false) và refreshAll reject không gây unhandled rejection', async () => {
      const { calls } = setup();
      globalThis.__mc.pricing.refreshAll = async () => {
        calls.refresh += 1;
        throw new Error('network');
      };
      const unhandled = [];
      const onUnhandled = (e) => unhandled.push(e);
      process.on('unhandledRejection', onUnhandled);
      try {
        const mc = mod.useMotionControl();
        fillValid(mc);
        assert.equal(mc.canSubmit.value, true);
        await mc.submit();
        mc.reset();
        assert.equal(mc.canSubmit.value, false);
        assert.equal(mc.characterKey.value, null);
        assert.equal(mc.videoKey.value, null);
        assert.equal(mc.seconds.value, 0);
        await tick();
        await tick();
        assert.equal(calls.refresh >= 2, true);
        assert.deepEqual(unhandled, []);
      } finally {
        process.off('unhandledRejection', onUnhandled);
      }
    });
  });
});
