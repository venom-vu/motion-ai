import { useRuntimeConfig, useState } from '#imports';
import {
  createMotionApiClient,
  type ApiMode,
  type MotionApiClient,
  type MotionApiMockOverrides,
} from '~/utils/api-client';

export function useApiClient(overrides?: MotionApiMockOverrides): {
  client: MotionApiClient;
  apiMode: ApiMode;
  accessToken: ReturnType<typeof useState<string | null>>;
  setAccessToken: (token: string | null) => void;
} {
  const runtimeConfig = useRuntimeConfig();
  const accessToken = useState<string | null>(
    'motion-ai-access-token',
    () => null,
  );

  const rawMode = String(runtimeConfig.public.apiMode || 'mock').toLowerCase();
  const apiMode: ApiMode = rawMode === 'live' ? 'live' : 'mock';
  const baseUrl = String(
    runtimeConfig.public.apiBaseUrl || 'http://localhost:3001',
  );

  const client = createMotionApiClient({
    mode: apiMode,
    baseUrl,
    getAccessToken: () => accessToken.value,
    mockOverrides: overrides,
  });

  function setAccessToken(token: string | null): void {
    accessToken.value = token;
  }

  return {
    client,
    apiMode,
    accessToken,
    setAccessToken,
  };
}
