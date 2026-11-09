import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { compileScript, compileTemplate, parse } from '@vue/compiler-sfc';
import { createSSRApp } from 'vue';
import { renderToString } from '@vue/server-renderer';
import {
  ApiErrorCode,
  MOCK_ADMIN_TOPUPS_BY_STATUS,
  MOCK_ADMIN_TOPUP_LIST_RESPONSE,
  getTopupStatusLabelVi,
} from '@flowvis/contracts';
import {
  MotionApiClientError,
  createMotionApiClient,
  resolveApiErrorMessageVi,
} from '../utils/api-client.ts';
import {
  formatTopupTimestampVi,
  getTopupStatusBadgeClass,
  isOverdue,
} from '../utils/topup.ts';
import { formatNumberVi, formatVndVi } from '../utils/catalog.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const webRoot = path.resolve(__dirname, '..');

const flushMicrotasks = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};

describe('Story 3.7: [FE] Dashboard Admin duyệt đơn nạp', () => {
  describe('API Client Admin Topup Methods & Error Handling', () => {
    it('adminListTopups gọi GET /admin/topups với query status, pageSize, cursor và parse Zod schema', async () => {
      let capturedUrl = '';
      let capturedMethod = '';

      const client = createMotionApiClient({
        baseUrl: 'http://test-admin.example',
        fetchImpl: async (url, init) => {
          capturedUrl = String(url);
          capturedMethod = init?.method ?? 'GET';
          return new Response(JSON.stringify(MOCK_ADMIN_TOPUP_LIST_RESPONSE), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        },
      });

      const res = await client.adminListTopups({
        status: 'pending',
        pageSize: 10,
        cursor: 'cursor-123',
      });

      assert.equal(capturedMethod, 'GET');
      assert.equal(
        capturedUrl,
        'http://test-admin.example/admin/topups?status=pending&pageSize=10&cursor=cursor-123',
      );
      assert.equal(res.items.length, 3);
      assert.equal(res.items[0].userId, MOCK_ADMIN_TOPUPS_BY_STATUS.pending.userId);
    });

    it('adminApproveTopup gọi POST /admin/topups/:id/approve với body { bankRef }', async () => {
      let capturedUrl = '';
      let capturedMethod = '';
      let capturedBody = '';

      const client = createMotionApiClient({
        baseUrl: 'http://test-admin.example',
        fetchImpl: async (url, init) => {
          capturedUrl = String(url);
          capturedMethod = init?.method ?? '';
          capturedBody = String(init?.body ?? '');
          return new Response(JSON.stringify(MOCK_ADMIN_TOPUPS_BY_STATUS.approved), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        },
      });

      const targetId = MOCK_ADMIN_TOPUPS_BY_STATUS.pending.id;
      const res = await client.adminApproveTopup(targetId, {
        bankRef: 'FT26305991820',
      });

      assert.equal(capturedMethod, 'POST');
      assert.equal(
        capturedUrl,
        `http://test-admin.example/admin/topups/${encodeURIComponent(targetId)}/approve`,
      );
      assert.deepEqual(JSON.parse(capturedBody), { bankRef: 'FT26305991820' });
      assert.equal(res.status, 'approved');
      assert.equal(res.bankRef, 'FT26311000123');
    });

    it('adminApproveExpiredTopup gọi POST /admin/topups/:id/approve-expired', async () => {
      let capturedUrl = '';
      let capturedMethod = '';
      let capturedBody = '';

      const client = createMotionApiClient({
        baseUrl: 'http://test-admin.example',
        fetchImpl: async (url, init) => {
          capturedUrl = String(url);
          capturedMethod = init?.method ?? '';
          capturedBody = String(init?.body ?? '');
          return new Response(JSON.stringify(MOCK_ADMIN_TOPUPS_BY_STATUS.approved), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        },
      });

      const targetId = MOCK_ADMIN_TOPUPS_BY_STATUS.expired.id;
      const res = await client.adminApproveExpiredTopup(targetId, {
        bankRef: 'FT999888777',
      });

      assert.equal(capturedMethod, 'POST');
      assert.equal(
        capturedUrl,
        `http://test-admin.example/admin/topups/${encodeURIComponent(targetId)}/approve-expired`,
      );
      assert.deepEqual(JSON.parse(capturedBody), { bankRef: 'FT999888777' });
      assert.equal(res.status, 'approved');
    });

    it('adminRejectTopup gọi POST /admin/topups/:id/reject với body { rejectReason }', async () => {
      let capturedUrl = '';
      let capturedMethod = '';
      let capturedBody = '';

      const client = createMotionApiClient({
        baseUrl: 'http://test-admin.example',
        fetchImpl: async (url, init) => {
          capturedUrl = String(url);
          capturedMethod = init?.method ?? '';
          capturedBody = String(init?.body ?? '');
          return new Response(JSON.stringify(MOCK_ADMIN_TOPUPS_BY_STATUS.rejected), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        },
      });

      const targetId = MOCK_ADMIN_TOPUPS_BY_STATUS.pending.id;
      const res = await client.adminRejectTopup(targetId, {
        rejectReason: 'Không tìm thấy giao dịch chuyển khoản trên sao kê.',
      });

      assert.equal(capturedMethod, 'POST');
      assert.equal(
        capturedUrl,
        `http://test-admin.example/admin/topups/${encodeURIComponent(targetId)}/reject`,
      );
      assert.deepEqual(JSON.parse(capturedBody), {
        rejectReason: 'Không tìm thấy giao dịch chuyển khoản trên sao kê.',
      });
      assert.equal(res.status, 'rejected');
    });

    it('adminNeedsReviewTopup gọi POST /admin/topups/:id/needs-review với body { note }', async () => {
      let capturedUrl = '';
      let capturedMethod = '';
      let capturedBody = '';

      const client = createMotionApiClient({
        baseUrl: 'http://test-admin.example',
        fetchImpl: async (url, init) => {
          capturedUrl = String(url);
          capturedMethod = init?.method ?? '';
          capturedBody = String(init?.body ?? '');
          return new Response(JSON.stringify(MOCK_ADMIN_TOPUPS_BY_STATUS.needs_review), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        },
      });

      const targetId = MOCK_ADMIN_TOPUPS_BY_STATUS.pending.id;
      const res = await client.adminNeedsReviewTopup(targetId, {
        note: 'Số tiền chuyển bị lệch so với đơn hàng.',
      });

      assert.equal(capturedMethod, 'POST');
      assert.equal(
        capturedUrl,
        `http://test-admin.example/admin/topups/${encodeURIComponent(targetId)}/needs-review`,
      );
      assert.deepEqual(JSON.parse(capturedBody), {
        note: 'Số tiền chuyển bị lệch so với đơn hàng.',
      });
      assert.equal(res.status, 'needs_review');
    });

    it('adminReturnTopupToPending gọi POST /admin/topups/:id/return-to-pending với body rỗng', async () => {
      let capturedUrl = '';
      let capturedMethod = '';

      const client = createMotionApiClient({
        baseUrl: 'http://test-admin.example',
        fetchImpl: async (url, init) => {
          capturedUrl = String(url);
          capturedMethod = init?.method ?? '';
          return new Response(JSON.stringify(MOCK_ADMIN_TOPUPS_BY_STATUS.pending), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        },
      });

      const targetId = MOCK_ADMIN_TOPUPS_BY_STATUS.needs_review.id;
      const res = await client.adminReturnTopupToPending(targetId);

      assert.equal(capturedMethod, 'POST');
      assert.equal(
        capturedUrl,
        `http://test-admin.example/admin/topups/${encodeURIComponent(targetId)}/return-to-pending`,
      );
      assert.equal(res.status, 'pending');
    });

    it('Ánh xạ chính xác các mã lỗi đặc thù của Admin Topup sang tiếng Việt (I/O Matrix)', () => {
      assert.equal(
        resolveApiErrorMessageVi(ApiErrorCode.BANK_REF_DUPLICATE),
        'Mã giao dịch ngân hàng này đã được dùng cho một đơn nạp khác. Vui lòng kiểm tra lại.',
      );
      assert.equal(
        resolveApiErrorMessageVi(ApiErrorCode.TOPUP_STATE_INVALID),
        'Đơn nạp không ở trạng thái phù hợp để thực hiện thao tác này. Vui lòng tải lại danh sách.',
      );
      assert.equal(
        resolveApiErrorMessageVi(ApiErrorCode.VALIDATION_FAILED),
        'Dữ liệu gửi lên không hợp lệ. Vui lòng kiểm tra lại thông tin.',
      );
      assert.equal(
        resolveApiErrorMessageVi(ApiErrorCode.FORBIDDEN),
        'Bạn không có quyền thực hiện thao tác này.',
      );
    });
  });

  describe('Composable useAdminTopups.ts (Unit Tests & State Management)', () => {
    let useAdminTopupsModule;
    let mockContextModule;
    const tmpContextPath = path.join(
      webRoot,
      'test',
      `.tmp-admin-ctx-${Date.now()}.ts`,
    );
    const tmpHarnessPath = path.join(
      webRoot,
      'test',
      `.tmp-useAdminTopups-harness-${Date.now()}.ts`,
    );

    before(async () => {
      const mockContextCode = `
export let mockClientInstance: any = {};
export function setMockClient(client: any) {
  mockClientInstance = client;
}
export const useApiClient = () => ({
  client: mockClientInstance,
  accessToken: { value: 'mock-token' },
  setAccessToken: () => {},
});
`;
      fs.writeFileSync(tmpContextPath, mockContextCode, 'utf8');

      let code = fs.readFileSync(
        path.join(webRoot, 'composables/useAdminTopups.ts'),
        'utf8',
      );
      code = code.replace(
        "from '~/composables/useApiClient'",
        `from './${path.basename(tmpContextPath)}'`,
      );
      code = code.replace(
        "from '~/utils/api-client'",
        "from '../utils/api-client.ts'",
      );

      fs.writeFileSync(tmpHarnessPath, code, 'utf8');

      mockContextModule = await import(pathToFileURL(tmpContextPath).href);
      useAdminTopupsModule = await import(pathToFileURL(tmpHarnessPath).href);
    });

    after(() => {
      if (fs.existsSync(tmpContextPath)) fs.unlinkSync(tmpContextPath);
      if (fs.existsSync(tmpHarnessPath)) fs.unlinkSync(tmpHarnessPath);
    });

    it('khởi tạo state mặc định rỗng với filter pending', () => {
      const {
        statusFilter,
        topups,
        isLoading,
        isLoadingMore,
        isActionLoading,
        errorVi,
        actionErrorVi,
        hasMore,
        nextCursor,
      } = useAdminTopupsModule.useAdminTopups();

      assert.equal(statusFilter.value, 'pending');
      assert.equal(topups.value.length, 0);
      assert.equal(isLoading.value, false);
      assert.equal(isLoadingMore.value, false);
      assert.equal(isActionLoading.value, false);
      assert.equal(errorVi.value, null);
      assert.equal(actionErrorVi.value, null);
      assert.equal(hasMore.value, false);
      assert.equal(nextCursor.value, null);
    });

    it('fetchTopups tải danh sách theo statusFilter và loadMore phân trang cursor', async () => {
      let capturedQuery = null;
      mockContextModule.setMockClient({
        adminListTopups: async (query) => {
          capturedQuery = query;
          if (query?.cursor === 'cur-2') {
            return {
              items: [MOCK_ADMIN_TOPUPS_BY_STATUS.needs_review],
              pageSize: 20,
              hasMore: false,
              nextCursor: null,
            };
          }
          return {
            items: [MOCK_ADMIN_TOPUPS_BY_STATUS.pending],
            pageSize: 20,
            hasMore: true,
            nextCursor: 'cur-2',
          };
        },
      });

      const composable = useAdminTopupsModule.useAdminTopups();
      await composable.fetchTopups(true);

      assert.equal(capturedQuery.status, 'pending');
      assert.equal(composable.topups.value.length, 1);
      assert.equal(composable.hasMore.value, true);
      assert.equal(composable.nextCursor.value, 'cur-2');

      await composable.loadMore();
      assert.equal(composable.topups.value.length, 2);
      assert.equal(composable.hasMore.value, false);
      assert.equal(composable.nextCursor.value, null);
    });

    it('setStatusFilter thay đổi bộ lọc và tự động fetch lại từ đầu', async () => {
      let capturedStatus = null;
      mockContextModule.setMockClient({
        adminListTopups: async (query) => {
          capturedStatus = query?.status;
          return {
            items: [],
            pageSize: 20,
            hasMore: false,
            nextCursor: null,
          };
        },
      });

      const composable = useAdminTopupsModule.useAdminTopups();
      await composable.setStatusFilter('needs_review');

      assert.equal(composable.statusFilter.value, 'needs_review');
      assert.equal(capturedStatus, 'needs_review');

      // Kiểm thử setStatusFilter('all') truyền status = undefined lên server
      await composable.setStatusFilter('all');
      assert.equal(composable.statusFilter.value, 'all');
      assert.equal(capturedStatus, undefined, "Lọc 'all' phải gửi query status = undefined");
    });

    it('loadMore khi gặp lỗi: đặt loadMoreErrorVi, giữ nguyên danh sách hiện có và không làm hỏng errorVi', async () => {
      mockContextModule.setMockClient({
        adminListTopups: async (query) => {
          if (query?.cursor) {
            throw new Error('Lỗi mạng khi tải trang 2');
          }
          return {
            items: [{ ...MOCK_ADMIN_TOPUPS_BY_STATUS.pending }],
            pageSize: 20,
            hasMore: true,
            nextCursor: 'cur-page-2',
          };
        },
      });

      const composable = useAdminTopupsModule.useAdminTopups();
      await composable.fetchTopups(true);
      assert.equal(composable.topups.value.length, 1);
      assert.equal(composable.errorVi.value, null);
      assert.equal(composable.loadMoreErrorVi.value, null);

      await composable.loadMore();
      assert.equal(composable.topups.value.length, 1, 'Danh sách đã tải trước đó phải được giữ nguyên');
      assert.equal(composable.errorVi.value, null, 'errorVi của danh sách chính không bị ghi đè');
      assert.ok(
        composable.loadMoreErrorVi.value && composable.loadMoreErrorVi.value.length > 0,
        'loadMoreErrorVi phải nhận thông báo lỗi tiếng Việt',
      );
      assert.equal(composable.isLoadingMore.value, false);
    });

    it('loại bỏ race condition bằng querySeq khi chuyển tab liên tục', async () => {
      let resolveFirstCall;
      const firstCallPromise = new Promise((resolve) => {
        resolveFirstCall = resolve;
      });

      mockContextModule.setMockClient({
        adminListTopups: async (query) => {
          if (query?.status === 'pending') {
            await firstCallPromise;
            return {
              items: [{ ...MOCK_ADMIN_TOPUPS_BY_STATUS.pending }],
              pageSize: 20,
              hasMore: false,
              nextCursor: null,
            };
          }
          return {
            items: [{ ...MOCK_ADMIN_TOPUPS_BY_STATUS.approved }],
            pageSize: 20,
            hasMore: false,
            nextCursor: null,
          };
        },
      });

      const composable = useAdminTopupsModule.useAdminTopups();
      // Bắt đầu fetch 'pending' (chạy chậm)
      const p1 = composable.fetchTopups(true);

      // Chuyển ngay sang tab 'approved' (chạy nhanh hơn)
      composable.statusFilter.value = 'approved';
      const p2 = composable.fetchTopups(true);
      await p2;

      assert.equal(composable.topups.value[0]?.status, 'approved');

      // Giải phóng request chậm cũ
      resolveFirstCall();
      await p1;

      // Kết quả cũ của request 1 bị bỏ qua nhờ querySeq
      assert.equal(
        composable.topups.value[0]?.status,
        'approved',
        'Request chậm cũ không được ghi đè kết quả của tab mới',
      );
    });

    it('approveTopup cập nhật trạng thái đơn trong danh sách và chống click đúp', async () => {
      let callCount = 0;
      mockContextModule.setMockClient({
        adminApproveTopup: async (id, body) => {
          callCount++;
          return {
            ...MOCK_ADMIN_TOPUPS_BY_STATUS.approved,
            id,
            bankRef: body.bankRef,
          };
        },
      });

      const composable = useAdminTopupsModule.useAdminTopups();
      composable.topups.value = [{ ...MOCK_ADMIN_TOPUPS_BY_STATUS.pending }];

      const targetId = MOCK_ADMIN_TOPUPS_BY_STATUS.pending.id;
      const res = await composable.approveTopup(targetId, '  FT123456  ');

      assert.equal(callCount, 1);
      assert.equal(res.status, 'approved');
      assert.equal(res.bankRef, 'FT123456');
      assert.equal(composable.topups.value[0].status, 'approved');
      assert.equal(composable.topups.value[0].bankRef, 'FT123456');

      // Thử click đúp khi action đang chạy
      composable.isActionLoading.value = true;
      await assert.rejects(
        () => composable.approveTopup(targetId, 'FT999'),
        /Thao tác đang được xử lý, vui lòng không nhấn liên tục./,
      );
      assert.equal(callCount, 1, 'Không gửi thêm request khi click đúp');
      composable.isActionLoading.value = false;
    });

    it('approveExpiredTopup gọi client.adminApproveExpiredTopup, trim bankRef và cập nhật item trong danh sách', async () => {
      let capturedId = '';
      let capturedBody = null;
      mockContextModule.setMockClient({
        adminApproveExpiredTopup: async (id, body) => {
          capturedId = id;
          capturedBody = body;
          return {
            ...MOCK_ADMIN_TOPUPS_BY_STATUS.expired,
            status: 'approved',
            bankRef: body.bankRef,
          };
        },
      });

      const composable = useAdminTopupsModule.useAdminTopups();
      composable.topups.value = [{ ...MOCK_ADMIN_TOPUPS_BY_STATUS.expired }];

      const targetId = MOCK_ADMIN_TOPUPS_BY_STATUS.expired.id;
      const res = await composable.approveExpiredTopup(targetId, '  EXPIRED-REF-999  ');

      assert.equal(capturedId, targetId);
      assert.deepEqual(capturedBody, { bankRef: 'EXPIRED-REF-999' });
      assert.equal(res.status, 'approved');
      assert.equal(composable.topups.value[0].status, 'approved');
      assert.equal(composable.topups.value[0].bankRef, 'EXPIRED-REF-999');

      // Chống click đúp
      composable.isActionLoading.value = true;
      await assert.rejects(
        () => composable.approveExpiredTopup(targetId, 'EXPIRED-REF-999'),
        /Thao tác đang được xử lý, vui lòng không nhấn liên tục./,
      );
      composable.isActionLoading.value = false;
    });

    it('khi gặp lỗi TOPUP_STATE_INVALID, tự động làm mới danh sách đơn để đồng bộ trạng thái mới nhất', async () => {
      let refreshCallCount = 0;
      mockContextModule.setMockClient({
        adminApproveTopup: async () => {
          throw new MotionApiClientError({
            status: 409,
            code: ApiErrorCode.TOPUP_STATE_INVALID,
            serverMessage: 'Đơn nạp không ở trạng thái phù hợp.',
          });
        },
        adminListTopups: async () => {
          refreshCallCount++;
          return {
            items: [{ ...MOCK_ADMIN_TOPUPS_BY_STATUS.approved }],
            pageSize: 20,
            hasMore: false,
            nextCursor: null,
          };
        },
      });

      const composable = useAdminTopupsModule.useAdminTopups();
      composable.topups.value = [{ ...MOCK_ADMIN_TOPUPS_BY_STATUS.pending }];

      await assert.rejects(
        () => composable.approveTopup('any-id', 'FT123'),
        (err) => err instanceof MotionApiClientError && err.code === ApiErrorCode.TOPUP_STATE_INVALID,
      );

      await flushMicrotasks();
      assert.equal(
        composable.actionErrorVi.value,
        'Đơn nạp không ở trạng thái phù hợp để thực hiện thao tác này. Vui lòng tải lại danh sách.',
      );
      assert.equal(refreshCallCount, 1, 'Phải tự động gọi fetchTopups khi gặp TOPUP_STATE_INVALID');
    });

    it('rejectTopup, markNeedsReview và returnToPending hoạt động chuẩn xác', async () => {
      mockContextModule.setMockClient({
        adminRejectTopup: async (id, body) => ({
          ...MOCK_ADMIN_TOPUPS_BY_STATUS.rejected,
          id,
          rejectReason: body.rejectReason,
        }),
        adminNeedsReviewTopup: async (id, body) => ({
          ...MOCK_ADMIN_TOPUPS_BY_STATUS.needs_review,
          id,
          note: body.note,
        }),
        adminReturnTopupToPending: async (id) => ({
          ...MOCK_ADMIN_TOPUPS_BY_STATUS.pending,
          id,
        }),
      });

      const composable = useAdminTopupsModule.useAdminTopups();
      composable.topups.value = [{ ...MOCK_ADMIN_TOPUPS_BY_STATUS.pending }];
      const id = MOCK_ADMIN_TOPUPS_BY_STATUS.pending.id;

      await composable.markNeedsReview(id, 'Lệch số tiền');
      assert.equal(composable.topups.value[0].status, 'needs_review');
      assert.equal(composable.topups.value[0].note, 'Lệch số tiền');

      await composable.returnToPending(id);
      assert.equal(composable.topups.value[0].status, 'pending');

      await composable.rejectTopup(id, 'Sai thông tin');
      assert.equal(composable.topups.value[0].status, 'rejected');
      assert.equal(composable.topups.value[0].rejectReason, 'Sai thông tin');
    });
  });

  describe('Component AdminTopupActionModal.vue (Centered Dialog & Validation)', () => {
    const rawModalVue = fs.readFileSync(
      path.join(webRoot, 'components/AdminTopupActionModal.vue'),
      'utf8',
    );

    it('AdminTopupActionModal tuân thủ Centered Dialog, không dùng Drawer/Bottom Sheet, vùng chạm >= 48px và không có emoji', () => {
      assert.match(rawModalVue, /role="dialog"/);
      assert.match(rawModalVue, /aria-modal="true"/);
      assert.match(rawModalVue, /fixed inset-0.*justify-center/);

      // Tuyệt đối không dùng Drawer hoặc Bottom Sheet
      assert.equal(
        /drawer|bottom-sheet/i.test(rawModalVue),
        false,
        'AdminTopupActionModal không được sử dụng Drawer hay Bottom Sheet',
      );

      // Kiểm tra vùng chạm min-h-[48px] và min-w-[48px]
      const touchMatches = rawModalVue.match(/min-h-\[48px\]\s+min-w-\[48px\]/g);
      assert.ok(
        touchMatches && touchMatches.length >= 2,
        'Các nút bấm trong modal phải có vùng chạm tối thiểu 48px',
      );

      // Không chứa emoji trong UI chrome
      const emojiRegex =
        /[\u{1F300}-\u{1F5FF}\u{1F600}-\u{1F64F}\u{1F680}-\u{1F6FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/u;
      assert.equal(
        emojiRegex.test(rawModalVue),
        false,
        'AdminTopupActionModal không được chứa emoji trong UI chrome',
      );
    });

    async function compileAndRenderModal(setupData) {
      const { descriptor } = parse(rawModalVue);
      const compiled = compileTemplate({
        id: `test-admin-action-modal-${Date.now()}`,
        filename: 'AdminTopupActionModal.vue',
        source: descriptor.template.content,
        ssr: true,
        ssrCssVars: [],
      });
      assert.equal(
        compiled.errors.length,
        0,
        `Template AdminTopupActionModal lỗi: ${compiled.errors.join('; ')}`,
      );

      const tmpFile = path.join(
        webRoot,
        'test',
        `.tmp-action-modal-${Date.now()}-${Math.random().toString(36).slice(2)}.mjs`,
      );
      fs.writeFileSync(tmpFile, compiled.code, 'utf8');

      try {
        const { ssrRender } = await import(pathToFileURL(tmpFile).href);
        const app = createSSRApp({
          ssrRender,
          setup() {
            return {
              formatVndVi,
              formatNumberVi,
              isSubmitting: false,
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

    it('SSR render action approve hiển thị đối chiếu số tiền và input bank_ref', async () => {
      const order = MOCK_ADMIN_TOPUPS_BY_STATUS.pending;
      const html = await compileAndRenderModal({
        open: true,
        topup: order,
        actionType: 'approve',
        modalTitle: 'Duyệt đơn nạp VietQR',
        submitButtonLabel: 'Xác nhận duyệt đơn',
        submitButtonClass: 'bg-cyber-success',
        displayErrorVi: null,
        bankRef: '',
        rejectReason: '',
        note: '',
      });

      assert.match(html, /data-testid="admin-topup-action-modal"/);
      assert.match(html, /Duyệt đơn nạp VietQR/);
      assert.match(html, /data-testid="modal-bank-ref-input"/);
      assert.match(html, /99\.000/); // Số tiền đối chiếu
      assert.match(html, /12\.000 CR/); // Credit cộng vào
      assert.match(html, /NAP P4N8T2WD/);
    });

    it('SSR render action approve-expired hiển thị banner cảnh báo đơn hết hạn', async () => {
      const order = MOCK_ADMIN_TOPUPS_BY_STATUS.expired;
      const html = await compileAndRenderModal({
        open: true,
        topup: order,
        actionType: 'approve-expired',
        modalTitle: 'Duyệt đơn nạp đã hết hạn',
        submitButtonLabel: 'Xác nhận duyệt đơn quá hạn',
        submitButtonClass: 'bg-amber-500',
        displayErrorVi: null,
        bankRef: '',
        rejectReason: '',
        note: '',
      });

      assert.match(html, /data-testid="expired-warning-banner"/);
      assert.match(html, /CẢNH BÁO: Đơn nạp này đã hết hạn hiệu lực chuyển khoản!/);
      assert.match(html, /data-testid="modal-bank-ref-input"/);
    });

    it('SSR render action reject hiển thị textarea lý do từ chối', async () => {
      const order = MOCK_ADMIN_TOPUPS_BY_STATUS.pending;
      const html = await compileAndRenderModal({
        open: true,
        topup: order,
        actionType: 'reject',
        modalTitle: 'Từ chối đơn nạp',
        submitButtonLabel: 'Xác nhận từ chối',
        submitButtonClass: 'bg-rose-500',
        displayErrorVi: null,
        bankRef: '',
        rejectReason: '',
        note: '',
      });

      assert.match(html, /data-testid="modal-reject-reason-input"/);
      assert.match(html, /Lý do từ chối/);
    });

    it('SSR render action needs-review hiển thị textarea ghi chú xem xét', async () => {
      const order = MOCK_ADMIN_TOPUPS_BY_STATUS.pending;
      const html = await compileAndRenderModal({
        open: true,
        topup: order,
        actionType: 'needs-review',
        modalTitle: 'Đánh dấu đơn cần xem xét',
        submitButtonLabel: 'Lưu ghi chú xem xét',
        submitButtonClass: 'bg-orange-500',
        displayErrorVi: null,
        bankRef: '',
        rejectReason: '',
        note: '',
      });

      assert.match(html, /data-testid="modal-note-input"/);
      assert.match(html, /Ghi chú xem xét/);
    });

    it('kiểm thử toàn diện script setup của AdminTopupActionModal: validate dữ liệu, autofocus, escape và focus trap', async () => {
      const { descriptor } = parse(rawModalVue);
      let scriptContent = compileScript(descriptor, { id: `test-modal-script-${Date.now()}` }).content;
      scriptContent = scriptContent.replace("from '~/utils/catalog'", "from '../utils/catalog.ts'");
      const tmpScriptFile = path.join(
        webRoot,
        'test',
        `.tmp-modal-script-${Date.now()}-${Math.random().toString(36).slice(2)}.ts`,
      );
      fs.writeFileSync(tmpScriptFile, scriptContent, 'utf8');

      try {
        const modalModule = await import(pathToFileURL(tmpScriptFile).href);
        const setupFn = modalModule.default.setup;

        // 1. approve / approve-expired: kiểm tra bank_ref bắt buộc và độ dài
        const emittedApprove = [];
        const approveState = setupFn(
          {
            open: true,
            topup: { ...MOCK_ADMIN_TOPUPS_BY_STATUS.pending },
            actionType: 'approve',
            isSubmitting: false,
            errorMessageVi: null,
          },
          { emit: (evt, payload) => emittedApprove.push({ evt, payload }), expose: () => {} },
        );

        // Submit khi để trống bankRef
        approveState.bankRef.value = '   ';
        approveState.handleSubmit();
        assert.equal(
          approveState.localErrorVi.value,
          'Vui lòng nhập mã giao dịch ngân hàng (bank_ref).',
        );
        assert.equal(emittedApprove.length, 0);

        // Submit khi bankRef vượt quá 128 ký tự
        approveState.bankRef.value = 'a'.repeat(129);
        approveState.handleSubmit();
        assert.equal(
          approveState.localErrorVi.value,
          'Mã giao dịch ngân hàng tối đa 128 ký tự.',
        );
        assert.equal(emittedApprove.length, 0);

        // Submit hợp lệ
        approveState.bankRef.value = '  FT99887766  ';
        approveState.handleSubmit();
        assert.equal(emittedApprove.length, 1);
        assert.equal(emittedApprove[0].evt, 'confirm');
        assert.deepEqual(emittedApprove[0].payload, {
          actionType: 'approve',
          topupId: MOCK_ADMIN_TOPUPS_BY_STATUS.pending.id,
          bankRef: 'FT99887766',
        });

        // 2. reject: kiểm tra rejectReason bắt buộc và độ dài
        const emittedReject = [];
        const rejectState = setupFn(
          {
            open: true,
            topup: { ...MOCK_ADMIN_TOPUPS_BY_STATUS.pending },
            actionType: 'reject',
            isSubmitting: false,
            errorMessageVi: null,
          },
          { emit: (evt, payload) => emittedReject.push({ evt, payload }), expose: () => {} },
        );

        rejectState.rejectReason.value = '';
        rejectState.handleSubmit();
        assert.equal(
          rejectState.localErrorVi.value,
          'Vui lòng nhập lý do từ chối.',
        );
        assert.equal(emittedReject.length, 0);

        rejectState.rejectReason.value = 'b'.repeat(501);
        rejectState.handleSubmit();
        assert.equal(
          rejectState.localErrorVi.value,
          'Lý do từ chối tối đa 500 ký tự.',
        );
        assert.equal(emittedReject.length, 0);

        rejectState.rejectReason.value = '  Sai nội dung chuyển khoản  ';
        rejectState.handleSubmit();
        assert.equal(emittedReject.length, 1);
        assert.equal(emittedReject[0].evt, 'confirm');
        assert.deepEqual(emittedReject[0].payload, {
          actionType: 'reject',
          topupId: MOCK_ADMIN_TOPUPS_BY_STATUS.pending.id,
          rejectReason: 'Sai nội dung chuyển khoản',
        });

        // 3. needs-review: kiểm tra note bắt buộc và độ dài
        const emittedReview = [];
        const reviewState = setupFn(
          {
            open: true,
            topup: { ...MOCK_ADMIN_TOPUPS_BY_STATUS.pending },
            actionType: 'needs-review',
            isSubmitting: false,
            errorMessageVi: null,
          },
          { emit: (evt, payload) => emittedReview.push({ evt, payload }), expose: () => {} },
        );

        reviewState.note.value = '';
        reviewState.handleSubmit();
        assert.equal(
          reviewState.localErrorVi.value,
          'Vui lòng nhập ghi chú.',
        );
        assert.equal(emittedReview.length, 0);

        reviewState.note.value = 'c'.repeat(501);
        reviewState.handleSubmit();
        assert.equal(
          reviewState.localErrorVi.value,
          'Ghi chú tối đa 500 ký tự.',
        );
        assert.equal(emittedReview.length, 0);

        reviewState.note.value = '  Cần đối soát sao kê MBBank  ';
        reviewState.handleSubmit();
        assert.equal(emittedReview.length, 1);
        assert.equal(emittedReview[0].evt, 'confirm');
        assert.deepEqual(emittedReview[0].payload, {
          actionType: 'needs-review',
          topupId: MOCK_ADMIN_TOPUPS_BY_STATUS.pending.id,
          note: 'Cần đối soát sao kê MBBank',
        });

        // 4. Khóa thao tác đóng và gửi khi isSubmitting = true
        const emittedSubmitting = [];
        const submittingState = setupFn(
          {
            open: true,
            topup: { ...MOCK_ADMIN_TOPUPS_BY_STATUS.pending },
            actionType: 'approve',
            isSubmitting: true,
            errorMessageVi: null,
          },
          { emit: (evt, payload) => emittedSubmitting.push({ evt, payload }), expose: () => {} },
        );
        submittingState.bankRef.value = 'FT123';
        submittingState.handleSubmit();
        submittingState.handleClose();
        assert.equal(emittedSubmitting.length, 0, 'Không gửi hay đóng khi đang submit');

        // handleClose khi isSubmitting = false
        const emittedClose = [];
        const closeState = setupFn(
          {
            open: true,
            topup: { ...MOCK_ADMIN_TOPUPS_BY_STATUS.pending },
            actionType: 'approve',
            isSubmitting: false,
            errorMessageVi: null,
          },
          { emit: (evt, payload) => emittedClose.push({ evt, payload }), expose: () => {} },
        );
        closeState.handleClose();
        assert.equal(emittedClose.length, 1);
        assert.equal(emittedClose[0].evt, 'close');

        // 5. Focus trap: handleKeydownTab
        const firstElement = { focusCalled: false, focus() { this.focusCalled = true; } };
        const lastElement = { focusCalled: false, focus() { this.focusCalled = true; } };
        approveState.dialogRef.value = {
          querySelectorAll: () => [firstElement, lastElement],
        };

        // Tab ngược (Shift + Tab) từ phần tử đầu tiên -> vòng về phần tử cuối
        let prevented = false;
        globalThis.document = { activeElement: firstElement };
        approveState.handleKeydownTab({
          shiftKey: true,
          preventDefault: () => { prevented = true; },
        });
        assert.equal(lastElement.focusCalled, true);
        assert.equal(prevented, true);

        // Tab xuôi (không Shift) từ phần tử cuối -> vòng về phần tử đầu
        prevented = false;
        globalThis.document = { activeElement: lastElement };
        approveState.handleKeydownTab({
          shiftKey: false,
          preventDefault: () => { prevented = true; },
        });
        assert.equal(firstElement.focusCalled, true);
        assert.equal(prevented, true);

        // Tab khi không có phần tử nào focus được (ví dụ lúc isSubmitting disable toàn bộ)
        prevented = false;
        approveState.dialogRef.value = { querySelectorAll: () => [] };
        approveState.handleKeydownTab({
          shiftKey: false,
          preventDefault: () => { prevented = true; },
        });
        assert.equal(prevented, true, 'Phải preventDefault khi !focusable.length để không thoát modal');
      } finally {
        delete globalThis.document;
        if (fs.existsSync(tmpScriptFile)) {
          fs.unlinkSync(tmpScriptFile);
        }
      }
    });

    it('AdminTopupActionModal lắng nghe sự kiện phím Esc (@keydown.esc) và Tab (@keydown.tab)', () => {
      assert.match(rawModalVue, /@keydown\.esc="handleClose"/);
      assert.match(rawModalVue, /@keydown\.tab="handleKeydownTab"/);
    });
  });

  describe('Page pages/admin/topups.vue (Role Guard & Table/Card Render)', () => {
    const rawPageVue = fs.readFileSync(
      path.join(webRoot, 'pages/admin/topups.vue'),
      'utf8',
    );

    it('trang tuân thủ vùng chạm >= 48px, không emoji và hỗ trợ màn hình chuẩn 360px', () => {
      // Vùng chạm tối thiểu 48px
      const touchMatches = rawPageVue.match(/min-h-\[48px\]\s+min-w-\[48px\]/g);
      assert.ok(
        touchMatches && touchMatches.length >= 6,
        'Các nút tương tác trên trang admin topups phải có vùng chạm >= 48px',
      );

      // Tuyệt đối không dùng emoji UTF-8 trong UI chrome
      const emojiRegex =
        /[\u{1F300}-\u{1F5FF}\u{1F600}-\u{1F64F}\u{1F680}-\u{1F6FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/u;
      assert.equal(
        emojiRegex.test(rawPageVue),
        false,
        'Trang admin topups không được chứa emoji trong UI chrome',
      );

      // Có cấu trúc bảng cho desktop và danh sách thẻ 1 cột cho mobile
      assert.match(rawPageVue, /data-testid="admin-topup-row"/);
      assert.match(rawPageVue, /data-testid="admin-topup-card"/);
    });

    async function compileAndRenderPage(setupData) {
      const { descriptor } = parse(rawPageVue);
      const compiled = compileTemplate({
        id: `test-admin-page-${Date.now()}`,
        filename: 'pages/admin/topups.vue',
        source: descriptor.template.content,
        ssr: true,
        ssrCssVars: [],
      });
      assert.equal(
        compiled.errors.length,
        0,
        `Template pages/admin/topups.vue lỗi: ${compiled.errors.join('; ')}`,
      );

      const tmpFile = path.join(
        webRoot,
        'test',
        `.tmp-admin-page-${Date.now()}-${Math.random().toString(36).slice(2)}.mjs`,
      );
      fs.writeFileSync(tmpFile, compiled.code, 'utf8');

      try {
        const { ssrRender } = await import(pathToFileURL(tmpFile).href);
        const app = createSSRApp({
          ssrRender,
          setup() {
            return {
              formatVndVi,
              formatNumberVi,
              formatTopupTimestampVi,
              getTopupStatusBadgeClass,
              getTopupStatusLabelVi,
              filterTabs: [
                { id: 'pending', labelVi: 'Chờ duyệt' },
                { id: 'needs_review', labelVi: 'Cần xem xét' },
                { id: 'expired', labelVi: 'Đã hết hạn' },
                { id: 'approved', labelVi: 'Đã duyệt' },
                { id: 'rejected', labelVi: 'Bị từ chối' },
                { id: 'all', labelVi: 'Tất cả' },
              ],
              isOverdue: isOverdue,
              isModalOpen: false,
              activeTopup: null,
              currentActionType: null,
              modalErrorVi: null,
              pageNotificationVi: null,
              isLoading: false,
              isLoadingMore: false,
              isActionLoading: false,
              errorVi: null,
              loadMoreErrorVi: null,
              actionErrorVi: null,
              hasMore: false,
              statusFilter: 'pending',
              stats: { pending: 1, overdue: 1, needsReview: 1, resolved: 1 },
              topups: [],
              isMePending: false,
              closeModal: () => {},
              handleModalConfirm: () => {},
              fetchTopups: () => {},
              loadMore: () => {},
              setStatusFilter: () => {},
              openActionModal: () => {},
              handleReturnToPending: () => {},
              ...setupData,
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
          ssrRender(_ctx, _push, _parent, _attrs, setAttrs, slots) {
            _push(`<a href="${_ctx.to}">`);
            slots.default?.();
            _push('</a>');
          },
        });
        app.component('AdminTopupActionModal', {
          props: ['open'],
          ssrRender() {},
        });
        return await renderToString(app);
      } finally {
        if (fs.existsSync(tmpFile)) {
          fs.unlinkSync(tmpFile);
        }
      }
    }

    it('người dùng role user hoặc khách chưa đăng nhập nhận màn hình 403 Forbidden, không để lộ dữ liệu', async () => {
      const htmlUser = await compileAndRenderPage({
        isAdmin: false,
        topups: [MOCK_ADMIN_TOPUPS_BY_STATUS.pending], // giả định có dữ liệu lọt vào
      });

      assert.match(htmlUser, /data-testid="admin-forbidden-state"/);
      assert.match(htmlUser, /403 — TRUY CẬP BỊ TỪ CHỐI/);
      assert.match(htmlUser, /data-testid="admin-forbidden-login-button"/);
      assert.match(htmlUser, /Đăng nhập/);
      assert.equal(
        htmlUser.includes('P4N8T2WD'),
        false,
        'Tuyệt đối không để lộ mã đơn nạp hay bất kỳ dữ liệu nào khi bị 403',
      );
      assert.equal(
        htmlUser.includes('NAP P4N8T2WD'),
        false,
      );
    });

    it('Admin mở trang: hiển thị danh sách đơn, nhãn QUÁ HẠN cho đơn overdue, và các nút action', async () => {
      const pendingOverdue = {
        ...MOCK_ADMIN_TOPUPS_BY_STATUS.pending,
        isOverdue: true,
      };
      const needsReviewItem = MOCK_ADMIN_TOPUPS_BY_STATUS.needs_review;
      const expiredItem = MOCK_ADMIN_TOPUPS_BY_STATUS.expired;

      const html = await compileAndRenderPage({
        isAdmin: true,
        topups: [pendingOverdue, needsReviewItem, expiredItem],
        stats: { pending: 1, overdue: 1, needsReview: 1, resolved: 0 },
      });

      assert.match(html, /DANH SÁCH ĐƠN NẠP VIETQR/);
      assert.match(html, /data-testid="filter-tab-pending"/);
      assert.match(html, /data-testid="filter-tab-needs_review"/);
      assert.match(html, /data-testid="overdue-badge"/);
      assert.match(html, /QUÁ HẠN/);

      // Thao tác trên pending
      assert.match(html, /data-testid="action-approve-button"/);
      assert.match(html, /data-testid="action-reject-button"/);
      assert.match(html, /data-testid="action-needs-review-button"/);

      // Thao tác trên needs_review
      assert.match(html, /data-testid="action-return-pending-button"/);

      // Thao tác trên expired
      assert.match(html, /data-testid="action-approve-expired-button"/);
    });

    it('hiển thị trạng thái rỗng khi không có đơn nạp phù hợp', async () => {
      const html = await compileAndRenderPage({
        isAdmin: true,
        topups: [],
        isLoading: false,
      });

      assert.match(html, /data-testid="admin-topups-empty-state"/);
      assert.match(html, /Không có đơn nạp nào phù hợp/);
    });

    it('hiển thị trạng thái lỗi và nút Thử lại khi tải dữ liệu thất bại', async () => {
      const html = await compileAndRenderPage({
        isAdmin: true,
        topups: [],
        errorVi: 'Lỗi kết nối máy chủ.',
      });

      assert.match(html, /data-testid="admin-topups-error-state"/);
      assert.match(html, /Lỗi kết nối máy chủ\./);
      assert.match(html, /Thử lại/);
    });

    it('người dùng đang trong trạng thái kiểm tra phiên đăng nhập (isMePending) hiển thị skeleton loading, không nhấp nháy 403', async () => {
      const html = await compileAndRenderPage({
        isMePending: true,
        isAdmin: false,
        topups: [],
      });

      assert.match(html, /data-testid="admin-auth-loading-state"/);
      assert.match(html, /Đang kiểm tra quyền quản trị viên\.\.\./);
      assert.doesNotMatch(html, /data-testid="admin-forbidden-state"/);
      assert.doesNotMatch(html, /403 — TRUY CẬP BỊ TỪ CHỐI/);
    });

    it('isOverdue chỉ hiển thị nhãn QUÁ HẠN cho đơn có trạng thái pending, không hiển thị trên đơn expired, approved hay awaiting_transfer', async () => {
      const overduePending = { ...MOCK_ADMIN_TOPUPS_BY_STATUS.pending, isOverdue: true };
      const overdueExpired = { ...MOCK_ADMIN_TOPUPS_BY_STATUS.expired, isOverdue: true };
      const overdueApproved = { ...MOCK_ADMIN_TOPUPS_BY_STATUS.approved, isOverdue: true };

      const html = await compileAndRenderPage({
        isAdmin: true,
        isMePending: false,
        topups: [overduePending, overdueExpired, overdueApproved],
        isOverdue: isOverdue,
      });

      // Chỉ xuất hiện đúng 2 badge QUÁ HẠN (1 trong hàng desktop của pending, 1 trong thẻ mobile của pending)
      const matches = html.match(/QUÁ HẠN/g) || [];
      assert.equal(matches.length, 2, 'QUÁ HẠN chỉ được xuất hiện trên đơn pending');
    });

    it('đơn nạp ở trạng thái awaiting_transfer hiển thị nhãn Chờ chuyển khoản ở cột thao tác desktop và thẻ mobile', async () => {
      const awaitingOrder = {
        ...MOCK_ADMIN_TOPUPS_BY_STATUS.pending,
        id: 'topup-awaiting-1',
        status: 'awaiting_transfer',
      };

      const html = await compileAndRenderPage({
        isAdmin: true,
        isMePending: false,
        topups: [awaitingOrder],
      });

      assert.match(html, /Chờ chuyển khoản/);
      assert.doesNotMatch(html, /Đã hoàn tất/);
    });

    it('phân trang cursor gặp lỗi hiển thị banner lỗi loadMoreErrorVi và nút Thử tải lại', async () => {
      const html = await compileAndRenderPage({
        isAdmin: true,
        isMePending: false,
        hasMore: true,
        loadMoreErrorVi: 'Không thể kết nối máy chủ để tải tiếp danh sách.',
        topups: [MOCK_ADMIN_TOPUPS_BY_STATUS.pending],
      });

      assert.match(html, /data-testid="load-more-error-banner"/);
      assert.match(html, /Không thể kết nối máy chủ để tải tiếp danh sách\./);
      assert.match(html, /Thử tải lại/);
    });

    it('sidebar admin.vue chứa mục điều hướng /admin/topups với icon lucide:receipt', () => {
      const rawLayoutAdmin = fs.readFileSync(
        path.join(webRoot, 'layouts/admin.vue'),
        'utf8',
      );
      assert.match(rawLayoutAdmin, /\/admin\/topups/);
      assert.match(rawLayoutAdmin, /Duyệt đơn VietQR/);
      assert.match(rawLayoutAdmin, /lucide:receipt/);
    });

    it('breadcrumb Admin là liên kết NuxtLink tới /admin và các banner thông báo có role alert/status', async () => {
      const html = await compileAndRenderPage({
        isAdmin: true,
        pageNotificationVi: 'Thông báo thành công!',
        loadMoreErrorVi: 'Lỗi tải thêm!',
        hasMore: true,
        topups: [MOCK_ADMIN_TOPUPS_BY_STATUS.pending],
      });

      assert.match(html, /href="\/admin"/);
      assert.match(html, /role="status"/);
      assert.match(html, /role="alert"/);
    });
  });

  describe('Helper isOverdue SLA logic', () => {
    it('chỉ trả true cho đơn status = pending khi isOverdue = true hoặc approveBy < now', () => {
      const now = 1794115000000;
      // Pending và isOverdue = true
      assert.equal(isOverdue({ status: 'pending', isOverdue: true }, now), true);
      // Pending và approveBy đã qua
      assert.equal(
        isOverdue({ status: 'pending', approveBy: new Date(now - 1000).toISOString() }, now),
        true,
      );
      // Pending nhưng approveBy còn trong tương lai
      assert.equal(
        isOverdue({ status: 'pending', approveBy: new Date(now + 10000).toISOString() }, now),
        false,
      );
      // Expired, approved, rejected không bao giờ quá hạn (ngay cả khi có approveBy cũ hoặc isOverdue = true)
      assert.equal(isOverdue({ status: 'expired', isOverdue: true }, now), false);
      assert.equal(isOverdue({ status: 'approved', isOverdue: true }, now), false);
      assert.equal(isOverdue({ status: 'rejected', isOverdue: true }, now), false);
      assert.equal(isOverdue({ status: 'awaiting_transfer', isOverdue: true }, now), false);
    });
  });

  describe('Layout layouts/admin.vue (HTML SSR Render & Navigation)', () => {
    const rawLayoutAdmin = fs.readFileSync(
      path.join(webRoot, 'layouts/admin.vue'),
      'utf8',
    );

    async function compileAndRenderLayout(currentPath = '/admin/topups') {
      const { descriptor } = parse(rawLayoutAdmin);
      const compiled = compileTemplate({
        id: `test-layout-admin-${Date.now()}`,
        filename: 'layouts/admin.vue',
        source: descriptor.template.content,
        ssr: true,
        ssrCssVars: [],
      });
      assert.equal(compiled.errors.length, 0);

      let code = compiled.code;
      code = code.replace(
        'const _component_NuxtLink = _resolveComponent("NuxtLink")',
        'const _component_NuxtLink = _ctx.NuxtLinkComponent || _resolveComponent("NuxtLink")',
      );
      code = code.replace(
        'const _component_Icon = _resolveComponent("Icon")',
        'const _component_Icon = _ctx.IconComponent || _resolveComponent("Icon")',
      );

      const tmpFile = path.join(
        webRoot,
        'test',
        `.tmp-layout-${Date.now()}-${Math.random().toString(36).slice(2)}.mjs`,
      );
      fs.writeFileSync(tmpFile, code, 'utf8');

      try {
        const { ssrRender } = await import(pathToFileURL(tmpFile).href);
        const app = createSSRApp({
          ssrRender,
          setup() {
            return {
              route: { path: currentPath },
              adminNavItems: [
                { to: '/admin', labelVi: 'Tổng quan vận hành', icon: 'lucide:activity' },
                { to: '/admin/topups', labelVi: 'Duyệt đơn VietQR', icon: 'lucide:receipt' },
                { to: '/pricing', labelVi: 'Cấu hình gói nạp', icon: 'lucide:credit-card' },
                { to: '/history', labelVi: 'Đối soát sổ cái', icon: 'lucide:database' },
                { to: '/', labelVi: 'Về Kho Công Cụ AI', icon: 'lucide:arrow-up-left' },
              ],
              IconComponent: {
                props: ['name'],
                ssrRender(_ctx, _push) {
                  _push(`<span class="mock-icon" data-icon="${_ctx.name}"></span>`);
                },
              },
              NuxtLinkComponent: {
                props: ['to'],
                ssrRender(_ctx, _push, _parent, _attrs) {
                  const cls = _attrs?.class || '';
                  _push(`<a href="${_ctx.to}" class="${cls}"><span class="nav-label">${_ctx.to}</span></a>`);
                },
              },
            };
          },
        });
        return await renderToString(app);
      } finally {
        if (fs.existsSync(tmpFile)) {
          fs.unlinkSync(tmpFile);
        }
      }
    }

    it('kết xuất HTML layout admin chuẩn phong cách Vercel: sidebar 220px, font monospace, header và link điều hướng', async () => {
      const html = await compileAndRenderLayout('/admin/topups');

      assert.match(html, /data-testid="layout-admin"/);
      assert.match(html, /data-testid="admin-left-sidebar"/);
      assert.match(html, /MOTION OPS/);
      assert.match(html, /v0\.1/);
      assert.match(html, /Bảng điều khiển quản trị viên/);
      assert.match(html, /2 Lane GPU • Sẵn sàng/);

      // Link /admin/topups đang active
      assert.match(
        html,
        /href="\/admin\/topups"[^>]*class="[^"]*border border-cyber-border bg-cyber-surface text-cyber-text[^"]*"/,
      );

      // Link /admin không active
      assert.match(
        html,
        /href="\/admin"[^>]*class="[^"]*text-cyber-muted hover:bg-cyber-surface\/50 hover:text-cyber-text[^"]*"/,
      );
    });

    it('khi chuyển route sang /admin, link /admin trở thành active và /admin/topups trở về trạng thái inactive', async () => {
      const html = await compileAndRenderLayout('/admin');

      // Link /admin đang active
      assert.match(
        html,
        /href="\/admin"[^>]*class="[^"]*border border-cyber-border bg-cyber-surface text-cyber-text[^"]*"/,
      );

      // Link /admin/topups không active
      assert.match(
        html,
        /href="\/admin\/topups"[^>]*class="[^"]*text-cyber-muted hover:bg-cyber-surface\/50 hover:text-cyber-text[^"]*"/,
      );
    });
  });
});
