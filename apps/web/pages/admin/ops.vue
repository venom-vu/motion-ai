<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { definePageMeta } from '#imports';
import { useAdminAccess } from '~/composables/useAdminAccess';
import { BACKUP_STALE_MS, RH_BALANCE_STALE_MS, isStaleAt, useAdminOps } from '~/composables/useAdminOps';
import { formatNumberVi } from '~/utils/catalog';
import { formatTopupTimestampVi } from '~/utils/topup';
import { ui } from '~/utils/admin-ui';

definePageMeta({ layout: 'admin' });

const { isMePending, isAdmin } = useAdminAccess();
const ops = useAdminOps();
const { status, statusErrorVi, isStatusLoading, isResuming, resumeErrorVi } = ops;

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

const confirmOpen = ref<boolean>(false);
const confirmErrorVi = ref<string | null>(null);
const notificationVi = ref<string | null>(null);

function openConfirm(): void {
  confirmErrorVi.value = null;
  confirmOpen.value = true;
}

function closeConfirm(): void {
  if (isResuming.value) return;
  confirmOpen.value = false;
}

async function runConfirm(): Promise<void> {
  if (isResuming.value) return;
  confirmErrorVi.value = null;
  const ok = await ops.resumeIntake();
  if (!ok) {
    confirmErrorVi.value = resumeErrorVi.value;
    return;
  }
  notificationVi.value = 'Đã mở lại nhận Task mới.';
  confirmOpen.value = false;
}

function start(): void {
  void ops.refreshStatus();
  ops.startStatusPolling();
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
</script>

<template>
  <div data-testid="page-admin-ops" class="space-y-8">
    <AdminAccessGate :pending="isMePending" :admin="isAdmin">
      <header class="flex flex-wrap items-end justify-between gap-4 border-b border-[#2E2E2E] pb-6">
        <div>
          <h1 :class="ui.pageTitle">Trạng thái hệ thống</h1>
          <p :class="ui.pageLead">Nhận Task, ngân sách RunningHub và sao lưu. Tự làm mới mỗi 30 giây.</p>
        </div>
        <button type="button" data-testid="ops-status-refresh" :disabled="isStatusLoading" :class="ui.btn" @click="() => ops.refreshStatus()">
          <Icon name="lucide:refresh-cw" class="h-4 w-4" :class="{ 'animate-spin': isStatusLoading }" />
          <span>Làm mới</span>
        </button>
      </header>

      <p v-if="notificationVi" data-testid="ops-notification" role="status" :class="ui.notice">{{ notificationVi }}</p>

      <section data-testid="ops-status-section" class="space-y-4">
        <p v-if="statusErrorVi" data-testid="ops-status-error" role="alert" :class="ui.error">{{ statusErrorVi }}</p>
        <p v-if="!status && !statusErrorVi" :class="ui.muted">Đang tải trạng thái...</p>

        <div v-if="status" :class="ui.tableWrap">
          <table :class="ui.table">
            <thead>
              <tr>
                <th :class="ui.th" class="w-56">Hạng mục</th>
                <th :class="ui.th">Trạng thái</th>
                <th :class="ui.th">Chi tiết</th>
              </tr>
            </thead>
            <tbody>
              <tr data-testid="ops-card-intake">
                <td :class="ui.td" class="font-medium">Nhận Task mới</td>
                <td :class="ui.td">
                  <span :class="status.intakePaused ? ui.warn : ui.ok">{{ status.intakePaused ? 'Đang tạm dừng' : 'Đang mở' }}</span>
                </td>
                <td :class="ui.td">
                  <span v-if="status.lastBreakerTrigger" class="break-words">
                    Ngắt mạch lúc {{ formatTopupTimestampVi(status.lastBreakerTrigger.at) }}: {{ status.lastBreakerTrigger.rule }}
                  </span>
                  <span v-else class="text-[#A1A1A1]">-</span>
                </td>
              </tr>
              <tr data-testid="ops-card-budget">
                <td :class="ui.td" class="font-medium">Ngân sách RunningHub</td>
                <td :class="ui.td">
                  <span :class="status.rhBudgetExhausted ? ui.bad : ui.ok">{{ status.rhBudgetExhausted ? 'Đã hết ngân sách' : 'Còn ngân sách' }}</span>
                </td>
                <td :class="ui.td">
                  <span v-if="status.rhBalance">
                    Số dư {{ formatNumberVi(status.rhBalance.coins) }} coin, đọc lúc {{ formatTopupTimestampVi(status.rhBalance.readAt) }}
                  </span>
                  <span v-else>Chưa đọc được số dư.</span>
                  <span v-if="balanceStale" data-testid="ops-balance-stale" class="mt-1 block font-medium" :class="ui.warn">
                    Dữ liệu số dư đã cũ, có thể không còn đúng.
                  </span>
                </td>
              </tr>
              <tr data-testid="ops-card-backup">
                <td :class="ui.td" class="font-medium">Sao lưu gần nhất</td>
                <td :class="ui.td">
                  <span v-if="status.lastBackup" :class="status.lastBackup.result === 'success' ? ui.ok : ui.bad">
                    {{ status.lastBackup.result === 'success' ? 'Thành công' : 'Thất bại' }}
                  </span>
                  <span v-else :class="ui.warn">Chưa có bản sao lưu</span>
                </td>
                <td :class="ui.td">
                  <span v-if="status.lastBackup">
                    {{ formatTopupTimestampVi(status.lastBackup.at) }}<span v-if="status.lastBackup.sizeBytes != null">, {{ formatNumberVi(status.lastBackup.sizeBytes) }} byte</span>
                  </span>
                  <span v-else class="text-[#A1A1A1]">-</span>
                  <span v-if="backupStale" data-testid="ops-backup-stale" class="mt-1 block font-medium" :class="ui.warn">Bản sao lưu đã cũ.</span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <div v-if="status" :class="ui.card" class="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p class="text-base font-medium text-[#EDEDED]">Mở lại nhận Task</p>
            <p :class="ui.muted">
              {{ canResume ? 'Hệ thống đang dừng nhận Task mới.' : 'Hệ thống đang nhận Task bình thường.' }}
            </p>
          </div>
          <button type="button" data-testid="ops-resume-button" :disabled="!canResume || isResuming" :class="ui.btnPrimary" @click="openConfirm">
            <Icon name="lucide:play" class="h-4 w-4" />
            <span>Mở lại nhận Task</span>
          </button>
        </div>
      </section>

      <AdminConfirmDialog
        :open="confirmOpen"
        title="Mở lại nhận Task mới?"
        :busy="isResuming"
        :error-vi="confirmErrorVi"
        @cancel="closeConfirm"
        @confirm="runConfirm"
      >
        <p class="text-[#A1A1A1]">
          Nếu nguyên nhân chưa được xử lý (ví dụ hết ngân sách RunningHub), Task mới có thể thất bại nhanh.
        </p>
        <p data-testid="ops-confirm-balance">
          Số dư RunningHub lần đọc cuối:
          {{ status?.rhBalance ? `${formatNumberVi(status.rhBalance.coins)} coin (${formatTopupTimestampVi(status.rhBalance.readAt)})` : 'chưa đọc được' }}
        </p>
      </AdminConfirmDialog>
    </AdminAccessGate>
  </div>
</template>
