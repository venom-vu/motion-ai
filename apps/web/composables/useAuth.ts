import { computed } from 'vue';
import { clearNuxtData, refreshNuxtData, useState } from '#imports';
import { useApiClient } from '~/composables/useApiClient';

const ME_KEY = 'motion-ai-me-profile';

// Dùng chung một lời gọi refresh đang chạy: refresh token xoay vòng sau mỗi lần dùng,
// nên hai request song song với cùng một cookie sẽ khiến request sau bị 401.
let inflight: Promise<boolean> | null = null;

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
    inflight ??= client
      .refreshSession()
      .then(async (session) => {
        setAccessToken(session.accessToken);
        await refreshNuxtData(ME_KEY);
        return true;
      })
      .catch(() => false)
      .finally(() => {
        sessionChecked.value = true;
        inflight = null;
      });
    return inflight;
  }

  async function logout(): Promise<void> {
    try {
      await client.logout();
    } finally {
      setAccessToken(null);
      sessionChecked.value = true;
      clearNuxtData(ME_KEY);
    }
  }

  return { isAuthenticated, restoreSession, logout };
}
