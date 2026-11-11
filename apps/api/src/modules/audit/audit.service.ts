import crypto from 'node:crypto';
import { BadRequestException, Injectable } from '@nestjs/common';
import { ApiErrorCode, getApiErrorMessageVi, type AdminAuditQuery, type AdminAuditResponse } from '@flowvis/contracts';
import type { Prisma } from '../../generated/prisma/client.js';
import { PrismaService, type PrismaTransactionClient } from '../../infra/prisma.service.js';

export interface AuditRecordInput {
  adminId: string;
  action: string;
  target: string;
  beforeAfter: Prisma.InputJsonValue;
  requestId?: string;
}

/** Nơi duy nhất ghi bảng admin_audit; luôn ghi trong transaction của bên gọi. */
@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  /** Tìm dòng audit theo requestId (phát lại idempotent). */
  async findByRequestId(
    requestId: string,
  ): Promise<{ adminId: string; action: string; target: string; beforeAfter: Prisma.JsonValue } | null> {
    return this.prisma.adminAudit.findUnique({
      where: { requestId },
      select: { adminId: true, action: true, target: true, beforeAfter: true },
    });
  }

  /** Đọc nhật ký mới nhất trước, lọc action/target, phân trang con trỏ. */
  async list(query: AdminAuditQuery): Promise<AdminAuditResponse> {
    const pageSize = query.pageSize ?? 20;
    const cursor = query.cursor;
    if (cursor) {
      const ok = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(cursor)
        ? await this.prisma.adminAudit.findUnique({ where: { id: cursor }, select: { id: true } })
        : null;
      if (!ok) {
        throw new BadRequestException({
          code: ApiErrorCode.VALIDATION_FAILED,
          message: getApiErrorMessageVi(ApiErrorCode.VALIDATION_FAILED),
        });
      }
    }
    const rows = await this.prisma.adminAudit.findMany({
      where: { ...(query.action ? { action: query.action } : {}), ...(query.target ? { target: query.target } : {}) },
      orderBy: [{ at: 'desc' }, { id: 'desc' }],
      take: pageSize + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    const hasMore = rows.length > pageSize;
    const items = hasMore ? rows.slice(0, pageSize) : rows;
    return {
      items: items.map((r) => {
        const ba = r.beforeAfter as Record<string, unknown> | null;
        const reason = ba && typeof ba === 'object' && typeof ba.reason === 'string' ? ba.reason : null;
        return {
          id: r.id,
          adminId: r.adminId,
          action: r.action,
          target: r.target,
          reason,
          requestId: r.requestId,
          createdAt: r.at.toISOString(),
        };
      }),
      pageSize,
      hasMore,
      nextCursor: hasMore && items.length > 0 ? items[items.length - 1].id : null,
    };
  }

  async record(tx: PrismaTransactionClient, input: AuditRecordInput): Promise<void> {
    await tx.adminAudit.create({
      data: {
        id: crypto.randomUUID(),
        adminId: input.adminId,
        action: input.action,
        target: input.target,
        beforeAfter: input.beforeAfter,
        requestId: input.requestId ?? null,
      },
    });
  }
}
