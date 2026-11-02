<script setup lang="ts">
import { useRoute } from '#imports';

const route = useRoute();

const bottomTabs = [
  {
    id: 'catalog',
    to: '/',
    labelVi: 'Kho AI',
    icon: 'lucide:layout-grid',
  },
  {
    id: 'history',
    to: '/history',
    labelVi: 'Lịch sử',
    icon: 'lucide:clock-3',
  },
  {
    id: 'pricing',
    to: '/pricing',
    labelVi: 'Bảng giá',
    icon: 'lucide:gem',
  },
  {
    id: 'account',
    to: '/login',
    labelVi: 'Tôi',
    icon: 'lucide:user-round',
  },
] as const;

function isTabActive(targetPath: string): boolean {
  if (targetPath === '/') {
    return route.path === '/';
  }
  return route.path.startsWith(targetPath);
}
</script>

<template>
  <nav
    aria-label="Điều hướng di động"
    data-testid="app-bottom-nav"
    class="fixed inset-x-0 bottom-0 z-40 border-t border-cyber-border bg-cyber-bg/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden"
  >
    <div class="mx-auto grid max-w-md grid-cols-4 px-2 py-1">
      <NuxtLink
        v-for="tab in bottomTabs"
        :key="tab.id"
        :to="tab.to"
        class="touch-target flex min-h-[48px] min-w-[48px] flex-col items-center justify-center gap-1 rounded-lg px-2 py-1.5 text-xs font-medium transition"
        :class="
          isTabActive(tab.to)
            ? 'text-cyber-violet'
            : 'text-cyber-muted hover:text-cyber-text'
        "
      >
        <Icon :name="tab.icon" class="h-5 w-5 shrink-0" />
        <span class="truncate">{{ tab.labelVi }}</span>
      </NuxtLink>
    </div>
  </nav>
</template>
