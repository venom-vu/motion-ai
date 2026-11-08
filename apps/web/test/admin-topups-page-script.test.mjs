import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { compileScript, parse } from '@vue/compiler-sfc';
import { ApiErrorCode } from '@motion-ai/contracts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(__dirname, '..');
const pageSource = fs.readFileSync(path.join(webRoot, 'pages/admin/topups.vue'), 'utf8');

/**
 * Chạy thật script setup của pages/admin/topups.vue. Chỉ các phụ thuộc Nuxt/composable bị thay bằng stub
 * (ghi lại lời gọi vào globalThis.__adm); logic handleModalConfirm / handleReturnToPending là mã thật.
 */
describe('pages/admin/topups.vue: script setup nối nút bấm tới thao tác duyệt', () => {
  let dir;
  let setup;
  let MotionApiClientError;

  const calls = () => globalThis.__adm.calls;
  const fresh = (opts = {}) => {
    globalThis.__adm = { calls: [], reject: null, ...opts };
    return setup({}, { expose() {} });
  };

  before(async () => {
    dir = fs.mkdtempSync(path.join(webRoot, 'test', '.tmp-adm-page-'));
    const w = (name, code) => fs.writeFileSync(path.join(dir, name), code, 'utf8');

    w('imports.mjs', `export const definePageMeta = () => {};
import { ref } from 'vue';
export const useAsyncData = () => ({ status: ref('success'), pending: ref(false), data: ref({ role: 'admin' }) });`);
    w('use-api-client.mjs', `export const ME_KEY = 'me'; export const useApiClient = () => ({ client: { getMe: async () => ({ role: 'admin' }) } });`);
    w('use-auth-dialog.mjs', `export const useAuthDialog = () => ({ open() {} });`);
    w('modal.mjs', `export default {};`);
    w('catalog.mjs', `export const formatNumberVi = String; export const formatVndVi = String;`);
    w('api-client.mjs', `export { MotionApiClientError, resolveApiErrorMessageVi } from ${JSON.stringify(pathToFileURL(path.join(webRoot, 'utils/api-client.ts')).href)};`);
    w('topup-utils.mjs', `export const formatTopupTimestampVi = String; export const getTopupStatusBadgeClass = () => ''; export const getTopupStatusLabelVi = String; export const isOverdue = () => false;`);
    w('use-admin-topups.mjs', `import { ref } from 'vue';
const rec = (name) => async (...args) => {
  const s = globalThis.__adm; s.calls.push([name, ...args]);
  if (s.reject && s.reject.name === name) throw s.reject.error;
};
export const useAdminTopups = () => ({
  statusFilter: ref('pending'), topups: ref([]), isLoading: ref(false), isLoadingMore: ref(false),
  isActionLoading: ref(false), errorVi: ref(null), loadMoreErrorVi: ref(null), hasMore: ref(false),
  fetchTopups: rec('fetchTopups'), loadMore: rec('loadMore'), setStatusFilter: rec('setStatusFilter'),
  approveTopup: rec('approveTopup'), approveExpiredTopup: rec('approveExpiredTopup'),
  rejectTopup: rec('rejectTopup'), markNeedsReview: rec('markNeedsReview'), returnToPending: rec('returnToPending'),
});`);

    const { descriptor } = parse(pageSource);
    let code = compileScript(descriptor, { id: 'adm-page-test' }).content;
    const map = {
      '#imports': 'imports.mjs',
      '~/composables/useApiClient': 'use-api-client.mjs',
      '~/composables/useAdminTopups': 'use-admin-topups.mjs',
      '~/composables/useAuthDialog': 'use-auth-dialog.mjs',
      '~/components/AdminTopupActionModal.vue': 'modal.mjs',
      '~/utils/catalog': 'catalog.mjs',
      '~/utils/topup': 'topup-utils.mjs',
      '~/utils/api-client': 'api-client.mjs',
    };
    for (const [spec, file] of Object.entries(map)) {
      const before = code;
      code = code.split(`'${spec}'`).join(JSON.stringify(pathToFileURL(path.join(dir, file)).href));
      assert.notEqual(code, before, `import ${spec} phải được thay (trang đổi import thì test này cần cập nhật)`);
    }
    // File tạm nằm trong webRoot để import 'vue' và '@motion-ai/contracts' phân giải đúng.
    const tmp = path.join(webRoot, 'test', `.tmp-admin-page-${process.pid}.ts`);
    fs.writeFileSync(tmp, code, 'utf8');
    try {
      const mod = await import(pathToFileURL(tmp).href);
      setup = mod.default.setup;
    } finally {
      fs.rmSync(tmp, { force: true });
    }
    ({ MotionApiClientError } = await import(pathToFileURL(path.join(webRoot, 'utils/api-client.ts')).href));
  });

  after(() => {
    fs.rmSync(dir, { recursive: true, force: true });
    delete globalThis.__adm;
  });

  const PAY = { topupId: 't1' };

  it('approve gọi đúng approveTopup (không phải approve-expired) với bankRef đã cắt khoảng trắng, rồi đóng modal', async () => {
    const s = fresh();
    s.openActionModal({ id: 't1' }, 'approve');
    assert.equal(s.isModalOpen.value, true);
    await s.handleModalConfirm({ ...PAY, actionType: 'approve', bankRef: '  FT123  ' });
    assert.deepEqual(calls(), [['approveTopup', 't1', 'FT123']]);
    assert.equal(s.isModalOpen.value, false);
    assert.match(s.pageNotificationVi.value, /Duyệt đơn nạp thành công/);
  });

  it('approve-expired gọi đúng approveExpiredTopup, không gọi approveTopup', async () => {
    const s = fresh();
    s.openActionModal({ id: 't1' }, 'approve-expired');
    await s.handleModalConfirm({ ...PAY, actionType: 'approve-expired', bankRef: 'FT9' });
    assert.deepEqual(calls(), [['approveExpiredTopup', 't1', 'FT9']]);
    assert.equal(s.isModalOpen.value, false);
  });

  it('reject và needs-review đi đúng hàm, với lý do/ghi chú đã cắt khoảng trắng', async () => {
    let s = fresh();
    await s.handleModalConfirm({ ...PAY, actionType: 'reject', rejectReason: ' sai nội dung ' });
    assert.deepEqual(calls(), [['rejectTopup', 't1', 'sai nội dung']]);
    s = fresh();
    await s.handleModalConfirm({ ...PAY, actionType: 'needs-review', note: ' hỏi lại ' });
    assert.deepEqual(calls(), [['markNeedsReview', 't1', 'hỏi lại']]);
  });

  it('thiếu bankRef / lý do / ghi chú: không gọi API, modal giữ nguyên, hiện lỗi', async () => {
    for (const payload of [
      { actionType: 'approve', bankRef: '   ' },
      { actionType: 'approve-expired' },
      { actionType: 'reject', rejectReason: '' },
      { actionType: 'needs-review', note: '  ' },
    ]) {
      const s = fresh();
      s.openActionModal({ id: 't1' }, payload.actionType);
      await s.handleModalConfirm({ ...PAY, ...payload });
      assert.deepEqual(calls(), [], `không được gọi API cho ${payload.actionType}`);
      assert.equal(s.isModalOpen.value, true);
      assert.ok(s.modalErrorVi.value);
    }
  });

  it('actionType lạ: không gọi API', async () => {
    const s = fresh();
    await s.handleModalConfirm({ ...PAY, actionType: 'drop-table' });
    assert.deepEqual(calls(), []);
    assert.equal(s.modalErrorVi.value, 'Thao tác không hợp lệ.');
  });

  it('TOPUP_STATE_INVALID: đóng modal và báo đã làm mới; lỗi khác: giữ modal và hiện lỗi', async () => {
    let s = fresh({ reject: { name: 'approveTopup', error: new MotionApiClientError({ status: 409, code: ApiErrorCode.TOPUP_STATE_INVALID, serverMessage: 'x' }) } });
    s.openActionModal({ id: 't1' }, 'approve');
    await s.handleModalConfirm({ ...PAY, actionType: 'approve', bankRef: 'A' });
    assert.equal(s.isModalOpen.value, false);
    assert.match(s.pageNotificationVi.value, /tự động làm mới/);

    s = fresh({ reject: { name: 'approveTopup', error: new MotionApiClientError({ status: 409, code: ApiErrorCode.BANK_REF_DUPLICATE, serverMessage: 'x' }) } });
    s.openActionModal({ id: 't1' }, 'approve');
    await s.handleModalConfirm({ ...PAY, actionType: 'approve', bankRef: 'A' });
    assert.equal(s.isModalOpen.value, true, 'bank_ref trùng: modal phải ở lại để Admin sửa');
    assert.ok(s.modalErrorVi.value);
  });

  it('handleReturnToPending gọi returnToPending; lỗi trạng thái báo làm mới', async () => {
    let s = fresh();
    await s.handleReturnToPending({ id: 't7' });
    assert.deepEqual(calls(), [['returnToPending', 't7']]);
    assert.match(s.pageNotificationVi.value, /Chờ duyệt/);

    s = fresh({ reject: { name: 'returnToPending', error: new MotionApiClientError({ status: 409, code: ApiErrorCode.TOPUP_STATE_INVALID, serverMessage: 'x' }) } });
    await s.handleReturnToPending({ id: 't7' });
    assert.match(s.pageNotificationVi.value, /tự động làm mới/);
  });
});
