<script setup lang="ts">
import { definePageMeta } from '#imports';

definePageMeta({
  layout: 'admin',
});

const technicalMetrics = [
  {
    id: 'gpu-lanes',
    labelVi: 'Luồng xử lý GPU',
    value: '2 / 2',
    noteVi: 'RunningHub sẵn sàng',
    icon: 'lucide:cpu',
  },
  {
    id: 'queue-depth',
    labelVi: 'Hàng đợi tác vụ',
    value: '0',
    noteVi: 'Ưu tiên theo Tier Snapshot',
    icon: 'lucide:list-ordered',
  },
  {
    id: 'pending-topups',
    labelVi: 'Đơn VietQR chờ duyệt',
    value: '2',
    noteVi: 'Cần đối chiếu bank_ref',
    icon: 'lucide:receipt',
  },
  {
    id: 'ledger-audit',
    labelVi: 'Đối soát sổ cái',
    value: 'KHỚP 100%',
    noteVi: 'balance = SUM(amount)',
    icon: 'lucide:shield-check',
  },
] as const;

const mockPendingTopups = [
  {
    id: 'TOPUP-001',
    email: 'creator@motion.ai.vn',
    packName: 'Pro',
    amountVnd: '99.000đ',
    credits: '12.000 CR',
    bankRef: 'VCB99283741',
    createdAtVi: '01/11/2026 10:20',
  },
  {
    id: 'TOPUP-002',
    email: 'studio@motion.ai.vn',
    packName: 'Creator',
    amountVnd: '199.000đ',
    credits: '30.000 CR',
    bankRef: 'TCB88371625',
    createdAtVi: '01/11/2026 10:42',
  },
] as const;
</script>

<template>
  <div class="space-y-6 font-mono" data-testid="page-admin">
    <div class="space-y-1">
      <h1 class="text-xl font-bold text-cyber-text">
        TRUNG TÂM VẬN HÀNH & ĐỐI SOÁT HỆ THỐNG
      </h1>
      <p class="text-xs text-cyber-muted">
        Giao diện quản trị kỹ thuật phong cách tối giản • Chỉ dành cho quản trị viên.
      </p>
    </div>

    <!-- 4 ô chỉ số kỹ thuật -->
    <section
      aria-label="Chỉ số kỹ thuật hệ thống"
      class="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4"
    >
      <div
        v-for="metric in technicalMetrics"
        :key="metric.id"
        class="rounded-xl border border-cyber-border bg-cyber-surface/40 p-4"
      >
        <div class="flex items-center justify-between text-xs text-cyber-muted">
          <span>{{ metric.labelVi }}</span>
          <Icon :name="metric.icon" class="h-4 w-4 text-cyber-cyan" />
        </div>
        <p class="mt-2 text-2xl font-bold text-cyber-text">
          {{ metric.value }}
        </p>
        <p class="mt-1 text-[11px] text-cyber-muted">
          {{ metric.noteVi }}
        </p>
      </div>
    </section>

    <!-- Bảng duyệt đơn bank_ref đa cột -->
    <section
      aria-label="Bảng duyệt đơn nạp tiền"
      class="overflow-x-auto rounded-xl border border-cyber-border bg-cyber-surface/30"
    >
      <div class="border-b border-cyber-border px-4 py-3 text-xs font-bold text-cyber-text">
        DANH SÁCH ĐƠN NẠP CHỜ DUYỆT (BANK_REF)
      </div>

      <table class="w-full min-w-[640px] border-collapse text-left text-xs">
        <thead>
          <tr class="border-b border-cyber-border text-cyber-muted">
            <th class="px-4 py-3">Mã đơn</th>
            <th class="px-4 py-3">Tài khoản</th>
            <th class="px-4 py-3">Gói</th>
            <th class="px-4 py-3">Số tiền</th>
            <th class="px-4 py-3">Mã tham chiếu (bank_ref)</th>
            <th class="px-4 py-3 text-right">Thao tác</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-cyber-border">
          <tr v-for="order in mockPendingTopups" :key="order.id">
            <td class="px-4 py-3 font-semibold text-cyber-text">
              {{ order.id }}
            </td>
            <td class="px-4 py-3 text-cyber-muted">
              {{ order.email }}
            </td>
            <td class="px-4 py-3 text-cyber-cyan">
              {{ order.packName }} ({{ order.credits }})
            </td>
            <td class="px-4 py-3 text-cyber-text">
              {{ order.amountVnd }}
            </td>
            <td class="px-4 py-3 text-cyber-success">
              {{ order.bankRef }}
            </td>
            <td class="px-4 py-3 text-right">
              <button
                type="button"
                class="touch-target inline-flex min-h-[48px] min-w-[48px] items-center justify-center gap-1.5 rounded-lg border border-cyber-border bg-cyber-surface px-3 py-2 text-xs text-cyber-text transition hover:border-cyber-cyan"
              >
                <Icon name="lucide:check-circle-2" class="h-4 w-4 text-cyber-success" />
                <span>Xác nhận</span>
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </section>
  </div>
</template>
