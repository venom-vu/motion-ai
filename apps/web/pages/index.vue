<script setup lang="ts">
import { computed, ref } from 'vue';
import { isOutOfCredit } from '~/utils/auth-session';
import { usePricingConfig } from '~/composables/usePricingConfig';
import {
  FEATURE_CATEGORIES,
  formatNumberVi,
  type AiFeatureTool,
  type FeatureCategoryId,
} from '~/utils/catalog';

const {
  pricing,
  me,
  currentTier,
  currentTierCapSeconds,
  features,
  isLoading,
  errorMessageVi,
  refreshAll,
  clearError,
} = usePricingConfig();

const selectedCategory = ref<FeatureCategoryId>('all');
const searchKeyword = ref<string>('');
const activeFeature = ref<AiFeatureTool | null>(null);
const isWorkspaceOpen = ref<boolean>(false);

function normalizeTextVi(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

const filteredFeatures = computed<AiFeatureTool[]>(() => {
  const rawKeyword = searchKeyword.value.trim();
  const normalizedKeyword = normalizeTextVi(rawKeyword);
  return features.value.filter((tool) => {
    const matchesCategory =
      selectedCategory.value === 'all' ||
      tool.category === selectedCategory.value;
    if (!matchesCategory) {
      return false;
    }
    if (!normalizedKeyword) {
      return true;
    }
    const titleNorm = normalizeTextVi(tool.titleVi);
    const subtitleNorm = normalizeTextVi(tool.subtitleVi);
    const descNorm = normalizeTextVi(tool.descriptionVi);
    return (
      titleNorm.includes(normalizedKeyword) ||
      subtitleNorm.includes(normalizedKeyword) ||
      descNorm.includes(normalizedKeyword)
    );
  });
});

function openWorkspace(feature: AiFeatureTool): void {
  activeFeature.value = feature;
  isWorkspaceOpen.value = true;
}

function closeWorkspace(): void {
  isWorkspaceOpen.value = false;
}
</script>

<template>
  <div class="flex flex-col gap-6" data-testid="page-catalog">
    <!-- Banner thông tin Kho Công Cụ AI và thông số động từ /config/pricing -->
    <section
      class="rounded-2xl border border-cyber-border bg-gradient-to-br from-cyber-surface via-slate-900 to-cyber-bg p-5 sm:p-6"
    >
      <div
        class="flex flex-col justify-between gap-4 lg:flex-row lg:items-center"
      >
        <div class="space-y-2">
          <div class="inline-flex items-center gap-2 rounded-full border border-cyber-violet/40 bg-cyber-violet/15 px-3 py-1 text-xs font-medium text-cyber-violet">
            <Icon name="lucide:cpu" class="h-3.5 w-3.5" />
            <span>Kho Công Cụ AI Thế Hệ Mới</span>
          </div>
          <h1 class="font-display text-2xl font-bold tracking-tight text-cyber-text sm:text-3xl">
            Chọn Công Cụ AI Và Mở Không Gian Làm Việc
          </h1>
          <p class="max-w-2xl text-sm text-cyber-muted">
            Chạm vào bất kỳ thẻ tính năng nào bên dưới để mở hộp thoại làm việc
            trung tâm, xem so sánh Trước / Sau và ước tính chi phí credit theo
            thời gian thực.
          </p>
        </div>

        <div
          v-if="pricing"
          data-testid="catalog-pricing-summary"
          class="grid grid-cols-2 gap-3 rounded-xl border border-cyber-border bg-cyber-bg/75 p-3.5 sm:grid-cols-3"
        >
          <div>
            <span class="block text-[11px] text-cyber-muted">
              Thưởng đăng ký
            </span>
            <span class="font-mono text-sm font-bold text-cyber-cyan">
              {{ formatNumberVi(pricing.trialGrantCredits) }} CR
            </span>
          </div>
          <div>
            <span class="block text-[11px] text-cyber-muted">
              Trần video ({{ currentTier }})
            </span>
            <span class="font-mono text-sm font-bold text-cyber-text">
              {{ formatNumberVi(currentTierCapSeconds ?? 0) }} giây
            </span>
          </div>
          <div class="col-span-2 sm:col-span-1">
            <span class="block text-[11px] text-cyber-muted">
              Ngưỡng giữ hạng
            </span>
            <span class="font-mono text-sm font-bold text-cyber-violet">
              {{ formatNumberVi(pricing.tierFloorCredits) }} CR
            </span>
          </div>
        </div>
      </div>
    </section>

    <!-- Nhắc nạp khi hết credit -->
    <section
      v-if="isOutOfCredit(me)"
      data-testid="zero-credit-notice"
      role="status"
      class="flex flex-col gap-3 rounded-2xl border border-cyber-warning/50 bg-cyber-surface p-4 sm:flex-row sm:items-center sm:justify-between"
    >
      <div class="flex items-center gap-3 text-sm text-cyber-text">
        <Icon name="lucide:coins" class="h-5 w-5 shrink-0 text-cyber-warning" />
        <span>Bạn đã hết credit. Hãy nạp thêm credit để tiếp tục tạo tác vụ AI.</span>
      </div>
      <NuxtLink
        to="/pricing"
        class="touch-target inline-flex min-h-[48px] min-w-[48px] items-center justify-center gap-2 rounded-xl bg-cyber-violet px-4 py-2.5 text-xs font-semibold text-cyber-text hover:bg-cyber-violet/90"
      >
        <Icon name="lucide:plus-circle" class="h-4 w-4" />
        <span>Nạp Credit</span>
      </NuxtLink>
    </section>

    <!-- Banner thông báo lỗi tiếng Việt (nếu có) -->
    <ApiErrorBanner
      :message-vi="errorMessageVi"
      @retry="refreshAll"
      @dismiss="clearError"
    />

    <!-- Thanh lọc danh mục + ô tìm kiếm (vùng chạm >= 48px) -->
    <section
      aria-label="Bộ lọc và tìm kiếm công cụ AI"
      class="flex flex-col gap-3 rounded-2xl border border-cyber-border bg-cyber-surface/75 p-4 lg:flex-row lg:items-center lg:justify-between"
    >
      <div class="flex flex-wrap items-center gap-2">
        <button
          v-for="cat in FEATURE_CATEGORIES"
          :key="cat.id"
          type="button"
          :data-testid="`filter-category-${cat.id}`"
          class="touch-target inline-flex min-h-[48px] min-w-[48px] items-center gap-2 rounded-xl border px-4 py-2.5 text-xs font-semibold transition"
          :class="
            selectedCategory === cat.id
              ? 'border-cyber-violet bg-cyber-violet text-cyber-text'
              : 'border-cyber-border bg-cyber-bg/70 text-cyber-muted hover:border-cyber-violet/60 hover:text-cyber-text'
          "
          @click="selectedCategory = cat.id"
        >
          <Icon :name="cat.icon" class="h-4 w-4 shrink-0" />
          <span>{{ cat.labelVi }}</span>
        </button>
      </div>

      <div class="relative w-full lg:max-w-xs">
        <label for="catalog-search-input" class="sr-only">
          Tìm kiếm công cụ AI
        </label>
        <Icon
          name="lucide:search"
          class="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-cyber-muted"
        />
        <input
          id="catalog-search-input"
          v-model="searchKeyword"
          type="search"
          placeholder="Tìm kiếm công cụ AI..."
          class="touch-target min-h-[48px] w-full rounded-xl border border-cyber-border bg-cyber-bg pl-10 pr-4 text-sm text-cyber-text placeholder-cyber-muted focus:border-cyber-violet focus:outline-none"
        />
      </div>
    </section>

    <!-- Trạng thái đang tải bảng giá -->
    <div
      v-if="isLoading && !pricing"
      class="flex items-center justify-center gap-3 rounded-2xl border border-cyber-border bg-cyber-surface p-10 text-sm text-cyber-muted"
    >
      <Icon name="lucide:loader-circle" class="h-5 w-5 animate-spin text-cyber-violet" />
      <span>Đang tải cấu hình công cụ và bảng giá từ hệ thống...</span>
    </div>

    <!-- Danh sách / Lưới Card Tính Năng: 1 cột trên Mobile (360px), 3 cột trên Desktop (>= 1024px) -->
    <section
      v-else-if="filteredFeatures.length > 0"
      aria-label="Danh sách công cụ AI"
      data-testid="feature-card-grid"
      class="grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-3"
    >
      <FeatureCard
        v-for="item in filteredFeatures"
        :key="item.id"
        :feature="item"
        @select="openWorkspace"
      />
    </section>

    <!-- Trạng thái lỗi không tải được bảng giá -->
    <div
      v-else-if="!pricing"
      data-testid="catalog-load-error"
      class="flex flex-col items-center justify-center gap-3 rounded-2xl border border-cyber-danger/40 bg-cyber-surface p-10 text-center"
    >
      <Icon name="lucide:alert-circle" class="h-8 w-8 text-cyber-danger" />
      <p class="text-sm font-medium text-cyber-text">
        Không thể tải cấu hình công cụ AI từ hệ thống.
      </p>
      <button
        type="button"
        class="touch-target inline-flex min-h-[48px] min-w-[48px] items-center justify-center gap-2 rounded-xl bg-cyber-violet px-4 py-2.5 text-xs font-semibold text-cyber-text hover:bg-cyber-violet/90"
        @click="refreshAll"
      >
        <Icon name="lucide:refresh-cw" class="h-4 w-4" />
        <span>Thử tải lại</span>
      </button>
    </div>

    <!-- Trạng thái không tìm thấy công cụ khớp từ khóa -->
    <div
      v-else
      class="flex flex-col items-center justify-center gap-3 rounded-2xl border border-cyber-border bg-cyber-surface p-10 text-center"
    >
      <Icon name="lucide:search-x" class="h-8 w-8 text-cyber-muted" />
      <p class="text-sm font-medium text-cyber-text">
        Không tìm thấy công cụ AI phù hợp với bộ lọc hiện tại.
      </p>
      <button
        type="button"
        class="touch-target inline-flex min-h-[48px] min-w-[48px] items-center justify-center gap-2 rounded-xl border border-cyber-border bg-cyber-bg px-4 py-2.5 text-xs font-semibold text-cyber-text hover:border-cyber-violet"
        @click="
          selectedCategory = 'all';
          searchKeyword = '';
        "
      >
        <Icon name="lucide:rotate-ccw" class="h-4 w-4" />
        <span>Đặt lại bộ lọc</span>
      </button>
    </div>

    <!-- Centered Dialog làm việc (max-width: 980px) dùng chung Mobile & Desktop -->
    <FeatureWorkspaceDialog
      :open="isWorkspaceOpen"
      :feature="activeFeature"
      :user-tier="currentTier"
      :user-balance="me?.balance ?? null"
      @close="closeWorkspace"
    />
  </div>
</template>
