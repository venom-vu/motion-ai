import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { compileScript, parse } from '@vue/compiler-sfc';
import { ApiErrorCode, getApiErrorMessageVi } from '@motion-ai/contracts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(webRoot, rel), 'utf8');

/** Biên dịch script setup của một SFC, thay import alias bằng module stub, rồi import thật. */
async function loadSetup(rel, stubs, dir) {
  const { descriptor } = parse(read(rel));
  let code = compileScript(descriptor, { id: `t-${rel}` }).content;
  for (const [spec, source] of Object.entries(stubs)) {
    const file = path.join(dir, `${spec.replace(/[^a-z0-9]/gi, '_')}.mjs`);
    fs.writeFileSync(file, source, 'utf8');
    const next = code.split(`'${spec}'`).join(JSON.stringify(pathToFileURL(file).href));
    assert.notEqual(next, code, `import ${spec} phải được thay (đổi import thì cập nhật test)`);
    code = next;
  }
  const tmp = path.join(webRoot, 'test', `.tmp-${path.basename(rel)}-${process.pid}.ts`);
  fs.writeFileSync(tmp, code, 'utf8');
  try {
    return (await import(pathToFileURL(tmp).href)).default;
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}

describe('pages/topup.vue: handleRecreateOrder và query ?pack=', () => {
  let dir;
  let comp;

  before(async () => {
    dir = fs.mkdtempSync(path.join(webRoot, 'test', '.tmp-topup-page-'));
    comp = await loadSetup(
      'pages/topup.vue',
      {
        '#imports': `import { reactive } from 'vue';
export const useHead = () => {};
export const useRoute = () => globalThis.__tp.route;`,
        '~/composables/useAuth': `import { ref } from 'vue'; export const useAuth = () => ({ isAuthenticated: globalThis.__tp.authed });`,
        '~/composables/useAuthDialog': `export const useAuthDialog = () => ({ open: (...a) => globalThis.__tp.calls.push(['openAuthDialog', ...a]) });`,
        '~/composables/usePricingConfig': `import { ref } from 'vue';
export const usePricingConfig = () => ({ pricing: ref(null), currentTier: ref(null), isLoading: ref(false), errorMessageVi: ref(null), refreshAll: async () => {} });`,
        '~/composables/useTopup': `import { ref } from 'vue';
export const useTopup = () => ({
  activeTopup: ref(null), isModalOpen: ref(false), isCreating: ref(false), isConfirming: ref(false),
  createErrorVi: globalThis.__tp.createErrorVi, confirmErrorVi: ref(null), remainingSeconds: ref(0), formattedCountdown: ref(''),
  isExpired: ref(false), isOutsideHours: ref(false), topups: ref([]), isLoadingList: ref(false), isLoadingMore: ref(false),
  listErrorVi: ref(null), hasMore: ref(false), openModal() {}, closeModal: () => globalThis.__tp.calls.push(['closeModal']),
  createOrder: async (...a) => { globalThis.__tp.calls.push(['createOrder', ...a]); },
  confirmTransfer: async () => {}, fetchTopups: async () => {}, loadMore: async () => {},
});`,
        '~/utils/catalog': `export const formatNumberVi = String; export const formatVndVi = String;`,
        '~/utils/topup': `const id = (x) => x;
export const formatTopupTimestampVi = String; export const getTopupStatusBadgeClass = () => '';
export const getTopupStatusLabelVi = String; export const isOverdue = () => false;
export const getRemainingSeconds = () => 0; export const isApprovalDeferred = () => false;
export const isOutsideWorkingHoursVn = () => false; export const OFF_HOURS_MESSAGE_VI = '';`,
      },
      dir,
    );
  });

  after(() => {
    fs.rmSync(dir, { recursive: true, force: true });
    delete globalThis.__tp;
  });

  async function fresh({ query = {}, authed = true } = {}) {
    const { ref } = await import('vue');
    globalThis.__tp = { calls: [], route: { query }, authed: ref(authed), createErrorVi: ref(null) };
    return comp.setup({}, { expose() {} });
  }
  const calls = () => globalThis.__tp.calls;

  it('đã tích ToS: "Tạo mã mới" đóng modal rồi tạo ngay đơn mới với đúng gói', async () => {
    const s = await fresh();
    s.consent.value = true;
    await s.handleRecreateOrder('creator');
    assert.deepEqual(calls(), [['closeModal'], ['createOrder', 'creator', true]]);
    assert.equal(s.selectedPack.value, 'creator');
  });

  it('chưa tích ToS: không tự tạo đơn, không tích hộ, và báo người dùng cần đồng ý ToS', async () => {
    const s = await fresh();
    s.consent.value = false;
    await s.handleRecreateOrder('starter');
    assert.deepEqual(calls(), [['closeModal']], 'không được gọi createOrder');
    assert.equal(s.consent.value, false, 'không được tự tích ToS thay người dùng');
    assert.equal(globalThis.__tp.createErrorVi.value, getApiErrorMessageVi(ApiErrorCode.CONSENT_REQUIRED));
  });

  it('?pack= hợp lệ chọn sẵn gói; giá trị lạ giữ mặc định', async () => {
    assert.equal((await fresh({ query: { pack: 'creator' } })).selectedPack.value, 'creator');
    assert.equal((await fresh({ query: { pack: 'starter' } })).selectedPack.value, 'starter');
    assert.equal((await fresh({ query: { pack: 'hack' } })).selectedPack.value, 'pro');
    assert.equal((await fresh({ query: {} })).selectedPack.value, 'pro');
  });

  it('handleCreateTopup: chưa đăng nhập mở dialog đăng nhập; chưa tích ToS thì không gọi API', async () => {
    let s = await fresh({ authed: false });
    s.consent.value = true;
    await s.handleCreateTopup();
    assert.deepEqual(calls(), [['openAuthDialog', 'login']]);

    s = await fresh({ authed: true });
    s.consent.value = false;
    await s.handleCreateTopup();
    assert.deepEqual(calls(), []);

    s = await fresh({ authed: true });
    s.consent.value = true;
    await s.handleCreateTopup();
    assert.deepEqual(calls(), [['createOrder', 'pro', true]]);
  });
});

describe('components/VietQRModal.vue: loadQrSvg không để QR cũ ghi đè QR mới', () => {
  let dir;
  let comp;

  before(async () => {
    dir = fs.mkdtempSync(path.join(webRoot, 'test', '.tmp-qr-modal-'));
    comp = await loadSetup(
      'components/VietQRModal.vue',
      {
        '~/utils/catalog': `export const formatNumberVi = String; export const formatVndVi = String;`,
        '~/utils/topup': `export const formatCountdown = String; export const getRemainingSeconds = () => 0;
export const getTopupStatusBadgeClass = () => ''; export const getTopupStatusLabelVi = String;
export const isApprovalDeferred = () => false; export const isQrExpired = () => false; export const OFF_HOURS_MESSAGE_VI = '';
export const generateQrSvg = (payload) => globalThis.__qr.gen(payload);`,
      },
      dir,
    );
  });

  after(() => {
    fs.rmSync(dir, { recursive: true, force: true });
    delete globalThis.__qr;
  });

  it('payload đổi nhanh: kết quả của payload cũ về muộn bị bỏ, QR hiển thị là của payload mới', async () => {
    const pending = new Map();
    globalThis.__qr = { gen: (payload) => new Promise((resolve) => pending.set(payload, resolve)) };
    const { reactive, nextTick } = await import('vue');
    const props = reactive({ open: true, topup: { qrPayload: 'OLD', status: 'awaiting_transfer' } });
    const s = comp.setup(props, { emit() {}, expose() {} });
    props.topup = { qrPayload: 'NEW', status: 'awaiting_transfer' };
    await nextTick();
    pending.get('NEW')('<svg>NEW</svg>');
    await new Promise((r) => setTimeout(r, 0));
    pending.get('OLD')('<svg>OLD</svg>');
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(s.qrSvg.value, '<svg>NEW</svg>');
  });
});
