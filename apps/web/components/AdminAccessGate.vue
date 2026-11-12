<script setup lang="ts">
import { useAuthDialog } from '~/composables/useAuthDialog';
import { ui } from '~/utils/admin-ui';

defineProps<{ pending: boolean; admin: boolean }>();

const { open: openAuthDialog } = useAuthDialog();
</script>

<template>
  <!-- Chờ kiểm tra phiên xong mới quyết định, tránh nhấp nháy 403 -->
  <section
    v-if="pending"
    data-testid="admin-auth-loading-state"
    class="flex min-h-[320px] flex-col items-center justify-center gap-3 text-center"
  >
    <Icon name="lucide:loader-2" class="h-6 w-6 animate-spin text-[#A1A1A1]" />
    <p :class="ui.muted">Đang kiểm tra quyền quản trị viên...</p>
  </section>

  <section
    v-else-if="!admin"
    data-testid="admin-forbidden-state"
    class="flex min-h-[320px] flex-col items-center justify-center text-center"
  >
    <h1 class="text-2xl font-semibold tracking-tight text-[#EDEDED]">403 — Truy cập bị từ chối</h1>
    <p class="mt-2 max-w-md text-base text-[#A1A1A1]">
      Trang này chỉ dành cho Quản trị viên (Admin).
    </p>
    <div class="mt-6 flex flex-wrap items-center justify-center gap-3">
      <button
        type="button"
        data-testid="admin-forbidden-login-button"
        :class="ui.btnPrimary"
        @click="() => openAuthDialog('login')"
      >
        <Icon name="lucide:log-in" class="h-4 w-4" />
        <span>Đăng nhập</span>
      </button>
      <NuxtLink to="/" :class="ui.btn">
        <Icon name="lucide:arrow-left" class="h-4 w-4" />
        <span>Về trang chủ</span>
      </NuxtLink>
    </div>
  </section>

  <slot v-else />
</template>
