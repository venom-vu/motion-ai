import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { compileScript, compileTemplate, parse } from '@vue/compiler-sfc';
import { createSSRApp, h, nextTick, ref } from 'vue';
import { renderToString } from '@vue/server-renderer';
import {
  MOCK_BODY_RETOUCH_RESULT_RESPONSE,
  MOCK_BODY_RETOUCH_TASK_QUEUED,
  MOCK_BODY_RETOUCH_TASK_RUNNING,
  MOCK_BODY_RETOUCH_TASK_SUCCEEDED,
} from '@flowvis/contracts';
import {
  formatTaskTimestampVi,
  getPipelineLabelVi,
  getTaskStatusLabelVi,
} from '../utils/task-format.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(webRoot, rel), 'utf8');

/**
 * Biên dịch <script setup> của một SFC, thay thế các import alias bằng module stub,
 * rồi import trực tiếp để kiểm thử hành vi reactive và hàm xử lý.
 */
async function loadSetup(rel, stubs = {}, dir = null) {
  const { descriptor } = parse(read(rel));
  let code = compileScript(descriptor, { id: `test-${rel}` }).content;
  if (dir && Object.keys(stubs).length > 0) {
    for (const [spec, source] of Object.entries(stubs)) {
      const file = path.join(dir, `${spec.replace(/[^a-z0-9]/gi, '_')}.mjs`);
      fs.writeFileSync(file, source, 'utf8');
      const next = code
        .split(`'${spec}'`)
        .join(JSON.stringify(pathToFileURL(file).href));
      assert.notEqual(
        next,
        code,
        `import ${spec} trong ${rel} phải được thay thế bằng stub`,
      );
      code = next;
    }
  }
  const tmp = path.join(
    webRoot,
    'test',
    `.tmp-${path.basename(rel)}-${process.pid}-${Date.now()}.ts`,
  );
  fs.writeFileSync(tmp, code, 'utf8');
  try {
    return (await import(pathToFileURL(tmp).href)).default;
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}

describe('@flowvis/web — Story 4.5: [FE] So sánh trước/sau (BeforeAfterSplitSlider & tasks/[id].vue)', () => {
  describe('1. Component BeforeAfterSplitSlider — Script setup reactive & sự kiện bàn phím/pointer', () => {
    let sliderComp;

    before(async () => {
      sliderComp = await loadSetup('components/BeforeAfterSplitSlider.vue');
    });

    it('khởi tạo vị trí thanh trượt từ initialPosition (mặc định 50%, kẹp 0..100) và tính hasSource đúng', () => {
      const emitted = [];
      const emit = (event, payload) => emitted.push({ event, payload });

      // 1. Trường hợp có sourceUrl
      const props1 = {
        sourceUrl: 'https://cdn.example.test/in/source.png',
        resultUrl: 'https://cdn.example.test/out/result.png',
        initialPosition: 50,
        disabled: false,
      };
      const setup1 = sliderComp.setup(props1, { emit, expose() {} });
      assert.equal(setup1.sliderPosition.value, 50);
      assert.equal(setup1.hasSource.value, true);
      assert.equal(setup1.sourceLoadFailed.value, false);

      // 2. Trường hợp không có sourceUrl (null, rỗng hoặc chuỗi trắng)
      for (const emptySource of [null, undefined, '', '   ']) {
        const setupEmpty = sliderComp.setup(
          { sourceUrl: emptySource, resultUrl: 'https://cdn.example.test/out/result.png', initialPosition: 50 },
          { emit, expose() {} },
        );
        assert.equal(setupEmpty.hasSource.value, false);
      }

      // 3. Kẹp giá trị initialPosition ngoài khoảng 0..100
      const setupOver = sliderComp.setup(
        { sourceUrl: 'https://cdn.example.test/in/source.png', resultUrl: 'https://cdn.example.test/out/result.png', initialPosition: 140 },
        { emit, expose() {} },
      );
      assert.equal(setupOver.sliderPosition.value, 100);

      const setupUnder = sliderComp.setup(
        { sourceUrl: 'https://cdn.example.test/in/source.png', resultUrl: 'https://cdn.example.test/out/result.png', initialPosition: -25 },
        { emit, expose() {} },
      );
      assert.equal(setupUnder.sliderPosition.value, 0);
    });

    it('điều hướng thanh trượt bằng bàn phím (ArrowLeft/Down -5%, ArrowRight/Up +5%, Home 0%, End 100%) và chặn default', () => {
      const emitted = [];
      const emit = (event, payload) => emitted.push({ event, payload });
      const props = {
        sourceUrl: 'https://cdn.example.test/in/source.png',
        resultUrl: 'https://cdn.example.test/out/result.png',
        initialPosition: 50,
        disabled: false,
      };
      const setup = sliderComp.setup(props, { emit, expose() {} });

      const makeKeyEvent = (key) => {
        let prevented = false;
        return {
          key,
          preventDefault: () => {
            prevented = true;
          },
          get prevented() {
            return prevented;
          },
        };
      };

      // ArrowLeft: 50 -> 45
      const evLeft = makeKeyEvent('ArrowLeft');
      setup.handleKeydown(evLeft);
      assert.equal(setup.sliderPosition.value, 45);
      assert.equal(evLeft.prevented, true);
      assert.deepEqual(emitted[emitted.length - 1], { event: 'positionChange', payload: 45 });

      // ArrowDown: 45 -> 40
      const evDown = makeKeyEvent('ArrowDown');
      setup.handleKeydown(evDown);
      assert.equal(setup.sliderPosition.value, 40);
      assert.equal(evDown.prevented, true);

      // ArrowRight: 40 -> 45
      const evRight = makeKeyEvent('ArrowRight');
      setup.handleKeydown(evRight);
      assert.equal(setup.sliderPosition.value, 45);
      assert.equal(evRight.prevented, true);

      // ArrowUp: 45 -> 50
      const evUp = makeKeyEvent('ArrowUp');
      setup.handleKeydown(evUp);
      assert.equal(setup.sliderPosition.value, 50);
      assert.equal(evUp.prevented, true);

      // Home: 50 -> 0
      const evHome = makeKeyEvent('Home');
      setup.handleKeydown(evHome);
      assert.equal(setup.sliderPosition.value, 0);
      assert.equal(evHome.prevented, true);

      // ArrowLeft ở biên 0 không bị âm
      setup.handleKeydown(makeKeyEvent('ArrowLeft'));
      assert.equal(setup.sliderPosition.value, 0);

      // End: 0 -> 100
      const evEnd = makeKeyEvent('End');
      setup.handleKeydown(evEnd);
      assert.equal(setup.sliderPosition.value, 100);
      assert.equal(evEnd.prevented, true);

      // ArrowRight ở biên 100 không vượt quá 100
      setup.handleKeydown(makeKeyEvent('ArrowRight'));
      assert.equal(setup.sliderPosition.value, 100);

      // Phím không liên quan (Tab, Enter) không thay đổi vị trí và không preventDefault
      const evTab = makeKeyEvent('Tab');
      setup.handleKeydown(evTab);
      assert.equal(setup.sliderPosition.value, 100);
      assert.equal(evTab.prevented, false);
    });

    it('không cho phép thao tác phím khi disabled hoặc không có hasSource', () => {
      const emitted = [];
      const emit = (event, payload) => emitted.push({ event, payload });

      // 1. Khi disabled = true
      const propsDisabled = {
        sourceUrl: 'https://cdn.example.test/in/source.png',
        resultUrl: 'https://cdn.example.test/out/result.png',
        initialPosition: 50,
        disabled: true,
      };
      const setupDisabled = sliderComp.setup(propsDisabled, { emit, expose() {} });
      let prevented = false;
      setupDisabled.handleKeydown({ key: 'ArrowLeft', preventDefault: () => { prevented = true; } });
      assert.equal(setupDisabled.sliderPosition.value, 50);
      assert.equal(prevented, false);

      // 2. Khi hasSource = false (sourceUrl null)
      const propsNoSrc = {
        sourceUrl: null,
        resultUrl: 'https://cdn.example.test/out/result.png',
        initialPosition: 50,
        disabled: false,
      };
      const setupNoSrc = sliderComp.setup(propsNoSrc, { emit, expose() {} });
      prevented = false;
      setupNoSrc.handleKeydown({ key: 'ArrowLeft', preventDefault: () => { prevented = true; } });
      assert.equal(setupNoSrc.sliderPosition.value, 50);
      assert.equal(prevented, false);
    });

    it('xử lý lỗi tải ảnh onSourceError và onResultError: set sourceLoadFailed và emit imageError', () => {
      const emitted = [];
      const emit = (event, payload) => emitted.push({ event, payload });
      const props = {
        sourceUrl: 'https://cdn.example.test/in/source.png',
        resultUrl: 'https://cdn.example.test/out/result.png',
        initialPosition: 50,
        disabled: false,
      };
      const setup = sliderComp.setup(props, { emit, expose() {} });

      const mockEvent = { type: 'error' };

      // Lỗi ảnh gốc
      setup.onSourceError(mockEvent);
      assert.equal(setup.sourceLoadFailed.value, true);
      assert.equal(setup.hasSource.value, false);
      assert.deepEqual(emitted[0], {
        event: 'imageError',
        payload: { type: 'source', error: mockEvent },
      });

      // Lỗi ảnh kết quả
      setup.onResultError(mockEvent);
      assert.deepEqual(emitted[1], {
        event: 'imageError',
        payload: { type: 'result', error: mockEvent },
      });
    });

    it('watcher trên props.sourceUrl tự động reset sourceLoadFailed về false khi nhận URL mới', async () => {
      const emitted = [];
      const emit = (event, payload) => emitted.push({ event, payload });

      const reactiveProps = ref({
        sourceUrl: 'https://cdn.example.test/in/expired-source.png',
        resultUrl: 'https://cdn.example.test/out/result.png',
        initialPosition: 50,
        disabled: false,
      });

      // Tạo reactive proxy như Vue runtime
      const setup = sliderComp.setup(reactiveProps.value, { emit, expose() {} });

      // Ban đầu hasSource là true
      assert.equal(setup.hasSource.value, true);
      assert.equal(setup.sourceLoadFailed.value, false);

      // Ảnh gốc lỗi
      setup.onSourceError({ type: 'error' });
      assert.equal(setup.sourceLoadFailed.value, true);
      assert.equal(setup.hasSource.value, false);

      // Đổi sourceUrl sang link ký mới
      reactiveProps.value.sourceUrl = 'https://cdn.example.test/in/refreshed-source.png';
      await nextTick();

      // Watcher kích hoạt reset sourceLoadFailed
      assert.equal(setup.sourceLoadFailed.value, false);
      assert.equal(setup.hasSource.value, true);
    });

    it('xử lý thao tác kéo pointer (handlePointerDown, move, up): tính vị trí từ clientX và emit positionChange', () => {
      const emitted = [];
      const emit = (event, payload) => emitted.push({ event, payload });
      const props = {
        sourceUrl: 'https://cdn.example.test/in/source.png',
        resultUrl: 'https://cdn.example.test/out/result.png',
        initialPosition: 50,
        disabled: false,
      };
      const setup = sliderComp.setup(props, { emit, expose() {} });

      // Giả lập DOM container
      setup.containerRef.value = {
        getBoundingClientRect: () => ({
          left: 100,
          width: 500,
          right: 600,
          top: 50,
          bottom: 450,
          height: 400,
        }),
      };

      let pointerCaptured = null;
      let pointerReleased = null;
      const target = {
        setPointerCapture: (id) => { pointerCaptured = id; },
        releasePointerCapture: (id) => { pointerReleased = id; },
      };

      // Pointer down ở vị trí clientX = 350 (tương ứng 50% trong container left=100 width=500: (350-100)/500 = 50%)
      setup.handlePointerDown({
        button: 0,
        clientX: 350,
        pointerId: 42,
        currentTarget: target,
      });
      assert.equal(setup.isDragging.value, true);
      assert.equal(pointerCaptured, 42);
      assert.equal(setup.sliderPosition.value, 50);

      // Pointer move sang clientX = 225 (tương ứng (225-100)/500 = 25%)
      setup.handlePointerMove({
        clientX: 225,
        pointerType: 'mouse',
        buttons: 1,
      });
      assert.equal(setup.sliderPosition.value, 25);
      assert.deepEqual(emitted[emitted.length - 1], {
        event: 'positionChange',
        payload: 25,
      });

      // Pointer up kết thúc kéo
      setup.handlePointerUp({
        pointerId: 42,
        currentTarget: target,
      });
      assert.equal(setup.isDragging.value, false);
      assert.equal(pointerReleased, 42);
      // Vị trí vẫn giữ nguyên ở 25% sau khi thả tay
      assert.equal(setup.sliderPosition.value, 25);
    });
  });

  describe('2. Component BeforeAfterSplitSlider — SSR template render', () => {
    let ssrRender;

    before(async () => {
      const sfcCode = read('components/BeforeAfterSplitSlider.vue');
      const { descriptor } = parse(sfcCode, { filename: 'BeforeAfterSplitSlider.vue' });
      const compiled = compileTemplate({
        id: 'test-before-after-slider-ssr',
        filename: 'components/BeforeAfterSplitSlider.vue',
        source: descriptor.template.content,
        ssr: true,
        ssrCssVars: [],
      });
      assert.equal(compiled.errors.length, 0);

      const tmpFile = path.join(
        webRoot,
        'test',
        `.tmp-slider-ssr-${Date.now()}.mjs`,
      );
      fs.writeFileSync(tmpFile, compiled.code, 'utf8');
      try {
        const mod = await import(pathToFileURL(tmpFile).href);
        ssrRender = mod.ssrRender;
      } finally {
        fs.rmSync(tmpFile, { force: true });
      }
    });

    const createSliderApp = (opts = {}) => {
      const app = createSSRApp({
        ssrRender,
        setup() {
          const hasSource = Boolean(opts.sourceUrl);
          const sliderPos = opts.sliderPosition ?? 50;
          return {
            sourceUrl: opts.sourceUrl ?? null,
            resultUrl: opts.resultUrl ?? 'https://cdn.example.test/out/result.png',
            alt: opts.alt ?? 'Kết quả Chỉnh sửa vóc dáng',
            disabled: opts.disabled ?? false,
            sliderPosition: sliderPos,
            hasSource,
            handlePointerDown: () => {},
            handlePointerMove: () => {},
            handlePointerUp: () => {},
            handleKeydown: () => {},
            onSourceError: () => {},
            onResultError: () => {},
          };
        },
      });
      app.component('Icon', {
        props: ['name'],
        ssrRender(ctx, push) {
          push(`<span class="icon-${ctx.name?.replace(/[:/]/g, '-')}"></span>`);
        },
      });
      return app;
    };

    it('chế độ 2 ảnh (có sourceUrl): hiển thị đầy đủ before-layer, after-layer, núm kéo 36px, aria-valuetext, clipPath và chỉ dẫn trượt', async () => {
      const html = await renderToString(
        createSliderApp({
          sourceUrl: MOCK_BODY_RETOUCH_RESULT_RESPONSE.sourceUrl,
          resultUrl: MOCK_BODY_RETOUCH_RESULT_RESPONSE.resultUrl,
          sliderPosition: 50,
        }),
      );

      // Khung chứa và cấu hình touch-action
      assert.match(html, /data-testid="before-after-split-slider"/);
      assert.match(html, /data-testid="split-slider-canvas"/);
      assert.match(html, /touch-action:\s*pan-y/i);

      // Lớp Before (ảnh gốc)
      assert.match(html, /data-testid="before-layer"/);
      assert.match(html, /data-testid="source-image"/);
      assert.match(html, /object-contain/);
      assert.match(html, /data-testid="tag-before"/);
      assert.match(html, /Ảnh Gốc/);

      // Lớp After (kết quả AI) với clip-path đúng tỉ lệ
      assert.match(html, /data-testid="after-layer"/);
      assert.match(html, /data-testid="result-image"/);
      assert.match(html, /clip-path:\s*inset\(0\s+0\s+0\s+50%\)/i);
      assert.match(html, /data-testid="tag-after"/);
      assert.match(html, /Kết Quả AI/);

      // Đường phân cách và núm trượt 36px
      assert.match(html, /data-testid="slider-divider"/);
      assert.match(html, /data-testid="slider-knob"/);
      assert.match(html, /role="slider"/);
      assert.match(html, /aria-label="Thanh trượt so sánh trước sau"/);
      assert.match(html, /aria-valuemin="0"/);
      assert.match(html, /aria-valuemax="100"/);
      assert.match(html, /aria-valuenow="50"/);
      assert.match(html, /aria-valuetext="50% ảnh kết quả, 50% ảnh gốc"/);
      assert.match(html, /h-9 w-9/); // Núm 36px
      assert.match(html, /icon-lucide-arrow-left-right/);

      // Thanh gợi ý trượt ngang
      assert.match(html, /data-testid="slider-hint-bar"/);
      assert.match(html, /Trượt thanh ngang để so sánh Before\/After trực tiếp/);

      // Không hiển thị nhãn hết hạn
      assert.doesNotMatch(html, /data-testid="source-expired-note"/);
      assert.doesNotMatch(html, /data-testid="single-result-image"/);
    });

    it('chế độ 1 ảnh (sourceUrl null / quá 7 ngày): chỉ hiển thị ảnh kết quả và nhãn "Ảnh gốc đã hết hạn lưu", không hiển thị thanh kéo hỏng', async () => {
      const html = await renderToString(
        createSliderApp({
          sourceUrl: null,
          resultUrl: MOCK_BODY_RETOUCH_RESULT_RESPONSE.resultUrl,
        }),
      );

      // Chỉ hiển thị single-result-image
      assert.match(html, /data-testid="single-result-image"/);
      assert.match(html, /object-contain/);
      assert.match(html, /data-testid="single-result-tag"/);
      assert.match(html, /Kết Quả AI/);

      // Nhãn thông báo chuẩn xác không chứa số ngày thừa
      assert.match(html, /data-testid="source-expired-note"/);
      assert.match(html, /Ảnh gốc đã hết hạn lưu/);

      // Tuyệt đối không hiển thị thanh trượt hoặc lớp ảnh gốc
      assert.doesNotMatch(html, /data-testid="slider-knob"/);
      assert.doesNotMatch(html, /data-testid="slider-divider"/);
      assert.doesNotMatch(html, /data-testid="before-layer"/);
      assert.doesNotMatch(html, /data-testid="after-layer"/);
      assert.doesNotMatch(html, /data-testid="slider-hint-bar"/);
    });
  });

  describe('3. Trang pages/tasks/[id].vue — SSR template render cho pipeline body_retouch', () => {
    let ssrRender;

    before(async () => {
      const pageCode = read('pages/tasks/[id].vue');
      const { descriptor } = parse(pageCode, { filename: 'tasks-[id].vue' });
      const compiled = compileTemplate({
        id: 'test-tasks-id-page-ssr',
        filename: 'pages/tasks/[id].vue',
        source: descriptor.template.content,
        ssr: true,
        ssrCssVars: [],
      });
      assert.equal(compiled.errors.length, 0);

      const tmpFile = path.join(
        webRoot,
        'test',
        `.tmp-tasks-id-ssr-${Date.now()}.mjs`,
      );
      fs.writeFileSync(tmpFile, compiled.code, 'utf8');
      try {
        const mod = await import(pathToFileURL(tmpFile).href);
        ssrRender = mod.ssrRender;
      } finally {
        fs.rmSync(tmpFile, { force: true });
      }
    });

    const createTasksIdApp = ({
      task = MOCK_BODY_RETOUCH_TASK_SUCCEEDED,
      isExpiredVal = false,
      resultData = MOCK_BODY_RETOUCH_RESULT_RESPONSE,
      shareData = null,
      resultErrorVi = null,
      imageLoadFailed = false,
    } = {}) => {
      const app = createSSRApp({
        ssrRender,
        setup() {
          return {
            taskId: task.id,
            currentTask: task,
            isExpired: isExpiredVal,
            isUnauthenticated: false,
            taskAsync: { pending: { value: false }, data: { value: task } },
            resultAsync: {
              pending: { value: false },
              data: { value: resultData },
            },
            taskErrorVi: null,
            resultErrorVi,
            shareData,
            isSharing: false,
            isRevokingShare: false,
            shareToastMessage: null,
            shareErrorVi: null,
            downloadErrorVi: null,
            isDownloading: false,
            imageLoadFailed,
            getPipelineLabelVi,
            formatTaskTimestampVi,
            getTaskStatusLabelVi,
            getPipelineRoute: (p) =>
              p === 'body_retouch' ? '/body-retouch' : p === 'motion_control' ? '/motion-control' : '/face-swap',
            handleCreateNewTask: () => {},
            handleGoBack: () => {},
            handleRefreshResult: () => {},
            handleImageError: () => {},
            handleDownloadImage: () => {},
            handleShare: () => {},
            handleRevokeShare: () => {},
            handleCopyShareLink: () => {},
            openAuthDialog: () => {},
          };
        },
      });
      app.component('Icon', {
        props: ['name'],
        ssrRender(ctx, push) {
          push(`<span class="icon-${ctx.name?.replace(/[:/]/g, '-')}"></span>`);
        },
      });
      app.component('NuxtLink', {
        props: ['to'],
        setup(props, { slots, attrs }) {
          return () =>
            h(
              'a',
              {
                href: props.to || '#',
                'data-testid': attrs['data-testid'],
              },
              slots.default ? slots.default() : 'MockLink',
            );
        },
      });
      app.component('BeforeAfterSplitSlider', {
        props: ['resultUrl', 'sourceUrl', 'alt'],
        ssrRender(ctx, push) {
          push(
            `<div data-testid="mock-before-after-slider" data-res="${ctx.resultUrl}" data-src="${ctx.sourceUrl || ''}"></div>`,
          );
        },
      });
      app.component('TaskProgressCard', {
        props: ['task', 'polling', 'pipelineLabelVi'],
        ssrRender(ctx, push) {
          push(
            `<div data-testid="mock-task-progress-card" data-pipeline-label="${ctx.pipelineLabelVi || ''}" data-status="${ctx.task?.status}"></div>`,
          );
        },
      });
      return app;
    };

    it('truyền đúng pipeline-label-vi="Chỉnh sửa vóc dáng" vào TaskProgressCard khi task queued hoặc running', async () => {
      // 1. Queued
      const queuedHtml = await renderToString(
        createTasksIdApp({ task: MOCK_BODY_RETOUCH_TASK_QUEUED }),
      );
      assert.match(queuedHtml, /data-testid="task-in-progress-view"/);
      assert.match(queuedHtml, /data-pipeline-label="Chỉnh sửa vóc dáng"/);
      assert.match(queuedHtml, /data-status="queued"/);

      // 2. Running
      const runningHtml = await renderToString(
        createTasksIdApp({ task: MOCK_BODY_RETOUCH_TASK_RUNNING }),
      );
      assert.match(runningHtml, /data-testid="task-in-progress-view"/);
      assert.match(runningHtml, /data-pipeline-label="Chỉnh sửa vóc dáng"/);
      assert.match(runningHtml, /data-status="running"/);
    });

    it('khi body_retouch succeeded: hiển thị BeforeAfterSplitSlider, nút tải HD, nút chia sẻ và nút CTA dẫn tới /body-retouch', async () => {
      const html = await renderToString(
        createTasksIdApp({ task: MOCK_BODY_RETOUCH_TASK_SUCCEEDED }),
      );

      assert.match(html, /data-testid="result-success-view"/);
      assert.match(html, /data-testid="mock-before-after-slider"/);
      assert.match(html, /data-testid="download-result-button"/);
      assert.match(html, /Tải Ảnh HD \(Không Watermark\)/);
      assert.match(html, /data-testid="share-task-button"/);
      assert.match(html, /Chia sẻ kết quả/);

      // Nút điều hướng dẫn tới /body-retouch với nhãn "Tạo tác vụ Chỉnh sửa vóc dáng khác"
      assert.match(html, /href="\/body-retouch"/);
      assert.match(html, /Tạo tác vụ Chỉnh sửa vóc dáng khác/);
      assert.doesNotMatch(html, /href="\/face-swap"/);
    });

    it('khi face_swap succeeded: nút CTA dẫn tới /face-swap với nhãn Hoán đổi khuôn mặt', async () => {
      const taskFaceSwap = {
        ...MOCK_BODY_RETOUCH_TASK_SUCCEEDED,
        id: '12345678-1234-4000-8000-000000000001',
        pipeline: 'face_swap',
      };
      const html = await renderToString(
        createTasksIdApp({ task: taskFaceSwap }),
      );

      assert.match(html, /href="\/face-swap"/);
      assert.match(html, /Tạo tác vụ Hoán đổi khuôn mặt khác/);
      assert.doesNotMatch(html, /href="\/body-retouch"/);
    });

    it('khi body_retouch hết hạn 30 ngày (isExpired): hiển thị thông báo hết hạn và nút dẫn tới /body-retouch', async () => {
      const html = await renderToString(
        createTasksIdApp({
          task: MOCK_BODY_RETOUCH_TASK_SUCCEEDED,
          isExpiredVal: true,
          resultData: null,
        }),
      );

      assert.match(html, /data-testid="retention-expired-view"/);
      assert.match(html, /Kết Quả Đã Hết Hạn Lưu Trữ/);
      assert.match(html, /30 ngày/);
      assert.match(html, /href="\/body-retouch"/);
      assert.match(html, /Tạo tác vụ Chỉnh sửa vóc dáng mới/);
      assert.doesNotMatch(html, /data-testid="mock-before-after-slider"/);
    });

    it('khi ảnh lỗi hoặc link hết hạn: hiển thị banner lỗi và nút "Lấy lại link mới"', async () => {
      const html = await renderToString(
        createTasksIdApp({
          task: MOCK_BODY_RETOUCH_TASK_SUCCEEDED,
          imageLoadFailed: true,
        }),
      );

      assert.match(html, /data-testid="result-fetch-error"/);
      assert.match(html, /Không thể tải ảnh kết quả/);
      assert.match(html, /Lấy lại link mới/);
    });
  });

  describe('4. Trang pages/tasks/[id].vue — Logic script setup xử lý làm mới link ký & tải file', () => {
    let tasksIdSetup;
    let stubDir;

    before(async () => {
      stubDir = fs.mkdtempSync(path.join(webRoot, 'test', '.tmp-tasks-setup-'));
      const w = (name, content) => {
        const p = path.join(stubDir, name);
        fs.writeFileSync(p, content, 'utf8');
        return p;
      };

      w(
        'imports.mjs',
        `import { ref } from 'vue';
export const useRoute = () => ({ params: { id: globalThis.__tasksIdTest.taskId } });
export const useRouter = () => ({
  push: (...args) => globalThis.__tasksIdTest.routerPush(...args),
  back: () => globalThis.__tasksIdTest.routerBack(),
});
export const useHead = () => {};
export const useAsyncData = (key, fn) => {
  return globalThis.__tasksIdTest.asyncDataMap[key] || {
    data: ref(null),
    pending: ref(false),
    error: ref(null),
    refresh: async () => {},
  };
};`,
      );
      w('use-api-client.mjs', `export const useApiClient = () => ({ client: globalThis.__tasksIdTest.client });`);
      w('use-auth.mjs', `import { ref } from 'vue'; export const useAuth = () => ({ isAuthenticated: ref(true), sessionChecked: ref(true) });`);
      w('use-auth-dialog.mjs', `export const useAuthDialog = () => ({ open() {} });`);
      w('auth-session.mjs', `export const isUnauthorizedError = () => false;`);
      w('api-client.mjs', `export { resolveApiErrorMessageVi } from ${JSON.stringify(pathToFileURL(path.join(webRoot, 'utils/api-client.ts')).href)};`);
      w('task-format.mjs', `export {
  formatTaskTimestampVi,
  getPipelineLabelVi,
  getTaskStatusLabelVi,
  isTaskRetentionExpired,
} from ${JSON.stringify(pathToFileURL(path.join(webRoot, 'utils/task-format.ts')).href)};`);

      const stubs = {
        '#imports': fs.readFileSync(path.join(stubDir, 'imports.mjs'), 'utf8'),
        '~/composables/useApiClient': fs.readFileSync(path.join(stubDir, 'use-api-client.mjs'), 'utf8'),
        '~/composables/useAuth': fs.readFileSync(path.join(stubDir, 'use-auth.mjs'), 'utf8'),
        '~/composables/useAuthDialog': fs.readFileSync(path.join(stubDir, 'use-auth-dialog.mjs'), 'utf8'),
        '~/utils/auth-session': fs.readFileSync(path.join(stubDir, 'auth-session.mjs'), 'utf8'),
        '~/utils/api-client': fs.readFileSync(path.join(stubDir, 'api-client.mjs'), 'utf8'),
        '~/utils/task-format': fs.readFileSync(path.join(stubDir, 'task-format.mjs'), 'utf8'),
      };

      tasksIdSetup = await loadSetup('pages/tasks/[id].vue', stubs, stubDir);
    });

    after(() => {
      if (stubDir && fs.existsSync(stubDir)) {
        fs.rmSync(stubDir, { recursive: true, force: true });
      }
    });

    function initTasksIdSetup({
      task = MOCK_BODY_RETOUCH_TASK_SUCCEEDED,
      resultData = MOCK_BODY_RETOUCH_RESULT_RESPONSE,
      onRefresh = null,
    } = {}) {
      const taskAsync = {
        data: ref(task),
        pending: ref(false),
        error: ref(null),
        refresh: async () => {},
      };
      let refreshCount = 0;
      const resultAsync = {
        data: ref(resultData),
        pending: ref(false),
        error: ref(null),
        refresh: async () => {
          refreshCount += 1;
          if (onRefresh) await onRefresh(refreshCount);
        },
      };

      const pushedRoutes = [];
      globalThis.__tasksIdTest = {
        taskId: task.id,
        client: {
          shareTask: async () => ({
            token: 'share_br_abc123',
            shareUrl: 'https://flowvis.ai/share/share_br_abc123',
            expiresAt: '2026-11-16T12:00:00.000Z',
          }),
          revokeTaskShare: async () => ({ revoked: true }),
        },
        routerPush: (path) => pushedRoutes.push(path),
        routerBack: () => {},
        asyncDataMap: {
          [`flowvis-task-${task.id}`]: taskAsync,
          [`flowvis-task-result-${task.id}`]: resultAsync,
        },
      };

      const instance = tasksIdSetup.setup({}, { expose() {} });
      return {
        instance,
        taskAsync,
        resultAsync,
        getRefreshCount: () => refreshCount,
        pushedRoutes,
      };
    }

    it('cơ chế handleImageError của pages/tasks/[id].vue tự động retry tối đa 1 lần, bỏ qua lỗi concurrent khi pending, và chỉ set imageLoadFailed khi lỗi result', async () => {
      const { instance, resultAsync, getRefreshCount } = initTasksIdSetup();

      // 1. Lỗi ảnh gốc lần 1: Kích hoạt refresh link mới
      instance.handleImageError({ type: 'source', error: new Event('error') });
      assert.equal(instance.imageRefreshAttempts.value, 1);
      assert.equal(getRefreshCount(), 1);
      assert.equal(instance.imageLoadFailed.value, false);

      // 2. Lỗi concurrent khi resultAsync.pending.value === true: bị bỏ qua, không kích hoạt refresh hay set error
      resultAsync.pending.value = true;
      instance.handleImageError({ type: 'result', error: new Event('error') });
      assert.equal(instance.imageRefreshAttempts.value, 1);
      assert.equal(instance.imageLoadFailed.value, false);
      resultAsync.pending.value = false;

      // 3. Lỗi ảnh gốc lần 2 (khi attempts = 1): KHÔNG set imageLoadFailed vì chỉ source lỗi
      instance.handleImageError({ type: 'source', error: new Event('error') });
      assert.equal(instance.imageRefreshAttempts.value, 1);
      assert.equal(instance.imageLoadFailed.value, false);

      // 4. Lỗi ảnh kết quả (result) khi attempts = 1: Bật imageLoadFailed = true
      instance.handleImageError({ type: 'result', error: new Event('error') });
      assert.equal(instance.imageLoadFailed.value, true);

      // 5. Bấm "Lấy lại link mới": handleRefreshResult đặt lại attempts về 0 và xóa cờ lỗi
      await instance.handleRefreshResult();
      assert.equal(instance.imageRefreshAttempts.value, 0);
      assert.equal(instance.imageLoadFailed.value, false);
    });

    it('handleDownloadImage của pages/tasks/[id].vue đặt tên tệp đúng định dạng, bật loading/disabled state và tự động làm mới link khi gặp lỗi', async () => {
      const { instance, resultAsync } = initTasksIdSetup();

      const fetchCalls = [];
      const originalFetch = globalThis.fetch;
      const originalDocument = globalThis.document;
      const originalUrl = globalThis.URL;

      let downloadedFileName = null;

      try {
        globalThis.fetch = async (url) => {
          fetchCalls.push(url);
          if (url.includes('expired')) {
            throw new TypeError('Failed to fetch (CORS preflight or network error)');
          }
          return {
            ok: true,
            blob: async () => new Blob(['fake_image_data'], { type: 'image/jpeg' }),
          };
        };

        const createdLinks = [];
        globalThis.document = {
          createElement: (tag) => {
            const el = {
              tagName: tag,
              href: '',
              download: '',
              click: () => {
                downloadedFileName = el.download;
              },
            };
            return el;
          },
          body: {
            appendChild: (el) => createdLinks.push(el),
            removeChild: (el) => {
              const idx = createdLinks.indexOf(el);
              if (idx >= 0) createdLinks.splice(idx, 1);
            },
          },
        };

        globalThis.URL = {
          createObjectURL: () => 'blob:mock-url',
          revokeObjectURL: () => {},
        };

        // Ban đầu link hết hạn
        resultAsync.data.value = {
          resultUrl: 'https://cdn.example.test/out/expired-result.jpg',
          sourceUrl: 'https://cdn.example.test/in/source.jpg',
        };

        // Khi handleRefreshResult được gọi, nó làm mới data
        resultAsync.refresh = async () => {
          resultAsync.data.value = {
            resultUrl: 'https://cdn.example.test/out/refreshed-result.jpg',
            sourceUrl: 'https://cdn.example.test/in/source.jpg',
          };
        };

        await instance.handleDownloadImage();

        assert.equal(fetchCalls.length, 2);
        assert.equal(fetchCalls[0], 'https://cdn.example.test/out/expired-result.jpg');
        assert.equal(fetchCalls[1], 'https://cdn.example.test/out/refreshed-result.jpg');
        // File extension .jpg suy ra từ image/jpeg
        assert.equal(
          downloadedFileName,
          `flowvis-body_retouch-${MOCK_BODY_RETOUCH_TASK_SUCCEEDED.id.slice(0, 8)}.jpg`,
        );
        assert.equal(instance.isDownloading.value, false);
        assert.equal(instance.downloadErrorVi.value, null);
      } finally {
        globalThis.fetch = originalFetch;
        globalThis.document = originalDocument;
        globalThis.URL = originalUrl;
      }
    });

    it('handleCreateNewTask và getPipelineRoute điều hướng đúng trang tương ứng theo từng pipeline', () => {
      const { instance, pushedRoutes } = initTasksIdSetup({
        task: { ...MOCK_BODY_RETOUCH_TASK_SUCCEEDED, pipeline: 'body_retouch' },
      });

      instance.handleCreateNewTask();
      assert.deepEqual(pushedRoutes, ['/body-retouch']);

      assert.equal(instance.getPipelineRoute('body_retouch'), '/body-retouch');
      assert.equal(instance.getPipelineRoute('motion_control'), '/motion-control');
      assert.equal(instance.getPipelineRoute('face_swap'), '/face-swap');
    });

    it('handleShare tạo liên kết chia sẻ công khai không bao giờ lộ sourceUrl', async () => {
      const { instance } = initTasksIdSetup();
      await instance.handleShare();
      assert.ok(instance.shareData.value);
      assert.equal('sourceUrl' in instance.shareData.value, false);
      assert.match(instance.shareData.value.shareUrl, /\/share\/share_br_abc123$/);
    });
  });

  describe('5. Ranh giới thiết kế Slate Cyber, vùng chạm >= 48px và không emoji UTF-8', () => {
    it('BeforeAfterSplitSlider.vue và pages/tasks/[id].vue tuân thủ vùng chạm >= 48px, Slate Cyber và không emoji UTF-8', () => {
      const sliderRaw = read('components/BeforeAfterSplitSlider.vue');
      const taskResultRaw = read('pages/tasks/[id].vue');

      // 1. Slate Cyber styling tokens
      assert.match(sliderRaw, /bg-cyber-/);
      assert.match(sliderRaw, /border-cyber-/);
      assert.match(sliderRaw, /text-cyber-/);
      assert.match(taskResultRaw, /bg-cyber-/);
      assert.match(taskResultRaw, /border-cyber-/);
      assert.match(taskResultRaw, /text-cyber-/);

      // 2. Vùng chạm tối thiểu 48px (touch-target / min-h-[48px] / min-h-[50px])
      assert.match(sliderRaw, /touch-target/);
      assert.match(taskResultRaw, /touch-target/);
      assert.match(taskResultRaw, /min-h-\[48px\]/);
      assert.match(taskResultRaw, /min-h-\[50px\]/);

      // 3. Núm trượt giữ kích thước chuẩn 36px (h-9 w-9)
      assert.match(sliderRaw, /h-9 w-9/);
      assert.match(sliderRaw, /lucide:arrow-left-right/);

      // 4. Tuyệt đối không chứa emoji Unicode UTF-8 trong UI chrome
      const emojiRegex =
        /[\u{1F300}-\u{1F5FF}\u{1F600}-\u{1F64F}\u{1F680}-\u{1F6FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1F900}-\u{1F9FF}\u{1FA70}-\u{1FAFF}]/u;

      assert.equal(
        emojiRegex.test(sliderRaw),
        false,
        'components/BeforeAfterSplitSlider.vue không được chứa emoji UTF-8',
      );
      assert.equal(
        emojiRegex.test(taskResultRaw),
        false,
        'pages/tasks/[id].vue không được chứa emoji UTF-8',
      );
    });
  });
});
