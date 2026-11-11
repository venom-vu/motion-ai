import { BadRequestException, Controller, Get, Query, UseGuards } from '@nestjs/common';
import {
  AdminAuditQuerySchema,
  AdminStatsQuerySchema,
  ApiErrorCode,
  getApiErrorMessageVi,
  type AdminAuditResponse,
  type AdminStatsResponse,
} from '@flowvis/contracts';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { RolesGuard } from '../auth/guards/roles.guard.js';
import { AuditService } from '../audit/audit.service.js';
import { AdminStatsService } from './admin-stats.service.js';

function validationError(): BadRequestException {
  return new BadRequestException({
    code: ApiErrorCode.VALIDATION_FAILED,
    message: getApiErrorMessageVi(ApiErrorCode.VALIDATION_FAILED),
  });
}

@Controller('admin')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
export class AdminStatsController {
  constructor(
    private readonly stats: AdminStatsService,
    private readonly audit: AuditService,
  ) {}

  @Get('stats')
  async getStats(@Query() query: unknown): Promise<AdminStatsResponse> {
    const p = AdminStatsQuerySchema.safeParse(query);
    if (!p.success) throw validationError();
    return this.stats.compute(p.data);
  }

  @Get('audit')
  async getAudit(@Query() query: unknown): Promise<AdminAuditResponse> {
    const p = AdminAuditQuerySchema.safeParse(query);
    if (!p.success) throw validationError();
    return this.audit.list(p.data);
  }
}
