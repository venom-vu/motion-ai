<script setup lang="ts">
import { computed, watch } from 'vue';
import { navigateTo, useRoute, useRouter, useState } from '#imports';
import { TOS_VERSION } from '@motion-ai/contracts';
import { usePricingConfig } from '~/composables/usePricingConfig';
import { resolveApiErrorMessageVi } from '~/utils/api-client';
import { formatNumberVi } from '~/utils/catalog';

const route = useRoute();
const router = useRouter();
const { pricing, me } = usePricingConfig();

const authErrorVi = computed<string | null>(() => {
  const err = route.query.authError;
  return typeof err === 'string' && err ? resolveApiErrorMessageVi(err) : null;
});

// Giữ thông báo lỗi sau khi xóa query khỏi URL.
const shownErrorVi = useState<string | null>('motion-ai-login-error', () => null);
shownErrorVi.value = authErrorVi.value;

watch(
  me,
  (next) => {
    if (next) {
      void navigateTo('/', { replace: true });
    }
  },
  { immediate: true },
);

if (import.meta.client && route.query.authError) {
  void router.replace({ path: route.path, query: {} });
}
</script>

<template>
  <div class="mx-auto w-full max-w-md py-8" data-testid="page-login">
    <section
      class="rounded-2xl border border-cyber-border bg-cyber-surface p-6 text-cyber-text"
    >
      <div class="flex items-center gap-3">
        <span
          class="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-cyber-violet/40 bg-cyber-violet/15 text-cyber-violet"
        >
          <Icon name="lucide:shield-check" class="h-6 w-6" />
        </span>
        <div>
          <h1 class="font-display text-xl font-bold">Đăng Nhập</h1>
          <p class="text-xs text-cyber-muted">
            Điều khoản phiên bản
            <span class="font-mono text-cyber-cyan">{{ TOS_VERSION }}</span>
          </p>
        </div>
      </div>

      <p v-if="pricing" class="mt-4 text-sm text-cyber-muted">
        Tài khoản đăng ký lần đầu được tặng
        <span class="font-mono font-semibold text-cyber-cyan">
          {{ formatNumberVi(pricing.trialGrantCredits) }} credit
        </span>
        dùng thử.
      </p>

      <div class="mt-5">
        <LoginConsentForm id-prefix="page" :initial-error-vi="shownErrorVi" />
      </div>
    </section>
  </div>
</template>
