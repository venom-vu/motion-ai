import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  ApiErrorCode,
  getApiErrorMessageVi,
  getValidationReasonMessageVi,
  type AdminTaskLookupQuery,
  type AdminTaskLookupResponse,
  type AdminTaskTakedownResponse,
  type TaskStatus,
} from '@flowvis/contracts';
import { PrismaService } from '../../infra/prisma.service.js';
import { STORAGE_PORT, type StoragePort } from '../../ports/index.js';
import { AuditService } from '../audit/audit.service.js';
import { ShareService } from '../storage/share.service.js';
import { TasksService } from '../tasks/tasks.service.js';
import { isTerminal } from '../tasks/task-transitions.js';

const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

function notFound(): NotFoundException {
  return new NotFoundException({ code: ApiErrorCode.NOT_FOUND, message: getApiErrorMessageVi(ApiErrorCode.NOT_FOUND) });
}

function extractToken(shareUrl: string): string | null {
  let pathname: string;
  try {
    pathname = new URL(shareUrl).pathname;
  } catch {
    return null;
  }
  const m = /(?:^|\/)s\/([^/]+)\/?$/.exec(pathname);
  return m && TOKEN_RE.test(m[1]) ? m[1] : null;
}

/** Điều phối gỡ nội dung khẩn cấp; mỗi bảng vẫn chỉ do chủ của nó ghi (AD-1). */
@Injectable()
export class AdminTasksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tasks: TasksService,
    private readonly share: ShareService,
    private readonly audit: AuditService,
    @Inject(STORAGE_PORT) private readonly storage: StoragePort,
  ) {}

  async lookup(q: AdminTaskLookupQuery): Promise<AdminTaskLookupResponse> {
    let taskId = q.taskId;
    if (!taskId) {
      const token = extractToken(q.shareUrl ?? '');
      const found = token ? await this.share.findTaskIdByToken(token) : null;
      if (!found) throw notFound();
      taskId = found;
    }
    const row = await this.tasks.findForAdmin(taskId);
    if (!row) throw notFound();
    return {
      id: row.id,
      userId: row.userId,
      userEmail: row.user.email,
      pipeline: row.pipeline as AdminTaskLookupResponse['pipeline'],
      status: row.status as TaskStatus,
      creditCost: row.holdAmount,
      filesRemovedAt: row.filesRemovedAt ? row.filesRemovedAt.toISOString() : null,
      createdAt: row.createdAt.toISOString(),
    };
  }

  async takedown(adminId: string, taskId: string, reason: string): Promise<AdminTaskTakedownResponse> {
    const row = await this.tasks.findForAdmin(taskId);
    if (!row) throw notFound();
    if (row.filesRemovedAt) return { taskId, filesRemovedAt: row.filesRemovedAt.toISOString() };
    if (!isTerminal(row.status as TaskStatus)) {
      throw new BadRequestException({
        code: ApiErrorCode.VALIDATION_FAILED,
        message: getValidationReasonMessageVi('TASK_NOT_FINISHED'),
        details: { reason: 'TASK_NOT_FINISHED' },
      });
    }

    const revokedTokens = await this.share.revokeAllForTask(taskId);

    const keys = new Set<string>();
    if (row.resultKey) {
      keys.add(row.resultKey);
      if (row.resultKey.endsWith('.mp4')) keys.add(row.resultKey.replace(/\.mp4$/, '.jpg'));
    }
    for (const v of Object.values((row.inputKeys ?? {}) as Record<string, unknown>)) {
      if (typeof v === 'string' && v) keys.add(v);
    }
    for (const key of keys) await this.storage.delete(key);

    return this.prisma.$transaction(async (tx) => {
      const { filesRemovedAt, applied } = await this.tasks.markFilesRemoved(taskId, tx);
      if (applied) {
        await this.audit.record(tx, {
          adminId,
          action: 'task.takedown',
          target: `task:${taskId}`,
          beforeAfter: { taskId, reason, deletedObjects: keys.size, revokedTokens },
        });
      }
      return { taskId, filesRemovedAt: filesRemovedAt.toISOString() };
    });
  }
}
