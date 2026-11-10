<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import type { Task, TaskResultResponse } from '@flowvis/contracts';
import { useApiClient } from '~/composables/useApiClient';
import { getReasonCodeMessageVi } from '@flowvis/contracts';
import {
  formatTaskTimestampVi,
  getPipelineLabelVi,
  getTaskStatusLabelVi,
  isTaskRetentionExpired,
} from '~/utils/task-format';

const props = withDefaults(
  defineProps<{
    task: Task;
    cancelling?: boolean;
  }>(),
  {
    cancelling: false,
  },
);

const emit = defineEmits<{
  (e: 'cancel', taskId: string): void;
}>();

const isQueued = computed(() => props.task.status === 'queued');
const isRunning = computed(() => props.task.status === 'running');
const isSucceeded = computed(() => props.task.status === 'succeeded');
const isFailed = computed(
  () =>
    props.task.status === 'failed' ||
    props.task.status === 'timed_out' ||
    props.task.status === 'cancelled',
);

const isExpired = computed(() => isTaskRetentionExpired(props.task.createdAt));

const statusLabel = computed(() => getTaskStatusLabelVi(props.task));
const pipelineLabel = computed(() => getPipelineLabelVi(props.task.pipeline));
const formattedTime = computed(() => formatTaskTimestampVi(props.task.createdAt));

const reasonMessage = computed(() => {
  if (!props.task.reasonCode) return null;
  return getReasonCodeMessageVi(props.task.reasonCode, props.task.pipeline);
});

// Task video: lấy ảnh bìa và độ dài lười (chỉ phía client, một lần cho mỗi thẻ hiển thị).
const videoInfo = ref<Pick<TaskResultResponse, 'posterUrl' | 'durationSeconds'> | null>(null);
const posterFailed = ref(false);
const isVideoTask = computed(() => props.task.pipeline === 'motion_control');

let mounted = false;
async function loadVideoInfo(): Promise<void> {
  videoInfo.value = null;
  posterFailed.value = false;
  if (!isVideoTask.value || !isSucceeded.value || isExpired.value) return;
  const requestedId = props.task.id;
  try {
    const { client } = useApiClient();
    const res = await client.getTaskResult(requestedId);
    // Bỏ kết quả của lần gọi cũ nếu thẻ đã chuyển sang Task khác.
    if (!mounted || props.task.id !== requestedId) return;
    if (res.mediaType === 'video') {
      videoInfo.value = {
        posterUrl: res.posterUrl,
        durationSeconds: res.durationSeconds,
      };
    }
  } catch {
    // Không có dữ liệu: dùng biểu tượng thay thế.
  }
}

onMounted(() => {
  mounted = true;
  void loadVideoInfo();
});
onBeforeUnmount(() => {
  mounted = false;
});
watch(
  () => [props.task.id, props.task.status],
  () => {
    if (mounted) void loadVideoInfo();
  },
);

function handleCancel(): void {
  emit('cancel', props.task.id);
}
</script>

<template>
  <div
    :data-testid="`task-card-${task.id}`"
    class="flex flex-col justify-between gap-3 rounded-2xl border border-cyber-border bg-cyber-surface p-4 transition hover:border-cyber-violet/50 sm:p-5"
  >
    <!-- Header: Pipeline & Trạng thái -->
    <div class="flex flex-wrap items-center justify-between gap-2">
      <div class="flex items-center gap-2">
        <span
          class="flex h-8 w-8 items-center justify-center rounded-lg border border-cyber-violet/40 bg-cyber-violet/15 text-cyber-violet"
        >
          <Icon name="lucide:sparkles" class="h-4 w-4" />
        </span>
        <div>
          <NuxtLink
            :to="`/tasks/${task.id}`"
            class="font-display text-sm font-bold text-cyber-text transition hover:text-cyber-violet hover:underline"
          >
            {{ pipelineLabel }}
          </NuxtLink>
          <p class="font-mono text-xs text-cyber-muted">
            {{ formattedTime }}
          </p>
        </div>
      </div>

      <!-- Badge trạng thái -->
      <div class="flex flex-wrap items-center gap-1.5">
        <span
          v-if="isQueued"
          data-testid="status-queued"
          class="inline-flex items-center gap-1 rounded-full border border-cyber-warning/50 bg-cyber-warning/15 px-2.5 py-0.5 font-mono text-xs font-semibold text-cyber-warning"
        >
          <Icon name="lucide:clock" class="h-3.5 w-3.5" />
          {{ statusLabel }}
        </span>

        <span
          v-else-if="isRunning"
          data-testid="status-running"
          class="inline-flex items-center gap-1 rounded-full border border-cyber-cyan/50 bg-cyber-cyan/15 px-2.5 py-0.5 font-mono text-xs font-semibold text-cyber-cyan"
        >
          <Icon name="lucide:loader-circle" class="h-3.5 w-3.5 animate-spin" />
          {{ statusLabel }}
        </span>

        <span
          v-else-if="isSucceeded"
          data-testid="status-succeeded"
          class="inline-flex items-center gap-1 rounded-full border border-cyber-emerald/50 bg-cyber-emerald/15 px-2.5 py-0.5 font-mono text-xs font-semibold text-cyber-emerald"
        >
          <Icon name="lucide:check-circle-2" class="h-3.5 w-3.5" />
          {{ statusLabel }}
        </span>

        <span
          v-else-if="isFailed"
          data-testid="status-failed"
          class="inline-flex items-center gap-1 rounded-full border border-cyber-danger/50 bg-cyber-danger/15 px-2.5 py-0.5 font-mono text-xs font-semibold text-cyber-danger"
        >
          <Icon name="lucide:alert-circle" class="h-3.5 w-3.5" />
          {{ statusLabel }}
        </span>

        <!-- Badge hết hạn lưu 30 ngày -->
        <span
          v-if="isExpired && isSucceeded"
          data-testid="retention-expired-badge"
          class="inline-flex items-center gap-1 rounded-full border border-cyber-border bg-cyber-bg px-2 py-0.5 text-[11px] font-semibold text-cyber-muted"
        >
          Hết hạn lưu 30 ngày
        </span>
      </div>
    </div>

    <!-- Ảnh bìa và độ dài cho Task video -->
    <div
      v-if="isVideoTask && isSucceeded && !isExpired"
      :data-testid="`task-video-thumb-${task.id}`"
      class="relative flex aspect-video w-full items-center justify-center overflow-hidden rounded-xl border border-cyber-border bg-cyber-bg"
    >
      <img
        v-if="videoInfo?.posterUrl && !posterFailed"
        :src="videoInfo.posterUrl"
        alt="Ảnh bìa video kết quả"
        loading="lazy"
        class="h-full w-full object-cover"
        @error="posterFailed = true"
      />
      <Icon
        v-else
        name="lucide:clapperboard"
        class="h-8 w-8 text-cyber-muted"
      />
      <span
        v-if="videoInfo?.durationSeconds"
        data-testid="task-video-duration"
        class="absolute bottom-2 right-2 rounded-md bg-black/70 px-2 py-0.5 font-mono text-[11px] font-semibold text-cyber-text"
      >
        {{ videoInfo.durationSeconds }}s
      </span>
    </div>

    <!-- Thông báo lỗi / hoàn tiền nếu thất bại -->
    <div
      v-if="isFailed && reasonMessage"
      data-testid="task-failure-reason"
      class="rounded-xl border border-cyber-danger/30 bg-cyber-danger/10 p-3 text-xs text-cyber-danger"
    >
      {{ reasonMessage }}
    </div>

    <!-- Footer: Chi phí & Các nút hành động -->
    <div class="flex items-center justify-between border-t border-cyber-border/70 pt-3">
      <span class="font-mono text-xs font-semibold text-cyber-cyan">
        {{ task.creditCost }} CR
      </span>

      <div class="flex items-center gap-2">
        <!-- Nút Hủy khi Task đang queued -->
        <button
          v-if="isQueued"
          type="button"
          :data-testid="`cancel-task-button-${task.id}`"
          :disabled="cancelling"
          class="touch-target inline-flex min-h-[48px] min-w-[48px] items-center justify-center gap-1.5 rounded-xl border border-cyber-danger/40 bg-cyber-danger/15 px-3.5 py-2 text-xs font-semibold text-cyber-danger transition hover:bg-cyber-danger/25 disabled:cursor-not-allowed disabled:opacity-50"
          @click="handleCancel"
        >
          <Icon name="lucide:x" class="h-4 w-4" />
          <span>Hủy tác vụ</span>
        </button>

        <!-- Nút Xem tiến trình khi Task running -->
        <NuxtLink
          v-if="isRunning"
          :to="`/tasks/${task.id}`"
          :data-testid="`view-progress-link-${task.id}`"
          class="touch-target inline-flex min-h-[48px] min-w-[48px] items-center justify-center gap-1.5 rounded-xl border border-cyber-cyan/50 bg-cyber-cyan/15 px-3.5 py-2 text-xs font-semibold text-cyber-cyan transition hover:bg-cyber-cyan/25"
        >
          <span>Xem tiến trình</span>
          <Icon name="lucide:arrow-right" class="h-4 w-4" />
        </NuxtLink>

        <!-- Nút Xem kết quả khi Task succeeded -->
        <NuxtLink
          v-if="isSucceeded"
          :to="`/tasks/${task.id}`"
          :data-testid="`view-result-link-${task.id}`"
          class="touch-target inline-flex min-h-[48px] min-w-[48px] items-center justify-center gap-1.5 rounded-xl bg-cyber-violet px-3.5 py-2 text-xs font-semibold text-cyber-text transition hover:bg-cyber-violet/90"
        >
          <span>Xem kết quả</span>
          <Icon name="lucide:arrow-right" class="h-4 w-4" />
        </NuxtLink>
      </div>
    </div>
  </div>
</template>
