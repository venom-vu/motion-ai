import type {
  AccountTier,
  PricingConfigResponse,
  TierSnapshot,
  TopupPackId,
} from '@flowvis/contracts';

/** Ngưỡng tổng credit sở hữu (balance + held) để giữ Tier trả phí. */
export const TIER_FLOOR_CREDITS = 100;

/** Nguồn cấu hình giá/Cap/Priority duy nhất phía server (AD-10). */
export const PRICING_CONFIG: PricingConfigResponse = {
  tierFloorCredits: 100,
  trialGrantCredits: 500,
  freeQueueTimeoutMinutes: 15,
  pipelines: {
    faceSwapCredits: 100,
    bodyRetouchCredits: 100,
    motionControlCreditsPerSecond: 50,
  },
  tiers: [
    { tier: 'FREE', packId: null, priceVnd: 0, credits: 500, maxVideoSeconds: 5, priority: 10 },
    { tier: 'Starter', packId: 'starter', priceVnd: 49_000, credits: 5_000, maxVideoSeconds: 10, priority: 3 },
    { tier: 'Pro', packId: 'pro', priceVnd: 99_000, credits: 12_000, maxVideoSeconds: 15, priority: 2 },
    { tier: 'Creator', packId: 'creator', priceVnd: 199_000, credits: 30_000, maxVideoSeconds: 20, priority: 1 },
  ],
  topupPacks: [
    { id: 'starter', tier: 'Starter', name: 'Starter', priceVnd: 49_000, credits: 5_000, maxVideoSeconds: 10, priority: 3 },
    { id: 'pro', tier: 'Pro', name: 'Pro', priceVnd: 99_000, credits: 12_000, maxVideoSeconds: 15, priority: 2 },
    { id: 'creator', tier: 'Creator', name: 'Creator', priceVnd: 199_000, credits: 30_000, maxVideoSeconds: 20, priority: 1 },
  ],
};

const PACK_RANK: Record<TopupPackId, number> = { starter: 1, pro: 2, creator: 3 };

export function isTopupPack(value: unknown): value is TopupPackId {
  return value === 'starter' || value === 'pro' || value === 'creator';
}

/** Hàm thuần: tier_pack mới sau một bút toán; total = balance + held sau bút toán. */
export function computeTierPack(input: {
  current: string | null;
  total: bigint;
  topupPack?: TopupPackId;
}): TopupPackId | null {
  let pack: TopupPackId | null = isTopupPack(input.current)
    ? input.current
    : null;
  if (input.topupPack) {
    pack =
      pack === null || PACK_RANK[input.topupPack] > PACK_RANK[pack]
        ? input.topupPack
        : pack;
  }
  if (input.total < BigInt(TIER_FLOOR_CREDITS)) return null;
  return pack;
}

export function tierFromPack(pack: string | null): AccountTier {
  const found = PRICING_CONFIG.tiers.find(
    (t) => t.packId === (isTopupPack(pack) ? pack : null),
  );
  return found ? found.tier : 'FREE';
}

export function snapshotFromPack(pack: string | null): TierSnapshot {
  const tier = tierFromPack(pack);
  const cfg = PRICING_CONFIG.tiers.find((t) => t.tier === tier)!;
  return {
    tier,
    priority: cfg.priority,
    maxVideoSeconds: cfg.maxVideoSeconds,
  };
}
