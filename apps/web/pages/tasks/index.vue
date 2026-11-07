<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { clearNuxtData, refreshNuxtData, useAsyncData, useHead } from '#imports';
import type { Task, TaskListResponse } from '@motion-ai/contracts';
import { ME_KEY, useApiClient } from '~/composables/useApiClient';
import { useAuth } from '~/composables/useAuth';
import { useAuthDialog } from '~/composables/useAuthDialog';
import { resolveApiErrorMessageVi } from '~/utils/api-client';
import { isUnauthorizedError } from '~/utils/auth-session';

useHead({
  title: 'Lịch Sử Tác Vụ — Motion AI',
  meta: [
    {
      name: 'description',
      content: 'Xem lại các tác vụ AI đã thực hiện, trạng thái xử lý và kết quả tạo ảnh/video.',
    },
  ],
});

const { client, accessToken } = useApiClient();
const { isAuthenticated, sessionChecked } = useAuth();
const { open: openAuthDialog } = useAuthDialog();

const PAGE_SIZE = 20;

const tasksAsync = useAsyncData<TaskListResponse>(
  'motion-ai-tasks-list',
  () => client.listTasks({ pageSize: PAGE_SIZE }),
);

const items = ref<Task[]>([]);
const nextCursor = ref<string | null>(null);
const hasMore = ref<boolean>(false);
const loadingMore = ref<boolean>(false);
const loadMoreErrorVi = ref<string | null>(null);
const cancellingTaskId = ref<string | null>(null);
const actionMessageVi = ref<string | null>(null);
const actionErrorVi = ref<string | null>(null);

watch(
  () => tasksAsync.data.value,
  (newData) => {
    if (newData) {
      items.value = [...newData.items];
      nextCursor.value = newData.nextCursor ?? null;
      hasMore.value = Boolean(newData.hasMore);
    }
  },
  { immediate: true },
);

// Đồng bộ theo trạng thái đăng nhập
watch(accessToken, (newToken, oldToken) => {
  if (Boolean(newToken) !== Boolean(oldToken)) {
    if (!newToken) {
      clearNuxtData('motion-ai-tasks-list');
      items.value = [];
      nextCursor.value = null;
      hasMore.value = false;
    }
    void tasksAsync.refresh();
  }
});

const isUnauthenticated = computed<boolean>(() => {
  if (isUnauthorizedError(tasksAsync.error.value)) {
    return true;
  }
  if (import.meta.server) {
    return false;
  }
  if (!isAuthenticated.value && !tasksAsync.pending.value) {
    if (!sessionChecked.value && Boolean(tasksAsync.data.value?.items)) {
      return false;
    }
    return true;
  }
  return false;
});

const initialErrorVi = computed<string | null>(() => {
  if (isUnauthenticated.value || !tasksAsync.error.value) return null;
  return resolveApiErrorMessageVi(tasksAsync.error.value);
});

async function loadMore(): Promise<void> {
  if (loadingMore.value || !hasMore.value || !nextCursor.value) return;
  loadingMore.value = true;
  loadMoreErrorVi.value = null;

  try {
    const res = await client.listTasks({
      pageSize: PAGE_SIZE,
      cursor: nextCursor.value,
    });
    // Tránh trùng lặp
    const existingIds = new Set(items.value.map((t) => t.id));
    const newItems = res.items.filter((t) => !existingIds.has(t.id));
    items.value = [...items.value, ...newItems];
    nextCursor.value = res.nextCursor ?? null;
    hasMore.value = Boolean(res.hasMore);
  } catch (err) {
    loadMoreErrorVi.value = resolveApiErrorMessageVi(err);
  } finally {
    loadingMore.value = false;
  }
}

async function handleCancelTask(taskId: string): Promise<void> {
  if (cancellingTaskId.value) return;
  cancellingTaskId.value = taskId;
  actionMessageVi.value = null;
  actionErrorVi.value = null;

  try {
    const updated = await client.cancelTask(taskId);
    const idx = items.value.findIndex((t) => t.id === taskId);
    if (idx !== -1) {
      items.value[idx] = updated;
    }
    actionMessageVi.value = 'Đã hủy tác vụ thành công. Credit đã được hoàn lại ví.';
    // Đồng bộ lại số dư credit trên Header
    void refreshNuxtData(ME_KEY);
  } catch (err) {
    actionErrorVi.value = resolveApiErrorMessageVi(err);
    // Làm mới lại danh sách đề phòng Task đã chuyển sang running
    void tasksAsync.refresh();
  } finally {
    cancellingTaskId.value = null;
  }
}

// Tự động tải thêm khi cuộn xuống đáy màn hình
const sentinelRef = ref<HTMLElement | null>(null);
let observer: IntersectionObserver | null = null;

function setupObserver(el: HTMLElement | null): void {
  if (observer) {
    observer.disconnect();
    observer = null;
  }
  if (typeof IntersectionObserver !== 'undefined' && el) {
    observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && hasMore.value && !loadingMore.value) {
          void loadMore();
        }
      },
      { rootMargin: '200px' },
    );
    observer.observe(el);
  }
}

watch(sentinelRef, (newEl) => {
  setupObserver(newEl);
});

onMounted(() => {
  if (sentinelRef.value) {
    setupObserver(sentinelRef.value);
  }
});

// Tự động cập nhật danh sách khi có tác vụ đang chờ/xử lý
let pollTimer: ReturnType<typeof setInterval> | null = null;
watch(
  items,
  (newItems) => {
    const hasActive = newItems.some(
      (t) => t.status === 'queued' || t.status === 'running',
    );
    if (hasActive && !pollTimer) {
      pollTimer = setInterval(() => {
        void tasksAsync.refresh();
      }, 5000);
    } else if (!hasActive && pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  },
  { immediate: true },
);

onBeforeUnmount(() => {
  if (observer) {
    observer.disconnect();
    observer = null;
  }
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
});
</script>

<template>
  <div data-testid="page-tasks" class="space-y-6">
    <!-- Header: Tiêu đề & Điều hướng phụ -->
    <div
      class="flex flex-col justify-between gap-4 rounded-2xl border border-cyber-border bg-cyber-surface p-5 sm:flex-row sm:items-center"
    >
      <div class="flex items-center gap-3">
        <span
          class="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-cyber-violet/50 bg-cyber-violet/20 text-cyber-violet"
        >
          <Icon name="lucide:history" class="h-6 w-6" />
        </span>
        <div>
          <h1 class="font-display text-xl font-bold sm:text-2xl">
            Lịch Sử Tác Vụ
          </h1>
          <p class="text-xs text-cyber-muted">
            Quản lý các tác vụ AI, trạng thái xử lý và kết quả tạo ảnh/video
          </p>
        </div>
      </div>

      <div class="flex items-center gap-2">
        <NuxtLink
          to="/history"
          class="touch-target inline-flex min-h-[48px] min-w-[48px] items-center gap-1.5 rounded-xl border border-cyber-border bg-cyber-bg px-3.5 py-2 text-xs font-semibold text-cyber-muted transition hover:border-cyber-violet/50 hover:text-cyber-text"
        >
          <Icon name="lucide:coins" class="h-4 w-4" />
          <span>Biến động Credit</span>
        </NuxtLink>

        <button
          type="button"
          data-testid="refresh-tasks-button"
          aria-label="Làm mới danh sách tác vụ"
          :disabled="Boolean(tasksAsync.pending.value)"
          class="touch-target inline-flex min-h-[48px] min-w-[48px] items-center justify-center gap-1.5 rounded-xl border border-cyber-violet/50 bg-cyber-violet/15 px-4 py-2 text-xs font-semibold text-cyber-text transition hover:bg-cyber-violet/25 disabled:cursor-not-allowed disabled:opacity-50"
          @click="() => tasksAsync.refresh()"
        >
          <Icon
            name="lucide:refresh-cw"
            class="h-4 w-4"
            :class="{ 'animate-spin': Boolean(tasksAsync.pending.value) }"
          />
          <span>Làm mới</span>
        </button>
      </div>
    </div>

    <!-- Thông báo kết quả hành động (hủy thành công hoặc lỗi) -->
    <div
      v-if="actionMessageVi"
      data-testid="tasks-action-message"
      class="flex items-center justify-between rounded-xl border border-cyber-emerald/40 bg-cyber-emerald/10 p-3.5 text-xs text-cyber-emerald"
    >
      <div class="flex items-center gap-2">
        <Icon name="lucide:check-circle-2" class="h-4 w-4 shrink-0" />
        <span>{{ actionMessageVi }}</span>
      </div>
      <button
        type="button"
        class="touch-target p-1 text-cyber-emerald hover:opacity-80"
        @click="actionMessageVi = null"
      >
        <Icon name="lucide:x" class="h-4 w-4" />
      </button>
    </div>

    <div
      v-if="actionErrorVi"
      data-testid="tasks-action-error"
      class="flex items-center justify-between rounded-xl border border-cyber-danger/40 bg-cyber-danger/10 p-3.5 text-xs text-cyber-danger"
    >
      <div class="flex items-center gap-2">
        <Icon name="lucide:alert-circle" class="h-4 w-4 shrink-0" />
        <span>{{ actionErrorVi }}</span>
      </div>
      <button
        type="button"
        class="touch-target p-1 text-cyber-danger hover:opacity-80"
        @click="actionErrorVi = null"
      >
        <Icon name="lucide:x" class="h-4 w-4" />
      </button>
    </div>

    <!-- Trạng thái: Đang tải lần đầu -->
    <div
      v-if="tasksAsync.pending.value && !items.length"
      data-testid="tasks-skeleton"
      class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
    >
      <div
        v-for="i in 4"
        :key="i"
        class="h-44 animate-pulse rounded-2xl border border-cyber-border bg-cyber-surface/50"
      />
    </div>

    <!-- Trạng thái: Chưa đăng nhập -->
    <div
      v-else-if="isUnauthenticated"
      data-testid="tasks-unauthenticated"
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
        Vui lòng đăng nhập để xem lịch sử tác vụ đã xử lý và quản lý kết quả ảnh/video của bạn.
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

    <!-- Trạng thái: Lỗi tải danh sách -->
    <div
      v-else-if="initialErrorVi"
      data-testid="tasks-error"
      class="flex flex-col items-center justify-center rounded-2xl border border-cyber-border bg-cyber-surface p-10 text-center sm:p-12"
    >
      <div
        class="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl border border-cyber-danger/40 bg-cyber-danger/15 text-cyber-danger"
      >
        <Icon name="lucide:alert-circle" class="h-7 w-7" />
      </div>
      <h2 class="font-display text-lg font-bold text-cyber-danger">
        Không Thể Tải Lịch Sử Tác Vụ
      </h2>
      <p class="mt-1.5 max-w-sm text-sm text-cyber-muted">
        {{ initialErrorVi }}
      </p>
      <button
        type="button"
        class="touch-target mt-5 inline-flex min-h-[48px] min-w-[48px] items-center justify-center gap-2 rounded-xl border border-cyber-border bg-cyber-bg px-5 py-2.5 text-xs font-semibold text-cyber-text transition hover:border-cyber-violet"
        @click="() => tasksAsync.refresh()"
      >
        <Icon name="lucide:refresh-cw" class="h-4 w-4" />
        <span>Thử lại</span>
      </button>
    </div>

    <!-- Trạng thái: Danh sách rỗng -->
    <div
      v-else-if="!items.length"
      data-testid="tasks-empty"
      class="flex flex-col items-center justify-center rounded-2xl border border-cyber-border bg-cyber-surface p-10 text-center sm:p-12"
    >
      <div
        class="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl border border-cyber-border bg-cyber-bg text-cyber-muted"
      >
        <Icon name="lucide:inbox" class="h-7 w-7" />
      </div>
      <h2 class="font-display text-lg font-bold">
        Chưa Có Tác Vụ Nào
      </h2>
      <p class="mt-1.5 max-w-sm text-sm text-cyber-muted">
        Bạn chưa tạo tác vụ nào. Hãy bắt đầu trải nghiệm ngay các công cụ hoán đổi khuôn mặt và chỉnh ảnh AI.
      </p>
      <NuxtLink
        to="/"
        class="touch-target mt-5 inline-flex min-h-[48px] min-w-[48px] items-center justify-center gap-2 rounded-xl bg-cyber-violet px-6 py-2.5 text-xs font-semibold text-cyber-text transition hover:bg-cyber-violet/90"
      >
        <Icon name="lucide:sparkles" class="h-4 w-4" />
        <span>Khám phá Kho AI</span>
      </NuxtLink>
    </div>

    <!-- Trạng thái: Có dữ liệu -->
    <div v-else class="space-y-4">
      <div
        data-testid="tasks-list"
        class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
      >
        <TaskHistoryCard
          v-for="task in items"
          :key="task.id"
          :task="task"
          :cancelling="cancellingTaskId === task.id"
          @cancel="handleCancelTask"
        />
      </div>

      <!-- Vùng tải thêm khi cuộn -->
      <div ref="sentinelRef" class="py-2">
        <div
          v-if="loadingMore"
          data-testid="loading-more-spinner"
          class="flex items-center justify-center gap-2 py-4 text-xs font-semibold text-cyber-muted"
        >
          <Icon name="lucide:loader-circle" class="h-4 w-4 animate-spin text-cyber-violet" />
          <span>Đang tải thêm tác vụ...</span>
        </div>

        <div
          v-else-if="loadMoreErrorVi"
          data-testid="load-more-error"
          class="flex flex-col items-center gap-2 py-4 text-center"
        >
          <p class="text-xs text-cyber-danger">
            {{ loadMoreErrorVi }}
          </p>
          <button
            type="button"
            class="touch-target inline-flex min-h-[48px] min-w-[48px] items-center justify-center gap-1.5 rounded-xl border border-cyber-border bg-cyber-surface px-4 py-2 text-xs font-semibold text-cyber-text transition hover:border-cyber-violet"
            @click="loadMore"
          >
            <Icon name="lucide:refresh-cw" class="h-3.5 w-3.5" />
            <span>Thử tải lại</span>
          </button>
        </div>

        <div
          v-else-if="hasMore"
          class="flex justify-center py-4"
        >
          <button
            type="button"
            data-testid="load-more-button"
            class="touch-target inline-flex min-h-[48px] min-w-[48px] items-center justify-center gap-2 rounded-xl border border-cyber-border bg-cyber-surface px-5 py-2.5 text-xs font-semibold text-cyber-text transition hover:border-cyber-violet"
            @click="loadMore"
          >
            <span>Tải thêm tác vụ</span>
            <Icon name="lucide:chevron-down" class="h-4 w-4" />
          </button>
        </div>

        <p
          v-else-if="items.length > 5"
          data-testid="all-tasks-loaded"
          class="py-4 text-center font-mono text-xs text-cyber-muted"
        >
          Đã hiển thị toàn bộ lịch sử tác vụ.
        </p>
      </div>
    </div>
  </div>
</template>
