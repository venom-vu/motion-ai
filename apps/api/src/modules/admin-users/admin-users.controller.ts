import { BadRequestException, Body, Controller, Get, HttpCode, NotFoundException, Param, Post, Query, UseGuards } from '@nestjs/common';
import {
  AdminAdjustRequestSchema,
  AdminUserIdParamsSchema,
  AdminUserLedgerQuerySchema,
  AdminUserLockRequestSchema,
  AdminUserSearchQuerySchema,
  ApiErrorCode,
  getApiErrorMessageVi,
  getValidationReasonMessageVi,
  type AdminAdjustResponse,
  type AdminUser,
  type AdminUserLedgerResponse,
} from '@flowvis/contracts';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { RolesGuard } from '../auth/guards/roles.guard.js';
import type { JwtUserPayload } from '../auth/jwt.strategy.js';
import { AdminUsersService } from './admin-users.service.js';

function validationError(issues?: Array<{ path: Array<string | number>; code: string; received?: unknown }>): BadRequestException {
  const reasonMissing = issues?.some((i) => i.path[0] === 'reason' && ((i.code === 'invalid_type' && i.received === 'undefined') || i.code === 'too_small'));
  if (reasonMissing) {
    return new BadRequestException({
      code: ApiErrorCode.VALIDATION_FAILED,
      message: getValidationReasonMessageVi('REASON_REQUIRED'),
      details: { reason: 'REASON_REQUIRED' },
    });
  }
  return new BadRequestException({
    code: ApiErrorCode.VALIDATION_FAILED,
    message: getApiErrorMessageVi(ApiErrorCode.VALIDATION_FAILED),
  });
}

function parseId(id: string): string {
  const p = AdminUserIdParamsSchema.safeParse({ id });
  if (!p.success) {
    throw new NotFoundException({ code: ApiErrorCode.NOT_FOUND, message: getApiErrorMessageVi(ApiErrorCode.NOT_FOUND) });
  }
  return p.data.id;
}

@Controller('admin/users')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
export class AdminUsersController {
  constructor(private readonly users: AdminUsersService) {}

  @Get()
  async search(@Query() query: unknown): Promise<AdminUser> {
    const p = AdminUserSearchQuerySchema.safeParse(query);
    if (!p.success) throw validationError();
    return this.users.findByEmail(p.data.email);
  }

  @Get(':id')
  async get(@Param('id') id: string): Promise<AdminUser> {
    return this.users.get(parseId(id));
  }

  @Get(':id/ledger')
  async ledger(@Param('id') id: string, @Query() query: unknown): Promise<AdminUserLedgerResponse> {
    const uid = parseId(id);
    const p = AdminUserLedgerQuerySchema.safeParse(query);
    if (!p.success) throw validationError();
    return this.users.ledger(uid, p.data.pageSize, p.data.cursor);
  }

  @Post(':id/lock')
  @HttpCode(200)
  async lock(@CurrentUser() admin: JwtUserPayload, @Param('id') id: string, @Body() body: unknown): Promise<AdminUser> {
    const uid = parseId(id);
    const p = AdminUserLockRequestSchema.safeParse(body ?? {});
    if (!p.success) throw validationError(p.error.issues);
    return this.users.lock(admin.sub, uid, p.data.reason);
  }

  @Post(':id/unlock')
  @HttpCode(200)
  async unlock(@CurrentUser() admin: JwtUserPayload, @Param('id') id: string, @Body() body: unknown): Promise<AdminUser> {
    const uid = parseId(id);
    const p = AdminUserLockRequestSchema.safeParse(body ?? {});
    if (!p.success) throw validationError(p.error.issues);
    return this.users.unlock(admin.sub, uid, p.data.reason);
  }

  @Post(':id/adjust')
  @HttpCode(200)
  async adjust(@CurrentUser() admin: JwtUserPayload, @Param('id') id: string, @Body() body: unknown): Promise<AdminAdjustResponse> {
    const uid = parseId(id);
    const p = AdminAdjustRequestSchema.safeParse(body ?? {});
    if (!p.success) throw validationError(p.error.issues);
    return this.users.adjust(admin.sub, uid, p.data);
  }
}
