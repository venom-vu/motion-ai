import { computed } from 'vue';
import { useAsyncData, useState } from '#imports';
import type {
  AccountTier,
  MeResponse,
  PricingConfigResponse,
} from '@motion-ai/contracts';
import { useApiClient } from '~/composables/useApiClient';
import { resolveApiErrorMessageVi } from '~/utils/api-client';
import {
  buildAiFeatureCatalog,
  getTierCapSeconds,
  resolveTierConfig,
  type AiFeatureTool,
} from '~/utils/catalog';

function isUnauthorizedError(err: unknown): boolean {
  if (!err || typeof err !== 'object') {
    return false;
  }
  const candidate = err as {
    status?: unknown;
    statusCode?: unknown;
    code?: unknown;
    cause?: { status?: unknown; statusCode?: unknown; code?: unknown } | null;
  };
  return (
    candidate.status === 401 ||
    candidate.statusCode === 401 ||
    candidate.code === 'UNAUTHORIZED' ||
    candidate.cause?.status === 401 ||
    candidate.cause?.statusCode === 401 ||
    candidate.cause?.code === 'UNAUTHORIZED'
  );
}

export function usePricingConfig() {
  const { client } = useApiClient();
  const manualErrorVi = useState<string | null>(
    'motion-ai-manual-error-vi',
    () => null,
  );

  const pricingAsync = useAsyncData<PricingConfigResponse>(
    'motion-ai-pricing-config',
    () => client.getPricingConfig(),
  );

  const meAsync = useAsyncData<MeResponse>('motion-ai-me-profile', () =>
    client.getMe(),
  );

  const pricing = computed<PricingConfigResponse | null>(
    () => pricingAsync.data.value ?? null,
  );

  const me = computed<MeResponse | null>(() => meAsync.data.value ?? null);

  const currentTier = computed<AccountTier>(() => me.value?.tier ?? 'FREE');

  const currentTierConfig = computed(() => {
    if (!pricing.value) {
      return null;
    }
    return resolveTierConfig(pricing.value, currentTier.value);
  });

  const currentTierCapSeconds = computed<number | null>(() => {
    if (!pricing.value) {
      return null;
    }
    return getTierCapSeconds(pricing.value, currentTier.value);
  });

  const features = computed<AiFeatureTool[]>(() => {
    if (!pricing.value) {
      return [];
    }
    return buildAiFeatureCatalog(pricing.value, currentTier.value);
  });

  const isLoading = computed<boolean>(
    () =>
      pricingAsync.status.value === 'pending' ||
      meAsync.status.value === 'pending',
  );

  const errorMessageVi = computed<string | null>(() => {
    if (manualErrorVi.value) {
      return manualErrorVi.value;
    }
    if (pricingAsync.error.value) {
      return resolveApiErrorMessageVi(pricingAsync.error.value);
    }
    if (meAsync.error.value && !isUnauthorizedError(meAsync.error.value)) {
      return resolveApiErrorMessageVi(meAsync.error.value);
    }
    return null;
  });

  async function refreshAll(): Promise<void> {
    manualErrorVi.value = null;
    await Promise.all([pricingAsync.refresh(), meAsync.refresh()]);
  }

  function setErrorFromCodeOrError(input: unknown): void {
    manualErrorVi.value = resolveApiErrorMessageVi(input);
  }

  function clearError(): void {
    manualErrorVi.value = null;
  }

  return {
    pricing,
    me,
    currentTier,
    currentTierConfig,
    currentTierCapSeconds,
    features,
    isLoading,
    errorMessageVi,
    refreshAll,
    setErrorFromCodeOrError,
    clearError,
  };
}
