import type { Task, TaskPipeline } from '@motion-ai/contracts';

const VI_DATE_FORMAT = new Intl.DateTimeFormat('vi-VN', {
  dateStyle: 'short',
  timeStyle: 'short',
  timeZone: 'Asia/Ho_Chi_Minh',
});

export function formatTaskTimestampVi(isoString?: string | null): string {
  if (!isoString) return '-';
  const d = new Date(isoString);
  if (Number.isNaN(d.getTime())) return '-';
  return VI_DATE_FORMAT.format(d);
}

export const PIPELINE_LABELS_VI: Readonly<Record<TaskPipeline, string>> = {
  face_swap: 'Hoán đổi khuôn mặt',
};

export function getPipelineLabelVi(pipeline: TaskPipeline | string): string {
  if (pipeline in PIPELINE_LABELS_VI) {
    return PIPELINE_LABELS_VI[pipeline as TaskPipeline];
  }
  return pipeline;
}

export function getTaskStatusLabelVi(task: Pick<Task, 'status' | 'queuePosition'>): string {
  switch (task.status) {
    case 'queued':
      return task.queuePosition
        ? `Đang chờ (#${task.queuePosition})`
        : 'Đang chờ xử lý';
    case 'running':
      return 'Đang xử lý';
    case 'succeeded':
      return 'Hoàn thành';
    case 'failed':
      return 'Thất bại (Đã hoàn credit)';
    case 'timed_out':
      return 'Quá hạn (Đã hoàn credit)';
    case 'cancelled':
      return 'Đã hủy (Đã hoàn credit)';
    default:
      return task.status;
  }
}

export const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

export function isTaskRetentionExpired(createdAt: string, nowMs = Date.now()): boolean {
  const t = new Date(createdAt).getTime();
  if (Number.isNaN(t)) return false;
  return nowMs - t > THIRTY_DAYS_MS;
}
