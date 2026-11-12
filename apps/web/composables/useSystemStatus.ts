import { useState } from '#imports';
import { useApiClient } from '~/composables/useApiClient';
import { resolveIntakePaused } from '~/utils/system-status';

// Chỉ kết quả của lần refresh() mới nhất được áp dụng; markPaused() vô hiệu hóa các lần đang bay.
let latestSeq = 0;

export function useSystemStatus() {
  const { client } = useApiClient();
  const intakePaused = useState<boolean>('flowvis-intake-paused', () => false);

  async function refresh(): Promise<void> {
    const seq = ++latestSeq;
    const next = await resolveIntakePaused(
      () => client.getSystemStatus(),
      intakePaused.value,
    );
    if (seq !== latestSeq) return;
    intakePaused.value = next;
  }

  function markPaused(): void {
    latestSeq += 1;
    intakePaused.value = true;
  }

  return { intakePaused, refresh, markPaused };
}
