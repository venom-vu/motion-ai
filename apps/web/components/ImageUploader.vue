<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue';
import {
  type ImageMeta,
  type UploadConfirmResponse,
} from '@flowvis/contracts';
import { useApiClient } from '~/composables/useApiClient';
import { useUploadFlow } from '~/composables/useUploadFlow';
import {
  computeCameraCaptureDimensions,
  formatFileSizeVi,
  validateImageFile,
} from '~/utils/image-upload';

const props = withDefaults(
  defineProps<{
    modelValue?: string | null;
    labelVi?: string;
    descriptionVi?: string;
    idPrefix?: string;
    disabled?: boolean;
      initialPreviewUrl?: string | null;
  }>(),
  {
    modelValue: null,
    labelVi: 'Tải ảnh lên',
    descriptionVi:
      'JPG, PNG, WebP ≤ 10 MB, cạnh ngắn ≥ 512px, tỷ lệ 1:2 đến 2:1',
    idPrefix: 'image-uploader',
    disabled: false,
      initialPreviewUrl: null,
  },
);

const emit = defineEmits<{
  'update:modelValue': [key: string | null];
  success: [data: UploadConfirmResponse, file: File];
  change: [
    payload: {
      key: string | null;
      meta: ImageMeta | null;
    },
  ];
  error: [messageVi: string];
}>();

const { client } = useApiClient();
const uploadFlow = useUploadFlow(client);

const libraryInputRef = ref<HTMLInputElement | null>(null);
const cameraInputRef = ref<HTMLInputElement | null>(null);
const cameraVideoRef = ref<HTMLVideoElement | null>(null);

const isCameraOpen = ref(false);
const isCameraStarting = ref(false);
const cameraErrorVi = ref<string | null>(null);
const cameraFacingMode = ref<'user' | 'environment'>('user');
let activeCameraStream: MediaStream | null = null;

type UploadStatus = 'idle' | 'validating' | 'uploading' | 'ready' | 'error';
const status = ref<UploadStatus>(props.modelValue ? 'ready' : 'idle');

const currentFile = ref<File | null>(null);
const currentMeta = ref<ImageMeta | null>(null);
const confirmedKey = ref<string | null>(props.modelValue ?? null);
const previewUrl = ref<string | null>(props.initialPreviewUrl ?? null);
const uploadProgress = uploadFlow.progress;
const errorMessageVi = ref<string | null>(null);

const isDragging = ref(false);

watch(
  () => props.modelValue,
  (nextKey) => {
    if (!nextKey) {
      if (status.value !== 'idle') {
        handleCancel();
      }
    } else if (nextKey !== confirmedKey.value) {
      cancelOngoingUpload();
      confirmedKey.value = nextKey;
      status.value = 'ready';
    }
  },
);

function clearOldPreview(): void {
  if (
    previewUrl.value &&
    previewUrl.value.startsWith('blob:') &&
    typeof URL !== 'undefined'
  ) {
    URL.revokeObjectURL(previewUrl.value);
  }
}

function cancelOngoingUpload(): void {
  uploadFlow.cancel();
  isDragging.value = false;
}

function openLibrary(): void {
  if (props.disabled || isUploading.value) return;
  libraryInputRef.value?.click();
}

function stopCameraStream(): void {
  if (activeCameraStream) {
    activeCameraStream.getTracks().forEach((track) => track.stop());
    activeCameraStream = null;
  }
  if (cameraVideoRef.value) {
    cameraVideoRef.value.srcObject = null;
  }
  isCameraStarting.value = false;
}

function closeCamera(): void {
  stopCameraStream();
  isCameraOpen.value = false;
  cameraErrorVi.value = null;
}

function resolveCameraErrorVi(error: unknown): string {
  const errName =
    error && typeof error === 'object' && 'name' in error
      ? String((error as { name?: unknown }).name)
      : '';
  if (
    errName === 'NotAllowedError' ||
    errName === 'PermissionDeniedError' ||
    errName === 'SecurityError'
  ) {
    return 'Trình duyệt đã chặn quyền truy cập máy ảnh. Vui lòng cấp quyền camera trên thanh địa chỉ hoặc chọn ảnh có sẵn từ thiết bị.';
  }
  if (
    errName === 'NotFoundError' ||
    errName === 'DevicesNotFoundError' ||
    errName === 'OverconstrainedError'
  ) {
    return 'Không tìm thấy máy ảnh (webcam) trên thiết bị của bạn. Vui lòng kiểm tra kết nối camera hoặc chọn ảnh từ thư viện.';
  }
  if (errName === 'NotReadableError' || errName === 'TrackStartError') {
    return 'Máy ảnh đang được sử dụng bởi một ứng dụng khác. Vui lòng đóng ứng dụng đó và thử lại.';
  }
  return 'Không thể khởi động máy ảnh trực tiếp. Vui lòng thử lại hoặc chọn ảnh từ thư viện.';
}

async function startCameraStream(
  facingMode: 'user' | 'environment' = cameraFacingMode.value,
): Promise<void> {
  stopCameraStream();
  cameraFacingMode.value = facingMode;
  isCameraStarting.value = true;
  cameraErrorVi.value = null;

  try {
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: facingMode },
          width: { ideal: 1280 },
          height: { ideal: 960 },
        },
        audio: false,
      });
    } catch {
      // Dự phòng cho webcam máy tính không hỗ trợ tham số facingMode hoặc độ phân giải cụ thể
      stream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: false,
      });
    }

    if (!isCameraOpen.value) {
      stream.getTracks().forEach((track) => track.stop());
      return;
    }

    activeCameraStream = stream;
    await nextTick();
    if (cameraVideoRef.value) {
      cameraVideoRef.value.srcObject = stream;
      await cameraVideoRef.value.play().catch(() => {});
    }
  } catch (error: unknown) {
    cameraErrorVi.value = resolveCameraErrorVi(error);
  } finally {
    isCameraStarting.value = false;
  }
}

function openCamera(): void {
  if (props.disabled || isUploading.value) return;
  if (
    typeof navigator !== 'undefined' &&
    navigator.mediaDevices &&
    typeof navigator.mediaDevices.getUserMedia === 'function'
  ) {
    isCameraOpen.value = true;
    void startCameraStream(cameraFacingMode.value);
    return;
  }
  cameraInputRef.value?.click();
}

function switchCameraFacing(): void {
  const nextMode =
    cameraFacingMode.value === 'user' ? 'environment' : 'user';
  void startCameraStream(nextMode);
}

function fallbackCameraToLibrary(): void {
  closeCamera();
  openLibrary();
}

async function capturePhoto(): Promise<void> {
  const video = cameraVideoRef.value;
  if (!video || isCameraStarting.value || cameraErrorVi.value) return;

  const rawWidth = video.videoWidth || 1280;
  const rawHeight = video.videoHeight || 960;
  const { sx, sy, sw, sh, dw, dh } = computeCameraCaptureDimensions(
    rawWidth,
    rawHeight,
  );

  const canvas = document.createElement('canvas');
  canvas.width = dw;
  canvas.height = dh;

  const ctx = canvas.getContext('2d');
  if (!ctx) {
    cameraErrorVi.value =
      'Không thể xử lý khung hình từ máy ảnh. Vui lòng thử lại.';
    return;
  }

  if (cameraFacingMode.value === 'user') {
    ctx.translate(dw, 0);
    ctx.scale(-1, 1);
  }
  ctx.drawImage(video, sx, sy, sw, sh, 0, 0, dw, dh);

  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob((b) => resolve(b), 'image/jpeg', 0.92);
  });

  if (!blob) {
    cameraErrorVi.value =
      'Không thể tạo tệp ảnh từ máy ảnh. Vui lòng thử lại.';
    return;
  }

  const capturedFile = new File([blob], `camera-${Date.now()}.jpg`, {
    type: 'image/jpeg',
  });

  closeCamera();
  await handleFileSelect(capturedFile);
}

async function handleFileSelect(file: File): Promise<void> {
  cancelOngoingUpload();
  clearOldPreview();

  currentFile.value = file;
  confirmedKey.value = null;
  currentMeta.value = null;
  emit('update:modelValue', null);
  emit('change', {
    key: null,
    meta: null,
  });
  errorMessageVi.value = null;

  // 1. Kiểm tra tính hợp lệ phía client bằng schema @flowvis/contracts
  status.value = 'validating';
  const validation = await validateImageFile(file);
  if (!validation.valid) {
    status.value = 'error';
    errorMessageVi.value = validation.errorVi;
    emit('error', validation.errorVi);
    return;
  }

  currentMeta.value = validation.meta;

  // Tạo URL xem trước cục bộ
  if (typeof URL !== 'undefined') {
    previewUrl.value = URL.createObjectURL(file);
  }

  // 2. Tiến hành tải lên
  await startUpload(file, validation.meta);
}

async function startUpload(file: File, meta: ImageMeta): Promise<void> {
  status.value = 'uploading';
  uploadProgress.value = 0;
  errorMessageVi.value = null;

  const result = await uploadFlow.start({
    file,
    declaration: { mimeType: meta.mimeType, sizeBytes: meta.sizeBytes },
    confirm: (key, opts) => client.confirmUpload(key, undefined, opts),
  });

  if (result.status === 'aborted') {
    if (currentFile.value === file) status.value = 'idle';
    return;
  }
  if (result.status === 'error') {
    status.value = 'error';
    errorMessageVi.value = result.messageVi;
    emit('error', result.messageVi);
    return;
  }

  const confirmRes = result.data;
  confirmedKey.value = confirmRes.key;
  currentMeta.value = confirmRes.image;
  status.value = 'ready';
  uploadProgress.value = 100;

  emit('update:modelValue', confirmRes.key);
  emit('success', confirmRes, file);
  emit('change', {
    key: confirmRes.key,
    meta: confirmRes.image,
  });
}

function handleCancel(): void {
  closeCamera();
  cancelOngoingUpload();
  clearOldPreview();
  currentFile.value = null;
  confirmedKey.value = null;
  currentMeta.value = null;
  previewUrl.value = null;
  uploadFlow.reset();
  errorMessageVi.value = null;
  status.value = 'idle';
  emit('update:modelValue', null);
  emit('change', {
    key: null,
    meta: null,
  });
}

function handleRetry(): void {
  if (currentFile.value && currentMeta.value) {
    startUpload(currentFile.value, currentMeta.value);
  } else if (currentFile.value) {
    handleFileSelect(currentFile.value);
  }
}

function handleChangeImage(): void {
  openLibrary();
}

function onFileInputChange(event: Event): void {
  const target = event.target as HTMLInputElement;
  const files = target.files;
  if (files && files.length > 0 && files[0]) {
    handleFileSelect(files[0]);
  }
  target.value = '';
}

function onDrop(event: DragEvent): void {
  isDragging.value = false;
  if (props.disabled || status.value === 'uploading') return;
  const files = event.dataTransfer?.files;
  if (files && files.length > 0 && files[0]) {
    handleFileSelect(files[0]);
  }
}

onBeforeUnmount(() => {
  closeCamera();
  cancelOngoingUpload();
  clearOldPreview();
});

const isUploading = computed(
  () => status.value === 'uploading' || status.value === 'validating',
);
</script>

<template>
  <div
    class="space-y-3.5"
    data-testid="image-uploader"
    :data-status="status"
  >
    <!-- File inputs ẩn phục vụ chọn thư viện & camera -->
    <input
      :id="`${idPrefix}-library-input`"
      ref="libraryInputRef"
      type="file"
      accept="image/jpeg,image/png,image/webp"
      class="hidden"
      :disabled="disabled || isUploading"
      @change="onFileInputChange"
    />
    <input
      :id="`${idPrefix}-camera-input`"
      ref="cameraInputRef"
      type="file"
      accept="image/jpeg,image/png,image/webp"
      capture="environment"
      class="hidden"
      :disabled="disabled || isUploading"
      @change="onFileInputChange"
    />

    <!-- Khung tải ảnh chính (Dropzone / Trạng thái chờ) -->
    <div
      v-if="status === 'idle' || status === 'validating'"
      class="touch-target group relative flex flex-col items-center justify-center rounded-xl border-2 border-dashed p-3.5 text-center transition sm:p-4"
      :class="[
        isDragging
          ? 'border-cyber-cyan bg-cyber-cyan/10 scale-[1.01]'
          : 'border-cyber-border bg-cyber-bg/60 hover:border-cyber-violet/70 hover:bg-cyber-bg/90',
      ]"
      @dragenter.prevent="isDragging = true"
      @dragover.prevent="isDragging = true"
      @dragleave.prevent="isDragging = false"
      @drop.prevent="onDrop"
    >
      <div
        class="flex h-9 w-9 items-center justify-center rounded-lg border border-cyber-border/80 bg-cyber-surface/90 text-cyber-violet shadow-sm transition group-hover:scale-105 group-hover:border-cyber-violet/60"
      >
        <Icon
          v-if="status === 'validating'"
          name="lucide:loader-2"
          class="h-5 w-5 animate-spin text-cyber-violet"
        />
        <Icon
          v-else
          name="lucide:upload-cloud"
          class="h-5 w-5 text-cyber-violet"
        />
      </div>

      <div class="mt-2 space-y-0.5">
        <p class="text-xs font-semibold text-cyber-text sm:text-sm">
          {{ status === 'validating' ? 'Đang kiểm tra ảnh...' : labelVi }}
        </p>
        <p class="text-[11px] text-cyber-muted sm:text-xs">
          {{ descriptionVi }}
        </p>
      </div>

      <!-- Hai nút chọn nguồn ảnh thân thiện trên mobile: Thư viện & Camera -->
      <div class="mt-3 flex flex-wrap items-center justify-center gap-2">
        <button
          type="button"
          data-testid="open-library-button"
          :disabled="disabled || isUploading"
          class="touch-target inline-flex min-h-[48px] min-w-[48px] items-center justify-center gap-1.5 rounded-xl border border-cyber-violet/50 bg-cyber-violet/15 px-3.5 py-2 text-xs font-semibold text-cyber-text transition hover:bg-cyber-violet/25 disabled:cursor-not-allowed disabled:opacity-50"
          @click="openLibrary"
        >
          <Icon name="lucide:image" class="h-4 w-4 text-cyber-cyan" />
          <span>Thư viện ảnh</span>
        </button>

        <button
          type="button"
          data-testid="open-camera-button"
          :disabled="disabled || isUploading"
          class="touch-target inline-flex min-h-[48px] min-w-[48px] items-center justify-center gap-1.5 rounded-xl border border-cyber-border bg-cyber-surface px-3.5 py-2 text-xs font-semibold text-cyber-text transition hover:border-cyber-cyan/50 hover:bg-cyber-surface/80 disabled:cursor-not-allowed disabled:opacity-50"
          @click="openCamera"
        >
          <Icon name="lucide:camera" class="h-4 w-4 text-cyber-violet" />
          <span>Chụp ảnh</span>
        </button>
      </div>
    </div>

    <!-- Trạng thái Đang tải lên với thanh tiến trình & nút hủy -->
    <div
      v-else-if="status === 'uploading'"
      data-testid="uploading-state"
      class="space-y-2.5 rounded-xl border border-cyber-cyan/40 bg-cyber-bg/80 p-3 shadow-sm sm:p-3.5"
    >
      <div class="flex items-center justify-between gap-3 min-w-0">
        <div class="flex items-center gap-2.5 min-w-0 flex-1">
          <div
            class="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-cyber-cyan/40 bg-cyber-cyan/15 text-cyber-cyan"
          >
            <Icon name="lucide:arrow-up-circle" class="h-4 w-4 animate-pulse" />
          </div>
          <div class="min-w-0 flex-1 space-y-0.5">
            <p
              class="truncate text-xs font-medium text-cyber-text"
              :title="currentFile?.name || 'Tệp hình ảnh'"
            >
              {{ currentFile?.name || 'Tệp hình ảnh' }}
            </p>
            <p class="font-mono text-[11px] text-cyber-muted">
              {{ formatFileSizeVi(currentFile?.size ?? 0) }}
            </p>
          </div>
        </div>

        <button
          type="button"
          data-testid="cancel-upload-button"
          aria-label="Hủy tải lên"
          class="touch-target inline-flex shrink-0 min-h-[48px] items-center justify-center gap-1.5 rounded-xl border border-cyber-danger/40 bg-cyber-danger/10 px-3 py-1.5 text-xs font-semibold text-cyber-danger transition hover:bg-cyber-danger/20"
          @click="handleCancel"
        >
          <Icon name="lucide:x" class="h-3.5 w-3.5" />
          <span>Hủy</span>
        </button>
      </div>

      <!-- Thanh tiến trình (Progress Bar) -->
      <div class="space-y-1">
        <div class="flex items-center justify-between font-mono text-[11px] text-cyber-muted">
          <span>Đang tải lên máy chủ...</span>
          <span class="font-bold text-cyber-cyan">{{ uploadProgress }}%</span>
        </div>
        <div
          class="h-1.5 w-full overflow-hidden rounded-full border border-cyber-border bg-cyber-surface"
        >
          <div
            data-testid="upload-progress-bar"
            role="progressbar"
            :aria-valuenow="uploadProgress"
            aria-valuemin="0"
            aria-valuemax="100"
            aria-label="Tiến độ tải ảnh lên"
            class="h-full bg-gradient-to-r from-cyber-violet to-cyber-cyan transition-all duration-200"
            :style="{ width: `${uploadProgress}%` }"
          />
        </div>
      </div>
    </div>

    <!-- Trạng thái Hoàn tất: Xem trước ảnh, thông tin & nút đổi ảnh -->
    <div
      v-else-if="status === 'ready'"
      data-testid="upload-ready-state"
      class="flex flex-col gap-3 rounded-xl border border-cyber-emerald/40 bg-cyber-bg/80 p-3 shadow-sm sm:flex-row sm:items-center sm:justify-between sm:p-3.5 min-w-0"
    >
      <div class="flex items-center gap-3 min-w-0 flex-1">
        <!-- Ảnh xem trước -->
        <div
          v-if="previewUrl"
          class="relative h-12 w-12 shrink-0 overflow-hidden rounded-lg border border-cyber-border bg-black/40"
        >
          <img
            :src="previewUrl"
            :alt="currentFile?.name || 'Ảnh đã tải'"
            data-testid="image-preview"
            class="h-full w-full object-cover"
          />
        </div>

        <!-- Thông tin ảnh đã xác nhận -->
        <div class="space-y-0.5 min-w-0 flex-1">
          <div class="flex items-center gap-1.5">
            <Icon
              name="lucide:check-circle-2"
              class="h-3.5 w-3.5 shrink-0 text-cyber-emerald"
            />
            <span class="truncate text-xs font-semibold text-cyber-emerald">
              Ảnh đã sẵn sàng
            </span>
          </div>
          <p
            v-if="currentMeta"
            class="truncate font-mono text-[11px] text-cyber-muted"
          >
            {{ currentMeta.width }} × {{ currentMeta.height }} px
            <span v-if="currentFile"> • {{ formatFileSizeVi(currentFile.size) }}</span>
          </p>
        </div>
      </div>

      <!-- Nút Đổi ảnh, Chụp lại & Xóa ảnh -->
      <div class="flex flex-wrap items-center gap-1.5 shrink-0 self-end sm:self-center">
        <button
          type="button"
          data-testid="change-image-button"
          :disabled="disabled"
          class="touch-target inline-flex min-h-[48px] items-center justify-center gap-1.5 rounded-xl border border-cyber-violet/50 bg-cyber-violet/15 px-3 py-1.5 text-xs font-semibold text-cyber-text transition hover:bg-cyber-violet/25 disabled:cursor-not-allowed disabled:opacity-50"
          @click="handleChangeImage"
        >
          <Icon name="lucide:refresh-cw" class="h-3.5 w-3.5 text-cyber-cyan" />
          <span>Đổi ảnh</span>
        </button>

        <button
          type="button"
          data-testid="retake-camera-button"
          :disabled="disabled"
          class="touch-target inline-flex min-h-[48px] items-center justify-center gap-1.5 rounded-xl border border-cyber-border bg-cyber-surface px-3 py-1.5 text-xs font-semibold text-cyber-text transition hover:border-cyber-cyan/50 disabled:cursor-not-allowed disabled:opacity-50"
          @click="openCamera"
        >
          <Icon name="lucide:camera" class="h-3.5 w-3.5 text-cyber-violet" />
          <span>Chụp lại</span>
        </button>

        <button
          type="button"
          data-testid="remove-image-button"
          aria-label="Xóa ảnh này"
          :disabled="disabled"
          class="touch-target inline-flex min-h-[48px] min-w-[48px] items-center justify-center rounded-xl border border-cyber-border bg-cyber-surface p-2 text-cyber-muted transition hover:border-cyber-danger/60 hover:text-cyber-danger disabled:cursor-not-allowed disabled:opacity-50"
          @click="handleCancel"
        >
          <Icon name="lucide:trash-2" class="h-4 w-4" />
        </button>
      </div>
    </div>

    <!-- Trạng thái Lỗi: Banner tiếng Việt + Nút Thử lại / Chọn lại (Thư viện + Camera) -->
    <div
      v-else-if="status === 'error'"
      data-testid="upload-error-state"
      class="space-y-3"
    >
      <ApiErrorBanner
        :message-vi="errorMessageVi"
        @retry="handleRetry"
        @dismiss="handleCancel"
      />

      <div class="flex flex-wrap items-center justify-end gap-2">
        <button
          type="button"
          data-testid="reselect-image-button"
          :disabled="disabled"
          class="touch-target inline-flex min-h-[48px] min-w-[48px] items-center justify-center gap-2 rounded-xl border border-cyber-border bg-cyber-surface px-4 py-2.5 text-xs font-semibold text-cyber-text transition hover:border-cyber-violet disabled:cursor-not-allowed disabled:opacity-50"
          @click="openLibrary"
        >
          <Icon name="lucide:image" class="h-4 w-4 text-cyber-cyan" />
          <span>Chọn ảnh khác</span>
        </button>

        <button
          type="button"
          data-testid="reselect-camera-button"
          :disabled="disabled"
          class="touch-target inline-flex min-h-[48px] min-w-[48px] items-center justify-center gap-2 rounded-xl border border-cyber-border bg-cyber-surface px-4 py-2.5 text-xs font-semibold text-cyber-text transition hover:border-cyber-cyan/50 disabled:cursor-not-allowed disabled:opacity-50"
          @click="openCamera"
        >
          <Icon name="lucide:camera" class="h-4 w-4 text-cyber-violet" />
          <span>Chụp ảnh mới</span>
        </button>
      </div>
    </div>

    <!-- Centered Dialog chụp ảnh trực tiếp qua WebRTC Camera -->
    <div
      v-if="isCameraOpen"
      role="dialog"
      aria-modal="true"
      :aria-labelledby="`${idPrefix}-camera-dialog-title`"
      data-testid="camera-capture-modal"
      class="fixed inset-0 z-[60] flex items-center justify-center bg-cyber-bg/85 p-3 backdrop-blur-sm sm:p-6"
      @click.stop.self="closeCamera"
    >
      <div
        class="relative w-full max-w-lg overflow-hidden rounded-2xl border border-cyber-border bg-cyber-surface text-cyber-text shadow-2xl"
      >
        <!-- Header modal camera -->
        <div
          class="flex items-center justify-between gap-3 border-b border-cyber-border bg-cyber-surface/95 px-4 py-3.5 sm:px-5"
        >
          <div class="flex items-center gap-2.5">
            <span
              class="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-cyber-violet/40 bg-cyber-violet/15 text-cyber-violet"
            >
              <Icon name="lucide:camera" class="h-4 w-4" />
            </span>
            <div>
              <h3
                :id="`${idPrefix}-camera-dialog-title`"
                class="font-display text-sm font-bold sm:text-base"
              >
                Chụp Ảnh Trực Tiếp
              </h3>
              <p class="text-[11px] text-cyber-muted">
                Căn chỉnh khuôn mặt hoặc khung hình rõ nét ở trung tâm
              </p>
            </div>
          </div>

          <button
            type="button"
            aria-label="Đóng máy ảnh"
            data-testid="close-camera-button"
            class="touch-target inline-flex min-h-[48px] min-w-[48px] items-center justify-center rounded-xl border border-cyber-border bg-cyber-bg/80 p-2 text-cyber-muted transition hover:border-cyber-violet hover:text-cyber-text"
            @click="closeCamera"
          >
            <Icon name="lucide:x" class="h-4 w-4" />
          </button>
        </div>

        <!-- Khung hiển thị video trực tiếp hoặc thông báo lỗi quyền camera -->
        <div class="p-4 sm:p-5">
          <div
            v-if="cameraErrorVi"
            data-testid="camera-error-state"
            class="space-y-4 rounded-xl border border-cyber-danger/40 bg-cyber-danger/10 p-4 text-center"
          >
            <div
              class="mx-auto flex h-11 w-11 items-center justify-center rounded-xl border border-cyber-danger/40 bg-cyber-danger/15 text-cyber-danger"
            >
              <Icon name="lucide:alert-circle" class="h-5 w-5" />
            </div>
            <p class="text-xs leading-relaxed text-cyber-danger sm:text-sm">
              {{ cameraErrorVi }}
            </p>
            <div class="flex flex-wrap items-center justify-center gap-2.5">
              <button
                type="button"
                data-testid="retry-camera-button"
                class="touch-target inline-flex min-h-[48px] min-w-[48px] items-center justify-center gap-2 rounded-xl border border-cyber-border bg-cyber-surface px-4 py-2.5 text-xs font-semibold text-cyber-text transition hover:border-cyber-cyan"
                @click="startCameraStream(cameraFacingMode)"
              >
                <Icon name="lucide:refresh-cw" class="h-4 w-4 text-cyber-cyan" />
                <span>Thử mở lại camera</span>
              </button>

              <button
                type="button"
                data-testid="fallback-library-button"
                class="touch-target inline-flex min-h-[48px] min-w-[48px] items-center justify-center gap-2 rounded-xl bg-cyber-violet px-4 py-2.5 text-xs font-semibold text-cyber-text transition hover:bg-cyber-violet/90"
                @click="fallbackCameraToLibrary"
              >
                <Icon name="lucide:image" class="h-4 w-4" />
                <span>Chọn ảnh từ thiết bị</span>
              </button>
            </div>
          </div>

          <div
            v-else
            class="relative aspect-[4/3] w-full overflow-hidden rounded-xl border border-cyber-border bg-black"
          >
            <video
              ref="cameraVideoRef"
              data-testid="camera-video-preview"
              autoplay
              playsinline
              muted
              class="h-full w-full object-cover"
              :class="{ '-scale-x-100': cameraFacingMode === 'user' }"
            />

            <!-- Khung căn chỉnh gợi ý ở trung tâm -->
            <div
              class="pointer-events-none absolute inset-6 rounded-2xl border border-dashed border-cyber-cyan/45"
            />

            <!-- Lớp phủ đang khởi động luồng camera -->
            <div
              v-if="isCameraStarting"
              data-testid="camera-starting-overlay"
              class="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-cyber-bg/80 backdrop-blur-xs"
            >
              <Icon
                name="lucide:loader-2"
                class="h-7 w-7 animate-spin text-cyber-cyan"
              />
              <span class="text-xs font-medium text-cyber-text">
                Đang kết nối máy ảnh...
              </span>
            </div>
          </div>
        </div>

        <!-- Footer nút điều khiển chụp ảnh -->
        <div
          v-if="!cameraErrorVi"
          class="flex flex-wrap items-center justify-between gap-2.5 border-t border-cyber-border bg-cyber-bg/60 px-4 py-3.5 sm:px-5"
        >
          <button
            type="button"
            data-testid="switch-camera-button"
            :disabled="isCameraStarting"
            class="touch-target inline-flex min-h-[48px] min-w-[48px] items-center justify-center gap-2 rounded-xl border border-cyber-border bg-cyber-surface px-4 py-2.5 text-xs font-semibold text-cyber-text transition hover:border-cyber-cyan disabled:cursor-not-allowed disabled:opacity-50"
            @click="switchCameraFacing"
          >
            <Icon name="lucide:refresh-cw" class="h-4 w-4 text-cyber-cyan" />
            <span>Đổi camera</span>
          </button>

          <button
            type="button"
            data-testid="capture-photo-button"
            :disabled="isCameraStarting"
            class="touch-target inline-flex min-h-[48px] min-w-[48px] flex-1 items-center justify-center gap-2 rounded-xl bg-cyber-violet px-5 py-2.5 text-sm font-semibold text-cyber-text transition hover:bg-cyber-violet/90 disabled:cursor-not-allowed disabled:opacity-50 sm:flex-initial"
            @click="capturePhoto"
          >
            <Icon name="lucide:camera" class="h-4 w-4" />
            <span>Chụp ảnh ngay</span>
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
