import { BadRequestException, Body, Controller, Get, HttpCode, NotFoundException, Param, Post, Query, UseGuards } from '@nestjs/common';
import {
  AdminTaskLookupQuerySchema,
  AdminTaskTakedownRequestSchema,
  ApiErrorCode,
  getApiErrorMessageVi,
  getValidationReasonMessageVi,
  type AdminTaskLookupResponse,
  type AdminTaskTakedownResponse,
} from '@flowvis/contracts';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { RolesGuard } from '../auth/guards/roles.guard.js';
import type { JwtUserPayload } from '../auth/jwt.strategy.js';
import { AdminTasksService } from './admin-tasks.service.js';

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

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Controller('admin/tasks')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
export class AdminTasksController {
  constructor(private readonly adminTasks: AdminTasksService) {}

  @Get('lookup')
  async lookup(@Query() query: unknown): Promise<AdminTaskLookupResponse> {
    const p = AdminTaskLookupQuerySchema.safeParse(query);
    if (!p.success) throw validationError();
    return this.adminTasks.lookup(p.data);
  }

  @Post(':id/takedown')
  @HttpCode(200)
  async takedown(@CurrentUser() admin: JwtUserPayload, @Param('id') id: string, @Body() body: unknown): Promise<AdminTaskTakedownResponse> {
    if (!UUID_RE.test(id)) throw new NotFoundException({ code: ApiErrorCode.NOT_FOUND, message: getApiErrorMessageVi(ApiErrorCode.NOT_FOUND) });
    const p = AdminTaskTakedownRequestSchema.safeParse(body ?? {});
    if (!p.success) throw validationError(p.error.issues);
    return this.adminTasks.takedown(admin.sub, id, p.data.reason);
  }
}
