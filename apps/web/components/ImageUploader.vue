<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import {
  TOS_VERSION,
  type ImageMeta,
  type UploadConfirmResponse,
} from '@motion-ai/contracts';
import { useApiClient } from '~/composables/useApiClient';
import {
  resolveApiErrorMessageVi,
  uploadPresignedFile,
} from '~/utils/api-client';
import {
  formatFileSizeVi,
  validateImageFile,
} from '~/utils/image-upload';

const props = withDefaults(
  defineProps<{
    modelValue?: string | null;
    consent?: boolean;
    labelVi?: string;
    descriptionVi?: string;
    idPrefix?: string;
    disabled?: boolean;
    showTosConsent?: boolean;
      initialPreviewUrl?: string | null;
  }>(),
  {
    modelValue: null,
    consent: false,
    labelVi: 'Tải ảnh lên',
    descriptionVi:
      'JPG, PNG, WebP ≤ 10 MB, cạnh ngắn ≥ 512px, tỷ lệ 1:2 đến 2:1',
    idPrefix: 'image-uploader',
    disabled: false,
    showTosConsent: true,
      initialPreviewUrl: null,
  },
);

const emit = defineEmits<{
  'update:modelValue': [key: string | null];
  'update:consent': [consent: boolean];
  success: [data: UploadConfirmResponse, file: File];
  change: [
    payload: {
      key: string | null;
      meta: ImageMeta | null;
      consent: boolean;
    },
  ];
  error: [messageVi: string];
}>();

const { client } = useApiClient();

const libraryInputRef = ref<HTMLInputElement | null>(null);
const cameraInputRef = ref<HTMLInputElement | null>(null);

type UploadStatus = 'idle' | 'validating' | 'uploading' | 'ready' | 'error';
const status = ref<UploadStatus>(props.modelValue ? 'ready' : 'idle');

const currentFile = ref<File | null>(null);
const currentMeta = ref<ImageMeta | null>(null);
const confirmedKey = ref<string | null>(props.modelValue ?? null);
const previewUrl = ref<string | null>(props.initialPreviewUrl ?? null);
const uploadProgress = ref<number>(0);
const errorMessageVi = ref<string | null>(null);

let activeAbortController: AbortController | null = null;
const isDragging = ref(false);

// Quản lý ô tích cam kết ToS theo FR19
const localConsent = ref<boolean>(props.consent);

watch(
  () => props.consent,
  (next) => {
    localConsent.value = next;
  },
);

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

function updateConsent(value: boolean): void {
  localConsent.value = value;
  emit('update:consent', value);
  emit('change', {
    key: confirmedKey.value,
    meta: currentMeta.value,
    consent: value,
  });
}

// Bắt buộc reset cam kết ToS mỗi khi có lượt chọn/đổi ảnh mới theo FR19
function resetConsent(): void {
  localConsent.value = false;
  emit('update:consent', false);
}

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
  if (activeAbortController) {
    activeAbortController.abort();
    activeAbortController = null;
  }
  isDragging.value = false;
}

function openLibrary(): void {
  if (props.disabled) return;
  libraryInputRef.value?.click();
}

function openCamera(): void {
  if (props.disabled) return;
  cameraInputRef.value?.click();
}

async function handleFileSelect(file: File): Promise<void> {
  cancelOngoingUpload();
  clearOldPreview();
  resetConsent();

  currentFile.value = file;
  confirmedKey.value = null;
  currentMeta.value = null;
  emit('update:modelValue', null);
  emit('change', {
    key: null,
    meta: null,
    consent: false,
  });
  errorMessageVi.value = null;

  // 1. Kiểm tra tính hợp lệ phía client bằng schema @motion-ai/contracts
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

  activeAbortController = new AbortController();
  const signal = activeAbortController.signal;

  try {
    // Bước 1: Khai báo file và lấy URL presigned
    const createRes = await client.createUpload(
      {
        mimeType: meta.mimeType,
        sizeBytes: meta.sizeBytes,
      },
      { signal },
    );

    if (signal.aborted) return;

    // Bước 2: Tải trực tiếp lên R2 qua URL ký
    await uploadPresignedFile({
      uploadUrl: createRes.uploadUrl,
      headers: createRes.headers,
      file,
      signal,
      onProgress: (percent) => {
        uploadProgress.value = percent;
      },
    });

    if (signal.aborted) return;

    // Bước 3: Xác nhận hoàn tất tải lên
    const confirmRes = await client.confirmUpload(createRes.key, undefined, {
      signal,
    });

    if (signal.aborted) return;

    confirmedKey.value = confirmRes.key;
    currentMeta.value = confirmRes.image;
    status.value = 'ready';
    uploadProgress.value = 100;

    emit('update:modelValue', confirmRes.key);
    emit('success', confirmRes, file);
    emit('change', {
      key: confirmRes.key,
      meta: confirmRes.image,
      consent: localConsent.value,
    });
  } catch (error: unknown) {
    if (signal.aborted) {
      status.value = 'idle';
      return;
    }
    status.value = 'error';
    errorMessageVi.value = resolveApiErrorMessageVi(error);
    emit('error', errorMessageVi.value);
  } finally {
    activeAbortController = null;
  }
}

function handleCancel(): void {
  cancelOngoingUpload();
  clearOldPreview();
  resetConsent();
  currentFile.value = null;
  confirmedKey.value = null;
  currentMeta.value = null;
  previewUrl.value = null;
  uploadProgress.value = 0;
  errorMessageVi.value = null;
  status.value = 'idle';
  emit('update:modelValue', null);
  emit('change', {
    key: null,
    meta: null,
    consent: false,
  });
}

function handleRetry(): void {
  resetConsent();
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
      class="touch-target group relative flex flex-col items-center justify-center rounded-2xl border-2 border-dashed p-5 text-center transition"
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
        class="flex h-12 w-12 items-center justify-center rounded-xl border border-cyber-border/80 bg-cyber-surface/90 text-cyber-violet shadow-sm group-hover:scale-105 group-hover:border-cyber-violet/60 transition"
      >
        <Icon
          v-if="status === 'validating'"
          name="lucide:loader-2"
          class="h-6 w-6 animate-spin text-cyber-violet"
        />
        <Icon
          v-else
          name="lucide:upload-cloud"
          class="h-6 w-6 text-cyber-violet"
        />
      </div>

      <div class="mt-3 space-y-1">
        <p class="text-sm font-semibold text-cyber-text">
          {{ status === 'validating' ? 'Đang kiểm tra ảnh...' : labelVi }}
        </p>
        <p class="text-xs text-cyber-muted">
          {{ descriptionVi }}
        </p>
      </div>

      <!-- Hai nút chọn nguồn ảnh thân thiện trên mobile: Thư viện & Camera -->
      <div class="mt-4 flex flex-wrap items-center justify-center gap-2.5">
        <button
          type="button"
          data-testid="open-library-button"
          :disabled="disabled || isUploading"
          class="touch-target inline-flex min-h-[48px] min-w-[48px] items-center justify-center gap-2 rounded-xl border border-cyber-violet/50 bg-cyber-violet/15 px-4 py-2.5 text-xs font-semibold text-cyber-text transition hover:bg-cyber-violet/25 disabled:cursor-not-allowed disabled:opacity-50"
          @click="openLibrary"
        >
          <Icon name="lucide:image" class="h-4 w-4 text-cyber-cyan" />
          <span>Thư viện ảnh</span>
        </button>

        <button
          type="button"
          data-testid="open-camera-button"
          :disabled="disabled || isUploading"
          class="touch-target inline-flex min-h-[48px] min-w-[48px] items-center justify-center gap-2 rounded-xl border border-cyber-border bg-cyber-surface px-4 py-2.5 text-xs font-semibold text-cyber-text transition hover:border-cyber-cyan/50 hover:bg-cyber-surface/80 disabled:cursor-not-allowed disabled:opacity-50"
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
      class="space-y-4 rounded-2xl border border-cyber-cyan/40 bg-cyber-bg/80 p-5 shadow-sm"
    >
      <div class="flex items-start justify-between gap-3">
        <div class="flex items-center gap-3">
          <div
            class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-cyber-cyan/40 bg-cyber-cyan/15 text-cyber-cyan"
          >
            <Icon name="lucide:arrow-up-circle" class="h-5 w-5 animate-pulse" />
          </div>
          <div class="space-y-0.5">
            <p class="truncate text-xs font-medium text-cyber-text max-w-[180px] sm:max-w-xs">
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
          class="touch-target inline-flex min-h-[48px] min-w-[48px] items-center justify-center gap-1.5 rounded-xl border border-cyber-danger/40 bg-cyber-danger/10 px-3 py-2 text-xs font-semibold text-cyber-danger transition hover:bg-cyber-danger/20"
          @click="handleCancel"
        >
          <Icon name="lucide:x" class="h-4 w-4" />
          <span>Hủy</span>
        </button>
      </div>

      <!-- Thanh tiến trình (Progress Bar) -->
      <div class="space-y-1.5">
        <div class="flex items-center justify-between font-mono text-xs text-cyber-muted">
          <span>Đang tải lên máy chủ...</span>
          <span class="font-bold text-cyber-cyan">{{ uploadProgress }}%</span>
        </div>
        <div
          class="h-2 w-full overflow-hidden rounded-full bg-cyber-surface border border-cyber-border"
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
      class="flex flex-col gap-4 rounded-2xl border border-cyber-emerald/40 bg-cyber-bg/80 p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between"
    >
      <div class="flex items-center gap-3.5">
        <!-- Ảnh xem trước -->
        <div
          v-if="previewUrl"
          class="relative h-16 w-16 shrink-0 overflow-hidden rounded-xl border border-cyber-border bg-black/40"
        >
          <img
            :src="previewUrl"
            :alt="currentFile?.name || 'Ảnh đã tải'"
            data-testid="image-preview"
            class="h-full w-full object-cover"
          />
        </div>

        <!-- Thông tin ảnh đã xác nhận -->
        <div class="space-y-1">
          <div class="flex items-center gap-1.5">
            <Icon
              name="lucide:check-circle-2"
              class="h-4 w-4 text-cyber-emerald shrink-0"
            />
            <span class="text-xs font-semibold text-cyber-emerald">
              Ảnh đã sẵn sàng
            </span>
          </div>
          <p
            v-if="currentMeta"
            class="font-mono text-[11px] text-cyber-muted"
          >
            {{ currentMeta.width }} × {{ currentMeta.height }} px
            <span v-if="currentFile"> • {{ formatFileSizeVi(currentFile.size) }}</span>
          </p>
        </div>
      </div>

      <!-- Nút Đổi ảnh & Xóa ảnh -->
      <div class="flex items-center gap-2 self-end sm:self-center">
        <button
          type="button"
          data-testid="change-image-button"
          :disabled="disabled"
          class="touch-target inline-flex min-h-[48px] min-w-[48px] items-center justify-center gap-1.5 rounded-xl border border-cyber-violet/50 bg-cyber-violet/15 px-3.5 py-2.5 text-xs font-semibold text-cyber-text transition hover:bg-cyber-violet/25 disabled:cursor-not-allowed disabled:opacity-50"
          @click="handleChangeImage"
        >
          <Icon name="lucide:refresh-cw" class="h-3.5 w-3.5 text-cyber-cyan" />
          <span>Đổi ảnh</span>
        </button>

        <button
          type="button"
          data-testid="remove-image-button"
          aria-label="Xóa ảnh này"
          :disabled="disabled"
          class="touch-target inline-flex min-h-[48px] min-w-[48px] items-center justify-center rounded-xl border border-cyber-border bg-cyber-surface p-2.5 text-cyber-muted transition hover:border-cyber-danger/60 hover:text-cyber-danger disabled:cursor-not-allowed disabled:opacity-50"
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

    <!-- Ô cam kết ToS theo FR19: Bắt buộc tích cho mỗi lần tải ảnh mới -->
    <div v-if="showTosConsent" class="pt-1">
      <label
        :for="`${idPrefix}-tos-checkbox`"
        class="touch-target flex min-h-[48px] items-start gap-3 rounded-xl border border-cyber-border bg-cyber-bg/70 p-3.5 text-sm transition hover:border-cyber-violet/60"
        :class="{
          'cursor-pointer': !disabled && status === 'ready',
          'opacity-60 cursor-not-allowed': disabled || status !== 'ready',
        }"
      >
        <input
          :id="`${idPrefix}-tos-checkbox`"
          :checked="localConsent"
          :disabled="disabled || status !== 'ready'"
          type="checkbox"
          data-testid="image-uploader-tos-checkbox"
          class="mt-1 h-5 w-5 shrink-0 accent-cyber-violet disabled:cursor-not-allowed"
          @change="updateConsent(($event.target as HTMLInputElement).checked)"
        />
        <span class="text-xs leading-relaxed text-cyber-muted">
          Tôi xác nhận đủ 18 tuổi, sở hữu quyền hợp pháp đối với ảnh tải lên,
          người trong ảnh đã đồng ý cho xử lý và cam kết tuân thủ Điều khoản
          dịch vụ (phiên bản {{ TOS_VERSION }}).
        </span>
      </label>
    </div>
  </div>
</template>
