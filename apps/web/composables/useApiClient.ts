import { useRuntimeConfig, useState } from '#imports';
import { createMotionApiClient, type MotionApiClient } from '~/utils/api-client';

export function useApiClient(): {
  client: MotionApiClient;
  accessToken: ReturnType<typeof useState<string | null>>;
  setAccessToken: (token: string | null) => void;
} {
  const runtimeConfig = useRuntimeConfig();
  const accessToken = useState<string | null>(
    'motion-ai-access-token',
    () => null,
  );

  const baseUrl = String(
    runtimeConfig.public.apiBaseUrl || 'http://localhost:8080',
  );

  const client = createMotionApiClient({
    baseUrl,
    getAccessToken: () => accessToken.value,
  });

  function setAccessToken(token: string | null): void {
    accessToken.value = token;
  }

  return { client, accessToken, setAccessToken };
}
