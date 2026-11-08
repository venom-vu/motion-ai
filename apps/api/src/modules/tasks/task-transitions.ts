import type { ReasonCode, TaskStatus } from '@flowvis/contracts';

export const ALLOWED_TRANSITIONS: Readonly<Record<TaskStatus, readonly TaskStatus[]>> = {
  queued: ['running', 'cancelled', 'timed_out', 'failed'],
  running: ['succeeded', 'failed', 'timed_out'],
  succeeded: [],
  failed: [],
  timed_out: [],
  cancelled: [],
};

export const TIMED_OUT_REASONS: readonly ReasonCode[] = [
  'PREP_TIMEOUT',
  'FREE_WAIT_EXPIRED',
  'RH_TIMEOUT',
  'RH_GATE_TIMEOUT',
];

export function isTerminal(status: TaskStatus): boolean {
  return status === 'succeeded' || status === 'failed' || status === 'timed_out' || status === 'cancelled';
}

/** Ném Error lập trình nếu cặp chuyển hoặc reasonCode vi phạm bất biến TaskSchema. */
export function assertValidTransition(
  from: TaskStatus,
  to: TaskStatus,
  reasonCode: ReasonCode | null | undefined,
): void {
  if (!(ALLOWED_TRANSITIONS[from] ?? []).includes(to)) {
    throw new Error(`Chuyển trạng thái Task không hợp lệ: ${from} -> ${to}`);
  }
  const has = reasonCode != null;
  if (to === 'running' || to === 'succeeded') {
    if (has) throw new Error(`Task ${to} không được có reasonCode`);
    return;
  }
  if (!has) throw new Error(`Task ${to} bắt buộc có reasonCode`);
  if (to === 'cancelled') {
    if (reasonCode !== 'USER_CANCEL') throw new Error('Task cancelled chỉ nhận USER_CANCEL');
    return;
  }
  if (to === 'timed_out') {
    if (!TIMED_OUT_REASONS.includes(reasonCode)) {
      throw new Error(`reasonCode ${reasonCode} không hợp lệ cho timed_out`);
    }
    return;
  }
  // failed
  if (reasonCode === 'USER_CANCEL' || TIMED_OUT_REASONS.includes(reasonCode)) {
    throw new Error(`reasonCode ${reasonCode} không hợp lệ cho failed`);
  }
}
