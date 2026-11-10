import { z } from 'zod';
import { UserRoleSchema } from './auth.js';

/**
 * Hạng tài khoản (Tier) theo AD-10 / AD-11.
 */
export const ACCOUNT_TIERS = ['FREE', 'Starter', 'Pro', 'Creator'] as const;
export const AccountTier = {
  FREE: 'FREE',
  Starter: 'Starter',
  Pro: 'Pro',
  Creator: 'Creator',
} as const;
export type AccountTier = (typeof ACCOUNT_TIERS)[number];
export const AccountTierSchema = z.enum(ACCOUNT_TIERS);

/**
 * Mã gói nạp (Topup Pack ID).
 */
export const TOPUP_PACK_IDS = ['starter', 'pro', 'creator'] as const;
export const TopupPackId = {
  starter: 'starter',
  pro: 'pro',
  creator: 'creator',
} as const;
export type TopupPackId = (typeof TOPUP_PACK_IDS)[number];
export const TopupPackIdSchema = z.enum(TOPUP_PACK_IDS);

/**
 * Bảng quy tắc bất biến cho từng hạng tài khoản (Tier -> Priority, Cap, PackId, Giá, Credit).
 */
const TIER_SPECS: Record<
  AccountTier,
  {
    packId: TopupPackId | null;
    priority: 10 | 3 | 2 | 1;
    maxVideoSeconds: 5 | 10 | 15 | 20;
    priceVnd: number;
    credits: number;
  }
> = {
  FREE: {
    packId: null,
    priority: 10,
    maxVideoSeconds: 5,
    priceVnd: 0,
    credits: 500,
  },
  Starter: {
    packId: 'starter',
    priority: 3,
    maxVideoSeconds: 10,
    priceVnd: 49_000,
    credits: 5_000,
  },
  Pro: {
    packId: 'pro',
    priority: 2,
    maxVideoSeconds: 15,
    priceVnd: 99_000,
    credits: 12_000,
  },
  Creator: {
    packId: 'creator',
    priority: 1,
    maxVideoSeconds: 20,
    priceVnd: 199_000,
    credits: 30_000,
  },
};

/**
 * Loại bút toán sổ cái credit bất biến theo AD-2.
 */
export const LEDGER_ENTRY_TYPES = [
  'GRANT',
  'TOPUP',
  'ADJUST',
  'HOLD',
  'CAPTURED',
  'RELEASED',
] as const;
export const LedgerEntryType = {
  GRANT: 'GRANT',
  TOPUP: 'TOPUP',
  ADJUST: 'ADJUST',
  HOLD: 'HOLD',
  CAPTURED: 'CAPTURED',
  RELEASED: 'RELEASED',
} as const;
export type LedgerEntryType = (typeof LEDGER_ENTRY_TYPES)[number];
export const LedgerEntryTypeSchema = z.enum(LEDGER_ENTRY_TYPES);

/**
 * Nhãn tiếng Việt chuẩn cho từng loại bút toán sổ cái (UX/FR11).
 */
export const LEDGER_ENTRY_LABELS_VI = {
  GRANT: 'Tặng',
  TOPUP: 'Nạp',
  HOLD: 'Giữ',
  RELEASED: 'Hoàn',
  CAPTURED: 'Chốt',
  ADJUST: 'Điều chỉnh',
} as const satisfies Record<LedgerEntryType, string>;

export const LEDGER_ENTRY_LABEL_VALUES_VI = [
  'Tặng',
  'Nạp',
  'Giữ',
  'Hoàn',
  'Chốt',
  'Điều chỉnh',
] as const;
export const LedgerEntryLabelViSchema = z.enum(LEDGER_ENTRY_LABEL_VALUES_VI);
export type LedgerEntryLabelVi = z.infer<typeof LedgerEntryLabelViSchema>;

export function getLedgerEntryLabelVi(
  type: LedgerEntryType,
): LedgerEntryLabelVi {
  return LEDGER_ENTRY_LABELS_VI[type];
}

/**
 * Tier Snapshot chụp tại thời điểm HOLD tạo Task (AD-11).
 */
export const TierSnapshotSchema = z
  .object({
    tier: AccountTierSchema,
    priority: z.union([
      z.literal(10),
      z.literal(3),
      z.literal(2),
      z.literal(1),
    ]),
    maxVideoSeconds: z.union([
      z.literal(5),
      z.literal(10),
      z.literal(15),
      z.literal(20),
    ]),
  })
  .superRefine((val, ctx) => {
    const spec = TIER_SPECS[val.tier];
    if (val.priority !== spec.priority) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['priority'],
        message: `Tier ${val.tier} bắt buộc có priority = ${spec.priority}`,
      });
    }
    if (val.maxVideoSeconds !== spec.maxVideoSeconds) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['maxVideoSeconds'],
        message: `Tier ${val.tier} bắt buộc có maxVideoSeconds = ${spec.maxVideoSeconds}`,
      });
    }
  });
export type TierSnapshot = z.infer<typeof TierSnapshotSchema>;

/**
 * GET /me — Thông tin người dùng, hạng tài khoản và số dư ví hiện tại.
 */
export const MeRequestSchema = z.object({}).strict().optional();
export type MeRequest = z.infer<typeof MeRequestSchema>;

export const MeResponseSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  role: UserRoleSchema,
  tier: AccountTierSchema,
  balance: z.number().int().nonnegative('balance không được âm (AD-2)'),
  held: z.number().int().nonnegative('held không được âm (AD-2)'),
  tosVersion: z.string().min(1),
});
export type MeResponse = z.infer<typeof MeResponseSchema>;

/**
 * Bút toán sổ cái với quy tắc dấu và liên kết thực thể bất biến theo AD-2:
 * - HOLD: amount < 0, bắt buộc có taskId, không có topupId/pack
 * - RELEASED: amount > 0, bắt buộc có taskId, không có topupId/pack
 * - CAPTURED: amount === 0, bắt buộc có taskId, không có topupId/pack
 * - TOPUP: amount > 0, bắt buộc có topupId và pack, không có taskId
 * - GRANT: amount > 0, không có taskId/topupId/pack
 * - ADJUST: amount !== 0, không có taskId/topupId/pack
 */
export const LedgerEntrySchema = z
  .object({
    id: z.string().uuid(),
    userId: z.string().uuid(),
    type: LedgerEntryTypeSchema,
    labelVi: LedgerEntryLabelViSchema,
    amount: z.number().int(),
    taskId: z.string().uuid().nullable().optional(),
    topupId: z.string().uuid().nullable().optional(),
    pack: TopupPackIdSchema.nullable().optional(),
    note: z.string().nullable().optional(),
    createdAt: z.string().datetime(),
  })
  .superRefine((entry, ctx) => {
    const expectedLabel = LEDGER_ENTRY_LABELS_VI[entry.type];
    if (entry.labelVi !== expectedLabel) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['labelVi'],
        message: `Nhãn tiếng Việt của ${entry.type} phải là "${expectedLabel}"`,
      });
    }

    switch (entry.type) {
      case 'HOLD':
        if (entry.amount >= 0) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['amount'],
            message: 'Bút toán HOLD phải có amount < 0 (AD-2)',
          });
        }
        break;
      case 'RELEASED':
      case 'GRANT':
      case 'TOPUP':
        if (entry.amount <= 0) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['amount'],
            message: `Bút toán ${entry.type} phải có amount > 0 (AD-2)`,
          });
        }
        break;
      case 'CAPTURED':
        if (entry.amount !== 0) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['amount'],
            message: 'Bút toán CAPTURED phải có amount === 0 (AD-2)',
          });
        }
        break;
      case 'ADJUST':
        if (entry.amount === 0) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['amount'],
            message: 'Bút toán ADJUST phải có amount khác 0',
          });
        }
        break;
    }

    if (
      entry.type === 'HOLD' ||
      entry.type === 'CAPTURED' ||
      entry.type === 'RELEASED'
    ) {
      if (entry.taskId == null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['taskId'],
          message: `Bút toán ${entry.type} bắt buộc phải có taskId`,
        });
      }
      if (entry.topupId != null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['topupId'],
          message: `Bút toán ${entry.type} không được có topupId`,
        });
      }
      if (entry.pack != null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['pack'],
          message: `Bút toán ${entry.type} không được có pack`,
        });
      }
    } else if (entry.type === 'TOPUP') {
      if (entry.topupId == null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['topupId'],
          message: 'Bút toán TOPUP bắt buộc phải có topupId',
        });
      }
      if (entry.pack == null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['pack'],
          message: 'Bút toán TOPUP bắt buộc phải có pack',
        });
      }
      if (entry.taskId != null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['taskId'],
          message: 'Bút toán TOPUP không được có taskId',
        });
      }
    } else {
      // GRANT or ADJUST
      if (entry.taskId != null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['taskId'],
          message: `Bút toán ${entry.type} không được có taskId`,
        });
      }
      if (entry.topupId != null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['topupId'],
          message: `Bút toán ${entry.type} không được có topupId`,
        });
      }
      if (entry.pack != null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['pack'],
          message: `Bút toán ${entry.type} không được có pack`,
        });
      }
    }
  });
export type LedgerEntry = z.infer<typeof LedgerEntrySchema>;

/**
 * GET /wallet/ledger — Phân trang theo cursor (sổ cái append-only), bút toán mới nhất trước.
 * Thứ tự ổn định: createdAt giảm dần, cùng createdAt thì id giảm dần.
 */
export const WalletLedgerQuerySchema = z.object({
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().min(1).optional(),
});
export const WalletLedgerRequestSchema = WalletLedgerQuerySchema;
export type WalletLedgerQuery = z.infer<typeof WalletLedgerQuerySchema>;
export type WalletLedgerRequest = WalletLedgerQuery;

export const WalletLedgerResponseSchema = z
  .object({
    items: z.array(LedgerEntrySchema),
    pageSize: z.number().int().min(1).max(100),
    hasMore: z.boolean(),
    nextCursor: z.string().min(1).nullable(),
  })
  .superRefine((res, ctx) => {
    if (res.items.length > res.pageSize) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['items'],
        message: 'Số bút toán không được vượt quá pageSize',
      });
    }
    if (res.hasMore !== (res.nextCursor !== null)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['nextCursor'],
        message: 'hasMore phải khớp với việc có nextCursor (hasMore=true ⇔ nextCursor khác null)',
      });
    }
    for (let i = 1; i < res.items.length; i += 1) {
      const prev = res.items[i - 1];
      const curr = res.items[i];
      const prevTime = Date.parse(prev.createdAt);
      const currTime = Date.parse(curr.createdAt);
      if (
        currTime > prevTime ||
        (currTime === prevTime && curr.id > prev.id)
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['items', i, 'createdAt'],
          message:
            'Danh sách bút toán sổ cái phải xếp mới nhất trước (createdAt giảm dần, cùng createdAt thì id giảm dần)',
        });
      }
    }
  });
export type WalletLedgerResponse = z.infer<typeof WalletLedgerResponseSchema>;

/**
 * GET /config/pricing — Cấu hình bảng giá pipeline, ngưỡng giữ Tier, Cap video, Priority và các gói nạp.
 */
export const PipelinePricingSchema = z.object({
  faceSwapCredits: z.literal(100),
  bodyRetouchCredits: z.literal(100),
  motionControlCreditsPerSecond: z.literal(50),
  /** Số giây Trim tối thiểu của Motion Control (tùy chọn để BE Epic 2–4 chưa trả vẫn hợp lệ; BE 5.3 phải trả 3). */
  motionControlMinSeconds: z.literal(3).optional(),
});
export type PipelinePricing = z.infer<typeof PipelinePricingSchema>;

export const TierConfigSchema = z
  .object({
    tier: AccountTierSchema,
    packId: TopupPackIdSchema.nullable(),
    priceVnd: z.number().int().nonnegative(),
    credits: z.number().int().nonnegative(),
    maxVideoSeconds: z.union([
      z.literal(5),
      z.literal(10),
      z.literal(15),
      z.literal(20),
    ]),
    priority: z.union([
      z.literal(10),
      z.literal(3),
      z.literal(2),
      z.literal(1),
    ]),
  })
  .superRefine((val, ctx) => {
    const spec = TIER_SPECS[val.tier];
    if (val.packId !== spec.packId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['packId'],
        message: `Tier ${val.tier} bắt buộc có packId = ${String(spec.packId)}`,
      });
    }
    if (val.priority !== spec.priority) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['priority'],
        message: `Tier ${val.tier} bắt buộc có priority = ${spec.priority}`,
      });
    }
    if (val.maxVideoSeconds !== spec.maxVideoSeconds) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['maxVideoSeconds'],
        message: `Tier ${val.tier} bắt buộc có maxVideoSeconds = ${spec.maxVideoSeconds}`,
      });
    }
    if (val.priceVnd !== spec.priceVnd) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['priceVnd'],
        message: `Tier ${val.tier} bắt buộc có priceVnd = ${spec.priceVnd}`,
      });
    }
    if (val.credits !== spec.credits) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['credits'],
        message: `Tier ${val.tier} bắt buộc có credits = ${spec.credits}`,
      });
    }
  });
export type TierConfig = z.infer<typeof TierConfigSchema>;

export const TopupPackConfigSchema = z
  .object({
    id: TopupPackIdSchema,
    tier: z.enum(['Starter', 'Pro', 'Creator']),
    name: z.string().min(1),
    priceVnd: z.number().int().positive(),
    credits: z.number().int().positive(),
    maxVideoSeconds: z.union([z.literal(10), z.literal(15), z.literal(20)]),
    priority: z.union([z.literal(3), z.literal(2), z.literal(1)]),
  })
  .superRefine((val, ctx) => {
    const spec = TIER_SPECS[val.tier];
    if (val.id !== spec.packId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['id'],
        message: `Gói nạp của Tier ${val.tier} bắt buộc có id = ${String(spec.packId)}`,
      });
    }
    if (val.priority !== spec.priority) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['priority'],
        message: `Gói nạp ${val.id} bắt buộc có priority = ${spec.priority}`,
      });
    }
    if (val.maxVideoSeconds !== spec.maxVideoSeconds) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['maxVideoSeconds'],
        message: `Gói nạp ${val.id} bắt buộc có maxVideoSeconds = ${spec.maxVideoSeconds}`,
      });
    }
    if (val.priceVnd !== spec.priceVnd) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['priceVnd'],
        message: `Gói nạp ${val.id} bắt buộc có priceVnd = ${spec.priceVnd}`,
      });
    }
    if (val.credits !== spec.credits) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['credits'],
        message: `Gói nạp ${val.id} bắt buộc có credits = ${spec.credits}`,
      });
    }
  });
export type TopupPackConfig = z.infer<typeof TopupPackConfigSchema>;

export const PricingConfigRequestSchema = z.object({}).strict().optional();
export type PricingConfigRequest = z.infer<typeof PricingConfigRequestSchema>;

export const PricingConfigResponseSchema = z
  .object({
    tierFloorCredits: z.literal(100),
    trialGrantCredits: z.literal(500),
    freeQueueTimeoutMinutes: z.literal(15),
    pipelines: PipelinePricingSchema,
    tiers: z.array(TierConfigSchema).length(4),
    topupPacks: z.array(TopupPackConfigSchema).length(3),
  })
  .superRefine((val, ctx) => {
    const seenTiers = new Set<AccountTier>();
    val.tiers.forEach((item, idx) => {
      if (seenTiers.has(item.tier)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['tiers', idx, 'tier'],
          message: `Tier ${item.tier} bị trùng lặp trong cấu hình bảng giá`,
        });
      }
      seenTiers.add(item.tier);
    });

    const seenPacks = new Set<TopupPackId>();
    val.topupPacks.forEach((pack, idx) => {
      if (seenPacks.has(pack.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['topupPacks', idx, 'id'],
          message: `Gói nạp ${pack.id} bị trùng lặp trong cấu hình bảng giá`,
        });
      }
      seenPacks.add(pack.id);
    });
  });
export type PricingConfigResponse = z.infer<typeof PricingConfigResponseSchema>;
