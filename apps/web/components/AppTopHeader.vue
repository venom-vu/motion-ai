<script setup lang="ts">
import { computed } from "vue";
import { useRoute } from "#imports";
import type { AccountTier, UserRole } from "@motion-ai/contracts";
import { useAuthDialog } from "~/composables/useAuthDialog";
import { formatNumberVi } from "~/utils/catalog";

const props = withDefaults(
  defineProps<{
    balance?: number | null;
    held?: number | null;
    tier?: AccountTier | null;
    email?: string | null;
    role?: UserRole | null;
  }>(),
  {
    balance: null,
    held: null,
    tier: null,
    email: null,
    role: null,
  },
);

const route = useRoute();
const { open: openAuthDialog } = useAuthDialog();

const baseNavItems = [
  {
    to: "/",
    labelVi: "Kho Công Cụ AI",
    icon: "lucide:layout-grid",
  },
] as const;

const navItems = computed(() => {
  if (props.role === "admin") {
    return [
      ...baseNavItems,
      {
        to: "/admin",
        labelVi: "Quản Trị",
        icon: "lucide:terminal",
      },
    ];
  }
  return baseNavItems;
});

const isLoggedIn = computed<boolean>(() => Boolean(props.email));

const formattedBalance = computed<string>(() => {
  if (typeof props.balance !== "number" || !Number.isFinite(props.balance)) {
    return "---";
  }
  return formatNumberVi(props.balance);
});

const tierLabel = computed<string>(() => props.tier ?? "FREE");

function openLogin(): void {
  openAuthDialog("login");
}

function isActiveRoute(targetPath: string): boolean {
  if (targetPath === "/") {
    return route.path === "/";
  }
  return route.path.startsWith(targetPath);
}
</script>

<template>
  <header
    data-testid="app-top-header"
    class="fixed inset-x-0 top-0 z-40 h-[68px] w-full border-b border-cyber-border bg-cyber-bg/95 backdrop-blur"
  >
    <div
      class="mx-auto flex h-full max-w-7xl items-center gap-2 px-3 sm:gap-6 sm:px-6 lg:px-8"
    >
      <NuxtLink
        to="/"
        aria-label="Trang chủ flowvis"
        class="touch-target inline-flex min-h-[48px] min-w-[48px] items-center gap-2.5 rounded-lg px-2 text-cyber-text transition hover:text-cyber-violet"
      >
        <span class="font-display text-3xl font-bold tracking-tight">
          flowvis
        </span>
      </NuxtLink>

      <!-- Điều hướng Desktop (>= 1024px): Không dùng Sidebar trái -->
      <nav
        aria-label="Điều hướng chính trên máy tính"
        class="hidden items-center gap-1 lg:flex"
      >
        <NuxtLink
          v-for="item in navItems"
          :key="item.to"
          :to="item.to"
          class="touch-target inline-flex min-h-[48px] min-w-[48px] items-center gap-2 rounded-lg px-3.5 py-2 text-sm font-medium transition"
          :class="
            isActiveRoute(item.to)
              ? 'bg-cyber-surface text-cyber-text border border-cyber-violet/60'
              : 'text-cyber-muted hover:bg-cyber-surface/60 hover:text-cyber-text'
          "
        >
          <Icon :name="item.icon" class="h-4 w-4 shrink-0" />
          <span>{{ item.labelVi }}</span>
        </NuxtLink>
      </nav>

      <!-- Khách: Bảng giá. Đã đăng nhập: số dư credit, Nạp Credit và avatar -->
      <div class="ml-auto flex items-center gap-2">
        <NuxtLink
          v-if="!isLoggedIn"
          to="/pricing"
          data-testid="pricing-link"
          class="touch-target hidden min-h-[48px] min-w-[48px] items-center rounded-lg px-3 text-sm font-medium transition sm:inline-flex"
          :class="
            isActiveRoute('/pricing')
              ? 'text-cyber-text'
              : 'text-cyber-muted hover:text-cyber-text'
          "
        >
          Bảng giá
        </NuxtLink>

        <NuxtLink
          v-if="isLoggedIn"
          to="/pricing"
          data-testid="credit-badge"
          class="touch-target inline-flex min-h-[48px] min-w-[48px] items-center gap-2 rounded-xl border border-cyber-cyan/40 bg-cyber-surface px-3 py-2 text-xs transition hover:border-cyber-cyan"
        >
          <Icon name="lucide:coins" class="h-4 w-4 shrink-0 text-cyber-cyan" />
          <div class="flex flex-col text-left leading-tight">
            <span class="font-mono text-xs font-semibold text-cyber-cyan">
              {{ formattedBalance }} CR
            </span>
            <span class="font-mono text-[10px] text-cyber-muted">
              Hạng {{ tierLabel }}
            </span>
          </div>
        </NuxtLink>

        <NuxtLink
          v-if="isLoggedIn"
          to="/pricing"
          data-testid="topup-link"
          class="touch-target hidden min-h-[48px] min-w-[48px] items-center gap-1.5 rounded-xl bg-cyber-violet px-4 py-2.5 text-xs font-semibold text-cyber-text transition hover:bg-cyber-violet/90 sm:inline-flex"
        >
          <Icon name="lucide:plus-circle" class="h-4 w-4 shrink-0" />
          <span>Nạp Credit</span>
        </NuxtLink>

        <AccountPopover v-if="isLoggedIn" :email="email" />

        <button
          v-else
          type="button"
          data-testid="login-button"
          aria-label="Đăng nhập tài khoản"
          class="touch-target inline-flex min-h-[48px] min-w-[48px] items-center justify-center gap-2 rounded-xl border border-cyber-border bg-cyber-surface px-4 py-2 text-xs font-medium text-cyber-text transition hover:border-cyber-violet"
          @click="openLogin"
        >
          <Icon
            name="lucide:log-in"
            class="h-4 w-4 shrink-0 text-cyber-violet"
          />
          <span>Đăng nhập</span>
        </button>
      </div>
    </div>
  </header>
</template>
