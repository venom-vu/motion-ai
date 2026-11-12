<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import type { Task, TaskResultResponse } from '@flowvis/contracts';
import { useApiClient } from '~/composables/useApiClient';
import { badgeClass, getTaskStatusBadge } from '~/utils/status-badge';
import {
  formatTaskTimestampVi,
  getPipelineLabelVi,
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
const isSucceeded = computed(() => props.task.status === 'succeeded');

const isExpired = computed(() => isTaskRetentionExpired(props.task.createdAt));

const statusBadge = computed(() => getTaskStatusBadge(props.task));
const pipelineLabel = computed(() => getPipelineLabelVi(props.task.pipeline));
const formattedTime = computed(() => formatTaskTimestampVi(props.task.createdAt));

// Task thành công: lấy ảnh kết quả (hoặc ảnh bìa và độ dài video) lười, chỉ phía client, một lần cho mỗi dòng.
const videoInfo = ref<Pick<TaskResultResponse, 'posterUrl' | 'durationSeconds'> | null>(null);
const imageUrl = ref<string | null>(null);
const posterFailed = ref(false);
const isVideoTask = computed(() => props.task.pipeline === 'motion_control');
const showThumb = computed(() => isSucceeded.value && !isExpired.value);
const thumbUrl = computed(() =>
  posterFailed.value ? null : (videoInfo.value?.posterUrl ?? imageUrl.value),
);

let mounted = false;
async function loadVideoInfo(): Promise<void> {
  videoInfo.value = null;
  imageUrl.value = null;
  posterFailed.value = false;
  if (!showThumb.value) return;
  const requestedId = props.task.id;
  try {
    const { client } = useApiClient();
    const res = await client.getTaskResult(requestedId);
    // Bỏ kết quả của lần gọi cũ nếu dòng đã chuyển sang Task khác.
    if (!mounted || props.task.id !== requestedId) return;
    if (res.mediaType === 'video') {
      videoInfo.value = {
        posterUrl: res.posterUrl,
        durationSeconds: res.durationSeconds,
      };
    } else {
      imageUrl.value = res.resultUrl;
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
  <tr
    :data-testid="`task-card-${task.id}`"
    class="transition hover:bg-cyber-bg/50"
  >
    <!-- Tác vụ: ảnh/ảnh bìa kết quả & tên pipeline -->
    <td class="border-b border-cyber-border/70 px-4 py-3 align-middle sm:px-6">
      <div class="flex items-center gap-3">
        <div
          :data-testid="isVideoTask ? `task-video-thumb-${task.id}` : `task-image-thumb-${task.id}`"
          class="relative flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-cyber-border bg-cyber-bg"
        >
          <img
            v-if="showThumb && thumbUrl"
            :src="thumbUrl"
            :alt="isVideoTask ? 'Ảnh bìa video kết quả' : 'Ảnh kết quả'"
            loading="lazy"
            class="h-full w-full object-cover"
            @error="posterFailed = true"
          />
          <Icon
            v-else
            :name="isVideoTask ? 'lucide:clapperboard' : 'lucide:image'"
            class="h-5 w-5 text-cyber-muted"
          />
          <span
            v-if="showThumb && videoInfo?.durationSeconds"
            data-testid="task-video-duration"
            class="absolute bottom-0.5 right-0.5 rounded bg-black/70 px-1 font-mono text-[10px] font-semibold text-cyber-text"
          >
            {{ videoInfo.durationSeconds }}s
          </span>
        </div>
        <span class="font-display text-sm font-bold text-cyber-text">
          {{ pipelineLabel }}
        </span>
      </div>
    </td>

    <!-- Thời gian tạo -->
    <td class="whitespace-nowrap border-b border-cyber-border/70 px-4 py-3 align-middle font-mono text-xs text-cyber-muted sm:px-6">
      {{ formattedTime }}
    </td>

    <!-- Trạng thái: chỉ badge ngắn gọn; nguyên nhân lỗi xem ở trang chi tiết -->
    <td class="border-b border-cyber-border/70 px-4 py-3 align-middle sm:px-6">
      <div class="flex flex-wrap items-center gap-1.5">
        <span
          :data-testid="`status-${task.status}`"
          :class="badgeClass(statusBadge.tone)"
        >
          <Icon
            v-if="statusBadge.icon"
            :name="statusBadge.icon"
            class="h-3.5 w-3.5"
            :class="{ 'animate-spin': task.status === 'running' }"
          />
          {{ statusBadge.label }}
        </span>
        <span
          v-if="isExpired && isSucceeded"
          data-testid="retention-expired-badge"
          :class="badgeClass('slate')"
        >
          Hết hạn lưu
        </span>
      </div>
    </td>

    <!-- Chi phí -->
    <td class="whitespace-nowrap border-b border-cyber-border/70 px-4 py-3 text-right align-middle font-mono text-xs font-semibold text-cyber-cyan sm:px-6">
      {{ task.creditCost }} CR
    </td>

    <!-- Hành động -->
    <td class="border-b border-cyber-border/70 px-4 py-3 text-right align-middle sm:px-6">
      <div class="flex items-center justify-end gap-2">
        <!-- Nút Hủy khi Task đang queued -->
        <button
          v-if="isQueued"
          type="button"
          :data-testid="`cancel-task-button-${task.id}`"
          :disabled="cancelling"
          class="touch-target inline-flex min-h-[48px] min-w-[48px] items-center justify-center gap-1.5 whitespace-nowrap rounded-xl border border-cyber-danger/40 bg-cyber-danger/15 px-3.5 py-2 text-xs font-semibold text-cyber-danger transition hover:bg-cyber-danger/25 disabled:cursor-not-allowed disabled:opacity-50"
          @click="handleCancel"
        >
          <Icon name="lucide:x" class="h-4 w-4" />
          <span>Hủy</span>
        </button>

        <NuxtLink
          :to="`/tasks/${task.id}`"
          :data-testid="`view-task-link-${task.id}`"
          class="touch-target inline-flex min-h-[48px] min-w-[48px] items-center justify-center gap-1.5 whitespace-nowrap rounded-xl border border-cyber-border bg-cyber-bg px-3.5 py-2 text-xs font-semibold text-cyber-text transition hover:border-cyber-violet"
        >
          <span>Xem chi tiết</span>
          <Icon name="lucide:chevron-right" class="h-4 w-4" />
        </NuxtLink>
      </div>
    </td>
  </tr>
</template>
