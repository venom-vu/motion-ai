<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { TOS_VERSION, type AccountTier, type Task } from '@motion-ai/contracts';
import ImageUploader from '~/components/ImageUploader.vue';
import TaskProgressCard from '~/components/TaskProgressCard.vue';
import { useApiClient } from '~/composables/useApiClient';
import { useAuthDialog } from '~/composables/useAuthDialog';
import { usePricingConfig } from '~/composables/usePricingConfig';
import { resolveApiErrorMessageVi } from '~/utils/api-client';
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
      sourceKey?: string | null;
      targetKey?: string | null;
    },
  ];
}>();

const { client } = useApiClient();
const { open: openAuthDialog } = useAuthDialog();
const { refreshAll } = usePricingConfig();

const compareSplitPercent = ref<number>(50);
const selectedSeconds = ref<number>(1);
const uploadedKey = ref<string | null>(null);
const sourceKey = ref<string | null>(null);
const targetKey = ref<string | null>(null);
const acceptedConsent = ref<boolean>(false);
const activeTask = ref<Task | null>(null);
const isSubmitting = ref<boolean>(false);
const submitErrorVi = ref<string | null>(null);

const maxSeconds = computed<number>(() => {
  return props.feature?.tierCapSeconds ?? 1;
});

watch(
  () => props.feature,
  (nextFeature) => {
    compareSplitPercent.value = 50;
    uploadedKey.value = null;
    sourceKey.value = null;
    targetKey.value = null;
    acceptedConsent.value = false;
    activeTask.value = null;
    submitErrorVi.value = null;
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
      sourceKey.value = null;
      targetKey.value = null;
      acceptedConsent.value = false;
      activeTask.value = null;
      submitErrorVi.value = null;
    }
  },
  { immediate: true },
);

watch([uploadedKey, sourceKey, targetKey], () => {
  acceptedConsent.value = false;
});

const isAuthenticated = computed<boolean>(() => {
  return typeof props.userBalance === 'number';
});

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
  if (!isAuthenticated.value || typeof props.userBalance !== 'number') {
    return false;
  }
  return props.userBalance >= estimatedCredits.value;
});

const canSubmit = computed<boolean>(() => {
  if (!isAuthenticated.value || !hasEnoughBalance.value || isSubmitting.value) {
    return false;
  }
  if (props.feature?.id === 'face-swap') {
    return Boolean(sourceKey.value && targetKey.value && acceptedConsent.value);
  }
  return Boolean(uploadedKey.value && acceptedConsent.value);
});

async function handleSubmit(): Promise<void> {
  if (!props.feature || !canSubmit.value || isSubmitting.value) {
    return;
  }

  if (props.feature.id === 'face-swap') {
    isSubmitting.value = true;
    submitErrorVi.value = null;
    try {
      const task = await client.createFaceSwapTask({
        sourceKey: sourceKey.value!,
        targetKey: targetKey.value!,
        consent: true,
      });
      activeTask.value = task;
      void refreshAll();
      emit('submit', {
        featureId: props.feature.id,
        seconds: selectedSeconds.value,
        estimatedCredits: estimatedCredits.value,
        sourceKey: sourceKey.value,
        targetKey: targetKey.value,
      });
    } catch (error: unknown) {
      submitErrorVi.value = resolveApiErrorMessageVi(error);
    } finally {
      isSubmitting.value = false;
    }
  } else {
    emit('submit', {
      featureId: props.feature.id,
      seconds: selectedSeconds.value,
      estimatedCredits: estimatedCredits.value,
      uploadedKey: uploadedKey.value,
    });
  }
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

        <div class="flex items-center gap-2">
          <NuxtLink
            v-if="feature.id === 'face-swap'"
            to="/face-swap"
            class="touch-target hidden items-center gap-1.5 rounded-xl border border-cyber-border bg-cyber-bg px-3 py-2 text-xs font-semibold text-cyber-muted transition hover:border-cyber-cyan hover:text-cyber-cyan sm:inline-flex"
            @click="emit('close')"
          >
            <Icon name="lucide:maximize-2" class="h-3.5 w-3.5" />
            <span>Mở trang riêng</span>
          </NuxtLink>

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
      </div>

      <!-- Tiến trình tác vụ khi đã tạo (TaskProgressCard) -->
      <div v-if="activeTask" class="p-4 sm:p-6">
        <TaskProgressCard
          :task="activeTask"
          pipeline-label-vi="Hoán đổi khuôn mặt"
          @update:task="activeTask = $event"
          @retry="activeTask = null"
          @completed="void refreshAll()"
          @settled="void refreshAll()"
        />
      </div>

      <!-- Nội dung 2 cột trên Desktop, 1 cột trên Mobile khi chưa có activeTask -->
      <div v-else class="grid grid-cols-1 gap-6 p-4 sm:p-6 lg:grid-cols-12">
        <!-- Cột trái: Tải tệp & Điều chỉnh thông số (Trimmer bước 1 giây cho video) -->
        <div class="space-y-5 lg:col-span-6">
          <!-- Trường hợp Face Swap: Yêu cầu 2 ảnh (mặt nguồn + đích) theo Story 2.11 -->
          <div
            v-if="feature.id === 'face-swap'"
            class="space-y-4"
            data-testid="workspace-face-swap-inputs"
          >
            <!-- 1. Ảnh mặt nguồn -->
            <div class="space-y-3 rounded-xl border border-cyber-border bg-cyber-bg/60 p-4">
              <div class="flex items-center gap-2">
                <span
                  class="flex h-6 w-6 items-center justify-center rounded-lg border border-cyber-cyan/40 bg-cyber-cyan/15 font-mono text-xs font-bold text-cyber-cyan"
                >
                  1
                </span>
                <p class="text-sm font-semibold text-cyber-text">
                  Ảnh mặt nguồn (Khuôn mặt cần lấy)
                </p>
              </div>
              <ImageUploader
                v-model="sourceKey"
                id-prefix="workspace-source-face"
                label-vi="Chọn ảnh mặt nguồn"
                description-vi="Ảnh chân dung rõ mặt, JPG/PNG/WebP ≤ 10 MB"
                :show-tos-consent="false"
              />
            </div>

            <!-- 2. Ảnh đích -->
            <div class="space-y-3 rounded-xl border border-cyber-border bg-cyber-bg/60 p-4">
              <div class="flex items-center gap-2">
                <span
                  class="flex h-6 w-6 items-center justify-center rounded-lg border border-cyber-violet/40 bg-cyber-violet/15 font-mono text-xs font-bold text-cyber-violet"
                >
                  2
                </span>
                <p class="text-sm font-semibold text-cyber-text">
                  Ảnh đích (Bối cảnh muốn ghép)
                </p>
              </div>
              <ImageUploader
                v-model="targetKey"
                id-prefix="workspace-target-face"
                label-vi="Chọn ảnh đích"
                description-vi="Ảnh có người rõ dáng, JPG/PNG/WebP ≤ 10 MB"
                :show-tos-consent="false"
              />
            </div>

            <!-- Checkbox ToS theo FR19 -->
            <div class="rounded-xl border border-cyber-border bg-cyber-bg/70 p-3.5">
              <label
                for="workspace-face-swap-tos"
                class="touch-target flex min-h-[48px] items-start gap-3 text-xs text-cyber-muted transition"
                :class="{
                  'cursor-pointer': Boolean(sourceKey && targetKey),
                  'opacity-60 cursor-not-allowed': !sourceKey || !targetKey,
                }"
              >
                <input
                  id="workspace-face-swap-tos"
                  v-model="acceptedConsent"
                  :disabled="!sourceKey || !targetKey"
                  type="checkbox"
                  class="mt-0.5 h-4 w-4 shrink-0 accent-cyber-violet disabled:cursor-not-allowed"
                />
                <span class="leading-relaxed">
                  Tôi xác nhận đủ 18 tuổi, sở hữu quyền hợp pháp đối với cả hai ảnh tải lên, những người trong ảnh đã đồng ý cho xử lý và cam kết tuân thủ Điều khoản dịch vụ (phiên bản {{ TOS_VERSION }}).
                </span>
              </label>
            </div>
          </div>

          <!-- Các công cụ AI khác: Thành phần tải ảnh đơn dùng chung (Story 2.10) -->
          <div
            v-else
            class="rounded-xl border border-cyber-border bg-cyber-bg/60 p-4"
          >
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

          <!-- Banner lỗi nếu có -->
          <div
            v-if="submitErrorVi"
            class="rounded-xl border border-cyber-danger/40 bg-cyber-danger/10 p-3 text-xs text-cyber-danger"
          >
            {{ submitErrorVi }}
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

        <div
          v-if="!activeTask"
          class="flex flex-col items-stretch gap-2 sm:flex-row sm:items-center"
        >
          <!-- Nút đăng nhập cho khách chưa đăng nhập -->
          <button
            v-if="!isAuthenticated"
            type="button"
            data-testid="workspace-login-button"
            class="touch-target inline-flex min-h-[48px] min-w-[48px] items-center justify-center gap-2 rounded-xl border border-cyber-cyan/50 bg-cyber-cyan/15 px-4 py-2.5 text-xs font-semibold text-cyber-cyan transition hover:bg-cyber-cyan/25"
            @click="openAuthDialog('login')"
          >
            <Icon name="lucide:log-in" class="h-4 w-4" />
            <span>Đăng nhập để tạo tác vụ</span>
          </button>

          <NuxtLink
            v-else-if="!hasEnoughBalance"
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
            <Icon
              v-if="isSubmitting"
              name="lucide:loader-2"
              class="h-4 w-4 animate-spin"
            />
            <Icon v-else name="lucide:play" class="h-4 w-4" />
            <span>
              {{
                isSubmitting
                  ? 'Đang gửi yêu cầu...'
                  : `Tạo Tác Vụ AI (${formatNumberVi(estimatedCredits)} CR)`
              }}
            </span>
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
