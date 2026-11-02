<script setup lang="ts">
import { usePricingConfig } from '~/composables/usePricingConfig';
import { formatNumberVi, formatVndVi } from '~/utils/catalog';

const {
  pricing,
  currentTier,
  isLoading,
  errorMessageVi,
  refreshAll,
  clearError,
} = usePricingConfig();
</script>

<template>
  <div class="space-y-6" data-testid="page-pricing">
    <section
      class="rounded-2xl border border-cyber-border bg-cyber-surface p-5 sm:p-6"
    >
      <div class="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <div class="space-y-1">
          <h1 class="font-display text-2xl font-bold text-cyber-text">
            Bảng Giá Gói Nạp & Quyền Lợi Hạng Tài Khoản
          </h1>
          <p class="text-sm text-cyber-muted">
            Mọi đơn giá công cụ, trần giây video và gói nạp dưới đây được đồng bộ
            trực tiếp từ <span class="font-mono text-cyber-cyan">GET /config/pricing</span>.
          </p>
        </div>

        <span
          class="inline-flex items-center gap-2 self-start rounded-xl border border-cyber-cyan/40 bg-cyber-bg px-3.5 py-2 font-mono text-xs font-semibold text-cyber-cyan sm:self-center"
        >
          <Icon name="lucide:award" class="h-4 w-4" />
          <span>Hạng hiện tại: {{ currentTier }}</span>
        </span>
      </div>
    </section>

    <ApiErrorBanner
      :message-vi="errorMessageVi"
      @retry="refreshAll"
      @dismiss="clearError"
    />

    <div
      v-if="isLoading && !pricing"
      class="rounded-2xl border border-cyber-border bg-cyber-surface p-8 text-center text-sm text-cyber-muted"
    >
      Đang tải bảng giá từ hệ thống...
    </div>

    <template v-else-if="pricing">
      <!-- Bảng đơn giá từng pipeline từ pricing.pipelines -->
      <section
        data-testid="pricing-pipelines-section"
        class="grid grid-cols-1 gap-4 sm:grid-cols-3"
      >
        <div class="rounded-2xl border border-cyber-border bg-cyber-surface p-4">
          <div class="flex items-center gap-2 text-xs text-cyber-muted">
            <Icon name="lucide:scan-face" class="h-4 w-4 text-cyber-violet" />
            <span>Hoán Đổi Khuôn Mặt (Face Swap)</span>
          </div>
          <p class="mt-2 font-mono text-xl font-bold text-cyber-cyan">
            {{ formatNumberVi(pricing.pipelines.faceSwapCredits) }} credit / lượt
          </p>
        </div>

        <div class="rounded-2xl border border-cyber-border bg-cyber-surface p-4">
          <div class="flex items-center gap-2 text-xs text-cyber-muted">
            <Icon name="lucide:person-standing" class="h-4 w-4 text-cyber-violet" />
            <span>Chỉnh Dáng (Body Retouch)</span>
          </div>
          <p class="mt-2 font-mono text-xl font-bold text-cyber-cyan">
            {{ formatNumberVi(pricing.pipelines.bodyRetouchCredits) }} credit / lượt
          </p>
        </div>

        <div class="rounded-2xl border border-cyber-border bg-cyber-surface p-4">
          <div class="flex items-center gap-2 text-xs text-cyber-muted">
            <Icon name="lucide:clapperboard" class="h-4 w-4 text-cyber-violet" />
            <span>Điều Khiển Chuyển Động (Motion Control)</span>
          </div>
          <p class="mt-2 font-mono text-xl font-bold text-cyber-cyan">
            {{ formatNumberVi(pricing.pipelines.motionControlCreditsPerSecond) }} credit / giây
          </p>
        </div>
      </section>

      <!-- Danh sách các gói nạp và Tier từ pricing.tiers -->
      <section
        aria-label="Danh sách các hạng tài khoản"
        data-testid="pricing-tiers-grid"
        class="grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-4"
      >
        <article
          v-for="tierItem in pricing.tiers"
          :key="tierItem.tier"
          :data-testid="`tier-card-${tierItem.tier}`"
          class="flex flex-col justify-between rounded-2xl border bg-cyber-surface p-5"
          :class="
            tierItem.tier === currentTier
              ? 'border-cyber-violet'
              : 'border-cyber-border'
          "
        >
          <div class="space-y-3">
            <div class="flex items-center justify-between">
              <h2 class="font-display text-lg font-bold text-cyber-text">
                Hạng {{ tierItem.tier }}
              </h2>
              <span
                class="rounded-full border border-cyber-border bg-cyber-bg px-2.5 py-0.5 font-mono text-xs text-cyber-muted"
              >
                Ưu tiên #{{ tierItem.priority }}
              </span>
            </div>

            <p class="font-mono text-2xl font-bold text-cyber-cyan">
              {{ formatVndVi(tierItem.priceVnd) }}
            </p>

            <ul class="space-y-2 border-t border-cyber-border pt-3 text-xs text-cyber-muted">
              <li class="flex items-center gap-2">
                <Icon name="lucide:coins" class="h-4 w-4 text-cyber-cyan" />
                <span>
                  Số lượng:
                  <strong class="font-mono text-cyber-text">
                    {{ formatNumberVi(tierItem.credits) }} credit
                  </strong>
                </span>
              </li>
              <li class="flex items-center gap-2">
                <Icon name="lucide:timer" class="h-4 w-4 text-cyber-violet" />
                <span>
                  Trần video Motion:
                  <strong class="font-mono text-cyber-text">
                    {{ formatNumberVi(tierItem.maxVideoSeconds) }} giây
                  </strong>
                </span>
              </li>
            </ul>
          </div>

          <div class="mt-5 pt-2">
            <button
              type="button"
              class="touch-target inline-flex min-h-[48px] min-w-[48px] w-full items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-xs font-semibold transition"
              :class="
                tierItem.packId
                  ? 'bg-cyber-violet text-cyber-text hover:bg-cyber-violet/90'
                  : 'border border-cyber-border bg-cyber-bg text-cyber-muted'
              "
            >
              <Icon
                :name="tierItem.packId ? 'lucide:qr-code' : 'lucide:check'"
                class="h-4 w-4"
              />
              <span>
                {{
                  tierItem.packId
                    ? `Nạp gói ${tierItem.tier} qua VietQR`
                    : 'Hạng mặc định khi đăng ký'
                }}
              </span>
            </button>
          </div>
        </article>
      </section>
    </template>
  </div>
</template>
