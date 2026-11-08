import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  API_ERROR_MESSAGES_VI,
  MAX_OPEN_TOPUPS,
  TopupConfirmTransferRequestSchema,
  ApiErrorCode,
  ApiErrorSchema,
  AuthGoogleCallbackQuerySchema,
  AuthGoogleCallbackResponseSchema,
  AuthGoogleQuerySchema,
  AuthGoogleResponseSchema,
  AuthLogoutRequestSchema,
  AuthLogoutResponseSchema,
  AuthRefreshRequestSchema,
  AuthRefreshResponseSchema,
  CONTRACTS_PACKAGE_VERSION,
  FaceSwapCreateRequestSchema,
  ConfirmedUploadKeySchema,
  RawUploadKeySchema,
  ImageMetaSchema,
  MOCK_FACE_SWAP_CREATE_REQUEST,
  MOCK_TASKS_BY_STATUS,
  MOCK_TASK_LIST_RESPONSE,
  MOCK_TASK_RESULT_EXPIRED_SOURCE_RESPONSE,
  MOCK_TASK_RESULT_RESPONSE,
  MOCK_TASK_SHARE_RESPONSE,
  MOCK_TASK_SHARE_REVOKE_RESPONSE,
  MOCK_UPLOAD_CONFIRM_RESPONSE,
  MOCK_UPLOAD_CREATE_REQUEST,
  MOCK_UPLOAD_CREATE_RESPONSE,
  REASON_CODES,
  ReasonCodeSchema,
  SharePublicParamsSchema,
  TASK_STATUSES,
  TaskListQuerySchema,
  TaskListResponseSchema,
  TaskResultResponseSchema,
  TaskSchema,
  TaskShareResponseSchema,
  TaskShareRevokeResponseSchema,
  UploadConfirmResponseSchema,
  UploadCreateRequestSchema,
  UploadCreateResponseSchema,
  getReasonCodeMessageVi,
  LEDGER_ENTRY_LABELS_VI,
  LedgerEntrySchema,
  MOCK_AUTH_GOOGLE_CALLBACK_RESPONSE,
  MOCK_AUTH_GOOGLE_QUERY,
  MOCK_AUTH_GOOGLE_RESPONSE,
  MOCK_AUTH_LOGOUT_RESPONSE,
  MOCK_AUTH_REFRESH_RESPONSE,
  MOCK_ME_PRO_RESPONSE,
  MOCK_ME_RESPONSE,
  MOCK_ME_ZERO_BALANCE_RESPONSE,
  MOCK_PRICING_CONFIG_RESPONSE,
  MOCK_WALLET_LEDGER_ITEMS,
  MOCK_WALLET_LEDGER_RESPONSE,
  MeRequestSchema,
  MeResponseSchema,
  PricingConfigRequestSchema,
  PricingConfigResponseSchema,
  TOS_VERSION,
  TierSnapshotSchema,
  WalletLedgerQuerySchema,
  WalletLedgerResponseSchema,
  getApiErrorMessageVi,
  getLedgerEntryLabelVi,
  AdminTopupApproveExpiredRequestSchema,
  AdminTopupApproveRequestSchema,
  AdminTopupListQuerySchema,
  AdminTopupListResponseSchema,
  AdminTopupNeedsReviewRequestSchema,
  AdminTopupRejectRequestSchema,
  AdminTopupReturnToPendingRequestSchema,
  AdminTopupSchema,
  MOCK_ADMIN_TOPUPS_BY_STATUS,
  MOCK_ADMIN_TOPUP_LIST_RESPONSE,
  MOCK_TOPUPS_BY_STATUS,
  MOCK_TOPUP_LIST_RESPONSE,
  TOPUP_PACK_IDS,
  TOPUP_STATUSES,
  TopupCreateRequestSchema,
  TopupIdParamsSchema,
  TopupListQuerySchema,
  TopupListResponseSchema,
  TopupSchema,
  TopupStatusSchema,
  getTopupStatusLabelVi,
} from '../dist/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe('@flowvis/contracts', () => {
  it('exports package version constant', () => {
    assert.equal(CONTRACTS_PACKAGE_VERSION, '0.1.0');
  });

  describe('ApiErrorCode & ApiErrorSchema (AC1)', () => {
    it('exports all 15 required ApiErrorCode values and fallback message for unknown codes', () => {
      const expectedCodes = [
        'PAUSED',
        'INSUFFICIENT_CREDIT',
        'TASK_LIMIT',
        'ACCOUNT_LOCKED',
        'CONSENT_REQUIRED',
        'VALIDATION_FAILED',
        'RATE_LIMITED',
        'EMAIL_LINKED_TO_OTHER_ACCOUNT',
        'NOT_FOUND',
        'FORBIDDEN',
        'CONFLICT',
        'TOPUP_LIMIT',
        'BANK_REF_DUPLICATE',
        'TOPUP_STATE_INVALID',
        'TOPUP_QR_EXPIRED',
      ];
      assert.deepEqual(Object.values(ApiErrorCode), expectedCodes);

      for (const code of expectedCodes) {
        assert.equal(typeof API_ERROR_MESSAGES_VI[code], 'string');
        assert.ok(API_ERROR_MESSAGES_VI[code].length > 0);
        assert.equal(getApiErrorMessageVi(code), API_ERROR_MESSAGES_VI[code]);
      }

      const fallbackMsg = 'Đã xảy ra lỗi không xác định. Vui lòng thử lại sau.';
      assert.equal(getApiErrorMessageVi('UNKNOWN_RUNTIME_CODE'), fallbackMsg);
      assert.equal(getApiErrorMessageVi(null), fallbackMsg);
      assert.equal(getApiErrorMessageVi(undefined), fallbackMsg);
    });

    it('validates standard API error object and rejects unknown error codes', () => {
      const validError = {
        code: ApiErrorCode.INSUFFICIENT_CREDIT,
        message: 'Số dư không đủ',
        details: { required: 150, balance: 100 },
      };
      const parsed = ApiErrorSchema.safeParse(validError);
      assert.equal(parsed.success, true);

      const withoutDetails = ApiErrorSchema.safeParse({
        code: ApiErrorCode.PAUSED,
        message: 'Tạm dừng bảo trì',
      });
      assert.equal(withoutDetails.success, true);

      const invalidCode = ApiErrorSchema.safeParse({
        code: 'UNKNOWN_ERROR_CODE',
        message: 'Lỗi lạ',
      });
      assert.equal(invalidCode.success, false);
    });
  });

  describe('TOS_VERSION & Auth contracts (AC2, AC3)', () => {
    it('exports a non-empty TOS_VERSION string constant', () => {
      assert.equal(typeof TOS_VERSION, 'string');
      assert.ok(TOS_VERSION.trim().length > 0);
    });

    it('validates GET /auth/google query and rejects missing or empty tosVersion / deviceId', () => {
      const valid = AuthGoogleQuerySchema.safeParse(MOCK_AUTH_GOOGLE_QUERY);
      assert.equal(valid.success, true);

      const emptyFields = AuthGoogleQuerySchema.safeParse({
        tosVersion: '',
        deviceId: '',
      });
      assert.equal(emptyFields.success, false);

      const whitespaceOnly = AuthGoogleQuerySchema.safeParse({
        tosVersion: '   ',
        deviceId: 'fp_123',
      });
      assert.equal(whitespaceOnly.success, false);

      const missingDeviceId = AuthGoogleQuerySchema.safeParse({
        tosVersion: TOS_VERSION,
      });
      assert.equal(missingDeviceId.success, false);
    });

    it('validates response and request schemas for Google callback, refresh, and logout', () => {
      assert.equal(
        AuthGoogleResponseSchema.safeParse(MOCK_AUTH_GOOGLE_RESPONSE).success,
        true,
      );
      assert.equal(
        AuthGoogleCallbackQuerySchema.safeParse({
          code: 'oauth_auth_code_123',
          state: 'csrf_state_token',
        }).success,
        true,
      );
      assert.equal(
        AuthGoogleCallbackResponseSchema.safeParse(
          MOCK_AUTH_GOOGLE_CALLBACK_RESPONSE,
        ).success,
        true,
      );
      assert.equal(AuthRefreshRequestSchema.safeParse({}).success, true);
      assert.equal(
        AuthRefreshResponseSchema.safeParse(MOCK_AUTH_REFRESH_RESPONSE).success,
        true,
      );
      assert.equal(AuthLogoutRequestSchema.safeParse({}).success, true);
      assert.equal(
        AuthLogoutResponseSchema.safeParse(MOCK_AUTH_LOGOUT_RESPONSE).success,
        true,
      );
    });
  });

  describe('Wallet, Ledger & Pricing contracts and Mocks (AC2, AC4)', () => {
    it('validates GET /me mock responses and rejects negative balance, negative held, or non-UUID id (AD-2)', () => {
      assert.equal(MeRequestSchema.safeParse({}).success, true);
      assert.equal(
        MeResponseSchema.safeParse(MOCK_ME_RESPONSE).success,
        true,
      );
      assert.equal(
        MeResponseSchema.safeParse(MOCK_ME_ZERO_BALANCE_RESPONSE).success,
        true,
      );
      assert.equal(
        MeResponseSchema.safeParse(MOCK_ME_PRO_RESPONSE).success,
        true,
      );

      const negativeBalance = MeResponseSchema.safeParse({
        ...MOCK_ME_RESPONSE,
        balance: -1,
      });
      assert.equal(negativeBalance.success, false);

      const negativeHeld = MeResponseSchema.safeParse({
        ...MOCK_ME_RESPONSE,
        held: -10,
      });
      assert.equal(negativeHeld.success, false);

      const nonUuidId = MeResponseSchema.safeParse({
        ...MOCK_ME_RESPONSE,
        id: 'not-a-uuid',
      });
      assert.equal(nonUuidId.success, false);
    });

    it('validates GET /wallet/ledger mock response, descending order, Vietnamese labels, AD-2 sign rules, and entity link rules', () => {
      const queryParsed = WalletLedgerQuerySchema.safeParse({
        pageSize: '20',
      });
      assert.equal(queryParsed.success, true);
      assert.equal(queryParsed.data.pageSize, 20);

      const ledgerParsed = WalletLedgerResponseSchema.safeParse(
        MOCK_WALLET_LEDGER_RESPONSE,
      );
      assert.equal(ledgerParsed.success, true);

      // Verify MOCK_ME_PRO_RESPONSE.balance === SUM(amount) and held === open HOLDs (AD-2)
      const sumAmount = MOCK_WALLET_LEDGER_ITEMS.reduce(
        (acc, item) => acc + item.amount,
        0,
      );
      assert.equal(MOCK_ME_PRO_RESPONSE.balance, sumAmount);

      const settledTaskIds = new Set(
        MOCK_WALLET_LEDGER_ITEMS.filter(
          (i) => i.type === 'CAPTURED' || i.type === 'RELEASED',
        ).map((i) => i.taskId),
      );
      const openHeld = MOCK_WALLET_LEDGER_ITEMS.filter(
        (i) => i.type === 'HOLD' && !settledTaskIds.has(i.taskId),
      ).reduce((acc, item) => acc + Math.abs(item.amount), 0);
      assert.equal(MOCK_ME_PRO_RESPONSE.held, openHeld);

      // Verify newest-first order in mock items
      for (let i = 1; i < MOCK_WALLET_LEDGER_ITEMS.length; i += 1) {
        const prev = Date.parse(MOCK_WALLET_LEDGER_ITEMS[i - 1].createdAt);
        const curr = Date.parse(MOCK_WALLET_LEDGER_ITEMS[i].createdAt);
        assert.ok(
          prev >= curr,
          `Expected item ${i - 1} (${MOCK_WALLET_LEDGER_ITEMS[i - 1].createdAt}) >= item ${i} (${MOCK_WALLET_LEDGER_ITEMS[i].createdAt})`,
        );
      }

      // Reject unsorted ledger items
      const unsortedLedger = WalletLedgerResponseSchema.safeParse({
        ...MOCK_WALLET_LEDGER_RESPONSE,
        items: [...MOCK_WALLET_LEDGER_ITEMS].reverse(),
      });
      assert.equal(unsortedLedger.success, false);

      // Verify Vietnamese label mappings
      assert.deepEqual(LEDGER_ENTRY_LABELS_VI, {
        GRANT: 'Tặng',
        TOPUP: 'Nạp',
        HOLD: 'Giữ',
        RELEASED: 'Hoàn',
        CAPTURED: 'Chốt',
        ADJUST: 'Điều chỉnh',
      });
      assert.equal(getLedgerEntryLabelVi('GRANT'), 'Tặng');

      const baseEntry = MOCK_WALLET_LEDGER_ITEMS[0]; // HOLD entry with valid taskId

      // Reject type-to-labelVi mismatch even when amount and links are valid
      assert.equal(
        LedgerEntrySchema.safeParse({
          ...baseEntry,
          type: 'HOLD',
          labelVi: 'Tặng',
          amount: -100,
        }).success,
        false,
      );

      // Accept negative ADJUST (e.g. amount: -50) when taskId/topupId/pack are null
      assert.equal(
        LedgerEntrySchema.safeParse({
          ...baseEntry,
          type: 'ADJUST',
          labelVi: 'Điều chỉnh',
          amount: -50,
          taskId: null,
          topupId: null,
          pack: null,
        }).success,
        true,
      );

      // Enforce AD-2 sign rules on LedgerEntrySchema
      assert.equal(
        LedgerEntrySchema.safeParse({
          ...baseEntry,
          type: 'HOLD',
          labelVi: 'Giữ',
          amount: 100, // Invalid: HOLD must be < 0
        }).success,
        false,
      );
      assert.equal(
        LedgerEntrySchema.safeParse({
          ...baseEntry,
          type: 'RELEASED',
          labelVi: 'Hoàn',
          amount: -100, // Invalid: RELEASED must be > 0
        }).success,
        false,
      );
      assert.equal(
        LedgerEntrySchema.safeParse({
          ...baseEntry,
          type: 'GRANT',
          labelVi: 'Tặng',
          amount: 0, // Invalid: GRANT must be > 0
          taskId: null,
        }).success,
        false,
      );
      assert.equal(
        LedgerEntrySchema.safeParse({
          ...baseEntry,
          type: 'TOPUP',
          labelVi: 'Nạp',
          amount: -5000, // Invalid: TOPUP must be > 0
          taskId: null,
          topupId: '30000000-0000-4000-8000-000000000001',
          pack: 'pro',
        }).success,
        false,
      );
      assert.equal(
        LedgerEntrySchema.safeParse({
          ...baseEntry,
          type: 'CAPTURED',
          labelVi: 'Chốt',
          amount: -100, // Invalid: CAPTURED must be === 0
        }).success,
        false,
      );
      assert.equal(
        LedgerEntrySchema.safeParse({
          ...baseEntry,
          type: 'ADJUST',
          labelVi: 'Điều chỉnh',
          amount: 0, // Invalid: ADJUST must be !== 0
          taskId: null,
        }).success,
        false,
      );

      // Enforce cross-field rules on (type, taskId, topupId, pack)
      // HOLD without taskId -> invalid
      assert.equal(
        LedgerEntrySchema.safeParse({
          ...baseEntry,
          type: 'HOLD',
          labelVi: 'Giữ',
          amount: -100,
          taskId: null,
        }).success,
        false,
      );
      // HOLD with topupId -> invalid
      assert.equal(
        LedgerEntrySchema.safeParse({
          ...baseEntry,
          type: 'HOLD',
          labelVi: 'Giữ',
          amount: -100,
          topupId: '30000000-0000-4000-8000-000000000001',
        }).success,
        false,
      );
      // TOPUP without topupId or pack -> invalid
      assert.equal(
        LedgerEntrySchema.safeParse({
          ...baseEntry,
          type: 'TOPUP',
          labelVi: 'Nạp',
          amount: 5000,
          taskId: null,
          topupId: null,
          pack: 'starter',
        }).success,
        false,
      );
      assert.equal(
        LedgerEntrySchema.safeParse({
          ...baseEntry,
          type: 'TOPUP',
          labelVi: 'Nạp',
          amount: 5000,
          taskId: null,
          topupId: '30000000-0000-4000-8000-000000000001',
          pack: null,
        }).success,
        false,
      );
      // GRANT with taskId or pack -> invalid
      assert.equal(
        LedgerEntrySchema.safeParse({
          ...baseEntry,
          type: 'GRANT',
          labelVi: 'Tặng',
          amount: 500,
          taskId: '20000000-0000-4000-8000-000000000001',
          topupId: null,
          pack: null,
        }).success,
        false,
      );
    });

    it('validates GET /config/pricing mock response and rejects mismatched or duplicate tier/pack configs', () => {
      assert.equal(PricingConfigRequestSchema.safeParse({}).success, true);
      const parsed = PricingConfigResponseSchema.safeParse(
        MOCK_PRICING_CONFIG_RESPONSE,
      );
      assert.equal(parsed.success, true);

      assert.equal(MOCK_PRICING_CONFIG_RESPONSE.tierFloorCredits, 100);
      assert.equal(MOCK_PRICING_CONFIG_RESPONSE.trialGrantCredits, 500);
      assert.equal(
        MOCK_PRICING_CONFIG_RESPONSE.pipelines.faceSwapCredits,
        100,
      );
      assert.equal(
        MOCK_PRICING_CONFIG_RESPONSE.pipelines.bodyRetouchCredits,
        100,
      );
      assert.equal(
        MOCK_PRICING_CONFIG_RESPONSE.pipelines.motionControlCreditsPerSecond,
        50,
      );

      const tiersByKey = Object.fromEntries(
        MOCK_PRICING_CONFIG_RESPONSE.tiers.map((t) => [t.tier, t]),
      );
      assert.equal(tiersByKey.FREE.maxVideoSeconds, 5);
      assert.equal(tiersByKey.FREE.priority, 10);
      assert.equal(tiersByKey.Starter.maxVideoSeconds, 10);
      assert.equal(tiersByKey.Starter.priority, 3);
      assert.equal(tiersByKey.Starter.priceVnd, 49_000);
      assert.equal(tiersByKey.Starter.credits, 5_000);
      assert.equal(tiersByKey.Pro.maxVideoSeconds, 15);
      assert.equal(tiersByKey.Pro.priority, 2);
      assert.equal(tiersByKey.Pro.priceVnd, 99_000);
      assert.equal(tiersByKey.Pro.credits, 12_000);
      assert.equal(tiersByKey.Creator.maxVideoSeconds, 20);
      assert.equal(tiersByKey.Creator.priority, 1);
      assert.equal(tiersByKey.Creator.priceVnd, 199_000);
      assert.equal(tiersByKey.Creator.credits, 30_000);

      assert.equal(
        TierSnapshotSchema.safeParse({
          tier: 'Pro',
          priority: 2,
          maxVideoSeconds: 15,
        }).success,
        true,
      );

      // Reject mismatched TierSnapshot (e.g. FREE with priority 1 or maxVideoSeconds 20)
      assert.equal(
        TierSnapshotSchema.safeParse({
          tier: 'FREE',
          priority: 1,
          maxVideoSeconds: 20,
        }).success,
        false,
      );

      // Reject duplicate tiers in PricingConfigResponseSchema
      assert.equal(
        PricingConfigResponseSchema.safeParse({
          ...MOCK_PRICING_CONFIG_RESPONSE,
          tiers: [
            MOCK_PRICING_CONFIG_RESPONSE.tiers[0],
            MOCK_PRICING_CONFIG_RESPONSE.tiers[0],
            MOCK_PRICING_CONFIG_RESPONSE.tiers[2],
            MOCK_PRICING_CONFIG_RESPONSE.tiers[3],
          ],
        }).success,
        false,
      );

      // Reject duplicate topupPacks in PricingConfigResponseSchema
      assert.equal(
        PricingConfigResponseSchema.safeParse({
          ...MOCK_PRICING_CONFIG_RESPONSE,
          topupPacks: [
            MOCK_PRICING_CONFIG_RESPONSE.topupPacks[0],
            MOCK_PRICING_CONFIG_RESPONSE.topupPacks[0],
            MOCK_PRICING_CONFIG_RESPONSE.topupPacks[2],
          ],
        }).success,
        false,
      );

      // Reject mismatched tier config (e.g. Pro with priority 10)
      assert.equal(
        PricingConfigResponseSchema.safeParse({
          ...MOCK_PRICING_CONFIG_RESPONSE,
          tiers: [
            MOCK_PRICING_CONFIG_RESPONSE.tiers[0],
            MOCK_PRICING_CONFIG_RESPONSE.tiers[1],
            {
              ...MOCK_PRICING_CONFIG_RESPONSE.tiers[2],
              priority: 10,
            },
            MOCK_PRICING_CONFIG_RESPONSE.tiers[3],
          ],
        }).success,
        false,
      );
    });

    it('requires OAuth state and accepts the Google error callback (user cancelled)', () => {
      assert.equal(
        AuthGoogleCallbackQuerySchema.safeParse({ code: 'abc' }).success,
        false,
      );
      assert.equal(
        AuthGoogleCallbackQuerySchema.safeParse({ code: 'abc', state: '' })
          .success,
        false,
      );
      assert.equal(
        AuthGoogleCallbackQuerySchema.safeParse({
          error: 'access_denied',
          state: 'csrf_state_token',
        }).success,
        true,
      );
      assert.equal(
        AuthGoogleCallbackQuerySchema.safeParse({ error: 'access_denied' })
          .success,
        false,
      );
    });

    it('validates ledger cursor pagination: query defaults/bounds, hasMore/nextCursor consistency, pageSize cap, id tiebreak', () => {
      const q = WalletLedgerQuerySchema.safeParse({});
      assert.equal(q.success, true);
      assert.equal(q.data.pageSize, 20);
      for (const pageSize of ['0', '101']) {
        assert.equal(
          WalletLedgerQuerySchema.safeParse({ pageSize }).success,
          false,
        );
      }

      const base = MOCK_WALLET_LEDGER_RESPONSE;
      assert.equal(
        WalletLedgerResponseSchema.safeParse({
          ...base,
          hasMore: true,
          nextCursor: null,
        }).success,
        false,
      );
      assert.equal(
        WalletLedgerResponseSchema.safeParse({
          ...base,
          hasMore: false,
          nextCursor: 'c1',
        }).success,
        false,
      );
      assert.equal(
        WalletLedgerResponseSchema.safeParse({
          ...base,
          hasMore: true,
          nextCursor: 'c1',
        }).success,
        true,
      );
      assert.equal(
        WalletLedgerResponseSchema.safeParse({ ...base, pageSize: 1 }).success,
        false,
      );

      // Cùng createdAt: id phải giảm dần
      const [a, b] = MOCK_WALLET_LEDGER_ITEMS;
      const sameTime = { ...b, createdAt: a.createdAt };
      const hi = a.id > sameTime.id ? a : sameTime;
      const lo = a.id > sameTime.id ? sameTime : a;
      assert.equal(
        WalletLedgerResponseSchema.safeParse({
          ...base,
          items: [hi, lo],
        }).success,
        true,
      );
      assert.equal(
        WalletLedgerResponseSchema.safeParse({
          ...base,
          items: [lo, hi],
        }).success,
        false,
      );
    });

    it('rejects tampered pricing packs and tiers (price, credits, id, packId, priority, cap)', () => {
      const cfg = MOCK_PRICING_CONFIG_RESPONSE;
      const withPack = (i, patch) => ({
        ...cfg,
        topupPacks: cfg.topupPacks.map((p, idx) =>
          idx === i ? { ...p, ...patch } : p,
        ),
      });
      const withTier = (i, patch) => ({
        ...cfg,
        tiers: cfg.tiers.map((t, idx) => (idx === i ? { ...t, ...patch } : t)),
      });
      const bad = [
        withPack(0, { priceVnd: 1 }),
        withPack(0, { credits: 1 }),
        withPack(0, { id: 'pro' }),
        withPack(0, { priority: 1 }),
        withPack(0, { maxVideoSeconds: 20 }),
        withTier(1, { priceVnd: 1 }),
        withTier(1, { credits: 1 }),
        withTier(1, { packId: 'pro' }),
        withTier(1, { maxVideoSeconds: 20 }),
      ];
      bad.forEach((payload, i) => {
        assert.equal(
          PricingConfigResponseSchema.safeParse(payload).success,
          false,
          `case ${i} should be rejected`,
        );
      });
    });

    it('rejects ledger entries with inconsistent taskId/topupId/pack links', () => {
      const byType = (t) => MOCK_WALLET_LEDGER_ITEMS.find((i) => i.type === t);
      const cases = [
        { ...byType('RELEASED'), taskId: null },
        { ...byType('CAPTURED'), taskId: null },
        { ...byType('HOLD'), pack: 'pro' },
        { ...byType('CAPTURED'), pack: 'pro' },
        { ...byType('RELEASED'), pack: 'pro' },
        { ...byType('TOPUP'), taskId: '20000000-0000-4000-8000-000000000001' },
        { ...byType('GRANT'), topupId: '30000000-0000-4000-8000-000000000001' },
        { ...byType('GRANT'), pack: 'pro' },
        { ...byType('ADJUST'), topupId: '30000000-0000-4000-8000-000000000001' },
        { ...byType('ADJUST'), pack: 'pro' },
        { ...byType('ADJUST'), taskId: '20000000-0000-4000-8000-000000000001' },
      ];
      cases.forEach((entry, i) => {
        assert.equal(
          LedgerEntrySchema.safeParse(entry).success,
          false,
          `case ${i} should be rejected`,
        );
      });
    });

    it('documents zod version and assumption note in packages/contracts/README.md', () => {
      const readmePath = path.resolve(__dirname, '../README.md');
      const readme = fs.readFileSync(readmePath, 'utf8');
      assert.ok(readme.includes('zod'));
      assert.ok(readme.includes('3.24.4'));
      assert.ok(
        readme.includes(
          '[ASSUMPTION: ARCHITECTURE-SPINE chưa ghim thư viện schema]',
        ),
      );
    });
  });

  describe('Epic 2 contracts', () => {
    const baseTask = MOCK_TASKS_BY_STATUS.running;

    it('exports 16 reasonCode and 6 statuses', () => {
      assert.equal(REASON_CODES.length, 16);
      assert.equal(new Set(REASON_CODES).size, 16);
      assert.deepEqual(TASK_STATUSES, [
        'queued', 'running', 'succeeded', 'failed', 'timed_out', 'cancelled',
      ]);
      assert.equal(ReasonCodeSchema.safeParse('FOO').success, false);
    });

    it('validates upload declaration and measured image', () => {
      assert.equal(UploadCreateRequestSchema.safeParse(MOCK_UPLOAD_CREATE_REQUEST).success, true);
      assert.equal(UploadCreateRequestSchema.safeParse({ mimeType: 'image/gif', sizeBytes: 100 }).success, false);
      const big = UploadCreateRequestSchema.safeParse({ mimeType: 'image/png', sizeBytes: 10 * 1024 * 1024 + 1 });
      assert.equal(big.success, false);
      assert.deepEqual(big.error.issues[0].path, ['sizeBytes']);
      const ok = { mimeType: 'image/webp', sizeBytes: 1000, width: 512, height: 1024 };
      assert.equal(ImageMetaSchema.safeParse(ok).success, true);
      const small = ImageMetaSchema.safeParse({ ...ok, width: 511, height: 600 });
      assert.equal(small.success, false);
      assert.deepEqual(small.error.issues[0].path, ['width']);
      const ratio = ImageMetaSchema.safeParse({ ...ok, width: 1300, height: 600 });
      assert.equal(ratio.success, false);
      assert.deepEqual(ratio.error.issues[0].path, ['width']);
      const landscapeSmall = ImageMetaSchema.safeParse({ ...ok, width: 600, height: 511 });
      assert.equal(landscapeSmall.success, false);
      assert.deepEqual(landscapeSmall.error.issues[0].path, ['height']);
      const portraitRatio = ImageMetaSchema.safeParse({ ...ok, width: 600, height: 1300 });
      assert.equal(portraitRatio.success, false);
      assert.deepEqual(portraitRatio.error.issues[0].path, ['height']);
    });

    it('không còn nhận consent theo từng lượt (ToS chấp nhận một lần khi đăng nhập)', () => {
      assert.equal(FaceSwapCreateRequestSchema.safeParse(MOCK_FACE_SWAP_CREATE_REQUEST).success, true);
      assert.equal(
        FaceSwapCreateRequestSchema.safeParse({ ...MOCK_FACE_SWAP_CREATE_REQUEST, consent: true }).success,
        false,
      );
    });

    it('enforces Task invariants', () => {
      const bad = [
        { ...MOCK_TASKS_BY_STATUS.failed, reasonCode: undefined },
        { ...MOCK_TASKS_BY_STATUS.succeeded, reasonCode: 'NO_FACE' },
        { ...MOCK_TASKS_BY_STATUS.queued, queuePosition: undefined },
        { ...baseTask, queuePosition: 1 },
        { ...baseTask, resultKey: 'out/u/k' },
        { ...MOCK_TASKS_BY_STATUS.succeeded, resultKey: undefined },
        { ...MOCK_TASKS_BY_STATUS.cancelled, reasonCode: 'NO_FACE' },
        { ...MOCK_TASKS_BY_STATUS.failed, reasonCode: 'FREE_WAIT_EXPIRED' },
        { ...MOCK_TASKS_BY_STATUS.failed, reasonCode: 'FOO' },
      ];
      bad.forEach((t, i) => assert.equal(TaskSchema.safeParse(t).success, false, `case ${i}`));
      const missing = TaskSchema.safeParse(bad[0]);
      assert.deepEqual(missing.error.issues[0].path, ['reasonCode']);
    });

    it('rejects cross-state reasonCode and malformed keys', () => {
      const f = MOCK_TASKS_BY_STATUS.failed;
      assert.equal(TaskSchema.safeParse({ ...f, reasonCode: 'USER_CANCEL' }).success, false);
      assert.equal(TaskSchema.safeParse({ ...f, reasonCode: 'PREP_TIMEOUT' }).success, false);
      assert.equal(
        TaskSchema.safeParse({ ...MOCK_TASKS_BY_STATUS.timed_out, reasonCode: 'PREP_TIMEOUT' }).success,
        true,
      );
      for (const code of ['RH_TIMEOUT', 'RH_GATE_TIMEOUT']) {
        assert.equal(TaskSchema.safeParse({ ...f, reasonCode: code }).success, false, code);
        assert.equal(
          TaskSchema.safeParse({ ...MOCK_TASKS_BY_STATUS.timed_out, reasonCode: code }).success,
          true,
          code,
        );
      }
      assert.equal(
        TaskSchema.safeParse({ ...MOCK_TASKS_BY_STATUS.timed_out, reasonCode: 'NO_FACE' }).success,
        false,
      );
      assert.equal(
        FaceSwapCreateRequestSchema.safeParse({ ...MOCK_FACE_SWAP_CREATE_REQUEST, creditCost: 1 }).success,
        false,
      );
      assert.equal(
        FaceSwapCreateRequestSchema.safeParse({
          ...MOCK_FACE_SWAP_CREATE_REQUEST,
          sourceKey: MOCK_UPLOAD_CREATE_RESPONSE.key,
        }).success,
        false,
      );
      assert.equal(ConfirmedUploadKeySchema.safeParse('in/../x').success, false);
      assert.equal(RawUploadKeySchema.safeParse('in-raw/../x').success, false);
      assert.equal(
        TaskSchema.safeParse({ ...MOCK_TASKS_BY_STATUS.succeeded, resultKey: 'out/../x' }).success,
        false,
      );
      assert.equal(
        ImageMetaSchema.safeParse({ mimeType: 'image/png', sizeBytes: 1000, width: 1024, height: 512 }).success,
        true,
      );
    });

    it('parses all mocks against their schemas', () => {
      for (const status of TASK_STATUSES) {
        assert.equal(MOCK_TASKS_BY_STATUS[status].status, status);
        assert.equal(TaskSchema.safeParse(MOCK_TASKS_BY_STATUS[status]).success, true, status);
      }
      assert.equal(TaskListResponseSchema.safeParse(MOCK_TASK_LIST_RESPONSE).success, true);
      assert.equal(TaskListQuerySchema.parse({}).pageSize, 20);
      assert.equal(UploadCreateResponseSchema.safeParse(MOCK_UPLOAD_CREATE_RESPONSE).success, true);
      assert.equal(UploadConfirmResponseSchema.safeParse(MOCK_UPLOAD_CONFIRM_RESPONSE).success, true);
      assert.equal(TaskResultResponseSchema.safeParse(MOCK_TASK_RESULT_RESPONSE).success, true);
      assert.equal(TaskResultResponseSchema.safeParse(MOCK_TASK_RESULT_EXPIRED_SOURCE_RESPONSE).success, true);
      assert.equal(TaskShareResponseSchema.safeParse(MOCK_TASK_SHARE_RESPONSE).success, true);
      assert.equal(TaskShareRevokeResponseSchema.safeParse(MOCK_TASK_SHARE_REVOKE_RESPONSE).success, true);
      assert.equal(SharePublicParamsSchema.safeParse({ token: 'abc' }).success, true);
    });

    it('looks up reasonCode messages with pipeline overrides', () => {
      assert.equal(getReasonCodeMessageVi('NO_FACE'), 'Không nhận diện được khuôn mặt trong ảnh');
      assert.equal(
        getReasonCodeMessageVi('CONTENT_BLOCKED'),
        'Ảnh/video vi phạm tiêu chuẩn cộng đồng, vui lòng chọn file khác.',
      );
      const base = getReasonCodeMessageVi('NO_POSE');
      const body = getReasonCodeMessageVi('NO_POSE', 'body_retouch');
      const motion = getReasonCodeMessageVi('NO_POSE', 'motion_control');
      assert.notEqual(body, base);
      assert.notEqual(motion, base);
      assert.notEqual(body, motion);
      assert.equal(getReasonCodeMessageVi('NO_FACE', 'body_retouch'), getReasonCodeMessageVi('NO_FACE'));
      assert.equal(getReasonCodeMessageVi('FOO'), 'Tác vụ không thành công. Vui lòng thử lại sau.');
      for (const c of REASON_CODES) assert.ok(getReasonCodeMessageVi(c).length > 0);
    });
  });

  describe('Epic 3 contracts', () => {
    const okTopup = MOCK_TOPUPS_BY_STATUS.awaiting_transfer;

    it('exports 6 statuses, 3 packs and Vietnamese labels', () => {
      assert.deepEqual([...TOPUP_STATUSES], [
        'awaiting_transfer', 'pending', 'approved', 'rejected', 'needs_review', 'expired',
      ]);
      assert.deepEqual([...TOPUP_PACK_IDS], ['starter', 'pro', 'creator']);
      assert.equal(getTopupStatusLabelVi('pending'), 'Đang chờ duyệt');
      assert.equal(getTopupStatusLabelVi('needs_review'), 'Cần xem xét');
      assert.equal(getTopupStatusLabelVi('paid'), 'Không xác định');
      assert.equal(TopupStatusSchema.safeParse('paid').success, false);
    });

    it('validates create request', () => {
      assert.equal(TopupCreateRequestSchema.safeParse({ pack: 'pro' }).success, true);
      assert.equal(TopupCreateRequestSchema.safeParse({ pack: 'vip' }).success, false);
      assert.equal(
        TopupCreateRequestSchema.safeParse({ pack: 'pro', amountVnd: 1 }).success,
        false,
      );
    });

    it('validates admin requests', () => {
      for (const bankRef of ['', '   ']) {
        const r = AdminTopupApproveRequestSchema.safeParse({ bankRef });
        assert.equal(r.success, false);
        assert.deepEqual(r.error.issues[0].path, ['bankRef']);
        assert.equal(AdminTopupApproveExpiredRequestSchema.safeParse({ bankRef }).success, false);
      }
      assert.equal(AdminTopupApproveRequestSchema.parse({ bankRef: '  FT1 ' }).bankRef, 'FT1');
      const r = AdminTopupRejectRequestSchema.safeParse({ rejectReason: '' });
      assert.equal(r.success, false);
      assert.deepEqual(r.error.issues[0].path, ['rejectReason']);
      assert.equal(AdminTopupNeedsReviewRequestSchema.safeParse({ note: ' ' }).success, false);
      assert.equal(AdminTopupNeedsReviewRequestSchema.safeParse({ note: 'x' }).success, true);
      assert.equal(AdminTopupReturnToPendingRequestSchema.safeParse({}).success, true);
      assert.equal(AdminTopupReturnToPendingRequestSchema.safeParse({ a: 1 }).success, false);
    });

    it('enforces Topup invariants', () => {
      const fails = (patch, field) => {
        const r = TopupSchema.safeParse({ ...okTopup, ...patch });
        assert.equal(r.success, false);
        assert.ok(r.error.issues.some((i) => i.path[0] === field));
      };
      fails({ status: 'pending' }, 'approveBy');
      fails({ status: 'rejected' }, 'rejectReason');
      fails({ transferContent: 'NAP OTHER' }, 'transferContent');
      fails({ bankRef: 'FT1' }, 'bankRef');
      fails({ rejectReason: 'x' }, 'rejectReason');
      fails({ status: 'paid' }, 'status');
      fails({ status: 'approved' }, 'bankRef');
      fails({ status: 'needs_review' }, 'note');
      fails({ note: 'x' }, 'note');
    });

    it('enforces Admin isOverdue, empty pages and unique mock codes', () => {
      const admin = MOCK_ADMIN_TOPUPS_BY_STATUS.approved;
      const r = AdminTopupSchema.safeParse({ ...admin, isOverdue: true });
      assert.equal(r.success, false);
      assert.ok(r.error.issues.some((i) => i.path[0] === 'isOverdue'));
      assert.equal(MOCK_ADMIN_TOPUPS_BY_STATUS.pending.isOverdue, true);
      assert.equal(
        TopupListResponseSchema.safeParse({ items: [], pageSize: 20, hasMore: true, nextCursor: 'x' }).success,
        false,
      );
      const codes = TOPUP_STATUSES.map((s) => MOCK_TOPUPS_BY_STATUS[s].code);
      assert.equal(new Set(codes).size, codes.length);
      assert.match(getApiErrorMessageVi('TOPUP_LIMIT'), new RegExp(String(MAX_OPEN_TOPUPS)));
    });

    it('mocks parse against schemas', () => {
      for (const s of TOPUP_STATUSES) {
        assert.equal(TopupSchema.safeParse(MOCK_TOPUPS_BY_STATUS[s]).success, true, s);
        assert.equal(AdminTopupSchema.safeParse(MOCK_ADMIN_TOPUPS_BY_STATUS[s]).success, true, s);
      }
      assert.equal(TopupListResponseSchema.safeParse(MOCK_TOPUP_LIST_RESPONSE).success, true);
      assert.equal(AdminTopupListResponseSchema.safeParse(MOCK_ADMIN_TOPUP_LIST_RESPONSE).success, true);
      assert.equal('email' in MOCK_ADMIN_TOPUPS_BY_STATUS.pending, false);
    });

    it('validates list queries, paging and params', () => {
      assert.equal(TopupListQuerySchema.parse({}).pageSize, 20);
      assert.equal(TopupListQuerySchema.parse({ pageSize: '50' }).pageSize, 50);
      assert.equal(TopupListQuerySchema.safeParse({ pageSize: 0 }).success, false);
      assert.equal(TopupListQuerySchema.safeParse({ pageSize: 101 }).success, false);
      assert.equal(AdminTopupListQuerySchema.safeParse({ status: 'pending' }).success, true);
      assert.equal(AdminTopupListQuerySchema.safeParse({ status: 'paid' }).success, false);
      const item = MOCK_TOPUPS_BY_STATUS.pending;
      const page = { items: [item], pageSize: 20, hasMore: false, nextCursor: null };
      assert.equal(TopupListResponseSchema.safeParse(page).success, true);
      assert.equal(TopupListResponseSchema.safeParse({ ...page, hasMore: true }).success, false);
      assert.equal(TopupListResponseSchema.safeParse({ ...page, nextCursor: 'c' }).success, false);
      assert.equal(TopupListResponseSchema.safeParse({ ...page, pageSize: 1, items: [item, item] }).success, false);
      assert.equal(TopupIdParamsSchema.safeParse({ id: 'abc' }).success, false);
    });

    it('validates bodyless requests, max lengths and positive invariants', () => {
      assert.equal(TopupConfirmTransferRequestSchema.safeParse(undefined).success, true);
      assert.equal(TopupConfirmTransferRequestSchema.safeParse({}).success, true);
      assert.equal(TopupConfirmTransferRequestSchema.safeParse({ a: 1 }).success, false);
      assert.equal(AdminTopupReturnToPendingRequestSchema.safeParse(undefined).success, true);
      assert.equal(AdminTopupApproveRequestSchema.safeParse({ bankRef: 'a'.repeat(128) }).success, true);
      assert.equal(AdminTopupApproveRequestSchema.safeParse({ bankRef: 'a'.repeat(129) }).success, false);
      assert.equal(AdminTopupRejectRequestSchema.safeParse({ rejectReason: 'a'.repeat(501) }).success, false);
      assert.equal(AdminTopupNeedsReviewRequestSchema.safeParse({ note: 'a'.repeat(501) }).success, false);
      assert.equal(TopupSchema.safeParse(MOCK_TOPUPS_BY_STATUS.approved).success, true);
      assert.equal(TopupSchema.safeParse(MOCK_TOPUPS_BY_STATUS.rejected).success, true);
    });

    it('has Vietnamese messages for new error codes', () => {
      for (const c of ['TOPUP_LIMIT', 'BANK_REF_DUPLICATE', 'TOPUP_STATE_INVALID', 'TOPUP_QR_EXPIRED']) {
        assert.ok(API_ERROR_MESSAGES_VI[c].length > 0);
      }
    });
  });
});
