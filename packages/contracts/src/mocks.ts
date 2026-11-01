import {
  TOS_VERSION,
  type AuthGoogleCallbackResponse,
  type AuthGoogleQuery,
  type AuthGoogleResponse,
  type AuthLogoutResponse,
  type AuthRefreshResponse,
} from './auth.js';
import {
  LEDGER_ENTRY_LABELS_VI,
  type LedgerEntry,
  type MeResponse,
  type PricingConfigResponse,
  type WalletLedgerResponse,
} from './wallet.js';

/**
 * Cấu hình bảng giá, Tier, Cap video, Priority và gói nạp chuẩn (AD-10, AD-11).
 */
export const DEFAULT_PRICING_CONFIG: PricingConfigResponse = {
  tierFloorCredits: 100,
  trialGrantCredits: 500,
  freeQueueTimeoutMinutes: 15,
  pipelines: {
    faceSwapCredits: 100,
    bodyRetouchCredits: 100,
    motionControlCreditsPerSecond: 50,
  },
  tiers: [
    {
      tier: 'FREE',
      packId: null,
      priceVnd: 0,
      credits: 500,
      maxVideoSeconds: 5,
      priority: 10,
    },
    {
      tier: 'Starter',
      packId: 'starter',
      priceVnd: 49_000,
      credits: 5_000,
      maxVideoSeconds: 10,
      priority: 3,
    },
    {
      tier: 'Pro',
      packId: 'pro',
      priceVnd: 99_000,
      credits: 12_000,
      maxVideoSeconds: 15,
      priority: 2,
    },
    {
      tier: 'Creator',
      packId: 'creator',
      priceVnd: 199_000,
      credits: 30_000,
      maxVideoSeconds: 20,
      priority: 1,
    },
  ],
  topupPacks: [
    {
      id: 'starter',
      tier: 'Starter',
      name: 'Starter',
      priceVnd: 49_000,
      credits: 5_000,
      maxVideoSeconds: 10,
      priority: 3,
    },
    {
      id: 'pro',
      tier: 'Pro',
      name: 'Pro',
      priceVnd: 99_000,
      credits: 12_000,
      maxVideoSeconds: 15,
      priority: 2,
    },
    {
      id: 'creator',
      tier: 'Creator',
      name: 'Creator',
      priceVnd: 199_000,
      credits: 30_000,
      maxVideoSeconds: 20,
      priority: 1,
    },
  ],
};

export const MOCK_PRICING_CONFIG_RESPONSE: PricingConfigResponse =
  DEFAULT_PRICING_CONFIG;

/**
 * Dữ liệu mock cho GET /me — Tài khoản dùng thử mới nhận 500 credit.
 */
export const MOCK_ME_RESPONSE: MeResponse = {
  id: '00000000-0000-4000-8000-000000000001',
  email: 'creator@motion.ai.vn',
  role: 'user',
  tier: 'FREE',
  balance: 500,
  held: 0,
  tosVersion: TOS_VERSION,
};

/**
 * Dữ liệu mock cho GET /me — Tài khoản đã hết credit (balance = 0) để kiểm thử trạng thái nhắc nạp.
 */
export const MOCK_ME_ZERO_BALANCE_RESPONSE: MeResponse = {
  id: '00000000-0000-4000-8000-000000000002',
  email: 'empty@motion.ai.vn',
  role: 'user',
  tier: 'FREE',
  balance: 0,
  held: 0,
  tosVersion: TOS_VERSION,
};

/**
 * Dữ liệu mock cho GET /me — Tài khoản trả phí hạng Pro đang có tác vụ giữ credit.
 * Khớp chính xác bất biến AD-2 với MOCK_WALLET_LEDGER_ITEMS:
 * balance = SUM(amount) = 500 + 12000 - 250 + 0 - 100 + 100 + 50 - 250 = 12050, held = 250.
 */
export const MOCK_ME_PRO_RESPONSE: MeResponse = {
  id: '00000000-0000-4000-8000-000000000003',
  email: 'pro@motion.ai.vn',
  role: 'user',
  tier: 'Pro',
  balance: 12_050,
  held: 250,
  tosVersion: TOS_VERSION,
};

/**
 * Danh sách bút toán sổ cái mock xếp mới nhất trước (createdAt giảm dần),
 * bao phủ đầy đủ 6 loại bút toán và quy tắc dấu AD-2.
 */
export const MOCK_WALLET_LEDGER_ITEMS: LedgerEntry[] = [
  {
    id: '10000000-0000-4000-8000-000000000008',
    userId: '00000000-0000-4000-8000-000000000003',
    type: 'HOLD',
    labelVi: LEDGER_ENTRY_LABELS_VI.HOLD,
    amount: -250,
    taskId: '20000000-0000-4000-8000-000000000003',
    topupId: null,
    pack: null,
    note: 'Tạm giữ credit cho tác vụ Motion Control đang xử lý (5 giây)',
    createdAt: '2026-11-01T10:45:00.000Z',
  },
  {
    id: '10000000-0000-4000-8000-000000000007',
    userId: '00000000-0000-4000-8000-000000000003',
    type: 'ADJUST',
    labelVi: LEDGER_ENTRY_LABELS_VI.ADJUST,
    amount: 50,
    taskId: null,
    topupId: null,
    pack: null,
    note: 'Hỗ trợ bù credit sự cố kết nối',
    createdAt: '2026-11-01T10:30:00.000Z',
  },
  {
    id: '10000000-0000-4000-8000-000000000006',
    userId: '00000000-0000-4000-8000-000000000003',
    type: 'RELEASED',
    labelVi: LEDGER_ENTRY_LABELS_VI.RELEASED,
    amount: 100,
    taskId: '20000000-0000-4000-8000-000000000002',
    topupId: null,
    pack: null,
    note: 'Hoàn trả 100% do không phát hiện khuôn mặt (NO_FACE)',
    createdAt: '2026-11-01T10:15:00.000Z',
  },
  {
    id: '10000000-0000-4000-8000-000000000005',
    userId: '00000000-0000-4000-8000-000000000003',
    type: 'HOLD',
    labelVi: LEDGER_ENTRY_LABELS_VI.HOLD,
    amount: -100,
    taskId: '20000000-0000-4000-8000-000000000002',
    topupId: null,
    pack: null,
    note: 'Tạm giữ credit cho tác vụ Face Swap',
    createdAt: '2026-11-01T10:12:00.000Z',
  },
  {
    id: '10000000-0000-4000-8000-000000000004',
    userId: '00000000-0000-4000-8000-000000000003',
    type: 'CAPTURED',
    labelVi: LEDGER_ENTRY_LABELS_VI.CAPTURED,
    amount: 0,
    taskId: '20000000-0000-4000-8000-000000000001',
    topupId: null,
    pack: null,
    note: 'Chốt credit sau khi hoàn tất Motion Control (5 giây)',
    createdAt: '2026-11-01T09:50:00.000Z',
  },
  {
    id: '10000000-0000-4000-8000-000000000003',
    userId: '00000000-0000-4000-8000-000000000003',
    type: 'HOLD',
    labelVi: LEDGER_ENTRY_LABELS_VI.HOLD,
    amount: -250,
    taskId: '20000000-0000-4000-8000-000000000001',
    topupId: null,
    pack: null,
    note: 'Tạm giữ credit cho tác vụ Motion Control (5 giây)',
    createdAt: '2026-11-01T09:45:00.000Z',
  },
  {
    id: '10000000-0000-4000-8000-000000000002',
    userId: '00000000-0000-4000-8000-000000000003',
    type: 'TOPUP',
    labelVi: LEDGER_ENTRY_LABELS_VI.TOPUP,
    amount: 12_000,
    taskId: null,
    topupId: '30000000-0000-4000-8000-000000000001',
    pack: 'pro',
    note: 'Nạp gói Pro (99.000đ)',
    createdAt: '2026-11-01T09:30:00.000Z',
  },
  {
    id: '10000000-0000-4000-8000-000000000001',
    userId: '00000000-0000-4000-8000-000000000003',
    type: 'GRANT',
    labelVi: LEDGER_ENTRY_LABELS_VI.GRANT,
    amount: 500,
    taskId: null,
    topupId: null,
    pack: null,
    note: 'Tặng 500 credit dùng thử khi đăng ký',
    createdAt: '2026-11-01T09:00:00.000Z',
  },
];

export const MOCK_WALLET_LEDGER_RESPONSE: WalletLedgerResponse = {
  items: MOCK_WALLET_LEDGER_ITEMS,
  page: 1,
  pageSize: 20,
  total: MOCK_WALLET_LEDGER_ITEMS.length,
  hasMore: false,
  nextCursor: null,
};

/**
 * Dữ liệu mock cho các endpoint xác thực Google OAuth & phiên JWT.
 */
export const MOCK_AUTH_GOOGLE_QUERY: AuthGoogleQuery = {
  tosVersion: TOS_VERSION,
  deviceId: 'fp_device_12345678',
};

export const MOCK_AUTH_GOOGLE_RESPONSE: AuthGoogleResponse = {
  redirectUrl:
    'https://accounts.google.com/o/oauth2/v2/auth?client_id=mock-client&response_type=code',
};

export const MOCK_AUTH_GOOGLE_CALLBACK_RESPONSE: AuthGoogleCallbackResponse = {
  accessToken: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.mock.access.token',
  tokenType: 'Bearer',
  expiresIn: 900,
  isNewUser: true,
  grantedCredits: 500,
};

export const MOCK_AUTH_REFRESH_RESPONSE: AuthRefreshResponse = {
  accessToken: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.mock.refreshed.token',
  tokenType: 'Bearer',
  expiresIn: 900,
};

export const MOCK_AUTH_LOGOUT_RESPONSE: AuthLogoutResponse = {
  success: true,
};
