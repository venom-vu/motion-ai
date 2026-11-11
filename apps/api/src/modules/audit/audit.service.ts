import crypto from 'node:crypto';
import { Injectable } from '@nestjs/common';
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
