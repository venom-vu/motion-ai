import { BadRequestException, Body, Controller, Get, HttpCode, NotFoundException, Param, Post, Query, UseGuards } from '@nestjs/common';
import {
  ApiErrorCode,
  TopupCreateRequestSchema,
  TopupIdParamsSchema,
  TopupListQuerySchema,
  getApiErrorMessageVi,
  type Topup,
  type TopupListResponse,
} from '@flowvis/contracts';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { AccountLockedGuard } from '../auth/guards/account-locked.guard.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import type { JwtUserPayload } from '../auth/jwt.strategy.js';
import { TopupThrottlerGuard } from '../auth/throttler.guard.js';
import { TopupsService } from './topups.service.js';

@Controller('topups')
@UseGuards(JwtAuthGuard, AccountLockedGuard)
export class TopupsController {
  constructor(private readonly topups: TopupsService) {}

  @Post()
  @UseGuards(TopupThrottlerGuard)
  async create(@CurrentUser() user: JwtUserPayload, @Body() body: unknown): Promise<Topup> {
    const parsed = TopupCreateRequestSchema.safeParse(body);
    if (!parsed.success) {
      const code = ApiErrorCode.VALIDATION_FAILED;
      throw new BadRequestException({
        code,
        message: getApiErrorMessageVi(code),
      });
    }
    return this.topups.create(user.sub, parsed.data);
  }

  @Get()
  async list(@CurrentUser() user: JwtUserPayload, @Query() query: unknown): Promise<TopupListResponse> {
    const parsed = TopupListQuerySchema.safeParse(query);
    if (!parsed.success) {
      throw new BadRequestException({
        code: ApiErrorCode.VALIDATION_FAILED,
        message: getApiErrorMessageVi(ApiErrorCode.VALIDATION_FAILED),
      });
    }
    return this.topups.list(user.sub, parsed.data);
  }

  @Post(':id/confirm-transfer')
  @HttpCode(200)
  @UseGuards(TopupThrottlerGuard)
  async confirmTransfer(@CurrentUser() user: JwtUserPayload, @Param('id') id: string): Promise<Topup> {
    const p = TopupIdParamsSchema.safeParse({ id });
    if (!p.success) {
      throw new NotFoundException({
        code: ApiErrorCode.NOT_FOUND,
        message: getApiErrorMessageVi(ApiErrorCode.NOT_FOUND),
      });
    }
    return this.topups.confirmTransfer(user.sub, p.data.id);
  }

  @Get(':id')
  async get(@CurrentUser() user: JwtUserPayload, @Param('id') id: string): Promise<Topup> {
    const p = TopupIdParamsSchema.safeParse({ id });
    if (!p.success) {
      throw new NotFoundException({
        code: ApiErrorCode.NOT_FOUND,
        message: getApiErrorMessageVi(ApiErrorCode.NOT_FOUND),
      });
    }
    return this.topups.getById(user.sub, p.data.id);
  }
}
