<script setup lang="ts">
import { onMounted, ref, watch } from 'vue';
import type { Topup, TopupPackId } from '@flowvis/contracts';
import { useAuth } from '~/composables/useAuth';
import { useAuthDialog } from '~/composables/useAuthDialog';
import { usePricingConfig } from '~/composables/usePricingConfig';
import { useTopup } from '~/composables/useTopup';
import { formatNumberVi, formatVndVi } from '~/utils/catalog';
import {
  formatTopupTimestampVi,
  getTopupStatusBadgeClass,
  getTopupStatusLabelVi,
} from '~/utils/topup';

const { isAuthenticated } = useAuth();
const { open: openAuthDialog } = useAuthDialog();
const {
  pricing,
  currentTier,
  isLoading,
  errorMessageVi,
  refreshAll,
  clearError,
} = usePricingConfig();

const {
  activeTopup,
  isModalOpen,
  isCreating,
  isConfirming,
  createErrorVi,
  confirmErrorVi,
  remainingSeconds,
  formattedCountdown,
  isExpired,
  isOutsideHours,
  topups,
  isLoadingList,
  isLoadingMore,
  listErrorVi,
  hasMore,
  openModal,
  closeModal,
  createOrder,
  confirmTransfer,
  fetchTopups,
  loadMore,
} = useTopup();

const creatingPackId = ref<TopupPackId | null>(null);

onMounted(() => {
  if (isAuthenticated.value) {
    void fetchTopups();
  }
});

watch(
  isAuthenticated,
  (authed) => {
    if (authed) {
      void fetchTopups();
    } else {
      closeModal();
      topups.value = [];
    }
  },
);

async function handleSelectPack(packId: TopupPackId): Promise<void> {
  if (!isAuthenticated.value) {
    openAuthDialog('login');
    return;
  }
  if (isCreating.value) {
    return;
  }
  creatingPackId.value = packId;
  try {
    await createOrder(packId);
  } finally {
    creatingPackId.value = null;
  }
}

function handleOpenOrder(order: Topup): void {
  openModal(order);
}

async function handleRecreateOrder(pack: TopupPackId): Promise<void> {
  if (!isAuthenticated.value) {
    closeModal();
    openAuthDialog('login');
    return;
  }
  closeModal();
  creatingPackId.value = pack;
  try {
    await createOrder(pack);
  } finally {
    creatingPackId.value = null;
  }
}

function dismissCreateError(): void {
  createErrorVi.value = null;
}
</script>

<template>
  <div class="flex flex-col gap-6" data-testid="page-pricing">
    <!-- Header Bảng Giá -->
    <section
      class="rounded-2xl border border-cyber-border bg-cyber-surface p-5 sm:p-6"
    >
      <div
        class="flex flex-col justify-between gap-4 sm:flex-row sm:items-center"
      >
        <div class="flex items-center gap-3">
          <span
            class="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-cyber-violet/40 bg-cyber-violet/15 text-cyber-violet"
          >
            <Icon name="lucide:gem" class="h-6 w-6" />
          </span>
          <div class="space-y-0.5">
            <h1 class="font-display text-xl font-bold text-cyber-text sm:text-2xl">
              Bảng Giá Gói Nạp &amp; Quyền Lợi Hạng Tài Khoản
            </h1>
            <p class="text-xs text-cyber-muted">
              Chọn gói nạp để nhận mã VietQR thanh toán ngay và nâng cấp trần thời lượng video
            </p>
          </div>
        </div>

        <span
          class="inline-flex items-center gap-2 self-start rounded-xl border border-cyber-cyan/40 bg-cyber-bg px-3.5 py-2 font-mono text-xs font-semibold text-cyber-cyan sm:self-center"
        >
          <Icon name="lucide:award" class="h-4 w-4" />
          <span>Hạng hiện tại: {{ currentTier }}</span>
        </span>
      </div>
    </section>

    <ApiErrorBanner
      :message-vi="errorMessageVi"
      @retry="refreshAll"
      @dismiss="clearError"
    />

    <!-- Banner lỗi tạo đơn nạp nếu có -->
    <div
      v-if="createErrorVi"
      data-testid="topup-create-error"
      role="alert"
      class="flex items-center justify-between gap-3 rounded-2xl border border-cyber-danger/40 bg-cyber-danger/10 p-4 text-xs text-cyber-danger"
    >
      <div class="flex items-center gap-2.5">
        <Icon name="lucide:alert-circle" class="h-4 w-4 shrink-0" />
        <span>{{ createErrorVi }}</span>
      </div>
      <button
        type="button"
        aria-label="Đóng thông báo lỗi"
        class="touch-target inline-flex min-h-[48px] min-w-[48px] shrink-0 items-center justify-center rounded-xl text-cyber-danger transition hover:bg-cyber-danger/15"
        @click="dismissCreateError"
      >
        <Icon name="lucide:x" class="h-4 w-4" />
      </button>
    </div>

    <div
      v-if="isLoading && !pricing"
      class="flex items-center justify-center gap-3 rounded-2xl border border-cyber-border bg-cyber-surface p-10 text-sm text-cyber-muted"
    >
      <Icon
        name="lucide:loader-circle"
        class="h-5 w-5 animate-spin text-cyber-violet"
      />
      <span>Đang tải bảng giá từ hệ thống...</span>
    </div>

    <template v-else-if="pricing">
      <!-- Danh sách các gói nạp và Tier từ pricing.tiers -->
      <section
        aria-label="Danh sách các hạng tài khoản"
        data-testid="pricing-tiers-grid"
        class="grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-4"
      >
        <article
          v-for="tierItem in pricing.tiers"
          :key="tierItem.tier"
          :data-testid="`tier-card-${tierItem.tier}`"
          class="flex flex-col justify-between rounded-2xl border bg-cyber-surface p-5 transition"
          :class="
            tierItem.tier === currentTier
              ? 'border-cyber-violet shadow-lg shadow-cyber-violet/10'
              : 'border-cyber-border hover:border-cyber-violet/50'
          "
        >
          <div class="space-y-3">
            <div class="flex items-center justify-between">
              <h2 class="font-display text-lg font-bold text-cyber-text">
                Hạng {{ tierItem.tier }}
              </h2>
              <span
                class="rounded-full border border-cyber-border bg-cyber-bg px-2.5 py-0.5 font-mono text-xs text-cyber-muted"
              >
                Ưu tiên #{{ tierItem.priority }}
              </span>
            </div>

            <p class="font-mono text-2xl font-bold text-cyber-cyan">
              {{ formatVndVi(tierItem.priceVnd) }}
            </p>

            <ul
              class="space-y-2 border-t border-cyber-border pt-3 text-xs text-cyber-muted"
            >
              <li class="flex items-center gap-2">
                <Icon name="lucide:coins" class="h-4 w-4 text-cyber-cyan" />
                <span>
                  Số lượng:
                  <strong class="font-mono text-cyber-text">
                    {{ formatNumberVi(tierItem.credits) }} credit
                  </strong>
                </span>
              </li>
              <li class="flex items-center gap-2">
                <Icon name="lucide:timer" class="h-4 w-4 text-cyber-violet" />
                <span>
                  Trần video Motion:
                  <strong class="font-mono text-cyber-text">
                    {{ formatNumberVi(tierItem.maxVideoSeconds) }} giây
                  </strong>
                </span>
              </li>
            </ul>
          </div>

          <div class="mt-5 pt-2">
            <button
              v-if="tierItem.packId"
              type="button"
              :data-testid="`topup-pack-button-${tierItem.packId}`"
              :disabled="isCreating"
              class="touch-target inline-flex min-h-[48px] min-w-[48px] w-full items-center justify-center gap-2 rounded-xl bg-cyber-violet px-4 py-2.5 text-xs font-semibold text-cyber-text transition hover:bg-cyber-violet/90 disabled:cursor-not-allowed disabled:opacity-50"
              @click="handleSelectPack(tierItem.packId)"
            >
              <Icon
                :name="
                  isCreating && creatingPackId === tierItem.packId
                    ? 'lucide:loader-2'
                    : 'lucide:qr-code'
                "
                class="h-4 w-4"
                :class="{
                  'animate-spin':
                    isCreating && creatingPackId === tierItem.packId,
                }"
              />
              <span>
                {{
                  isCreating && creatingPackId === tierItem.packId
                    ? 'Đang tạo mã QR...'
                    : `Nạp gói ${tierItem.tier} qua VietQR`
                }}
              </span>
            </button>
            <button
              v-else
              type="button"
              disabled
              class="touch-target inline-flex min-h-[48px] min-w-[48px] w-full items-center justify-center gap-2 rounded-xl border border-cyber-border bg-cyber-bg px-4 py-2.5 text-xs font-semibold text-cyber-muted"
            >
              <Icon name="lucide:check" class="h-4 w-4" />
              <span>Hạng mặc định khi đăng ký</span>
            </button>
          </div>
        </article>
      </section>
    </template>

    <!-- Lịch Sử Đơn Nạp Credit: chỉ hiển thị khi người dùng đã đăng nhập -->
    <section
      v-if="isAuthenticated"
      data-testid="pricing-topup-history"
      class="overflow-hidden rounded-2xl border border-cyber-border bg-cyber-surface"
    >
      <!-- Header của khung Lịch Sử Đơn Nạp -->
      <div
        class="flex flex-col justify-between gap-4 border-b border-cyber-border p-5 sm:flex-row sm:items-center"
      >
        <div class="flex items-center gap-3">
          <span
            class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-cyber-violet/40 bg-cyber-violet/15 text-cyber-violet"
          >
            <Icon name="lucide:receipt" class="h-5 w-5" />
          </span>
          <div>
            <h2 class="font-display text-lg font-bold text-cyber-text">
              Lịch Sử Đơn Nạp Credit
            </h2>
            <p class="text-xs text-cyber-muted">
              Theo dõi trạng thái thanh toán VietQR và lịch sử các gói đã nạp
            </p>
          </div>
        </div>

        <div class="flex flex-wrap items-center gap-2">
          <NuxtLink
            to="/history"
            class="touch-target inline-flex min-h-[48px] min-w-[48px] items-center justify-center gap-1.5 rounded-xl border border-cyber-border bg-cyber-bg px-3.5 py-2 text-xs font-semibold text-cyber-muted transition hover:border-cyber-violet/50 hover:text-cyber-text"
          >
            <Icon name="lucide:clock-3" class="h-4 w-4" />
            <span>Biến động số dư</span>
          </NuxtLink>

          <button
            type="button"
            data-testid="refresh-topups-button"
            :disabled="isLoadingList || isLoadingMore"
            class="touch-target inline-flex min-h-[48px] min-w-[48px] items-center justify-center gap-1.5 rounded-xl border border-cyber-border bg-cyber-bg px-4 py-2 text-xs font-semibold text-cyber-text transition hover:border-cyber-violet disabled:cursor-not-allowed disabled:opacity-50"
            @click="fetchTopups()"
          >
            <Icon
              name="lucide:refresh-cw"
              class="h-4 w-4"
              :class="{ 'animate-spin': isLoadingList }"
            />
            <span>Làm mới</span>
          </button>
        </div>
      </div>

      <!-- Banner lỗi khi đã có danh sách nhưng làm mới thất bại -->
      <div
        v-if="listErrorVi && topups.length > 0"
        data-testid="topup-list-error"
        class="flex items-center justify-between gap-3 border-b border-cyber-border bg-cyber-danger/10 px-5 py-3 text-xs text-cyber-danger"
      >
        <div class="flex items-center gap-2">
          <Icon name="lucide:alert-circle" class="h-4 w-4 shrink-0" />
          <span>{{ listErrorVi }}</span>
        </div>
        <button
          type="button"
          class="touch-target inline-flex min-h-[48px] min-w-[48px] items-center justify-center font-semibold text-cyber-cyan hover:underline"
          @click="fetchTopups()"
        >
          Thử lại
        </button>
      </div>

      <!-- Đang tải lần đầu (Skeleton) -->
      <div
        v-if="isLoadingList && topups.length === 0"
        data-testid="topup-list-loading"
        role="status"
        aria-busy="true"
        aria-live="polite"
        class="divide-y divide-cyber-border"
      >
        <span class="sr-only">Đang tải lịch sử đơn nạp...</span>
        <div
          v-for="i in 3"
          :key="i"
          class="flex animate-pulse flex-col justify-between gap-3 p-4 sm:flex-row sm:items-center sm:px-6"
        >
          <div class="space-y-2">
            <div class="flex items-center gap-2">
              <div class="h-5 w-24 rounded-md bg-cyber-border/70" />
              <div class="h-5 w-20 rounded-full bg-cyber-border/50" />
            </div>
            <div class="h-4 w-48 rounded bg-cyber-border/40 sm:w-64" />
          </div>
          <div class="h-9 w-28 rounded-xl bg-cyber-border/60" />
        </div>
      </div>

      <!-- Lỗi tải danh sách khi chưa có dữ liệu -->
      <div
        v-else-if="listErrorVi && topups.length === 0"
        data-testid="topup-list-error"
        role="alert"
        class="flex flex-col items-center justify-center p-10 text-center sm:p-12"
      >
        <div
          class="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl border border-cyber-danger/40 bg-cyber-danger/15 text-cyber-danger"
        >
          <Icon name="lucide:triangle-alert" class="h-7 w-7" />
        </div>
        <h3 class="text-base font-semibold text-cyber-text">
          Không Thể Tải Lịch Sử Đơn Nạp
        </h3>
        <p class="mt-1.5 max-w-sm text-sm text-cyber-muted">
          {{ listErrorVi }}
        </p>
        <button
          type="button"
          class="touch-target mt-6 inline-flex min-h-[48px] min-w-[48px] items-center justify-center gap-2 rounded-xl border border-cyber-border bg-cyber-bg px-6 py-2.5 text-xs font-semibold text-cyber-text transition hover:border-cyber-violet"
          @click="fetchTopups()"
        >
          <Icon name="lucide:refresh-cw" class="h-4 w-4" />
          <span>Thử lại</span>
        </button>
      </div>

      <!-- Trạng thái rỗng -->
      <div
        v-else-if="!isLoadingList && topups.length === 0"
        data-testid="topup-list-empty"
        class="flex flex-col items-center justify-center p-10 text-center sm:p-12"
      >
        <div
          class="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl border border-cyber-border bg-cyber-bg text-cyber-muted"
        >
          <Icon name="lucide:inbox" class="h-7 w-7" />
        </div>
        <h3 class="text-base font-semibold text-cyber-text">
          Bạn chưa có đơn nạp nào
        </h3>
        <p class="mt-1.5 max-w-sm text-sm text-cyber-muted">
          Các đơn nạp qua VietQR sẽ được lưu và hiển thị trạng thái xử lý tại đây.
        </p>
      </div>

      <!-- Danh sách đơn nạp -->
      <div v-else data-testid="topup-orders-list">
        <div class="divide-y divide-cyber-border">
          <article
            v-for="order in topups"
            :key="order.id"
            :data-testid="`order-card-${order.code}`"
            class="flex cursor-pointer flex-col justify-between gap-3 p-4 transition hover:bg-cyber-bg/50 sm:flex-row sm:items-center sm:px-6"
            @click="handleOpenOrder(order)"
          >
            <div class="min-w-0 space-y-1.5">
              <div class="flex flex-wrap items-center gap-2">
                <span class="font-mono text-sm font-bold text-cyber-text">
                  NAP {{ order.code }}
                </span>
                <span
                  class="rounded-md border border-cyber-violet/40 bg-cyber-violet/15 px-2.5 py-0.5 font-mono text-xs font-semibold capitalize text-cyber-text"
                >
                  Gói {{ order.pack }}
                </span>
                <span
                  class="rounded-full border px-2.5 py-0.5 font-mono text-xs font-semibold"
                  :class="getTopupStatusBadgeClass(order.status)"
                >
                  {{ getTopupStatusLabelVi(order.status) }}
                </span>
                <span class="font-mono text-xs text-cyber-muted">
                  {{ formatTopupTimestampVi(order.createdAt) }}
                </span>
              </div>

              <!-- Lý do từ chối hoặc ghi chú nếu có -->
              <p
                v-if="order.rejectReason"
                class="text-xs font-medium text-cyber-danger"
              >
                Lý do từ chối: {{ order.rejectReason }}
              </p>
              <p
                v-if="order.note"
                class="text-xs font-medium text-cyber-warning"
              >
                Ghi chú: {{ order.note }}
              </p>
            </div>

            <div
              class="flex flex-wrap items-center justify-between gap-3 sm:justify-end"
            >
              <div class="flex items-center gap-2.5 font-mono sm:flex-col sm:items-end sm:gap-0.5">
                <span class="text-sm font-bold text-cyber-cyan">
                  {{ formatVndVi(order.amountVnd) }}
                </span>
                <span class="text-xs font-bold text-cyber-success">
                  +{{ formatNumberVi(order.credits) }} CR
                </span>
              </div>

              <button
                type="button"
                data-testid="view-order-detail-button"
                class="touch-target inline-flex min-h-[48px] min-w-[48px] items-center justify-center gap-1.5 rounded-xl border border-cyber-border bg-cyber-bg px-3.5 py-2 text-xs font-semibold text-cyber-text transition hover:border-cyber-violet"
                @click.stop="handleOpenOrder(order)"
              >
                <span>Xem chi tiết</span>
                <Icon name="lucide:chevron-right" class="h-4 w-4" />
              </button>
            </div>
          </article>
        </div>

        <!-- Nút Tải thêm phân trang cursor -->
        <div
          v-if="hasMore"
          class="flex justify-center border-t border-cyber-border p-4"
        >
          <button
            type="button"
            data-testid="load-more-topups-button"
            :disabled="isLoadingMore"
            class="touch-target inline-flex min-h-[48px] min-w-[48px] items-center justify-center gap-2 rounded-xl border border-cyber-border bg-cyber-bg px-5 py-2.5 text-xs font-semibold text-cyber-text transition hover:border-cyber-violet disabled:opacity-50"
            @click="loadMore"
          >
            <Icon
              :name="isLoadingMore ? 'lucide:loader-2' : 'lucide:arrow-down'"
              class="h-4 w-4"
              :class="{ 'animate-spin': isLoadingMore }"
            />
            <span>{{
              isLoadingMore ? 'Đang tải thêm...' : 'Tải thêm đơn nạp'
            }}</span>
          </button>
        </div>
      </div>
    </section>

    <!-- Dialog VietQR (Centered Dialog trên mọi kích thước màn hình) -->
    <VietQRModal
      :open="isModalOpen"
      :topup="activeTopup"
      :is-creating="isCreating"
      :is-confirming="isConfirming"
      :confirm-error-vi="confirmErrorVi"
      :remaining-seconds="remainingSeconds"
      :is-expired="isExpired"
      :formatted-countdown="formattedCountdown"
      :is-outside-hours="isOutsideHours"
      @close="closeModal"
      @confirm="confirmTransfer"
      @recreate="handleRecreateOrder"
    />
  </div>
</template>
