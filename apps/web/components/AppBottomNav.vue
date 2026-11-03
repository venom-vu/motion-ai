<script setup lang="ts">
import { navigateTo, useRoute } from '#imports';
import { useAuthDialog } from '~/composables/useAuthDialog';
import { usePricingConfig } from '~/composables/usePricingConfig';

const route = useRoute();
const { open: openAuthDialog } = useAuthDialog();
const { me } = usePricingConfig();

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
] as const;

function handleAccountClick(): void {
  if (me.value) {
    openAuthDialog('account');
  } else {
    void navigateTo('/login');
  }
}

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
      <button
        type="button"
        data-testid="bottom-account-tab"
        class="touch-target flex min-h-[48px] min-w-[48px] flex-col items-center justify-center gap-1 rounded-lg px-2 py-1.5 text-xs font-medium text-cyber-muted transition hover:text-cyber-text"
        @click="handleAccountClick"
      >
        <Icon name="lucide:user-round" class="h-5 w-5 shrink-0" />
        <span class="truncate">Tôi</span>
      </button>
    </div>
  </nav>
</template>
