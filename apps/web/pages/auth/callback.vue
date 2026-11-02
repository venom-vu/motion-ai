<script setup lang="ts">
import { onMounted } from 'vue';
import { navigateTo } from '#imports';
import { useAuth } from '~/composables/useAuth';

const { restoreSession } = useAuth();

// BE đã đặt cookie refresh httpOnly trước khi redirect về đây; đổi cookie lấy access token.
onMounted(async () => {
  const ok = await restoreSession();
  await navigateTo(ok ? '/' : { path: '/', query: { authError: 'UNAUTHORIZED' } }, {
    replace: true,
  });
});
</script>

<template>
  <div class="mx-auto max-w-xl py-16 text-center" data-testid="page-auth-callback">
    <p class="text-sm text-cyber-muted">Đang hoàn tất đăng nhập...</p>
  </div>
</template>
