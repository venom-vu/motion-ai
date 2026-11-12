import { ref } from 'vue';
import type {
  AdminAuditEntry,
  AdminStatsQuery,
  AdminStatsResponse,
  AdminTaskLookupResponse,
  AdminUser,
  AdminUserStatsResponse,
  LedgerEntry,
  OpsStatusResponse,
} from '@flowvis/contracts';
import { useApiClient } from '~/composables/useApiClient';
import { resolveAdminErrorMessageVi } from '~/utils/api-client';

export const OPS_STATUS_REFRESH_MS = 30_000;
/** Số dư RunningHub đọc quá 30 phút là cũ. */
export const RH_BALANCE_STALE_MS = 30 * 60 * 1000;
/** Sao lưu hằng đêm: quá 36 giờ là cũ. */
export const BACKUP_STALE_MS = 36 * 60 * 60 * 1000;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isStaleAt(iso: string | null | undefined, maxAgeMs: number, now: number = Date.now()): boolean {
  if (!iso) return false;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return true;
  return now - t > maxAgeMs;
}

export function newRequestId(): string {
  return globalThis.crypto.randomUUID();
}

export type AdjustValidation =
  | { ok: true; amount: number; reason: string }
  | { ok: false; amountError: string | null; reasonError: string | null };

/** Kiểm tra form bù credit: số nguyên khác 0 và lý do không rỗng. */
export function validateAdjustForm(amountRaw: string, reasonRaw: string): AdjustValidation {
  const text = amountRaw.trim();
  const reason = reasonRaw.trim();
  let amountError: string | null = null;
  let amount = Number.NaN;
  if (text === '') {
    amountError = 'Vui lòng nhập số credit.';
  } else if (!/^[+-]?\d+$/.test(text)) {
    amountError = 'Số credit phải là số nguyên khác 0.';
  } else {
    amount = Number(text);
    if (!Number.isSafeInteger(amount)) amountError = 'Số credit quá lớn.';
    else if (amount === 0) amountError = 'Số credit phải khác 0.';
  }
  const reasonError = reason === '' ? 'Vui lòng nhập lý do.' : reason.length > 500 ? 'Lý do tối đa 500 ký tự.' : null;
  if (amountError || reasonError) return { ok: false, amountError, reasonError };
  return { ok: true, amount, reason };
}

/** Phân loại ô tra cứu: UUID là taskId, còn lại coi là shareUrl. Trả đúng một tham số. */
export function classifyLookupInput(
  raw: string,
): { taskId: string } | { shareUrl: string } | null {
  const v = raw.trim();
  if (!v) return null;
  return UUID_RE.test(v) ? { taskId: v } : { shareUrl: v };
}

export function isTaskFinished(status: string): boolean {
  return status !== 'queued' && status !== 'running';
}

export function useAdminOps() {
  const { client } = useApiClient();

  /* ------------------------------ Trạng thái ------------------------------ */
  const status = ref<OpsStatusResponse | null>(null);
  const statusErrorVi = ref<string | null>(null);
  const isStatusLoading = ref(false);
  const isResuming = ref(false);
  const resumeErrorVi = ref<string | null>(null);
  let timer: ReturnType<typeof setInterval> | null = null;

  let statusEpoch = 0;
  async function refreshStatus(): Promise<void> {
    if (isStatusLoading.value) return;
    isStatusLoading.value = true;
    const epoch = statusEpoch;
    try {
      const res = await client.getOpsStatus();
      if (epoch === statusEpoch) status.value = res;
      statusErrorVi.value = null;
    } catch (err: unknown) {
      statusErrorVi.value = resolveAdminErrorMessageVi(err);
    } finally {
      isStatusLoading.value = false;
    }
  }

  function startStatusPolling(intervalMs: number = OPS_STATUS_REFRESH_MS): void {
    if (timer) return;
    timer = setInterval(() => void refreshStatus(), intervalMs);
  }

  function stopStatusPolling(): void {
    if (timer) clearInterval(timer);
    timer = null;
  }

  function canResume(): boolean {
    return Boolean(status.value && (status.value.intakePaused || status.value.rhBudgetExhausted));
  }

  async function resumeIntake(): Promise<boolean> {
    if (isResuming.value) return false;
    if (!canResume()) {
      resumeErrorVi.value = 'Hệ thống đang nhận Task bình thường.';
      return false;
    }
    isResuming.value = true;
    resumeErrorVi.value = null;
    try {
      const res = await client.resumeOps();
      statusEpoch++;
      status.value = res;
      return true;
    } catch (err: unknown) {
      resumeErrorVi.value = resolveAdminErrorMessageVi(err);
      return false;
    } finally {
      isResuming.value = false;
    }
  }

  /* ------------------------------ Thống kê ------------------------------ */
  const stats = ref<AdminStatsResponse | null>(null);
  const isStatsLoading = ref(false);
  const statsErrorVi = ref<string | null>(null);

  async function fetchStats(query: {
    from: string;
    to: string;
    scope: AdminStatsQuery['scope'];
    motionPricePerSecond?: number;
    imagePrice?: number;
  }): Promise<void> {
    if (isStatsLoading.value) return;
    isStatsLoading.value = true;
    statsErrorVi.value = null;
    try {
      stats.value = await client.getAdminStats(query);
    } catch (err: unknown) {
      statsErrorVi.value = resolveAdminErrorMessageVi(err);
    } finally {
      isStatsLoading.value = false;
    }
  }

  /* --------------------------- Số lượng tài khoản --------------------------- */
  const userStats = ref<AdminUserStatsResponse | null>(null);
  const isUserStatsLoading = ref(false);
  const userStatsErrorVi = ref<string | null>(null);

  async function fetchUserStats(days = 30): Promise<void> {
    if (isUserStatsLoading.value) return;
    isUserStatsLoading.value = true;
    userStatsErrorVi.value = null;
    try {
      userStats.value = await client.getAdminUserStats(days);
    } catch (err: unknown) {
      userStatsErrorVi.value = resolveAdminErrorMessageVi(err);
    } finally {
      isUserStatsLoading.value = false;
    }
  }

  /* ------------------------------ Tài khoản ------------------------------ */
  const user = ref<AdminUser | null>(null);
  const ledger = ref<LedgerEntry[]>([]);
  const ledgerCursor = ref<string | null>(null);
  const ledgerHasMore = ref(false);
  const userErrorVi = ref<string | null>(null);
  const isUserLoading = ref(false);
  const isUserActionLoading = ref(false);
  const userActionErrorVi = ref<string | null>(null);
  /** Sinh một lần khi mở form bù credit; dùng lại cho mọi lần bấm gửi của form đó. */
  const adjustRequestId = ref<string | null>(null);
  let lastAdjustPayload: { amount: number; reason: string } | null = null;

  function openAdjustForm(): string {
    adjustRequestId.value = newRequestId();
    lastAdjustPayload = null;
    userActionErrorVi.value = null;
    return adjustRequestId.value;
  }

  async function loadLedger(reset: boolean): Promise<void> {
    const target = user.value;
    if (!target) return;
    const res = await client.getAdminUserLedger(target.id, {
      pageSize: 20,
      cursor: reset ? undefined : (ledgerCursor.value ?? undefined),
    });
    if (user.value?.id !== target.id) return;
    ledger.value = reset ? res.items : [...ledger.value, ...res.items];
    ledgerHasMore.value = res.hasMore;
    ledgerCursor.value = res.nextCursor;
  }

  async function searchUser(email: string): Promise<void> {
    if (isUserLoading.value) return;
    isUserLoading.value = true;
    userErrorVi.value = null;
    userActionErrorVi.value = null;
    try {
      user.value = await client.searchAdminUser(email.trim());
      ledger.value = [];
      ledgerCursor.value = null;
      ledgerHasMore.value = false;
      adjustRequestId.value = null;
      lastAdjustPayload = null;
    } catch (err: unknown) {
      user.value = null;
      ledger.value = [];
      userErrorVi.value = resolveAdminErrorMessageVi(err);
      isUserLoading.value = false;
      return;
    }
    try {
      await loadLedger(true);
    } catch (err: unknown) {
      userActionErrorVi.value = `Không tải được sổ cái: ${resolveAdminErrorMessageVi(err)}`;
    } finally {
      isUserLoading.value = false;
    }
  }

  let isLedgerLoadingMore = false;
  async function loadMoreLedger(): Promise<void> {
    if (!ledgerHasMore.value || isUserLoading.value || isLedgerLoadingMore || !ledgerCursor.value) return;
    isLedgerLoadingMore = true;
    try {
      await loadLedger(false);
    } catch (err: unknown) {
      userActionErrorVi.value = `Không tải được sổ cái: ${resolveAdminErrorMessageVi(err)}`;
    } finally {
      isLedgerLoadingMore = false;
    }
  }

  async function runUserAction(fn: () => Promise<void>): Promise<boolean> {
    if (isUserActionLoading.value) return false;
    isUserActionLoading.value = true;
    userActionErrorVi.value = null;
    try {
      await fn();
      return true;
    } catch (err: unknown) {
      userActionErrorVi.value = resolveAdminErrorMessageVi(err);
      return false;
    } finally {
      isUserActionLoading.value = false;
    }
  }

  async function lockUser(reason: string): Promise<boolean> {
    const current = user.value;
    const text = reason.trim();
    if (!current) return false;
    if (!text) {
      userActionErrorVi.value = 'Vui lòng nhập lý do.';
      return false;
    }
    return runUserAction(async () => {
      const res = await client.lockUser(current.id, { reason: text });
      if (user.value?.id === current.id) user.value = res;
    });
  }

  async function unlockUser(reason: string): Promise<boolean> {
    const current = user.value;
    const text = reason.trim();
    if (!current) return false;
    if (!text) {
      userActionErrorVi.value = 'Vui lòng nhập lý do.';
      return false;
    }
    return runUserAction(async () => {
      const res = await client.unlockUser(current.id, { reason: text });
      if (user.value?.id === current.id) user.value = res;
    });
  }

  async function adjustUser(amount: number, reason: string): Promise<boolean> {
    const current = user.value;
    if (!current) return false;
    const text = reason.trim();
    const same = lastAdjustPayload && lastAdjustPayload.amount === amount && lastAdjustPayload.reason === text;
    if (!adjustRequestId.value || (lastAdjustPayload && !same)) adjustRequestId.value = newRequestId();
    const requestId = adjustRequestId.value;
    lastAdjustPayload = { amount, reason: text };
    return runUserAction(async () => {
      const res = await client.adjustUser(current.id, { amount, reason: text, requestId });
      if (user.value?.id !== current.id) return;
      user.value = res.user;
      ledger.value = [res.entry, ...ledger.value.filter((e) => e.id !== res.entry.id)];
      adjustRequestId.value = null;
      lastAdjustPayload = null;
    });
  }

  /* ------------------------------ Gỡ nội dung ------------------------------ */
  const task = ref<AdminTaskLookupResponse | null>(null);
  const taskErrorVi = ref<string | null>(null);
  const isTaskLoading = ref(false);
  const isTakedownLoading = ref(false);
  const takedownErrorVi = ref<string | null>(null);

  async function lookupTask(raw: string): Promise<void> {
    if (isTaskLoading.value) return;
    const query = classifyLookupInput(raw);
    if (!query) {
      taskErrorVi.value = 'Vui lòng nhập mã Task hoặc liên kết chia sẻ.';
      return;
    }
    isTaskLoading.value = true;
    taskErrorVi.value = null;
    takedownErrorVi.value = null;
    try {
      task.value = await client.lookupAdminTask(query);
    } catch (err: unknown) {
      task.value = null;
      taskErrorVi.value = resolveAdminErrorMessageVi(err);
    } finally {
      isTaskLoading.value = false;
    }
  }

  async function takedown(reason: string): Promise<boolean> {
    const current = task.value;
    const text = reason.trim();
    if (!current || isTakedownLoading.value) return false;
    if (!text) {
      takedownErrorVi.value = 'Vui lòng nhập lý do.';
      return false;
    }
    if (!isTaskFinished(current.status)) {
      takedownErrorVi.value = 'Tác vụ chưa kết thúc nên chưa thể gỡ nội dung.';
      return false;
    }
    isTakedownLoading.value = true;
    takedownErrorVi.value = null;
    try {
      const res = await client.takedownTask(current.id, { reason: text });
      if (task.value?.id === current.id) {
        task.value = { ...current, filesRemovedAt: res.filesRemovedAt };
      }
      return true;
    } catch (err: unknown) {
      takedownErrorVi.value = resolveAdminErrorMessageVi(err);
      return false;
    } finally {
      isTakedownLoading.value = false;
    }
  }

  /* ------------------------------ Nhật ký ------------------------------ */
  const auditItems = ref<AdminAuditEntry[]>([]);
  const auditAction = ref('');
  const auditTarget = ref('');
  const auditCursor = ref<string | null>(null);
  const auditHasMore = ref(false);
  const isAuditLoading = ref(false);
  const isAuditLoadingMore = ref(false);
  const auditErrorVi = ref<string | null>(null);
  let auditSeq = 0;
  /** Bộ lọc đã áp dụng ở lần tải đầu; "tải thêm" dùng đúng bộ lọc này, không đọc ô đang gõ. */
  let appliedAuditFilter: { action?: string; target?: string } = {};

  async function fetchAudit(reset = true): Promise<void> {
    if (!reset && (isAuditLoadingMore.value || !auditHasMore.value || !auditCursor.value)) return;
    const seq = ++auditSeq;
    if (reset) {
      appliedAuditFilter = {
        action: auditAction.value.trim() || undefined,
        target: auditTarget.value.trim() || undefined,
      };
      isAuditLoading.value = true;
      isAuditLoadingMore.value = false;
    } else {
      isAuditLoadingMore.value = true;
    }
    auditErrorVi.value = null;
    try {
      const res = await client.listAdminAudit({
        action: appliedAuditFilter.action,
        target: appliedAuditFilter.target,
        pageSize: 20,
        cursor: reset ? undefined : (auditCursor.value ?? undefined),
      });
      if (seq !== auditSeq) return;
      if (reset) {
        auditItems.value = res.items;
      } else {
        const seen = new Set(auditItems.value.map((e) => e.id));
        auditItems.value = [...auditItems.value, ...res.items.filter((e) => !seen.has(e.id))];
      }
      auditHasMore.value = res.hasMore;
      auditCursor.value = res.nextCursor;
    } catch (err: unknown) {
      if (seq === auditSeq) auditErrorVi.value = resolveAdminErrorMessageVi(err);
    } finally {
      if (seq === auditSeq) {
        isAuditLoading.value = false;
        isAuditLoadingMore.value = false;
      }
    }
  }

  return {
    status,
    statusErrorVi,
    isStatusLoading,
    isResuming,
    resumeErrorVi,
    refreshStatus,
    startStatusPolling,
    stopStatusPolling,
    canResume,
    resumeIntake,
    stats,
    isStatsLoading,
    statsErrorVi,
    fetchStats,
    userStats,
    isUserStatsLoading,
    userStatsErrorVi,
    fetchUserStats,
    user,
    ledger,
    ledgerHasMore,
    userErrorVi,
    isUserLoading,
    isUserActionLoading,
    userActionErrorVi,
    adjustRequestId,
    openAdjustForm,
    searchUser,
    loadMoreLedger,
    lockUser,
    unlockUser,
    adjustUser,
    task,
    taskErrorVi,
    isTaskLoading,
    isTakedownLoading,
    takedownErrorVi,
    lookupTask,
    takedown,
    auditItems,
    auditAction,
    auditTarget,
    auditHasMore,
    isAuditLoading,
    isAuditLoadingMore,
    auditErrorVi,
    fetchAudit,
  };
}
