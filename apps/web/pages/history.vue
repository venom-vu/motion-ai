<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { clearNuxtData, useAsyncData } from '#imports';
import type { WalletLedgerResponse } from '@flowvis/contracts';
import { useApiClient } from '~/composables/useApiClient';
import { useAuth } from '~/composables/useAuth';
import { useAuthDialog } from '~/composables/useAuthDialog';
import { resolveApiErrorMessageVi } from '~/utils/api-client';
import { isUnauthorizedError } from '~/utils/auth-session';
import { formatSignedCreditsVi } from '~/utils/catalog';
import {
  createWalletLedgerPagination,
  formatTimestampVi,
} from '~/utils/wallet-ledger';

const { client, accessToken } = useApiClient();
const { isAuthenticated, sessionChecked } = useAuth();
const { open: openAuthDialog } = useAuthDialog();

const ledgerAsync = useAsyncData<WalletLedgerResponse>(
  'flowvis-wallet-ledger',
  () => client.getWalletLedger({ pageSize: 20 }),
);

const pagination = createWalletLedgerPagination({
  client,
  pageSize: 20,
  initialData: () => ledgerAsync.data.value,
  isInitialPending: () => Boolean(ledgerAsync.pending.value),
  onRefreshInitial: async () => {
    await ledgerAsync.refresh();
    if (ledgerAsync.error.value) {
      return undefined;
    }
    return ledgerAsync.data.value ?? undefined;
  },
});

const {
  entries,
  hasMore,
  loadingMore,
  loadMoreErrorVi,
  loadMore,
  refresh: refreshLedger,
} = pagination;

watch(
  () => ledgerAsync.data.value,
  (newData) => {
    if (newData) {
      pagination.syncInitialData(newData);
    }
  },
  { immediate: true },
);

let tokenRefreshQueued = false;

// Dọn dẹp khi đăng xuất và tự động làm mới khi token thay đổi
watch(accessToken, (newToken, oldToken) => {
  // Chỉ làm mới khi trạng thái đăng nhập đổi; xoay vòng token không được xóa các trang đã cuộn.
  if (Boolean(newToken) !== Boolean(oldToken)) {
    if (!newToken) {
      clearNuxtData('flowvis-wallet-ledger');
      pagination.reset();
    }
    if (ledgerAsync.pending.value) {
      tokenRefreshQueued = true;
    } else {
      void refreshLedger();
    }
  }
});

watch(
  () => ledgerAsync.pending.value,
  (pending) => {
    if (!pending && tokenRefreshQueued) {
      tokenRefreshQueued = false;
      void refreshLedger();
    }
  },
);

const isUnauthenticated = computed<boolean>(() => {
  if (isUnauthorizedError(ledgerAsync.error.value)) {
    return true;
  }
  if (import.meta.server) {
    return false;
  }
  if (!isAuthenticated.value && !ledgerAsync.pending.value) {
    if (!sessionChecked.value && ledgerAsync.data.value?.items?.length) {
      return false;
    }
    return true;
  }
  return false;
});

const ledgerErrorVi = computed<string | null>(() => {
  if (!ledgerAsync.error.value) {
    return null;
  }
  if (isUnauthorizedError(ledgerAsync.error.value)) {
    return null;
  }
  return resolveApiErrorMessageVi(ledgerAsync.error.value);
});

const bottomSentinel = ref<HTMLElement | null>(null);
let observer: IntersectionObserver | null = null;

function setupObserver(): void {
  if (typeof IntersectionObserver === 'undefined') {
    return;
  }
  observer?.disconnect();
  observer = new IntersectionObserver(
    (observerEntries) => {
      const first = observerEntries[0];
      if (
        first?.isIntersecting &&
        hasMore.value &&
        !loadingMore.value &&
        !loadMoreErrorVi.value &&
        !ledgerAsync.pending.value
      ) {
        void loadMore();
      }
    },
    { rootMargin: '200px' },
  );
  if (bottomSentinel.value) {
    observer.observe(bottomSentinel.value);
  }
}

onMounted(() => {
  setupObserver();
});

watch(bottomSentinel, (newEl, oldEl) => {
  if (oldEl && observer) {
    observer.unobserve(oldEl);
  }
  if (newEl && observer) {
    observer.observe(newEl);
  }
});

onBeforeUnmount(() => {
  if (observer) {
    observer.disconnect();
    observer = null;
  }
});
</script>

<template>
  <div class="space-y-6" data-testid="page-history">
    <section
      class="flex flex-col justify-between gap-4 rounded-2xl border border-cyber-border bg-cyber-surface p-5 sm:flex-row sm:items-center"
    >
      <div class="space-y-1">
        <h1 class="font-display text-2xl font-bold text-cyber-text">
          Lịch Sử Biến Động Credit & Tác Vụ
        </h1>
      </div>

      <button
        type="button"
        data-testid="refresh-ledger-button"
        class="touch-target inline-flex min-h-[48px] min-w-[48px] items-center justify-center gap-2 rounded-xl border border-cyber-border bg-cyber-bg px-4 py-2.5 text-xs font-semibold text-cyber-text transition hover:border-cyber-violet disabled:opacity-50"
        :disabled="ledgerAsync.pending.value || loadingMore"
        @click="refreshLedger"
      >
        <Icon
          name="lucide:refresh-cw"
          class="h-4 w-4"
          :class="{ 'animate-spin': ledgerAsync.pending.value }"
        />
        <span>Làm mới sổ cái</span>
      </button>
    </section>

    <!-- Initial Load Error Banner: chỉ hiện ở trên khi entries đã có dữ liệu (tránh trùng lặp khi danh sách rỗng) -->
    <ApiErrorBanner
      :message-vi="entries.length > 0 ? ledgerErrorVi : null"
      :dismissible="false"
      @retry="refreshLedger"
    />

    <section
      class="overflow-hidden rounded-2xl border border-cyber-border bg-cyber-surface"
    >
      <!-- Skeleton khi đang tải trang đầu -->
      <div
        v-if="ledgerAsync.pending.value && entries.length === 0"
        data-testid="history-skeleton"
        role="status"
        aria-busy="true"
        aria-live="polite"
        class="divide-y divide-cyber-border"
      >
        <div
          v-for="i in 4"
          :key="i"
          class="flex animate-pulse flex-col justify-between gap-3 p-4 sm:flex-row sm:items-center sm:px-6"
        >
          <div class="space-y-2">
            <div class="flex items-center gap-2">
              <div class="h-5 w-16 rounded-md bg-cyber-border/70" />
              <div class="h-4 w-28 rounded bg-cyber-border/50" />
            </div>
            <div class="h-4 w-48 rounded bg-cyber-border/40 sm:w-72" />
          </div>
          <div class="h-5 w-24 rounded bg-cyber-border/60" />
        </div>
      </div>

      <!-- Trạng thái chưa đăng nhập (ưu tiên hàng đầu) -->
      <div
        v-else-if="isUnauthenticated"
        data-testid="history-unauthenticated"
        class="flex flex-col items-center justify-center p-10 text-center sm:p-12"
      >
        <div
          class="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl border border-cyber-violet/40 bg-cyber-violet/15 text-cyber-violet"
        >
          <Icon name="lucide:log-in" class="h-7 w-7" />
        </div>
        <h3 class="text-base font-semibold text-cyber-text">
          Yêu Cầu Đăng Nhập
        </h3>
        <p class="mt-1.5 max-w-sm text-sm text-cyber-muted">
          Vui lòng đăng nhập để xem lịch sử biến động credit và chi tiết các tác vụ của bạn.
        </p>
        <button
          type="button"
          data-testid="history-login-button"
          class="touch-target mt-6 inline-flex min-h-[48px] min-w-[48px] items-center justify-center gap-2 rounded-xl bg-cyber-violet px-6 py-2.5 text-sm font-semibold text-white shadow-lg shadow-cyber-violet/25 transition hover:brightness-110"
          @click="openAuthDialog('login')"
        >
          <Icon name="lucide:log-in" class="h-4 w-4" />
          <span>Đăng nhập ngay</span>
        </button>
      </div>

      <!-- Trạng thái lỗi tải trang đầu (bên trong khung khi danh sách rỗng) -->
      <div
        v-else-if="entries.length === 0 && ledgerErrorVi"
        data-testid="history-error-state"
        role="alert"
        class="flex flex-col items-center justify-center p-10 text-center sm:p-12"
      >
        <div
          class="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl border border-cyber-danger/40 bg-cyber-danger/15 text-cyber-danger"
        >
          <Icon name="lucide:triangle-alert" class="h-7 w-7" />
        </div>
        <h3 class="text-base font-semibold text-cyber-text">
          Không Thể Tải Sổ Cái
        </h3>
        <p class="mt-1.5 max-w-sm text-sm text-cyber-muted">
          {{ ledgerErrorVi }}
        </p>
        <button
          type="button"
          data-testid="history-retry-button"
          class="touch-target mt-6 inline-flex min-h-[48px] min-w-[48px] items-center justify-center gap-2 rounded-xl border border-cyber-border bg-cyber-bg px-6 py-2.5 text-sm font-semibold text-cyber-text transition hover:border-cyber-violet disabled:opacity-50"
          :disabled="ledgerAsync.pending.value || loadingMore"
          @click="refreshLedger"
        >
          <Icon
            name="lucide:refresh-cw"
            class="h-4 w-4"
            :class="{ 'animate-spin': ledgerAsync.pending.value }"
          />
          <span>Thử lại</span>
        </button>
      </div>

      <!-- Trạng thái rỗng -->
      <div
        v-else-if="entries.length === 0"
        data-testid="history-empty"
        class="flex flex-col items-center justify-center p-10 text-center sm:p-12"
      >
        <div
          class="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl border border-cyber-border bg-cyber-bg text-cyber-muted"
        >
          <Icon name="lucide:inbox" class="h-7 w-7" />
        </div>
        <h3 class="text-base font-semibold text-cyber-text">
          Chưa Có Biến Động Số Dư Nào
        </h3>
        <p class="mt-1.5 max-w-sm text-sm text-cyber-muted">
          Mọi bút toán tặng credit trải nghiệm, nạp gói hoặc tạm giữ và hoàn credit tác vụ sẽ hiển thị tại đây.
        </p>
      </div>

      <!-- Danh sách bút toán -->
      <template v-else-if="entries.length > 0">
        <ul class="divide-y divide-cyber-border" data-testid="ledger-list">
          <li
            v-for="item in entries"
            :key="item.id"
            :data-testid="`ledger-entry-${item.id}`"
            class="flex flex-col justify-between gap-3 p-4 sm:flex-row sm:items-center sm:px-6"
          >
            <div class="min-w-0 space-y-1">
              <div class="flex flex-wrap items-center gap-2">
                <span
                  class="rounded-md border border-cyber-violet/40 bg-cyber-violet/15 px-2.5 py-0.5 font-mono text-xs font-semibold text-cyber-text"
                >
                  {{ item.labelVi }}
                </span>
                <span class="font-mono text-xs text-cyber-muted">
                  {{ formatTimestampVi(item.createdAt) }}
                </span>
              </div>
              <p class="break-words text-sm text-cyber-text">
                {{ item.note || 'Giao dịch sổ cái hệ thống' }}
              </p>
            </div>

            <div class="shrink-0 font-mono text-sm font-bold sm:text-right">
              <span
                :class="
                  item.amount > 0
                    ? 'text-cyber-success'
                    : item.amount < 0
                      ? 'text-cyber-warning'
                      : 'text-cyber-muted'
                "
              >
                {{ formatSignedCreditsVi(item.amount) }}
              </span>
            </div>
          </li>
        </ul>

        <!-- Spinner khi tải thêm -->
        <div
          v-if="loadingMore"
          role="status"
          aria-live="polite"
          data-testid="loading-more-spinner"
          class="flex items-center justify-center gap-2 border-t border-cyber-border p-4 text-xs font-semibold text-cyber-muted"
        >
          <Icon name="lucide:loader-2" class="h-4 w-4 animate-spin text-cyber-violet" />
          <span>Đang tải thêm bút toán...</span>
        </div>

        <!-- Banner lỗi khi tải thêm bằng cursor -->
        <div
          v-if="loadMoreErrorVi"
          role="alert"
          data-testid="load-more-error"
          class="border-t border-cyber-border p-4"
        >
          <ApiErrorBanner
            :message-vi="loadMoreErrorVi"
            :dismissible="false"
            @retry="loadMore"
          />
        </div>

        <!-- Nút dự phòng Tải thêm khi chưa chạm sentinel -->
        <div
          v-if="hasMore && !loadingMore && !loadMoreErrorVi"
          class="flex justify-center border-t border-cyber-border p-4"
        >
          <button
            type="button"
            data-testid="load-more-button"
            class="touch-target inline-flex min-h-[48px] min-w-[48px] items-center justify-center gap-2 rounded-xl border border-cyber-border bg-cyber-bg px-5 py-2.5 text-xs font-semibold text-cyber-text transition hover:border-cyber-violet disabled:opacity-50"
            :disabled="Boolean(ledgerAsync.pending.value)"
            @click="loadMore"
          >
            <Icon name="lucide:arrow-down" class="h-4 w-4" />
            <span>Tải thêm lịch sử</span>
          </button>
        </div>

        <!-- Sentinel cuộn đáy vô tận -->
        <div
          v-if="hasMore"
          ref="bottomSentinel"
          data-testid="bottom-sentinel"
          class="h-1 w-full"
          aria-hidden="true"
        />

        <!-- Thông báo đã hiển thị toàn bộ -->
        <div
          v-if="!hasMore && entries.length > 0 && !ledgerAsync.pending.value"
          data-testid="all-loaded-notice"
          class="border-t border-cyber-border p-4 text-center font-mono text-xs text-cyber-muted"
        >
          Đã hiển thị toàn bộ lịch sử
        </div>
      </template>
    </section>
  </div>
</template>
