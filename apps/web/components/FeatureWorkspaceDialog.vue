<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import type { AccountTier } from '@motion-ai/contracts';
import ImageUploader from '~/components/ImageUploader.vue';
import {
  calculateFeatureEstimatedCredits,
  formatNumberVi,
  type AiFeatureTool,
} from '~/utils/catalog';

const props = withDefaults(
  defineProps<{
    open: boolean;
    feature: AiFeatureTool | null;
    userTier?: AccountTier;
    userBalance?: number | null;
  }>(),
  {
    userTier: 'FREE',
    userBalance: null,
  },
);

const emit = defineEmits<{
  close: [];
  submit: [
    {
      featureId: string;
      seconds: number;
      estimatedCredits: number;
      uploadedKey?: string | null;
    },
  ];
}>();

const compareSplitPercent = ref<number>(50);
const selectedSeconds = ref<number>(1);
const uploadedKey = ref<string | null>(null);
const acceptedConsent = ref<boolean>(false);

const maxSeconds = computed<number>(() => {
  return props.feature?.tierCapSeconds ?? 1;
});

watch(
  () => props.feature,
  (nextFeature) => {
    compareSplitPercent.value = 50;
    uploadedKey.value = null;
    acceptedConsent.value = false;
    if (nextFeature?.tierCapSeconds) {
      selectedSeconds.value = Math.min(3, nextFeature.tierCapSeconds);
    } else {
      selectedSeconds.value = 1;
    }
  },
  { immediate: true },
);

watch(
  () => props.open,
  (isOpen) => {
    if (typeof document !== 'undefined') {
      document.body.style.overflow = isOpen ? 'hidden' : '';
    }
    if (!isOpen) {
      uploadedKey.value = null;
      acceptedConsent.value = false;
    }
  },
  { immediate: true },
);

const estimatedCredits = computed<number>(() => {
  if (!props.feature) {
    return 0;
  }
  return calculateFeatureEstimatedCredits(
    props.feature,
    selectedSeconds.value,
  );
});

const hasEnoughBalance = computed<boolean>(() => {
  if (typeof props.userBalance !== 'number') {
    return true;
  }
  return props.userBalance >= estimatedCredits.value;
});

const canSubmit = computed<boolean>(() => {
  if (!hasEnoughBalance.value) {
    return false;
  }
  return Boolean(uploadedKey.value && acceptedConsent.value);
});

function handleSubmit(): void {
  if (!props.feature || !canSubmit.value) {
    return;
  }
  emit('submit', {
    featureId: props.feature.id,
    seconds: selectedSeconds.value,
    estimatedCredits: estimatedCredits.value,
    uploadedKey: uploadedKey.value,
  });
}

function handleKeydown(event: KeyboardEvent): void {
  if (props.open && event.key === 'Escape') {
    emit('close');
  }
}

onMounted(() => {
  if (typeof window !== 'undefined') {
    window.addEventListener('keydown', handleKeydown);
  }
});

onBeforeUnmount(() => {
  if (typeof window !== 'undefined') {
    window.removeEventListener('keydown', handleKeydown);
  }
  if (typeof document !== 'undefined') {
    document.body.style.overflow = '';
  }
});
</script>

<template>
  <!-- Centered Dialog đồng nhất trên cả Mobile (360px) và Desktop (>= 1024px), max-width: 980px -->
  <div
    v-if="open && feature"
    role="dialog"
    aria-modal="true"
    :aria-labelledby="`workspace-dialog-title-${feature.id}`"
    data-testid="feature-workspace-dialog"
    class="fixed inset-0 z-50 flex items-center justify-center bg-cyber-bg/80 p-3 backdrop-blur-sm sm:p-6"
    @click.self="emit('close')"
  >
    <div
      class="relative max-h-[90dvh] w-full max-w-[980px] overflow-y-auto rounded-2xl border border-cyber-border bg-cyber-surface text-cyber-text shadow-2xl"
    >
      <!-- Header của Centered Dialog -->
      <div
        class="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-cyber-border bg-cyber-surface/95 px-4 py-3.5 backdrop-blur sm:px-6"
      >
        <div class="flex items-center gap-3">
          <span
            class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-cyber-violet/40 bg-cyber-violet/15 text-cyber-violet"
          >
            <Icon :name="feature.icon" class="h-5 w-5" />
          </span>
          <div>
            <h2
              :id="`workspace-dialog-title-${feature.id}`"
              class="font-display text-base font-bold sm:text-lg"
            >
              {{ feature.titleVi }}
            </h2>
            <p class="text-xs text-cyber-muted">
              {{ feature.categoryLabelVi }} • Hạng hiện tại:
              <span class="font-mono font-semibold text-cyber-cyan">
                {{ userTier }}
              </span>
            </p>
          </div>
        </div>

        <button
          type="button"
          aria-label="Đóng hộp thoại làm việc"
          data-testid="close-workspace-dialog"
          class="touch-target inline-flex min-h-[48px] min-w-[48px] items-center justify-center rounded-xl border border-cyber-border bg-cyber-bg/80 p-2.5 text-cyber-muted transition hover:border-cyber-violet hover:text-cyber-text"
          @click="emit('close')"
        >
          <Icon name="lucide:x" class="h-5 w-5" />
        </button>
      </div>

      <!-- Nội dung 2 cột trên Desktop, 1 cột trên Mobile -->
      <div class="grid grid-cols-1 gap-6 p-4 sm:p-6 lg:grid-cols-12">
        <!-- Cột trái: Tải tệp & Điều chỉnh thông số (Trimmer bước 1 giây cho video) -->
        <div class="space-y-5 lg:col-span-6">
          <!-- Thành phần tải ảnh có cam kết ToS dùng chung (Story 2.10) -->
          <div class="rounded-xl border border-cyber-border bg-cyber-bg/60 p-4">
            <div class="mb-4 flex items-start gap-3">
              <Icon
                name="lucide:upload-cloud"
                class="mt-0.5 h-6 w-6 shrink-0 text-cyber-violet"
              />
              <div class="space-y-1">
                <p class="text-sm font-semibold text-cyber-text">
                  Tải dữ liệu đầu vào
                </p>
                <p class="text-xs text-cyber-muted">
                  {{ feature.inputRequirementVi }}
                </p>
              </div>
            </div>

            <ImageUploader
              v-model="uploadedKey"
              v-model:consent="acceptedConsent"
              id-prefix="workspace-input"
              :label-vi="
                feature.titleVi
                  ? `Tải ảnh cho ${feature.titleVi}`
                  : 'Tải ảnh lên'
              "
              :description-vi="feature.inputRequirementVi"
            />
          </div>

          <!-- Bộ cắt video bước 1 giây (chỉ hiện với công cụ tính phí theo giây) -->
          <div
            v-if="feature.billingMode === 'per_second' && feature.tierCapSeconds"
            data-testid="workspace-video-trimmer"
            class="space-y-3 rounded-xl border border-cyber-border bg-cyber-bg/60 p-4"
          >
            <div class="flex items-center justify-between gap-2">
              <label
                for="video-trim-range"
                class="flex items-center gap-2 text-sm font-semibold text-cyber-text"
              >
                <Icon name="lucide:scissors" class="h-4 w-4 text-cyber-cyan" />
                <span>Độ dài video sau cắt (bước 1 giây)</span>
              </label>
              <span class="font-mono text-sm font-bold text-cyber-cyan">
                {{ selectedSeconds }}s / {{ maxSeconds }}s
              </span>
            </div>

            <input
              id="video-trim-range"
              v-model.number="selectedSeconds"
              type="range"
              min="1"
              :max="maxSeconds"
              step="1"
              class="touch-target min-h-[48px] w-full cursor-pointer accent-cyber-cyan"
            />

            <div class="flex items-center justify-between font-mono text-xs text-cyber-muted">
              <span>Tối thiểu: 1 giây</span>
              <span>
                Trần hạng {{ userTier }}: {{ maxSeconds }} giây
              </span>
            </div>
          </div>

          <!-- Bảng tính phí credit thời gian thực từ /config/pricing -->
          <div
            class="space-y-2 rounded-xl border border-cyber-cyan/30 bg-cyber-bg/80 p-4"
          >
            <div class="flex items-center justify-between text-xs text-cyber-muted">
              <span>Đơn giá công cụ (từ /config/pricing):</span>
              <span class="font-mono text-cyber-text">
                {{ feature.priceBadgeVi }}
              </span>
            </div>

            <div class="flex items-center justify-between border-t border-cyber-border/70 pt-2">
              <span class="text-sm font-semibold text-cyber-text">
                Chi phí tạm giữ (HOLD):
              </span>
              <span
                data-testid="workspace-estimated-credits"
                class="font-mono text-base font-bold text-cyber-cyan"
              >
                {{ formatNumberVi(estimatedCredits) }} credit
              </span>
            </div>

            <p class="text-xs text-cyber-muted">
              Hệ thống hoàn trả 100% credit (RELEASED) nếu tác vụ gặp lỗi xử lý.
            </p>
          </div>
        </div>

        <!-- Cột phải: Slider so sánh Before / After trực quan -->
        <div class="space-y-4 lg:col-span-6">
          <div
            class="rounded-xl border border-cyber-border bg-cyber-bg/70 p-4"
          >
            <div class="mb-3 flex items-center justify-between">
              <span class="flex items-center gap-2 text-sm font-semibold text-cyber-text">
                <Icon name="lucide:split-square-horizontal" class="h-4 w-4 text-cyber-violet" />
                <span>So sánh Trước / Sau AI</span>
              </span>
              <span class="font-mono text-xs text-cyber-cyan">
                {{ compareSplitPercent }}%
              </span>
            </div>

            <div
              class="relative h-48 overflow-hidden rounded-xl border border-cyber-border bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900"
            >
              <!-- Lớp ảnh Trước (nền) -->
              <div
                class="absolute inset-0 flex flex-col justify-between bg-cyber-surface/90 p-4"
              >
                <div class="flex items-center justify-between">
                  <span class="rounded bg-cyber-bg/80 px-2 py-0.5 font-mono text-[10px] uppercase text-cyber-muted">
                    Trước xử lý
                  </span>
                </div>
                <p class="text-xs font-medium text-cyber-text">
                  {{ feature.beforeLabelVi }}
                </p>
              </div>

              <!-- Lớp ảnh Sau (cắt theo compareSplitPercent) -->
              <div
                class="absolute inset-0 flex flex-col justify-between bg-cyber-cyan/15 p-4 backdrop-blur-[1px] transition-[clip-path]"
                :style="{ clipPath: `inset(0 0 0 ${compareSplitPercent}%)` }"
              >
                <div class="flex items-center justify-end">
                  <span class="rounded border border-cyber-cyan/40 bg-cyber-bg/90 px-2 py-0.5 font-mono text-[10px] uppercase text-cyber-cyan">
                    Sau xử lý AI
                  </span>
                </div>
                <p class="text-right text-xs font-medium text-cyber-cyan">
                  {{ feature.afterLabelVi }}
                </p>
              </div>

              <!-- Vạch chia đôi Before/After phát sáng theo DESIGN.md -->
              <div
                class="pointer-events-none absolute inset-y-0 w-0.5 bg-cyber-cyan shadow-[0_0_10px_#06B6D4]"
                :style="{ left: `${compareSplitPercent}%` }"
              >
                <div
                  class="absolute top-1/2 flex h-7 w-7 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-cyber-cyan text-black shadow-md"
                >
                  <Icon name="lucide:arrow-left-right" class="h-3.5 w-3.5" />
                </div>
              </div>
            </div>

            <div class="mt-3">
              <label
                for="before-after-slider"
                class="sr-only"
              >
                Thanh kéo so sánh trước và sau
              </label>
              <input
                id="before-after-slider"
                v-model.number="compareSplitPercent"
                type="range"
                min="0"
                max="100"
                step="1"
                class="touch-target min-h-[48px] w-full cursor-pointer accent-cyber-violet"
              />
            </div>

            <p class="mt-2 text-xs text-cyber-muted">
              Đầu ra: {{ feature.outputFormatVi }}
            </p>
          </div>
        </div>
      </div>

      <!-- Footer hành động của Centered Dialog -->
      <div
        class="flex flex-col-reverse items-stretch justify-between gap-3 border-t border-cyber-border bg-cyber-bg/60 px-4 py-4 sm:flex-row sm:items-center sm:px-6"
      >
        <button
          type="button"
          class="touch-target inline-flex min-h-[48px] min-w-[48px] items-center justify-center gap-2 rounded-xl border border-cyber-border bg-cyber-surface px-5 py-2.5 text-sm font-medium text-cyber-text transition hover:border-cyber-violet"
          @click="emit('close')"
        >
          <Icon name="lucide:arrow-left" class="h-4 w-4" />
          <span>Đóng Cửa Sổ</span>
        </button>

        <div class="flex flex-col items-stretch gap-2 sm:flex-row sm:items-center">
          <NuxtLink
            v-if="!hasEnoughBalance"
            to="/pricing"
            class="touch-target inline-flex min-h-[48px] min-w-[48px] items-center justify-center gap-2 rounded-xl border border-cyber-warning/50 bg-cyber-warning/15 px-4 py-2.5 text-xs font-semibold text-cyber-warning"
            @click="emit('close')"
          >
            <Icon name="lucide:alert-circle" class="h-4 w-4" />
            <span>Số dư không đủ — Nạp thêm Credit</span>
          </NuxtLink>

          <button
            type="button"
            data-testid="submit-task-button"
            :disabled="!canSubmit"
            class="touch-target inline-flex min-h-[48px] min-w-[48px] items-center justify-center gap-2 rounded-xl bg-cyber-violet px-6 py-3 text-sm font-semibold text-cyber-text transition hover:bg-cyber-violet/90 disabled:cursor-not-allowed disabled:opacity-50"
            @click="handleSubmit"
          >
            <Icon name="lucide:play" class="h-4 w-4" />
            <span>
              Tạo Tác Vụ AI ({{ formatNumberVi(estimatedCredits) }} CR)
            </span>
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
