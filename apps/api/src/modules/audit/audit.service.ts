import crypto from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type { Prisma } from '../../generated/prisma/client.js';
import type { PrismaTransactionClient } from '../../infra/prisma.service.js';

export interface AuditRecordInput {
  adminId: string;
  action: string;
  target: string;
  beforeAfter: Prisma.InputJsonValue;
}

/** Nơi duy nhất ghi bảng admin_audit; luôn ghi trong transaction của bên gọi. */
@Injectable()
export class AuditService {
  async record(tx: PrismaTransactionClient, input: AuditRecordInput): Promise<void> {
    await tx.adminAudit.create({
      data: {
        id: crypto.randomUUID(),
        adminId: input.adminId,
        action: input.action,
        target: input.target,
        beforeAfter: input.beforeAfter,
      },
    });
  }
}
