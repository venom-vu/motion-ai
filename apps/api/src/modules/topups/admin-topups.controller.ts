import { BadRequestException, Body, Controller, Get, HttpCode, NotFoundException, Param, Post, Query, UseGuards } from '@nestjs/common';
import {
  AdminTopupApproveExpiredRequestSchema,
  AdminTopupApproveRequestSchema,
  AdminTopupListQuerySchema,
  AdminTopupNeedsReviewRequestSchema,
  AdminTopupRejectRequestSchema,
  AdminTopupReturnToPendingRequestSchema,
  ApiErrorCode,
  TopupIdParamsSchema,
  getApiErrorMessageVi,
  type AdminTopup,
  type AdminTopupListResponse,
} from '@motion-ai/contracts';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { RolesGuard } from '../auth/guards/roles.guard.js';
import type { JwtUserPayload } from '../auth/jwt.strategy.js';
import { TopupsService } from './topups.service.js';

function validationError(): BadRequestException {
  return new BadRequestException({
    code: ApiErrorCode.VALIDATION_FAILED,
    message: getApiErrorMessageVi(ApiErrorCode.VALIDATION_FAILED),
  });
}

function parseId(id: string): string {
  const p = TopupIdParamsSchema.safeParse({ id });
  if (!p.success) {
    throw new NotFoundException({
      code: ApiErrorCode.NOT_FOUND,
      message: getApiErrorMessageVi(ApiErrorCode.NOT_FOUND),
    });
  }
  return p.data.id;
}

@Controller('admin/topups')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
export class AdminTopupsController {
  constructor(private readonly topups: TopupsService) {}

  @Get()
  async list(@Query() query: unknown): Promise<AdminTopupListResponse> {
    const parsed = AdminTopupListQuerySchema.safeParse(query);
    if (!parsed.success) throw validationError();
    return this.topups.adminList(parsed.data);
  }

  @Post(':id/approve')
  @HttpCode(200)
  async approve(@CurrentUser() user: JwtUserPayload, @Param('id') id: string, @Body() body: unknown): Promise<AdminTopup> {
    const topupId = parseId(id);
    const parsed = AdminTopupApproveRequestSchema.safeParse(body);
    if (!parsed.success) throw validationError();
    return this.topups.approve(user.sub, topupId, parsed.data.bankRef);
  }

  @Post(':id/approve-expired')
  @HttpCode(200)
  async approveExpired(@CurrentUser() user: JwtUserPayload, @Param('id') id: string, @Body() body: unknown): Promise<AdminTopup> {
    const topupId = parseId(id);
    const parsed = AdminTopupApproveExpiredRequestSchema.safeParse(body);
    if (!parsed.success) throw validationError();
    return this.topups.approveExpired(user.sub, topupId, parsed.data.bankRef);
  }

  @Post(':id/reject')
  @HttpCode(200)
  async reject(@CurrentUser() user: JwtUserPayload, @Param('id') id: string, @Body() body: unknown): Promise<AdminTopup> {
    const topupId = parseId(id);
    const parsed = AdminTopupRejectRequestSchema.safeParse(body);
    if (!parsed.success) throw validationError();
    return this.topups.reject(user.sub, topupId, parsed.data.rejectReason);
  }

  @Post(':id/needs-review')
  @HttpCode(200)
  async needsReview(@CurrentUser() user: JwtUserPayload, @Param('id') id: string, @Body() body: unknown): Promise<AdminTopup> {
    const topupId = parseId(id);
    const parsed = AdminTopupNeedsReviewRequestSchema.safeParse(body);
    if (!parsed.success) throw validationError();
    return this.topups.markNeedsReview(user.sub, topupId, parsed.data.note);
  }

  @Post(':id/return-to-pending')
  @HttpCode(200)
  async returnToPending(@CurrentUser() user: JwtUserPayload, @Param('id') id: string, @Body() body: unknown): Promise<AdminTopup> {
    const topupId = parseId(id);
    const parsed = AdminTopupReturnToPendingRequestSchema.safeParse(body);
    if (!parsed.success) throw validationError();
    return this.topups.returnToPending(user.sub, topupId);
  }
}
