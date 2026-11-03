import {
  computed,
  ref,
  type ComputedRef,
  type Ref,
  type WritableComputedRef,
} from 'vue';
import type { LedgerEntry, WalletLedgerResponse } from '@motion-ai/contracts';
import { resolveApiErrorMessageVi } from './api-client.ts';

const VIETNAM_TIMESTAMP_FORMATTER = new Intl.DateTimeFormat('vi-VN', {
  dateStyle: 'short',
  timeStyle: 'short',
  timeZone: 'Asia/Ho_Chi_Minh',
});

export function formatTimestampVi(isoString: string): string {
  return VIETNAM_TIMESTAMP_FORMATTER.format(new Date(isoString));
}

export interface WalletLedgerPaginationClient {
  getWalletLedger(query: {
    pageSize?: number;
    cursor?: string;
  }): Promise<WalletLedgerResponse>;
}

export interface WalletLedgerPaginationOptions {
  client: WalletLedgerPaginationClient;
  pageSize?: number;
  initialData?: () => WalletLedgerResponse | null | undefined;
  isInitialPending?: () => boolean;
  onRefreshInitial?: () => Promise<WalletLedgerResponse | void>;
}

export interface WalletLedgerPaginationState {
  initialItems: ComputedRef<LedgerEntry[]>;
  additionalItems: Ref<LedgerEntry[]>;
  entries: ComputedRef<LedgerEntry[]>;
  nextCursor: WritableComputedRef<string | null>;
  hasMore: WritableComputedRef<boolean>;
  loadingMore: Ref<boolean>;
  loadMoreErrorVi: Ref<string | null>;
  syncInitialData: (data: WalletLedgerResponse | null | undefined) => void;
  clearAdditionalItems: () => void;
  reset: () => void;
  loadMore: () => Promise<boolean>;
  refresh: () => Promise<void>;
}

export function createWalletLedgerPagination(
  options: WalletLedgerPaginationOptions,
): WalletLedgerPaginationState {
  const pageSize = options.pageSize ?? 20;
  const manualInitialData = ref<WalletLedgerResponse | null>(null);

  const initialResponse = computed<WalletLedgerResponse | null>(() => {
    return options.initialData?.() ?? manualInitialData.value;
  });

  const initialItems = computed<LedgerEntry[]>(() => {
    return initialResponse.value?.items ?? [];
  });

  const additionalItems = ref<LedgerEntry[]>([]);
  const entries = computed<LedgerEntry[]>(() => [
    ...initialItems.value,
    ...additionalItems.value,
  ]);

  const initialNextCursor = computed(
    () => initialResponse.value?.nextCursor ?? null,
  );
  const initialHasMore = computed(
    () => initialResponse.value?.hasMore ?? false,
  );

  const cursorOverride = ref<string | null | undefined>(undefined);
  const hasMoreOverride = ref<boolean | undefined>(undefined);

  const nextCursor = computed<string | null>({
    get: () =>
      cursorOverride.value !== undefined
        ? cursorOverride.value
        : initialNextCursor.value,
    set: (val) => {
      cursorOverride.value = val;
    },
  });

  const hasMore = computed<boolean>({
    get: () =>
      hasMoreOverride.value !== undefined
        ? hasMoreOverride.value
        : initialHasMore.value,
    set: (val) => {
      hasMoreOverride.value = val;
    },
  });

  const loadingMore = ref<boolean>(false);
  const loadMoreErrorVi = ref<string | null>(null);

  function clearAdditionalItems(): void {
    additionalItems.value = [];
    cursorOverride.value = undefined;
    hasMoreOverride.value = undefined;
    loadMoreErrorVi.value = null;
  }

  function syncInitialData(
    data: WalletLedgerResponse | null | undefined,
  ): void {
    manualInitialData.value = data ?? null;
    clearAdditionalItems();
  }

  function reset(): void {
    manualInitialData.value = null;
    clearAdditionalItems();
  }

  async function loadMore(): Promise<boolean> {
    if (
      loadingMore.value ||
      !hasMore.value ||
      !nextCursor.value ||
      Boolean(options.isInitialPending?.())
    ) {
      return false;
    }

    loadingMore.value = true;
    loadMoreErrorVi.value = null;

    try {
      const res = await options.client.getWalletLedger({
        pageSize,
        cursor: nextCursor.value,
      });
      const existingIds = new Set(entries.value.map((e) => e.id));
      const newItems = res.items.filter((item) => !existingIds.has(item.id));
      additionalItems.value = [...additionalItems.value, ...newItems];
      nextCursor.value = res.nextCursor;
      hasMore.value = res.hasMore;
      return true;
    } catch (err) {
      loadMoreErrorVi.value = resolveApiErrorMessageVi(err);
      return false;
    } finally {
      loadingMore.value = false;
    }
  }

  async function refresh(): Promise<void> {
    if (loadingMore.value || Boolean(options.isInitialPending?.())) {
      return;
    }
    loadMoreErrorVi.value = null;

    if (options.onRefreshInitial) {
      const result = await options.onRefreshInitial();
      if (result) {
        syncInitialData(result);
      }
      return;
    }

    const res = await options.client.getWalletLedger({ pageSize });
    syncInitialData(res);
  }

  return {
    initialItems,
    additionalItems,
    entries,
    nextCursor,
    hasMore,
    loadingMore,
    loadMoreErrorVi,
    syncInitialData,
    clearAdditionalItems,
    reset,
    loadMore,
    refresh,
  };
}
