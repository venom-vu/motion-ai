<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { definePageMeta, useAsyncData } from '#imports';
import type { MeResponse } from '@flowvis/contracts';
import { ME_KEY, useApiClient } from '~/composables/useApiClient';
import {
  BACKUP_STALE_MS,
  RH_BALANCE_STALE_MS,
  isStaleAt,
  isTaskFinished,
  useAdminOps,
  validateAdjustForm,
} from '~/composables/useAdminOps';
import { useAuthDialog } from '~/composables/useAuthDialog';
import { formatNumberVi, formatVndVi } from '~/utils/catalog';
import { formatTopupTimestampVi } from '~/utils/topup';

definePageMeta({ layout: 'admin' });

const { client } = useApiClient();
const { open: openAuthDialog } = useAuthDialog();

const meAsync = useAsyncData<MeResponse>(ME_KEY, () => client.getMe());
const isMePending = computed<boolean>(
  () => meAsync.status.value === 'pending' || Boolean(meAsync.pending.value),
);
const currentUser = computed<MeResponse | null>(() => meAsync.data.value ?? null);
const isAdmin = computed<boolean>(() => currentUser.value?.role === 'admin');

const ops = useAdminOps();
const {
  status,
  statusErrorVi,
  isStatusLoading,
  isResuming,
  resumeErrorVi,
  stats,
  isStatsLoading,
  statsErrorVi,
  user,
  ledger,
  ledgerHasMore,
  userErrorVi,
  isUserLoading,
  isUserActionLoading,
  userActionErrorVi,
  task,
  taskErrorVi,
  isTaskLoading,
  isTakedownLoading,
  takedownErrorVi,
  auditItems,
  auditAction,
  auditTarget,
  auditHasMore,
  isAuditLoading,
  isAuditLoadingMore,
  auditErrorVi,
} = ops;

/* Đồng hồ để nhãn "cũ" tự cập nhật. */
const nowMs = ref<number>(Date.now());
let clockTimer: ReturnType<typeof setInterval> | null = null;

const canResume = computed<boolean>(
  () => Boolean(status.value && (status.value.intakePaused || status.value.rhBudgetExhausted)),
);
const balanceStale = computed<boolean>(() =>
  isStaleAt(status.value?.rhBalance?.readAt, RH_BALANCE_STALE_MS, nowMs.value),
);
const backupStale = computed<boolean>(() =>
  isStaleAt(status.value?.lastBackup?.at, BACKUP_STALE_MS, nowMs.value),
);

/* ---------------------------- Hộp xác nhận chung ---------------------------- */
type ConfirmKind = 'resume' | 'adjust' | 'lock' | 'unlock' | 'takedown';
const confirmKind = ref<ConfirmKind | null>(null);
const confirmErrorVi = ref<string | null>(null);
const notificationVi = ref<string | null>(null);

const isBusy = computed<boolean>(
  () => isResuming.value || isUserActionLoading.value || isTakedownLoading.value,
);

function closeConfirm(): void {
  if (isBusy.value) return;
  confirmKind.value = null;
  confirmErrorVi.value = null;
}

/* ------------------------------ Thống kê ------------------------------ */
function toLocalInput(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
const statsFrom = ref<string>(toLocalInput(new Date(Date.now() - 7 * 24 * 3600 * 1000)));
const statsTo = ref<string>(toLocalInput(new Date()));
const statsScope = ref<'real' | 'benchmark'>('real');
const trialMotionPrice = ref<string>('');
const trialImagePrice = ref<string>('');
const statsFormErrorVi = ref<string | null>(null);

function parseTrial(raw: string, label: string): number | undefined | null {
  const v = raw.trim();
  if (v === '') return undefined;
  if (!/^\d+$/.test(v) || Number(v) <= 0) {
    statsFormErrorVi.value = `${label} phải là số nguyên dương.`;
    return null;
  }
  return Number(v);
}

async function submitStats(): Promise<void> {
  statsFormErrorVi.value = null;
  const from = new Date(statsFrom.value);
  const to = new Date(statsTo.value);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
    statsFormErrorVi.value = 'Vui lòng chọn khoảng thời gian hợp lệ.';
    return;
  }
  if (to.getTime() < from.getTime()) {
    statsFormErrorVi.value = 'Thời điểm kết thúc không được sớm hơn thời điểm bắt đầu.';
    return;
  }
  const motion = parseTrial(trialMotionPrice.value, 'Giá thử mỗi giây Motion');
  const image = parseTrial(trialImagePrice.value, 'Giá thử mỗi ảnh');
  if (motion === null || image === null) return;
  await ops.fetchStats({
    from: from.toISOString(),
    to: to.toISOString(),
    scope: statsScope.value,
    motionPricePerSecond: motion,
    imagePrice: image,
  });
}

function pct(v: number | null | undefined): string {
  return v == null ? '-' : `${(v * 100).toFixed(1)}%`;
}
function secs(v: number | null | undefined): string {
  return v == null ? '-' : `${v.toFixed(1)}s`;
}

/* ------------------------------ Tài khoản ------------------------------ */
const emailQuery = ref<string>('');
const userReason = ref<string>('');
const adjustAmount = ref<string>('');
const adjustReason = ref<string>('');
const adjustAmountErrorVi = ref<string | null>(null);
const adjustReasonErrorVi = ref<string | null>(null);
const userReasonErrorVi = ref<string | null>(null);
const adjustFormOpen = ref<boolean>(false);
const pendingAdjust = ref<{ amount: number; reason: string } | null>(null);

async function submitSearch(): Promise<void> {
  if (!emailQuery.value.trim()) {
    userReasonErrorVi.value = 'Vui lòng nhập email cần tìm.';
    return;
  }
  userReasonErrorVi.value = null;
  adjustFormOpen.value = false;
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

/* ------------------------------ Gỡ nội dung ------------------------------ */
const lookupInput = ref<string>('');
const takedownReason = ref<string>('');
const takedownReasonErrorVi = ref<string | null>(null);
const taskFinished = computed<boolean>(() => (task.value ? isTaskFinished(task.value.status) : false));
const canTakedown = computed<boolean>(
  () => Boolean(task.value) && taskFinished.value && !task.value?.filesRemovedAt,
);

function requestTakedown(): void {
  if (!canTakedown.value) return;
  if (!takedownReason.value.trim()) {
    takedownReasonErrorVi.value = 'Vui lòng nhập lý do.';
    return;
  }
  takedownReasonErrorVi.value = null;
  confirmErrorVi.value = null;
  confirmKind.value = 'takedown';
}

/* ------------------------------ Xác nhận ------------------------------ */
async function runConfirm(): Promise<void> {
  const kind = confirmKind.value;
  if (!kind || isBusy.value) return;
  confirmErrorVi.value = null;
  let ok = false;
  if (kind === 'resume') {
    ok = await ops.resumeIntake();
    if (!ok) confirmErrorVi.value = resumeErrorVi.value;
    else notificationVi.value = 'Đã mở lại nhận Task mới.';
  } else if (kind === 'adjust' && pendingAdjust.value) {
    ok = await ops.adjustUser(pendingAdjust.value.amount, pendingAdjust.value.reason);
    if (!ok) confirmErrorVi.value = userActionErrorVi.value;
    else {
      notificationVi.value = 'Đã điều chỉnh credit cho tài khoản.';
      adjustFormOpen.value = false;
      pendingAdjust.value = null;
    }
  } else if (kind === 'lock') {
    ok = await ops.lockUser(userReason.value);
    if (!ok) confirmErrorVi.value = userActionErrorVi.value;
    else {
      notificationVi.value = 'Đã khóa tài khoản.';
      userReason.value = '';
    }
  } else if (kind === 'unlock') {
    ok = await ops.unlockUser(userReason.value);
    if (!ok) confirmErrorVi.value = userActionErrorVi.value;
    else {
      notificationVi.value = 'Đã mở khóa tài khoản.';
      userReason.value = '';
    }
  } else if (kind === 'takedown') {
    ok = await ops.takedown(takedownReason.value);
    if (!ok) confirmErrorVi.value = takedownErrorVi.value;
    else {
      notificationVi.value = 'Đã gỡ nội dung của Task.';
      takedownReason.value = '';
    }
  }
  if (ok) {
    confirmKind.value = null;
    void ops.fetchAudit(true);
  }
}

function start(): void {
  void ops.refreshStatus();
  ops.startStatusPolling();
  void submitStats();
  void ops.fetchAudit(true);
  if (!clockTimer) clockTimer = setInterval(() => (nowMs.value = Date.now()), 30_000);
}

onMounted(() => {
  if (isAdmin.value) start();
});
watch(isAdmin, (admin) => {
  if (admin && !status.value) start();
});
onBeforeUnmount(() => {
  ops.stopStatusPolling();
  if (clockTimer) clearInterval(clockTimer);
  clockTimer = null;
});

const btn =
  'touch-target inline-flex min-h-[48px] min-w-[48px] items-center justify-center gap-2 rounded-lg border border-cyber-border bg-[#141414] px-4 py-2 text-xs font-medium text-cyber-text transition hover:bg-cyber-surface disabled:cursor-not-allowed disabled:opacity-50';
const input =
  'min-h-[48px] w-full rounded-lg border border-cyber-border bg-[#0A0A0A] px-3 py-2 text-xs text-cyber-text outline-none focus:border-cyber-cyan';
const card = 'rounded-xl border border-cyber-border bg-[#0D0E12] p-4';
</script>

<template>
  <div data-testid="page-admin-ops" class="space-y-6 font-mono text-cyber-text">
    <section
      v-if="isMePending"
      data-testid="admin-auth-loading-state"
      class="flex min-h-[420px] flex-col items-center justify-center gap-3 rounded-2xl border border-cyber-border bg-[#0D0E12] p-8 text-center text-cyber-muted"
    >
      <Icon name="lucide:loader-2" class="h-8 w-8 animate-spin text-cyber-cyan" />
      <p class="text-xs">Đang kiểm tra quyền quản trị viên...</p>
    </section>

    <section
      v-else-if="!isAdmin"
      data-testid="admin-forbidden-state"
      class="flex min-h-[420px] flex-col items-center justify-center rounded-2xl border border-rose-500/30 bg-[#0D0E12] p-8 text-center"
    >
      <div class="flex h-16 w-16 items-center justify-center rounded-2xl border border-rose-500/40 bg-rose-500/10 text-rose-400">
        <Icon name="lucide:shield-alert" class="h-8 w-8" />
      </div>
      <h1 class="mt-4 text-xl font-bold tracking-tight text-cyber-text">403 — TRUY CẬP BỊ TỪ CHỐI</h1>
      <p class="mt-2 max-w-md text-xs leading-relaxed text-cyber-muted">
        Trang vận hành chỉ dành cho Quản trị viên (Admin).
      </p>
      <div class="mt-6 flex flex-wrap items-center justify-center gap-3">
        <button type="button" data-testid="admin-forbidden-login-button" :class="btn" @click="() => openAuthDialog('login')">
          <Icon name="lucide:log-in" class="h-4 w-4 text-cyber-cyan" />
          <span>Đăng nhập</span>
        </button>
        <NuxtLink to="/" :class="btn">
          <Icon name="lucide:arrow-left" class="h-4 w-4" />
          <span>Về trang chủ</span>
        </NuxtLink>
      </div>
    </section>

    <template v-else>
      <div class="space-y-1">
        <div class="flex items-center gap-2 text-xs text-cyber-muted">
          <NuxtLink to="/admin" class="transition hover:text-cyber-text">Admin</NuxtLink>
          <span>/</span>
          <span class="text-cyber-text">Vận hành hệ thống</span>
        </div>
        <h1 class="text-lg font-bold uppercase tracking-tight sm:text-xl">VẬN HÀNH HỆ THỐNG</h1>
      </div>

      <p
        v-if="notificationVi"
        data-testid="ops-notification"
        role="status"
        class="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-300"
      >
        {{ notificationVi }}
      </p>

      <!-- 1. Trạng thái -->
      <section data-testid="ops-status-section" class="space-y-3">
        <div class="flex items-center justify-between gap-2">
          <h2 class="text-sm font-bold uppercase">Trạng thái</h2>
          <button type="button" data-testid="ops-status-refresh" :disabled="isStatusLoading" :class="btn" @click="() => ops.refreshStatus()">
            <Icon name="lucide:refresh-cw" class="h-4 w-4" />
            <span>Làm mới</span>
          </button>
        </div>
        <p v-if="statusErrorVi" data-testid="ops-status-error" role="alert" class="text-xs text-rose-400">{{ statusErrorVi }}</p>
        <p v-if="!status && !statusErrorVi" class="text-xs text-cyber-muted">Đang tải trạng thái...</p>
        <div v-if="status" class="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <div :class="card" data-testid="ops-card-intake">
            <p class="text-[11px] text-cyber-muted">Nhận Task mới</p>
            <p class="mt-1 text-sm font-bold" :class="status.intakePaused ? 'text-amber-400' : 'text-emerald-400'">
              {{ status.intakePaused ? 'Đang tạm dừng' : 'Đang mở' }}
            </p>
            <p v-if="status.lastBreakerTrigger" class="mt-2 break-words text-[11px] text-cyber-muted">
              Ngắt mạch lúc {{ formatTopupTimestampVi(status.lastBreakerTrigger.at) }}: {{ status.lastBreakerTrigger.rule }}
            </p>
          </div>
          <div :class="card" data-testid="ops-card-budget">
            <p class="text-[11px] text-cyber-muted">Ngân sách RunningHub</p>
            <p class="mt-1 text-sm font-bold" :class="status.rhBudgetExhausted ? 'text-rose-400' : 'text-emerald-400'">
              {{ status.rhBudgetExhausted ? 'Đã hết ngân sách' : 'Còn ngân sách' }}
            </p>
            <p v-if="status.rhBalance" class="mt-2 text-[11px] text-cyber-muted">
              Số dư {{ formatNumberVi(status.rhBalance.coins) }} coin, đọc lúc {{ formatTopupTimestampVi(status.rhBalance.readAt) }}
            </p>
            <p v-else class="mt-2 text-[11px] text-cyber-muted">Chưa đọc được số dư.</p>
            <p v-if="balanceStale" data-testid="ops-balance-stale" class="mt-1 text-[11px] font-semibold text-amber-400">
              Dữ liệu số dư đã cũ, có thể không còn đúng.
            </p>
          </div>
          <div :class="card" data-testid="ops-card-backup">
            <p class="text-[11px] text-cyber-muted">Sao lưu gần nhất</p>
            <template v-if="status.lastBackup">
              <p class="mt-1 text-sm font-bold" :class="status.lastBackup.result === 'success' ? 'text-emerald-400' : 'text-rose-400'">
                {{ status.lastBackup.result === 'success' ? 'Thành công' : 'Thất bại' }}
              </p>
              <p class="mt-2 text-[11px] text-cyber-muted">
                {{ formatTopupTimestampVi(status.lastBackup.at) }}<span v-if="status.lastBackup.sizeBytes != null">, {{ formatNumberVi(status.lastBackup.sizeBytes) }} byte</span>
              </p>
            </template>
            <p v-else class="mt-1 text-sm font-bold text-amber-400">Chưa có bản sao lưu</p>
            <p v-if="backupStale" data-testid="ops-backup-stale" class="mt-1 text-[11px] font-semibold text-amber-400">
              Bản sao lưu đã cũ.
            </p>
          </div>
          <div :class="card">
            <p class="text-[11px] text-cyber-muted">Mở lại nhận Task</p>
            <button
              type="button"
              data-testid="ops-resume-button"
              :disabled="!canResume || isResuming"
              :class="[btn, 'mt-2 w-full']"
              @click="() => { confirmErrorVi = null; confirmKind = 'resume'; }"
            >
              <Icon name="lucide:play" class="h-4 w-4 text-cyber-cyan" />
              <span>Mở lại nhận Task</span>
            </button>
            <p v-if="!canResume" class="mt-2 text-[11px] text-cyber-muted">Hệ thống đang nhận Task bình thường.</p>
          </div>
        </div>
      </section>

      <!-- 2. Thống kê -->
      <section data-testid="ops-stats-section" class="space-y-3">
        <h2 class="text-sm font-bold uppercase">Thống kê</h2>
        <form :class="[card, 'grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3']" @submit.prevent="submitStats">
          <label class="space-y-1 text-[11px] text-cyber-muted">
            <span>Từ</span>
            <input v-model="statsFrom" type="datetime-local" data-testid="ops-stats-from" :class="input" />
          </label>
          <label class="space-y-1 text-[11px] text-cyber-muted">
            <span>Đến</span>
            <input v-model="statsTo" type="datetime-local" data-testid="ops-stats-to" :class="input" />
          </label>
          <label class="space-y-1 text-[11px] text-cyber-muted">
            <span>Phạm vi</span>
            <select v-model="statsScope" data-testid="ops-stats-scope" :class="input">
              <option value="real">Thực tế (real)</option>
              <option value="benchmark">Đo thử (benchmark)</option>
            </select>
          </label>
          <label class="space-y-1 text-[11px] text-cyber-muted">
            <span>Giá thử mỗi giây Motion (credit)</span>
            <input v-model="trialMotionPrice" inputmode="numeric" data-testid="ops-stats-motion-price" placeholder="Để trống = giá thật" :class="input" />
          </label>
          <label class="space-y-1 text-[11px] text-cyber-muted">
            <span>Giá thử mỗi ảnh (credit)</span>
            <input v-model="trialImagePrice" inputmode="numeric" data-testid="ops-stats-image-price" placeholder="Để trống = giá thật" :class="input" />
          </label>
          <div class="flex items-end">
            <button type="submit" data-testid="ops-stats-submit" :disabled="isStatsLoading" :class="[btn, 'w-full']">
              <Icon name="lucide:bar-chart-3" class="h-4 w-4 text-cyber-cyan" />
              <span>Xem thống kê</span>
            </button>
          </div>
          <p class="text-[11px] text-cyber-muted sm:col-span-2 xl:col-span-3">
            Giá thử chỉ dùng để tính lại thống kê, không thay đổi giá thật.
          </p>
        </form>
        <p v-if="statsFormErrorVi" data-testid="ops-stats-form-error" role="alert" class="text-xs text-rose-400">{{ statsFormErrorVi }}</p>
        <p v-if="statsErrorVi" data-testid="ops-stats-error" role="alert" class="text-xs text-rose-400">{{ statsErrorVi }}</p>
        <div v-if="stats" class="space-y-3">
          <div class="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div :class="card"><p class="text-[11px] text-cyber-muted">Đơn nạp đã duyệt</p><p class="mt-1 text-sm font-bold">{{ formatNumberVi(stats.successMetrics.approvedTopups) }}</p></div>
            <div :class="card"><p class="text-[11px] text-cyber-muted">Tỷ lệ chuyển đổi</p><p class="mt-1 text-sm font-bold">{{ pct(stats.successMetrics.conversionRate) }}</p></div>
            <div :class="card"><p class="text-[11px] text-cyber-muted">Chi phí GPU (USD)</p><p class="mt-1 text-sm font-bold">{{ stats.successMetrics.gpuCostUsd }}</p></div>
          </div>
          <div class="overflow-x-auto rounded-xl border border-cyber-border">
            <table class="w-full min-w-[640px] text-left text-xs" data-testid="ops-stats-pipelines">
              <thead class="text-cyber-muted">
                <tr>
                  <th class="p-2">Pipeline</th><th class="p-2">Thành công</th><th class="p-2">TB</th><th class="p-2">p95</th><th class="p-2">Phí GPU TB (lẻ)</th><th class="p-2">Phí GPU TB (gói)</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="p in stats.pipelines" :key="p.pipeline" class="border-t border-cyber-border">
                  <td class="p-2">{{ p.pipeline }}</td>
                  <td class="p-2">{{ pct(p.successRate) }}</td>
                  <td class="p-2">{{ secs(p.avgProcessingSeconds) }}</td>
                  <td class="p-2">{{ secs(p.p95ProcessingSeconds) }}</td>
                  <td class="p-2">{{ p.avgCostVnd ? formatVndVi(p.avgCostVnd.retail) : '-' }}</td>
                  <td class="p-2">{{ p.avgCostVnd ? formatVndVi(p.avgCostVnd.standardPack) : '-' }}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <div class="overflow-x-auto rounded-xl border border-cyber-border">
            <table class="w-full min-w-[640px] text-left text-xs" data-testid="ops-stats-margins">
              <thead class="text-cyber-muted">
                <tr><th class="p-2">Pipeline</th><th class="p-2">Gói</th><th class="p-2">Kịch bản</th><th class="p-2">Doanh thu</th><th class="p-2">Chi phí</th><th class="p-2">Biên gộp</th></tr>
              </thead>
              <tbody>
                <tr v-for="(m, i) in stats.margins" :key="i" class="border-t border-cyber-border">
                  <td class="p-2">{{ m.pipeline }}</td>
                  <td class="p-2">{{ m.pack }}</td>
                  <td class="p-2">{{ m.scenario }}</td>
                  <td class="p-2">{{ formatVndVi(m.revenueVnd) }}</td>
                  <td class="p-2">{{ formatVndVi(m.costVnd) }}</td>
                  <td class="p-2" :class="m.marginVnd < 0 ? 'text-rose-400' : 'text-emerald-400'">{{ formatNumberVi(m.marginVnd) }}đ ({{ pct(m.marginRate) }})</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <!-- 3. Tài khoản -->
      <section data-testid="ops-user-section" class="space-y-3">
        <h2 class="text-sm font-bold uppercase">Tài khoản</h2>
        <form :class="[card, 'flex flex-col gap-3 sm:flex-row']" @submit.prevent="submitSearch">
          <input v-model="emailQuery" type="email" data-testid="ops-user-email" placeholder="Email tài khoản" :class="input" />
          <button type="submit" data-testid="ops-user-search" :disabled="isUserLoading" :class="btn">
            <Icon name="lucide:search" class="h-4 w-4" />
            <span>Tìm</span>
          </button>
        </form>
        <p v-if="userErrorVi" data-testid="ops-user-error" role="alert" class="text-xs text-rose-400">{{ userErrorVi }}</p>
        <div v-if="user" :class="[card, 'space-y-4']" data-testid="ops-user-detail">
          <div class="grid grid-cols-2 gap-3 text-xs sm:grid-cols-4">
            <div><p class="text-[11px] text-cyber-muted">Email</p><p class="break-all">{{ user.email }}</p></div>
            <div><p class="text-[11px] text-cyber-muted">Gói</p><p>{{ user.tier }}</p></div>
            <div><p class="text-[11px] text-cyber-muted">Số dư / đang giữ</p><p data-testid="ops-user-balance">{{ formatNumberVi(user.balance) }} / {{ formatNumberVi(user.held) }}</p></div>
            <div>
              <p class="text-[11px] text-cyber-muted">Trạng thái</p>
              <p data-testid="ops-user-lock-state" :class="user.lockedAt ? 'text-rose-400' : 'text-emerald-400'">{{ user.lockedAt ? 'Đã khóa' : 'Hoạt động' }}</p>
            </div>
          </div>

          <div class="space-y-2">
            <label class="block space-y-1 text-[11px] text-cyber-muted">
              <span>Lý do khóa / mở khóa</span>
              <input v-model="userReason" data-testid="ops-user-reason" maxlength="500" :class="input" />
            </label>
            <p v-if="userReasonErrorVi" data-testid="ops-user-reason-error" role="alert" class="text-xs text-rose-400">{{ userReasonErrorVi }}</p>
            <div class="flex flex-wrap gap-2">
              <button v-if="!user.lockedAt" type="button" data-testid="ops-user-lock" :disabled="isUserActionLoading" :class="btn" @click="() => requestLockToggle('lock')">
                <Icon name="lucide:lock" class="h-4 w-4 text-rose-400" /><span>Khóa tài khoản</span>
              </button>
              <button v-else type="button" data-testid="ops-user-unlock" :disabled="isUserActionLoading" :class="btn" @click="() => requestLockToggle('unlock')">
                <Icon name="lucide:lock-open" class="h-4 w-4 text-emerald-400" /><span>Mở khóa</span>
              </button>
              <button type="button" data-testid="ops-user-adjust-open" :disabled="isUserActionLoading" :class="btn" @click="openAdjustForm">
                <Icon name="lucide:coins" class="h-4 w-4 text-cyber-cyan" /><span>Cộng / Trừ bù credit</span>
              </button>
            </div>
          </div>

          <form v-if="adjustFormOpen" data-testid="ops-adjust-form" class="space-y-2 rounded-lg border border-cyber-border p-3" @submit.prevent="requestAdjust">
            <label class="block space-y-1 text-[11px] text-cyber-muted">
              <span>Số credit (số nguyên khác 0, âm là trừ)</span>
              <input v-model="adjustAmount" inputmode="numeric" data-testid="ops-adjust-amount" :class="input" />
            </label>
            <p v-if="adjustAmountErrorVi" data-testid="ops-adjust-amount-error" role="alert" class="text-xs text-rose-400">{{ adjustAmountErrorVi }}</p>
            <label class="block space-y-1 text-[11px] text-cyber-muted">
              <span>Lý do</span>
              <input v-model="adjustReason" maxlength="500" data-testid="ops-adjust-reason" :class="input" />
            </label>
            <p v-if="adjustReasonErrorVi" data-testid="ops-adjust-reason-error" role="alert" class="text-xs text-rose-400">{{ adjustReasonErrorVi }}</p>
            <button type="submit" data-testid="ops-adjust-submit" :disabled="isUserActionLoading" :class="btn">
              <Icon name="lucide:check" class="h-4 w-4" /><span>Tiếp tục</span>
            </button>
          </form>

          <div class="space-y-2">
            <h3 class="text-[11px] font-bold uppercase text-cyber-muted">Sổ cái gần đây</h3>
            <p v-if="ledger.length === 0" class="text-xs text-cyber-muted">Chưa có bút toán.</p>
            <ul class="divide-y divide-cyber-border text-xs" data-testid="ops-ledger-list">
              <li v-for="e in ledger" :key="e.id" class="flex flex-wrap items-center justify-between gap-2 py-2">
                <span>{{ e.labelVi }}<span v-if="e.note" class="text-cyber-muted"> - {{ e.note }}</span></span>
                <span :class="e.amount < 0 ? 'text-rose-400' : 'text-emerald-400'">{{ formatNumberVi(e.amount) }}</span>
              </li>
            </ul>
            <button v-if="ledgerHasMore" type="button" data-testid="ops-ledger-more" :class="btn" @click="() => ops.loadMoreLedger()">Tải thêm</button>
          </div>
        </div>
      </section>

      <!-- 4. Gỡ nội dung -->
      <section data-testid="ops-takedown-section" class="space-y-3">
        <h2 class="text-sm font-bold uppercase">Gỡ nội dung vi phạm</h2>
        <form :class="[card, 'flex flex-col gap-3 sm:flex-row']" @submit.prevent="() => ops.lookupTask(lookupInput)">
          <input v-model="lookupInput" data-testid="ops-task-input" placeholder="Mã Task hoặc liên kết chia sẻ" :class="input" />
          <button type="submit" data-testid="ops-task-lookup" :disabled="isTaskLoading" :class="btn">
            <Icon name="lucide:search" class="h-4 w-4" /><span>Tra cứu</span>
          </button>
        </form>
        <p v-if="taskErrorVi" data-testid="ops-task-error" role="alert" class="text-xs text-rose-400">{{ taskErrorVi }}</p>
        <div v-if="task" :class="[card, 'space-y-3']" data-testid="ops-task-detail">
          <div class="grid grid-cols-1 gap-3 text-xs sm:grid-cols-2">
            <div><p class="text-[11px] text-cyber-muted">Task</p><p class="break-all">{{ task.id }} ({{ task.pipeline }}, {{ task.status }})</p></div>
            <div><p class="text-[11px] text-cyber-muted">Chủ Task</p><p class="break-all">{{ task.userEmail }}</p></div>
            <div><p class="text-[11px] text-cyber-muted">Đã gỡ lúc</p><p data-testid="ops-task-removed">{{ task.filesRemovedAt ? formatTopupTimestampVi(task.filesRemovedAt) : 'Chưa gỡ' }}</p></div>
            <div v-if="!task.filesRemovedAt"><p class="text-[11px] text-cyber-muted">Liên kết chia sẻ</p><p>Token chia sẻ sẽ bị thu hồi khi gỡ</p></div>
          </div>
          <label class="block space-y-1 text-[11px] text-cyber-muted">
            <span>Lý do gỡ</span>
            <input v-model="takedownReason" maxlength="500" data-testid="ops-takedown-reason" :class="input" />
          </label>
          <p v-if="takedownReasonErrorVi" data-testid="ops-takedown-reason-error" role="alert" class="text-xs text-rose-400">{{ takedownReasonErrorVi }}</p>
          <button type="button" data-testid="ops-takedown-button" :disabled="!canTakedown || isTakedownLoading" :class="btn" @click="requestTakedown">
            <Icon name="lucide:trash-2" class="h-4 w-4 text-rose-400" /><span>Gỡ bỏ ngay</span>
          </button>
          <p v-if="!taskFinished" data-testid="ops-takedown-unfinished" class="text-xs text-amber-400">
            Task chưa kết thúc (đang chờ hoặc đang chạy) nên chưa thể gỡ nội dung.
          </p>
          <p v-else-if="task.filesRemovedAt" class="text-xs text-cyber-muted">Nội dung của Task này đã được gỡ.</p>
        </div>
      </section>

      <!-- 5. Nhật ký -->
      <section data-testid="ops-audit-section" class="space-y-3">
        <h2 class="text-sm font-bold uppercase">Nhật ký Admin</h2>
        <form :class="[card, 'grid grid-cols-1 gap-3 sm:grid-cols-3']" @submit.prevent="() => ops.fetchAudit(true)">
          <input v-model="auditAction" data-testid="ops-audit-action" placeholder="Lọc theo action (ví dụ ADJUST)" :class="input" />
          <input v-model="auditTarget" data-testid="ops-audit-target" placeholder="Lọc theo target" :class="input" />
          <button type="submit" data-testid="ops-audit-filter" :disabled="isAuditLoading" :class="btn">
            <Icon name="lucide:filter" class="h-4 w-4" /><span>Lọc</span>
          </button>
        </form>
        <p v-if="auditErrorVi" data-testid="ops-audit-error" role="alert" class="text-xs text-rose-400">{{ auditErrorVi }}</p>
        <p v-if="!isAuditLoading && auditItems.length === 0 && !auditErrorVi" class="text-xs text-cyber-muted">Chưa có bản ghi.</p>
        <ul class="divide-y divide-cyber-border rounded-xl border border-cyber-border text-xs" data-testid="ops-audit-list">
          <li v-for="a in auditItems" :key="a.id" class="space-y-1 p-3">
            <p class="flex flex-wrap items-center justify-between gap-2">
              <span class="font-bold">{{ a.action }}</span>
              <span class="text-cyber-muted">{{ formatTopupTimestampVi(a.createdAt) }}</span>
            </p>
            <p class="break-all text-cyber-muted">{{ a.target }}</p>
            <p v-if="a.reason" class="break-words">{{ a.reason }}</p>
          </li>
        </ul>
        <button v-if="auditHasMore" type="button" data-testid="ops-audit-more" :disabled="isAuditLoadingMore" :class="btn" @click="() => ops.fetchAudit(false)">Tải thêm</button>
      </section>

      <!-- Hộp xác nhận -->
      <div
        v-if="confirmKind"
        data-testid="ops-confirm-dialog"
        role="dialog"
        aria-modal="true"
        class="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      >
        <div class="w-full max-w-md space-y-4 rounded-2xl border border-cyber-border bg-[#0D0E12] p-5">
          <template v-if="confirmKind === 'resume'">
            <h3 class="text-sm font-bold">Mở lại nhận Task mới?</h3>
            <p class="text-xs leading-relaxed text-cyber-muted">
              Nếu nguyên nhân chưa được xử lý (ví dụ hết ngân sách RunningHub), Task mới có thể thất bại nhanh.
            </p>
            <p class="text-xs" data-testid="ops-confirm-balance">
              Số dư RunningHub lần đọc cuối:
              {{ status?.rhBalance ? `${formatNumberVi(status.rhBalance.coins)} coin (${formatTopupTimestampVi(status.rhBalance.readAt)})` : 'chưa đọc được' }}
            </p>
          </template>
          <template v-else-if="confirmKind === 'adjust' && pendingAdjust && user">
            <h3 class="text-sm font-bold">Xác nhận điều chỉnh credit</h3>
            <p class="break-all text-xs" data-testid="ops-confirm-user">Tài khoản: {{ user.email }}</p>
            <p class="text-xs" data-testid="ops-confirm-adjust">
              Số dư trước: {{ formatNumberVi(user.balance) }}, thay đổi {{ pendingAdjust.amount > 0 ? '+' : '' }}{{ formatNumberVi(pendingAdjust.amount) }}, số dư sau: {{ formatNumberVi(adjustBalanceAfter ?? 0) }}.
            </p>
            <p class="break-words text-xs text-cyber-muted">Lý do: {{ pendingAdjust.reason }}</p>
          </template>
          <template v-else-if="confirmKind === 'lock' || confirmKind === 'unlock'">
            <h3 class="text-sm font-bold">{{ confirmKind === 'lock' ? 'Khóa tài khoản này?' : 'Mở khóa tài khoản này?' }}</h3>
            <p v-if="user" class="break-all text-xs" data-testid="ops-confirm-user">Tài khoản: {{ user.email }}</p>
            <p class="break-words text-xs text-cyber-muted">Lý do: {{ userReason }}</p>
          </template>
          <template v-else-if="confirmKind === 'takedown'">
            <h3 class="text-sm font-bold">Gỡ bỏ nội dung của Task?</h3>
            <p class="text-xs leading-relaxed text-cyber-muted">Tệp trên R2 sẽ bị xóa và token chia sẻ bị thu hồi. Không thể hoàn tác.</p>
            <p class="break-words text-xs text-cyber-muted">Lý do: {{ takedownReason }}</p>
          </template>
          <p v-if="confirmErrorVi" data-testid="ops-confirm-error" role="alert" class="text-xs text-rose-400">{{ confirmErrorVi }}</p>
          <div class="flex flex-wrap justify-end gap-2">
            <button type="button" data-testid="ops-confirm-cancel" :disabled="isBusy" :class="btn" @click="closeConfirm">Hủy</button>
            <button type="button" data-testid="ops-confirm-ok" :disabled="isBusy" :class="btn" @click="runConfirm">
              <Icon v-if="isBusy" name="lucide:loader-2" class="h-4 w-4 animate-spin" />
              <span>Xác nhận</span>
            </button>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>
