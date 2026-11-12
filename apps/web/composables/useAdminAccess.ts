import { computed } from 'vue';
import { useAsyncData } from '#imports';
import type { MeResponse } from '@flowvis/contracts';
import { ME_KEY, useApiClient } from '~/composables/useApiClient';

/** Trạng thái phiên cho các trang quản trị: đang kiểm tra hay đã xác định là admin. */
export function useAdminAccess() {
  const { client } = useApiClient();
  const meAsync = useAsyncData<MeResponse>(ME_KEY, () => client.getMe());
  const isMePending = computed<boolean>(
    () => meAsync.status.value === 'pending' || Boolean(meAsync.pending.value),
  );
  const isAdmin = computed<boolean>(() => meAsync.data.value?.role === 'admin');
  return { isMePending, isAdmin };
}
