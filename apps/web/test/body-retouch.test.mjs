import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { compileScript, compileTemplate, parse } from '@vue/compiler-sfc';
import { createSSRApp, nextTick, reactive, ref } from 'vue';
import { renderToString } from '@vue/server-renderer';
import {
  API_ERROR_MESSAGES_VI,
  ApiErrorCode,
  MOCK_BODY_RETOUCH_CREATE_REQUEST,
  MOCK_BODY_RETOUCH_TASKS_BY_STATUS,
  MOCK_BODY_RETOUCH_TASK_CANCELLED,
  MOCK_BODY_RETOUCH_TASK_FAILED,
  MOCK_BODY_RETOUCH_TASK_QUEUED,
  MOCK_BODY_RETOUCH_TASK_RUNNING,
  MOCK_BODY_RETOUCH_TASK_SUCCEEDED,
  MOCK_BODY_RETOUCH_TASK_TIMED_OUT,
  MOCK_ME_RESPONSE,
  MOCK_PRICING_CONFIG_RESPONSE,
} from '@flowvis/contracts';
import {
  BodyRetouchCreateRequestSchema,
  BodyRetouchCreateResponseSchema,
  INTENSITY_DEFAULT,
  INTENSITY_LABEL_ZONES,
  INTENSITY_MAX,
  INTENSITY_MIN,
  IntensitySchema,
  MotionApiClientError,
  createMotionApiClient,
  getIntensityLabelVi,
  getReasonCodeMessageVi,
  resolveApiErrorMessageVi,
} from '../utils/api-client.ts';
import { buildAiFeatureCatalog, formatNumberVi } from '../utils/catalog.ts';
import { PIPELINE_LABELS_VI, getPipelineLabelVi } from '../utils/task-format.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(webRoot, rel), 'utf8');

/**
 * Biên dịch <script setup> của một SFC, thay thế các import alias bằng module stub,
 * rồi import trực tiếp để kiểm thử hành vi reactive và hàm xử lý.
 */
async function loadSetup(rel, stubs, dir) {
  const { descriptor } = parse(read(rel));
  let code = compileScript(descriptor, { id: `test-${rel}` }).content;
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

describe('@flowvis/web — Story 4.4 Trang Body Retouch và thanh mức điều chỉnh', () => {
  describe('1. Hợp đồng API client (createBodyRetouchTask & intensity helpers)', () => {
    it('re-export đầy đủ hằng số, schema intensity và ánh xạ đúng nhãn 3 vùng tiếng Việt', () => {
      assert.equal(INTENSITY_MIN, 1);
      assert.equal(INTENSITY_MAX, 10);
      assert.equal(INTENSITY_DEFAULT, 5);
      assert.equal(INTENSITY_LABEL_ZONES.length, 3);
      assert.deepEqual(INTENSITY_LABEL_ZONES, [
        { min: 1, max: 3, label: 'Uốn nhẹ dáng' },
        { min: 4, max: 7, label: 'Tự nhiên' },
        { min: 8, max: 10, label: 'Đường cong tối đa' },
      ]);

      // Vùng 1..3: Uốn nhẹ dáng
      for (const n of [1, 2, 3]) {
        assert.equal(getIntensityLabelVi(n), 'Uốn nhẹ dáng');
        assert.equal(IntensitySchema.parse(n), n);
      }
      // Vùng 4..7: Tự nhiên
      for (const n of [4, 5, 6, 7]) {
        assert.equal(getIntensityLabelVi(n), 'Tự nhiên');
        assert.equal(IntensitySchema.parse(n), n);
      }
      // Vùng 8..10: Đường cong tối đa
      for (const n of [8, 9, 10]) {
        assert.equal(getIntensityLabelVi(n), 'Đường cong tối đa');
        assert.equal(IntensitySchema.parse(n), n);
      }

      // Mặc định 5 khi undefined
      assert.equal(IntensitySchema.parse(undefined), 5);

      // Ngoài khoảng 1..10 hoặc không nguyên bị chặn bởi IntensitySchema và trả null ở getIntensityLabelVi
      for (const invalid of [0, -1, 11, 1.5, 5.2, Number.NaN]) {
        assert.equal(getIntensityLabelVi(invalid), null);
        assert.equal(IntensitySchema.safeParse(invalid).success, false);
      }

      assert.ok(BodyRetouchCreateRequestSchema);
      assert.ok(BodyRetouchCreateResponseSchema);
      assert.equal(PIPELINE_LABELS_VI.body_retouch, 'Chỉnh sửa vóc dáng');
      assert.equal(getPipelineLabelVi('body_retouch'), 'Chỉnh sửa vóc dáng');
    });

    it('createBodyRetouchTask gửi POST /tasks/body-retouch đúng body { imageKey, intensity } và chặn dữ liệu sai ở client', async () => {
      const calls = [];
      const client = createMotionApiClient({
        baseUrl: 'http://localhost:3001',
        getAccessToken: () => 'jwt_body_retouch_test',
        fetchImpl: async (input, init) => {
          calls.push({
            url: String(input),
            method: init?.method,
            body: init?.body ? JSON.parse(String(init.body)) : null,
          });
          return Response.json(MOCK_BODY_RETOUCH_TASK_QUEUED, { status: 201 });
        },
      });

      const created = await client.createBodyRetouchTask(
        MOCK_BODY_RETOUCH_CREATE_REQUEST,
      );
      assert.equal(created.id, MOCK_BODY_RETOUCH_TASK_QUEUED.id);
      assert.equal(created.pipeline, 'body_retouch');
      assert.equal(created.status, 'queued');
      assert.equal(created.queuePosition, 2);
      assert.equal(calls.length, 1);
      assert.equal(calls[0].method, 'POST');
      assert.match(calls[0].url, /\/tasks\/body-retouch$/);
      assert.deepEqual(calls[0].body, {
        imageKey: MOCK_BODY_RETOUCH_CREATE_REQUEST.imageKey,
        intensity: 8,
      });
      assert.equal('consent' in calls[0].body, false);
      assert.equal('creditCost' in calls[0].body, false);

      // Chặn intensity ngoài 1..10 hoặc số thực trước khi gọi fetch
      for (const badIntensity of [0, 11, 4.5]) {
        await assert.rejects(() =>
          client.createBodyRetouchTask({
            imageKey: MOCK_BODY_RETOUCH_CREATE_REQUEST.imageKey,
            intensity: badIntensity,
          }),
        );
      }
      // Chặn trường lạ (consent / credit) do .strict()
      await assert.rejects(() =>
        client.createBodyRetouchTask({
          ...MOCK_BODY_RETOUCH_CREATE_REQUEST,
          consent: true,
        }),
      );
      // Không có thêm cuộc gọi fetch nào khi client schema chặn
      assert.equal(calls.length, 1);
    });
  });

  describe('2. TaskProgressCard.vue — 6 trạng thái MOCK_BODY_RETOUCH_TASKS_BY_STATUS & lỗi NO_POSE', () => {
    it('SSR render đầy đủ 6 trạng thái của MOCK_BODY_RETOUCH_TASKS_BY_STATUS, tiêu đề động theo pipelineLabelVi và thông báo NO_POSE hoàn 100% credit', async () => {
      const cardRaw = read('components/TaskProgressCard.vue');
      const { descriptor } = parse(cardRaw);
      const compiled = compileTemplate({
        id: 'test-body-retouch-progress-card',
        filename: 'TaskProgressCard.vue',
        source: descriptor.template.content,
        ssr: true,
        ssrCssVars: [],
      });
      assert.equal(compiled.errors.length, 0);

      const tmpCardFile = path.join(
        webRoot,
        'test',
        `.tmp-br-card-${Date.now()}.mjs`,
      );
      fs.writeFileSync(tmpCardFile, compiled.code, 'utf8');

      try {
        const { ssrRender } = await import(pathToFileURL(tmpCardFile).href);

        const renderCard = async (
          taskData,
          pipelineLabelVi = 'Chỉnh sửa vóc dáng',
        ) => {
          const app = createSSRApp({
            ssrRender,
            setup() {
              return {
                localTask: taskData,
                isQueued: taskData.status === 'queued',
                isRunning: taskData.status === 'running',
                isSucceeded: taskData.status === 'succeeded',
                isFailed:
                  taskData.status === 'failed' ||
                  taskData.status === 'timed_out' ||
                  taskData.status === 'cancelled',
                reasonMessageVi:
                  taskData.status === 'cancelled'
                    ? 'Tác vụ đã được hủy theo yêu cầu của bạn.'
                    : getReasonCodeMessageVi(
                        taskData.reasonCode,
                        taskData.pipeline,
                      ),
                actionErrorVi: null,
                isCancelling: false,
                pipelineLabelVi,
                handleCancel: () => {},
                handleRetry: () => {},
              };
            },
          });
          app.component('Icon', {
            props: ['name'],
            ssrRender(_ctx, push) {
              push('<span class="icon-mock"></span>');
            },
          });
          app.component('NuxtLink', {
            props: ['to'],
            ssrRender(ctx, push, _parent, attrs) {
              const testIdAttr = attrs?.['data-testid']
                ? ` data-testid="${attrs['data-testid']}"`
                : '';
              push(`<a href="${ctx.to || '#'}"${testIdAttr}>MockLink</a>`);
            },
          });
          return renderToString(app);
        };

        assert.equal(
          Object.keys(MOCK_BODY_RETOUCH_TASKS_BY_STATUS).length,
          6,
        );

        // 1. Queued: vị trí hàng đợi #2 và nhãn Chỉnh sửa vóc dáng
        const queuedHtml = await renderCard(MOCK_BODY_RETOUCH_TASK_QUEUED);
        assert.match(queuedHtml, /data-testid="task-queued-state"/);
        assert.match(queuedHtml, /Chỉnh sửa vóc dáng/);
        assert.match(queuedHtml, /Vị trí: #2/);
        assert.match(queuedHtml, /data-testid="cancel-task-button"/);

        // 2. Running: Đang xử lý Chỉnh sửa vóc dáng...
        const runningHtml = await renderCard(MOCK_BODY_RETOUCH_TASK_RUNNING);
        assert.match(runningHtml, /data-testid="task-running-state"/);
        assert.match(runningHtml, /Đang xử lý Chỉnh sửa vóc dáng\.\.\./);
        assert.doesNotMatch(runningHtml, /data-testid="cancel-task-button"/);

        // 3. Succeeded: hiển thị tiêu đề theo prop pipelineLabelVi ("Chỉnh sửa vóc dáng thành công!")
        const succeededHtml = await renderCard(
          MOCK_BODY_RETOUCH_TASK_SUCCEEDED,
        );
        assert.match(succeededHtml, /data-testid="task-succeeded-state"/);
        assert.match(succeededHtml, /Chỉnh sửa vóc dáng thành công!/);
        assert.doesNotMatch(succeededHtml, /Hoán đổi khuôn mặt thành công!/);
        assert.match(
          succeededHtml,
          /href="\/tasks\/71000000-0000-4000-8000-000000000003"/,
        );

        // 4. Failed với reasonCode = 'NO_POSE' ở pipeline body_retouch:
        // Hiện đúng câu "Không tìm thấy người trong ảnh. Vui lòng chọn ảnh có người rõ thân." và hoàn 100% credit
        const failedHtml = await renderCard(MOCK_BODY_RETOUCH_TASK_FAILED);
        assert.match(failedHtml, /data-testid="task-failed-state"/);
        assert.match(
          failedHtml,
          /Không tìm thấy người trong ảnh\. Vui lòng chọn ảnh có người rõ thân\./,
        );
        assert.match(failedHtml, /data-testid="credit-refund-note"/);
        assert.match(
          failedHtml,
          /Đã hoàn trả 100% credit \(100 CR\) vào số dư ví của bạn\./,
        );
        assert.match(failedHtml, /data-testid="retry-task-button"/);

        // 5. Timed out với FREE_WAIT_EXPIRED: gợi ý nâng hạng và hoàn 100% credit
        const timedOutHtml = await renderCard(MOCK_BODY_RETOUCH_TASK_TIMED_OUT);
        assert.match(timedOutHtml, /data-testid="task-failed-state"/);
        assert.match(timedOutHtml, /data-testid="free-wait-expired-hint"/);
        assert.match(timedOutHtml, /data-testid="credit-refund-note"/);

        // 6. Cancelled: thông báo đã hủy và hoàn 100% credit
        const cancelledHtml = await renderCard(
          MOCK_BODY_RETOUCH_TASK_CANCELLED,
        );
        assert.match(cancelledHtml, /data-testid="task-failed-state"/);
        assert.match(
          cancelledHtml,
          /Tác vụ đã được hủy theo yêu cầu của bạn\./,
        );
        assert.match(cancelledHtml, /data-testid="credit-refund-note"/);
      } finally {
        fs.rmSync(tmpCardFile, { force: true });
      }
    });
  });

  describe('3. Trang pages/body-retouch.vue — SSR render & Script logic theo I/O Matrix', () => {
    let dir;
    let pageComp;

    before(async () => {
      dir = fs.mkdtempSync(path.join(webRoot, 'test', '.tmp-br-page-'));
      globalThis.useHead = (headInput) => {
        globalThis.__brPage?.heads.push(headInput);
      };
      pageComp = await loadSetup(
        'pages/body-retouch.vue',
        {
          '~/composables/usePricingConfig': `export const usePricingConfig = () => globalThis.__brPage.pricingConfig;`,
          '~/composables/useApiClient': `export const useApiClient = () => ({ client: globalThis.__brPage.client });`,
          '~/composables/useAuthDialog': `export const useAuthDialog = () => ({ open: (...args) => globalThis.__brPage.calls.push(['openAuthDialog', ...args]) });`,
          '~/utils/api-client': `export {
            ApiErrorCode,
            INTENSITY_DEFAULT,
            INTENSITY_LABEL_ZONES,
            INTENSITY_MAX,
            INTENSITY_MIN,
            IntensitySchema,
            getIntensityLabelVi,
            resolveApiErrorMessageVi,
          } from '${pathToFileURL(path.join(webRoot, 'utils/api-client.ts')).href}';`,
        },
        dir,
      );
    });

    after(() => {
      fs.rmSync(dir, { recursive: true, force: true });
      delete globalThis.__brPage;
      delete globalThis.useHead;
    });

    function setupPage({
      meVal = MOCK_ME_RESPONSE,
      pricingVal = MOCK_PRICING_CONFIG_RESPONSE,
      createImpl,
    } = {}) {
      const meRef = ref(meVal);
      const pricingRef = ref(pricingVal);
      const calls = [];
      globalThis.__brPage = {
        heads: [],
        calls,
        pricingConfig: {
          pricing: pricingRef,
          me: meRef,
          refreshAll: async () => {
            calls.push(['refreshAll']);
          },
        },
        client: {
          createBodyRetouchTask: async (payload) => {
            calls.push(['createBodyRetouchTask', payload]);
            if (createImpl) {
              return createImpl(payload);
            }
            return MOCK_BODY_RETOUCH_TASK_QUEUED;
          },
        },
      };
      const state = pageComp.setup({}, { expose() {} });
      return { state, meRef, pricingRef, calls };
    }

    it('SSR render trang /body-retouch: 1 ImageUploader, thanh trượt intensity mặc định 5 ("Tự nhiên"), 3 mốc vùng, giá 100 CR, trạng thái khách và thiếu credit', async () => {
      const pageRaw = read('pages/body-retouch.vue');
      const { descriptor } = parse(pageRaw);
      const compiled = compileTemplate({
        id: 'test-page-body-retouch-ssr',
        filename: 'pages/body-retouch.vue',
        source: descriptor.template.content,
        ssr: true,
        ssrCssVars: [],
      });
      assert.equal(compiled.errors.length, 0);

      const tmpPageFile = path.join(
        webRoot,
        'test',
        `.tmp-page-br-ssr-${Date.now()}.mjs`,
      );
      fs.writeFileSync(tmpPageFile, compiled.code, 'utf8');

      try {
        const { ssrRender } = await import(pathToFileURL(tmpPageFile).href);

        const renderPage = async ({
          hasBalance = true,
          canSubmitVal = false,
          hasTask = false,
          isAuth = true,
          intensityVal = INTENSITY_DEFAULT,
          submitErrorVi = null,
        } = {}) => {
          const app = createSSRApp({
            ssrRender,
            setup() {
              return {
                INTENSITY_MIN,
                INTENSITY_MAX,
                INTENSITY_DEFAULT,
                INTENSITY_LABEL_ZONES,
                bodyRetouchCreditCost: 100,
                userBalance: hasBalance ? 500 : 40,
                hasEnoughBalance: hasBalance,
                isAuthenticated: isAuth,
                canSubmit: canSubmitVal,
                isSubmitting: false,
                submitErrorVi,
                imageKey: canSubmitVal
                  ? MOCK_BODY_RETOUCH_CREATE_REQUEST.imageKey
                  : null,
                intensity: intensityVal,
                intensityLabelVi:
                  getIntensityLabelVi(intensityVal) ?? 'Tự nhiên',
                activeTask: hasTask ? MOCK_BODY_RETOUCH_TASK_QUEUED : null,
                handleSubmit: () => {},
                handleReset: () => {},
                openAuthDialog: () => {},
              };
            },
          });
          app.component('Icon', {
            props: ['name'],
            ssrRender(_ctx, push) {
              push('<span class="icon-mock"></span>');
            },
          });
          app.component('NuxtLink', {
            props: ['to'],
            ssrRender(ctx, push, _parent, attrs) {
              const testIdAttr = attrs?.['data-testid']
                ? ` data-testid="${attrs['data-testid']}"`
                : '';
              push(`<a href="${ctx.to || '#'}"${testIdAttr}>MockLink</a>`);
            },
          });
          app.component('ImageUploader', {
            props: ['modelValue', 'idPrefix', 'labelVi'],
            ssrRender(ctx, push) {
              push(
                `<div data-testid="mock-uploader-${ctx.idPrefix || 'default'}"></div>`,
              );
            },
          });
          app.component('TaskProgressCard', {
            props: ['task', 'pipelineLabelVi'],
            ssrRender(ctx, push) {
              push(
                `<div data-testid="mock-task-progress-card" data-label="${ctx.pipelineLabelVi}"></div>`,
              );
            },
          });
          return renderToString(app);
        };

        // 1. Mặc định khi mới mở: 1 ImageUploader, intensity = 5 ("Tự nhiên"), 3 vùng nhãn, 100 CR, nút Tạo disabled
        const defaultHtml = await renderPage();
        assert.match(defaultHtml, /data-testid="page-body-retouch"/);
        assert.match(defaultHtml, /data-testid="body-image-section"/);
        assert.match(
          defaultHtml,
          /data-testid="mock-uploader-body-retouch-image"/,
        );
        assert.match(defaultHtml, /data-testid="intensity-slider"/);
        assert.match(defaultHtml, /Mức 5\/10/);
        assert.match(defaultHtml, /Tự nhiên/);
        assert.match(defaultHtml, /Uốn nhẹ dáng/);
        assert.match(defaultHtml, /Đường cong tối đa/);
        assert.match(defaultHtml, /1–3/);
        assert.match(defaultHtml, /4–7/);
        assert.match(defaultHtml, /8–10/);
        assert.match(defaultHtml, /Chi phí: 100 Credit/);
        assert.match(defaultHtml, /Tạo Body Retouch \(100 CR\)/);
        assert.match(
          defaultHtml,
          /<button[^>]*data-testid="create-body-retouch-button"[^>]*\sdisabled(=|"|\s|>)/,
        );

        // 2. Khách chưa đăng nhập: hiện banner nhắc đăng nhập kèm nút mở dialog
        const guestHtml = await renderPage({ isAuth: false });
        assert.match(guestHtml, /data-testid="guest-login-notice"/);
        assert.match(guestHtml, /data-testid="body-retouch-login-button"/);

        // 3. Số dư < 100 credit: hiện cảnh báo thiếu credit và nút dẫn tới /pricing
        const lowBalanceHtml = await renderPage({ hasBalance: false });
        assert.match(lowBalanceHtml, /data-testid="insufficient-credit-note"/);
        assert.match(lowBalanceHtml, /data-testid="topup-credit-button"/);
        assert.match(lowBalanceHtml, /href="\/pricing"/);

        // 4. Đủ điều kiện: nút Tạo được bật
        const readyHtml = await renderPage({ canSubmitVal: true });
        assert.doesNotMatch(
          readyHtml,
          /<button[^>]*data-testid="create-body-retouch-button"[^>]*\sdisabled(=|"|\s|>)/,
        );

        // 5. Khi đã có activeTask: hiển thị TaskProgressCard với pipeline-label-vi="Chỉnh sửa vóc dáng"
        const activeTaskHtml = await renderPage({ hasTask: true });
        assert.match(activeTaskHtml, /data-testid="mock-task-progress-card"/);
        assert.match(activeTaskHtml, /data-label="Chỉnh sửa vóc dáng"/);
      } finally {
        fs.rmSync(tmpPageFile, { force: true });
      }
    });

    it('I/O Matrix Row 1, 2, 3, 4: mặc định intensity=5, đổi nhãn theo 3 vùng, chặn giá trị ngoài 1..10 hoặc không nguyên, chặn khách & thiếu số dư', async () => {
      const { state, meRef } = setupPage();

      // Mặc định khi mới mở
      assert.equal(state.intensity.value, 5);
      assert.equal(state.intensityLabelVi.value, 'Tự nhiên');
      assert.equal(state.bodyRetouchCreditCost.value, 100);
      assert.equal(state.canSubmit.value, false);

      // Kéo thanh trượt qua 3 vùng
      state.intensity.value = 2;
      assert.equal(state.intensityLabelVi.value, 'Uốn nhẹ dáng');
      state.intensity.value = 6;
      assert.equal(state.intensityLabelVi.value, 'Tự nhiên');
      state.intensity.value = 9;
      assert.equal(state.intensityLabelVi.value, 'Đường cong tối đa');

      // Đã có ảnh + đăng nhập + balance 500 -> canSubmit = true
      state.imageKey.value = MOCK_BODY_RETOUCH_CREATE_REQUEST.imageKey;
      assert.equal(state.canSubmit.value, true);

      // Giá trị ngoài 1..10 hoặc không nguyên bị chặn bởi IntensitySchema ở client
      for (const bad of [0, 11, 4.5]) {
        state.intensity.value = bad;
        assert.equal(state.isValidIntensity.value, false);
        assert.equal(state.canSubmit.value, false);
        await state.handleSubmit();
        assert.equal(
          state.submitErrorVi.value,
          API_ERROR_MESSAGES_VI[ApiErrorCode.VALIDATION_FAILED],
        );
      }
      assert.equal(globalThis.__brPage.calls.length, 0);

      // Khôi phục intensity hợp lệ
      state.intensity.value = 7;
      state.submitErrorVi.value = null;
      assert.equal(state.canSubmit.value, true);

      // Khách chưa đăng nhập (me === null): khóa nút Tạo, không gọi API
      meRef.value = null;
      assert.equal(state.isAuthenticated.value, false);
      assert.equal(state.canSubmit.value, false);
      await state.handleSubmit();
      assert.equal(globalThis.__brPage.calls.length, 0);

      // Số dư < 100 (balance = 99): khóa nút Tạo, không gọi API
      meRef.value = { ...MOCK_ME_RESPONSE, balance: 99 };
      assert.equal(state.isAuthenticated.value, true);
      assert.equal(state.hasEnoughBalance.value, false);
      assert.equal(state.canSubmit.value, false);
      await state.handleSubmit();
      assert.equal(globalThis.__brPage.calls.length, 0);
    });

    it('I/O Matrix Row 5: chống bấm đúp (isSubmitting), chỉ gửi đúng 1 request POST /tasks/body-retouch với { imageKey, intensity: 8 } và làm mới ví', async () => {
      let resolveCreate;
      const { state, calls } = setupPage({
        createImpl: () =>
          new Promise((resolve) => {
            resolveCreate = resolve;
          }),
      });

      state.imageKey.value = MOCK_BODY_RETOUCH_CREATE_REQUEST.imageKey;
      state.intensity.value = 8;
      assert.equal(state.canSubmit.value, true);

      // Bấm đúp 2 lần liên tiếp khi request đầu chưa xong
      const p1 = state.handleSubmit();
      const p2 = state.handleSubmit();
      assert.equal(state.isSubmitting.value, true);
      assert.equal(state.canSubmit.value, false);

      resolveCreate(MOCK_BODY_RETOUCH_TASK_QUEUED);
      await Promise.all([p1, p2]);

      const createCalls = calls.filter((c) => c[0] === 'createBodyRetouchTask');
      assert.equal(createCalls.length, 1);
      assert.deepEqual(createCalls[0][1], {
        imageKey: MOCK_BODY_RETOUCH_CREATE_REQUEST.imageKey,
        intensity: 8,
      });
      assert.equal(state.activeTask.value?.id, MOCK_BODY_RETOUCH_TASK_QUEUED.id);
      assert.equal(state.isSubmitting.value, false);
      assert.equal(
        calls.some((c) => c[0] === 'refreshAll'),
        true,
      );

      // Bấm thử lại (handleReset) quay về form, giữ lại ảnh & intensity
      state.handleReset();
      assert.equal(state.activeTask.value, null);
      assert.equal(
        state.imageKey.value,
        MOCK_BODY_RETOUCH_CREATE_REQUEST.imageKey,
      );
      assert.equal(state.intensity.value, 8);
    });

    it('I/O Matrix Row 7: hiển thị đúng thông báo tiếng Việt cho 6 mã lỗi API, giữ lại ảnh + intensity và mở khóa isSubmitting', async () => {
      const errorCodes = [
        ApiErrorCode.INSUFFICIENT_CREDIT,
        ApiErrorCode.TASK_LIMIT,
        ApiErrorCode.ACCOUNT_LOCKED,
        ApiErrorCode.PAUSED,
        ApiErrorCode.CONSENT_REQUIRED,
        ApiErrorCode.VALIDATION_FAILED,
      ];

      for (const code of errorCodes) {
        const { state } = setupPage({
          createImpl: async () => {
            throw new MotionApiClientError({ status: 400, code });
          },
        });

        state.imageKey.value = MOCK_BODY_RETOUCH_CREATE_REQUEST.imageKey;
        state.intensity.value = 9;

        await state.handleSubmit();

        assert.equal(
          resolveApiErrorMessageVi(code),
          API_ERROR_MESSAGES_VI[code],
        );
        assert.equal(state.submitErrorVi.value, API_ERROR_MESSAGES_VI[code]);
        assert.equal(
          state.imageKey.value,
          MOCK_BODY_RETOUCH_CREATE_REQUEST.imageKey,
        );
        assert.equal(state.intensity.value, 9);
        assert.equal(state.isSubmitting.value, false);
        assert.equal(state.activeTask.value, null);
      }
    });

    it('watcher tự động xóa submitErrorVi khi người dùng thay đổi imageKey hoặc intensity', async () => {
      const { state } = setupPage();
      state.submitErrorVi.value = 'Lỗi thử nghiệm';
      state.intensity.value = 3;
      await nextTick();
      assert.equal(state.submitErrorVi.value, null);

      state.submitErrorVi.value = 'Lỗi thử nghiệm 2';
      state.imageKey.value = 'in/test/image.png';
      await nextTick();
      assert.equal(state.submitErrorVi.value, null);
    });
  });

  describe('4. FeatureWorkspaceDialog.vue (nhánh body-retouch) — SSR render & Script logic', () => {
    let dir;
    let dialogComp;
    const catalog = buildAiFeatureCatalog(MOCK_PRICING_CONFIG_RESPONSE, 'FREE');
    const bodyRetouchFeature = catalog.find((f) => f.id === 'body-retouch');
    const faceSwapFeature = catalog.find((f) => f.id === 'face-swap');

    before(async () => {
      dir = fs.mkdtempSync(path.join(webRoot, 'test', '.tmp-br-dialog-'));
      dialogComp = await loadSetup(
        'components/FeatureWorkspaceDialog.vue',
        {
          '~/components/ImageUploader.vue': `export default {};`,
          '~/components/TaskProgressCard.vue': `export default {};`,
          '~/composables/useApiClient': `export const useApiClient = () => ({ client: globalThis.__brDialog.client });`,
          '~/composables/useAuthDialog': `export const useAuthDialog = () => ({ open: (...args) => globalThis.__brDialog.calls.push(['openAuthDialog', ...args]) });`,
          '~/composables/usePricingConfig': `export const usePricingConfig = () => ({ refreshAll: async () => { globalThis.__brDialog.calls.push(['refreshAll']); } });`,
          '~/utils/api-client': `export {
            ApiErrorCode,
            INTENSITY_DEFAULT,
            INTENSITY_LABEL_ZONES,
            INTENSITY_MAX,
            INTENSITY_MIN,
            IntensitySchema,
            getIntensityLabelVi,
            resolveApiErrorMessageVi,
          } from '${pathToFileURL(path.join(webRoot, 'utils/api-client.ts')).href}';`,
          '~/utils/catalog': `export {
            calculateFeatureEstimatedCredits,
            formatNumberVi,
          } from '${pathToFileURL(path.join(webRoot, 'utils/catalog.ts')).href}';`,
        },
        dir,
      );
    });

    after(() => {
      fs.rmSync(dir, { recursive: true, force: true });
      delete globalThis.__brDialog;
    });

    it('SSR render FeatureWorkspaceDialog khi feature.id === "body-retouch": hiện thanh trượt intensity, 3 mốc vùng, giá 100 CR và nút Mở trang riêng (/body-retouch)', async () => {
      const dialogRaw = read('components/FeatureWorkspaceDialog.vue');
      const { descriptor } = parse(dialogRaw);
      const compiled = compileTemplate({
        id: 'test-fwd-body-retouch-ssr',
        filename: 'FeatureWorkspaceDialog.vue',
        source: descriptor.template.content,
        ssr: true,
        ssrCssVars: [],
      });
      assert.equal(compiled.errors.length, 0);

      const tmpFwdFile = path.join(
        webRoot,
        'test',
        `.tmp-fwd-br-${Date.now()}.mjs`,
      );
      fs.writeFileSync(tmpFwdFile, compiled.code, 'utf8');

      try {
        const { ssrRender } = await import(pathToFileURL(tmpFwdFile).href);

        const app = createSSRApp({
          ssrRender,
          setup() {
            return {
              open: true,
              feature: bodyRetouchFeature,
              userTier: 'FREE',
              userBalance: 500,
              isAuthenticated: true,
              hasEnoughBalance: true,
              canSubmit: false,
              uploadedKey: null,
              sourceKey: null,
              targetKey: null,
              intensity: INTENSITY_DEFAULT,
              intensityLabelVi: getIntensityLabelVi(INTENSITY_DEFAULT),
              INTENSITY_MIN,
              INTENSITY_MAX,
              INTENSITY_DEFAULT,
              INTENSITY_LABEL_ZONES,
              activeTask: null,
              isSubmitting: false,
              submitErrorVi: null,
              compareSplitPercent: 50,
              selectedSeconds: 1,
              maxSeconds: 1,
              estimatedCredits: 100,
              formatNumberVi,
              emit: () => {},
              handleSubmit: () => {},
              openAuthDialog: () => {},
            };
          },
        });
        app.component('Icon', {
          props: ['name'],
          ssrRender(_ctx, push) {
            push('<span class="icon-mock"></span>');
          },
        });
        app.component('NuxtLink', {
          props: ['to'],
          ssrRender(ctx, push, _parent, attrs) {
            const testIdAttr = attrs?.['data-testid']
              ? ` data-testid="${attrs['data-testid']}"`
              : '';
            push(`<a href="${ctx.to || '#'}"${testIdAttr}>MockLink</a>`);
          },
        });
        app.component('ImageUploader', {
          props: ['modelValue', 'idPrefix', 'labelVi'],
          ssrRender(ctx, push) {
            push(
              `<div data-testid="mock-uploader-${ctx.idPrefix || 'default'}"></div>`,
            );
          },
        });
        app.component('TaskProgressCard', {
          props: ['task', 'pipelineLabelVi'],
          ssrRender(ctx, push) {
            push(
              `<div data-testid="mock-task-progress-card" data-label="${ctx.pipelineLabelVi}"></div>`,
            );
          },
        });

        const html = await renderToString(app);
        assert.match(html, /href="\/body-retouch"/);
        assert.match(html, /data-testid="workspace-intensity-section"/);
        assert.match(html, /data-testid="workspace-intensity-slider"/);
        assert.match(html, /Mức 5\/10/);
        assert.match(html, /Tự nhiên/);
        assert.match(html, /Uốn nhẹ dáng/);
        assert.match(html, /Đường cong tối đa/);
        assert.match(html, /100 credit/);
        assert.match(
          html,
          /<button[^>]*data-testid="submit-task-button"[^>]*\sdisabled(=|"|\s|>)/,
        );

        // SSR render khi activeTask có giá trị: TaskProgressCard nhận pipeline-label-vi="Chỉnh sửa vóc dáng"
        const appActive = createSSRApp({
          ssrRender,
          setup() {
            return {
              open: true,
              feature: bodyRetouchFeature,
              userTier: 'FREE',
              userBalance: 500,
              isAuthenticated: true,
              hasEnoughBalance: true,
              canSubmit: false,
              uploadedKey: null,
              sourceKey: null,
              targetKey: null,
              intensity: INTENSITY_DEFAULT,
              intensityLabelVi: getIntensityLabelVi(INTENSITY_DEFAULT),
              INTENSITY_MIN,
              INTENSITY_MAX,
              INTENSITY_DEFAULT,
              INTENSITY_LABEL_ZONES,
              activeTask: MOCK_BODY_RETOUCH_TASK_QUEUED,
              isSubmitting: false,
              submitErrorVi: null,
              compareSplitPercent: 50,
              selectedSeconds: 1,
              maxSeconds: 1,
              estimatedCredits: 100,
              formatNumberVi,
              emit: () => {},
              handleSubmit: () => {},
              openAuthDialog: () => {},
            };
          },
        });
        appActive.component('Icon', {
          props: ['name'],
          ssrRender(_ctx, push) {
            push('<span class="icon-mock"></span>');
          },
        });
        appActive.component('NuxtLink', {
          props: ['to'],
          ssrRender(ctx, push, _parent, attrs) {
            const testIdAttr = attrs?.['data-testid']
              ? ` data-testid="${attrs['data-testid']}"`
              : '';
            push(`<a href="${ctx.to || '#'}"${testIdAttr}>MockLink</a>`);
          },
        });
        appActive.component('ImageUploader', {
          props: ['modelValue', 'idPrefix', 'labelVi'],
          ssrRender(ctx, push) {
            push(
              `<div data-testid="mock-uploader-${ctx.idPrefix || 'default'}"></div>`,
            );
          },
        });
        appActive.component('TaskProgressCard', {
          props: ['task', 'pipelineLabelVi'],
          ssrRender(ctx, push) {
            push(
              `<div data-testid="mock-task-progress-card" data-label="${ctx.pipelineLabelVi}"></div>`,
            );
          },
        });

        const activeHtml = await renderToString(appActive);
        assert.match(activeHtml, /data-testid="mock-task-progress-card"/);
        assert.match(activeHtml, /data-label="Chỉnh sửa vóc dáng"/);
      } finally {
        fs.rmSync(tmpFwdFile, { force: true });
      }
    });

    it('Script logic của FeatureWorkspaceDialog cho body-retouch: reset intensity về 5 khi đổi feature/đóng mở lại, chống bấm trùng, gọi createBodyRetouchTask và xử lý lỗi API', async () => {
      let resolveTask;
      const calls = [];
      const emitted = [];
      globalThis.__brDialog = {
        calls,
        client: {
          createBodyRetouchTask: async (payload) => {
            calls.push(['createBodyRetouchTask', payload]);
            return new Promise((resolve) => {
              resolveTask = resolve;
            });
          },
        },
      };

      const props = reactive({
        open: true,
        feature: bodyRetouchFeature,
        userTier: 'FREE',
        userBalance: 500,
      });

      const s = dialogComp.setup(props, {
        emit: (event, payload) => emitted.push([event, payload]),
        expose() {},
      });

      // Mặc định intensity = 5 ("Tự nhiên")
      assert.equal(s.intensity.value, 5);
      assert.equal(s.intensityLabelVi.value, 'Tự nhiên');
      assert.equal(s.estimatedCredits.value, 100);
      assert.equal(s.canSubmit.value, false);

      // Chọn mức 10 -> "Đường cong tối đa"
      s.intensity.value = 10;
      assert.equal(s.intensityLabelVi.value, 'Đường cong tối đa');

      // Đổi feature sang face-swap rồi quay lại body-retouch -> reset intensity về 5
      props.feature = faceSwapFeature;
      await nextTick();
      assert.equal(s.intensity.value, 5);
      props.feature = bodyRetouchFeature;
      await nextTick();
      assert.equal(s.intensity.value, 5);

      // Đóng rồi mở lại dialog -> reset intensity về 5
      s.intensity.value = 2;
      assert.equal(s.intensityLabelVi.value, 'Uốn nhẹ dáng');
      props.open = false;
      await nextTick();
      assert.equal(s.intensity.value, 5);
      props.open = true;
      await nextTick();

      // Tải ảnh xong và chọn intensity = 8, bấm đúp 2 lần
      s.uploadedKey.value = MOCK_BODY_RETOUCH_CREATE_REQUEST.imageKey;
      s.intensity.value = 8;
      assert.equal(s.canSubmit.value, true);

      const p1 = s.handleSubmit();
      const p2 = s.handleSubmit();
      assert.equal(s.isSubmitting.value, true);

      resolveTask(MOCK_BODY_RETOUCH_TASK_QUEUED);
      await Promise.all([p1, p2]);

      const apiCalls = calls.filter((c) => c[0] === 'createBodyRetouchTask');
      assert.equal(apiCalls.length, 1);
      assert.deepEqual(apiCalls[0][1], {
        imageKey: MOCK_BODY_RETOUCH_CREATE_REQUEST.imageKey,
        intensity: 8,
      });
      assert.equal(s.activeTask.value?.id, MOCK_BODY_RETOUCH_TASK_QUEUED.id);
      assert.equal(emitted.length, 1);
      assert.equal(emitted[0][0], 'submit');
      assert.equal(emitted[0][1].featureId, 'body-retouch');
      assert.equal(emitted[0][1].intensity, 8);

      // Chặn mức intensity không hợp lệ (ví dụ số thực hoặc ngoài 1..10)
      s.activeTask.value = null;
      s.intensity.value = 15;
      await s.handleSubmit();
      assert.equal(
        s.submitErrorVi.value,
        API_ERROR_MESSAGES_VI[ApiErrorCode.VALIDATION_FAILED],
      );
      assert.equal(s.activeTask.value, null);

      // Thay đổi intensity tự động xóa lỗi cũ
      s.intensity.value = 5;
      await nextTick();
      assert.equal(s.submitErrorVi.value, null);

      // Xử lý lỗi API khi gọi createBodyRetouchTask (ví dụ INSUFFICIENT_CREDIT)
      globalThis.__brDialog.client.createBodyRetouchTask = async () => {
        throw new MotionApiClientError({
          status: 400,
          code: ApiErrorCode.INSUFFICIENT_CREDIT,
        });
      };
      emitted.length = 0;
      await s.handleSubmit();
      assert.equal(
        s.submitErrorVi.value,
        API_ERROR_MESSAGES_VI[ApiErrorCode.INSUFFICIENT_CREDIT],
      );
      assert.equal(s.activeTask.value, null);
      assert.equal(s.isSubmitting.value, false);
      assert.equal(emitted.length, 0);

      // Thay đổi uploadedKey cũng xóa thông báo lỗi
      s.uploadedKey.value = 'in/other/new.jpg';
      await nextTick();
      assert.equal(s.submitErrorVi.value, null);
    });
  });

  describe('5. Ranh giới thiết kế Slate Cyber, vùng chạm >= 48px, không mockMode và 0 emoji UTF-8', () => {
    it('pages/body-retouch.vue, FeatureWorkspaceDialog.vue và TaskProgressCard.vue tuân thủ vùng chạm 48px, không có nhánh mockMode và không có emoji UTF-8', () => {
      const filesToCheck = [
        'pages/body-retouch.vue',
        'components/FeatureWorkspaceDialog.vue',
        'components/TaskProgressCard.vue',
        'utils/api-client.ts',
      ];
      const emojiRegex = /\p{Extended_Pictographic}/u;

      for (const rel of filesToCheck) {
        const raw = read(rel);
        assert.equal(
          emojiRegex.test(raw),
          false,
          `${rel} tuyệt đối không được chứa emoji UTF-8`,
        );
        assert.equal(
          /\bmockMode\b|\?mock=/i.test(raw),
          false,
          `${rel} không được chứa nhánh mockMode trong mã chạy thật`,
        );
      }

      const bodyRetouchRaw = read('pages/body-retouch.vue');
      assert.match(bodyRetouchRaw, /min-h-\[48px\]/);
      assert.match(bodyRetouchRaw, /touch-target/);
      assert.match(bodyRetouchRaw, /grid-cols-1/);
      assert.match(bodyRetouchRaw, /cyber-surface/);
      assert.match(bodyRetouchRaw, /cyber-cyan/);
      assert.match(bodyRetouchRaw, /cyber-violet/);
      assert.match(bodyRetouchRaw, /Icon name="lucide:/);
      assert.match(bodyRetouchRaw, /:aria-valuetext="intensityLabelVi"/);

      const fwdRaw = read('components/FeatureWorkspaceDialog.vue');
      assert.match(fwdRaw, /:aria-valuetext="intensityLabelVi"/);
    });
  });
});
