import type {
  AccountTier,
  PricingConfigResponse,
  TierConfig,
} from '@flowvis/contracts';

export type FeatureCategoryId = 'all' | 'image' | 'video';

export interface FeatureCategoryOption {
  id: FeatureCategoryId;
  labelVi: string;
  icon: string;
}

export const FEATURE_CATEGORIES: readonly FeatureCategoryOption[] = [
  { id: 'all', labelVi: 'Tất cả công cụ', icon: 'lucide:layers' },
  { id: 'image', labelVi: 'Xử lý ảnh AI', icon: 'lucide:image' },
  { id: 'video', labelVi: 'Chuyển động video AI', icon: 'lucide:video' },
] as const;

export type FeaturePipelineId = 'face-swap' | 'body-retouch' | 'motion-control';

export interface AiFeatureTool {
  id: FeaturePipelineId;
  slug: string;
  titleVi: string;
  subtitleVi: string;
  descriptionVi: string;
  category: Exclude<FeatureCategoryId, 'all'>;
  categoryLabelVi: string;
  badgeVi: string;
  icon: string;
  billingMode: 'per_run' | 'per_second';
  unitCredits: number;
  priceBadgeVi: string;
  tierCapSeconds: number | null;
  tierCapLabelVi: string | null;
  beforeLabelVi: string;
  afterLabelVi: string;
  accentGradient: string;
  inputRequirementVi: string;
  outputFormatVi: string;
}

export function formatNumberVi(value: number): string {
  return new Intl.NumberFormat('vi-VN').format(value);
}

export function formatVndVi(amountVnd: number): string {
  if (amountVnd === 0) {
    return 'Miễn phí';
  }
  return `${formatNumberVi(amountVnd)}đ`;
}

export function formatSignedCreditsVi(amount: number): string {
  if (amount > 0) {
    return `+${formatNumberVi(amount)} credit`;
  }
  if (amount < 0) {
    return `${formatNumberVi(amount)} credit`;
  }
  return '0 credit';
}

export function resolveTierConfig(
  pricing: PricingConfigResponse,
  tier: AccountTier = 'FREE',
): TierConfig {
  const matched = pricing.tiers.find((item) => item.tier === tier);
  if (matched) {
    return matched;
  }
  const fallback = pricing.tiers[0];
  if (!fallback) {
    throw new Error('Cấu hình bảng giá không có thông tin hạng tài khoản');
  }
  return fallback;
}

export function getTierCapSeconds(
  pricing: PricingConfigResponse,
  tier: AccountTier = 'FREE',
): number {
  return resolveTierConfig(pricing, tier).maxVideoSeconds;
}

/**
 * Sinh danh sách Card công cụ AI từ cấu hình bảng giá `/config/pricing` và Tier hiện tại.
 * Tuyệt đối không hardcode số credit hoặc số giây trần trong UI.
 */
export function buildAiFeatureCatalog(
  pricing: PricingConfigResponse,
  currentTier: AccountTier = 'FREE',
): AiFeatureTool[] {
  const activeTierConfig = resolveTierConfig(pricing, currentTier);
  const maxVideoSeconds = activeTierConfig.maxVideoSeconds;
  const { faceSwapCredits, bodyRetouchCredits, motionControlCreditsPerSecond } =
    pricing.pipelines;

  return [
    {
      id: 'face-swap',
      slug: 'face-swap',
      titleVi: 'Hoán Đổi Khuôn Mặt Pro',
      subtitleVi: 'Đồng bộ ánh sáng, góc nghiêng và biểu cảm tự nhiên',
      descriptionVi:
        'Thay thế khuôn mặt trong ảnh chân dung hoặc lookbook thương mại với độ sắc nét cao và giữ nguyên kết cấu da.',
      category: 'image',
      categoryLabelVi: 'Xử lý ảnh AI',
      badgeVi: 'Phổ biến',
      icon: 'lucide:scan-face',
      billingMode: 'per_run',
      unitCredits: faceSwapCredits,
      priceBadgeVi: `${formatNumberVi(faceSwapCredits)} credit / lượt`,
      tierCapSeconds: null,
      tierCapLabelVi: null,
      beforeLabelVi: 'Ảnh gốc tham chiếu',
      afterLabelVi: 'Khuôn mặt đã đồng bộ AI',
      accentGradient: 'from-violet-600/30 via-slate-900 to-cyan-500/20',
      inputRequirementVi: '1 ảnh khuôn mặt nguồn + 1 ảnh đích rõ mặt',
      outputFormatVi: 'Ảnh PNG/JPEG chất lượng cao (kèm nhãn EXIF AI Generator)',
    },
    {
      id: 'body-retouch',
      slug: 'body-retouch',
      titleVi: 'Chỉnh Dáng & Cân Đối Hình Thể',
      subtitleVi: 'Tinh chỉnh tỷ lệ cơ thể không làm biến dạng hậu cảnh',
      descriptionVi:
        'Tự động nhận diện khung xương và điều chỉnh vóc dáng thời trang tự nhiên, bảo toàn chi tiết trang phục và nền ảnh.',
      category: 'image',
      categoryLabelVi: 'Xử lý ảnh AI',
      badgeVi: 'Studio',
      icon: 'lucide:person-standing',
      billingMode: 'per_run',
      unitCredits: bodyRetouchCredits,
      priceBadgeVi: `${formatNumberVi(bodyRetouchCredits)} credit / lượt`,
      tierCapSeconds: null,
      tierCapLabelVi: null,
      beforeLabelVi: 'Tỷ lệ khung hình gốc',
      afterLabelVi: 'Vóc dáng đã cân chỉnh AI',
      accentGradient: 'from-cyan-500/25 via-slate-900 to-violet-600/25',
      inputRequirementVi: '1 ảnh toàn thân hoặc bán thân đủ ánh sáng',
      outputFormatVi: 'Ảnh PNG/JPEG chất lượng cao (kèm nhãn EXIF AI Generator)',
    },
    {
      id: 'motion-control',
      slug: 'motion-control',
      titleVi: 'Điều Khiển Chuyển Động Video',
      subtitleVi: 'Chuyển hóa ảnh tĩnh thành video chuyển động theo mẫu',
      descriptionVi:
        'Ánh xạ chuyển động từ video mẫu sang ảnh nhân vật tĩnh với bộ cắt thời lượng theo giây và tính phí chính xác theo độ dài.',
      category: 'video',
      categoryLabelVi: 'Chuyển động video AI',
      badgeVi: 'Motion GPU',
      icon: 'lucide:clapperboard',
      billingMode: 'per_second',
      unitCredits: motionControlCreditsPerSecond,
      priceBadgeVi: `${formatNumberVi(motionControlCreditsPerSecond)} credit / giây`,
      tierCapSeconds: maxVideoSeconds,
      tierCapLabelVi: `Tối đa ${formatNumberVi(maxVideoSeconds)} giây (Hạng ${activeTierConfig.tier})`,
      beforeLabelVi: 'Ảnh nhân vật + Video mẫu',
      afterLabelVi: 'Video chuyển động đồng bộ',
      accentGradient: 'from-violet-600/35 via-indigo-950 to-cyan-500/30',
      inputRequirementVi: '1 ảnh nhân vật rõ dáng + 1 video chuyển động mẫu',
      outputFormatVi: 'Video MP4 H.264 lưu trữ trên Cloudflare R2',
    },
  ];
}

export function calculateFeatureEstimatedCredits(
  feature: AiFeatureTool,
  durationSeconds = 1,
): number {
  if (feature.billingMode === 'per_second') {
    const maxSec = feature.tierCapSeconds ?? Math.max(1, durationSeconds);
    const clampedSeconds = Math.min(
      Math.max(1, Math.round(durationSeconds)),
      maxSec,
    );
    return clampedSeconds * feature.unitCredits;
  }
  return feature.unitCredits;
}
