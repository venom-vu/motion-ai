<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from "vue";
import { navigateTo, useRoute } from "#imports";
import { useAuth } from "~/composables/useAuth";
// import { useAuthDialog } from "~/composables/useAuthDialog";

withDefaults(
  defineProps<{
    email?: string | null;
  }>(),
  { email: null },
);

const route = useRoute();
const { logout } = useAuth();
// const { open: openAuthDialog } = useAuthDialog();

const isOpen = ref(false);
const rootEl = ref<HTMLElement | null>(null);
const triggerEl = ref<HTMLButtonElement | null>(null);

function toggle(): void {
  isOpen.value = !isOpen.value;
}

function close(restoreFocus = false): void {
  isOpen.value = false;
  if (restoreFocus) {
    triggerEl.value?.focus();
  }
}

function handleOutsidePointer(event: PointerEvent): void {
  if (!isOpen.value) return;
  const target = event.target;
  if (
    rootEl.value &&
    target instanceof Node &&
    !rootEl.value.contains(target)
  ) {
    close();
  }
}

function handleKeydown(event: KeyboardEvent): void {
  if (isOpen.value && event.key === "Escape") {
    close(true);
  }
}

// function showAccountInfo(): void {
//   close();
//   openAuthDialog("account");
// }

function goToHistory(): void {
  close();
  void navigateTo("/history");
}

function goToTasks(): void {
  close();
  void navigateTo("/tasks");
}

async function handleLogout(): Promise<void> {
  close();
  await logout();
}

// Đổi trang thì đóng popover.
watch(
  () => route.path,
  () => close(),
);

onMounted(() => {
  document.addEventListener("pointerdown", handleOutsidePointer);
  document.addEventListener("keydown", handleKeydown);
});

onBeforeUnmount(() => {
  document.removeEventListener("pointerdown", handleOutsidePointer);
  document.removeEventListener("keydown", handleKeydown);
});
</script>

<template>
  <div ref="rootEl" class="relative" data-testid="account-popover">
    <button
      ref="triggerEl"
      type="button"
      data-testid="account-button"
      aria-haspopup="menu"
      :aria-expanded="isOpen"
      :aria-label="email ? `Tài khoản ${email}` : 'Tài khoản'"
      class="touch-target inline-flex h-12 w-12 min-h-[48px] min-w-[48px] items-center justify-center rounded-full border border-cyber-violet/50 bg-cyber-violet/15 text-cyber-violet transition hover:border-cyber-violet"
      :class="isOpen ? 'border-cyber-violet' : ''"
      @click="toggle"
    >
      <Icon name="lucide:user-round" class="h-5 w-5 shrink-0" />
    </button>

    <div
      v-if="isOpen"
      role="menu"
      data-testid="account-menu"
      aria-label="Menu tài khoản"
      class="absolute right-0 top-full z-50 mt-2 w-64 overflow-hidden rounded-2xl border border-cyber-border bg-cyber-surface p-1.5 text-cyber-text shadow-2xl"
    >
      <p
        v-if="email"
        class="truncate border-b border-cyber-border px-3 pb-2.5 pt-2 font-mono text-xs text-cyber-muted"
      >
        {{ email }}
      </p>

      <!-- <button
        type="button"
        role="menuitem"
        data-testid="menu-account-info"
        class="touch-target mt-1 flex min-h-[48px] w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-sm transition hover:bg-cyber-bg"
        @click="showAccountInfo"
      >
        <Icon name="lucide:user-round" class="h-4 w-4 shrink-0 text-cyber-violet" />
        <span>Thông tin tài khoản</span>
      </button> -->

      <button
        type="button"
        role="menuitem"
        data-testid="menu-tasks"
        class="touch-target flex min-h-[48px] w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-sm transition hover:bg-cyber-bg"
        @click="goToTasks"
      >
        <Icon
          name="lucide:history"
          class="h-4 w-4 shrink-0 text-cyber-violet"
        />
        <span>Lịch sử tác vụ</span>
      </button>

      <button
        type="button"
        role="menuitem"
        data-testid="menu-history"
        class="touch-target flex min-h-[48px] w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-sm transition hover:bg-cyber-bg"
        @click="goToHistory"
      >
        <Icon
          name="lucide:clock-3"
          class="h-4 w-4 shrink-0 text-cyber-violet"
        />
        <span>Biến động credit</span>
      </button>

      <button
        type="button"
        role="menuitem"
        data-testid="logout-button"
        class="touch-target flex min-h-[48px] w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-sm transition hover:bg-cyber-bg hover:text-cyber-danger"
        @click="handleLogout"
      >
        <Icon name="lucide:log-out" class="h-4 w-4 shrink-0" />
        <span>Đăng xuất</span>
      </button>
    </div>
  </div>
</template>
