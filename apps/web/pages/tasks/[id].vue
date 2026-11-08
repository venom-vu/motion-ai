<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useAsyncData, useHead, useRoute, useRouter } from '#imports';
import type {
  Task,
  TaskResultResponse,
  TaskShareResponse,
} from '@motion-ai/contracts';
import { useApiClient } from '~/composables/useApiClient';
import { useAuth } from '~/composables/useAuth';
import { useAuthDialog } from '~/composables/useAuthDialog';
import { resolveApiErrorMessageVi } from '~/utils/api-client';
import { isUnauthorizedError } from '~/utils/auth-session';
import {
  formatTaskTimestampVi,
  getPipelineLabelVi,
  getTaskStatusLabelVi,
  isTaskRetentionExpired,
} from '~/utils/task-format';

const route = useRoute();
const router = useRouter();
const { client } = useApiClient();
const { isAuthenticated, sessionChecked } = useAuth();
const { open: openAuthDialog } = useAuthDialog();

const taskId = computed<string>(() => {
  const raw = route.params.id;
  const val = Array.isArray(raw) ? raw[0] : raw;
  return typeof val === 'string' ? val : '';
});

useHead({
  title: 'Kết Quả Tác Vụ — flowvis',
  meta: [
    {
      name: 'description',
      content: 'Xem kết quả tạo ảnh AI, so sánh trước sau, tải về ảnh chất lượng cao hoặc chia sẻ.',
    },
  ],
});

// 1. Tải thông tin Task
const taskAsync = useAsyncData<Task>(
  `flowvis-task-${taskId.value}`,
  () => client.getTask(taskId.value),
);

const currentTask = ref<Task | null>(null);
watch(
  () => taskAsync.data.value,
  (t) => {
    if (t) currentTask.value = t;
  },
  { immediate: true },
);

// Kiểm tra hết hạn lưu trữ 30 ngày
const isExpired = computed<boolean>(() => {
  if (!currentTask.value) return false;
  return isTaskRetentionExpired(currentTask.value.createdAt);
});

// 2. Tải kết quả (URL ký resultUrl & sourceUrl) khi task succeeded và chưa hết hạn lưu
const resultAsync = useAsyncData<TaskResultResponse | null>(
  `flowvis-task-result-${taskId.value}`,
  async () => {
    let task = currentTask.value || taskAsync.data.value;
    if (!task && taskAsync.pending.value) {
      const res = await taskAsync;
      task = res.data.value;
    }
    if (!task || task.status !== 'succeeded') {
      return null;
    }
    if (isExpired.value) {
      return null;
    }
    return client.getTaskResult(taskId.value);
  },
  {
    watch: [currentTask, isExpired],
  },
);

// Trạng thái chia sẻ
const shareData = ref<TaskShareResponse | null>(null);
const isSharing = ref<boolean>(false);
const isRevokingShare = ref<boolean>(false);
const shareToastMessage = ref<string | null>(null);
const shareErrorVi = ref<string | null>(null);

const isUnauthenticated = computed<boolean>(() => {
  if (
    isUnauthorizedError(taskAsync.error.value) ||
    isUnauthorizedError(resultAsync.error.value)
  ) {
    return true;
  }
  if (import.meta.server) {
    return false;
  }
  if (!isAuthenticated.value && !taskAsync.pending.value) {
    if (!sessionChecked.value && taskAsync.data.value) {
      return false;
    }
    return true;
  }
  return false;
});

const taskErrorVi = computed<string | null>(() => {
  if (isUnauthenticated.value || !taskAsync.error.value) return null;
  return resolveApiErrorMessageVi(taskAsync.error.value);
});

const resultErrorVi = computed<string | null>(() => {
  if (isUnauthenticated.value || !resultAsync.error.value) return null;
  return resolveApiErrorMessageVi(resultAsync.error.value);
});

// Làm mới URL kết quả khi có lỗi tải ảnh hoặc URL hết hạn
const imageRefreshAttempts = ref<number>(0);
const imageLoadFailed = ref<boolean>(false);
async function handleRefreshResult(): Promise<void> {
  imageLoadFailed.value = false;
  await resultAsync.refresh();
}

function handleImageError(_payload: { type: 'source' | 'result'; error: Event }): void {
  // Tự động thử lấy lại URL ký mới tối đa 1 lần để tránh vòng lặp vô hạn
  if (imageRefreshAttempts.value < 1) {
    imageRefreshAttempts.value += 1;
    void handleRefreshResult();
  } else {
    imageLoadFailed.value = true;
  }
}

// Xử lý tải ảnh về máy (ưu tiên fetch blob để tải trực tiếp)
const isDownloading = ref<boolean>(false);
async function handleDownloadImage(): Promise<void> {
  let url = resultAsync.data.value?.resultUrl;
  if (!url || isDownloading.value) return;
  isDownloading.value = true;
  const fileName = `flowvis-${currentTask.value?.pipeline || 'result'}-${taskId.value.slice(0, 8)}.png`;

  try {
    let response = await fetch(url);
    if (!response.ok) {
      // URL ký có thể đã hết hạn, thử refresh lấy lại link mới
      await handleRefreshResult();
      url = resultAsync.data.value?.resultUrl;
      if (!url) throw new Error('Không thể làm mới đường dẫn tải ảnh');
      response = await fetch(url);
      if (!response.ok) throw new Error('Không thể tải ảnh kết quả');
    }
    const blob = await response.blob();
    const blobUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = blobUrl;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(blobUrl), 1500);
  } catch (err) {
    shareErrorVi.value = resolveApiErrorMessageVi(err);
  } finally {
    isDownloading.value = false;
  }
}

// Xử lý tạo liên kết chia sẻ
async function handleShare(): Promise<void> {
  if (isSharing.value || isRevokingShare.value) return;
  isSharing.value = true;
  shareToastMessage.value = null;
  shareErrorVi.value = null;

  try {
    const res: TaskShareResponse = await client.shareTask(taskId.value);
    const webShareUrl =
      typeof window !== 'undefined'
        ? `${window.location.origin}/share/${res.token}`
        : res.shareUrl;
    shareData.value = {
      ...res,
      shareUrl: webShareUrl,
    };

    // Ưu tiên Web Share API trên thiết bị hỗ trợ
    let sharedViaNavigator = false;
    if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
      try {
        await navigator.share({
          title: 'Kết quả tạo ảnh AI — flowvis',
          text: `Xem tác phẩm ${getPipelineLabelVi(currentTask.value?.pipeline || 'face_swap')} được tạo trên flowvis:`,
          url: webShareUrl,
        });
        sharedViaNavigator = true;
        shareToastMessage.value = 'Đã mở bảng chia sẻ thành công!';
      } catch (err: unknown) {
        // Người dùng ấn hủy share hoặc không cấp quyền -> sao chép vào clipboard dự phòng
        if (err instanceof Error && err.name === 'AbortError') {
          return;
        }
      }
    }

    if (!sharedViaNavigator && typeof navigator !== 'undefined' && navigator.clipboard) {
      try {
        await navigator.clipboard.writeText(webShareUrl);
        shareToastMessage.value = 'Đã sao chép liên kết chia sẻ vào khay nhớ tạm!';
      } catch {
        shareToastMessage.value = `Đường dẫn chia sẻ: ${webShareUrl}`;
      }
    }
  } catch (err) {
    shareErrorVi.value = resolveApiErrorMessageVi(err);
  } finally {
    isSharing.value = false;
  }
}

// Xử lý thu hồi liên kết chia sẻ
async function handleRevokeShare(): Promise<void> {
  if (isSharing.value || isRevokingShare.value) return;
  isRevokingShare.value = true;
  shareToastMessage.value = null;
  shareErrorVi.value = null;

  try {
    await client.revokeTaskShare(taskId.value);
    shareData.value = null;
    shareToastMessage.value = 'Đã ngừng chia sẻ liên kết công khai.';
  } catch (err) {
    shareErrorVi.value = resolveApiErrorMessageVi(err);
  } finally {
    isRevokingShare.value = false;
  }
}

async function handleCopyShareLink(): Promise<void> {
  if (!shareData.value?.shareUrl) return;
  if (typeof navigator !== 'undefined' && navigator.clipboard) {
    try {
      await navigator.clipboard.writeText(shareData.value.shareUrl);
      shareToastMessage.value = 'Đã sao chép liên kết chia sẻ!';
    } catch {
      shareToastMessage.value = `Đường dẫn chia sẻ: ${shareData.value.shareUrl}`;
    }
  }
}

function handleGoBack(): void {
  if (window.history.length > 1) {
    router.back();
  } else {
    void router.push('/tasks');
  }
}
</script>

<template>
  <div data-testid="page-task-result" class="space-y-6">
    <!-- Top Bar: Nút quay lại & Tiêu đề & Badge trạng thái -->
    <div
      class="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-cyber-border bg-cyber-surface p-4 sm:p-5"
    >
      <div class="flex items-center gap-3">
        <button
          type="button"
          data-testid="back-button"
          aria-label="Quay lại"
          class="touch-target inline-flex min-h-[48px] min-w-[48px] items-center gap-1.5 rounded-xl border border-cyber-border bg-cyber-bg px-3.5 py-2 text-xs font-bold text-cyber-text transition hover:border-cyber-violet"
          @click="handleGoBack"
        >
          <Icon name="lucide:arrow-left" class="h-4 w-4" />
          <span>Lịch sử</span>
        </button>

        <div v-if="currentTask">
          <h1 class="font-display text-base font-bold sm:text-lg">
            {{ getPipelineLabelVi(currentTask.pipeline) }}
          </h1>
          <p class="font-mono text-xs text-cyber-muted">
            {{ formatTaskTimestampVi(currentTask.createdAt) }}
          </p>
        </div>
      </div>

      <!-- Badge trạng thái -->
      <div v-if="currentTask" class="flex items-center gap-2">
        <span
          v-if="currentTask.status === 'succeeded'"
          data-testid="badge-succeeded"
          class="inline-flex items-center gap-1.5 rounded-full border border-cyber-emerald/50 bg-cyber-emerald/15 px-3 py-1 font-mono text-xs font-bold text-cyber-emerald"
        >
          <Icon name="lucide:check-circle-2" class="h-3.5 w-3.5" />
          <span>{{ getTaskStatusLabelVi(currentTask) }}</span>
        </span>

        <span
          v-else
          class="inline-flex items-center gap-1.5 rounded-full border border-cyber-border bg-cyber-bg px-3 py-1 font-mono text-xs font-bold text-cyber-muted"
        >
          {{ getTaskStatusLabelVi(currentTask) }}
        </span>
      </div>
    </div>

    <!-- Thông báo Toast chia sẻ thành công hoặc lỗi -->
    <div
      v-if="shareToastMessage"
      data-testid="share-toast"
      class="flex items-center justify-between rounded-xl border border-cyber-emerald/40 bg-cyber-emerald/10 p-3.5 text-xs text-cyber-emerald"
    >
      <div class="flex items-center gap-2">
        <Icon name="lucide:check-circle-2" class="h-4 w-4 shrink-0" />
        <span>{{ shareToastMessage }}</span>
      </div>
      <button
        type="button"
        class="touch-target p-1 text-cyber-emerald hover:opacity-80"
        @click="shareToastMessage = null"
      >
        <Icon name="lucide:x" class="h-4 w-4" />
      </button>
    </div>

    <div
      v-if="shareErrorVi"
      data-testid="share-error"
      class="flex items-center justify-between rounded-xl border border-cyber-danger/40 bg-cyber-danger/10 p-3.5 text-xs text-cyber-danger"
    >
      <div class="flex items-center gap-2">
        <Icon name="lucide:alert-circle" class="h-4 w-4 shrink-0" />
        <span>{{ shareErrorVi }}</span>
      </div>
      <button
        type="button"
        class="touch-target p-1 text-cyber-danger hover:opacity-80"
        @click="shareErrorVi = null"
      >
        <Icon name="lucide:x" class="h-4 w-4" />
      </button>
    </div>

    <!-- Trạng thái: Chưa đăng nhập -->
    <div
      v-if="isUnauthenticated"
      data-testid="result-unauthenticated"
      class="flex flex-col items-center justify-center rounded-2xl border border-cyber-border bg-cyber-surface p-10 text-center sm:p-12"
    >
      <div
        class="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl border border-cyber-violet/40 bg-cyber-violet/15 text-cyber-violet"
      >
        <Icon name="lucide:log-in" class="h-7 w-7" />
      </div>
      <h2 class="font-display text-lg font-bold">
        Yêu Cầu Đăng Nhập
      </h2>
      <p class="mt-1.5 max-w-sm text-sm text-cyber-muted">
        Vui lòng đăng nhập để xem chi tiết tác vụ này.
      </p>
      <button
        type="button"
        class="touch-target mt-5 inline-flex min-h-[48px] min-w-[48px] items-center justify-center gap-2 rounded-xl bg-cyber-violet px-6 py-2.5 text-xs font-semibold text-cyber-text transition hover:bg-cyber-violet/90"
        @click="openAuthDialog('login')"
      >
        <Icon name="lucide:log-in" class="h-4 w-4" />
        <span>Đăng nhập ngay</span>
      </button>
    </div>

    <!-- Trạng thái: Đang tải thông tin task -->
    <div
      v-else-if="taskAsync.pending.value && !currentTask"
      data-testid="result-skeleton"
      class="h-96 animate-pulse rounded-2xl border border-cyber-border bg-cyber-surface/50"
    />

    <!-- Trạng thái: Lỗi không tìm thấy hoặc lỗi server -->
    <div
      v-else-if="taskErrorVi"
      data-testid="task-error-state"
      class="flex flex-col items-center justify-center rounded-2xl border border-cyber-border bg-cyber-surface p-10 text-center sm:p-12"
    >
      <div
        class="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl border border-cyber-danger/40 bg-cyber-danger/15 text-cyber-danger"
      >
        <Icon name="lucide:alert-circle" class="h-7 w-7" />
      </div>
      <h2 class="font-display text-lg font-bold text-cyber-danger">
        Không Thể Tải Tác Vụ
      </h2>
      <p class="mt-1.5 max-w-sm text-sm text-cyber-muted">
        {{ taskErrorVi }}
      </p>
      <button
        type="button"
        class="touch-target mt-5 inline-flex min-h-[48px] min-w-[48px] items-center justify-center gap-2 rounded-xl border border-cyber-border bg-cyber-bg px-5 py-2.5 text-xs font-semibold text-cyber-text transition hover:border-cyber-violet"
        @click="() => taskAsync.refresh()"
      >
        <Icon name="lucide:refresh-cw" class="h-4 w-4" />
        <span>Thử lại</span>
      </button>
    </div>

    <!-- Trạng thái: Đang chờ hoặc đang xử lý -->
    <div
      v-else-if="currentTask && (currentTask.status === 'queued' || currentTask.status === 'running')"
      data-testid="task-in-progress-view"
      class="space-y-4"
    >
      <TaskProgressCard
        :task="currentTask"
        @update:task="(t) => currentTask = t"
      />
    </div>

    <!-- Trạng thái: Thất bại, quá hạn hoặc bị hủy -->
    <div
      v-else-if="currentTask && (currentTask.status === 'failed' || currentTask.status === 'timed_out' || currentTask.status === 'cancelled')"
      data-testid="task-terminal-failed-view"
      class="space-y-4"
    >
      <TaskProgressCard
        :task="currentTask"
        :polling="false"
      />
    </div>

    <!-- Trạng thái: Hết hạn lưu 30 ngày -->
    <div
      v-else-if="isExpired"
      data-testid="retention-expired-view"
      class="flex flex-col items-center justify-center rounded-2xl border border-cyber-border bg-cyber-surface p-10 text-center sm:p-12"
    >
      <div
        class="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl border border-cyber-warning/40 bg-cyber-warning/15 text-cyber-warning"
      >
        <Icon name="lucide:clock-alert" class="h-7 w-7" />
      </div>
      <h2 class="font-display text-lg font-bold text-cyber-warning">
        Kết Quả Đã Hết Hạn Lưu Trữ
      </h2>
      <p class="mt-2 max-w-md text-sm text-cyber-muted">
        Ảnh kết quả đã quá thời hạn lưu trữ 30 ngày và đã được dọn dẹp tự động khỏi máy chủ theo chính sách bảo mật của hệ thống.
      </p>
      <NuxtLink
        to="/face-swap"
        class="touch-target mt-5 inline-flex min-h-[48px] min-w-[48px] items-center justify-center gap-2 rounded-xl bg-cyber-violet px-6 py-2.5 text-xs font-semibold text-cyber-text transition hover:bg-cyber-violet/90"
      >
        <Icon name="lucide:sparkles" class="h-4 w-4" />
        <span>Tạo tác vụ mới</span>
      </NuxtLink>
    </div>

    <!-- Trạng thái: Succeeded - Hiển thị kết quả & So sánh Trước/Sau -->
    <div
      v-else-if="currentTask && currentTask.status === 'succeeded'"
      data-testid="result-success-view"
      class="space-y-5"
    >
      <!-- Khung lỗi tải kết quả (nếu có) kèm nút tải lại -->
      <div
        v-if="resultErrorVi || imageLoadFailed"
        data-testid="result-fetch-error"
        class="flex flex-col items-center justify-between gap-3 rounded-2xl border border-cyber-danger/40 bg-cyber-danger/10 p-5 text-center sm:flex-row sm:text-left"
      >
        <div class="flex items-center gap-3">
          <Icon name="lucide:alert-circle" class="h-6 w-6 text-cyber-danger shrink-0" />
          <p class="text-xs text-cyber-danger">
            {{ resultErrorVi || 'Không thể tải ảnh kết quả' }} — Đường dẫn ảnh có thể đã hết hạn.
          </p>
        </div>
        <button
          type="button"
          class="touch-target inline-flex min-h-[48px] min-w-[48px] items-center justify-center gap-1.5 rounded-xl border border-cyber-danger/50 bg-cyber-danger/20 px-4 py-2 text-xs font-semibold text-cyber-danger transition hover:bg-cyber-danger/30"
          @click="handleRefreshResult"
        >
          <Icon name="lucide:refresh-cw" class="h-4 w-4" />
          <span>Lấy lại link mới</span>
        </button>
      </div>

      <!-- Đang tải URL ký kết quả -->
      <div
        v-else-if="resultAsync.pending.value && !resultAsync.data.value"
        class="h-96 animate-pulse rounded-2xl border border-cyber-border bg-cyber-surface/50"
      />

      <!-- Component So Sánh Trước/Sau BeforeAfterSplitSlider -->
      <template v-else-if="resultAsync.data.value">
        <BeforeAfterSplitSlider
          :result-url="resultAsync.data.value.resultUrl"
          :source-url="resultAsync.data.value.sourceUrl"
          :alt="`Kết quả ${getPipelineLabelVi(currentTask.pipeline)}`"
          @image-error="handleImageError"
        />

        <!-- Khung hiển thị link đã chia sẻ nếu có -->
        <div
          v-if="shareData"
          data-testid="shared-link-card"
          class="flex flex-col justify-between gap-3 rounded-2xl border border-cyber-cyan/40 bg-cyber-surface p-4 sm:flex-row sm:items-center"
        >
          <div class="min-w-0 flex-1">
            <span class="text-[11px] font-bold uppercase tracking-wider text-cyber-cyan">
              Liên kết chia sẻ công khai
            </span>
            <p class="truncate font-mono text-xs text-cyber-text">
              {{ shareData.shareUrl }}
            </p>
          </div>
          <div class="flex items-center gap-2">
            <button
              type="button"
              data-testid="copy-share-link-button"
              class="touch-target inline-flex min-h-[48px] min-w-[48px] items-center justify-center gap-1.5 rounded-xl border border-cyber-cyan/50 bg-cyber-cyan/15 px-3.5 py-2 text-xs font-semibold text-cyber-cyan transition hover:bg-cyber-cyan/25"
              @click="handleCopyShareLink"
            >
              <Icon name="lucide:copy" class="h-4 w-4" />
              <span>Sao chép</span>
            </button>
            <button
              type="button"
              data-testid="revoke-share-button"
              :disabled="isRevokingShare"
              class="touch-target inline-flex min-h-[48px] min-w-[48px] items-center justify-center gap-1.5 rounded-xl border border-cyber-danger/40 bg-cyber-danger/15 px-3.5 py-2 text-xs font-semibold text-cyber-danger transition hover:bg-cyber-danger/25 disabled:cursor-not-allowed disabled:opacity-50"
              @click="handleRevokeShare"
            >
              <Icon name="lucide:link-2-off" class="h-4 w-4" />
              <span>Ngừng chia sẻ</span>
            </button>
          </div>
        </div>

        <!-- Các nút hành động chính (Tải ảnh HD, Chia sẻ, Tạo tác vụ mới) -->
        <div class="flex flex-col gap-3">
          <!-- Nút Tải ảnh HD 1 chạm -->
          <button
            type="button"
            data-testid="download-result-button"
            class="touch-target inline-flex min-h-[50px] w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-cyber-emerald to-cyber-cyan px-6 py-3 font-display text-sm font-bold text-black shadow-[0_6px_20px_-3px_rgba(16,185,129,0.4)] transition hover:opacity-95"
            @click="handleDownloadImage"
          >
            <Icon name="lucide:download" class="h-5 w-5" />
            <span>Tải Ảnh HD (Không Watermark)</span>
          </button>

          <!-- Nút phụ: Chia sẻ & Tạo tác vụ mới -->
          <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <button
              v-if="!shareData"
              type="button"
              data-testid="share-task-button"
              :disabled="isSharing"
              class="touch-target inline-flex min-h-[48px] min-w-[48px] items-center justify-center gap-2 rounded-xl border border-cyber-border bg-cyber-surface px-4 py-2.5 text-xs font-bold text-cyber-text transition hover:border-cyber-violet disabled:cursor-not-allowed disabled:opacity-50"
              @click="handleShare"
            >
              <Icon
                :name="isSharing ? 'lucide:loader-circle' : 'lucide:share-2'"
                class="h-4 w-4 text-cyber-cyan"
                :class="{ 'animate-spin': isSharing }"
              />
              <span>{{ isSharing ? 'Đang tạo liên kết...' : 'Chia sẻ kết quả' }}</span>
            </button>

            <button
              v-else
              type="button"
              data-testid="share-task-button-shared"
              class="touch-target inline-flex min-h-[48px] min-w-[48px] items-center justify-center gap-2 rounded-xl border border-cyber-cyan/50 bg-cyber-cyan/15 px-4 py-2.5 text-xs font-bold text-cyber-cyan transition hover:bg-cyber-cyan/25"
              @click="handleCopyShareLink"
            >
              <Icon name="lucide:link" class="h-4 w-4" />
              <span>Đã chia sẻ (Sao chép lại)</span>
            </button>

            <NuxtLink
              to="/face-swap"
              class="touch-target inline-flex min-h-[48px] min-w-[48px] items-center justify-center gap-2 rounded-xl border border-cyber-border bg-cyber-surface px-4 py-2.5 text-xs font-bold text-cyber-text transition hover:border-cyber-violet"
            >
              <Icon name="lucide:sparkles" class="h-4 w-4 text-cyber-violet" />
              <span>Tạo tác vụ Face Swap khác</span>
            </NuxtLink>
          </div>
        </div>
      </template>
    </div>
  </div>
</template>
