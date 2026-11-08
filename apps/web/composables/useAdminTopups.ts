import { ref } from 'vue';
import {
  ApiErrorCode,
  type AdminTopup,
  type TopupStatus,
} from '@flowvis/contracts';
import { useApiClient } from '~/composables/useApiClient';
import { MotionApiClientError, resolveApiErrorMessageVi } from '~/utils/api-client';

export type AdminTopupFilterStatus = 'all' | TopupStatus;

export function useAdminTopups() {
  const { client } = useApiClient();

  const statusFilter = ref<AdminTopupFilterStatus>('pending');
  const topups = ref<AdminTopup[]>([]);
  const isLoading = ref<boolean>(false);
  const isLoadingMore = ref<boolean>(false);
  const isActionLoading = ref<boolean>(false);
  const errorVi = ref<string | null>(null);
  const loadMoreErrorVi = ref<string | null>(null);
  const actionErrorVi = ref<string | null>(null);
  const nextCursor = ref<string | null>(null);
  const hasMore = ref<boolean>(false);

  let currentQuerySeq = 0;

  function updateItemInList(updated: AdminTopup): void {
    const idx = topups.value.findIndex((t) => t.id === updated.id);
    if (idx !== -1) {
      const next = [...topups.value];
      next[idx] = updated;
      topups.value = next;
    }
  }

  async function fetchTopups(reset = true): Promise<void> {
    const querySeq = ++currentQuerySeq;

    if (reset) {
      isLoading.value = true;
      isLoadingMore.value = false;
      errorVi.value = null;
      loadMoreErrorVi.value = null;
      nextCursor.value = null;
      hasMore.value = false;
    } else {
      isLoadingMore.value = true;
      loadMoreErrorVi.value = null;
    }

    try {
      const queryStatus =
        statusFilter.value === 'all' ? undefined : statusFilter.value;
      const res = await client.adminListTopups({
        status: queryStatus,
        pageSize: 20,
        cursor: reset ? undefined : (nextCursor.value ?? undefined),
      });

      if (querySeq !== currentQuerySeq) {
        return;
      }

      if (reset) {
        topups.value = res.items;
      } else {
        const existingIds = new Set(topups.value.map((t) => t.id));
        const newItems = res.items.filter((t) => !existingIds.has(t.id));
        topups.value = [...topups.value, ...newItems];
      }

      hasMore.value = res.hasMore;
      nextCursor.value = res.nextCursor;
    } catch (err: unknown) {
      if (querySeq !== currentQuerySeq) {
        return;
      }
      if (reset) {
        errorVi.value = resolveApiErrorMessageVi(err);
      } else {
        loadMoreErrorVi.value = resolveApiErrorMessageVi(err);
      }
    } finally {
      if (querySeq === currentQuerySeq) {
        if (reset) {
          isLoading.value = false;
        } else {
          isLoadingMore.value = false;
        }
      }
    }
  }

  async function loadMore(): Promise<void> {
    if (!hasMore.value || isLoadingMore.value || !nextCursor.value) {
      return;
    }
    isLoadingMore.value = true;
    await fetchTopups(false);
  }

  async function setStatusFilter(status: AdminTopupFilterStatus): Promise<void> {
    if (statusFilter.value === status) {
      return;
    }
    statusFilter.value = status;
    await fetchTopups(true);
  }

  async function runAction<T extends AdminTopup>(
    actionFn: () => Promise<T>,
  ): Promise<T> {
    if (isActionLoading.value) {
      throw new Error('Thao tác đang được xử lý, vui lòng không nhấn liên tục.');
    }
    isActionLoading.value = true;
    actionErrorVi.value = null;

    try {
      const result = await actionFn();
      updateItemInList(result);
      return result;
    } catch (err: unknown) {
      const msg = resolveApiErrorMessageVi(err);
      actionErrorVi.value = msg;

      const isStateInvalid =
        (err instanceof MotionApiClientError &&
          err.code === ApiErrorCode.TOPUP_STATE_INVALID) ||
        (err &&
          typeof err === 'object' &&
          'code' in err &&
          (err as { code?: unknown }).code === 'TOPUP_STATE_INVALID');

      if (isStateInvalid) {
        // Tự động làm mới danh sách đơn để cập nhật trạng thái mới nhất do Admin khác đã thao tác
        void fetchTopups(true);
      }
      throw err;
    } finally {
      isActionLoading.value = false;
    }
  }

  async function approveTopup(id: string, bankRef: string): Promise<AdminTopup> {
    return runAction(() =>
      client.adminApproveTopup(id, { bankRef: bankRef.trim() }),
    );
  }

  async function approveExpiredTopup(
    id: string,
    bankRef: string,
  ): Promise<AdminTopup> {
    return runAction(() =>
      client.adminApproveExpiredTopup(id, { bankRef: bankRef.trim() }),
    );
  }

  async function rejectTopup(
    id: string,
    rejectReason: string,
  ): Promise<AdminTopup> {
    return runAction(() =>
      client.adminRejectTopup(id, { rejectReason: rejectReason.trim() }),
    );
  }

  async function markNeedsReview(id: string, note: string): Promise<AdminTopup> {
    return runAction(() =>
      client.adminNeedsReviewTopup(id, { note: note.trim() }),
    );
  }

  async function returnToPending(id: string): Promise<AdminTopup> {
    return runAction(() => client.adminReturnTopupToPending(id));
  }

  return {
    statusFilter,
    topups,
    isLoading,
    isLoadingMore,
    isActionLoading,
    errorVi,
    loadMoreErrorVi,
    actionErrorVi,
    hasMore,
    nextCursor,
    fetchTopups,
    loadMore,
    setStatusFilter,
    approveTopup,
    approveExpiredTopup,
    rejectTopup,
    markNeedsReview,
    returnToPending,
  };
}
