<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { definePageMeta } from '#imports';
import { useAdminAccess } from '~/composables/useAdminAccess';
import { useAdminOps, validateAdjustForm } from '~/composables/useAdminOps';
import { useCursorPager } from '~/composables/useCursorPager';
import { formatNumberVi } from '~/utils/catalog';
import { formatTopupTimestampVi } from '~/utils/topup';
import { ui } from '~/utils/admin-ui';
import type { BarRow, BarSeries } from '~/components/AdminBarChart.vue';

definePageMeta({ layout: 'admin' });

const { isMePending, isAdmin } = useAdminAccess();
const ops = useAdminOps();
const { user, ledger, ledgerHasMore, userErrorVi, isUserLoading, isUserActionLoading, userActionErrorVi } = ops;
const ledgerPager = useCursorPager(ledger, ledgerHasMore, () => ops.loadMoreLedger());
const { userStats, isUserStatsLoading, userStatsErrorVi } = ops;

/* Màu chart: slot 1 bảng màu categorical (đã kiểm tra CVD trên nền #111111). */
const SERIES_1 = '#3987e5';
const USER_DAYS = 30;

const userTiles = computed(() => {
  const u = userStats.value;
  if (!u) return [];
  const pctOf = (n: number) => (u.total === 0 ? '' : ` (${((n / u.total) * 100).toFixed(0)}%)`);
  return [
    { key: 'total', labelVi: 'Tổng tài khoản', value: formatNumberVi(u.total), note: `${formatNumberVi(u.admins)} admin` },
    { key: 'active', labelVi: 'Đang hoạt động', value: formatNumberVi(u.active), note: `${formatNumberVi(u.locked)} bị khóa` },
    { key: 'withTasks', labelVi: 'Đã dùng tính năng', value: formatNumberVi(u.withTasks), note: `Có ít nhất 1 Task${pctOf(u.withTasks)}` },
    { key: 'paying', labelVi: 'Đã nạp tiền', value: formatNumberVi(u.paying), note: `Có đơn được duyệt${pctOf(u.paying)}` },
  ];
});

const tierSeries: BarSeries[] = [{ key: 'users', labelVi: 'Tài khoản', color: SERIES_1 }];
const tierRows = computed<BarRow[]>(() =>
  (userStats.value?.byTier ?? []).map((t) => ({ labelVi: t.tier, values: [t.count] })),
);
const fmtCount = (v: number) => formatNumberVi(v);

onMounted(() => {
  if (isAdmin.value) void ops.fetchUserStats(USER_DAYS);
});
watch(isAdmin, (admin) => {
  if (admin && !userStats.value) void ops.fetchUserStats(USER_DAYS);
});

type ConfirmKind = 'adjust' | 'lock' | 'unlock';
const confirmKind = ref<ConfirmKind | null>(null);
const confirmErrorVi = ref<string | null>(null);
const notificationVi = ref<string | null>(null);

const emailQuery = ref<string>('');
const userReason = ref<string>('');
const adjustAmount = ref<string>('');
const adjustReason = ref<string>('');
const adjustAmountErrorVi = ref<string | null>(null);
const adjustReasonErrorVi = ref<string | null>(null);
const userReasonErrorVi = ref<string | null>(null);
const adjustFormOpen = ref<boolean>(false);
const pendingAdjust = ref<{ amount: number; reason: string } | null>(null);

const confirmTitle = computed<string>(() => {
  if (confirmKind.value === 'adjust') return 'Xác nhận điều chỉnh credit';
  if (confirmKind.value === 'lock') return 'Khóa tài khoản này?';
  return 'Mở khóa tài khoản này?';
});

async function submitSearch(): Promise<void> {
  if (!emailQuery.value.trim()) {
    userReasonErrorVi.value = 'Vui lòng nhập email cần tìm.';
    return;
  }
  userReasonErrorVi.value = null;
  adjustFormOpen.value = false;
  ledgerPager.reset();
  await ops.searchUser(emailQuery.value);
}

function openAdjustForm(): void {
  ops.openAdjustForm();
  adjustAmount.value = '';
  adjustReason.value = '';
  adjustAmountErrorVi.value = null;
  adjustReasonErrorVi.value = null;
  adjustFormOpen.value = true;
}

function requestAdjust(): void {
  const v = validateAdjustForm(adjustAmount.value, adjustReason.value);
  if (!v.ok) {
    adjustAmountErrorVi.value = v.amountError;
    adjustReasonErrorVi.value = v.reasonError;
    return;
  }
  adjustAmountErrorVi.value = null;
  adjustReasonErrorVi.value = null;
  pendingAdjust.value = { amount: v.amount, reason: v.reason };
  confirmErrorVi.value = null;
  confirmKind.value = 'adjust';
}

const adjustBalanceAfter = computed<number | null>(() =>
  user.value && pendingAdjust.value ? user.value.balance + pendingAdjust.value.amount : null,
);

function requestLockToggle(kind: 'lock' | 'unlock'): void {
  if (!userReason.value.trim()) {
    userReasonErrorVi.value = 'Vui lòng nhập lý do.';
    return;
  }
  userReasonErrorVi.value = null;
  confirmErrorVi.value = null;
  confirmKind.value = kind;
}

function closeConfirm(): void {
  if (isUserActionLoading.value) return;
  confirmKind.value = null;
  confirmErrorVi.value = null;
}

async function runConfirm(): Promise<void> {
  const kind = confirmKind.value;
  if (!kind || isUserActionLoading.value) return;
  confirmErrorVi.value = null;
  let ok = false;
  if (kind === 'adjust' && pendingAdjust.value) {
    ok = await ops.adjustUser(pendingAdjust.value.amount, pendingAdjust.value.reason);
    if (ok) {
      notificationVi.value = 'Đã điều chỉnh credit cho tài khoản.';
      adjustFormOpen.value = false;
      pendingAdjust.value = null;
      ledgerPager.reset();
    }
  } else if (kind === 'lock' || kind === 'unlock') {
    ok = kind === 'lock' ? await ops.lockUser(userReason.value) : await ops.unlockUser(userReason.value);
    if (ok) {
      notificationVi.value = kind === 'lock' ? 'Đã khóa tài khoản.' : 'Đã mở khóa tài khoản.';
      userReason.value = '';
    }
  }
  if (ok) confirmKind.value = null;
  else confirmErrorVi.value = userActionErrorVi.value;
}
</script>

<template>
  <div data-testid="page-admin-users" class="space-y-8">
    <AdminAccessGate :pending="isMePending" :admin="isAdmin">
      <header class="border-b border-[#2E2E2E] pb-6">
        <h1 :class="ui.pageTitle">Tài khoản</h1>
        <p :class="ui.pageLead">Số lượng người dùng toàn hệ thống; tìm tài khoản theo email để xem sổ cái, khóa/mở khóa hoặc cộng/trừ bù credit.</p>
      </header>

      <section data-testid="stats-users-section" class="space-y-5">
        <div class="flex flex-wrap items-baseline justify-between gap-2">
          <h2 :class="ui.sectionTitle">Tổng quan người dùng</h2>
          <button type="button" data-testid="stats-users-refresh" :disabled="isUserStatsLoading" :class="ui.btn" @click="() => ops.fetchUserStats(USER_DAYS)">
            <Icon name="lucide:refresh-cw" class="h-4 w-4" :class="{ 'animate-spin': isUserStatsLoading }" />
            <span>Làm mới</span>
          </button>
        </div>
        <p v-if="userStatsErrorVi" data-testid="stats-users-error" role="alert" :class="ui.error">{{ userStatsErrorVi }}</p>
        <p v-else-if="!userStats" :class="ui.muted">Đang tải số liệu người dùng...</p>

        <template v-if="userStats">
          <div class="grid grid-cols-2 gap-3 xl:grid-cols-4">
            <div v-for="t in userTiles" :key="t.key" :data-testid="`stats-user-tile-${t.key}`" :class="ui.card" class="space-y-1">
              <p class="text-sm font-medium text-[#B4B4B4]">{{ t.labelVi }}</p>
              <p class="text-3xl font-semibold tracking-tight text-[#EDEDED]">{{ t.value }}</p>
              <p class="text-sm text-[#B4B4B4]">{{ t.note }}</p>
            </div>
          </div>
          <div class="grid grid-cols-1 gap-3 xl:grid-cols-[3fr_2fr]">
            <div :class="ui.card">
              <AdminDailyChart
                data-testid="stats-chart-signups"
                :title="`Tài khoản mới ${USER_DAYS} ngày gần nhất`"
                :points="userStats.signupsByDay"
                :color="SERIES_1"
                unit-vi="tài khoản"
              />
            </div>
            <div :class="ui.card">
              <AdminBarChart data-testid="stats-chart-tiers" title="Tài khoản theo gói" :series="tierSeries" :rows="tierRows" :format="fmtCount" />
            </div>
          </div>
        </template>
      </section>

      <p v-if="notificationVi" data-testid="ops-notification" role="status" :class="ui.notice">{{ notificationVi }}</p>

      <section data-testid="ops-user-section" class="space-y-6 border-t border-[#2E2E2E] pt-8">
        <h2 :class="ui.sectionTitle">Tra cứu tài khoản</h2>
        <form class="flex flex-col gap-3 sm:flex-row sm:items-stretch" @submit.prevent="submitSearch">
          <BaseInput
            v-model="emailQuery"
            variant="admin"
            class="flex-1"
            type="email"
            data-testid="ops-user-email"
            placeholder="Email tài khoản"
            aria-label="Email tài khoản"
          />
          <button type="submit" data-testid="ops-user-search" :disabled="isUserLoading" :class="ui.btnPrimary">
            <Icon name="lucide:search" class="h-4 w-4 shrink-0" />
            <span>Tìm</span>
          </button>
        </form>
        <p v-if="userErrorVi" data-testid="ops-user-error" role="alert" :class="ui.error">{{ userErrorVi }}</p>
        <p v-if="!user && userReasonErrorVi" role="alert" :class="ui.error">{{ userReasonErrorVi }}</p>

        <template v-if="user">
          <div :class="ui.tableWrap" data-testid="ops-user-detail">
            <table :class="ui.table">
              <thead>
                <tr><th :class="ui.th">Email</th><th :class="ui.th">Gói</th><th :class="ui.th">Số dư / đang giữ</th><th :class="ui.th">Trạng thái</th></tr>
              </thead>
              <tbody>
                <tr>
                  <td :class="ui.td" class="break-all">{{ user.email }}</td>
                  <td :class="ui.td">{{ user.tier }}</td>
                  <td :class="ui.td" data-testid="ops-user-balance">{{ formatNumberVi(user.balance) }} / {{ formatNumberVi(user.held) }}</td>
                  <td :class="ui.td" data-testid="ops-user-lock-state">
                    <span :class="user.lockedAt ? ui.bad : ui.ok">{{ user.lockedAt ? 'Đã khóa' : 'Hoạt động' }}</span>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <div :class="ui.card" class="space-y-4">
            <h2 class="text-lg font-semibold text-[#EDEDED]">Thao tác</h2>
            <label :class="ui.label">
              <span>Lý do khóa / mở khóa</span>
              <BaseInput v-model="userReason" variant="admin" data-testid="ops-user-reason" maxlength="500" />
            </label>
            <p v-if="userReasonErrorVi" data-testid="ops-user-reason-error" role="alert" :class="ui.error">{{ userReasonErrorVi }}</p>
            <p v-if="userActionErrorVi && !confirmKind" role="alert" :class="ui.error">{{ userActionErrorVi }}</p>
            <div class="flex flex-wrap gap-2">
              <button v-if="!user.lockedAt" type="button" data-testid="ops-user-lock" :disabled="isUserActionLoading" :class="ui.btnDanger" @click="() => requestLockToggle('lock')">
                <Icon name="lucide:lock" class="h-4 w-4" /><span>Khóa tài khoản</span>
              </button>
              <button v-else type="button" data-testid="ops-user-unlock" :disabled="isUserActionLoading" :class="ui.btn" @click="() => requestLockToggle('unlock')">
                <Icon name="lucide:lock-open" class="h-4 w-4" /><span>Mở khóa</span>
              </button>
              <button type="button" data-testid="ops-user-adjust-open" :disabled="isUserActionLoading" :class="ui.btn" @click="openAdjustForm">
                <Icon name="lucide:coins" class="h-4 w-4" /><span>Cộng / Trừ bù credit</span>
              </button>
            </div>

            <form v-if="adjustFormOpen" data-testid="ops-adjust-form" class="space-y-4 border-t border-[#2E2E2E] pt-4" @submit.prevent="requestAdjust">
              <label :class="ui.label">
                <span>Số credit (số nguyên khác 0, âm là trừ)</span>
                <BaseInput v-model="adjustAmount" variant="admin" inputmode="numeric" data-testid="ops-adjust-amount" />
              </label>
              <p v-if="adjustAmountErrorVi" data-testid="ops-adjust-amount-error" role="alert" :class="ui.error">{{ adjustAmountErrorVi }}</p>
              <label :class="ui.label">
                <span>Lý do</span>
                <BaseInput v-model="adjustReason" variant="admin" maxlength="500" data-testid="ops-adjust-reason" />
              </label>
              <p v-if="adjustReasonErrorVi" data-testid="ops-adjust-reason-error" role="alert" :class="ui.error">{{ adjustReasonErrorVi }}</p>
              <button type="submit" data-testid="ops-adjust-submit" :disabled="isUserActionLoading" :class="ui.btnPrimary">Tiếp tục</button>
            </form>
          </div>

          <section class="space-y-3">
            <h2 :class="ui.sectionTitle">Sổ cái</h2>
            <p v-if="ledger.length === 0" :class="ui.muted">Chưa có bút toán.</p>
            <template v-else>
              <div :class="ui.tableWrap">
                <table :class="ui.table" data-testid="ops-ledger-list">
                  <thead>
                    <tr><th :class="ui.th">Thời gian</th><th :class="ui.th">Loại</th><th :class="ui.th">Ghi chú</th><th :class="ui.th" class="text-right">Credit</th></tr>
                  </thead>
                  <tbody>
                    <tr v-for="e in ledgerPager.pageItems.value" :key="e.id">
                      <td :class="ui.td" class="whitespace-nowrap">{{ formatTopupTimestampVi(e.createdAt) }}</td>
                      <td :class="ui.td">{{ e.labelVi }}</td>
                      <td :class="ui.td" class="break-words">{{ e.note || '-' }}</td>
                      <td :class="[ui.td, 'text-right font-geist-mono', e.amount < 0 ? ui.bad : '']">{{ formatNumberVi(e.amount) }}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <AdminPager
                :page="ledgerPager.page.value"
                :page-count="ledgerPager.pageCount.value"
                :has-more="ledgerHasMore"
                :can-prev="ledgerPager.canPrev.value"
                :can-next="ledgerPager.canNext.value"
                :loading="ledgerPager.isPaging.value"
                @prev="ledgerPager.prev"
                @next="ledgerPager.next"
              />
            </template>
          </section>
        </template>
      </section>

      <AdminConfirmDialog
        :open="confirmKind !== null"
        :title="confirmTitle"
        :busy="isUserActionLoading"
        :error-vi="confirmErrorVi"
        @cancel="closeConfirm"
        @confirm="runConfirm"
      >
        <p v-if="user" class="break-all" data-testid="ops-confirm-user">Tài khoản: {{ user.email }}</p>
        <template v-if="confirmKind === 'adjust' && pendingAdjust && user">
          <p data-testid="ops-confirm-adjust">
            Số dư trước: {{ formatNumberVi(user.balance) }}, thay đổi {{ pendingAdjust.amount > 0 ? '+' : '' }}{{ formatNumberVi(pendingAdjust.amount) }}, số dư sau: {{ formatNumberVi(adjustBalanceAfter ?? 0) }}.
          </p>
          <p class="break-words text-[#A1A1A1]">Lý do: {{ pendingAdjust.reason }}</p>
        </template>
        <p v-else class="break-words text-[#A1A1A1]">Lý do: {{ userReason }}</p>
      </AdminConfirmDialog>
    </AdminAccessGate>
  </div>
</template>
