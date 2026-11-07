<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useHead, useRoute } from '#imports';
import type { Topup, TopupPackId } from '@motion-ai/contracts';
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

useHead({
  title: 'Nạp Credit — Motion AI',
});

const route = useRoute();
const { isAuthenticated } = useAuth();
const { open: openAuthDialog } = useAuthDialog();
const {
  pricing,
  currentTier,
  isLoading: isPricingLoading,
  errorMessageVi: pricingErrorVi,
  refreshAll: refreshPricing,
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

const selectedPack = ref<TopupPackId>('pro');
const consent = ref<boolean>(false);

// Đọc query param ?pack=... nếu có
watch(
  () => route.query.pack,
  (packQuery) => {
    if (
      packQuery === 'starter' ||
      packQuery === 'pro' ||
      packQuery === 'creator'
    ) {
      selectedPack.value = packQuery;
    }
  },
  { immediate: true },
);

// Tải lịch sử đơn nạp khi người dùng đã đăng nhập
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
    }
  },
);

const topupPacks = computed(() => {
  if (!pricing.value) {
    return [];
  }
  return pricing.value.topupPacks;
});

const currentSelectedPackData = computed(() => {
  return (
    topupPacks.value.find((p) => p.id === selectedPack.value) ??
    topupPacks.value[0]
  );
});

async function handleCreateTopup(): Promise<void> {
  if (!isAuthenticated.value) {
    openAuthDialog('login');
    return;
  }
  if (!consent.value || isCreating.value) {
    return;
  }
  await createOrder(selectedPack.value, consent.value);
}

function handleOpenOrder(topupItem: Topup): void {
  openModal(topupItem);
}

async function handleRecreateOrder(pack: TopupPackId): Promise<void> {
  selectedPack.value = pack;
  closeModal();
  // Không tự tích ToS thay người dùng: chỉ tạo ngay khi họ đã tích đồng ý.
  if (consent.value) {
    await createOrder(pack, consent.value);
  }
}
</script>

<template>
  <div class="space-y-8" data-testid="page-topup">
    <!-- Tiêu đề trang và trạng thái hạng hiện tại -->
    <section
      class="rounded-2xl border border-cyber-border bg-cyber-surface p-5 sm:p-6"
    >
      <div
        class="flex flex-col justify-between gap-4 sm:flex-row sm:items-center"
      >
        <div class="space-y-1">
          <h1 class="font-display text-2xl font-bold text-cyber-text">
            Nạp Credit Studio AI Qua VietQR
          </h1>
          <p class="text-sm text-cyber-muted">
            Chọn gói nạp để tăng số dư credit và nâng cấp trần thời lượng video theo hạng.
          </p>
        </div>

        <span
          class="inline-flex items-center gap-2 self-start rounded-xl border border-cyber-cyan/40 bg-cyber-bg px-3.5 py-2 font-mono text-xs font-semibold text-cyber-cyan sm:self-center"
        >
          <Icon name="lucide:award" class="h-4 w-4" />
          <span>Hạng hiện tại: {{ currentTier }}</span>
        </span>
      </div>
    </section>

    <!-- Banner lỗi tải bảng giá -->
    <ApiErrorBanner
      :message-vi="pricingErrorVi"
      @retry="refreshPricing"
    />

    <!-- Skeleton khi đang tải bảng giá -->
    <div
      v-if="isPricingLoading && !pricing"
      class="rounded-2xl border border-cyber-border bg-cyber-surface p-8 text-center text-sm text-cyber-muted"
    >
      Đang tải danh sách gói nạp từ hệ thống...
    </div>

    <!-- Chọn gói nạp credit -->
    <section v-else-if="pricing" class="space-y-6">
      <div>
        <h2 class="font-display text-lg font-bold text-cyber-text">
          1. Chọn Gói Nạp Credit
        </h2>
        <p class="text-xs text-cyber-muted">
          Giá và quyền lợi được lấy trực tiếp từ hệ thống, không thay đổi phía client.
        </p>
      </div>

      <!-- Danh sách gói nạp (Starter, Pro, Creator) -->
      <div
        data-testid="topup-packs-grid"
        class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3"
      >
        <article
          v-for="pack in topupPacks"
          :key="pack.id"
          :data-testid="`pack-card-${pack.id}`"
          class="touch-target relative flex cursor-pointer flex-col justify-between rounded-2xl border p-5 transition"
          :class="
            selectedPack === pack.id
              ? 'border-cyber-violet bg-cyber-surface shadow-lg shadow-cyber-violet/20'
              : 'border-cyber-border bg-cyber-surface/60 hover:border-cyber-border hover:bg-cyber-surface'
          "
          @click="selectedPack = pack.id"
        >
          <div class="space-y-3">
            <div class="flex items-center justify-between">
              <span class="font-display text-base font-bold text-cyber-text">
                Gói {{ pack.name }}
              </span>
              <span
                class="rounded-full border border-cyber-border bg-cyber-bg px-2.5 py-0.5 font-mono text-xs text-cyber-muted"
              >
                Ưu tiên #{{ pack.priority }}
              </span>
            </div>

            <div class="font-mono text-2xl font-bold text-cyber-cyan">
              {{ formatVndVi(pack.priceVnd) }}
            </div>

            <ul class="space-y-2 border-t border-cyber-border pt-3 text-xs text-cyber-muted">
              <li class="flex items-center gap-2">
                <Icon name="lucide:coins" class="h-4 w-4 text-cyber-cyan" />
                <span>
                  Nhận ngay:
                  <strong class="font-mono text-cyber-text">
                    {{ formatNumberVi(pack.credits) }} credit
                  </strong>
                </span>
              </li>
              <li class="flex items-center gap-2">
                <Icon name="lucide:timer" class="h-4 w-4 text-cyber-violet" />
                <span>
                  Trần video:
                  <strong class="font-mono text-cyber-text">
                    {{ formatNumberVi(pack.maxVideoSeconds) }} giây
                  </strong>
                </span>
              </li>
              <li class="flex items-center gap-2">
                <Icon name="lucide:zap" class="h-4 w-4 text-amber-400" />
                <span>
                  Hạng tài khoản:
                  <strong class="text-cyber-text">{{ pack.tier }}</strong>
                </span>
              </li>
            </ul>
          </div>

          <div class="mt-4 flex items-center justify-between border-t border-cyber-border/60 pt-3">
            <span class="text-xs text-cyber-muted">
              {{ selectedPack === pack.id ? 'Đang chọn gói này' : 'Bấm để chọn' }}
            </span>
            <span
              class="flex h-5 w-5 items-center justify-center rounded-full border"
              :class="
                selectedPack === pack.id
                  ? 'border-cyber-violet bg-cyber-violet text-white'
                  : 'border-cyber-border bg-cyber-bg text-transparent'
              "
            >
              <Icon name="lucide:check" class="h-3 w-3" />
            </span>
          </div>
        </article>
      </div>

      <!-- Khung cam kết ToS và nút tạo đơn -->
      <div
        class="space-y-4 rounded-2xl border border-cyber-border bg-cyber-surface p-5"
      >
        <h2 class="font-display text-lg font-bold text-cyber-text">
          2. Cam Kết &amp; Tạo Mã Thanh Toán VietQR
        </h2>

        <!-- Checkbox cam kết ToS bắt buộc -->
        <label
          data-testid="topup-consent-label"
          class="flex cursor-pointer items-start gap-3 rounded-xl border border-cyber-border bg-cyber-bg p-3.5 transition hover:border-cyber-border"
        >
          <input
            v-model="consent"
            type="checkbox"
            data-testid="topup-consent-checkbox"
            class="mt-1 h-4 w-4 rounded border-cyber-border bg-cyber-surface text-cyber-violet focus:ring-cyber-violet"
          />
          <span class="text-xs leading-relaxed text-cyber-text">
            Tôi đồng ý với <strong class="text-cyber-cyan">Điều khoản dịch vụ (ToS)</strong> của Motion AI. Tôi hiểu rằng credit nạp vào sẽ được sử dụng để tạo ảnh/video AI và không thể quy đổi ngược thành tiền mặt.
          </span>
        </label>

        <!-- Lỗi tạo đơn nếu có (TOPUP_LIMIT, CONSENT_REQUIRED, ACCOUNT_LOCKED, RATE_LIMITED) -->
        <div
          v-if="createErrorVi"
          data-testid="topup-create-error"
          class="flex items-start gap-2.5 rounded-xl border border-rose-500/40 bg-rose-500/10 p-3.5 text-xs text-rose-300"
        >
          <Icon name="lucide:alert-circle" class="mt-0.5 h-4 w-4 shrink-0" />
          <span>{{ createErrorVi }}</span>
        </div>

        <!-- Nút Tạo Đơn VietQR -->
        <button
          type="button"
          data-testid="create-topup-button"
          :disabled="!consent || isCreating"
          class="touch-target inline-flex min-h-[48px] min-w-[48px] w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-cyber-violet to-cyber-cyan px-5 py-3 font-semibold text-white shadow-lg shadow-cyber-violet/30 transition hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-50"
          @click="handleCreateTopup"
        >
          <Icon
            :name="isCreating ? 'lucide:loader-2' : 'lucide:qr-code'"
            class="h-5 w-5"
            :class="{ 'animate-spin': isCreating }"
          />
          <span>
            {{
              isCreating
                ? 'Đang tạo đơn VietQR...'
                : `Nạp gói ${currentSelectedPackData?.name ?? ''} qua VietQR (${formatVndVi(currentSelectedPackData?.priceVnd ?? 0)})`
            }}
          </span>
        </button>
      </div>
    </section>

    <!-- Danh sách lịch sử đơn nạp credit -->
    <section class="space-y-4">
      <div class="flex items-center justify-between">
        <h2 class="font-display text-lg font-bold text-cyber-text">
          Lịch Sử Đơn Nạp Credit
        </h2>
        <NuxtLink
          to="/history"
          class="text-xs text-cyber-cyan hover:underline"
        >
          Xem biến động số dư &rarr;
        </NuxtLink>
      </div>

      <!-- Khách chưa đăng nhập -->
      <div
        v-if="!isAuthenticated"
        data-testid="topup-unauthenticated-banner"
        class="rounded-2xl border border-cyber-border bg-cyber-surface p-6 text-center text-xs text-cyber-muted space-y-3"
      >
        <p>Đăng nhập để xem lịch sử đơn nạp và tiếp tục các giao dịch đang chờ xử lý.</p>
        <button
          type="button"
          class="touch-target inline-flex min-h-[48px] min-w-[48px] items-center justify-center gap-2 rounded-xl border border-cyber-border bg-cyber-bg px-4 py-2 font-medium text-cyber-text hover:border-cyber-violet"
          @click="openAuthDialog('login')"
        >
          <Icon name="lucide:log-in" class="h-4 w-4 text-cyber-violet" />
          <span>Đăng nhập</span>
        </button>
      </div>

      <!-- Đã đăng nhập: danh sách đơn nạp -->
      <template v-else>
        <!-- Lỗi tải danh sách -->
        <div
          v-if="listErrorVi"
          data-testid="topup-list-error"
          class="flex items-center justify-between rounded-2xl border border-rose-500/40 bg-rose-500/10 p-4 text-xs text-rose-300"
        >
          <span>{{ listErrorVi }}</span>
          <button
            type="button"
            class="touch-target min-h-[48px] min-w-[48px] font-semibold text-cyber-cyan hover:underline"
            @click="fetchTopups()"
          >
            Thử lại
          </button>
        </div>

        <!-- Đang tải lần đầu -->
        <div
          v-if="isLoadingList && topups.length === 0"
          data-testid="topup-list-loading"
          class="rounded-2xl border border-cyber-border bg-cyber-surface p-8 text-center text-xs text-cyber-muted"
        >
          Đang tải lịch sử đơn nạp...
        </div>

        <!-- Trạng thái rỗng -->
        <div
          v-else-if="!isLoadingList && topups.length === 0"
          data-testid="topup-list-empty"
          class="rounded-2xl border border-cyber-border bg-cyber-surface p-8 text-center text-xs text-cyber-muted space-y-1"
        >
          <Icon name="lucide:inbox" class="mx-auto h-8 w-8 text-cyber-muted" />
          <p class="font-medium text-cyber-text">Bạn chưa có đơn nạp nào</p>
          <p>Các đơn nạp qua VietQR sẽ được lưu và hiển thị tại đây.</p>
        </div>

        <!-- Danh sách thẻ đơn nạp -->
        <div
          v-else
          data-testid="topup-orders-list"
          class="space-y-3"
        >
          <article
            v-for="order in topups"
            :key="order.id"
            :data-testid="`order-card-${order.code}`"
            class="touch-target flex flex-col justify-between gap-3 rounded-2xl border border-cyber-border bg-cyber-surface p-4 transition hover:border-cyber-violet sm:flex-row sm:items-center"
            @click="handleOpenOrder(order)"
          >
            <div class="space-y-1">
              <div class="flex items-center gap-2">
                <span class="font-mono text-sm font-bold text-cyber-text">
                  NAP {{ order.code }}
                </span>
                <span
                  class="rounded-full border px-2.5 py-0.5 font-mono text-[11px] font-semibold"
                  :class="getTopupStatusBadgeClass(order.status)"
                >
                  {{ getTopupStatusLabelVi(order.status) }}
                </span>
              </div>

              <div class="flex flex-wrap items-center gap-3 text-xs text-cyber-muted">
                <span>Gói {{ order.pack }}</span>
                <span>•</span>
                <span class="font-mono text-cyber-cyan font-bold">
                  {{ formatVndVi(order.amountVnd) }}
                </span>
                <span>•</span>
                <span class="font-mono text-cyber-text font-bold">
                  +{{ formatNumberVi(order.credits) }} CR
                </span>
                <span>•</span>
                <span>{{ formatTopupTimestampVi(order.createdAt) }}</span>
              </div>

              <!-- Lý do từ chối hoặc ghi chú nếu có -->
              <p
                v-if="order.rejectReason"
                class="text-xs text-rose-300"
              >
                Lý do từ chối: {{ order.rejectReason }}
              </p>
              <p
                v-if="order.note"
                class="text-xs text-orange-300"
              >
                Ghi chú: {{ order.note }}
              </p>
            </div>

            <div class="flex items-center gap-2 self-end sm:self-center">
              <button
                type="button"
                data-testid="view-order-detail-button"
                class="touch-target inline-flex min-h-[48px] min-w-[48px] items-center justify-center gap-1 rounded-xl border border-cyber-border bg-cyber-bg px-3.5 py-2 text-xs font-semibold text-cyber-text transition hover:border-cyber-violet"
                @click.stop="handleOpenOrder(order)"
              >
                <span>Xem chi tiết</span>
                <Icon name="lucide:chevron-right" class="h-4 w-4" />
              </button>
            </div>
          </article>

          <!-- Nút Tải thêm phân trang cursor -->
          <div v-if="hasMore" class="pt-2 text-center">
            <button
              type="button"
              data-testid="load-more-topups-button"
              :disabled="isLoadingMore"
              class="touch-target inline-flex min-h-[48px] min-w-[48px] items-center justify-center gap-2 rounded-xl border border-cyber-border bg-cyber-surface px-6 py-2.5 text-xs font-semibold text-cyber-text transition hover:border-cyber-violet disabled:opacity-50"
              @click="loadMore"
            >
              <Icon
                :name="isLoadingMore ? 'lucide:loader-2' : 'lucide:chevrons-down'"
                class="h-4 w-4"
                :class="{ 'animate-spin': isLoadingMore }"
              />
              <span>{{ isLoadingMore ? 'Đang tải thêm...' : 'Tải thêm đơn nạp' }}</span>
            </button>
          </div>
        </div>
      </template>
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
