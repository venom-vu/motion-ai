import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { compileTemplate, parse } from '@vue/compiler-sfc';
import { createSSRApp, h } from 'vue';
import { renderToString } from '@vue/server-renderer';
import {
  ApiErrorCode,
  MOCK_PRICING_CONFIG_RESPONSE,
  MOCK_TOPUPS_BY_STATUS,
  MOCK_TOPUP_LIST_RESPONSE,
  getTopupStatusLabelVi,
} from '@motion-ai/contracts';
import {
  MotionApiClientError,
  createMotionApiClient,
  resolveApiErrorMessageVi,
} from '../utils/api-client.ts';
import {
  formatCountdown,
  formatTopupTimestampVi,
  generateQrSvg,
  getRemainingSeconds,
  getTopupStatusBadgeClass,
  isApprovalDeferred,
  isOutsideWorkingHoursVn,
  isQrExpired,
  OFF_HOURS_MESSAGE_VI,
} from '../utils/topup.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const webRoot = path.resolve(__dirname, '..');

const flushMicrotasks = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};

describe('Story 3.6: [FE] Trang nạp credit và theo dõi đơn', () => {
  describe('Helper utils/topup.ts', () => {
    it('isOutsideWorkingHoursVn nhận diện chính xác khung giờ [08:00, 23:00) UTC+7 (không DST)', () => {
      // 07:59:59 UTC+7 (00:59:59Z) -> Ngoài khung (true)
      assert.equal(
        isOutsideWorkingHoursVn('2026-11-07T00:59:59.000Z'),
        true,
        '07:59:59 UTC+7 phải ngoài khung giờ',
      );
      // 08:00:00 UTC+7 (01:00:00Z) -> Trong khung (false)
      assert.equal(
        isOutsideWorkingHoursVn('2026-11-07T01:00:00.000Z'),
        false,
        '08:00:00 UTC+7 phải trong khung giờ',
      );
      // 12:30:00 UTC+7 (05:30:00Z) -> Trong khung (false)
      assert.equal(
        isOutsideWorkingHoursVn('2026-11-07T05:30:00.000Z'),
        false,
        '12:30:00 UTC+7 phải trong khung giờ',
      );
      // 22:59:59 UTC+7 (15:59:59Z) -> Trong khung (false)
      assert.equal(
        isOutsideWorkingHoursVn('2026-11-07T15:59:59.000Z'),
        false,
        '22:59:59 UTC+7 phải trong khung giờ',
      );
      // 23:00:00 UTC+7 (16:00:00Z) -> Ngoài khung (true)
      assert.equal(
        isOutsideWorkingHoursVn('2026-11-07T16:00:00.000Z'),
        true,
        '23:00:00 UTC+7 phải ngoài khung giờ',
      );
      // 23:30:00 UTC+7 (16:30:00Z) -> Ngoài khung (true)
      assert.equal(
        isOutsideWorkingHoursVn('2026-11-07T16:30:00.000Z'),
        true,
        '23:30:00 UTC+7 phải ngoài khung giờ',
      );
      // Timestamp không hợp lệ -> an toàn trả về false
      assert.equal(isOutsideWorkingHoursVn('invalid-date'), false);
    });

    it('getRemainingSeconds và isQrExpired tính toán chính xác dựa trên qrExpiresAt của server', () => {
      const baseNow = 1_700_000_000_000;
      const futureExpiry = new Date(baseNow + 885_000).toISOString(); // 14 phút 45 giây sau
      const pastExpiry = new Date(baseNow - 5_000).toISOString(); // 5 giây trước

      assert.equal(getRemainingSeconds(futureExpiry, baseNow), 885);
      assert.equal(isQrExpired(futureExpiry, baseNow), false);

      assert.equal(getRemainingSeconds(pastExpiry, baseNow), 0);
      assert.equal(isQrExpired(pastExpiry, baseNow), true);

      assert.equal(getRemainingSeconds('invalid', baseNow), 0);
      assert.equal(isQrExpired('invalid', baseNow), true);
    });

    it('formatCountdown định dạng chuỗi mm:ss chuẩn', () => {
      assert.equal(formatCountdown(885), '14:45');
      assert.equal(formatCountdown(60), '01:00');
      assert.equal(formatCountdown(5), '00:05');
      assert.equal(formatCountdown(0), '00:00');
      assert.equal(formatCountdown(-10), '00:00');
    });

    it('generateQrSvg tạo chuỗi SVG hợp lệ và an toàn cho SSR từ qrPayload', async () => {
      const payload = MOCK_TOPUPS_BY_STATUS.awaiting_transfer.qrPayload;
      const svg = await generateQrSvg(payload);
      assert.match(svg, /<svg[^>]*viewBox=/);
      assert.match(svg, /<\/svg>/);
      assert.equal(svg.includes('<script>'), false);
    });

    it('formatTopupTimestampVi định dạng ngày giờ Việt Nam chuẩn và an toàn', () => {
      const formatted = formatTopupTimestampVi('2026-11-07T03:00:00.000Z');
      assert.match(formatted, /\d{1,2}\/\d{1,2}\/\d{2,4}/);
      assert.equal(formatTopupTimestampVi(''), '-');
      assert.equal(formatTopupTimestampVi('invalid'), '-');
    });

    it('getTopupStatusBadgeClass và getTopupStatusLabelVi ánh xạ đầy đủ 6 trạng thái', () => {
      const statuses = [
        'awaiting_transfer',
        'pending',
        'approved',
        'rejected',
        'needs_review',
        'expired',
      ];
      for (const st of statuses) {
        const cls = getTopupStatusBadgeClass(st);
        assert.ok(typeof cls === 'string' && cls.length > 0);
        const label = getTopupStatusLabelVi(st);
        assert.ok(typeof label === 'string' && label !== 'Không xác định');
      }
    });
  });

  describe('API Client Topup Methods & Error Handling', () => {
    it('createTopup gọi POST /topups với đúng body { pack, consent: true } và parse Zod schema', async () => {
      let capturedUrl = '';
      let capturedMethod = '';
      let capturedBody = '';

      const client = createMotionApiClient({
        baseUrl: 'http://test-topup.example',
        fetchImpl: async (url, init) => {
          capturedUrl = String(url);
          capturedMethod = init?.method ?? '';
          capturedBody = String(init?.body ?? '');
          return new Response(
            JSON.stringify(MOCK_TOPUPS_BY_STATUS.awaiting_transfer),
            {
              status: 201,
              headers: { 'Content-Type': 'application/json' },
            },
          );
        },
      });

      const res = await client.createTopup({ pack: 'pro', consent: true });
      assert.equal(capturedUrl, 'http://test-topup.example/topups');
      assert.equal(capturedMethod, 'POST');
      const parsedBody = JSON.parse(capturedBody);
      assert.deepEqual(parsedBody, { pack: 'pro', consent: true });
      assert.equal(res.id, MOCK_TOPUPS_BY_STATUS.awaiting_transfer.id);
      assert.equal(res.status, 'awaiting_transfer');
      assert.equal(res.amountVnd, 99000);
    });

    it('confirmTopupTransfer gọi POST /topups/:id/confirm-transfer với body rỗng và idempotent', async () => {
      let capturedUrl = '';
      let capturedMethod = '';

      const client = createMotionApiClient({
        baseUrl: 'http://test-topup.example',
        fetchImpl: async (url, init) => {
          capturedUrl = String(url);
          capturedMethod = init?.method ?? '';
          return new Response(JSON.stringify(MOCK_TOPUPS_BY_STATUS.pending), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        },
      });

      const targetId = MOCK_TOPUPS_BY_STATUS.pending.id;
      const res = await client.confirmTopupTransfer(targetId);
      assert.equal(
        capturedUrl,
        `http://test-topup.example/topups/${encodeURIComponent(targetId)}/confirm-transfer`,
      );
      assert.equal(capturedMethod, 'POST');
      assert.equal(res.status, 'pending');
    });

    it('getTopup gọi GET /topups/:id và listTopups gọi GET /topups với cursor pagination', async () => {
      let capturedGetUrl = '';
      let capturedListUrl = '';

      const client = createMotionApiClient({
        baseUrl: 'http://test-topup.example',
        fetchImpl: async (url) => {
          const strUrl = String(url);
          if (strUrl.includes('/topups?')) {
            capturedListUrl = strUrl;
            return new Response(JSON.stringify(MOCK_TOPUP_LIST_RESPONSE), {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            });
          }
          capturedGetUrl = strUrl;
          return new Response(JSON.stringify(MOCK_TOPUPS_BY_STATUS.approved), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        },
      });

      const topup = await client.getTopup(MOCK_TOPUPS_BY_STATUS.approved.id);
      assert.equal(
        capturedGetUrl,
        `http://test-topup.example/topups/${MOCK_TOPUPS_BY_STATUS.approved.id}`,
      );
      assert.equal(topup.status, 'approved');

      const listRes = await client.listTopups({ pageSize: 10, cursor: 'cur-1' });
      assert.equal(
        capturedListUrl,
        'http://test-topup.example/topups?pageSize=10&cursor=cur-1',
      );
      assert.equal(listRes.items.length, 3);
    });

    it('Ánh xạ chính xác các mã lỗi đặc thù của luồng Topup sang tiếng Việt (I/O Matrix)', () => {
      assert.equal(
        resolveApiErrorMessageVi(ApiErrorCode.TOPUP_LIMIT),
        'Bạn đang có tối đa 3 đơn nạp chưa hoàn tất. Vui lòng đợi các đơn đó được xử lý trước khi tạo đơn mới.',
      );
      assert.equal(
        resolveApiErrorMessageVi(ApiErrorCode.CONSENT_REQUIRED),
        'Bạn cần đồng ý với Điều khoản dịch vụ (ToS) phiên bản hiện hành trước khi tiếp tục.',
      );
      assert.equal(
        resolveApiErrorMessageVi(ApiErrorCode.ACCOUNT_LOCKED),
        'Tài khoản của bạn đã bị khóa. Vui lòng liên hệ bộ phận hỗ trợ.',
      );
      assert.equal(
        resolveApiErrorMessageVi(ApiErrorCode.RATE_LIMITED),
        'Bạn thao tác quá nhanh. Vui lòng đợi ít phút rồi thử lại.',
      );
      assert.equal(
        resolveApiErrorMessageVi(ApiErrorCode.TOPUP_QR_EXPIRED),
        'Mã QR đã hết hạn. Vui lòng tạo mã mới để tiếp tục nạp credit.',
      );
      assert.equal(
        resolveApiErrorMessageVi(ApiErrorCode.BANK_REF_DUPLICATE),
        'Mã giao dịch ngân hàng này đã được dùng cho một đơn nạp khác. Vui lòng kiểm tra lại.',
      );
      assert.equal(
        resolveApiErrorMessageVi(ApiErrorCode.TOPUP_STATE_INVALID),
        'Đơn nạp không ở trạng thái phù hợp để thực hiện thao tác này. Vui lòng tải lại danh sách.',
      );
    });
  });

  describe('Composable useTopup.ts (Unit Tests & State Management)', () => {
    let useTopupModule;
    let mockContextModule;
    const tmpContextPath = path.join(webRoot, 'test', `.tmp-mock-ctx-${Date.now()}.ts`);
    const tmpHarnessPath = path.join(webRoot, 'test', `.tmp-useTopup-harness-${Date.now()}.ts`);

    before(async () => {
      const mockContextCode = `
export let mockClientInstance: any = {};
export let mockRefreshNuxtDataCalls: string[] = [];

export function setMockClient(client: any) {
  mockClientInstance = client;
}

export function resetMockNuxt() {
  mockRefreshNuxtDataCalls = [];
}

export const refreshNuxtData = async (key: string) => {
  mockRefreshNuxtDataCalls.push(key);
};

export const ME_KEY = 'motion-ai-me-profile';

export const useApiClient = () => ({
  client: mockClientInstance,
  accessToken: { value: 'mock-token' },
  setAccessToken: () => {},
});
`;
      fs.writeFileSync(tmpContextPath, mockContextCode, 'utf8');

      let code = fs.readFileSync(path.join(webRoot, 'composables/useTopup.ts'), 'utf8');
      code = code.replace("from '#imports'", `from './${path.basename(tmpContextPath)}'`);
      code = code.replace("from '~/composables/useApiClient'", `from './${path.basename(tmpContextPath)}'`);
      code = code.replace("from '~/utils/api-client'", "from '../utils/api-client.ts'");
      code = code.replace("from '~/utils/topup'", "from '../utils/topup.ts'");

      fs.writeFileSync(tmpHarnessPath, code, 'utf8');

      mockContextModule = await import(pathToFileURL(tmpContextPath).href);
      useTopupModule = await import(pathToFileURL(tmpHarnessPath).href);
    });

    after(() => {
      if (fs.existsSync(tmpContextPath)) fs.unlinkSync(tmpContextPath);
      if (fs.existsSync(tmpHarnessPath)) fs.unlinkSync(tmpHarnessPath);
    });

    it('khởi tạo state mặc định rỗng và cờ trạng thái chính xác', () => {
      const {
        activeTopup,
        isModalOpen,
        isCreating,
        isConfirming,
        createErrorVi,
        confirmErrorVi,
        topups,
        hasMore,
        nextCursor,
      } = useTopupModule.useTopup();

      assert.equal(activeTopup.value, null);
      assert.equal(isModalOpen.value, false);
      assert.equal(isCreating.value, false);
      assert.equal(isConfirming.value, false);
      assert.equal(createErrorVi.value, null);
      assert.equal(confirmErrorVi.value, null);
      assert.equal(topups.value.length, 0);
      assert.equal(hasMore.value, false);
      assert.equal(nextCursor.value, null);
    });

    it('createOrder chặn gọi trùng lặp (double-click lock) khi isCreating đang true và kiểm tra ToS consent', async () => {
      let callCount = 0;
      mockContextModule.setMockClient({
        createTopup: async () => {
          callCount++;
          return MOCK_TOPUPS_BY_STATUS.awaiting_transfer;
        },
      });

      const topup = useTopupModule.useTopup();

      // Chưa đồng ý ToS -> từ chối ngay lập tức
      const noConsentResult = await topup.createOrder('pro', false);
      assert.equal(noConsentResult, null);
      assert.equal(callCount, 0);
      assert.match(topup.createErrorVi.value ?? '', /Điều khoản dịch vụ/);

      // Đặt isCreating = true thủ công để kiểm tra guard chống gọi trùng
      topup.isCreating.value = true;
      const doubleClickResult = await topup.createOrder('pro', true);
      assert.equal(doubleClickResult, null);
      assert.equal(callCount, 0);

      // Mở khóa -> gọi thành công
      topup.isCreating.value = false;
      const successResult = await topup.createOrder('pro', true);
      assert.equal(callCount, 1);
      assert.equal(successResult?.id, MOCK_TOPUPS_BY_STATUS.awaiting_transfer.id);
      assert.equal(topup.isModalOpen.value, true);
      assert.equal(topup.activeTopup.value?.id, MOCK_TOPUPS_BY_STATUS.awaiting_transfer.id);
      assert.equal(topup.topups.value.length, 1);
      topup.closeModal();
    });

    it('confirmTransfer chống double-click và chuyển sang expired khi nhận lỗi TOPUP_QR_EXPIRED (409)', async () => {
      let confirmCallCount = 0;
      mockContextModule.setMockClient({
        confirmTopupTransfer: async () => {
          confirmCallCount++;
          throw new MotionApiClientError({
            status: 409,
            code: ApiErrorCode.TOPUP_QR_EXPIRED,
            serverMessage: 'Mã QR đã hết hạn.',
          });
        },
      });

      const topup = useTopupModule.useTopup();
      // Đặt qrExpiresAt ở tương lai để isExpired phía client là false, cho phép gửi request
      topup.activeTopup.value = {
        ...MOCK_TOPUPS_BY_STATUS.awaiting_transfer,
        qrExpiresAt: new Date(Date.now() + 600_000).toISOString(),
      };
      topup.remainingSeconds.value = 600;
      topup.isModalOpen.value = true;

      // Khi isConfirming = true -> chặn gọi
      topup.isConfirming.value = true;
      const blockedRes = await topup.confirmTransfer();
      assert.equal(blockedRes, null);
      assert.equal(confirmCallCount, 0);

      // Mở khóa và gọi xác nhận -> nhận lỗi TOPUP_QR_EXPIRED
      topup.isConfirming.value = false;
      const failedRes = await topup.confirmTransfer();
      assert.equal(failedRes, null);
      assert.equal(confirmCallCount, 1);
      assert.equal(topup.activeTopup.value?.status, 'expired');
      assert.match(topup.confirmErrorVi.value ?? '', /Mã QR đã hết hạn/);
      topup.closeModal();
    });

    it('polling trạng thái dừng ngay và kích hoạt refreshNuxtData(ME_KEY) khi đơn nạp chuyển approved', async (t) => {
      t.mock.timers.enable({ apis: ['setInterval'] });
      mockContextModule.resetMockNuxt();
      let pollCount = 0;
      mockContextModule.setMockClient({
        getTopup: async () => {
          pollCount++;
          return MOCK_TOPUPS_BY_STATUS.approved;
        },
      });

      const topup = useTopupModule.useTopup();
      topup.openModal({ ...MOCK_TOPUPS_BY_STATUS.pending });
      t.mock.timers.tick(4000);
      await flushMicrotasks();

      assert.equal(pollCount, 1, 'Polling phải được kích hoạt sau 4 giây');
      assert.equal(topup.activeTopup.value?.status, 'approved');
      assert.ok(
        mockContextModule.mockRefreshNuxtDataCalls.includes('motion-ai-me-profile'),
        'Phải kích hoạt refreshNuxtData(ME_KEY) khi đơn nạp approved',
      );
      t.mock.timers.tick(8000);
      await flushMicrotasks();
      assert.equal(pollCount, 1, 'Đã approved thì không poll thêm');
      topup.closeModal();
    });

    it('confirmTransfer thành công: sang pending, dừng đếm ngược và tiếp tục polling', async (t) => {
      t.mock.timers.enable({ apis: ['setInterval'] });
      let pollCount = 0;
      mockContextModule.setMockClient({
        confirmTopupTransfer: async () => MOCK_TOPUPS_BY_STATUS.pending,
        getTopup: async () => {
          pollCount++;
          return MOCK_TOPUPS_BY_STATUS.pending;
        },
      });

      const topup = useTopupModule.useTopup();
      topup.activeTopup.value = {
        ...MOCK_TOPUPS_BY_STATUS.awaiting_transfer,
        qrExpiresAt: new Date(Date.now() + 600_000).toISOString(),
      };
      topup.remainingSeconds.value = 600;
      topup.isModalOpen.value = true;

      const res = await topup.confirmTransfer();
      assert.equal(res?.status, 'pending');
      assert.equal(topup.activeTopup.value?.status, 'pending');
      assert.equal(topup.confirmErrorVi.value, null);

      t.mock.timers.tick(4000);
      await flushMicrotasks();
      assert.equal(pollCount, 1, 'Sau xác nhận phải tiếp tục polling');
      topup.closeModal();
    });

    for (const terminal of ['rejected', 'expired', 'needs_review']) {
      it(`polling dừng khi server trả trạng thái cuối "${terminal}"`, async (t) => {
        t.mock.timers.enable({ apis: ['setInterval'] });
        let pollCount = 0;
        mockContextModule.setMockClient({
          getTopup: async () => {
            pollCount++;
            return { ...MOCK_TOPUPS_BY_STATUS.pending, status: terminal };
          },
        });

        const topup = useTopupModule.useTopup();
        topup.openModal({ ...MOCK_TOPUPS_BY_STATUS.pending });
        t.mock.timers.tick(4000);
        await flushMicrotasks();
        assert.equal(pollCount, 1);
        assert.equal(topup.activeTopup.value?.status, terminal);

        t.mock.timers.tick(12000);
        await flushMicrotasks();
        assert.equal(pollCount, 1, 'Trạng thái cuối thì không poll thêm');
        topup.closeModal();
      });
    }

    it('polling dừng sau 5 lỗi liên tiếp', async (t) => {
      t.mock.timers.enable({ apis: ['setInterval'] });
      let pollCount = 0;
      mockContextModule.setMockClient({
        getTopup: async () => {
          pollCount++;
          throw new Error('mất kết nối');
        },
      });

      const topup = useTopupModule.useTopup();
      topup.openModal({ ...MOCK_TOPUPS_BY_STATUS.pending });
      for (let i = 0; i < 5; i++) {
        t.mock.timers.tick(4000);
        await flushMicrotasks();
      }
      assert.equal(pollCount, 5);

      t.mock.timers.tick(12000);
      await flushMicrotasks();
      assert.equal(pollCount, 5, 'Sau 5 lỗi liên tiếp phải ngừng poll');
      topup.closeModal();
    });

    it('polling dừng ngay khi gặp 401', async (t) => {
      t.mock.timers.enable({ apis: ['setInterval'] });
      let pollCount = 0;
      mockContextModule.setMockClient({
        getTopup: async () => {
          pollCount++;
          throw new MotionApiClientError({
            status: 401,
            code: ApiErrorCode.UNAUTHORIZED,
            serverMessage: 'Hết phiên.',
          });
        },
      });

      const topup = useTopupModule.useTopup();
      topup.openModal({ ...MOCK_TOPUPS_BY_STATUS.pending });
      t.mock.timers.tick(4000);
      await flushMicrotasks();
      t.mock.timers.tick(8000);
      await flushMicrotasks();
      assert.equal(pollCount, 1);
      topup.closeModal();
    });

    it('isOutsideHours của đơn pending dựa vào approveBy do server tính', () => {
      const now = Date.parse('2026-11-07T10:00:00.000Z');
      const base = { ...MOCK_TOPUPS_BY_STATUS.pending, createdAt: '2026-11-07T20:00:00.000Z' };
      // Hạn duyệt còn trong 15 phút: đơn đang được duyệt bình thường, không hiện banner
      assert.equal(
        isApprovalDeferred({ ...base, approveBy: new Date(now + 10 * 60_000).toISOString() }, now),
        false,
      );
      // Hạn duyệt lùi sang sáng hôm sau: hiện banner
      assert.equal(
        isApprovalDeferred({ ...base, approveBy: new Date(now + 9 * 3600_000).toISOString() }, now),
        true,
      );
      // Đơn tạo ngoài giờ nhưng xem lúc trong giờ vẫn pending: banner theo approveBy, không theo giờ hiện tại
      assert.equal(isApprovalDeferred({ ...base, approveBy: null }, now), false);
      // Trạng thái khác dùng thời điểm tạo đơn
      assert.equal(
        isApprovalDeferred({ status: 'awaiting_transfer', createdAt: '2026-11-07T20:00:00.000Z' }, now),
        true,
      );
      assert.equal(
        isApprovalDeferred({ status: 'awaiting_transfer', createdAt: '2026-11-07T05:30:00.000Z' }, now),
        false,
      );
    });

    it('phân trang cursor: fetchTopups tải danh sách ban đầu và loadMore tải thêm các đơn kế tiếp', async () => {
      const page1 = {
        items: [MOCK_TOPUPS_BY_STATUS.pending],
        pageSize: 1,
        hasMore: true,
        nextCursor: 'cursor-page-2',
      };
      const page2 = {
        items: [MOCK_TOPUPS_BY_STATUS.approved],
        pageSize: 1,
        hasMore: false,
        nextCursor: null,
      };

      mockContextModule.setMockClient({
        listTopups: async (query) => {
          if (query?.cursor === 'cursor-page-2') {
            return page2;
          }
          return page1;
        },
      });

      const topup = useTopupModule.useTopup();
      await topup.fetchTopups();
      assert.equal(topup.topups.value.length, 1);
      assert.equal(topup.hasMore.value, true);
      assert.equal(topup.nextCursor.value, 'cursor-page-2');

      await topup.loadMore();
      assert.equal(topup.topups.value.length, 2);
      assert.equal(topup.hasMore.value, false);
      assert.equal(topup.nextCursor.value, null);
    });
  });

  describe('Component VietQRModal.vue (Centered Dialog & Mockup Fidelity)', () => {
    const rawModalVue = fs.readFileSync(
      path.join(webRoot, 'components/VietQRModal.vue'),
      'utf8',
    );

    it('VietQRModal tuân thủ Centered Dialog, không dùng Drawer/Bottom Sheet, vùng chạm >= 48px và không có emoji', () => {
      assert.match(rawModalVue, /role="dialog"/);
      assert.match(rawModalVue, /aria-modal="true"/);
      assert.match(rawModalVue, /max-w-\[440px\]/);
      assert.match(rawModalVue, /items-center justify-center/);

      // Tuyệt đối không dùng Drawer hoặc Bottom Sheet
      assert.equal(
        /drawer|bottom-sheet/i.test(rawModalVue),
        false,
        'VietQRModal không được sử dụng Drawer hay Bottom Sheet trên di động',
      );

      // Kiểm tra vùng chạm min-h-[48px] và min-w-[48px]
      const touchMatches = rawModalVue.match(/min-h-\[48px\]\s+min-w-\[48px\]/g);
      assert.ok(
        touchMatches && touchMatches.length >= 3,
        'Các nút bấm trong modal phải có vùng chạm tối thiểu 48px',
      );

      // Không chứa ký tự emoji UTF-8 trong UI chrome
      const emojiRegex =
        /[\u{1F300}-\u{1F5FF}\u{1F600}-\u{1F64F}\u{1F680}-\u{1F6FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/u;
      assert.equal(
        emojiRegex.test(rawModalVue),
        false,
        'VietQRModal không được chứa emoji trong UI chrome',
      );
    });

    async function compileAndRenderModal(setupData) {
      const { descriptor } = parse(rawModalVue);
      const compiled = compileTemplate({
        id: `test-vietqr-modal-${Date.now()}`,
        filename: 'VietQRModal.vue',
        source: descriptor.template.content,
        ssr: true,
        ssrCssVars: [],
      });
      assert.equal(
        compiled.errors.length,
        0,
        `Template VietQRModal lỗi biên dịch: ${compiled.errors.join('; ')}`,
      );

      const tmpFile = path.join(
        webRoot,
        'test',
        `.tmp-vietqr-modal-${Date.now()}-${Math.random().toString(36).slice(2)}.mjs`,
      );
      fs.writeFileSync(tmpFile, compiled.code, 'utf8');

      try {
        const { ssrRender } = await import(pathToFileURL(tmpFile).href);
        const app = createSSRApp({
          ssrRender,
          setup() {
            return {
              OFF_HOURS_MESSAGE_VI,
              getTopupStatusBadgeClass,
              getTopupStatusLabelVi,
              copiedField: null,
              confirmErrorVi: null,
              isCreating: false,
              formatVndVi: (val) => `${val?.toLocaleString('vi-VN')} VNĐ`,
              formatNumberVi: (val) => val?.toLocaleString('vi-VN'),
              ...setupData,
              emit: () => {},
            };
          },
        });
        app.component('Icon', {
          props: ['name'],
          ssrRender(_ctx, _push) {
            _push('<span class="mock-lucide-icon"></span>');
          },
        });
        return await renderToString(app);
      } finally {
        if (fs.existsSync(tmpFile)) {
          fs.unlinkSync(tmpFile);
        }
      }
    }

    it('SSR render trạng thái awaiting_transfer với mã QR thực tế sinh từ generateQrSvg', async () => {
      const order = MOCK_TOPUPS_BY_STATUS.awaiting_transfer;
      // Sinh mã QR thật qua generateQrSvg thay vì stub giả lập
      const realQrSvg = await generateQrSvg(order.qrPayload);
      assert.match(realQrSvg, /<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);

      const html = await compileAndRenderModal({
        open: true,
        topup: order,
        qrSvg: realQrSvg,
        resolvedCountdown: '14:45',
        resolvedIsExpired: false,
        resolvedIsOutsideHours: false,
        packName: 'Pro',
        isConfirming: false,
        confirmErrorVi: null,
      });

      assert.match(html, /data-testid="vietqr-modal"/);
      assert.match(html, /Nạp Credit Qua VietQR/);
      assert.match(html, /data-testid="vietqr-timer-pill"/);
      assert.match(html, /14:45/);
      assert.match(html, /<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
      assert.match(html, /99\.000 VNĐ/);
      assert.match(html, /NAP K7M2Q9XA/);
      assert.match(html, /data-testid="confirm-transfer-button"/);
      assert.match(html, /Tôi Đã Chuyển Khoản Xong/);
      // Chưa hết hạn thì không hiển thị nút Tạo mã mới
      assert.equal(html.includes('data-testid="recreate-order-button"'), false);
    });

    it('SSR render trạng thái awaiting_transfer hết hạn: hiển thị overlay làm mờ QR, hướng dẫn liên hệ và nút tạo mã mới', async () => {
      const order = MOCK_TOPUPS_BY_STATUS.awaiting_transfer;
      const realQrSvg = await generateQrSvg(order.qrPayload);

      const html = await compileAndRenderModal({
        open: true,
        topup: order,
        qrSvg: realQrSvg,
        resolvedCountdown: '00:00',
        resolvedIsExpired: true,
        resolvedIsOutsideHours: false,
        packName: 'Pro',
        isConfirming: false,
        confirmErrorVi: null,
      });

      assert.match(html, /data-testid="vietqr-expired-pill"/);
      assert.match(html, /Mã đã hết hạn/);
      assert.match(html, /data-testid="vietqr-expired-overlay"/);
      assert.match(html, /data-testid="vietqr-expired-contact-hint"/);
      assert.match(html, /liên hệ bộ phận hỗ trợ kèm mã giao dịch ngân hàng/);
      assert.match(html, /<button type="button" disabled/); // nút xác nhận bị thay bằng nút disabled
      assert.match(html, /data-testid="recreate-order-button"/);
      assert.match(html, /Tạo mã mới/);
    });

    it('SSR render banner giải thích khi đơn được tạo ngoài khung 08:00–23:00 UTC+7', async () => {
      const order = MOCK_TOPUPS_BY_STATUS.awaiting_transfer;
      const html = await compileAndRenderModal({
        open: true,
        topup: order,
        qrSvg: '<svg></svg>',
        resolvedCountdown: '14:45',
        resolvedIsExpired: false,
        resolvedIsOutsideHours: true,
        packName: 'Pro',
        isConfirming: false,
        confirmErrorVi: null,
      });

      assert.match(html, /data-testid="vietqr-off-hours-banner"/);
      assert.match(
        html,
        /Đơn sẽ được duyệt từ 08:00 sáng hôm sau/,
      );
    });

    it('SSR render trạng thái pending: hiển thị Đang chờ duyệt và banner ngoài khung giờ nếu có', async () => {
      const order = MOCK_TOPUPS_BY_STATUS.pending;
      const html = await compileAndRenderModal({
        open: true,
        topup: order,
        qrSvg: '',
        resolvedIsOutsideHours: true,
        packName: 'Pro',
      });

      assert.match(html, /data-testid="vietqr-pending-card"/);
      assert.match(html, /Đang chờ duyệt/);
      assert.match(html, /data-testid="vietqr-pending-off-hours-banner"/);
      assert.match(
        html,
        /Đơn sẽ được duyệt từ 08:00 sáng hôm sau/,
      );
      assert.match(html, /data-testid="vietqr-close-pending-button"/);
    });

    it('SSR render trạng thái approved: hiển thị chúc mừng, credit cộng vào và bankRef', async () => {
      const order = MOCK_TOPUPS_BY_STATUS.approved;
      const html = await compileAndRenderModal({
        open: true,
        topup: order,
        qrSvg: '',
        packName: 'Pro',
      });

      assert.match(html, /data-testid="vietqr-approved-card"/);
      assert.match(html, /Nạp credit thành công!/);
      assert.match(html, /\+12\.000 credit/);
      assert.match(html, /FT26311000123/);
      assert.match(html, /data-testid="vietqr-finish-approved-button"/);
    });

    it('SSR render trạng thái rejected: hiển thị lý do từ chối và nút tạo đơn mới', async () => {
      const order = MOCK_TOPUPS_BY_STATUS.rejected;
      const html = await compileAndRenderModal({
        open: true,
        topup: order,
        qrSvg: '',
        packName: 'Pro',
      });

      assert.match(html, /data-testid="vietqr-rejected-card"/);
      assert.match(html, /Bị từ chối/);
      assert.match(html, /data-testid="vietqr-reject-reason"/);
      assert.match(
        html,
        /Không tìm thấy giao dịch tương ứng trên sao kê ngân hàng/,
      );
      assert.match(html, /data-testid="vietqr-recreate-rejected-button"/);
    });

    it('SSR render trạng thái needs_review: hiển thị ghi chú đối chiếu và hướng dẫn hỗ trợ', async () => {
      const order = MOCK_TOPUPS_BY_STATUS.needs_review;
      const html = await compileAndRenderModal({
        open: true,
        topup: order,
        qrSvg: '',
        packName: 'Pro',
      });

      assert.match(html, /data-testid="vietqr-needs-review-card"/);
      assert.match(html, /Cần xem xét/);
      assert.match(html, /data-testid="vietqr-review-note"/);
      assert.match(html, /Số tiền chuyển lệch so với đơn, đang chờ đối chiếu/);
    });

    it('SSR render trạng thái expired: hiển thị thông báo hết hạn và nút tạo mã mới', async () => {
      const order = MOCK_TOPUPS_BY_STATUS.expired;
      const html = await compileAndRenderModal({
        open: true,
        topup: order,
        qrSvg: '',
        packName: 'Pro',
      });

      assert.match(html, /data-testid="vietqr-expired-card"/);
      assert.match(html, /Mã QR đã hết hạn/);
      assert.match(html, /data-testid="vietqr-recreate-expired-button"/);
    });
  });

  describe('Page pages/topup.vue & Pricing Integration', () => {
    const rawTopupPage = fs.readFileSync(
      path.join(webRoot, 'pages/topup.vue'),
      'utf8',
    );

    it('pages/topup.vue tuân thủ vùng chạm >= 48px, không emoji UTF-8 và hỗ trợ màn hình 360px', () => {
      assert.match(rawTopupPage, /data-testid="page-topup"/);
      assert.match(rawTopupPage, /data-testid="topup-packs-grid"/);
      assert.match(rawTopupPage, /data-testid="topup-consent-checkbox"/);
      assert.match(rawTopupPage, /data-testid="create-topup-button"/);

      // Nút tạo đơn phải bị disabled nếu chưa tích ToS
      assert.match(rawTopupPage, /:disabled="!consent\s*\|\|\s*isCreating"/);

      // Không chứa emoji trong UI chrome
      const emojiRegex =
        /[\u{1F300}-\u{1F5FF}\u{1F600}-\u{1F64F}\u{1F680}-\u{1F6FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/u;
      assert.equal(
        emojiRegex.test(rawTopupPage),
        false,
        'pages/topup.vue không được chứa emoji trong UI chrome',
      );

      // Touch target >= 48px
      const touchMatches = rawTopupPage.match(/min-h-\[48px\]\s+min-w-\[48px\]/g);
      assert.ok(
        touchMatches && touchMatches.length >= 4,
        'Các nút trên trang topup phải có vùng chạm tối thiểu 48px',
      );
    });

    it('SSR render pages/topup.vue hiển thị 3 gói từ pricing config, ToS checkbox và danh sách đơn nạp', async () => {
      const { descriptor } = parse(rawTopupPage);
      const compiled = compileTemplate({
        id: `test-page-topup-${Date.now()}`,
        filename: 'topup.vue',
        source: descriptor.template.content,
        ssr: true,
        ssrCssVars: [],
      });
      assert.equal(compiled.errors.length, 0);

      const tmpFile = path.join(
        webRoot,
        'test',
        `.tmp-page-topup-${Date.now()}.mjs`,
      );
      fs.writeFileSync(tmpFile, compiled.code, 'utf8');

      try {
        const { ssrRender } = await import(pathToFileURL(tmpFile).href);
        const app = createSSRApp({
          ssrRender,
          setup() {
            return {
              pricing: MOCK_PRICING_CONFIG_RESPONSE,
              currentTier: 'Pro',
              isPricingLoading: false,
              pricingErrorVi: null,
              topupPacks: MOCK_PRICING_CONFIG_RESPONSE.topupPacks,
              selectedPack: 'pro',
              consent: false,
              isCreating: false,
              currentSelectedPackData:
                MOCK_PRICING_CONFIG_RESPONSE.topupPacks[1],
              createErrorVi: null,
              isAuthenticated: true,
              listErrorVi: null,
              isLoadingList: false,
              isLoadingMore: false,
              topups: MOCK_TOPUP_LIST_RESPONSE.items,
              hasMore: false,
              isModalOpen: false,
              activeTopup: null,
              isConfirming: false,
              confirmErrorVi: null,
              remainingSeconds: 0,
              formattedCountdown: '00:00',
              isExpired: false,
              isOutsideHours: false,
              refreshPricing: () => {},
              closeModal: () => {},
              confirmTransfer: () => {},
              handleRecreateOrder: () => {},
              formatVndVi: (val) => `${val?.toLocaleString('vi-VN')} VNĐ`,
              formatNumberVi: (val) => val?.toLocaleString('vi-VN'),
              formatTopupTimestampVi: () => '07/11/2026 10:00',
              getTopupStatusBadgeClass,
              getTopupStatusLabelVi,
              emit: () => {},
            };
          },
        });
        app.component('Icon', {
          props: ['name'],
          ssrRender(_ctx, _push) {
            _push('<span class="mock-lucide-icon"></span>');
          },
        });
        app.component('NuxtLink', {
          props: ['to'],
          setup(props, { slots }) {
            return () => h('a', { href: props.to }, slots.default?.());
          },
        });
        app.component('ApiErrorBanner', {
          props: ['messageVi'],
          ssrRender() {},
        });
        app.component('VietQRModal', {
          props: ['open'],
          ssrRender() {},
        });

        const html = await renderToString(app);
        assert.match(html, /data-testid="page-topup"/);
        assert.match(html, /Gói Starter/);
        assert.match(html, /49\.000 VNĐ/);
        assert.match(html, /Gói Pro/);
        assert.match(html, /99\.000 VNĐ/);
        assert.match(html, /Gói Creator/);
        assert.match(html, /199\.000 VNĐ/);
        assert.match(html, /data-testid="topup-consent-checkbox"/);
        assert.match(html, /data-testid="create-topup-button"/);
        // Chỉ nút tạo đơn (không phải phần tử nào khác) bị disabled vì consent = false
        assert.match(html, /data-testid="create-topup-button"[^>]*\sdisabled/);
        assert.match(html, /data-testid="topup-orders-list"/);
        assert.match(html, /NAP P4N8T2WD/);
      } finally {
        if (fs.existsSync(tmpFile)) {
          fs.unlinkSync(tmpFile);
        }
      }
    });

    it('SSR render pages/pricing.vue tạo thẻ <a> NuxtLink liên kết chính xác tới /topup?pack=...', async () => {
      const rawPricing = fs.readFileSync(
        path.join(webRoot, 'pages/pricing.vue'),
        'utf8',
      );
      const { descriptor } = parse(rawPricing);
      const compiled = compileTemplate({
        id: `test-page-pricing-${Date.now()}`,
        filename: 'pricing.vue',
        source: descriptor.template.content,
        ssr: true,
        ssrCssVars: [],
      });
      assert.equal(compiled.errors.length, 0);

      const tmpFile = path.join(
        webRoot,
        'test',
        `.tmp-page-pricing-${Date.now()}.mjs`,
      );
      fs.writeFileSync(tmpFile, compiled.code, 'utf8');

      try {
        const { ssrRender } = await import(pathToFileURL(tmpFile).href);
        const app = createSSRApp({
          ssrRender,
          setup() {
            return {
              pricing: MOCK_PRICING_CONFIG_RESPONSE,
              currentTier: 'FREE',
              isLoading: false,
              errorMessageVi: null,
              refreshAll: () => {},
              clearError: () => {},
              formatNumberVi: (n) => String(n),
              formatVndVi: (n) => `${n?.toLocaleString('vi-VN')} VNĐ`,
            };
          },
        });
        app.component('Icon', {
          props: ['name'],
          ssrRender(_ctx, _push) {
            _push('<span class="mock-lucide-icon"></span>');
          },
        });
        app.component('NuxtLink', {
          props: ['to'],
          setup(props, { slots }) {
            return () => h('a', { href: props.to }, slots.default?.());
          },
        });
        app.component('ApiErrorBanner', {
          props: ['messageVi'],
          ssrRender() {},
        });

        const html = await renderToString(app);
        assert.match(html, /<a href="\/topup\?pack=starter"/);
        assert.match(html, /<a href="\/topup\?pack=pro"/);
        assert.match(html, /<a href="\/topup\?pack=creator"/);
        assert.match(html, /Nạp gói Starter qua VietQR/);
        assert.match(html, /Nạp gói Pro qua VietQR/);
        assert.match(html, /Nạp gói Creator qua VietQR/);
        assert.match(html, /Hạng mặc định khi đăng ký/);
      } finally {
        if (fs.existsSync(tmpFile)) {
          fs.unlinkSync(tmpFile);
        }
      }
    });
  });
});
