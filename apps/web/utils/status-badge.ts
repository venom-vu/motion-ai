import type { LedgerEntryType, Task, TopupPackId, TopupStatus } from '@flowvis/contracts';

/**
 * Badge dùng chung cho bảng phía người dùng: cùng khung, cỡ chữ và bo góc;
 * mỗi trạng thái trong một cột có một tông màu riêng, nhãn ngắn.
 */
export const BADGE_BASE =
  'inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2.5 py-0.5 font-mono text-xs font-semibold';

export type BadgeTone =
  | 'amber'
  | 'cyan'
  | 'green'
  | 'red'
  | 'orange'
  | 'violet'
  | 'sky'
  | 'pink'
  | 'slate';

export const BADGE_TONE_CLASS: Readonly<Record<BadgeTone, string>> = {
  amber: 'border-amber-400/50 bg-amber-400/15 text-amber-300',
  cyan: 'border-cyan-400/50 bg-cyan-400/15 text-cyan-300',
  green: 'border-emerald-400/50 bg-emerald-400/15 text-emerald-300',
  red: 'border-red-400/50 bg-red-400/15 text-red-300',
  orange: 'border-orange-400/50 bg-orange-400/15 text-orange-300',
  violet: 'border-violet-400/50 bg-violet-400/15 text-violet-300',
  sky: 'border-sky-400/50 bg-sky-400/15 text-sky-300',
  pink: 'border-pink-400/50 bg-pink-400/15 text-pink-300',
  slate: 'border-slate-500/60 bg-slate-500/15 text-slate-300',
};

export interface BadgeSpec {
  label: string;
  tone: BadgeTone;
  icon?: string;
}

export function badgeClass(tone: BadgeTone): string {
  return `${BADGE_BASE} ${BADGE_TONE_CLASS[tone]}`;
}

const TASK_STATUS_BADGES: Readonly<Record<Task['status'], BadgeSpec>> = {
  queued: { label: 'Đang chờ', tone: 'amber', icon: 'lucide:clock' },
  running: { label: 'Đang xử lý', tone: 'cyan', icon: 'lucide:loader-circle' },
  succeeded: { label: 'Hoàn thành', tone: 'green', icon: 'lucide:check' },
  failed: { label: 'Thất bại', tone: 'red', icon: 'lucide:x' },
  timed_out: { label: 'Quá hạn', tone: 'orange', icon: 'lucide:timer-off' },
  cancelled: { label: 'Đã hủy', tone: 'slate', icon: 'lucide:ban' },
};

export function getTaskStatusBadge(task: Pick<Task, 'status' | 'queuePosition'>): BadgeSpec {
  const spec = TASK_STATUS_BADGES[task.status] ?? { label: task.status, tone: 'slate' };
  if (task.status === 'queued' && task.queuePosition) {
    return { ...spec, label: `Đang chờ #${task.queuePosition}` };
  }
  return spec;
}

const TOPUP_STATUS_BADGES: Readonly<Record<TopupStatus, BadgeSpec>> = {
  awaiting_transfer: { label: 'Chờ chuyển khoản', tone: 'amber' },
  pending: { label: 'Chờ duyệt', tone: 'cyan' },
  approved: { label: 'Đã duyệt', tone: 'green' },
  rejected: { label: 'Từ chối', tone: 'red' },
  needs_review: { label: 'Cần kiểm tra', tone: 'violet' },
  expired: { label: 'Hết hạn', tone: 'slate' },
};

export function getTopupStatusBadge(status: TopupStatus): BadgeSpec {
  return TOPUP_STATUS_BADGES[status] ?? { label: 'Không rõ', tone: 'slate' };
}

const TOPUP_PACK_BADGES: Readonly<Record<string, BadgeSpec>> = {
  starter: { label: 'Starter', tone: 'sky' },
  pro: { label: 'Pro', tone: 'violet' },
  creator: { label: 'Creator', tone: 'pink' },
};

export function getTopupPackBadge(pack: TopupPackId | string): BadgeSpec {
  return TOPUP_PACK_BADGES[pack] ?? { label: pack, tone: 'slate' };
}

const LEDGER_TYPE_TONES: Readonly<Record<LedgerEntryType, BadgeTone>> = {
  GRANT: 'violet',
  TOPUP: 'green',
  HOLD: 'amber',
  RELEASED: 'cyan',
  CAPTURED: 'slate',
  ADJUST: 'pink',
};

export function getLedgerTypeTone(type: LedgerEntryType | string): BadgeTone {
  return LEDGER_TYPE_TONES[type as LedgerEntryType] ?? 'slate';
}
