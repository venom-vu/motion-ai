<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { definePageMeta, useAsyncData } from '#imports';
import {
  ApiErrorCode,
  type AdminTopup,
  type MeResponse,
} from '@motion-ai/contracts';
import { ME_KEY, useApiClient } from '~/composables/useApiClient';
import {
  useAdminTopups,
  type AdminTopupFilterStatus,
} from '~/composables/useAdminTopups';
import AdminTopupActionModal, {
  type AdminTopupActionType,
} from '~/components/AdminTopupActionModal.vue';
import {
  formatTopupTimestampVi,
  getTopupStatusBadgeClass,
  getTopupStatusLabelVi,
  isOverdue,
} from '~/utils/topup';
import { useAuthDialog } from '~/composables/useAuthDialog';
import { formatNumberVi, formatVndVi } from '~/utils/catalog';
import { MotionApiClientError, resolveApiErrorMessageVi } from '~/utils/api-client';

definePageMeta({
  layout: 'admin',
});

const { client } = useApiClient();
const { open: openAuthDialog } = useAuthDialog();

// Lấy thông tin phiên đăng nhập
const meAsync = useAsyncData<MeResponse>(ME_KEY, () => client.getMe());
const isMePending = computed<boolean>(
  () => meAsync.status.value === 'pending' || Boolean(meAsync.pending.value),
);
const currentUser = computed<MeResponse | null>(() => meAsync.data.value ?? null);
const isAdmin = computed<boolean>(() => currentUser.value?.role === 'admin');

const {
  statusFilter,
  topups,
  isLoading,
  isLoadingMore,
  isActionLoading,
  errorVi,
  loadMoreErrorVi,
  hasMore,
  fetchTopups,
  loadMore,
  setStatusFilter,
  approveTopup,
  approveExpiredTopup,
  rejectTopup,
  markNeedsReview,
  returnToPending,
} = useAdminTopups();

// Modal state
const isModalOpen = ref<boolean>(false);
const activeTopup = ref<AdminTopup | null>(null);
const currentActionType = ref<AdminTopupActionType | null>(null);
const modalErrorVi = ref<string | null>(null);
const pageNotificationVi = ref<string | null>(null);

const filterTabs: Array<{ id: AdminTopupFilterStatus; labelVi: string }> = [
  { id: 'pending', labelVi: 'Chờ duyệt' },
  { id: 'needs_review', labelVi: 'Cần xem xét' },
  { id: 'expired', labelVi: 'Đã hết hạn' },
  { id: 'approved', labelVi: 'Đã duyệt' },
  { id: 'rejected', labelVi: 'Bị từ chối' },
  { id: 'all', labelVi: 'Tất cả' },
];

// Thống kê nhanh
const stats = computed(() => {
  const pendingCount = topups.value.filter((t) => t.status === 'pending').length;
  const overdueCount = topups.value.filter(
    (t) => t.status === 'pending' && (t.isOverdue || isOverdue(t)),
  ).length;
  const reviewCount = topups.value.filter((t) => t.status === 'needs_review').length;
  const resolvedCount = topups.value.filter(
    (t) => t.status === 'approved' || t.status === 'rejected',
  ).length;
  return {
    pending: pendingCount,
    overdue: overdueCount,
    needsReview: reviewCount,
    resolved: resolvedCount,
  };
});

function openActionModal(order: AdminTopup, actionType: AdminTopupActionType): void {
  activeTopup.value = order;
  currentActionType.value = actionType;
  modalErrorVi.value = null;
  isModalOpen.value = true;
}

function closeModal(): void {
  if (isActionLoading.value) {
    return;
  }
  isModalOpen.value = false;
  activeTopup.value = null;
  currentActionType.value = null;
  modalErrorVi.value = null;
}

async function handleModalConfirm(payload: {
  actionType: AdminTopupActionType;
  topupId: string;
  bankRef?: string;
  rejectReason?: string;
  note?: string;
}): Promise<void> {
  modalErrorVi.value = null;
  pageNotificationVi.value = null;

  try {
    if (payload.actionType === 'approve') {
      const bankRef = payload.bankRef?.trim();
      if (!bankRef) {
        modalErrorVi.value = 'Vui lòng nhập mã giao dịch ngân hàng (bank_ref).';
        return;
      }
      await approveTopup(payload.topupId, bankRef);
      pageNotificationVi.value = 'Duyệt đơn nạp thành công! Đã cộng credit cho người dùng.';
    } else if (payload.actionType === 'approve-expired') {
      const bankRef = payload.bankRef?.trim();
      if (!bankRef) {
        modalErrorVi.value = 'Vui lòng nhập mã giao dịch ngân hàng (bank_ref).';
        return;
      }
      await approveExpiredTopup(payload.topupId, bankRef);
      pageNotificationVi.value = 'Duyệt đơn quá hạn thành công! Đã cộng credit cho người dùng.';
    } else if (payload.actionType === 'reject') {
      const rejectReason = payload.rejectReason?.trim();
      if (!rejectReason) {
        modalErrorVi.value = 'Vui lòng nhập lý do từ chối.';
        return;
      }
      await rejectTopup(payload.topupId, rejectReason);
      pageNotificationVi.value = 'Đã từ chối đơn nạp.';
    } else if (payload.actionType === 'needs-review') {
      const note = payload.note?.trim();
      if (!note) {
        modalErrorVi.value = 'Vui lòng nhập ghi chú.';
        return;
      }
      await markNeedsReview(payload.topupId, note);
      pageNotificationVi.value = 'Đã chuyển đơn sang trạng thái Cần xem xét.';
    } else {
      modalErrorVi.value = 'Thao tác không hợp lệ.';
      return;
    }
    closeModal();
  } catch (err: unknown) {
    const isStateInvalid =
      (err instanceof MotionApiClientError &&
        err.code === ApiErrorCode.TOPUP_STATE_INVALID) ||
      (err &&
        typeof err === 'object' &&
        'code' in err &&
        (err as { code?: unknown }).code === 'TOPUP_STATE_INVALID');

    if (isStateInvalid) {
      // Đóng modal và hiển thị thông báo làm mới
      closeModal();
      pageNotificationVi.value =
        'Đơn nạp không ở trạng thái phù hợp để thực hiện thao tác này. Danh sách đã được tự động làm mới.';
    } else {
      modalErrorVi.value = resolveApiErrorMessageVi(err);
    }
  }
}

async function handleReturnToPending(order: AdminTopup): Promise<void> {
  if (isActionLoading.value) {
    return;
  }
  pageNotificationVi.value = null;

  try {
    await returnToPending(order.id);
    pageNotificationVi.value = 'Đã đưa đơn nạp về trạng thái Chờ duyệt.';
  } catch (err: unknown) {
    const isStateInvalid =
      (err instanceof MotionApiClientError &&
        err.code === ApiErrorCode.TOPUP_STATE_INVALID) ||
      (err &&
        typeof err === 'object' &&
        'code' in err &&
        (err as { code?: unknown }).code === 'TOPUP_STATE_INVALID');

    if (isStateInvalid) {
      pageNotificationVi.value =
        'Đơn nạp không ở trạng thái phù hợp để thực hiện thao tác này. Danh sách đã được tự động làm mới.';
    } else {
      pageNotificationVi.value = resolveApiErrorMessageVi(err);
    }
  }
}

// Khởi chạy tải dữ liệu khi là admin
onMounted(() => {
  if (isAdmin.value) {
    void fetchTopups(true);
  }
});

watch(isAdmin, (admin) => {
  if (admin && topups.value.length === 0) {
    void fetchTopups(true);
  }
});
</script>

<template>
  <div data-testid="page-admin-topups" class="space-y-6 font-mono text-cyber-text">
    <!-- TRẠNG THÁI ĐANG KIỂM TRA QUYỀN (TRÁNH NHẤP NHÁY 403 KHI ĐANG PENDING) -->
    <section
      v-if="isMePending"
      data-testid="admin-auth-loading-state"
      class="flex min-h-[420px] flex-col items-center justify-center gap-3 rounded-2xl border border-cyber-border bg-[#0D0E12] p-8 text-center text-cyber-muted"
    >
      <Icon name="lucide:loader-2" class="h-8 w-8 animate-spin text-cyber-cyan" />
      <p class="text-xs">Đang kiểm tra quyền quản trị viên...</p>
    </section>

    <!-- MÀN HÌNH 403 FORBIDDEN NẾU KHÔNG PHẢI ADMIN HOẶC CHƯA ĐĂNG NHẬP -->
    <section
      v-else-if="!isAdmin"
      data-testid="admin-forbidden-state"
      class="flex min-h-[420px] flex-col items-center justify-center rounded-2xl border border-rose-500/30 bg-[#0D0E12] p-8 text-center"
    >
      <div
        class="flex h-16 w-16 items-center justify-center rounded-2xl border border-rose-500/40 bg-rose-500/10 text-rose-400"
      >
        <Icon name="lucide:shield-alert" class="h-8 w-8" />
      </div>
      <h1 class="mt-4 text-xl font-bold tracking-tight text-cyber-text">
        403 — TRUY CẬP BỊ TỪ CHỐI
      </h1>
      <p class="mt-2 max-w-md text-xs leading-relaxed text-cyber-muted">
        Bạn không có quyền truy cập vào trang quản trị này. Trang này chỉ dành riêng cho Quản trị viên (Admin) để duyệt đơn nạp tiền.
      </p>
      <div class="mt-6 flex flex-wrap items-center justify-center gap-3">
        <button
          type="button"
          data-testid="admin-forbidden-login-button"
          class="touch-target inline-flex min-h-[48px] min-w-[48px] items-center justify-center gap-2 rounded-xl border border-cyber-border bg-[#141414] px-5 py-2.5 text-xs font-semibold text-cyber-text transition hover:border-cyber-cyan"
          @click="() => openAuthDialog('login')"
        >
          <Icon name="lucide:log-in" class="h-4 w-4 text-cyber-cyan" />
          <span>Đăng nhập</span>
        </button>
        <NuxtLink
          to="/"
          class="touch-target inline-flex min-h-[48px] min-w-[48px] items-center justify-center gap-2 rounded-xl border border-cyber-border bg-cyber-surface px-5 py-2.5 text-xs font-semibold text-cyber-text transition hover:border-cyber-violet"
        >
          <Icon name="lucide:arrow-left" class="h-4 w-4" />
          <span>Về trang chủ</span>
        </NuxtLink>
      </div>
    </section>

    <!-- GIAO DIỆN ADMIN CHÍNH THỨC -->
    <template v-else>
      <!-- Header & SLA Bar -->
      <div class="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div class="space-y-1">
          <div class="flex items-center gap-2 text-xs text-cyber-muted">
            <NuxtLink to="/admin" class="hover:text-cyber-text transition">Admin</NuxtLink>
            <span>/</span>
            <span class="text-cyber-text">Duyệt đơn VietQR</span>
          </div>
          <h1 class="text-lg font-bold uppercase tracking-tight text-cyber-text sm:text-xl">
            DANH SÁCH ĐƠN NẠP VIETQR
          </h1>
        </div>

        <div class="flex flex-wrap items-center gap-2">
          <!-- Chỉ báo SLA -->
          <div
            class="flex items-center gap-2 rounded-lg border border-cyber-border bg-[#0F0F0F] px-3 py-1.5 text-xs text-cyber-muted"
          >
            <Icon name="lucide:clock" class="h-3.5 w-3.5 text-amber-400" />
            <span class="hidden sm:inline">Khung SLA 08:00 – 23:00 (15 phút)</span>
            <span class="sm:hidden">SLA 15m</span>
          </div>

          <!-- Nút làm mới danh sách -->
          <button
            type="button"
            data-testid="admin-refresh-button"
            :disabled="isLoading"
            class="touch-target inline-flex min-h-[48px] min-w-[48px] items-center justify-center gap-1.5 rounded-lg border border-cyber-border bg-[#141414] px-3.5 py-2 text-xs font-medium text-cyber-text transition hover:bg-cyber-surface disabled:opacity-50"
            @click="fetchTopups(true)"
          >
            <Icon
              name="lucide:refresh-cw"
              class="h-4 w-4"
              :class="{ 'animate-spin': isLoading }"
            />
            <span class="hidden sm:inline">Làm mới</span>
          </button>
        </div>
      </div>

      <!-- Thông báo trang (nếu có) -->
      <div
        v-if="pageNotificationVi"
        role="status"
        aria-live="polite"
        data-testid="admin-page-notification"
        class="flex items-center justify-between gap-2 rounded-xl border border-cyan-500/40 bg-cyan-500/10 p-3 text-xs text-cyan-200"
      >
        <div class="flex items-center gap-2">
          <Icon name="lucide:info" class="h-4 w-4 shrink-0 text-cyan-400" />
          <span>{{ pageNotificationVi }}</span>
        </div>
        <button
          type="button"
          aria-label="Đóng thông báo"
          class="touch-target inline-flex min-h-[48px] min-w-[48px] items-center justify-center text-cyber-muted hover:text-cyber-text"
          @click="pageNotificationVi = null"
        >
          <Icon name="lucide:x" class="h-4 w-4" />
        </button>
      </div>

      <!-- 4 ô chỉ số thống kê nhanh phong cách Vercel. Chỉ đếm các đơn trong danh sách đang tải (theo bộ lọc), không phải tổng toàn hệ thống. -->
      <section
        aria-label="Thống kê nhanh trong danh sách đơn nạp đang tải"
        title="Số liệu chỉ tính trên các đơn đang hiển thị theo bộ lọc"
        class="grid grid-cols-2 gap-2 sm:grid-cols-4 sm:gap-3"
      >
        <div class="rounded-xl border border-cyber-border bg-[#0F0F0F] p-3.5 sm:p-4">
          <span class="text-[10px] uppercase tracking-wider text-cyber-muted sm:text-xs">
            Chờ duyệt
          </span>
          <p class="mt-1 font-mono text-xl font-bold text-amber-400 sm:text-2xl">
            {{ stats.pending }}
          </p>
        </div>
        <div class="rounded-xl border border-cyber-border bg-[#0F0F0F] p-3.5 sm:p-4">
          <span class="text-[10px] uppercase tracking-wider text-cyber-muted sm:text-xs">
            Quá hạn SLA
          </span>
          <p class="mt-1 font-mono text-xl font-bold text-rose-400 sm:text-2xl">
            {{ stats.overdue }}
          </p>
        </div>
        <div class="rounded-xl border border-cyber-border bg-[#0F0F0F] p-3.5 sm:p-4">
          <span class="text-[10px] uppercase tracking-wider text-cyber-muted sm:text-xs">
            Cần xem xét
          </span>
          <p class="mt-1 font-mono text-xl font-bold text-orange-400 sm:text-2xl">
            {{ stats.needsReview }}
          </p>
        </div>
        <div class="rounded-xl border border-cyber-border bg-[#0F0F0F] p-3.5 sm:p-4">
          <span class="text-[10px] uppercase tracking-wider text-cyber-muted sm:text-xs">
            Đã giải quyết
          </span>
          <p class="mt-1 font-mono text-xl font-bold text-cyber-success sm:text-2xl">
            {{ stats.resolved }}
          </p>
        </div>
      </section>

      <!-- Thanh bộ lọc trạng thái đơn -->
      <nav
        aria-label="Bộ lọc trạng thái đơn nạp"
        class="flex flex-wrap items-center gap-1.5 border-b border-cyber-border/80 pb-3"
      >
        <button
          v-for="tab in filterTabs"
          :key="tab.id"
          :data-testid="`filter-tab-${tab.id}`"
          type="button"
          class="touch-target inline-flex min-h-[48px] min-w-[48px] items-center justify-center rounded-lg px-3.5 py-2 text-xs transition"
          :class="
            statusFilter === tab.id
              ? 'border border-cyber-border bg-[#1F1F1F] font-semibold text-white'
              : 'text-cyber-muted hover:bg-cyber-surface/60 hover:text-cyber-text'
          "
          @click="setStatusFilter(tab.id)"
        >
          <span>{{ tab.labelVi }}</span>
        </button>
      </nav>

      <!-- TRẠNG THÁI TẢI BAN ĐẦU -->
      <div
        v-if="isLoading"
        data-testid="admin-topups-loading-state"
        class="flex min-h-[300px] flex-col items-center justify-center gap-3 rounded-xl border border-cyber-border bg-[#0F0F0F] p-8 text-cyber-muted"
      >
        <Icon name="lucide:loader-2" class="h-8 w-8 animate-spin text-cyber-cyan" />
        <span class="text-xs">Đang tải danh sách đơn nạp...</span>
      </div>

      <!-- TRẠNG THÁI LỖI TẢI DANH SÁCH -->
      <div
        v-else-if="errorVi"
        role="alert"
        aria-live="polite"
        data-testid="admin-topups-error-state"
        class="flex min-h-[260px] flex-col items-center justify-center gap-3 rounded-xl border border-rose-500/40 bg-rose-500/10 p-6 text-center"
      >
        <Icon name="lucide:alert-circle" class="h-8 w-8 text-rose-400" />
        <p class="text-xs text-rose-300">{{ errorVi }}</p>
        <button
          type="button"
          class="touch-target inline-flex min-h-[48px] min-w-[48px] items-center justify-center gap-1.5 rounded-lg border border-cyber-border bg-[#141414] px-4 py-2 text-xs font-semibold text-cyber-text hover:bg-cyber-surface"
          @click="fetchTopups(true)"
        >
          <Icon name="lucide:rotate-cw" class="h-4 w-4" />
          <span>Thử lại</span>
        </button>
      </div>

      <!-- TRẠNG THÁI DANH SÁCH RỖNG -->
      <div
        v-else-if="topups.length === 0"
        data-testid="admin-topups-empty-state"
        class="flex min-h-[260px] flex-col items-center justify-center gap-2 rounded-xl border border-cyber-border bg-[#0F0F0F] p-8 text-center text-cyber-muted"
      >
        <Icon name="lucide:inbox" class="h-8 w-8 text-cyber-muted/60" />
        <p class="text-sm font-semibold text-cyber-text">
          Không có đơn nạp nào phù hợp
        </p>
        <p class="text-xs text-cyber-muted">
          Hiện tại không có đơn nạp nào ở trạng thái này.
        </p>
      </div>

      <!-- DANH SÁCH CÓ DỮ LIỆU -->
      <div v-else class="space-y-4">
        <!-- BẢNG DESKTOP (>= 768px) -->
        <div
          class="hidden overflow-hidden rounded-xl border border-cyber-border bg-[#0F0F0F] md:block"
        >
          <div class="overflow-x-auto">
            <table class="w-full border-collapse text-left text-xs">
              <thead>
                <tr class="border-b border-cyber-border bg-[#141414] text-[11px] uppercase text-cyber-muted">
                  <th class="px-4 py-3">Mã đơn &amp; Trạng thái</th>
                  <th class="px-4 py-3">Gói &amp; Số tiền</th>
                  <th class="px-4 py-3">Hạn duyệt SLA</th>
                  <th class="px-4 py-3">Mã tham chiếu / Ghi chú</th>
                  <th class="px-4 py-3 text-right">Thao tác</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-cyber-border/70">
                <tr
                  v-for="order in topups"
                  :key="order.id"
                  data-testid="admin-topup-row"
                  class="transition hover:bg-cyber-surface/30"
                >
                  <!-- Mã đơn & Trạng thái -->
                  <td class="px-4 py-3.5">
                    <div class="flex items-center gap-2">
                      <span class="rounded border border-cyber-border bg-[#18181B] px-2 py-0.5 font-mono text-xs font-bold text-cyber-text">
                        NAP {{ order.code }}
                      </span>
                      <span
                        class="rounded-full border px-2 py-0.5 text-[10px] font-semibold"
                        :class="getTopupStatusBadgeClass(order.status)"
                      >
                        {{ getTopupStatusLabelVi(order.status) }}
                      </span>
                    </div>
                    <div class="mt-1 text-[11px] text-cyber-muted">
                      Tạo lúc: {{ formatTopupTimestampVi(order.createdAt) }}
                    </div>
                  </td>

                  <!-- Gói & Số tiền -->
                  <td class="px-4 py-3.5">
                    <div class="font-bold text-cyber-cyan">
                      {{ formatVndVi(order.amountVnd) }}
                    </div>
                    <div class="text-[11px] text-cyber-muted">
                      Gói {{ order.pack }} • +{{ formatNumberVi(order.credits) }} CR
                    </div>
                  </td>

                  <!-- Hạn duyệt SLA & Quá hạn -->
                  <td class="px-4 py-3.5">
                    <div class="flex items-center gap-2">
                      <span
                        v-if="order.approveBy"
                        class="font-mono text-xs"
                        :class="isOverdue(order) ? 'text-rose-400 font-bold' : 'text-cyber-muted'"
                      >
                        {{ formatTopupTimestampVi(order.approveBy) }}
                      </span>
                      <span v-else class="text-cyber-muted">-</span>

                      <span
                        v-if="isOverdue(order)"
                        data-testid="overdue-badge"
                        class="inline-flex items-center gap-1 rounded border border-rose-500/50 bg-rose-500/20 px-1.5 py-0.5 text-[10px] font-bold text-rose-300"
                      >
                        <Icon name="lucide:alert-circle" class="h-3 w-3" />
                        QUÁ HẠN
                      </span>
                    </div>
                  </td>

                  <!-- Mã tham chiếu / Ghi chú / Lý do -->
                  <td class="px-4 py-3.5 max-w-xs">
                    <div v-if="order.bankRef" class="font-mono text-xs text-cyber-success">
                      {{ order.bankRef }}
                    </div>
                    <div v-else-if="order.note" class="text-xs text-orange-300 truncate" :title="order.note">
                      Ghi chú: {{ order.note }}
                    </div>
                    <div v-else-if="order.rejectReason" class="text-xs text-rose-300 truncate" :title="order.rejectReason">
                      Từ chối: {{ order.rejectReason }}
                    </div>
                    <span v-else class="text-cyber-muted">-</span>
                  </td>

                  <!-- Thao tác -->
                  <td class="px-4 py-3.5 text-right">
                    <!-- Thao tác trên đơn pending -->
                    <div v-if="order.status === 'pending'" class="flex items-center justify-end gap-1.5">
                      <button
                        type="button"
                        data-testid="action-approve-button"
                        :disabled="isActionLoading"
                        class="touch-target inline-flex min-h-[48px] min-w-[48px] items-center justify-center gap-1 rounded-lg bg-cyber-success px-3 py-1.5 text-xs font-bold text-black transition hover:bg-emerald-400 disabled:opacity-50"
                        @click="openActionModal(order, 'approve')"
                      >
                        <Icon name="lucide:check" class="h-3.5 w-3.5" />
                        <span>Duyệt</span>
                      </button>

                      <button
                        type="button"
                        data-testid="action-reject-button"
                        :disabled="isActionLoading"
                        class="touch-target inline-flex min-h-[48px] min-w-[48px] items-center justify-center gap-1 rounded-lg border border-cyber-border bg-[#141414] px-2.5 py-1.5 text-xs text-rose-300 transition hover:bg-rose-500/10 hover:border-rose-500/40 disabled:opacity-50"
                        @click="openActionModal(order, 'reject')"
                      >
                        <span>Từ chối</span>
                      </button>

                      <button
                        type="button"
                        data-testid="action-needs-review-button"
                        :disabled="isActionLoading"
                        class="touch-target inline-flex min-h-[48px] min-w-[48px] items-center justify-center gap-1 rounded-lg border border-cyber-border bg-[#141414] px-2.5 py-1.5 text-xs text-orange-300 transition hover:bg-orange-500/10 hover:border-orange-500/40 disabled:opacity-50"
                        @click="openActionModal(order, 'needs-review')"
                      >
                        <span>Xem xét</span>
                      </button>
                    </div>

                    <!-- Thao tác trên đơn needs_review -->
                    <div v-else-if="order.status === 'needs_review'" class="flex items-center justify-end gap-1.5">
                      <button
                        type="button"
                        data-testid="action-return-pending-button"
                        :disabled="isActionLoading"
                        class="touch-target inline-flex min-h-[48px] min-w-[48px] items-center justify-center gap-1 rounded-lg border border-cyan-500/40 bg-cyan-500/10 px-3 py-1.5 text-xs font-semibold text-cyan-200 transition hover:bg-cyan-500/20 disabled:opacity-50"
                        @click="handleReturnToPending(order)"
                      >
                        <Icon name="lucide:undo-2" class="h-3.5 w-3.5" />
                        <span>Đưa về chờ duyệt</span>
                      </button>

                      <button
                        type="button"
                        data-testid="action-reject-button"
                        :disabled="isActionLoading"
                        class="touch-target inline-flex min-h-[48px] min-w-[48px] items-center justify-center gap-1 rounded-lg border border-cyber-border bg-[#141414] px-2.5 py-1.5 text-xs text-rose-300 transition hover:bg-rose-500/10 hover:border-rose-500/40 disabled:opacity-50"
                        @click="openActionModal(order, 'reject')"
                      >
                        <span>Từ chối</span>
                      </button>
                    </div>

                    <!-- Thao tác trên đơn expired -->
                    <div v-else-if="order.status === 'expired'" class="flex items-center justify-end">
                      <button
                        type="button"
                        data-testid="action-approve-expired-button"
                        :disabled="isActionLoading"
                        class="touch-target inline-flex min-h-[48px] min-w-[48px] items-center justify-center gap-1 rounded-lg border border-amber-500/40 bg-amber-500/15 px-3 py-1.5 text-xs font-semibold text-amber-200 transition hover:bg-amber-500/25 disabled:opacity-50"
                        @click="openActionModal(order, 'approve-expired')"
                      >
                        <Icon name="lucide:check-square" class="h-3.5 w-3.5 text-amber-400" />
                        <span>Duyệt đơn quá hạn</span>
                      </button>
                    </div>

                    <!-- Đơn awaiting_transfer trong tab all -->
                    <span v-else-if="order.status === 'awaiting_transfer'" class="text-xs text-amber-300">
                      Chờ chuyển khoản
                    </span>

                    <!-- Đơn đã duyệt hoặc từ chối -->
                    <span v-else class="text-xs text-cyber-muted">
                      Đã hoàn tất
                    </span>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <!-- THẺ MOBILE (< 768px, chuẩn 360px) -->
        <div class="space-y-3 md:hidden">
          <article
            v-for="order in topups"
            :key="order.id"
            data-testid="admin-topup-card"
            class="rounded-xl border border-cyber-border bg-[#0F0F0F] p-4 text-xs space-y-3"
          >
            <!-- Card Header -->
            <div class="flex flex-wrap items-center justify-between gap-2 border-b border-cyber-border/70 pb-2.5">
              <span class="rounded border border-cyber-border bg-[#18181B] px-2 py-0.5 font-mono text-xs font-bold text-cyber-text">
                NAP {{ order.code }}
              </span>
              <div class="flex items-center gap-1.5">
                <span
                  class="rounded-full border px-2.5 py-0.5 text-[10px] font-semibold"
                  :class="getTopupStatusBadgeClass(order.status)"
                >
                  {{ getTopupStatusLabelVi(order.status) }}
                </span>
                <span
                  v-if="isOverdue(order)"
                  data-testid="overdue-badge"
                  class="inline-flex items-center gap-1 rounded border border-rose-500/50 bg-rose-500/20 px-1.5 py-0.5 text-[10px] font-bold text-rose-300"
                >
                  <Icon name="lucide:alert-circle" class="h-3 w-3" />
                  QUÁ HẠN
                </span>
              </div>
            </div>

            <!-- Card Body Info -->
            <div class="grid grid-cols-2 gap-2 text-xs">
              <div>
                <span class="text-[11px] text-cyber-muted">Số tiền:</span>
                <p class="font-bold text-cyber-cyan text-sm">
                  {{ formatVndVi(order.amountVnd) }}
                </p>
              </div>
              <div>
                <span class="text-[11px] text-cyber-muted">Gói nạp:</span>
                <p class="font-semibold text-cyber-text">
                  {{ order.pack }} (+{{ formatNumberVi(order.credits) }} CR)
                </p>
              </div>
            </div>

            <div class="space-y-1 text-[11px] text-cyber-muted border-t border-cyber-border/40 pt-2">
              <div>Tạo: {{ formatTopupTimestampVi(order.createdAt) }}</div>
              <div v-if="order.approveBy">
                Hạn SLA:
                <span :class="isOverdue(order) ? 'text-rose-400 font-semibold' : 'text-cyber-text'">
                  {{ formatTopupTimestampVi(order.approveBy) }}
                </span>
              </div>
              <div v-if="order.bankRef" class="text-cyber-success font-mono">
                Bank Ref: {{ order.bankRef }}
              </div>
              <div v-if="order.note" class="text-orange-300">
                Ghi chú: {{ order.note }}
              </div>
              <div v-if="order.rejectReason" class="text-rose-300">
                Lý do từ chối: {{ order.rejectReason }}
              </div>
            </div>

            <!-- Card Actions (Vùng chạm >= 48px) -->
            <div class="flex flex-wrap items-center gap-2 border-t border-cyber-border/70 pt-2.5">
              <template v-if="order.status === 'pending'">
                <button
                  type="button"
                  data-testid="action-approve-button"
                  :disabled="isActionLoading"
                  class="touch-target inline-flex min-h-[48px] min-w-[48px] flex-1 items-center justify-center gap-1.5 rounded-lg bg-cyber-success px-3 py-2 text-xs font-bold text-black transition hover:bg-emerald-400 disabled:opacity-50"
                  @click="openActionModal(order, 'approve')"
                >
                  <Icon name="lucide:check" class="h-4 w-4" />
                  <span>Duyệt đơn</span>
                </button>

                <button
                  type="button"
                  data-testid="action-reject-button"
                  :disabled="isActionLoading"
                  class="touch-target inline-flex min-h-[48px] min-w-[48px] items-center justify-center rounded-lg border border-cyber-border bg-[#141414] px-3 py-2 text-xs text-rose-300 transition hover:bg-rose-500/10 disabled:opacity-50"
                  @click="openActionModal(order, 'reject')"
                >
                  <span>Từ chối</span>
                </button>

                <button
                  type="button"
                  data-testid="action-needs-review-button"
                  :disabled="isActionLoading"
                  class="touch-target inline-flex min-h-[48px] min-w-[48px] items-center justify-center rounded-lg border border-cyber-border bg-[#141414] px-3 py-2 text-xs text-orange-300 transition hover:bg-orange-500/10 disabled:opacity-50"
                  @click="openActionModal(order, 'needs-review')"
                >
                  <span>Xem xét</span>
                </button>
              </template>

              <template v-else-if="order.status === 'needs_review'">
                <button
                  type="button"
                  data-testid="action-return-pending-button"
                  :disabled="isActionLoading"
                  class="touch-target inline-flex min-h-[48px] min-w-[48px] flex-1 items-center justify-center gap-1.5 rounded-lg border border-cyan-500/40 bg-cyan-500/10 px-3 py-2 text-xs font-semibold text-cyan-200 transition hover:bg-cyan-500/20 disabled:opacity-50"
                  @click="handleReturnToPending(order)"
                >
                  <Icon name="lucide:undo-2" class="h-4 w-4" />
                  <span>Đưa về chờ duyệt</span>
                </button>

                <button
                  type="button"
                  data-testid="action-reject-button"
                  :disabled="isActionLoading"
                  class="touch-target inline-flex min-h-[48px] min-w-[48px] items-center justify-center rounded-lg border border-cyber-border bg-[#141414] px-3 py-2 text-xs text-rose-300 transition hover:bg-rose-500/10 disabled:opacity-50"
                  @click="openActionModal(order, 'reject')"
                >
                  <span>Từ chối</span>
                </button>
              </template>

              <template v-else-if="order.status === 'expired'">
                <button
                  type="button"
                  data-testid="action-approve-expired-button"
                  :disabled="isActionLoading"
                  class="touch-target inline-flex min-h-[48px] min-w-[48px] flex-1 items-center justify-center gap-1.5 rounded-lg border border-amber-500/40 bg-amber-500/15 px-3 py-2 text-xs font-semibold text-amber-200 transition hover:bg-amber-500/25 disabled:opacity-50"
                  @click="openActionModal(order, 'approve-expired')"
                >
                  <Icon name="lucide:check-square" class="h-4 w-4 text-amber-400" />
                  <span>Duyệt đơn quá hạn</span>
                </button>
              </template>

              <div v-else-if="order.status === 'awaiting_transfer'" class="w-full text-center text-xs text-amber-300 py-1">
                Chờ chuyển khoản
              </div>

              <div v-else class="w-full text-center text-xs text-cyber-muted py-1">
                Đơn nạp đã được xử lý hoàn tất
              </div>
            </div>
          </article>
        </div>

        <!-- Nút Tải thêm phân trang cursor -->
        <div v-if="hasMore" class="pt-4 text-center space-y-2">
          <div
            v-if="loadMoreErrorVi"
            role="alert"
            aria-live="polite"
            data-testid="load-more-error-banner"
            class="flex items-center justify-center gap-1.5 text-xs text-rose-300"
          >
            <Icon name="lucide:alert-circle" class="h-4 w-4 text-rose-400" />
            <span>{{ loadMoreErrorVi }}</span>
          </div>
          <button
            type="button"
            data-testid="load-more-admin-topups-button"
            :disabled="isLoadingMore"
            class="touch-target inline-flex min-h-[48px] min-w-[48px] items-center justify-center gap-2 rounded-xl border border-cyber-border bg-[#141414] px-6 py-2.5 text-xs font-semibold text-cyber-text transition hover:border-cyber-cyan disabled:opacity-50"
            @click="loadMore"
          >
            <Icon
              :name="isLoadingMore ? 'lucide:loader-2' : 'lucide:chevrons-down'"
              class="h-4 w-4"
              :class="{ 'animate-spin': isLoadingMore }"
            />
            <span>{{ isLoadingMore ? 'Đang tải thêm...' : (loadMoreErrorVi ? 'Thử tải lại' : 'Tải thêm đơn nạp') }}</span>
          </button>
        </div>
      </div>
    </template>

    <!-- Dialog Thao tác nghiệp vụ Centered Dialog -->
    <AdminTopupActionModal
      :open="isModalOpen"
      :topup="activeTopup"
      :action-type="currentActionType"
      :is-submitting="isActionLoading"
      :error-message-vi="modalErrorVi"
      @close="closeModal"
      @confirm="handleModalConfirm"
    />
  </div>
</template>
