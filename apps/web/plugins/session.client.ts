import { defineNuxtPlugin } from '#imports';
import { useAuth } from '~/composables/useAuth';

// Khôi phục phiên sau khi tải trang (access token chỉ nằm trong bộ nhớ).
// Chạy sau khi mount để không chặn hydrate; /auth/callback tự xử lý phiên của nó.
export default defineNuxtPlugin((nuxtApp) => {
  nuxtApp.hook('app:mounted', async () => {
    if (window.location.pathname === '/auth/callback') {
      return;
    }
    await useAuth().restoreSession();
  });
});
