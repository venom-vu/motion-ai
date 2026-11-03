import { computed } from 'vue';
import { clearNuxtData, navigateTo, refreshNuxtData, useState } from '#imports';
import { runLogout } from '~/utils/auth-session';
import {
  ME_KEY,
  refreshShared,
  useApiClient,
} from '~/composables/useApiClient';

let restoring: Promise<boolean> | null = null;

export function useAuth() {
  const { client, accessToken, setAccessToken } = useApiClient();
  const sessionChecked = useState<boolean>(
    'motion-ai-session-checked',
    () => false,
  );

  const isAuthenticated = computed<boolean>(() => Boolean(accessToken.value));

  /** Đổi cookie refresh httpOnly lấy access token (lưu trong bộ nhớ). Trả về true nếu có phiên. */
  async function restoreSession(): Promise<boolean> {
    if (accessToken.value) {
      return true;
    }
    if (sessionChecked.value) {
      return false;
    }
    restoring ??= refreshShared(
      () => client.refreshSession(),
      setAccessToken,
    )
      .then(async (ok) => {
        if (ok) {
          await refreshNuxtData(ME_KEY);
        }
        return ok;
      })
      .finally(() => {
        sessionChecked.value = true;
        restoring = null;
      });
    return restoring;
  }

  function logout(): Promise<void> {
    return runLogout({
      apiLogout: () => client.logout(),
      clearSession: () => {
        setAccessToken(null);
        sessionChecked.value = true;
        clearNuxtData(ME_KEY);
      },
      navigate: () => navigateTo('/login', { replace: true }),
    });
  }

  return { isAuthenticated, restoreSession, logout };
}
