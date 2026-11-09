<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';

const props = withDefaults(
  defineProps<{
    sourceUrl?: string | null;
    resultUrl: string;
    alt?: string;
    disabled?: boolean;
    initialPosition?: number;
  }>(),
  {
    sourceUrl: null,
    alt: 'Ảnh kết quả',
    disabled: false,
    initialPosition: 50,
  },
);

const emit = defineEmits<{
  (e: 'imageError', payload: { type: 'source' | 'result'; error: Event }): void;
  (e: 'positionChange', position: number): void;
}>();

const containerRef = ref<HTMLElement | null>(null);
const sliderPosition = ref<number>(
  Math.max(0, Math.min(100, props.initialPosition)),
);
const isDragging = ref<boolean>(false);
const sourceLoadFailed = ref<boolean>(false);

watch(
  () => props.initialPosition,
  (p) => {
    sliderPosition.value = clampPosition(p);
  },
);

watch(
  () => props.sourceUrl,
  () => {
    sourceLoadFailed.value = false;
  },
);

const hasSource = computed<boolean>(() => {
  return (
    typeof props.sourceUrl === 'string' &&
    props.sourceUrl.trim().length > 0 &&
    !sourceLoadFailed.value
  );
});

function clampPosition(val: number): number {
  return Math.max(0, Math.min(100, Math.round(val * 10) / 10));
}

function updatePositionFromClientX(clientX: number): void {
  if (!containerRef.value) return;
  const rect = containerRef.value.getBoundingClientRect();
  if (rect.width <= 0) return;
  const rawPos = ((clientX - rect.left) / rect.width) * 100;
  const clamped = clampPosition(rawPos);
  sliderPosition.value = clamped;
  emit('positionChange', clamped);
}

function handlePointerDown(event: PointerEvent): void {
  if (event.button !== 0 || props.disabled || !hasSource.value) return;
  isDragging.value = true;
  updatePositionFromClientX(event.clientX);
  const target = event.currentTarget as HTMLElement | null;
  if (target && typeof target.setPointerCapture === 'function') {
    try {
      target.setPointerCapture(event.pointerId);
    } catch {
      // Bỏ qua nếu môi trường không hỗ trợ pointer capture
    }
  }
}

function handlePointerMove(event: PointerEvent): void {
  if (!isDragging.value || (event.pointerType === 'mouse' && event.buttons === 0)) {
    isDragging.value = false;
    return;
  }
  updatePositionFromClientX(event.clientX);
}

function handlePointerUp(event: PointerEvent): void {
  if (!isDragging.value) return;
  isDragging.value = false;
  const target = event.currentTarget as HTMLElement | null;
  if (target && typeof target.releasePointerCapture === 'function') {
    try {
      target.releasePointerCapture(event.pointerId);
    } catch {
      // Bỏ qua
    }
  }
}

function handleKeydown(event: KeyboardEvent): void {
  if (props.disabled || !hasSource.value) return;
  let newPos = sliderPosition.value;
  switch (event.key) {
    case 'ArrowLeft':
    case 'ArrowDown':
      newPos = Math.max(0, newPos - 5);
      break;
    case 'ArrowRight':
    case 'ArrowUp':
      newPos = Math.min(100, newPos + 5);
      break;
    case 'Home':
      newPos = 0;
      break;
    case 'End':
      newPos = 100;
      break;
    default:
      return;
  }
  event.preventDefault();
  sliderPosition.value = newPos;
  emit('positionChange', newPos);
}

function onSourceError(event: Event): void {
  sourceLoadFailed.value = true;
  emit('imageError', { type: 'source', error: event });
}

function onResultError(event: Event): void {
  emit('imageError', { type: 'result', error: event });
}

onBeforeUnmount(() => {
  isDragging.value = false;
});
</script>

<template>
  <div
    data-testid="before-after-split-slider"
    class="relative w-full select-none overflow-hidden rounded-2xl border border-cyber-border bg-cyber-surface/90 p-3 sm:p-4"
  >
    <!-- Khung hiển thị ảnh -->
    <div
      ref="containerRef"
      data-testid="split-slider-canvas"
      class="relative h-[320px] w-full overflow-hidden rounded-xl bg-cyber-bg sm:h-[400px] md:h-[440px]"
      :style="{ touchAction: hasSource ? 'pan-y' : 'auto' }"
      @pointerdown="handlePointerDown"
      @pointermove="handlePointerMove"
      @pointerup="handlePointerUp"
      @pointercancel="handlePointerUp"
    >
      <!-- Chế độ 1 ảnh: Khi không có ảnh gốc (sourceUrl null hoặc quá 7 ngày) -->
      <template v-if="!hasSource">
        <div class="relative h-full w-full">
          <img
            :src="resultUrl"
            :alt="alt"
            draggable="false"
            data-testid="single-result-image"
            class="h-full w-full object-contain"
            @error="onResultError"
          />
          <div class="absolute right-3 top-3 flex flex-col items-end gap-1">
            <span
              data-testid="single-result-tag"
              class="rounded-md border border-cyber-cyan/40 bg-cyber-bg/85 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider text-cyber-cyan backdrop-blur"
            >
              Kết Quả AI
            </span>
            <span
              data-testid="source-expired-note"
              class="rounded border border-cyber-border bg-cyber-bg/85 px-2 py-0.5 text-[10px] text-cyber-muted backdrop-blur"
            >
              Ảnh gốc đã hết hạn lưu
            </span>
          </div>
        </div>
      </template>

      <!-- Chế độ 2 ảnh: So sánh Before / After -->
      <template v-else>
        <!-- Lớp Before (Ảnh gốc - hiển thị toàn khung phía dưới) -->
        <div
          data-testid="before-layer"
          class="absolute inset-0 h-full w-full"
        >
          <img
            v-if="sourceUrl"
            :src="sourceUrl"
            :alt="`${alt} (ảnh gốc)`"
            draggable="false"
            data-testid="source-image"
            class="h-full w-full object-contain"
            @error="onSourceError"
          />
        </div>

        <!-- Lớp After (Ảnh kết quả AI - được clip theo sliderPosition) -->
        <div
          data-testid="after-layer"
          class="absolute inset-0 h-full w-full"
          :style="{ clipPath: `inset(0 0 0 ${sliderPosition}%)` }"
        >
          <img
            :src="resultUrl"
            :alt="`${alt} (kết quả)`"
            draggable="false"
            data-testid="result-image"
            class="h-full w-full object-contain"
            @error="onResultError"
          />
        </div>

        <!-- Lớp overlay nhãn hiển thị cố định không bị cắt bởi clipPath -->
        <div class="pointer-events-none absolute inset-0 z-10 flex items-start justify-between p-3">
          <span
            data-testid="tag-before"
            class="rounded-md border border-cyber-border bg-cyber-bg/85 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider text-cyber-muted backdrop-blur transition-opacity duration-150"
            :class="{ 'opacity-25': sliderPosition < 12 }"
          >
            Ảnh Gốc
          </span>
          <span
            data-testid="tag-after"
            class="rounded-md border border-cyber-cyan/40 bg-cyber-bg/85 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider text-cyber-cyan backdrop-blur transition-opacity duration-150"
            :class="{ 'opacity-25': sliderPosition > 88 }"
          >
            Kết Quả AI
          </span>
        </div>

        <!-- Đường phân cách và núm trượt 36px -->
        <div
          data-testid="slider-divider"
          class="absolute inset-y-0 z-20 w-0.5 -translate-x-1/2 bg-cyber-cyan shadow-[0_0_10px_#06B6D4]"
          :style="{ left: `${sliderPosition}%` }"
        >
          <button
            type="button"
            data-testid="slider-knob"
            role="slider"
            aria-orientation="horizontal"
            :aria-valuenow="Math.round(sliderPosition)"
            :aria-valuetext="`${100 - Math.round(sliderPosition)}% ảnh kết quả, ${Math.round(sliderPosition)}% ảnh gốc`"
            aria-valuemin="0"
            aria-valuemax="100"
            aria-label="Thanh trượt so sánh trước sau"
            :disabled="disabled"
            tabindex="0"
            class="touch-target absolute top-1/2 flex -translate-x-1/2 -translate-y-1/2 cursor-ew-resize items-center justify-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyber-cyan focus-visible:ring-offset-2 focus-visible:ring-offset-cyber-bg disabled:cursor-not-allowed disabled:opacity-50"
            @keydown="handleKeydown"
          >
            <span
              class="flex h-9 w-9 items-center justify-center rounded-full border border-cyber-cyan bg-cyber-cyan text-black shadow-[0_0_16px_rgba(6,182,212,0.8),0_4px_8px_rgba(0,0,0,0.5)] transition hover:scale-105"
            >
              <Icon
                name="lucide:arrow-left-right"
                class="h-4.5 w-4.5 shrink-0"
                aria-hidden="true"
              />
            </span>
          </button>
        </div>
      </template>
    </div>

    <!-- Thanh chỉ dẫn cho người dùng khi có 2 ảnh -->
    <div
      v-if="hasSource"
      data-testid="slider-hint-bar"
      class="mt-2.5 flex items-center justify-center gap-1.5 text-center text-xs text-cyber-muted"
    >
      <Icon name="lucide:chevron-left" class="h-3.5 w-3.5 shrink-0" />
      <span>Trượt thanh ngang để so sánh Before/After trực tiếp</span>
      <Icon name="lucide:chevron-right" class="h-3.5 w-3.5 shrink-0" />
    </div>
  </div>
</template>
