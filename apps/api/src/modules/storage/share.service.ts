import crypto from 'node:crypto';
import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { ApiErrorCode, getApiErrorMessageVi, type ShareInfoResponse, type TaskShareResponse } from '@flowvis/contracts';
import { PrismaService } from '../../infra/prisma.service.js';
import { STORAGE_PORT, type StoragePort } from '../../ports/index.js';

export const SHARE_URL_TTL_SECONDS = 300;
const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

function apiError(Ctor: new (body: { code: ApiErrorCode; message: string }) => Error, code: ApiErrorCode): Error {
  return new Ctor({ code, message: getApiErrorMessageVi(code) });
}

export function hashShareToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function publicBase(): string {
  const raw = (process.env.API_PUBLIC_URL ?? '').trim().replace(/\/+$/, '');
  if (raw) return raw;
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Thiếu API_PUBLIC_URL: không dựng được đường dẫn chia sẻ');
  }
  return `http://localhost:${process.env.PORT || 3001}`;
}

/** Chủ sở hữu bảng `share_tokens` (AD-1). Chỉ lưu hash của token. */
@Injectable()
export class ShareService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(STORAGE_PORT) private readonly storage: StoragePort,
  ) {}

  /** Tạo token mới cho Task `succeeded` của chủ; token cũ đang hiệu lực (nếu có) bị thu hồi. */
  async create(userId: string, taskId: string): Promise<TaskShareResponse> {
    const task = await this.prisma.task.findUnique({
      where: { id: taskId },
      select: { userId: true, status: true, resultKey: true },
    });
    if (!task || task.userId !== userId) throw apiError(NotFoundException, ApiErrorCode.NOT_FOUND);
    if (task.status !== 'succeeded' || !task.resultKey) throw apiError(ConflictException, ApiErrorCode.CONFLICT);

    const base = publicBase();
    const token = crypto.randomBytes(32).toString('base64url');
    await this.prisma.$transaction(async (tx) => {
      // Tuần tự hóa các lệnh tạo song song cho cùng Task (nhấp đúp, retry).
      await tx.$queryRaw`SELECT id FROM tasks WHERE id = ${taskId}::uuid FOR UPDATE`;
      await tx.shareToken.updateMany({ where: { taskId, revokedAt: null }, data: { revokedAt: new Date() } });
      await tx.shareToken.create({ data: { taskId, userId, tokenHash: hashShareToken(token) } });
    });
    return { token, shareUrl: `${base}/s/${token}` };
  }

  /** Thu hồi mọi token đang hiệu lực của Task. Idempotent với chủ Task. */
  async revoke(userId: string, taskId: string): Promise<void> {
    const task = await this.prisma.task.findUnique({ where: { id: taskId }, select: { userId: true } });
    if (!task || task.userId !== userId) throw apiError(NotFoundException, ApiErrorCode.NOT_FOUND);
    await this.prisma.shareToken.updateMany({ where: { taskId, revokedAt: null }, data: { revokedAt: new Date() } });
  }

  private async lookup(token: string): Promise<{ key: string; params: unknown }> {
    if (!TOKEN_RE.test(token)) throw apiError(NotFoundException, ApiErrorCode.NOT_FOUND);
    const row = await this.prisma.shareToken.findUnique({
      where: { tokenHash: hashShareToken(token) },
      select: { revokedAt: true, task: { select: { status: true, resultKey: true, params: true } } },
    });
    const key = row && !row.revokedAt && row.task.status === 'succeeded' ? row.task.resultKey : null;
    if (!row || !key || !(await this.storage.head(key))) throw apiError(NotFoundException, ApiErrorCode.NOT_FOUND);
    return { key, params: row.task.params };
  }

  /** URL ký ngắn hạn tới `out/`; 404 chung cho token sai, đã thu hồi hoặc file đã bị xóa. */
  async resolve(token: string): Promise<string> {
    const { key } = await this.lookup(token);
    return this.storage.presignGet(key, SHARE_URL_TTL_SECONDS);
  }

  /** Loại media và độ dài (video) của kết quả được chia sẻ. */
  async info(token: string): Promise<ShareInfoResponse> {
    const { key, params } = await this.lookup(token);
    if (!key.endsWith('.mp4')) return { mediaType: 'image' };
    const seconds = ((params ?? {}) as Record<string, unknown>).seconds;
    if (!Number.isInteger(seconds) || (seconds as number) <= 0) throw apiError(NotFoundException, ApiErrorCode.NOT_FOUND);
    return { mediaType: 'video', durationSeconds: seconds as number };
  }

  /** URL ký tới ảnh bìa; chỉ video có ảnh bìa, còn lại là 404 chung. */
  async poster(token: string): Promise<string> {
    const { key } = await this.lookup(token);
    if (!key.endsWith('.mp4')) throw apiError(NotFoundException, ApiErrorCode.NOT_FOUND);
    const posterKey = key.replace(/\.mp4$/, '.jpg');
    if (!(await this.storage.head(posterKey))) throw apiError(NotFoundException, ApiErrorCode.NOT_FOUND);
    return this.storage.presignGet(posterKey, SHARE_URL_TTL_SECONDS);
  }
}
