<script setup lang="ts">
import { useRoute } from '#imports';

const route = useRoute();

const adminNavItems = [
  {
    to: '/admin',
    labelVi: 'Tổng quan vận hành',
    icon: 'lucide:activity',
  },
  {
    to: '/admin/topups',
    labelVi: 'Duyệt đơn VietQR',
    icon: 'lucide:receipt',
  },
  {
    to: '/pricing',
    labelVi: 'Cấu hình gói nạp',
    icon: 'lucide:credit-card',
  },
  {
    to: '/history',
    labelVi: 'Đối soát sổ cái',
    icon: 'lucide:database',
  },
  {
    to: '/',
    labelVi: 'Về Kho Công Cụ AI',
    icon: 'lucide:arrow-up-left',
  },
] as const;
</script>

<template>
  <!-- Layout Admin phong cách Vercel: nền đen #0A0A0A, viền 1px, font monospace, Left Sidebar 220px -->
  <div
    data-testid="layout-admin"
    class="flex min-h-dvh w-full max-w-[100vw] flex-col overflow-x-hidden bg-[#0A0A0A] font-mono text-cyber-text lg:flex-row"
  >
    <aside
      aria-label="Thanh điều hướng quản trị"
      data-testid="admin-left-sidebar"
      class="w-full shrink-0 border-b border-cyber-border bg-[#0A0A0A] lg:min-h-dvh lg:w-[220px] lg:border-b-0 lg:border-r"
    >
      <div class="flex h-[68px] items-center justify-between border-b border-cyber-border px-4">
        <div class="flex items-center gap-2">
          <Icon name="lucide:terminal" class="h-5 w-5 text-cyber-cyan" />
          <span class="text-sm font-bold tracking-tight text-cyber-text">
            MOTION OPS
          </span>
        </div>
        <span
          class="rounded border border-cyber-border px-1.5 py-0.5 text-[10px] text-cyber-muted"
        >
          v0.1
        </span>
      </div>

      <nav class="grid grid-cols-2 gap-1 p-2 sm:grid-cols-4 lg:grid-cols-1">
        <NuxtLink
          v-for="item in adminNavItems"
          :key="item.to"
          :to="item.to"
          class="touch-target flex min-h-[48px] min-w-[48px] items-center gap-2.5 rounded-lg px-3 py-2 text-xs transition"
          :class="
            route.path === item.to
              ? 'border border-cyber-border bg-cyber-surface text-cyber-text'
              : 'text-cyber-muted hover:bg-cyber-surface/50 hover:text-cyber-text'
          "
        >
          <Icon :name="item.icon" class="h-4 w-4 shrink-0" />
          <span class="truncate">{{ item.labelVi }}</span>
        </NuxtLink>
      </nav>
    </aside>

    <div class="flex min-w-0 flex-1 flex-col">
      <header
        class="flex h-[68px] items-center justify-between border-b border-cyber-border bg-[#0A0A0A] px-4 sm:px-6"
      >
        <div class="flex items-center gap-2 text-xs text-cyber-muted">
          <Icon name="lucide:shield-check" class="h-4 w-4 text-cyber-success" />
          <span>Bảng điều khiển quản trị viên</span>
        </div>
        <div class="flex items-center gap-2 text-xs text-cyber-cyan">
          <Icon name="lucide:cpu" class="h-4 w-4" />
          <span>2 Lane GPU • Sẵn sàng</span>
        </div>
      </header>

      <main class="flex-1 p-4 sm:p-6 lg:p-8">
        <slot />
      </main>
    </div>
  </div>
</template>
