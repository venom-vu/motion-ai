import { clearNuxtData, navigateTo, useNuxtApp, useRuntimeConfig, useState } from '#imports';
import {
  createRefreshCoordinator,
  createSessionLostHandler,
  createUnauthorizedHandler,
} from '~/utils/auth-session';
import { createMotionApiClient, type MotionApiClient } from '~/utils/api-client';

export { refreshShared };
export const ME_KEY = 'flowvis-me-profile';

const refreshShared = createRefreshCoordinator();

export function useApiClient(): {
  client: MotionApiClient;
  accessToken: ReturnType<typeof useState<string | null>>;
  setAccessToken: (token: string | null) => void;
} {
  const runtimeConfig = useRuntimeConfig();
  const nuxtApp = useNuxtApp();
  const accessToken = useState<string | null>(
    'flowvis-access-token',
    () => null,
  );
  const sessionChecked = useState<boolean>(
    'flowvis-session-checked',
    () => false,
  );

  const baseUrl = String(
    runtimeConfig.public.apiBaseUrl || 'http://localhost:8080',
  );

  function setAccessToken(token: string | null): void {
    accessToken.value = token;
  }

  const client: MotionApiClient = createMotionApiClient({
    baseUrl,
    getAccessToken: () => accessToken.value,
    onUnauthorized: createUnauthorizedHandler({
      getToken: () => accessToken.value,
      setToken: setAccessToken,
      refresh: () => client.refreshSession(),
      refreshShared,
      isServer: import.meta.server,
      // Khách xem công khai (chưa có token) giữ nguyên trang.
      onSessionLost: createSessionLostHandler({
        markChecked: () => {
          sessionChecked.value = true;
        },
        clearData: () => clearNuxtData(ME_KEY),
        navigate: (path) =>
          nuxtApp.runWithContext(() => navigateTo(path, { replace: true })),
      }),
    }),
  });

  return { client, accessToken, setAccessToken };
}
