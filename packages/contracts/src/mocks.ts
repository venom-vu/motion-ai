import {
  TOS_VERSION,
  type AuthGoogleCallbackResponse,
  type AuthGoogleQuery,
  type AuthGoogleResponse,
  type AuthLogoutResponse,
  type AuthRefreshResponse,
} from './auth.js';
import {
  motionPrice,
  type BodyRetouchCreateRequest,
  type MotionCreateRequest,
  type MotionCreateResponse,
  type ShareInfoResponse,
  FaceSwapCreateRequest,
  Task,
  TaskListResponse,
  TaskResultResponse,
  TaskShareResponse,
  TaskShareRevokeResponse,
  TaskStatus,
} from './tasks.js';
import type {
  AdminAdjustRequest,
  AdminTaskLookupResponse,
  AdminUser,
  AdminUserLedgerResponse,
  AdminUserSearchResponse,
} from './admin.js';
import type {
  AdminAuditResponse,
  AdminStatsResponse,
  OpsStatusResponse,
  SystemStatusResponse,
} from './ops.js';
import type {
  AdminTopup,
  AdminTopupListResponse,
  Topup,
  TopupListResponse,
  TopupStatus,
} from './topups.js';
import type {
  UploadConfirmVideoResponse,
  UploadConfirmResponse,
  UploadCreateRequest,
  UploadCreateResponse,
} from './uploads.js';
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
    motionControlMinSeconds: 3,
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
  pageSize: 20,
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

/* ---------------- Epic 2: tải lên, Task, kết quả, chia sẻ ---------------- */

const MOCK_USER_ID = '10000000-0000-4000-8000-000000000001';
const mockTaskBase = {
  pipeline: 'face_swap',
  creditCost: 100,
  createdAt: '2026-11-04T08:00:00.000Z',
  updatedAt: '2026-11-04T08:01:00.000Z',
} as const;

export const MOCK_UPLOAD_CREATE_REQUEST: UploadCreateRequest = {
  mimeType: 'image/jpeg',
  sizeBytes: 2 * 1024 * 1024,
};

export const MOCK_UPLOAD_CREATE_RESPONSE: UploadCreateResponse = {
  key: `in-raw/${MOCK_USER_ID}/60000000-0000-4000-8000-000000000001`,
  method: 'PUT',
  uploadUrl: 'https://uploads.example.test/in-raw/presigned',
  headers: { 'Content-Type': 'image/jpeg' },
  expiresAt: '2026-11-04T08:10:00.000Z',
};

export const MOCK_UPLOAD_CONFIRM_RESPONSE: UploadConfirmResponse = {
  key: `in/${MOCK_USER_ID}/60000000-0000-4000-8000-000000000001`,
  image: { mimeType: 'image/jpeg', sizeBytes: 2 * 1024 * 1024, width: 1024, height: 1280 },
};

export const MOCK_FACE_SWAP_CREATE_REQUEST: FaceSwapCreateRequest = {
  sourceKey: `in/${MOCK_USER_ID}/60000000-0000-4000-8000-000000000001`,
  targetKey: `in/${MOCK_USER_ID}/60000000-0000-4000-8000-000000000002`,
};

export const MOCK_TASK_QUEUED: Task = {
  ...mockTaskBase,
  id: '70000000-0000-4000-8000-000000000001',
  status: 'queued',
  queuePosition: 3,
};
export const MOCK_TASK_RUNNING: Task = {
  ...mockTaskBase,
  id: '70000000-0000-4000-8000-000000000002',
  status: 'running',
};
export const MOCK_TASK_SUCCEEDED: Task = {
  ...mockTaskBase,
  id: '70000000-0000-4000-8000-000000000003',
  status: 'succeeded',
  resultKey: `out/${MOCK_USER_ID}/80000000-0000-4000-8000-000000000003`,
};
export const MOCK_TASK_FAILED: Task = {
  ...mockTaskBase,
  id: '70000000-0000-4000-8000-000000000004',
  status: 'failed',
  reasonCode: 'NO_FACE',
};
export const MOCK_TASK_TIMED_OUT: Task = {
  ...mockTaskBase,
  id: '70000000-0000-4000-8000-000000000005',
  status: 'timed_out',
  reasonCode: 'FREE_WAIT_EXPIRED',
};
export const MOCK_TASK_CANCELLED: Task = {
  ...mockTaskBase,
  id: '70000000-0000-4000-8000-000000000006',
  status: 'cancelled',
  reasonCode: 'USER_CANCEL',
};

export const MOCK_TASKS_BY_STATUS: Record<TaskStatus, Task> = {
  queued: MOCK_TASK_QUEUED,
  running: MOCK_TASK_RUNNING,
  succeeded: MOCK_TASK_SUCCEEDED,
  failed: MOCK_TASK_FAILED,
  timed_out: MOCK_TASK_TIMED_OUT,
  cancelled: MOCK_TASK_CANCELLED,
};

export const MOCK_TASK_LIST_RESPONSE: TaskListResponse = {
  items: [
    MOCK_TASK_QUEUED,
    MOCK_TASK_RUNNING,
    MOCK_TASK_SUCCEEDED,
    MOCK_TASK_FAILED,
    MOCK_TASK_TIMED_OUT,
    MOCK_TASK_CANCELLED,
  ],
  pageSize: 20,
  hasMore: false,
  nextCursor: null,
};

export const MOCK_TASK_RESULT_RESPONSE: TaskResultResponse = {
  mediaType: 'image',
  resultUrl: 'https://cdn.example.test/out/signed-result.jpg',
  sourceUrl: 'https://cdn.example.test/in/signed-source.jpg',
};
export const MOCK_TASK_RESULT_EXPIRED_SOURCE_RESPONSE: TaskResultResponse = {
  mediaType: 'image',
  resultUrl: 'https://cdn.example.test/out/signed-result.jpg',
  sourceUrl: null,
};

export const MOCK_TASK_SHARE_RESPONSE: TaskShareResponse = {
  token: 'mock-share-token-0123456789abcdef',
  shareUrl: 'https://motion.example.test/s/mock-share-token-0123456789abcdef',
};
export const MOCK_TASK_SHARE_REVOKE_RESPONSE: TaskShareRevokeResponse = {
  revoked: true,
};

/* ------------------------- Epic 4: Body Retouch ------------------------- */

export const MOCK_BODY_RETOUCH_CREATE_REQUEST: BodyRetouchCreateRequest = {
  imageKey: `in/${MOCK_USER_ID}/60000000-0000-4000-8000-000000000001`,
  intensity: 8,
};

const mockBodyRetouchBase = { ...mockTaskBase, pipeline: 'body_retouch' } as const;

export const MOCK_BODY_RETOUCH_TASK_QUEUED: Task = {
  ...mockBodyRetouchBase,
  id: '71000000-0000-4000-8000-000000000001',
  status: 'queued',
  queuePosition: 2,
};
export const MOCK_BODY_RETOUCH_TASK_RUNNING: Task = {
  ...mockBodyRetouchBase,
  id: '71000000-0000-4000-8000-000000000002',
  status: 'running',
};
export const MOCK_BODY_RETOUCH_TASK_SUCCEEDED: Task = {
  ...mockBodyRetouchBase,
  id: '71000000-0000-4000-8000-000000000003',
  status: 'succeeded',
  resultKey: `out/${MOCK_USER_ID}/81000000-0000-4000-8000-000000000003`,
};
export const MOCK_BODY_RETOUCH_TASK_FAILED: Task = {
  ...mockBodyRetouchBase,
  id: '71000000-0000-4000-8000-000000000004',
  status: 'failed',
  reasonCode: 'NO_POSE',
};
export const MOCK_BODY_RETOUCH_TASK_TIMED_OUT: Task = {
  ...mockBodyRetouchBase,
  id: '71000000-0000-4000-8000-000000000005',
  status: 'timed_out',
  reasonCode: 'FREE_WAIT_EXPIRED',
};
export const MOCK_BODY_RETOUCH_TASK_CANCELLED: Task = {
  ...mockBodyRetouchBase,
  id: '71000000-0000-4000-8000-000000000006',
  status: 'cancelled',
  reasonCode: 'USER_CANCEL',
};

export const MOCK_BODY_RETOUCH_TASKS_BY_STATUS: Record<TaskStatus, Task> = {
  queued: MOCK_BODY_RETOUCH_TASK_QUEUED,
  running: MOCK_BODY_RETOUCH_TASK_RUNNING,
  succeeded: MOCK_BODY_RETOUCH_TASK_SUCCEEDED,
  failed: MOCK_BODY_RETOUCH_TASK_FAILED,
  timed_out: MOCK_BODY_RETOUCH_TASK_TIMED_OUT,
  cancelled: MOCK_BODY_RETOUCH_TASK_CANCELLED,
};

/** Kết quả Body Retouch có ảnh gốc (so sánh trước/sau). */
export const MOCK_BODY_RETOUCH_RESULT_RESPONSE: TaskResultResponse = {
  mediaType: 'image',
  resultUrl: 'https://cdn.example.test/out/signed-body-retouch-result.jpg',
  sourceUrl: 'https://cdn.example.test/in/signed-body-retouch-source.jpg',
};

/* ------------------------- Epic 5: Motion Control ------------------------- */

export const MOCK_MOTION_CREATE_REQUEST: MotionCreateRequest = {
  characterKey: `in/${MOCK_USER_ID}/60000000-0000-4000-8000-000000000001`,
  videoKey: `in/${MOCK_USER_ID}/60000000-0000-4000-8000-000000000003`,
  trimStart: 2,
  trimEnd: 7,
};

export const MOCK_UPLOAD_VIDEO_CONFIRM_RESPONSE: UploadConfirmVideoResponse = {
  key: `in/${MOCK_USER_ID}/60000000-0000-4000-8000-000000000003`,
  video: {
    mimeType: 'video/mp4',
    sizeBytes: 12 * 1024 * 1024,
    durationSeconds: 12.5,
    width: 720,
    height: 1280,
  },
};

const mockMotionBase = {
  ...mockTaskBase,
  pipeline: 'motion_control',
  creditCost: motionPrice(5),
  price: motionPrice(5),
} as const;

export const MOCK_MOTION_TASK_QUEUED: MotionCreateResponse = {
  ...mockMotionBase,
  id: '72000000-0000-4000-8000-000000000001',
  status: 'queued',
  queuePosition: 1,
};
export const MOCK_MOTION_TASK_RUNNING: MotionCreateResponse = {
  ...mockMotionBase,
  id: '72000000-0000-4000-8000-000000000002',
  status: 'running',
};
export const MOCK_MOTION_TASK_SUCCEEDED: MotionCreateResponse = {
  ...mockMotionBase,
  id: '72000000-0000-4000-8000-000000000003',
  status: 'succeeded',
  resultKey: `out/${MOCK_USER_ID}/82000000-0000-4000-8000-000000000003`,
};
export const MOCK_MOTION_TASK_FAILED: MotionCreateResponse = {
  ...mockMotionBase,
  id: '72000000-0000-4000-8000-000000000004',
  status: 'failed',
  reasonCode: 'NO_POSE',
};
export const MOCK_MOTION_TASK_TIMED_OUT: MotionCreateResponse = {
  ...mockMotionBase,
  id: '72000000-0000-4000-8000-000000000005',
  status: 'timed_out',
  reasonCode: 'PREP_TIMEOUT',
};
export const MOCK_MOTION_TASK_CANCELLED: MotionCreateResponse = {
  ...mockMotionBase,
  id: '72000000-0000-4000-8000-000000000006',
  status: 'cancelled',
  reasonCode: 'USER_CANCEL',
};

export const MOCK_MOTION_TASKS_BY_STATUS: Record<TaskStatus, MotionCreateResponse> = {
  queued: MOCK_MOTION_TASK_QUEUED,
  running: MOCK_MOTION_TASK_RUNNING,
  succeeded: MOCK_MOTION_TASK_SUCCEEDED,
  failed: MOCK_MOTION_TASK_FAILED,
  timed_out: MOCK_MOTION_TASK_TIMED_OUT,
  cancelled: MOCK_MOTION_TASK_CANCELLED,
};

/** Kết quả video Motion: không có `sourceUrl` (video mẫu không lộ). */
export const MOCK_MOTION_RESULT_RESPONSE: TaskResultResponse = {
  mediaType: 'video',
  resultUrl: 'https://cdn.example.test/out/signed-motion-result.mp4',
  sourceUrl: null,
  posterUrl: 'https://cdn.example.test/out/signed-motion-poster.jpg',
  durationSeconds: 5,
};

export const MOCK_SHARE_INFO_VIDEO_RESPONSE: ShareInfoResponse = {
  mediaType: 'video',
  durationSeconds: 5,
};
export const MOCK_SHARE_INFO_IMAGE_RESPONSE: ShareInfoResponse = { mediaType: 'image' };

/* ------------------------- Epic 3: nạp tiền ------------------------- */

const MOCK_TOPUP_BASE = {
  pack: 'pro',
  amountVnd: 99_000,
  credits: 12_000,
  bankCode: '970436',
  accountNumber: '0123456789',
  accountName: 'CONG TY FLOWVIS',
  qrExpiresAt: '2026-11-07T03:15:00.000Z',
  createdAt: '2026-11-07T03:00:00.000Z',
  updatedAt: '2026-11-07T03:00:00.000Z',
} as const;

/** Mỗi đơn mock có `code` riêng để FE không gặp trùng khóa; CRC của `qrPayload` là giá trị giả. */
function mockTopupIdentity(code: string) {
  return {
    code,
    transferContent: `NAP ${code}`,
    qrPayload: `00020101021238540010A00000072701240006970436011001234567890208QRIBFTTA530370454060990005802VN62110807NAP${code}6304ABCD`,
  };
}

export const MOCK_TOPUPS_BY_STATUS: Record<TopupStatus, Topup> = {
  awaiting_transfer: {
    ...MOCK_TOPUP_BASE,
    ...mockTopupIdentity('K7M2Q9XA'),
    id: '00000000-0000-4000-8000-0000000000a1',
    status: 'awaiting_transfer',
  },
  pending: {
    ...MOCK_TOPUP_BASE,
    ...mockTopupIdentity('P4N8T2WD'),
    id: '00000000-0000-4000-8000-0000000000a2',
    status: 'pending',
    approveBy: '2026-11-07T03:30:00.000Z',
  },
  approved: {
    ...MOCK_TOPUP_BASE,
    ...mockTopupIdentity('H3J6R5ZC'),
    id: '00000000-0000-4000-8000-0000000000a3',
    status: 'approved',
    approveBy: '2026-11-07T03:30:00.000Z',
    bankRef: 'FT26311000123',
  },
  rejected: {
    ...MOCK_TOPUP_BASE,
    ...mockTopupIdentity('M9X2B7LE'),
    id: '00000000-0000-4000-8000-0000000000a4',
    status: 'rejected',
    approveBy: '2026-11-07T03:30:00.000Z',
    rejectReason: 'Không tìm thấy giao dịch tương ứng trên sao kê ngân hàng.',
  },
  needs_review: {
    ...MOCK_TOPUP_BASE,
    ...mockTopupIdentity('Q5V8D3KF'),
    id: '00000000-0000-4000-8000-0000000000a5',
    status: 'needs_review',
    approveBy: '2026-11-07T03:30:00.000Z',
    note: 'Số tiền chuyển lệch so với đơn, đang chờ đối chiếu.',
  },
  expired: {
    ...MOCK_TOPUP_BASE,
    ...mockTopupIdentity('T2C6Y4NG'),
    id: '00000000-0000-4000-8000-0000000000a6',
    status: 'expired',
  },
};

export const MOCK_TOPUP_LIST_RESPONSE: TopupListResponse = {
  items: [
    MOCK_TOPUPS_BY_STATUS.pending,
    MOCK_TOPUPS_BY_STATUS.awaiting_transfer,
    MOCK_TOPUPS_BY_STATUS.approved,
  ],
  pageSize: 20,
  hasMore: false,
  nextCursor: null,
};

const MOCK_ADMIN_USER_ID = '00000000-0000-4000-8000-0000000000b1';

export const MOCK_ADMIN_TOPUPS_BY_STATUS: Record<TopupStatus, AdminTopup> = Object.fromEntries(
  (Object.keys(MOCK_TOPUPS_BY_STATUS) as TopupStatus[]).map((status) => [
    status,
    {
      ...MOCK_TOPUPS_BY_STATUS[status],
      userId: MOCK_ADMIN_USER_ID,
      isOverdue: status === 'pending',
    },
  ]),
) as Record<TopupStatus, AdminTopup>;

export const MOCK_ADMIN_TOPUP_LIST_RESPONSE: AdminTopupListResponse = {
  items: [
    MOCK_ADMIN_TOPUPS_BY_STATUS.pending,
    MOCK_ADMIN_TOPUPS_BY_STATUS.needs_review,
    MOCK_ADMIN_TOPUPS_BY_STATUS.expired,
  ],
  pageSize: 20,
  hasMore: false,
  nextCursor: null,
};

/* ------------------------------ Epic 6 ------------------------------ */

export const MOCK_SYSTEM_STATUS_NORMAL: SystemStatusResponse = { intakePaused: false };
export const MOCK_SYSTEM_STATUS_PAUSED: SystemStatusResponse = { intakePaused: true };

export const MOCK_OPS_STATUS_NORMAL: OpsStatusResponse = {
  intakePaused: false,
  rhBudgetExhausted: false,
  lastBreakerTrigger: null,
  rhBalance: { coins: 52000, readAt: '2026-11-11T02:00:00.000Z' },
  lastBackup: { at: '2026-11-10T20:00:00.000Z', result: 'success', sizeBytes: 12582912 },
};

export const MOCK_OPS_STATUS_PAUSED: OpsStatusResponse = {
  ...MOCK_OPS_STATUS_NORMAL,
  intakePaused: true,
  lastBreakerTrigger: {
    at: '2026-11-11T01:30:00.000Z',
    rule: 'ERROR_RATE_15_PERCENT_20_TASKS_30_MIN',
    metrics: { eligibleTasks: 24, systemFailures: 5, errorRate: 0.208 },
  },
};

export const MOCK_OPS_STATUS_BUDGET_EXHAUSTED: OpsStatusResponse = {
  ...MOCK_OPS_STATUS_NORMAL,
  intakePaused: true,
  rhBudgetExhausted: true,
  rhBalance: { coins: 0, readAt: '2026-11-11T02:05:00.000Z' },
  lastBackup: { at: '2026-11-10T20:00:00.000Z', result: 'failed', sizeBytes: null },
};

export const MOCK_ADMIN_STATS_RESPONSE: AdminStatsResponse = {
  from: '2026-11-01T00:00:00.000Z',
  to: '2026-11-11T00:00:00.000Z',
  scope: 'real',
  pipelines: [
    {
      pipeline: 'face_swap',
      taskCounts: { queued: 0, running: 1, succeeded: 90, failed: 6, timed_out: 2, cancelled: 1 },
      successRate: 0.9,
      avgProcessingSeconds: 42.5,
      p95ProcessingSeconds: 88,
      avgGpuCoins: 20,
      wastedGpuCoins: 160,
      avgCostVnd: { retail: 1200, standardPack: 980 },
    },
    {
      pipeline: 'body_retouch',
      taskCounts: { queued: 0, running: 0, succeeded: 0, failed: 0, timed_out: 0, cancelled: 0 },
      successRate: null,
      avgProcessingSeconds: null,
      p95ProcessingSeconds: null,
      avgGpuCoins: null,
      wastedGpuCoins: 0,
      avgCostVnd: null,
    },
  ],
  margins: [
    {
      pipeline: 'face_swap',
      pack: 'starter',
      scenario: 'retail',
      revenueVnd: 980,
      costVnd: 1200,
      marginVnd: -220,
      marginRate: -0.2245,
    },
    {
      pipeline: 'face_swap',
      pack: 'creator',
      scenario: 'standardPack',
      revenueVnd: 663,
      costVnd: 980,
      marginVnd: -317,
      marginRate: -0.478,
    },
  ],
  successMetrics: { approvedTopups: 14, conversionRate: 0.12, gpuCostUsd: 18.4 },
};

const mockAdminUserId = '90000000-0000-4000-8000-000000000001';
const mockAdminId = '90000000-0000-4000-8000-0000000000aa';

export const MOCK_ADMIN_USER: AdminUser = {
  id: mockAdminUserId,
  email: 'user@example.com',
  role: 'user',
  tier: 'Starter',
  balance: 4200,
  held: 100,
  lockedAt: null,
  createdAt: '2026-10-20T08:00:00.000Z',
};

export const MOCK_ADMIN_USER_LOCKED: AdminUser = {
  ...MOCK_ADMIN_USER,
  lockedAt: '2026-11-10T09:00:00.000Z',
};

export const MOCK_ADMIN_USER_SEARCH_RESPONSE: AdminUserSearchResponse = MOCK_ADMIN_USER;

export const MOCK_ADMIN_USER_LEDGER_RESPONSE: AdminUserLedgerResponse = {
  items: [
    {
      id: '90000000-0000-4000-8000-000000000011',
      userId: mockAdminUserId,
      type: 'ADJUST',
      labelVi: LEDGER_ENTRY_LABELS_VI.ADJUST,
      amount: 300,
      note: 'Bù credit do lỗi hệ thống',
      createdAt: '2026-11-10T10:00:00.000Z',
    },
  ],
  pageSize: 20,
  hasMore: false,
  nextCursor: null,
};

export const MOCK_ADMIN_ADJUST_REQUEST: AdminAdjustRequest = {
  amount: 300,
  reason: 'Bù credit do lỗi hệ thống',
  requestId: '90000000-0000-4000-8000-0000000000c1',
};

export const MOCK_ADMIN_TASK_LOOKUP_RESPONSE: AdminTaskLookupResponse = {
  id: '70000000-0000-4000-8000-000000000003',
  userId: mockAdminUserId,
  userEmail: 'user@example.com',
  pipeline: 'face_swap',
  status: 'succeeded',
  creditCost: 100,
  filesRemovedAt: null,
  createdAt: '2026-11-10T08:00:00.000Z',
};

export const MOCK_ADMIN_AUDIT_RESPONSE: AdminAuditResponse = {
  items: [
    {
      id: '90000000-0000-4000-8000-000000000021',
      adminId: mockAdminId,
      action: 'ADJUST',
      target: `user:${mockAdminUserId}`,
      reason: 'Bù credit do lỗi hệ thống',
      requestId: '90000000-0000-4000-8000-0000000000c1',
      createdAt: '2026-11-10T10:00:00.000Z',
    },
  ],
  pageSize: 20,
  hasMore: false,
  nextCursor: null,
};
