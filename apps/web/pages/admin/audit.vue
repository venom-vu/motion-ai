<script setup lang="ts">
import { onMounted, watch } from 'vue';
import { definePageMeta } from '#imports';
import { useAdminAccess } from '~/composables/useAdminAccess';
import { useAdminOps } from '~/composables/useAdminOps';
import { useCursorPager } from '~/composables/useCursorPager';
import { formatTopupTimestampVi } from '~/utils/topup';
import { ui } from '~/utils/admin-ui';

definePageMeta({ layout: 'admin' });

const { isMePending, isAdmin } = useAdminAccess();
const ops = useAdminOps();
const { auditItems, auditAction, auditTarget, auditHasMore, isAuditLoading, isAuditLoadingMore, auditErrorVi } = ops;
const pager = useCursorPager(auditItems, auditHasMore, () => ops.fetchAudit(false));

async function applyFilter(): Promise<void> {
  pager.reset();
  await ops.fetchAudit(true);
}

onMounted(() => {
  if (isAdmin.value) void applyFilter();
});
watch(isAdmin, (admin) => {
  if (admin && auditItems.value.length === 0) void applyFilter();
});
</script>

<template>
  <div data-testid="page-admin-audit" class="space-y-8">
    <AdminAccessGate :pending="isMePending" :admin="isAdmin">
      <header class="border-b border-[#2E2E2E] pb-6">
        <h1 :class="ui.pageTitle">Nhật ký Admin</h1>
        <p :class="ui.pageLead">Mọi thao tác của quản trị viên: duyệt đơn, điều chỉnh credit, khóa tài khoản, gỡ nội dung.</p>
      </header>

      <section data-testid="ops-audit-section" class="space-y-4">
        <form class="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_1fr_auto]" @submit.prevent="applyFilter">
          <BaseInput v-model="auditAction" variant="admin" data-testid="ops-audit-action" placeholder="Lọc theo action (ví dụ ADJUST)" aria-label="Lọc theo action" />
          <BaseInput v-model="auditTarget" variant="admin" data-testid="ops-audit-target" placeholder="Lọc theo target" aria-label="Lọc theo target" />
          <button type="submit" data-testid="ops-audit-filter" :disabled="isAuditLoading" :class="ui.btnPrimary">
            <Icon name="lucide:filter" class="h-4 w-4 shrink-0" /><span>Lọc</span>
          </button>
        </form>

        <p v-if="auditErrorVi" data-testid="ops-audit-error" role="alert" :class="ui.error">{{ auditErrorVi }}</p>
        <p v-if="isAuditLoading" :class="ui.muted">Đang tải nhật ký...</p>
        <p v-else-if="auditItems.length === 0 && !auditErrorVi" :class="ui.muted">Chưa có bản ghi.</p>

        <template v-if="auditItems.length > 0">
          <div :class="ui.tableWrap">
            <table :class="ui.table" data-testid="ops-audit-list">
              <thead>
                <tr><th :class="ui.th">Thời gian</th><th :class="ui.th">Action</th><th :class="ui.th">Target</th><th :class="ui.th">Lý do</th></tr>
              </thead>
              <tbody>
                <tr v-for="a in pager.pageItems.value" :key="a.id">
                  <td :class="ui.td" class="whitespace-nowrap">{{ formatTopupTimestampVi(a.createdAt) }}</td>
                  <td :class="ui.td" class="font-medium">{{ a.action }}</td>
                  <td :class="ui.td" class="break-all font-geist-mono">{{ a.target }}</td>
                  <td :class="ui.td" class="break-words">{{ a.reason || '-' }}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <AdminPager
            :page="pager.page.value"
            :page-count="pager.pageCount.value"
            :has-more="auditHasMore"
            :can-prev="pager.canPrev.value"
            :can-next="pager.canNext.value"
            :loading="isAuditLoadingMore || pager.isPaging.value"
            @prev="pager.prev"
            @next="pager.next"
          />
        </template>
      </section>
    </AdminAccessGate>
  </div>
</template>
