<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import {
  getValidationReasonMessageVi,
  MAX_VIDEO_BYTES,
  MOTION_MIN_TRIM_SECONDS,
  type VideoMimeType,
} from '@flowvis/contracts';
import { useApiClient } from '~/composables/useApiClient';
import { useUploadFlow } from '~/composables/useUploadFlow';
import { formatFileSizeVi, validateVideoFile } from '~/utils/image-upload';
import {
  computeTrimLimits,
  defaultTrim,
  formatClock,
  moveEnd,
  moveStart,
  normalizeTrim,
  type TrimRange,
} from '~/utils/video-trim';

const props = withDefaults(
  defineProps<{
    /** Cap giây theo Tier hiện tại (từ GET /me + GET /config/pricing). */
    capSeconds?: number | null;
    tierName?: string | null;
    disabled?: boolean;
    idPrefix?: string;
  }>(),
  { capSeconds: null, tierName: null, disabled: false, idPrefix: 'video-trimmer' },
);

const emit = defineEmits<{
  change: [
    payload: {
      videoKey: string | null;
      trimStart: number;
      trimEnd: number;
      durationSeconds: number;
    },
  ];
  error: [messageVi: string];
}>();

const { client } = useApiClient();
const flow = useUploadFlow(client);
const uploadProgress = flow.progress;

type Status = 'idle' | 'validating' | 'uploading' | 'ready' | 'error';
const status = ref<Status>('idle');
const inputRef = ref<HTMLInputElement | null>(null);
const trackRef = ref<HTMLElement | null>(null);
const videoElRef = ref<HTMLVideoElement | null>(null);

const currentFile = ref<File | null>(null);
const previewUrl = ref<string | null>(null);
const clientDuration = ref(0);
const validatedMime = ref<string>('video/mp4');
const serverDuration = ref<number | null>(null);
const confirmedKey = ref<string | null>(null);
const errorMessageVi = ref<string | null>(null);
const range = ref<TrimRange>({ start: 0, end: 0 });
const isPortrait = ref(false);
const activeHandle = ref<'start' | 'end' | null>(null);
let unmounted = false;

const durationSeconds = computed(() => serverDuration.value ?? clientDuration.value);
const limits = computed(() => computeTrimLimits(durationSeconds.value, props.capSeconds));
const hasVideo = computed(() => status.value !== 'idle' && currentFile.value !== null);
const selectedLength = computed(() => range.value.end - range.value.start);
const capLimited = computed(
  () =>
    typeof props.capSeconds === 'number' &&
    props.capSeconds > 0 &&
    (Math.floor(durationSeconds.value) > props.capSeconds ||
      props.capSeconds < MOTION_MIN_TRIM_SECONDS),
);
const total = computed(() => Math.max(1, limits.value.total));
const startPct = computed(() => (range.value.start / total.value) * 100);
const endPct = computed(() => (range.value.end / total.value) * 100);
const isBusy = computed(() => status.value === 'uploading' || status.value === 'validating');

function revokePreview(): void {
  if (previewUrl.value && typeof URL !== 'undefined') {
    URL.revokeObjectURL(previewUrl.value);
  }
  previewUrl.value = null;
}

function emitChange(): void {
  emit('change', {
    videoKey:
      status.value === 'ready' && limits.value.usable ? confirmedKey.value : null,
    trimStart: range.value.start,
    trimEnd: range.value.end,
    durationSeconds: Math.floor(durationSeconds.value),
  });
}

function applyRange(next: TrimRange): void {
  if (next.start === range.value.start && next.end === range.value.end) return;
  range.value = next;
  if (videoElRef.value) videoElRef.value.currentTime = next.start;
  if (status.value === 'ready' && limits.value.usable) emitChange();
}

// Cap hoặc độ dài server đổi: thu hẹp đoạn nếu cần.
watch(limits, (next) => {
  if (!hasVideo.value) return;
  applyRange(normalizeTrim(range.value, next));
});

function openPicker(): void {
  if (props.disabled || isBusy.value) return;
  inputRef.value?.click();
}

function reset(): void {
  flow.reset();
  revokePreview();
  currentFile.value = null;
  confirmedKey.value = null;
  serverDuration.value = null;
  clientDuration.value = 0;
  errorMessageVi.value = null;
  range.value = { start: 0, end: 0 };
  status.value = 'idle';
  emit('change', { videoKey: null, trimStart: 0, trimEnd: 0, durationSeconds: 0 });
}

async function handleFileSelect(file: File): Promise<void> {
  flow.reset();
  revokePreview();
  currentFile.value = file;
  confirmedKey.value = null;
  serverDuration.value = null;
  errorMessageVi.value = null;
  isPortrait.value = false;
  emit('change', { videoKey: null, trimStart: 0, trimEnd: 0, durationSeconds: 0 });

  status.value = 'validating';
  const validation = await validateVideoFile(file);
  if (unmounted || currentFile.value !== file) return;
  if (!validation.valid) {
    currentFile.value = null;
    status.value = 'error';
    errorMessageVi.value = validation.errorVi;
    emit('error', validation.errorVi);
    return;
  }

  clientDuration.value = validation.durationSeconds;
  validatedMime.value = validation.mimeType;
  range.value = defaultTrim(computeTrimLimits(validation.durationSeconds, props.capSeconds));
  if (typeof URL !== 'undefined') previewUrl.value = URL.createObjectURL(file);
  await startUpload(file, validation.mimeType, validation.sizeBytes);
}

async function startUpload(file: File, mimeType: string, sizeBytes: number): Promise<void> {
  status.value = 'uploading';
  errorMessageVi.value = null;
  const result = await flow.start({
    file,
    declaration: { mimeType: mimeType as VideoMimeType, sizeBytes },
    confirm: (key, opts) => client.confirmVideoUpload(key, opts),
  });
  if (unmounted || currentFile.value !== file) return;
  if (result.status === 'aborted') {
    reset();
    return;
  }
  if (result.status === 'error') {
    status.value = 'error';
    errorMessageVi.value = result.messageVi;
    emit('error', result.messageVi);
    return;
  }
  serverDuration.value = result.data.video.durationSeconds;
  if (Math.floor(result.data.video.durationSeconds) < MOTION_MIN_TRIM_SECONDS) {
    confirmedKey.value = null;
    status.value = 'error';
    errorMessageVi.value = getValidationReasonMessageVi('VIDEO_TOO_SHORT');
    emit('error', errorMessageVi.value);
    return;
  }
  confirmedKey.value = result.data.key;
  if (result.data.video.width > 0) {
    isPortrait.value = result.data.video.height > result.data.video.width;
  }
  range.value = normalizeTrim(range.value, limits.value);
  status.value = 'ready';
  emitChange();
}

function handleRetry(): void {
  const file = currentFile.value;
  if (file) {
    void startUpload(file, validatedMime.value, file.size);
  }
}

function onFileInputChange(event: Event): void {
  const target = event.target as HTMLInputElement;
  const file = target.files?.[0];
  if (file) void handleFileSelect(file);
  target.value = '';
}

function onLoadedMetadata(): void {
  const v = videoElRef.value;
  if (!v) return;
  if (v.videoWidth && v.videoHeight) isPortrait.value = v.videoHeight > v.videoWidth;
  v.currentTime = range.value.start;
}

function onTimeUpdate(): void {
  const v = videoElRef.value;
  if (!v) return;
  if (v.currentTime >= range.value.end || v.currentTime < range.value.start - 0.25) {
    v.currentTime = range.value.start;
  }
}

function setHandle(which: 'start' | 'end', value: number): void {
  applyRange(
    which === 'start'
      ? moveStart(range.value, value, limits.value)
      : moveEnd(range.value, value, limits.value),
  );
}

function valueFromPointer(clientX: number): number {
  const el = trackRef.value;
  if (!el) return 0;
  const rect = el.getBoundingClientRect();
  if (rect.width <= 0) return 0;
  const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
  return Math.round(ratio * total.value);
}

function onPointerDown(which: 'start' | 'end', event: PointerEvent): void {
  if (props.disabled) return;
  activeHandle.value = which;
  const el = event.currentTarget as HTMLElement;
  el.focus();
  el.setPointerCapture?.(event.pointerId);
}

function onPointerMove(which: 'start' | 'end', event: PointerEvent): void {
  if (activeHandle.value !== which) return;
  setHandle(which, valueFromPointer(event.clientX));
}

function onPointerUp(): void {
  activeHandle.value = null;
}

function onKeydown(which: 'start' | 'end', event: KeyboardEvent): void {
  if (props.disabled) return;
  const current = which === 'start' ? range.value.start : range.value.end;
  let next: number | null = null;
  if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') next = current - 1;
  else if (event.key === 'ArrowRight' || event.key === 'ArrowUp') next = current + 1;
  if (next === null) return;
  event.preventDefault();
  setHandle(which, next);
}

onBeforeUnmount(() => {
  unmounted = true;
  flow.cancel();
  revokePreview();
});
</script>

<template>
  <div
    class="w-full min-w-0 max-w-full space-y-3.5 overflow-hidden"
    data-testid="video-trimmer"
    :data-status="status"
  >
    <input
      :id="`${idPrefix}-input`"
      ref="inputRef"
      type="file"
      accept="video/mp4,video/quicktime"
      class="hidden"
      :disabled="disabled || isBusy"
      @change="onFileInputChange"
    />

    <div
      v-if="status === 'idle' || (status === 'validating' && !currentFile)"
      class="flex flex-col items-center justify-center rounded-2xl border-2 border-dashed border-cyber-border bg-cyber-bg/60 p-5 text-center"
    >
      <div class="flex h-12 w-12 items-center justify-center rounded-xl border border-cyber-border/80 bg-cyber-surface/90 text-cyber-violet">
        <Icon name="lucide:video" class="h-6 w-6" />
      </div>
      <p class="mt-3 text-sm font-semibold text-cyber-text">Tải video mẫu lên</p>
      <p class="mt-1 text-xs text-cyber-muted">
        MP4 hoặc MOV, tối đa {{ MAX_VIDEO_BYTES / 1024 / 1024 }} MB, dài ít nhất 3 giây
      </p>
      <button
        type="button"
        data-testid="video-select-button"
        :disabled="disabled"
        class="touch-target mt-4 inline-flex min-h-[48px] min-w-[48px] items-center justify-center gap-2 rounded-xl border border-cyber-violet/50 bg-cyber-violet/15 px-4 py-2.5 text-xs font-semibold text-cyber-text transition hover:bg-cyber-violet/25 disabled:cursor-not-allowed disabled:opacity-50"
        @click="openPicker"
      >
        <Icon name="lucide:film" class="h-4 w-4 text-cyber-cyan" />
        <span>Chọn video</span>
      </button>
    </div>

    <div
      v-else-if="status === 'error' && !currentFile"
      data-testid="video-error-state"
      class="space-y-3"
    >
      <ApiErrorBanner :message-vi="errorMessageVi" @dismiss="reset" />
      <div class="flex justify-end">
        <button
          type="button"
          data-testid="video-reselect-button"
          class="touch-target inline-flex min-h-[48px] min-w-[48px] items-center justify-center gap-2 rounded-xl border border-cyber-border bg-cyber-surface px-4 py-2.5 text-xs font-semibold text-cyber-text transition hover:border-cyber-violet"
          @click="openPicker"
        >
          <Icon name="lucide:film" class="h-4 w-4 text-cyber-cyan" />
          <span>Chọn video khác</span>
        </button>
      </div>
    </div>

    <template v-else-if="hasVideo">
      <div class="flex items-start justify-between gap-3">
        <div class="min-w-0 space-y-0.5">
          <p class="truncate text-xs font-medium text-cyber-text">{{ currentFile?.name }}</p>
          <p class="font-mono text-[11px] text-cyber-muted" data-testid="video-file-size">
            {{ formatFileSizeVi(currentFile?.size ?? 0) }}
          </p>
        </div>
        <div class="flex shrink-0 items-center gap-2">
          <button
            v-if="status === 'uploading' || status === 'validating'"
            type="button"
            data-testid="video-cancel-button"
            aria-label="Hủy tải lên"
            class="touch-target inline-flex min-h-[48px] min-w-[48px] items-center justify-center gap-1.5 rounded-xl border border-cyber-danger/40 bg-cyber-danger/10 px-3 py-2 text-xs font-semibold text-cyber-danger transition hover:bg-cyber-danger/20"
            @click="reset"
          >
            <Icon name="lucide:x" class="h-4 w-4" />
            <span>Hủy</span>
          </button>
          <template v-else-if="status === 'ready'">
            <button
              type="button"
              data-testid="video-change-button"
              :disabled="disabled"
              class="touch-target inline-flex min-h-[48px] min-w-[48px] items-center justify-center gap-1.5 rounded-xl border border-cyber-violet/50 bg-cyber-violet/15 px-3 py-2 text-xs font-semibold text-cyber-text transition hover:bg-cyber-violet/25 disabled:opacity-50"
              @click="openPicker"
            >
              <Icon name="lucide:refresh-cw" class="h-3.5 w-3.5 text-cyber-cyan" />
              <span>Đổi video</span>
            </button>
            <button
              type="button"
              data-testid="video-remove-button"
              aria-label="Xóa video này"
              :disabled="disabled"
              class="touch-target inline-flex min-h-[48px] min-w-[48px] items-center justify-center rounded-xl border border-cyber-border bg-cyber-surface p-2.5 text-cyber-muted transition hover:border-cyber-danger/60 hover:text-cyber-danger disabled:opacity-50"
              @click="reset"
            >
              <Icon name="lucide:trash-2" class="h-4 w-4" />
            </button>
          </template>
        </div>
      </div>

      <div
        v-if="status === 'uploading' || status === 'validating'"
        class="space-y-1.5"
        data-testid="video-uploading-state"
      >
        <div class="flex items-center justify-between font-mono text-xs text-cyber-muted">
          <span>{{ status === 'validating' ? 'Đang kiểm tra video...' : 'Đang tải lên máy chủ...' }}</span>
          <span class="font-bold text-cyber-cyan">{{ uploadProgress }}%</span>
        </div>
        <div class="h-2 w-full overflow-hidden rounded-full border border-cyber-border bg-cyber-surface">
          <div
            data-testid="video-progress-bar"
            role="progressbar"
            :aria-valuenow="uploadProgress"
            aria-valuemin="0"
            aria-valuemax="100"
            aria-label="Tiến độ tải video lên"
            class="h-full bg-gradient-to-r from-cyber-violet to-cyber-cyan transition-all duration-200"
            :style="{ width: `${uploadProgress}%` }"
          />
        </div>
      </div>

      <div v-else-if="status === 'error'" data-testid="video-upload-error" class="space-y-3">
        <ApiErrorBanner :message-vi="errorMessageVi" @retry="handleRetry" @dismiss="reset" />
      </div>

      <div
        v-else-if="status === 'ready'"
        class="flex items-center gap-1.5 text-xs font-semibold text-cyber-emerald"
        data-testid="video-ready-state"
      >
        <Icon name="lucide:check-circle-2" class="h-4 w-4 shrink-0" />
        <span>Video đã sẵn sàng</span>
      </div>

      <!-- Xem trước cục bộ, phát lặp trong đoạn chọn -->
      <div
        class="mx-auto flex w-full max-w-full items-center justify-center overflow-hidden rounded-xl border border-cyber-border bg-black"
        :class="isPortrait ? 'max-w-[220px]' : ''"
      >
        <video
          v-if="previewUrl"
          ref="videoElRef"
          data-testid="video-preview"
          :src="previewUrl"
          autoplay
          loop
          muted
          playsinline
          class="max-h-[60vh] w-full max-w-full object-contain"
          @loadedmetadata="onLoadedMetadata"
          @timeupdate="onTimeUpdate"
        />
      </div>

      <!-- Thanh Trim hai tay cầm -->
      <div class="space-y-2" data-testid="video-trim-bar">
        <div class="px-6">
          <div ref="trackRef" class="relative h-12 w-full touch-none select-none">
            <div class="absolute left-0 right-0 top-1/2 h-2 -translate-y-1/2 rounded-full border border-cyber-border bg-cyber-surface" />
            <div
              data-testid="video-trim-range"
              class="absolute top-1/2 h-2 -translate-y-1/2 rounded-full bg-gradient-to-r from-cyber-violet to-cyber-cyan"
              :style="{ left: `${startPct}%`, width: `${Math.max(0, endPct - startPct)}%` }"
            />
            <div
              v-for="which in (['start', 'end'] as const)"
              :key="which"
              role="slider"
              tabindex="0"
              :data-testid="`video-handle-${which}`"
              :aria-label="which === 'start' ? 'Điểm bắt đầu video' : 'Điểm kết thúc video'"
              :aria-valuemin="which === 'start' ? 0 : range.start + MOTION_MIN_TRIM_SECONDS"
              :aria-valuemax="which === 'start' ? range.end - MOTION_MIN_TRIM_SECONDS : limits.total"
              :aria-valuenow="which === 'start' ? range.start : range.end"
              :aria-valuetext="formatClock(which === 'start' ? range.start : range.end)"
              class="absolute top-1/2 flex h-12 w-12 -translate-x-1/2 -translate-y-1/2 cursor-grab items-center justify-center rounded-full outline-none active:cursor-grabbing"
              :style="{ left: `${which === 'start' ? startPct : endPct}%` }"
              @pointerdown.prevent="onPointerDown(which, $event)"
              @pointermove="onPointerMove(which, $event)"
              @pointerup="onPointerUp"
              @pointercancel="onPointerUp"
              @keydown="onKeydown(which, $event)"
            >
              <span
                class="block h-6 w-6 rounded-full border-2 border-cyber-cyan bg-cyber-surface transition"
                :class="activeHandle === which ? 'shadow-[0_0_14px_rgba(34,211,238,0.8)]' : ''"
              />
            </div>
          </div>
        </div>

        <div class="grid grid-cols-3 gap-2 text-center font-mono text-xs">
          <div class="rounded-lg border border-cyber-border bg-cyber-bg/60 px-2 py-1.5">
            <p class="text-[10px] text-cyber-muted">Bắt đầu</p>
            <p class="font-bold text-cyber-text" data-testid="video-trim-start">{{ formatClock(range.start) }}</p>
          </div>
          <div class="rounded-lg border border-cyber-border bg-cyber-bg/60 px-2 py-1.5">
            <p class="text-[10px] text-cyber-muted">Kết thúc</p>
            <p class="font-bold text-cyber-text" data-testid="video-trim-end">{{ formatClock(range.end) }}</p>
          </div>
          <div class="rounded-lg border border-cyber-cyan/40 bg-cyber-cyan/10 px-2 py-1.5">
            <p class="text-[10px] text-cyber-muted">Độ dài</p>
            <p class="font-bold text-cyber-cyan" data-testid="video-trim-length">{{ selectedLength }} giây</p>
          </div>
        </div>

        <p
          v-if="capLimited"
          data-testid="video-cap-notice"
          class="flex flex-wrap items-center gap-x-2 text-xs text-cyber-warning"
        >
          <span>Gói {{ tierName ?? '' }} cho phép tối đa {{ capSeconds }} giây</span>
          <NuxtLink
            to="/pricing"
            data-testid="video-cap-upgrade-link"
            class="touch-target inline-flex min-h-[48px] items-center font-semibold text-cyber-cyan underline"
          >
            Nâng cấp
          </NuxtLink>
        </p>
      </div>
    </template>
  </div>
</template>
