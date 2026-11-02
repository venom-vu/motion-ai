<script setup lang="ts">
import { computed } from 'vue';
import { useAsyncData } from '#imports';
import type { WalletLedgerResponse } from '@motion-ai/contracts';
import { useApiClient } from '~/composables/useApiClient';
import { resolveApiErrorMessageVi } from '~/utils/api-client';
import { formatSignedCreditsVi } from '~/utils/catalog';

const { client } = useApiClient();

const ledgerAsync = useAsyncData<WalletLedgerResponse>(
  'motion-ai-wallet-ledger',
  () => client.getWalletLedger({ pageSize: 20 }),
);

const entries = computed(() => ledgerAsync.data.value?.items ?? []);

const ledgerErrorVi = computed<string | null>(() => {
  if (!ledgerAsync.error.value) {
    return null;
  }
  return resolveApiErrorMessageVi(ledgerAsync.error.value);
});

function formatTimestampVi(isoString: string): string {
  return new Intl.DateTimeFormat('vi-VN', {
    dateStyle: 'short',
    timeStyle: 'short',
    timeZone: 'Asia/Ho_Chi_Minh',
  }).format(new Date(isoString));
}
</script>

<template>
  <div class="space-y-6" data-testid="page-history">
    <section
      class="flex flex-col justify-between gap-4 rounded-2xl border border-cyber-border bg-cyber-surface p-5 sm:flex-row sm:items-center"
    >
      <div class="space-y-1">
        <h1 class="font-display text-2xl font-bold text-cyber-text">
          Lịch Sử Biến Động Credit & Tác Vụ
        </h1>
        <p class="text-sm text-cyber-muted">
          Sổ cái bất biến xếp theo thứ tự mới nhất trước từ
          <span class="font-mono text-cyber-cyan">GET /wallet/ledger</span>.
        </p>
      </div>

      <button
        type="button"
        class="touch-target inline-flex min-h-[48px] min-w-[48px] items-center justify-center gap-2 rounded-xl border border-cyber-border bg-cyber-bg px-4 py-2.5 text-xs font-semibold text-cyber-text transition hover:border-cyber-violet"
        @click="ledgerAsync.refresh()"
      >
        <Icon name="lucide:refresh-cw" class="h-4 w-4" />
        <span>Làm mới sổ cái</span>
      </button>
    </section>

    <ApiErrorBanner
      :message-vi="ledgerErrorVi"
      :dismissible="false"
      @retry="ledgerAsync.refresh()"
    />

    <section
      class="overflow-hidden rounded-2xl border border-cyber-border bg-cyber-surface"
    >
      <div
        v-if="entries.length === 0"
        class="p-8 text-center text-sm text-cyber-muted"
      >
        Chưa có bút toán biến động số dư nào.
      </div>

      <ul v-else class="divide-y divide-cyber-border">
        <li
          v-for="item in entries"
          :key="item.id"
          :data-testid="`ledger-entry-${item.id}`"
          class="flex flex-col justify-between gap-3 p-4 sm:flex-row sm:items-center sm:px-6"
        >
          <div class="space-y-1">
            <div class="flex flex-wrap items-center gap-2">
              <span
                class="rounded-md border border-cyber-violet/40 bg-cyber-violet/15 px-2.5 py-0.5 font-mono text-xs font-semibold text-cyber-text"
              >
                {{ item.labelVi }}
              </span>
              <span class="font-mono text-xs text-cyber-muted">
                {{ formatTimestampVi(item.createdAt) }}
              </span>
            </div>
            <p class="text-sm text-cyber-text">
              {{ item.note || 'Giao dịch sổ cái hệ thống' }}
            </p>
          </div>

          <div class="font-mono text-sm font-bold">
            <span
              :class="
                item.amount > 0
                  ? 'text-cyber-success'
                  : item.amount < 0
                    ? 'text-cyber-warning'
                    : 'text-cyber-muted'
              "
            >
              {{ formatSignedCreditsVi(item.amount) }}
            </span>
          </div>
        </li>
      </ul>
    </section>
  </div>
</template>
