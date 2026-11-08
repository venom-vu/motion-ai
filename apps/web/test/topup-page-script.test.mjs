import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { compileScript, parse } from '@vue/compiler-sfc';

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

describe('pages/pricing.vue: handleSelectPack mở QR trực tiếp hoặc dialog đăng nhập', () => {
  let dir;
  let comp;

  before(async () => {
    dir = fs.mkdtempSync(path.join(webRoot, 'test', '.tmp-pricing-page-'));
    comp = await loadSetup(
      'pages/pricing.vue',
      {
        '~/composables/useAuth': `export const useAuth = () => ({ isAuthenticated: globalThis.__pr.authed });`,
        '~/composables/useAuthDialog': `export const useAuthDialog = () => ({ open: (...a) => globalThis.__pr.calls.push(['openAuthDialog', ...a]) });`,
        '~/composables/usePricingConfig': `import { ref } from 'vue';
export const usePricingConfig = () => ({ pricing: ref(null), currentTier: ref('FREE'), isLoading: ref(false), errorMessageVi: ref(null), refreshAll: async () => {}, clearError: () => {} });`,
        '~/composables/useTopup': `import { ref } from 'vue';
export const useTopup = () => ({
  activeTopup: ref(null), isModalOpen: ref(false), isCreating: globalThis.__pr.isCreating, isConfirming: ref(false),
  createErrorVi: ref(null), confirmErrorVi: ref(null), remainingSeconds: ref(0), formattedCountdown: ref(''),
  isExpired: ref(false), isOutsideHours: ref(false), topups: ref([]), isLoadingList: ref(false), isLoadingMore: ref(false),
  listErrorVi: ref(null), hasMore: ref(false), openModal: (o) => globalThis.__pr.calls.push(['openModal', o]),
  closeModal: () => globalThis.__pr.calls.push(['closeModal']),
  createOrder: async (...a) => { globalThis.__pr.calls.push(['createOrder', ...a]); },
  confirmTransfer: async () => {}, fetchTopups: async () => { globalThis.__pr.calls.push(['fetchTopups']); }, loadMore: async () => {},
});`,
        '~/utils/catalog': `export const formatNumberVi = String; export const formatVndVi = String;`,
        '~/utils/topup': `export const formatTopupTimestampVi = String; export const getTopupStatusBadgeClass = () => ''; export const getTopupStatusLabelVi = String;`,
      },
      dir,
    );
  });

  after(() => {
    fs.rmSync(dir, { recursive: true, force: true });
    delete globalThis.__pr;
  });

  async function fresh({ authed = true, isCreating = false } = {}) {
    const { ref } = await import('vue');
    globalThis.__pr = {
      calls: [],
      authed: ref(authed),
      isCreating: ref(isCreating),
    };
    return comp.setup({}, { expose() {} });
  }
  const calls = () => globalThis.__pr.calls;

  it('chưa đăng nhập: ấn nạp gói mở dialog đăng nhập, không gọi createOrder', async () => {
    const s = await fresh({ authed: false });
    await s.handleSelectPack('pro');
    assert.deepEqual(calls(), [['openAuthDialog', 'login']]);
  });

  it('đã đăng nhập: ấn nạp gói gọi createOrder(packId) ngay để hiển thị mã QR', async () => {
    const s = await fresh({ authed: true });
    await s.handleSelectPack('creator');
    assert.deepEqual(calls(), [['createOrder', 'creator']]);
    assert.equal(s.creatingPackId.value, null);
  });

  it('đang tạo đơn (isCreating = true): chặn bấm trùng lặp', async () => {
    const s = await fresh({ authed: true, isCreating: true });
    await s.handleSelectPack('starter');
    assert.deepEqual(calls(), []);
  });

  it('handleRecreateOrder: đóng modal hiện tại và tạo lại mã QR mới cho gói tương ứng', async () => {
    const s = await fresh({ authed: true });
    await s.handleRecreateOrder('starter');
    assert.deepEqual(calls(), [['closeModal'], ['createOrder', 'starter']]);
  });
});
