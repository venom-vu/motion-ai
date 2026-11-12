<script setup lang="ts">
import { computed, ref } from 'vue';
import { definePageMeta } from '#imports';
import { useAdminAccess } from '~/composables/useAdminAccess';
import { isTaskFinished, useAdminOps } from '~/composables/useAdminOps';
import { formatTopupTimestampVi } from '~/utils/topup';
import { ui } from '~/utils/admin-ui';

definePageMeta({ layout: 'admin' });

const { isMePending, isAdmin } = useAdminAccess();
const ops = useAdminOps();
const { task, taskErrorVi, isTaskLoading, isTakedownLoading, takedownErrorVi } = ops;

const lookupInput = ref<string>('');
const takedownReason = ref<string>('');
const takedownReasonErrorVi = ref<string | null>(null);
const confirmOpen = ref<boolean>(false);
const confirmErrorVi = ref<string | null>(null);
const notificationVi = ref<string | null>(null);

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
  confirmOpen.value = true;
}

function closeConfirm(): void {
  if (isTakedownLoading.value) return;
  confirmOpen.value = false;
}

async function runConfirm(): Promise<void> {
  if (isTakedownLoading.value) return;
  confirmErrorVi.value = null;
  const ok = await ops.takedown(takedownReason.value);
  if (!ok) {
    confirmErrorVi.value = takedownErrorVi.value;
    return;
  }
  notificationVi.value = 'Đã gỡ nội dung của Task.';
  takedownReason.value = '';
  confirmOpen.value = false;
}
</script>

<template>
  <div data-testid="page-admin-takedown" class="space-y-8">
    <AdminAccessGate :pending="isMePending" :admin="isAdmin">
      <header class="border-b border-[#2E2E2E] pb-6">
        <h1 :class="ui.pageTitle">Gỡ nội dung vi phạm</h1>
        <p :class="ui.pageLead">Tra cứu Task theo mã hoặc liên kết chia sẻ, rồi xóa tệp kết quả và thu hồi liên kết.</p>
      </header>

      <p v-if="notificationVi" data-testid="ops-notification" role="status" :class="ui.notice">{{ notificationVi }}</p>

      <section data-testid="ops-takedown-section" class="space-y-6">
        <form class="flex flex-col gap-3 sm:flex-row sm:items-stretch" @submit.prevent="() => ops.lookupTask(lookupInput)">
          <BaseInput
            v-model="lookupInput"
            variant="admin"
            class="flex-1"
            data-testid="ops-task-input"
            placeholder="Mã Task hoặc liên kết chia sẻ"
            aria-label="Mã Task hoặc liên kết chia sẻ"
          />
          <button type="submit" data-testid="ops-task-lookup" :disabled="isTaskLoading" :class="ui.btnPrimary">
            <Icon name="lucide:search" class="h-4 w-4 shrink-0" /><span>Tra cứu</span>
          </button>
        </form>
        <p v-if="taskErrorVi" data-testid="ops-task-error" role="alert" :class="ui.error">{{ taskErrorVi }}</p>

        <template v-if="task">
          <div :class="ui.tableWrap" data-testid="ops-task-detail">
            <table :class="ui.table">
              <thead>
                <tr><th :class="ui.th">Task</th><th :class="ui.th">Pipeline</th><th :class="ui.th">Trạng thái</th><th :class="ui.th">Chủ Task</th><th :class="ui.th">Đã gỡ lúc</th></tr>
              </thead>
              <tbody>
                <tr>
                  <td :class="ui.td" class="break-all font-geist-mono">{{ task.id }}</td>
                  <td :class="ui.td">{{ task.pipeline }}</td>
                  <td :class="ui.td">{{ task.status }}</td>
                  <td :class="ui.td" class="break-all">{{ task.userEmail }}</td>
                  <td :class="ui.td" data-testid="ops-task-removed">{{ task.filesRemovedAt ? formatTopupTimestampVi(task.filesRemovedAt) : 'Chưa gỡ' }}</td>
                </tr>
              </tbody>
            </table>
          </div>

          <div :class="ui.card" class="space-y-4">
            <p v-if="!task.filesRemovedAt" :class="ui.muted">Token chia sẻ sẽ bị thu hồi khi gỡ.</p>
            <label :class="ui.label">
              <span>Lý do gỡ</span>
              <BaseInput v-model="takedownReason" variant="admin" maxlength="500" data-testid="ops-takedown-reason" />
            </label>
            <p v-if="takedownReasonErrorVi" data-testid="ops-takedown-reason-error" role="alert" :class="ui.error">{{ takedownReasonErrorVi }}</p>
            <button type="button" data-testid="ops-takedown-button" :disabled="!canTakedown || isTakedownLoading" :class="ui.btnDanger" @click="requestTakedown">
              <Icon name="lucide:trash-2" class="h-4 w-4" /><span>Gỡ bỏ ngay</span>
            </button>
            <p v-if="!taskFinished" data-testid="ops-takedown-unfinished" :class="ui.warn" class="text-sm">
              Task chưa kết thúc (đang chờ hoặc đang chạy) nên chưa thể gỡ nội dung.
            </p>
            <p v-else-if="task.filesRemovedAt" :class="ui.muted">Nội dung của Task này đã được gỡ.</p>
          </div>
        </template>
      </section>

      <AdminConfirmDialog
        :open="confirmOpen"
        title="Gỡ bỏ nội dung của Task?"
        :busy="isTakedownLoading"
        :error-vi="confirmErrorVi"
        @cancel="closeConfirm"
        @confirm="runConfirm"
      >
        <p class="text-[#A1A1A1]">Tệp trên R2 sẽ bị xóa và token chia sẻ bị thu hồi. Không thể hoàn tác.</p>
        <p class="break-words">Lý do: {{ takedownReason }}</p>
      </AdminConfirmDialog>
    </AdminAccessGate>
  </div>
</template>
