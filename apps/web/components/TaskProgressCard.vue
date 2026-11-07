<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import type { Task } from '@motion-ai/contracts';
import { useApiClient } from '~/composables/useApiClient';
import {
  getReasonCodeMessageVi,
  resolveApiErrorMessageVi,
} from '~/utils/api-client';

const props = withDefaults(
  defineProps<{
    task: Task | null;
    polling?: boolean;
    pollIntervalMs?: number;
    pipelineLabelVi?: string;
    }>(),
  {
    polling: true,
    pollIntervalMs: 2500,
    pipelineLabelVi: 'Hoán đổi khuôn mặt',
    },
);

const emit = defineEmits<{
  'update:task': [task: Task];
  cancel: [taskId: string];
  retry: [];
  completed: [task: Task];
  settled: [task: Task];
}>();

const { client } = useApiClient();

const localTask = ref<Task | null>(props.task);
const isCancelling = ref<boolean>(false);
const isFetching = ref<boolean>(false);
const actionErrorVi = ref<string | null>(null);
const pollCount = ref<number>(0);

let pollTimer: ReturnType<typeof setInterval> | null = null;

watch(
  [() => props.task, () => props.polling],
  ([nextTask, nextPolling], [prevTask, prevPolling]) => {
    localTask.value = nextTask;
    // Chỉ reset nhịp đếm và timer khi Task ID thay đổi hoặc bật/tắt polling
    if (nextTask?.id !== prevTask?.id || nextPolling !== prevPolling) {
      if (!isCancelling.value) {
        actionErrorVi.value = null;
      }
      pollCount.value = 0;
      checkPollingNeed();
    } else if (!nextPolling) {
      stopTimers();
    }
  },
  { deep: true },
);

const isTerminal = computed<boolean>(() => {
  if (!localTask.value) return true;
  return (
    localTask.value.status === 'succeeded' ||
    localTask.value.status === 'failed' ||
    localTask.value.status === 'timed_out' ||
    localTask.value.status === 'cancelled'
  );
});

const isQueued = computed<boolean>(() => localTask.value?.status === 'queued');
const isRunning = computed<boolean>(() => localTask.value?.status === 'running');
const isSucceeded = computed<boolean>(
  () => localTask.value?.status === 'succeeded',
);
const isFailed = computed<boolean>(
  () =>
    localTask.value?.status === 'failed' ||
    localTask.value?.status === 'timed_out' ||
    localTask.value?.status === 'cancelled',
);

const reasonMessageVi = computed<string>(() => {
  if (!localTask.value) return '';
  if (localTask.value.status === 'cancelled') {
    return 'Tác vụ đã được hủy theo yêu cầu của bạn.';
  }
  return getReasonCodeMessageVi(
    localTask.value.reasonCode,
    localTask.value.pipeline,
  );
});

function stopTimers(): void {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
  pollCount.value = 0;
}

async function fetchLatestStatus(): Promise<void> {
  if (!localTask.value || isTerminal.value || isFetching.value) return;

  isFetching.value = true;
  try {
    const updated = await client.getTask(localTask.value.id);
    if (!isCancelling.value) {
      actionErrorVi.value = null;
    }
    localTask.value = updated;
    emit('update:task', updated);

    if (updated.status === 'succeeded') {
      stopTimers();
      emit('completed', updated);
      emit('settled', updated);
    } else if (
      updated.status === 'failed' ||
      updated.status === 'timed_out' ||
      updated.status === 'cancelled'
    ) {
      stopTimers();
      emit('settled', updated);
    }
  } catch (error: unknown) {
    // Không gián đoạn polling nếu mạng chập chờn tạm thời
    actionErrorVi.value = resolveApiErrorMessageVi(error);
  } finally {
    isFetching.value = false;
  }
}

function checkPollingNeed(): void {
  stopTimers();
  if (!props.polling || !localTask.value || isTerminal.value) {
    return;
  }

  pollTimer = setInterval(() => {
    pollCount.value += 1;
    void fetchLatestStatus();

    // Sau 30 nhịp polling (~75s), giảm tần suất thăm dò xuống 5s để tránh tải mạng
    if (pollCount.value === 30 && pollTimer) {
      clearInterval(pollTimer);
      pollTimer = setInterval(() => {
        pollCount.value += 1;
        void fetchLatestStatus();
      }, 5000);
    }
  }, props.pollIntervalMs);
}

async function handleCancel(): Promise<void> {
  if (!localTask.value || isCancelling.value || !isQueued.value) return;

  isCancelling.value = true;
  actionErrorVi.value = null;

  try {
    const cancelled = await client.cancelTask(localTask.value.id);
    stopTimers();
    localTask.value = cancelled;
    emit('update:task', cancelled);
    emit('cancel', cancelled.id);
    emit('settled', cancelled);
  } catch (error: unknown) {
    actionErrorVi.value = resolveApiErrorMessageVi(error);
  } finally {
    isCancelling.value = false;
  }
}

function handleRetry(): void {
  stopTimers();
  emit('retry');
}

onMounted(() => {
  checkPollingNeed();
});

onBeforeUnmount(() => {
  stopTimers();
});
</script>

<template>
  <div
    v-if="localTask"
    class="relative overflow-hidden rounded-2xl border border-cyber-border bg-cyber-surface p-5 text-cyber-text shadow-xl sm:p-6"
    data-testid="task-progress-card"
    :data-status="localTask.status"
  >
    <!-- Trạng thái 1: QUEUED (Đang xếp hàng đợi) -->
    <div
      v-if="isQueued"
      class="space-y-4"
      data-testid="task-queued-state"
    >
      <div class="flex flex-wrap items-center justify-between gap-3">
        <div class="flex items-center gap-3">
          <span
            class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-cyber-cyan/40 bg-cyber-cyan/15 text-cyber-cyan"
          >
            <Icon name="lucide:clock" class="h-5 w-5" />
          </span>
          <div>
            <h3 class="font-display text-sm font-bold sm:text-base">
              Đang trong hàng đợi xử lý
            </h3>
            <p class="text-xs text-cyber-muted">
              {{ pipelineLabelVi }}
            </p>
          </div>
        </div>

        <span
          data-testid="queue-position-badge"
          class="inline-flex items-center gap-1.5 rounded-full border border-cyber-cyan/50 bg-cyber-cyan/15 px-3 py-1 font-mono text-xs font-bold text-cyber-cyan"
        >
          <Icon name="lucide:users" class="h-3.5 w-3.5" />
          <span>Vị trí: #{{ localTask.queuePosition ?? 1 }}</span>
        </span>
      </div>

      <p class="text-xs leading-relaxed text-cyber-muted sm:text-sm">
        Hệ thống đang chuẩn bị tài nguyên GPU và điều phối tác vụ. Trạng thái
        được cập nhật tự động. Bạn có thể rời trang, tác vụ vẫn sẽ tiếp tục chạy
        ngầm và lưu trong mục Lịch Sử.
      </p>

      <div
        v-if="actionErrorVi"
        class="rounded-xl border border-cyber-danger/40 bg-cyber-danger/10 p-3 text-xs text-cyber-danger"
      >
        {{ actionErrorVi }}
      </div>

      <div class="flex items-center justify-end pt-1">
        <button
          type="button"
          data-testid="cancel-task-button"
          :disabled="isCancelling"
          class="touch-target inline-flex min-h-[48px] min-w-[48px] items-center justify-center gap-2 rounded-xl border border-cyber-danger/50 bg-cyber-danger/15 px-4 py-2.5 text-xs font-semibold text-cyber-danger transition hover:bg-cyber-danger/25 disabled:cursor-not-allowed disabled:opacity-50"
          @click="handleCancel"
        >
          <Icon
            v-if="isCancelling"
            name="lucide:loader-2"
            class="h-4 w-4 animate-spin"
          />
          <Icon v-else name="lucide:ban" class="h-4 w-4" />
          <span>{{ isCancelling ? 'Đang hủy...' : 'Hủy tác vụ' }}</span>
        </button>
      </div>
    </div>

    <!-- Trạng thái 2: RUNNING (Đang chạy GPU) -->
    <div
      v-else-if="isRunning"
      class="space-y-4"
      data-testid="task-running-state"
    >
      <div class="flex flex-wrap items-center justify-between gap-3">
        <div class="flex items-center gap-3">
          <span
            class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-cyber-violet/50 bg-cyber-violet/20 text-cyber-violet"
          >
            <Icon name="lucide:loader-2" class="h-5 w-5 animate-spin text-cyber-violet" />
          </span>
          <div>
            <h3 class="font-display text-sm font-bold sm:text-base">
              Đang xử lý {{ pipelineLabelVi }}...
            </h3>
            <p class="text-xs text-cyber-muted">
              Đang thực thi mô hình AI trên RunningHub
            </p>
          </div>
        </div>

        <span
          data-testid="running-status-badge"
          class="inline-flex items-center gap-1.5 rounded-full border border-cyber-violet/50 bg-cyber-violet/15 px-3 py-1 font-mono text-xs font-bold text-cyber-violet"
        >
          <Icon name="lucide:sparkles" class="h-3.5 w-3.5" />
          <span>Đang thực thi</span>
        </span>
      </div>

      <!-- Thanh tiến trình nhịp xung điện tử Slate Cyber -->
      <div
        role="progressbar"
        aria-label="Tiến trình xử lý AI"
        aria-valuemin="0"
        aria-valuemax="100"
        class="relative h-2 w-full overflow-hidden rounded-full bg-cyber-bg"
      >
        <div
          class="absolute inset-y-0 left-0 w-1/2 animate-[pulse_1.5s_ease-in-out_infinite] rounded-full bg-gradient-to-r from-cyber-violet to-cyber-cyan"
        />
      </div>

      <p class="text-xs leading-relaxed text-cyber-muted sm:text-sm">
        AI đang phân tích khuôn mặt, căn chỉnh góc xoay và tái tạo biểu cảm chi
        tiết. Quá trình này thường diễn ra trong khoảng 10–25 giây.
      </p>

      <div
        v-if="actionErrorVi"
        class="rounded-xl border border-cyber-danger/40 bg-cyber-danger/10 p-3 text-xs text-cyber-danger"
      >
        {{ actionErrorVi }}
      </div>
    </div>

    <!-- Trạng thái 3: SUCCEEDED (Thành công) -->
    <div
      v-else-if="isSucceeded"
      class="space-y-4"
      data-testid="task-succeeded-state"
    >
      <div class="flex flex-wrap items-center justify-between gap-3">
        <div class="flex items-center gap-3">
          <span
            class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-cyber-emerald/50 bg-cyber-emerald/20 text-cyber-emerald"
          >
            <Icon name="lucide:check-circle-2" class="h-5 w-5" />
          </span>
          <div>
            <h3 class="font-display text-sm font-bold text-cyber-emerald sm:text-base">
              Hoán đổi khuôn mặt thành công!
            </h3>
            <p class="text-xs text-cyber-muted">
              Hình ảnh chất lượng cao đã sẵn sàng
            </p>
          </div>
        </div>

        <span
          data-testid="succeeded-status-badge"
          class="inline-flex items-center gap-1.5 rounded-full border border-cyber-emerald/50 bg-cyber-emerald/15 px-3 py-1 font-mono text-xs font-bold text-cyber-emerald"
        >
          <Icon name="lucide:check" class="h-3.5 w-3.5" />
          <span>Đã hoàn tất</span>
        </span>
      </div>

      <p class="text-xs leading-relaxed text-cyber-muted sm:text-sm">
        Tác vụ đã hoàn tất và kết quả đã được lưu trữ an toàn trên máy chủ đám
        mây. Bạn có thể xem kết quả trực tiếp hoặc tải ảnh về thiết bị.
      </p>

      <div class="flex flex-wrap items-center justify-end gap-2.5 pt-1">
        <button
          type="button"
          data-testid="create-new-button"
          class="touch-target inline-flex min-h-[48px] min-w-[48px] items-center justify-center gap-2 rounded-xl border border-cyber-border bg-cyber-bg px-4 py-2.5 text-xs font-semibold text-cyber-text transition hover:border-cyber-violet"
          @click="handleRetry"
        >
          <Icon name="lucide:plus" class="h-4 w-4 text-cyber-cyan" />
          <span>Tạo ảnh mới</span>
        </button>

        <NuxtLink
          :to="localTask?.id ? `/tasks/${localTask.id}` : '/tasks'"
          data-testid="view-result-button"
          class="touch-target inline-flex min-h-[48px] min-w-[48px] items-center justify-center gap-2 rounded-xl bg-cyber-violet px-4 py-2.5 text-xs font-semibold text-cyber-text transition hover:bg-cyber-violet/90"
        >
          <Icon name="lucide:external-link" class="h-4 w-4" />
          <span>Xem Kết Quả</span>
        </NuxtLink>
      </div>
    </div>

    <!-- Trạng thái 4: FAILED / TIMED_OUT / CANCELLED (Lỗi & Hoàn Credit) -->
    <div
      v-else-if="isFailed"
      class="space-y-4"
      data-testid="task-failed-state"
    >
      <div class="flex flex-wrap items-center justify-between gap-3">
        <div class="flex items-center gap-3">
          <span
            class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border p-2 text-cyber-danger"
            :class="[
              localTask.status === 'cancelled'
                ? 'border-cyber-muted/40 bg-cyber-muted/15 text-cyber-muted'
                : 'border-cyber-danger/50 bg-cyber-danger/20 text-cyber-danger',
            ]"
          >
            <Icon
              :name="
                localTask.status === 'cancelled'
                  ? 'lucide:ban'
                  : 'lucide:alert-triangle'
              "
              class="h-5 w-5"
            />
          </span>
          <div>
            <h3
              class="font-display text-sm font-bold sm:text-base"
              :class="[
                localTask.status === 'cancelled'
                  ? 'text-cyber-muted'
                  : 'text-cyber-danger',
              ]"
            >
              {{
                localTask.status === 'cancelled'
                  ? 'Tác vụ đã được hủy'
                  : localTask.status === 'timed_out'
                    ? 'Tác vụ quá thời gian xử lý'
                    : 'Xử lý tác vụ thất bại'
              }}
            </h3>
            <p class="text-xs text-cyber-muted">
              Mã trạng thái: {{ localTask.reasonCode || localTask.status }}
            </p>
          </div>
        </div>

        <span
          data-testid="failure-status-badge"
          class="inline-flex items-center gap-1.5 rounded-full border px-3 py-1 font-mono text-xs font-bold"
          :class="[
            localTask.status === 'cancelled'
              ? 'border-cyber-muted/40 bg-cyber-muted/15 text-cyber-muted'
              : 'border-cyber-danger/40 bg-cyber-danger/15 text-cyber-danger',
          ]"
        >
          <span>{{ localTask.status }}</span>
        </span>
      </div>

      <!-- Hộp giải thích lỗi tiếng Việt -->
      <div
        class="rounded-xl border border-cyber-border bg-cyber-bg/70 p-3.5 space-y-2 text-xs sm:text-sm"
      >
        <p class="font-medium text-cyber-text">
          {{ reasonMessageVi }}
        </p>

        <!-- Nêu rõ hoàn 100% credit theo FR8 & Story 2.11 AC -->
        <p
          data-testid="credit-refund-note"
          class="flex items-center gap-2 font-mono text-xs font-semibold text-cyber-emerald"
        >
          <Icon name="lucide:shield-check" class="h-4 w-4 shrink-0 text-cyber-emerald" />
          <span>
            Đã hoàn trả 100% credit ({{ localTask.creditCost || 100 }} CR) vào số dư ví của bạn.
          </span>
        </p>
      </div>

      <!-- Riêng mã lỗi FREE_WAIT_EXPIRED: gợi ý thử lại hoặc nạp credit nâng hạng -->
      <div
        v-if="localTask.reasonCode === 'FREE_WAIT_EXPIRED'"
        data-testid="free-wait-expired-hint"
        class="flex flex-col gap-3 rounded-xl border border-cyber-warning/40 bg-cyber-warning/10 p-3.5 text-xs sm:flex-row sm:items-center sm:justify-between"
      >
        <div class="space-y-1">
          <p class="font-semibold text-cyber-warning">
            Hàng đợi miễn phí đã quá hạn 15 phút
          </p>
          <p class="text-cyber-muted">
            Do nhu cầu sử dụng cao, tác vụ FREE đã hết hạn chờ. Bạn có thể nạp
            gói Starter (49.000đ) để được xử lý ưu tiên ngay trên Lane trả phí.
          </p>
        </div>

        <NuxtLink
          to="/pricing"
          data-testid="upgrade-tier-button"
          class="touch-target inline-flex min-h-[48px] shrink-0 items-center justify-center gap-1.5 rounded-xl border border-cyber-warning/50 bg-cyber-warning/20 px-3.5 py-2 font-semibold text-cyber-warning transition hover:bg-cyber-warning/30"
        >
          <Icon name="lucide:zap" class="h-4 w-4" />
          <span>Nạp Credit ưu tiên</span>
        </NuxtLink>
      </div>

      <div class="flex items-center justify-end pt-1">
        <button
          type="button"
          data-testid="retry-task-button"
          class="touch-target inline-flex min-h-[48px] min-w-[48px] items-center justify-center gap-2 rounded-xl bg-cyber-violet px-5 py-2.5 text-xs font-semibold text-cyber-text transition hover:bg-cyber-violet/90"
          @click="handleRetry"
        >
          <Icon name="lucide:refresh-cw" class="h-4 w-4" />
          <span>Tạo lại tác vụ</span>
        </button>
      </div>
    </div>
  </div>
</template>

