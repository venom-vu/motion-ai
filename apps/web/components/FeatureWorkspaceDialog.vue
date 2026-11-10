<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import type { AccountTier, Task } from '@flowvis/contracts';
import ImageUploader from '~/components/ImageUploader.vue';
import TaskProgressCard from '~/components/TaskProgressCard.vue';
import { useApiClient } from '~/composables/useApiClient';
import { useAuthDialog } from '~/composables/useAuthDialog';
import { useMotionControl } from '~/composables/useMotionControl';
import { usePricingConfig } from '~/composables/usePricingConfig';
import {
  ApiErrorCode,
  INTENSITY_DEFAULT,
  INTENSITY_LABEL_ZONES,
  INTENSITY_MAX,
  INTENSITY_MIN,
  IntensitySchema,
  getIntensityLabelVi,
  resolveApiErrorMessageVi,
} from '~/utils/api-client';
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
      intensity?: number;
    },
  ];
}>();

const { client } = useApiClient();
const { open: openAuthDialog } = useAuthDialog();
const { refreshAll } = usePricingConfig();
const motion = useMotionControl();
// Liên kết cấp cao nhất để template tự mở `.value` (dùng chung logic với trang /motion-control).
const motionCharacterKey = motion.characterKey;
const motionCapSeconds = motion.capSeconds;
const motionSeconds = motion.seconds;
const motionInsufficientNoteVi = motion.insufficientNoteVi;
const motionSubmitErrorVi = motion.submitErrorVi;
const motionIsSubmitting = motion.isSubmitting;
const motionKey = ref<number>(0);

// Dọn sạch trạng thái Motion và buộc VideoTrimmer/ImageUploader remount.
function resetMotionState(): void {
  motion.clearState();
  motionKey.value += 1;
}
const onMotionTrimChange = motion.onTrimChange;

const compareSplitPercent = ref<number>(50);
const selectedSeconds = ref<number>(1);
const intensity = ref<number>(INTENSITY_DEFAULT);
const uploadedKey = ref<string | null>(null);
const sourceKey = ref<string | null>(null);
const targetKey = ref<string | null>(null);
const activeTask = ref<Task | null>(null);
const isSubmitting = ref<boolean>(false);
const submitErrorVi = ref<string | null>(null);

const intensityLabelVi = computed<string>(
  () => getIntensityLabelVi(intensity.value) ?? 'Tự nhiên',
);

const isValidIntensity = computed<boolean>(
  () => IntensitySchema.safeParse(intensity.value).success,
);

watch(
  () => props.feature,
  (nextFeature) => {
    compareSplitPercent.value = 50;
    intensity.value = INTENSITY_DEFAULT;
    uploadedKey.value = null;
    sourceKey.value = null;
    targetKey.value = null;
    activeTask.value = null;
    submitErrorVi.value = null;
    resetMotionState();
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
      intensity.value = INTENSITY_DEFAULT;
      uploadedKey.value = null;
      sourceKey.value = null;
      targetKey.value = null;
      activeTask.value = null;
      submitErrorVi.value = null;
      resetMotionState();
    }
  },
  { immediate: true },
);

// Xóa lỗi cũ khi người dùng thay đổi dữ liệu đầu vào hoặc mức intensity
watch(
  [uploadedKey, sourceKey, targetKey, intensity],
  () => {
    submitErrorVi.value = null;
  },
  { flush: 'sync' },
);

const isAuthenticated = computed<boolean>(() => {
  return typeof props.userBalance === 'number';
});

const isMotion = computed<boolean>(() => props.feature?.id === 'motion-control');

const estimatedCredits = computed<number>(() => {
  if (!props.feature) {
    return 0;
  }
  if (isMotion.value) {
    return motion.price.value ?? 0;
  }
  return calculateFeatureEstimatedCredits(
    props.feature,
    selectedSeconds.value,
  );
});

const hasEnoughBalance = computed<boolean>(() => {
  if (isMotion.value) {
    return (
      isAuthenticated.value &&
      motion.isAuthenticated.value &&
      motion.hasEnoughBalance.value
    );
  }
  if (!isAuthenticated.value || typeof props.userBalance !== 'number') {
    return false;
  }
  return props.userBalance >= estimatedCredits.value;
});

const canSubmit = computed<boolean>(() => {
  if (isMotion.value) {
    return (
      isAuthenticated.value &&
      motion.isAuthenticated.value &&
      !motionIsSubmitting.value &&
      motion.canSubmit.value
    );
  }
  if (!isAuthenticated.value || !hasEnoughBalance.value || isSubmitting.value) {
    return false;
  }
  if (props.feature?.id === 'face-swap') {
    return Boolean(sourceKey.value && targetKey.value);
  }
  if (props.feature?.id === 'body-retouch') {
    return Boolean(uploadedKey.value && isValidIntensity.value);
  }
  return Boolean(uploadedKey.value);
});

async function handleSubmit(): Promise<void> {
  if (!props.feature || isSubmitting.value) {
    return;
  }

  if (props.feature.id === 'body-retouch' && !isValidIntensity.value) {
    submitErrorVi.value = resolveApiErrorMessageVi(
      ApiErrorCode.VALIDATION_FAILED,
    );
    return;
  }

  if (!canSubmit.value) {
    return;
  }

  if (isMotion.value) {
    // Logic tạo Task dùng chung với trang /motion-control (composable useMotionControl).
    const seconds = motion.seconds.value;
    const credits = motion.price.value ?? 0;
    const task = await motion.submit();
    if (task) {
      activeTask.value = task;
      emit('submit', {
        featureId: props.feature.id,
        seconds,
        estimatedCredits: credits,
        uploadedKey: motion.characterKey.value,
      });
    }
    return;
  }

  if (props.feature.id === 'face-swap') {
    isSubmitting.value = true;
    submitErrorVi.value = null;
    try {
      const task = await client.createFaceSwapTask({
        sourceKey: sourceKey.value!,
        targetKey: targetKey.value!,
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
  } else if (props.feature.id === 'body-retouch') {
    isSubmitting.value = true;
    submitErrorVi.value = null;
    try {
      const parsedIntensity = IntensitySchema.parse(intensity.value);
      const task = await client.createBodyRetouchTask({
        imageKey: uploadedKey.value!,
        intensity: parsedIntensity,
      });
      activeTask.value = task;
      void refreshAll();
      emit('submit', {
        featureId: props.feature.id,
        seconds: selectedSeconds.value,
        estimatedCredits: estimatedCredits.value,
        uploadedKey: uploadedKey.value,
        intensity: parsedIntensity,
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

function handleRetry(): void {
  activeTask.value = null;
  if (isMotion.value) resetMotionState();
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
    class="fixed inset-0 !m-0 z-50 flex items-center justify-center bg-cyber-bg/80 p-3 backdrop-blur-sm sm:p-6"
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
            v-if="feature.id === 'face-swap' || feature.id === 'body-retouch' || feature.id === 'motion-control'"
            :to="feature.id === 'body-retouch' ? '/body-retouch' : feature.id === 'motion-control' ? '/motion-control' : '/face-swap'"
            data-testid="workspace-open-standalone-link"
            class="touch-target inline-flex min-h-[48px] items-center gap-1.5 rounded-xl border border-cyber-border bg-cyber-bg px-3 py-2 text-xs font-semibold text-cyber-muted transition hover:border-cyber-cyan hover:text-cyber-cyan"
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
          :pipeline-label-vi="
            feature.id === 'body-retouch'
              ? 'Chỉnh sửa vóc dáng'
              : feature.id === 'motion-control'
                ? 'Điều khiển chuyển động'
                : 'Hoán đổi khuôn mặt'
          "
          @update:task="activeTask = $event"
          @retry="handleRetry"
          @completed="void refreshAll()"
          @settled="void refreshAll()"
        />
      </div>

      <!-- Nội dung 2 cột trên Desktop, 1 cột trên Mobile khi chưa có activeTask -->
      <div v-else class="grid grid-cols-1 gap-5 p-4 sm:p-6 lg:grid-cols-12">
        <!-- Cột trái: Tải tệp & Điều chỉnh thông số (Trimmer bước 1 giây cho video) -->
        <div class="space-y-3.5 lg:col-span-6">
          <!-- Trường hợp Face Swap: Yêu cầu 2 ảnh (mặt nguồn + đích) theo Story 2.11 -->
          <div
            v-if="feature.id === 'face-swap'"
            class="space-y-3"
            data-testid="workspace-face-swap-inputs"
          >
            <!-- 1. Ảnh mặt nguồn -->
            <div class="space-y-2.5 rounded-xl border border-cyber-border bg-cyber-bg/60 p-3 sm:p-3.5">
              <div class="flex items-center gap-2">
                <span
                  class="flex h-5 w-5 items-center justify-center rounded-md border border-cyber-cyan/40 bg-cyber-cyan/15 font-mono text-[11px] font-bold text-cyber-cyan"
                >
                  1
                </span>
                <p class="text-xs font-semibold text-cyber-text sm:text-sm">
                  Ảnh mặt nguồn (Khuôn mặt cần lấy)
                </p>
              </div>
              <ImageUploader
                v-model="sourceKey"
                id-prefix="workspace-source-face"
                label-vi="Chọn ảnh mặt nguồn"
                description-vi="Ảnh chân dung rõ mặt, JPG/PNG/WebP ≤ 10 MB"
              />
            </div>

            <!-- 2. Ảnh đích -->
            <div class="space-y-2.5 rounded-xl border border-cyber-border bg-cyber-bg/60 p-3 sm:p-3.5">
              <div class="flex items-center gap-2">
                <span
                  class="flex h-5 w-5 items-center justify-center rounded-md border border-cyber-violet/40 bg-cyber-violet/15 font-mono text-[11px] font-bold text-cyber-violet"
                >
                  2
                </span>
                <p class="text-xs font-semibold text-cyber-text sm:text-sm">
                  Ảnh đích (Bối cảnh muốn ghép)
                </p>
              </div>
              <ImageUploader
                v-model="targetKey"
                id-prefix="workspace-target-face"
                label-vi="Chọn ảnh đích"
                description-vi="Ảnh có người rõ dáng, JPG/PNG/WebP ≤ 10 MB"
              />
            </div>
          </div>

          <!-- Các công cụ AI khác: Thành phần tải ảnh đơn dùng chung (Story 2.10) -->
          <div
            v-else
            class="rounded-xl border border-cyber-border bg-cyber-bg/60 p-3 sm:p-3.5"
          >
            <div class="mb-2.5 flex items-start gap-2.5">
              <Icon
                name="lucide:upload-cloud"
                class="mt-0.5 h-5 w-5 shrink-0 text-cyber-violet"
              />
              <div class="min-w-0 flex-1 space-y-0.5">
                <p class="text-xs font-semibold text-cyber-text sm:text-sm">
                  Tải dữ liệu đầu vào
                </p>
                <p class="truncate text-[11px] text-cyber-muted sm:whitespace-normal sm:text-xs">
                  {{ feature.inputRequirementVi }}
                </p>
              </div>
            </div>

            <ImageUploader
              v-if="feature.id === 'motion-control'"
              :key="`motion-char-${motionKey}`"
              v-model="motionCharacterKey"
              id-prefix="workspace-motion-character"
              label-vi="Chọn ảnh nhân vật"
              description-vi="Ảnh toàn thân rõ dáng, JPG/PNG/WebP ≤ 10 MB"
            />
            <ImageUploader
              v-else
              v-model="uploadedKey"
              id-prefix="workspace-input"
              :label-vi="
                feature.titleVi
                  ? `Tải ảnh cho ${feature.titleVi}`
                  : 'Tải ảnh lên'
              "
              :description-vi="feature.inputRequirementVi"
            />
          </div>

          <!-- Thanh trượt mức điều chỉnh nâng ngực (Body Retouch: intensity 1..10, bước 1, mặc định 5) -->
          <div
            v-if="feature.id === 'body-retouch'"
            data-testid="workspace-intensity-section"
            class="space-y-3 rounded-xl border border-cyber-border bg-cyber-bg/60 p-3 sm:p-3.5"
          >
            <div class="flex flex-wrap items-center justify-between gap-2">
              <label
                for="workspace-intensity-range"
                class="flex items-center gap-2 text-xs font-semibold text-cyber-text sm:text-sm"
              >
                <Icon name="lucide:sliders-horizontal" class="h-4 w-4 text-cyber-cyan" />
                <span>Mức độ nâng ngực</span>
              </label>
              <span
                data-testid="workspace-intensity-badge"
                class="inline-flex items-center gap-1.5 rounded-full border border-cyber-cyan/40 bg-cyber-cyan/15 px-3 py-1 font-mono text-xs font-bold text-cyber-cyan"
              >
                <span data-testid="workspace-intensity-value">Mức {{ intensity }}/{{ INTENSITY_MAX }}</span>
                <span>•</span>
                <span data-testid="workspace-intensity-label">{{ intensityLabelVi }}</span>
              </span>
            </div>

            <input
              id="workspace-intensity-range"
              v-model.number="intensity"
              type="range"
              :min="INTENSITY_MIN"
              :max="INTENSITY_MAX"
              step="1"
              data-testid="workspace-intensity-slider"
              aria-label="Mức điều chỉnh nâng ngực từ 1 đến 10"
              :aria-valuenow="intensity"
              :aria-valuemin="INTENSITY_MIN"
              :aria-valuemax="INTENSITY_MAX"
              :aria-valuetext="intensityLabelVi"
              class="touch-target min-h-[48px] w-full cursor-pointer accent-cyber-cyan"
            />

            <div
              data-testid="workspace-intensity-zones"
              class="grid grid-cols-3 gap-2 text-center text-[11px]"
            >
              <div
                v-for="zone in INTENSITY_LABEL_ZONES"
                :key="zone.label"
                :data-testid="`workspace-intensity-zone-${zone.min}-${zone.max}`"
                class="rounded-lg border px-2 py-1.5 transition"
                :class="[
                  intensity >= zone.min && intensity <= zone.max
                    ? 'border-cyber-cyan/50 bg-cyber-cyan/15 font-semibold text-cyber-cyan'
                    : 'border-cyber-border/60 bg-cyber-surface/40 text-cyber-muted',
                ]"
              >
                <div class="font-mono text-[10px]">
                  {{ zone.min }}–{{ zone.max }}
                </div>
                <div>{{ zone.label }}</div>
              </div>
            </div>
          </div>

          <!-- Banner lỗi nếu có -->
          <div
            v-if="submitErrorVi || motionSubmitErrorVi"
            data-testid="workspace-submit-error-banner"
            role="alert"
            aria-live="assertive"
            class="rounded-xl border border-cyber-danger/40 bg-cyber-danger/10 p-3 text-xs text-cyber-danger"
          >
            {{ submitErrorVi || motionSubmitErrorVi }}
          </div>

          <!-- Bộ cắt video bước 1 giây (VideoTrimmer, chỉ với Motion Control) -->
          <div
            v-if="isMotion"
            data-testid="workspace-video-trimmer"
            class="min-w-0 space-y-2.5 rounded-xl border border-cyber-border bg-cyber-bg/60 p-3 sm:p-3.5"
          >
            <p class="flex items-center gap-2 text-xs font-semibold text-cyber-text sm:text-sm">
              <Icon name="lucide:scissors" class="h-4 w-4 text-cyber-cyan" />
              <span>Video mẫu và đoạn cắt (bước 1 giây)</span>
            </p>
            <VideoTrimmer
              :key="`motion-video-${motionKey}`"
              id-prefix="workspace-motion-video"
              :cap-seconds="motionCapSeconds"
              :tier-name="userTier"
              @change="onMotionTrimChange"
            />
            <p
              v-if="motionSeconds > 0"
              data-testid="workspace-motion-seconds"
              class="font-mono text-xs text-cyber-muted"
            >
              Đoạn đã chọn: {{ motionSeconds }} giây
            </p>
            <p
              v-if="motionInsufficientNoteVi"
              data-testid="workspace-insufficient-note"
              class="text-xs font-semibold text-cyber-warning"
            >
              {{ motionInsufficientNoteVi }}
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

      <!-- Footer hành động của Centered Dialog: Ghim cố định ở đáy (sticky bottom-0 z-10) -->
      <div
        class="sticky bottom-0 z-10 flex flex-col gap-3 border-t border-cyber-border bg-cyber-surface/95 px-4 py-3.5 backdrop-blur sm:flex-row sm:items-center sm:justify-between sm:px-6"
      >
        <!-- Đơn giá công cụ -->
        <div class="flex items-center gap-2">
          <Icon name="lucide:zap" class="h-4 w-4 text-cyber-cyan" />
          <div class="flex items-center gap-1.5 text-xs">
            <span class="text-cyber-muted">Đơn giá công cụ:</span>
            <span class="font-mono font-bold text-cyber-cyan">
              {{ feature.priceBadgeVi }}
            </span>
          </div>
        </div>

        <div
          v-if="!activeTask"
          class="flex shrink-0 flex-col items-stretch gap-2 sm:flex-row sm:items-center"
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
              v-if="isSubmitting || (isMotion && motionIsSubmitting)"
              name="lucide:loader-2"
              class="h-4 w-4 animate-spin"
            />
            <Icon v-else name="lucide:play" class="h-4 w-4" />
            <span>
              {{
                isSubmitting || (isMotion && motionIsSubmitting)
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
