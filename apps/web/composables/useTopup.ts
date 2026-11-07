import { computed, onScopeDispose, ref, watch } from 'vue';
import { refreshNuxtData } from '#imports';
import {
  ApiErrorCode,
  getApiErrorMessageVi,
  type Topup,
  type TopupPackId,
} from '@motion-ai/contracts';
import { ME_KEY, useApiClient } from '~/composables/useApiClient';
import { resolveApiErrorMessageVi } from '~/utils/api-client';
import {
  formatCountdown,
  getRemainingSeconds,
  isApprovalDeferred,
  isQrExpired,
} from '~/utils/topup';

export function useTopup() {
  const { client } = useApiClient();

  const activeTopup = ref<Topup | null>(null);
  const isModalOpen = ref<boolean>(false);
  const isCreating = ref<boolean>(false);
  const isConfirming = ref<boolean>(false);
  const createErrorVi = ref<string | null>(null);
  const confirmErrorVi = ref<string | null>(null);

  const remainingSeconds = ref<number>(0);

  // Danh sách đơn nạp
  const topups = ref<Topup[]>([]);
  const isLoadingList = ref<boolean>(false);
  const isLoadingMore = ref<boolean>(false);
  const listErrorVi = ref<string | null>(null);
  const nextCursor = ref<string | null>(null);
  const hasMore = ref<boolean>(false);

  let countdownInterval: ReturnType<typeof setInterval> | null = null;
  let pollInterval: ReturnType<typeof setInterval> | null = null;
  let isPollingInFlight = false;
  let pollConsecutiveErrors = 0;

  const isExpired = computed<boolean>(() => {
    if (!activeTopup.value) {
      return false;
    }
    if (activeTopup.value.status === 'expired') {
      return true;
    }
    if (activeTopup.value.status === 'awaiting_transfer') {
      return (
        remainingSeconds.value <= 0 ||
        isQrExpired(activeTopup.value.qrExpiresAt)
      );
    }
    return false;
  });

  const formattedCountdown = computed<string>(() => {
    return formatCountdown(remainingSeconds.value);
  });

  const isOutsideHours = computed<boolean>(() => {
    if (!activeTopup.value) {
      return false;
    }
    return isApprovalDeferred(activeTopup.value);
  });

  function startCountdown(): void {
    stopCountdown();
    if (
      !activeTopup.value ||
      activeTopup.value.status !== 'awaiting_transfer'
    ) {
      remainingSeconds.value = 0;
      return;
    }
    remainingSeconds.value = getRemainingSeconds(activeTopup.value.qrExpiresAt);
    if (remainingSeconds.value <= 0) {
      return;
    }
    countdownInterval = setInterval(() => {
      if (!activeTopup.value) {
        stopCountdown();
        return;
      }
      const rem = getRemainingSeconds(activeTopup.value.qrExpiresAt);
      remainingSeconds.value = rem;
      if (rem <= 0) {
        stopCountdown();
      }
    }, 1000);
  }

  function stopCountdown(): void {
    if (countdownInterval !== null) {
      clearInterval(countdownInterval);
      countdownInterval = null;
    }
  }

  function startPolling(): void {
    stopPolling();
    if (!activeTopup.value) {
      return;
    }
    const targetStatus = activeTopup.value.status;
    if (
      targetStatus !== 'awaiting_transfer' &&
      targetStatus !== 'pending' &&
      targetStatus !== 'needs_review'
    ) {
      return;
    }
    const currentId = activeTopup.value.id;
    pollConsecutiveErrors = 0;

    pollInterval = setInterval(async () => {
      if (isPollingInFlight) {
        return;
      }
      if (!isModalOpen.value || !activeTopup.value || activeTopup.value.id !== currentId) {
        stopPolling();
        return;
      }

      isPollingInFlight = true;
      try {
        const updated = await client.getTopup(currentId);
        pollConsecutiveErrors = 0;

        if (!isModalOpen.value || activeTopup.value?.id !== currentId) {
          return;
        }

        const prevStatus = activeTopup.value.status;
        activeTopup.value = updated;
        updateItemInList(updated);

        // Khi đơn được duyệt: cập nhật thông tin tài khoản và dừng polling
        if (updated.status === 'approved') {
          stopPolling();
          try {
            await refreshNuxtData(ME_KEY);
          } catch {
            // refresh data lỗi không chặn luồng
          }
        } else if (
          updated.status === 'rejected' ||
          updated.status === 'expired'
        ) {
          stopPolling();
        } else if (prevStatus !== updated.status) {
          // Trạng thái thay đổi (ví dụ từ awaiting_transfer -> pending)
          startCountdown();
        }
      } catch (err: unknown) {
        pollConsecutiveErrors++;
        const status = (err as { status?: number })?.status;
        if (
          status === 401 ||
          status === 403 ||
          status === 404 ||
          pollConsecutiveErrors >= 5
        ) {
          stopPolling();
        }
      } finally {
        isPollingInFlight = false;
      }
    }, 4000);
  }

  function stopPolling(): void {
    if (pollInterval !== null) {
      clearInterval(pollInterval);
      pollInterval = null;
    }
    isPollingInFlight = false;
    pollConsecutiveErrors = 0;
  }

  function updateItemInList(item: Topup): void {
    const idx = topups.value.findIndex((t) => t.id === item.id);
    if (idx !== -1) {
      topups.value[idx] = item;
    } else {
      topups.value.unshift(item);
    }
  }

  function openModal(topup: Topup): void {
    activeTopup.value = topup;
    isModalOpen.value = true;
    confirmErrorVi.value = null;
    createErrorVi.value = null;
    startCountdown();
    startPolling();
  }

  function closeModal(): void {
    isModalOpen.value = false;
    stopCountdown();
    stopPolling();
  }

  async function createOrder(
    pack: TopupPackId,
    consent: boolean,
  ): Promise<Topup | null> {
    if (isCreating.value) {
      return null;
    }
    createErrorVi.value = null;
    if (!consent) {
      createErrorVi.value = getApiErrorMessageVi(ApiErrorCode.CONSENT_REQUIRED);
      return null;
    }

    isCreating.value = true;
    try {
      const created = await client.createTopup({ pack, consent: true });
      updateItemInList(created);
      openModal(created);
      return created;
    } catch (err) {
      createErrorVi.value = resolveApiErrorMessageVi(err);
      return null;
    } finally {
      isCreating.value = false;
    }
  }

  async function confirmTransfer(): Promise<Topup | null> {
    if (isConfirming.value) {
      return null;
    }
    if (!activeTopup.value || activeTopup.value.status !== 'awaiting_transfer') {
      return null;
    }
    if (isExpired.value) {
      return null;
    }

    isConfirming.value = true;
    confirmErrorVi.value = null;

    try {
      const updated = await client.confirmTopupTransfer(activeTopup.value.id);
      activeTopup.value = updated;
      updateItemInList(updated);
      stopCountdown();
      startPolling();
      return updated;
    } catch (err: unknown) {
      confirmErrorVi.value = resolveApiErrorMessageVi(err);
      const code = (err as { code?: string })?.code;
      if (
        code === ApiErrorCode.TOPUP_QR_EXPIRED ||
        code === 'TOPUP_QR_EXPIRED'
      ) {
        if (activeTopup.value) {
          const expiredItem: Topup = {
            ...activeTopup.value,
            status: 'expired',
          };
          activeTopup.value = expiredItem;
          updateItemInList(expiredItem);
          stopCountdown();
          stopPolling();
        }
      }
      return null;
    } finally {
      isConfirming.value = false;
    }
  }

  async function fetchTopups(cursor?: string): Promise<void> {
    const isPaging = Boolean(cursor);
    if (isPaging) {
      if (isLoadingMore.value) {
        return;
      }
      isLoadingMore.value = true;
    } else {
      if (isLoadingList.value) {
        return;
      }
      isLoadingList.value = true;
    }
    listErrorVi.value = null;

    try {
      const res = await client.listTopups({ pageSize: 20, cursor });
      if (isPaging) {
        const existingIds = new Set(topups.value.map((t) => t.id));
        const newItems = res.items.filter((item) => !existingIds.has(item.id));
        topups.value = [...topups.value, ...newItems];
      } else {
        topups.value = res.items;
      }
      nextCursor.value = res.nextCursor ?? null;
      hasMore.value = Boolean(res.hasMore && res.nextCursor);
    } catch (err) {
      listErrorVi.value = resolveApiErrorMessageVi(err);
    } finally {
      if (isPaging) {
        isLoadingMore.value = false;
      } else {
        isLoadingList.value = false;
      }
    }
  }

  async function refreshTopups(): Promise<void> {
    await fetchTopups();
  }

  async function loadMore(): Promise<void> {
    if (hasMore.value && nextCursor.value && !isLoadingMore.value) {
      await fetchTopups(nextCursor.value);
    }
  }

  watch(
    () => activeTopup.value?.status,
    (newStatus) => {
      if (newStatus === 'awaiting_transfer') {
        startCountdown();
        startPolling();
      } else if (newStatus === 'pending' || newStatus === 'needs_review') {
        stopCountdown();
        startPolling();
      } else {
        stopCountdown();
        stopPolling();
      }
    },
  );

  onScopeDispose(() => {
    stopCountdown();
    stopPolling();
  });

  return {
    activeTopup,
    isModalOpen,
    isCreating,
    isConfirming,
    createErrorVi,
    confirmErrorVi,
    remainingSeconds,
    formattedCountdown,
    isExpired,
    isOutsideHours,
    topups,
    isLoadingList,
    isLoadingMore,
    listErrorVi,
    hasMore,
    nextCursor,
    openModal,
    closeModal,
    createOrder,
    confirmTransfer,
    fetchTopups,
    refreshTopups,
    loadMore,
  };
}
